#!/usr/bin/env node
// parallel-only: same-dir сценарий без legacy-фазы (диагностика).
"use strict";
const path = require("path");
const { make } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NT = 600, ROW = 8;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (/^\d+$/.test(a)) NT = +a;
}
const PAR_SEG = 80, PAR_JUMPS = [5, 8, 12, 16], PAR_DIST = [0, 8, 16];
const E = make(ROM, SYM);
const { L, rd, v06c, memory, keyboard, cpu } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
const MD = L.momiaDat;

function tick(keys) {
  for (const c of keys || []) keyboard.keyDown({ keyCode: c, which: c, preventDefault() {}, stopPropagation() {} });
  const t0 = rd(L.timer);
  do v06c.oneInterrupt(true); while (rd(L.timer) === t0);
  for (const c of keys || []) keyboard.keyUp({ keyCode: c, which: c, preventDefault() {}, stopPropagation() {} });
}
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
function grab() {
  const b = Buffer.alloc(0x6000);
  for (let i = 0; i < 0x6000; i++) b[i] = rd(0x8000 + i);
  return b;
}
function park() {
  for (let sl = 0; sl < 21; sl++) wr(L.sprAttrib + 4 * sl, 0xE0);
  const t0 = rd(L.timer);
  do v06c.oneInterrupt(true); while (rd(L.timer) === t0);
}
function residue() {
  const s = snap();
  wr(L.setAttribProta, 0x0C9); wr(L.updateMomiaAtr, 0x0C9);
  for (let n = 0; n < 12; n++) park();
  const TEST = grab();
  for (let a = 0x8000; a < 0xE000; a++) wr(a, 0);
  cpu.sp = (cpu.sp - 2) & 0xffff; wr(cpu.sp, 0); wr(cpu.sp + 1, 0);
  cpu.pc = L.vec_nat_room;
  for (let i = 0; i < 40000000 && cpu.pc !== 0; i++) cpu.instruction();
  const ok = cpu.pc === 0;
  const REF = grab(); rest(s);
  if (!ok) throw new Error("vec_nat_room");
  let d = 0, clip = 0, list = [];
  for (let pl = 0; pl < 3; pl++)
    for (let col = 0; col < 32; col++)
      for (let lo = 72; lo <= 255; lo++) {
        const i = pl * 0x2000 + col * 256 + lo;
        if (TEST[i] !== REF[i]) {
          d++;
          if (lo >= 240) clip++;
          if (list.length < 8) list.push(`p${pl} X=${col * 8} lo=${lo}`);
        }
      }
  return { d, clip, list };
}
function yS(v) { return v >= 0xf0 ? v - 256 : v; }
function pairN() { let n = 0; for (const sl of [0,1,2,3,4,5,6,7]) if (rd(0xe000+sl*256+0xd2)) n++; return n; }

{
  let g = 0;
  while (rd(L.piramideActual) !== 1 && g++ < 20) {
    const cur = rd(L.piramideActual);
    wr(L.piramideDest, cur + 1); wr(L.subStatus, 0); wr(L.GameStatus, 8);
    let m = 0; while (m < 6000 && rd(L.piramideActual) === cur) { v06c.oneInterrupt(true); m++; }
  }
  let k = 0; while (k < 8000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); k++; }
}
for (let i = 0; i < 40; i++) tick([]);
wr(L.ProtaY, ROW); wr(L.ProtaX, 100); wr(MD+3, ROW); wr(MD+5, 100); wr(MD+6, rd(L.ProtaRoom));
wr(L.enemyAttrib, ROW); wr(L.enemyAttrib+1, 100);
for (let i = 0; i < 20; i++) tick([]);

console.log(`parallel-only ROM=${path.basename(ROM)} NT=${NT} ROW=${ROW}`);
let peak = 0, peakT = -1, contacts = 0;
let inJump = false, sawPair = false;

for (let t = 0; t < NT; t++) {
  const dir = (Math.floor(t / 160) % 2 === 0) ? 39 : 37;
  const dist = PAR_DIST[(Math.floor(t / PAR_SEG)) % 3];
  const rel = t % PAR_SEG;
  if (rd(L.enemyAttrib) < 0xd0 && Math.abs(yS(rd(L.enemyAttrib)) - ROW) > 16) { wr(L.enemyAttrib, ROW); wr(MD+3, ROW); }
  if (yS(rd(L.ProtaY)) > ROW + 40) wr(L.ProtaY, ROW);
  const hx = rd(L.ProtaX);
  const mx = dir === 39 ? (hx + dist) & 255 : (hx - dist) & 255;
  wr(L.enemyAttrib+1, mx); wr(MD+5, mx);
  tick(PAR_JUMPS.includes(rel) ? [dir, 32] : [dir]);
  const st = rd(L.protaStatus), py = yS(rd(L.ProtaY)), pf = pairN();
  const adjacent = Math.abs(hx - mx) <= 16;
  if (st === 1) { inJump = true; if (pf) sawPair = true; }
  if (inJump && st !== 1) {
    if (sawPair && adjacent && Math.abs(py - ROW) <= 24) {
      contacts++;
      const r = residue();
      console.log(`t=${t} abs=${r.d} clip=${r.clip} dist=${Math.abs(hx-mx)} ${r.list.join(" ")}`);
      if (r.d > peak) { peak = r.d; peakT = t; }
    }
    inJump = false; sawPair = false;
  }
}
console.log(`contacts=${contacts} peak=${peak} @ t=${peakT}`);
process.exit(peak > 0 ? 1 : 0);
