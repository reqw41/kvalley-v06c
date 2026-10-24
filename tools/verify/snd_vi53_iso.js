"use strict";
// snd_vi53_iso.js — дифференциальный стенд звука: основа (e2b8f32, ВИ53 подменой пробы AY) против
// новой сборки. Обе ROM грузятся в эмулятор, игра доводится до геймплея, дальше ВРУЧНУЮ (без кадров
// и прерываний) вызываются SetMusic_, updateSound, vec_snd_apply, vec_snd_hush и меняется
// vec_snd_mode. После КАЖДОГО тика звука сравнивается состояние каналов ВИ53 по порт-модели.
//   node tools/verify/snd_vi53_iso.js <base.rom> <base.sym> <new.rom> <new.sym> [--random N] [--json out]
const fs = require("fs"), path = require("path");
const harness = require("./beam_harness.js");
const { makeModel } = require("./snd_vi53_rec.js");

const ay2vi = (p) => ((13 * p) + (p >> 1)) & 0xFFFF;
const JUNK = [0x0F11, 0x0F22, 0x0F33];
const SENT = 0x00F0;
function callSub(E, addr, a, guard = 600000) {
  const { cpu, memory } = E;
  cpu.iff = false;
  const sp = (cpu.sp - 2) & 65535;
  memory.write(sp, SENT & 255, true); memory.write(sp + 1, SENT >> 8, true);
  cpu.sp = sp; cpu.pc = addr; if (a !== undefined) cpu.regs[7] = a;
  let n = 0;
  while (cpu.pc !== SENT) { cpu.instruction(); if (++n > guard) throw new Error("callSub не вернулся " + addr.toString(16)); }
}

function boot(rom, sym, kind) {
  const E = harness.make(rom, sym);
  const { L, memory } = E;
  if (kind === "base") {
    const a = L.vec_ay_ok, t = L.vec_no_ay;
    memory.write(a, 0xC3, false); memory.write(a + 1, t & 255, false); memory.write(a + 2, t >> 8, false);
  }
  if (harness.toGame(E) !== 5) throw new Error("нет геймплея");
  E.run(5);
  E.kind = kind; E.model = makeModel(E);
  return E;
}
// чистое состояние: все голоса пусты, каналы выключены, остаток периода — JUNK
function reset(E, junk = JUNK) {
  const { L, memory } = E;
  const wr = (a, v) => memory.write(a & 0xFFFF, v & 255, false);
  for (let i = 0; i < 0x34; i++) wr(L.MusicChanData + i, 0);
  wr(L.vec_snd_mode, 0);
  if (E.kind === "base") {
    for (let i = 0; i < 16; i++) wr(L.vec_ayregs + i, 0);
    junk.forEach((p, c) => { wr(L.vec_ayregs + 2 * c, p & 255); wr(L.vec_ayregs + 2 * c + 1, p >> 8); });
    wr(L.vec_ayregs + 7, 0xFF);
  } else {
    for (let c = 0; c < 3; c++) { const d = ay2vi(junk[c]); wr(0x7ECC + 3 * c, 0); wr(0x7ECC + 3 * c + 1, d & 255); wr(0x7ECC + 3 * c + 2, d >> 8); }
  }
  for (let c = 0; c < 3; c++) wr(L.vec_vch + c, 0);
  wr(L.vtm_have, 0);
  callSub(E, L.vec_snd_hush);
  E.model.vi.forEach((s) => { s.on = false; s.mode = 3; s.div = -1; s.ph = 0; });
}
const ops = {
  tick: (E) => callSub(E, E.L.updateSound),
  start: (E, arg) => { if ((arg & 0x3F) === 1) E.memory.write(E.L.flagSetCaeSnd, 0, false); callSub(E, E.L.SetMusic_, arg); },
  mode: (E, m) => { E.memory.write(E.L.vec_snd_mode, m, false); callSub(E, E.L.vec_snd_apply); },
  hush: (E) => callSub(E, E.L.vec_snd_hush),
  apply: (E) => callSub(E, E.L.vec_snd_apply),
};

const ARGS = [0x01, 0x02, 0x03, 0x04, 0x45, 0x06, 0x87, 0x08, 0x09, 0x8A, 0x8B, 0x8D, 0x8F, 0x91, 0x94, 0x97, 0x9A, 0x1D, 0x20];

function runBoth(B, N, seq, diffs, label, maxDiffs = 40) {
  reset(B); reset(N);
  let tick = 0, idxs = 0;
  for (const op of seq) {
    for (const E of [B, N]) ops[op[0]](E, op[1]);
    if (op[0] === "tick") {
      tick++;
      const kb = B.model.key(), kn = N.model.key();
      if (kb !== kn) { if (diffs.length < maxDiffs) diffs.push({ label, tick, base: kb, now: kn, ops: idxs }); else diffs.overflow = (diffs.overflow || 0) + 1; }
    }
    idxs++;
  }
  return tick;
}

// Воспроизвести записанную последовательность операций (snd_vi53_rec.js: T, S arg, A, H, M v, Z)
// и вернуть порт-состояние после каждого тика.
function replay(E, ops) {
  reset(E, [0, 0, 0]);
  const out = [];
  for (const op of ops) {
    switch (op[0]) {
      case "T": ops_.tick(E); out.push(E.model.key()); break;
      case "S": ops_.start(E, op[1]); break;
      case "A": ops_.apply(E); break;
      case "H": ops_.hush(E); break;
      case "K": callSub(E, E.L.vtm_start); break;
      case "M": E.memory.write(E.L.vec_snd_mode, op[1], false); break;
      case "Z": for (let i = 0; i < 0x34; i++) E.memory.write(E.L.MusicChanData + i, 0, false); break;
      default: throw new Error("op " + op[0]);
    }
  }
  return out;
}
const ops_ = ops;

// детерминированный ГСЧ
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function main() {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const B = boot(a[0], a[1], "base"), N = boot(a[2], a[3], "new");
  const result = { single: {}, random: null };
  let totalTicks = 0;
  // 1) каждый звук отдельно, до конца (петля — 2.2 периода), +10 тиков тишины
  for (const arg of ARGS) {
    const seq = [["start", arg]];
    const T = arg === 0x01 ? 560 : arg === 0x8B ? 2400 : 700;
    for (let i = 0; i < T; i++) seq.push(["tick"]);
    const diffs = [];
    const n = runBoth(B, N, seq, diffs, "single 0x" + arg.toString(16));
    totalTicks += n;
    result.single["0x" + arg.toString(16)] = { ticks: n, diffs };
    console.log(`звук 0x${arg.toString(16)}: тиков ${n}, расхождений ${diffs.length}${diffs.overflow ? "+" + diffs.overflow : ""}`);
  }
  result.single_ticks = totalTicks;
  // 2) случайные сценарии: наложения, приоритеты, режимы S, пауза
  const NR = +get("--random", "300");
  const diffsR = []; let tr = 0;
  for (let s = 1; s <= NR; s++) {
    const r = rng(s * 7919);
    const seq = [];
    const len = 400 + Math.floor(r() * 800);
    for (let i = 0; i < len; i++) {
      const x = r();
      if (x < 0.035) seq.push(["start", ARGS[Math.floor(r() * ARGS.length)]]);
      else if (x < 0.040) seq.push(["mode", Math.floor(r() * 3)]);
      else if (x < 0.044) { seq.push(["hush"]); const k = Math.floor(r() * 6); for (let j = 0; j < k; j++) seq.push(["tick"]); /* пауза: тики не идут в игре, но проверим и так */ seq.push(["apply"]); }
      else seq.push(["tick"]);
    }
    tr += runBoth(B, N, seq, diffsR, "random#" + s, 60);
  }
  result.random = { scenarios: NR, ticks: tr, diffs: diffsR, overflow: diffsR.overflow || 0 };
  console.log(`случайных сценариев ${NR}, тиков ${tr}, расхождений ${diffsR.length}${diffsR.overflow ? "+" + diffsR.overflow : ""}`);
  const out = get("--json", null);
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1));
  for (const d of diffsR.slice(0, 8)) console.log(JSON.stringify(d));
}
if (require.main === module) main();
module.exports = { boot, reset, ops, callSub, runBoth, ARGS, replay };
