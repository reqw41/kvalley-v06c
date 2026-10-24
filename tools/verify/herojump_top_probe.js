#!/usr/bin/env node
// herojump_top_probe.js — сценарий владельца: ГЕРОЙ прыгает через мумию в ВЕРХНЕЙ
// строке (ROW=8). Чистый hide (АИ заглушен) + diff против REF тем же методом.
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NT = 120, ROW = 8, HIDE = 3, SHOTS = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--row") ROW = +args[++i];
  else if (a === "--hide") HIDE = +args[++i];
  else if (a === "--shots") SHOTS = true;
  else if (/^\d+$/.test(a)) NT = +a;
}
const E = make(ROM, SYM);
const { L, rd, v06c, memory, keyboard, cpu, pngFrom, idealBmp } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }

function tick() { const t0 = rd(L.timer); do v06c.oneInterrupt(true); while (rd(L.timer) === t0); }
function key(c, d) { const e = { keyCode: c, which: c, preventDefault() {}, stopPropagation() {} }; d ? keyboard.keyDown(e) : keyboard.keyUp(e); }
function snap() {
  return { m: memory.bytes.slice(), sp: cpu.sp, pc: cpu.pc, iff: cpu.iff, ip: cpu.iff_pending,
    sf: cpu.sf, pf: cpu.pf, hf: cpu.hf, zf: cpu.zf, cf: cpu.cf, regs: cpu.regs.slice(),
    ms: memory.mode_stack, mm: memory.mode_map, pm: memory.page_map, ps: memory.page_stack, cw: memory.cw };
}
function rest(s) {
  memory.bytes.set(s.m); cpu.sp = s.sp; cpu.pc = s.pc; cpu.iff = s.iff; cpu.iff_pending = s.ip;
  cpu.sf = s.sf; cpu.pf = s.pf; cpu.hf = s.hf; cpu.zf = s.zf; cpu.cf = s.cf;
  for (let i = 0; i < 8; i++) cpu.regs[i] = s.regs[i];
  memory.mode_stack = s.ms; memory.mode_map = s.mm; memory.page_map = s.pm;
  memory.page_stack = s.ps; memory.cw = s.cw;
}
function grab() { const b = Buffer.alloc(0x6000); for (let i = 0; i < 0x6000; i++) b[i] = rd(0x8000 + i); return b; }
function hideGrab() {
  const s = snap();
  wr(L.setAttribProta, 0xC9); wr(L.updateMomiaAtr, 0xC9);
  for (let n = 0; n < HIDE; n++) { for (let sl = 0; sl < 21; sl++) wr(L.sprAttrib + 4 * sl, 0xE0); tick(); }
  const b = grab(); rest(s); return b;
}
function diff(TEST, REF) {
  let orphan = 0, hole = 0, other = 0; const list = [];
  for (let pl = 0; pl < 3; pl++)
    for (let col = 0; col < 32; col++)
      for (let lo = 72; lo <= 255; lo++) {
        const i = pl * 0x2000 + col * 256 + lo, t = TEST[i], r = REF[i];
        if (t === r) continue;
        if (t !== 0 && r === 0) orphan++; else if (t === 0 && r !== 0) hole++; else other++;
        if (list.length < 12) list.push(`p${pl} X=${col * 8} lo=${lo} T=${t.toString(2).padStart(8,"0")} R=${r.toString(2).padStart(8,"0")}`);
      }
  return { orphan, hole, other, list };
}

for (let i = 0; i < 40; i++) tick();
wr(L.vec_god, 1);
const MD = L.momiaDat;
wr(L.ProtaY, ROW); wr(L.ProtaX, 100); wr(L.protaStatus, 0);
wr(MD + 0, 0); wr(MD + 3, ROW); wr(MD + 5, 120); wr(MD + 6, rd(L.ProtaRoom));
wr(L.enemyAttrib, ROW); wr(L.enemyAttrib + 1, 120);
for (let t = 0; t < 20; t++) tick();
console.log(`ROM=${path.basename(ROM)} ROW=${ROW} X=${rd(L.ProtaX)} Y=${rd(L.ProtaY)} mX=${rd(L.enemyAttrib + 1)} vop=${rd(L.vop_i1)}`);
const REF = hideGrab();
{
  const c = diff(hideGrab(), REF);
  console.log(`контроль: orphan=${c.orphan} hole=${c.hole} other=${c.other}`);
  if (c.orphan + c.hole + c.other) { for (const x of c.list) console.log("  ", x); }
}
// прыжки через мумию: вправо-влево с прыжком, мумия ходит сама (АИ жив в основном прогоне)
let peak = 0, peakT = -1, peakD = null, samples = 0;
for (let t = 0; t < NT; t++) {
  const phase = t % 40;
  const dir = (Math.floor(t / 40) % 2) === 0 ? 39 : 37;
  if (phase === 0) { key(dir, 1); }
  if (phase === 6) key(32, 1);           // прыжок
  if (phase === 16) key(32, 0);
  if (phase === 38) key(dir, 0);
  tick();
  if (rd(L.ProtaY) > 0xE0) { /* упал за экран — вернуть */ wr(L.ProtaY, ROW); }
  const py = rd(L.ProtaY), my = rd(L.enemyAttrib);
  const adj = Math.abs(rd(L.ProtaX) - rd(L.enemyAttrib + 1)) <= 24;
  if (adj || rd(L.vop_i1)) {
    samples++;
    const d = diff(hideGrab(), REF);
    if (d.orphan + d.other > peak) {
      peak = d.orphan + d.other; peakT = t; peakD = d;
      console.log(`t=${t} orphan=${d.orphan} hole=${d.hole} other=${d.other} py=${py} my=${my} hX=${rd(L.ProtaX)} mX=${rd(L.enemyAttrib + 1)} vop=${rd(L.vop_i1)} st=${rd(L.protaStatus)}`);
      for (const sl of [4, 5, 6, 7]) {
        const p = 0xE0 + sl, b = a => rd(p * 256 + a);
        console.log(`  sl${sl} v=${b(0)} hdr=${b(1).toString(16)},${b(2).toString(16)},nc=${b(3)},hib=${b(4).toString(16)},hic=${b(5).toString(16)} out[p=${b(0x96)} ${b(0x97).toString(16)},${b(0x98).toString(16)},nc=${b(0x99)},b=${b(0x9F).toString(16)},c=${b(0x9B).toString(16)}] D4=${b(0xD4)} F5=${b(0xF5).toString(16)},${b(0xF6).toString(16)},${b(0xF7).toString(16)} zf=${b(0xD1)}`);
      }
      for (const x of d.list) console.log("   ", x);
      if (SHOTS) { pngFrom(idealBmp(), `docs/gem_stripe/topjump_t${t}.png`); }
    }
  }
}
console.log(`итого samples=${samples} ПИК orphan+other=${peak} @ t=${peakT}`);
if (peakD) for (const x of peakD.list) console.log("  ", x);
process.exit(peak > 0 ? 1 : 0);
