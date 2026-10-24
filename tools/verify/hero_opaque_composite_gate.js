// hero_opaque_composite_gate.js — ОРАКУЛ КАРТИНКИ непрозрачной пары (этап 1 плана).
//
// Два прогона ОДНОЙ пачки из ОДНОГО снимка:
//   A — vpr_mix=0xFE (как после vmx_bad): SAT + vtm_hrd;
//   B — как решил тик: vpr_sl=2, пара последней, без vtm_hrd.
// vop_one уже поздно к vec_spr_out (vmx_check в тике), поэтому A сбрасывает mix/sl.
// Допуск на габарите пары ∪ мумии — 0 байт. BREAK=1 портит одежду в B.
//
// Выборка: пачка с vop_i1 (лестница) И пересечением слотов 4/5 со слотами 6–13.
// Пустая выборка = FAIL.
//
// Запуск: node tools/verify/hero_opaque_composite_gate.js [rom] [sym] [--ticks N] [--min N]
//   BREAK=1 — негатив: портим байт спрайта слота 4, гейт обязан покраснеть.
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NTICKS = 400, MINPACK = 20;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--ticks") NTICKS = +args[++i];
  else if (a === "--min") MINPACK = +args[++i];
}
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory, keyboard } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
for (const s of ["vec_spr_out", "vso_fix", "vop_i1", "vpr_mix", "vpr_sl", "timer", "GameStatus", "vec_god"])
  if (L[s] === undefined) { console.error("нет символа " + s); process.exit(2); }
const BREAK = process.env.BREAK === "1";

if (toGame(E) !== 5) { console.error("НЕ ВОШЛИ В ИГРУ"); process.exit(2); }
function tick() { const t0 = rd(L.timer); let n = 0;
  do { v06c.oneInterrupt(true); if (++n > 16) { console.error("тик не случился"); process.exit(3); } }
  while (rd(L.timer) === t0); }
for (let i = 0; i < 40; i++) tick();
wr(L.vec_god, 1);
const MD = L.momiaDat, STEP = (L.momiaDat2 !== undefined) ? (L.momiaDat2 - L.momiaDat) : 16;
function place() {
  const hY = rd(L.ProtaY), hX = rd(L.ProtaX), room = rd(L.ProtaRoom);
  for (let m = 0; m < 2; m++) {
    const p = MD + m * STEP;
    wr(p + 0, 0); wr(p + 3, hY); wr(p + 5, (hX + (m ? 14 : -14)) & 255); wr(p + 6, room);
  }
  wr(L.enemyAttrib, hY); wr(L.enemyAttrib + 1, (hX + 14) & 255);
  wr(L.enemyAttrib + 2, hY); wr(L.enemyAttrib + 3, (hX - 14) & 255);
}
place(); for (let i = 0; i < 10; i++) tick();
keyboard.keyDown({ keyCode: 39, which: 39, preventDefault() {}, stopPropagation() {} });

function rec(idx) {
  const P = 0xE000 + idx * 256, pd = rd(P + 0x96);
  if (pd !== 1 && pd !== 3) return null;
  const nc = rd(P + 0x99); if (!nc) return null;
  const c0 = rd(P + 0x97) & 0x1F;
  return { c0, c1: c0 + nc, lo: rd(P + 0x98) };
}
function ovl(a, b) {
  if (!a || !b) return false;
  if (a.c1 <= b.c0 || b.c1 <= a.c0) return false;
  return a.lo < b.lo + 16 && b.lo < a.lo + 16;
}
function mumOvl() {
  const p = rec(4) || rec(5); if (!p) return false;
  for (let i = 6; i <= 13; i++) if (ovl(p, rec(i))) return true;
  return false;
}
function targetPack() { return !!rd(L.vop_i1) && mumOvl(); }

function snap() {
  return { m: memory.bytes.slice(), sp: cpu.sp, pc: cpu.pc, regs: cpu.regs.slice(),
    iff: cpu.iff, ip: cpu.iff_pending, sf: cpu.sf, pf: cpu.pf, hf: cpu.hf, zf: cpu.zf, cf: cpu.cf,
    ms: memory.mode_stack, mm: memory.mode_map, pm: memory.page_map, ps: memory.page_stack, cw: memory.cw };
}
function rest(s) {
  memory.bytes.set(s.m); cpu.sp = s.sp; cpu.pc = s.pc; cpu.iff = s.iff; cpu.iff_pending = s.ip;
  cpu.sf = s.sf; cpu.pf = s.pf; cpu.hf = s.hf; cpu.zf = s.zf; cpu.cf = s.cf;
  for (let i = 0; i < 8; i++) cpu.regs[i] = s.regs[i];
  memory.mode_stack = s.ms; memory.mode_map = s.mm; memory.page_map = s.pm; memory.page_stack = s.ps; memory.cw = s.cw;
}
function grab() {
  const b = Buffer.alloc(0x6000 + 0x200);
  for (let i = 0; i < 0x6000; i++) b[i] = rd(0x8000 + i);
  for (let i = 0; i < 0x200; i++) b[0x6000 + i] = rd(0xE400 + i); // слоты 4 и 5
  return b;
}
function footprint() {
  const set = new Set();
  const paint = (hi, lo, nc) => {
    if (!hi || !nc) return;
    for (let c = 0; c < nc; c++) {
      const h = (hi + c) & 0xff; if (h < 0x80 || h >= 0xE0) continue;
      for (let r = 0; r < 16; r++) set.add((h << 8) | ((lo + r) & 0xff));
    }
  };
  for (const idx of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
    const P = 0xE000 + idx * 256;
    if (rd(P)) {
      const lo = rd(P + 2), nc = rd(P + 3);
      paint(rd(P + 1), lo, nc); paint(rd(P + 4), lo, nc); paint(rd(P + 5), lo, nc);
    }
    const pd = rd(P + 0x96);
    if (pd === 1 || pd === 3) {
      const lo = rd(P + 0x98), nc = rd(P + 0x99);
      paint(rd(P + 0x97), lo, nc); paint(rd(P + 0x9F), lo, nc); paint(rd(P + 0x9B), lo, nc);
    }
  }
  return set;
}

const END = L.vso_fix + 3;
function runPack() {
  let n = 0;
  while (cpu.pc !== END) { cpu.instruction(); if (++n > 8000000) return false; }
  return true;
}

let cmp = 0, stuck = 0, badFp = 0, badFpB = 0, badOth = 0, badOthB = 0, slotB = 0;
let nested = false;
v06c.check_breakpoint = function () {
  if (nested) return false;
  if (cpu.pc !== L.vec_spr_out) return false;
  if (!targetPack()) return false;
  const S = snap(), fp = footprint();
  nested = true;
  wr(L.vpr_mix, 0xFE);
  wr(L.vpr_sl, 0);
  if (!runPack()) { stuck++; rest(S); nested = false; return false; }
  const fbA = grab();
  rest(S);
  if (BREAK) wr(0xE4A0, rd(0xE4A0) ^ 0x55);
  if (!runPack()) { stuck++; rest(S); nested = false; return false; }
  const fbB = grab();
  rest(S); nested = false;
  cmp++;
  let df = 0, dx = 0, ds = 0;
  for (let i = 0; i < 0x6000; i++) if (fbA[i] !== fbB[i]) {
    const a = 0x8000 + i;
    if (fp.has(a)) df++; else dx++;
  }
  for (let i = 0; i < 0x200; i++) if (fbA[0x6000 + i] !== fbB[0x6000 + i]) ds++;
  if (df) { badFp++; badFpB += df; }
  if (dx) { badOth++; badOthB += dx; }
  if (ds) slotB += ds;
  return false;
};
let steps = 0;
while (steps < NTICKS) { tick(); steps++; if (steps % 40 === 0) place(); }
v06c.check_breakpoint = () => false;

console.log(`ROM=${path.basename(ROM)} тиков=${NTICKS}${BREAK ? "  BREAK=1" : ""}`);
console.log(`ПОКРЫТИЕ: пачек лестница+мумия сравнено ${cmp} (нужно >= ${MINPACK})`
  + (stuck ? `, сорвалось ${stuck}` : ""));
console.log(`расхождений на габарите пары∪мумий: ${badFp} пачек, ${badFpB} байт`);
console.log(`прочие fb: ${badOth} пачек, ${badOthB} байт; слоты 4/5: ${slotB} байт`);
if (cmp < MINPACK) {
  console.log(`ГЕЙТ ПРОВАЛЕН: выборка ${cmp} < ${MINPACK}`);
  process.exit(2);
}
if (BREAK) {
  if (!(badFpB || badOthB || slotB)) {
    console.log("ГЕЙТ ПРОВАЛЕН: BREAK=1 не поймал порчу — стенд слеп");
    process.exit(1);
  }
  console.log("НЕГАТИВ ОК: порча байта одежды краснеет");
  process.exit(0);
}
if (badFpB || badOthB || slotB) {
  console.log("ГЕЙТ ПРОВАЛЕН: два прогона одного снимка разошлись");
  process.exit(1);
}
console.log("ГЕЙТ ЗЕЛЁНЫЙ: A (vmx_bad) = B (пара последней)");
