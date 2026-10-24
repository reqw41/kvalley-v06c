#!/usr/bin/env node
"use strict";
// capture.js — снять с исходного драйвера Konami (замороженная сборка e2b8f32, режим ВИ53)
// покадровые (по тикам звука) состояния трёх голосов для каждого звука игры.
// Результат — captured.json: { sounds: { "<arg>": { voices:[{ticks:[[on,div,pdiv],...], endTick, loop:{tA,tE}|null}] } } }
// Состояние голоса после тика = (on, div, pdiv): on — канал ВИ53 включён, div — делитель на
// порту (если on), pdiv — делитель, соответствующий регистрам периода AY (даже если канал выключен).
// Нужен эмулятор vector06js (путь зашит в tools/verify/beam_harness.js).
const fs = require("fs"), path = require("path");
const harness = require("../verify/beam_harness.js");
const HERE = __dirname;
const ROM = path.join(HERE, "base_e2b8f32.rom"), SYM = path.join(HERE, "base_e2b8f32.sym");

// аргументы SetMusic_, с которыми игра зовёт setMusic (проверено по исходнику)
const ARGS = [0x02, 0x03, 0x04, 0x45, 0x06, 0x87, 0x08, 0x09, 0x8A, 0x8B, 0x8D, 0x8F, 0x91, 0x94, 0x97, 0x9A, 0x1D, 0x20];
const JUNK = [0x0F11, 0x0F22, 0x0F33]; // «чужие» периоды: если на выходе всплывёт — значит звук читает остаток

const ay2vi = (p) => ((13 * p) + (p >> 1)) & 0xFFFF;

function make() {
  const E = harness.make(ROM, SYM);
  // режим ВИ53: проба AY пропускается (как snd_cost_lib.patchChip)
  const { L, memory } = E;
  const a = L.vec_ay_ok, t = L.vec_no_ay;
  memory.write(a, 0xC3, false); memory.write(a + 1, t & 255, false); memory.write(a + 2, t >> 8, false);
  if (harness.toGame(E) !== 5) throw new Error("нет геймплея");
  E.run(5);
  return E;
}

const SENT = 0x00F0;
function callSub(E, addr, a, guard = 400000) {
  const { cpu, memory } = E;
  cpu.iff = false;
  const sp = (cpu.sp - 2) & 65535;
  memory.write(sp, SENT & 255, true); memory.write(sp + 1, SENT >> 8, true);
  cpu.sp = sp; cpu.pc = addr; if (a !== undefined) cpu.regs[7] = a;
  let n = 0;
  while (cpu.pc !== SENT) { cpu.instruction(); if (++n > guard) throw new Error("callSub не вернулся " + addr.toString(16)); }
}

function captureOne(E, arg, opt = {}) {
  const { L, rd, memory, cpu } = E;
  const wr = (a, v) => memory.write(a, v & 255, false);
  const junk = opt.junk || JUNK;
  for (let i = 0; i < 0x34; i++) wr(L.MusicChanData + i, 0); // каналы, mixer, флаг падения, caida
  for (let i = 0; i < 16; i++) wr(L.vec_ayregs + i, 0);
  junk.forEach((p, c) => { wr(L.vec_ayregs + 2 * c, p & 255); wr(L.vec_ayregs + 2 * c + 1, p >> 8); });
  wr(L.vec_ayregs + 7, 0xFF);
  wr(L.vec_snd_mode, 0);
  // порт-модель
  const vi = [0, 1, 2].map(() => ({ mode: 3, on: false, div: 0, ph: 0, lo: 0 }));
  const oldOut = E.io.output.bind(E.io);
  E.io.output = function (port, w8) {
    port &= 255; w8 &= 255;
    if (port === 0x08) { const ch = w8 >> 6; if (ch < 3 && (w8 & 0x30)) { vi[ch].mode = (w8 >> 1) & 7; vi[ch].on = false; vi[ch].ph = 0; } }
    else if (port >= 0x09 && port <= 0x0B) {
      const s = vi[port === 0x0B ? 0 : port === 0x0A ? 1 : 2];
      if (s.ph === 0) { s.lo = w8; s.ph = 1; } else { s.div = s.lo | (w8 << 8); s.ph = 0; s.on = true; }
    }
    return oldOut(port, w8);
  };
  callSub(E, L.vec_snd_hush);
  // хук: начало ноты и бесконечный цикл паттерна
  const noteStarts = [[], [], []]; // [tick, addr]
  const loops = [null, null, null];
  let tick = 0;
  const oldInstr = cpu.instruction.bind(cpu);
  const rd16 = (a) => rd(a) | (rd(a + 1) << 8);
  cpu.instruction = function () {
    const pc = cpu.pc;
    if (pc === L.nextNote) {
      const v = Math.round((rd16(L.z80_ix) - L.MusicChanData) / 14);
      if (v >= 0 && v < 3) noteStarts[v].push([tick, rd16(L.MusicChanData + 14 * v + 3)]);
    }
    if (pc === L.patternLoop) {
      const v = Math.round((rd16(L.z80_ix) - L.MusicChanData) / 14);
      const hl = (cpu.regs[4] << 8) | cpu.regs[5];
      if (rd(hl + 1) === 0xFF && v >= 0 && v < 3 && !loops[v]) loops[v] = { tE: tick, target: rd16(hl + 2) };
    }
    return oldInstr();
  };
  callSub(E, L.SetMusic_, arg);
  const idOf = (c) => rd(L.MusicChanData + 14 * c + 2);
  const startIds = [0, 1, 2].map(idOf);
  const used = startIds.map((x) => x !== 0);
  const voices = [0, 1, 2].map(() => ({ ticks: [], endTick: null }));
  const maxT = opt.maxT || 6000;
  const snapShadow = (c) => { const p = rd(L.vec_ayregs + 2 * c) | ((rd(L.vec_ayregs + 2 * c + 1) & 15) << 8); return p; };
  const snapPort = (c) => (vi[c].on && vi[c].mode === 3 ? 1 : 0);
  for (tick = 1; tick <= maxT; tick++) {
    callSub(E, L.updateSound);
    let alive = false;
    for (let c = 0; c < 3; c++) {
      if (!used[c]) continue;
      const v = voices[c];
      if (v.endTick !== null) continue;
      const on = snapPort(c), pd = ay2vi(snapShadow(c));
      if (on && vi[c].div !== pd) throw new Error(`arg ${arg.toString(16)} tick ${tick} voice ${c}: порт ${vi[c].div} != ay2vi(регистры) ${pd}`);
      // голос уже отыграл? ID==0 после тика
      v.ticks.push([on, on ? vi[c].div : 0, pd]);
      if (idOf(c) === 0) v.endTick = tick; else alive = true;
    }
    // выход: все голоса кончились, либо все оставшиеся уже прошли цикл целиком
    let done = true;
    for (let c = 0; c < 3; c++) {
      if (!used[c]) continue;
      const v = voices[c];
      if (v.endTick !== null) continue;
      const lp = loops[c];
      if (!lp) { done = false; break; }
      // период цикла
      const first = noteStarts[c].find((x) => x[1] === lp.target);
      if (!first) throw new Error("цель цикла не найдена c="+c+" "+JSON.stringify(lp)+" starts="+JSON.stringify(noteStarts[c].slice(0,6))+" MI="+E.L.MUS_Ingame.toString(16));
      const per = lp.tE - first[0];
      if (tick < lp.tE + 2 * per + 4) { done = false; break; }
    }
    if (done) break;
  }
  cpu.instruction = oldInstr;
  E.io.output = oldOut;
  const out = { arg, used, voices: [] };
  for (let c = 0; c < 3; c++) {
    if (!used[c]) { out.voices.push(null); continue; }
    const v = voices[c], lp = loops[c];
    let loop = null;
    if (lp) {
      const first = noteStarts[c].find((x) => x[1] === lp.target);
      loop = { tA: first[0], tE: lp.tE, target: lp.target };
    }
    out.voices.push({ ticks: v.ticks, endTick: v.endTick, loop });
  }
  return out;
}

function main() {
  const E = make();
  const res = { args: {} };
  for (const arg of ARGS) {
    const r1 = captureOne(E, arg, { junk: JUNK });
    const r2 = captureOne(E, arg, { junk: [0x0A55, 0x0B66, 0x0C77] });
    res.args[arg] = { a: r1, b: r2 };
    process.stderr.write(`arg 0x${arg.toString(16)}: voices ${r1.voices.map((v) => v ? v.ticks.length + (v.loop ? "L" : "") : "-").join(",")}\n`);
  }
  // падение: id 1 — процедурное, снимаем 70 тиков с флагом init
  {
    const { L, memory } = E;
    const wr = (a, v) => memory.write(a, v & 255, false);
    const r = [];
    for (const junk of [JUNK, [0x0A55, 0x0B66, 0x0C77]]) {
      // flagSetCaeSnd=0 до SetMusic_ (как делает игра)
      for (let i = 0; i < 0x34; i++) wr(L.MusicChanData + i, 0);
      r.push(captureOneFall(E, junk));
    }
    res.fall = r[0];
  }
  fs.writeFileSync(path.join(HERE, "captured.json"), JSON.stringify(res));
}

function captureOneFall(E, junk) {
  const { L, rd, memory, cpu } = E;
  const wr = (a, v) => memory.write(a, v & 255, false);
  for (let i = 0; i < 16; i++) wr(L.vec_ayregs + i, 0);
  junk.forEach((p, c) => { wr(L.vec_ayregs + 2 * c, p & 255); wr(L.vec_ayregs + 2 * c + 1, p >> 8); });
  wr(L.vec_ayregs + 7, 0xFF); wr(L.vec_snd_mode, 0);
  const vi = [0, 1, 2].map(() => ({ mode: 3, on: false, div: 0, ph: 0, lo: 0 }));
  const oldOut = E.io.output.bind(E.io);
  E.io.output = function (port, w8) {
    port &= 255; w8 &= 255;
    if (port === 0x08) { const ch = w8 >> 6; if (ch < 3 && (w8 & 0x30)) { vi[ch].mode = (w8 >> 1) & 7; vi[ch].on = false; vi[ch].ph = 0; } }
    else if (port >= 0x09 && port <= 0x0B) { const s = vi[port === 0x0B ? 0 : port === 0x0A ? 1 : 2]; if (s.ph === 0) { s.lo = w8; s.ph = 1; } else { s.div = s.lo | (w8 << 8); s.ph = 0; s.on = true; } }
    return oldOut(port, w8);
  };
  callSub(E, L.vec_snd_hush);
  wr(L.flagSetCaeSnd, 0);
  callSub(E, L.SetMusic_, 1);
  const t = [];
  for (let i = 1; i <= 560; i++) {
    callSub(E, L.updateSound);
    const p = rd(L.vec_ayregs + 4) | ((rd(L.vec_ayregs + 5) & 15) << 8);
    t.push([vi[2].on && vi[2].mode === 3 ? 1 : 0, vi[2].on ? vi[2].div : 0, ((13 * p) + (p >> 1)) & 0xFFFF, p, rd(L.MusicChanData3 + 2), rd(L.vec_ayregs + 10) & 15]);
  }
  E.io.output = oldOut;
  return t;
}
if (require.main === module) main();
module.exports = { ay2vi };
