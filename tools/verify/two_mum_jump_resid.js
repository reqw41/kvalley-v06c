#!/usr/bin/env node
// Жалоба: прыжок через ДВЕ мумии, идущие одна за другой — остаётся спрайт героя.
// Две мумии на одной строке, шаг 12 px (сейвы пересекаются). Герой перепрыгивает.
// Метрика: живой остаток вне габаритов + park-остаток (персистентный силуэт).
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const ROM = process.argv[2] || path.join(REPO, "build/kvalley_8c.rom");
const SYM = process.argv[3] || path.join(REPO, "build/kvalley_8c.sym");
const E = make(ROM, SYM);
const { L, rd, v06c, memory, cpu } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);

function tick(keys) {
  const held = new Set(keys || []);
  for (const c of [37, 39, 32]) held.has(c) ? E.key(c, 1) : E.key(c, 0);
  const t0 = rd(L.timer);
  do v06c.oneInterrupt(true); while (rd(L.timer) === t0);
}
function snap() {
  return { m: memory.bytes.slice(), sp: cpu.sp, pc: cpu.pc, regs: cpu.regs.slice(),
    iff: cpu.iff, ip: cpu.iff_pending, sf: cpu.sf, pf: cpu.pf, hf: cpu.hf,
    zf: cpu.zf, cf: cpu.cf };
}
function rest(s) {
  memory.bytes.set(s.m); cpu.sp = s.sp; cpu.pc = s.pc; cpu.iff = s.iff;
  cpu.iff_pending = s.ip; cpu.sf = s.sf; cpu.pf = s.pf; cpu.hf = s.hf;
  cpu.zf = s.zf; cpu.cf = s.cf;
  for (let i = 0; i < s.regs.length; i++) cpu.regs[i] = s.regs[i];
}
function grab() {
  const b = new Uint8Array(0x6000);
  for (let a = 0x8000; a < 0xE000; a++) b[a - 0x8000] = rd(a);
  return b;
}
function slotDump(idx) {
  const P = 0xE000 + idx * 256;
  const b = (o) => rd(P + o);
  return `sl${idx} v=${b(0)} hdr=${b(1).toString(16)},${b(2)},nc=${b(3)}` +
    ` out[p=${b(0x96)} ${b(0x97).toString(16)},${b(0x98)},nc=${b(0x99)}]`;
}
function pairSlots() {
  const n = rd(L.vsp_n), at = rd(L.vpr_at);
  if (at === 0xFF || at + 1 >= n) return { a: -1, b: -1 };
  const ord = L.vso_ord;
  return { a: rd(ord + at), b: rd(ord + at + 1), at, n };
}
function liveResidue() {
  const s = snap();
  const cov = new Uint8Array(0x6000);
  const paint = (hi, lo, nc) => {
    if (!hi || !nc) return;
    for (let c = -1; c <= nc; c++) {
      const h = hi + c; if (h < 0x80 || h >= 0xE0) continue;
      for (let r = 0; r < 16; r++) cov[((h << 8) | ((lo + r) & 0xFF)) - 0x8000] = 1;
    }
  };
  for (let idx = 0; idx < 21; idx++) {
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
  const LIVE = grab();
  for (let a = 0x8000; a < 0xE000; a++) wr(a, 0);
  cpu.sp = (cpu.sp - 2) & 0xffff; wr(cpu.sp, 0); wr(cpu.sp + 1, 0); cpu.pc = L.vec_nat_room;
  for (let i = 0; i < 40000000 && cpu.pc !== 0; i++) cpu.instruction();
  const REF = grab(); rest(s);
  let n = 0; const list = [];
  for (let pl = 0; pl < 3; pl++) for (let col = 0; col < 32; col++) for (let lo = 64; lo <= 255; lo++) {
    const i = pl * 0x2000 + col * 256 + lo;
    if (cov[i]) continue;
    if (LIVE[i] && !REF[i]) {
      n++;
      if (list.length < 10)
        list.push(`p${pl} X=${col * 8} стр=${lo} экран=${LIVE[i].toString(2).padStart(8, "0")}`);
    }
  }
  return { n, list };
}

if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
for (let i = 0; i < 40; i++) tick([]);
if (L.vec_god) wr(L.vec_god, 1);
wr(L.updateMomiaAtr, 0xC9);

const HY = +(process.env.HY || 8);
const GAP = +(process.env.GAP || 8);
wr(L.ProtaY, HY); wr(L.ProtaX, 210); wr(L.protaStatus, 0);
const MD = L.momiaDat, STEP = 22;
for (let m = 0; m < 4; m++) {
  const p = MD + m * STEP;
  wr(p + 0, 4); wr(p + 3, 0xE0);
}
for (let sl = 6; sl <= 13; sl++) wr(L.sprAttrib + 4 * sl, 0xE0);

const room = rd(L.ProtaRoom);
for (let m = 0; m < 2; m++) {
  const x = 150 + m * GAP;
  const p = MD + m * STEP;
  wr(p + 0, 0); wr(p + 3, HY); wr(p + 5, x); wr(p + 6, room);
  wr(p + 0x14, m ? 1 : 4);
  const a = L.sprAttrib + 4 * (6 + m);
  wr(a, HY); wr(a + 1, x); wr(a + 2, 0x28); wr(a + 3, m ? 0x09 : 0x0A);
}
for (let i = 0; i < 8; i++) tick([]);

console.log(`ROM=${path.basename(ROM)} HY=${HY} GAP=${GAP} hX=${rd(L.ProtaX)} ` +
  `m6=${rd(L.sprAttrib + 24)}/${rd(L.sprAttrib + 25)} pat=${rd(L.sprAttrib + 26).toString(16)} ` +
  `m7=${rd(L.sprAttrib + 28)}/${rd(L.sprAttrib + 29)} pat=${rd(L.sprAttrib + 30).toString(16)}`);

let peak = 0, peakT = -1, peakList = null, peakInfo = "";
let met = -1, jumps = 0, inJump = false, contacts = 0;
const steal = [];
for (let t = 0; t < 120; t++) {
  for (let m = 0; m < 2; m++) {
    const a = L.sprAttrib + 4 * (6 + m);
    const mx = rd(a + 1);
    if (mx < 250) wr(a + 1, mx + 1);
    wr(a, HY);
    wr(a + 2, 0x28);
  }
  const keys = [37];
  if (t % 12 === +(process.env.JP || 4)) keys.push(32);
  tick(keys);
  if (rd(L.ProtaY) > 0xE0 || (rd(L.ProtaY) > HY + 40 && rd(L.ProtaY) < 0xC0)) wr(L.ProtaY, HY);
  const hx = rd(L.ProtaX);
  const st = rd(L.protaStatus);
  if (st === 1) { if (!inJump) jumps++; inJump = true; }
  else inJump = false;
  const mx0 = rd(L.sprAttrib + 25), mx1 = rd(L.sprAttrib + 29);
  const near = Math.min(Math.abs(hx - mx0), Math.abs(hx - mx1)) <= 24;
  if (near && st === 1 && met < 0) met = t;
  if (near) contacts++;
  const ps = pairSlots();
  if (ps.a >= 0 && (ps.a !== 4 || ps.b !== 5) && steal.length < 6)
    steal.push(`t=${t} pair=sl${ps.a}+sl${ps.b} at=${ps.at} n=${ps.n} sl=${rd(L.vpr_sl)} fast=${rd(L.vsp_fast)}`);
  if (met >= 0 && t >= met && (t - met) % 5 === 0) {
    const r = liveResidue();
    if (r.n > peak) {
      peak = r.n; peakT = t; peakList = r.list;
      peakInfo = `st=${st} sl=${rd(L.vpr_sl)} fast=${rd(L.vsp_fast)} mix=${rd(L.vpr_mix)} ` +
        `at=${rd(L.vpr_at)} pair=sl${ps.a}+sl${ps.b} hX=${hx} mX=${mx0},${mx1}\n  ` +
        [4, 5, 6, 7].map(slotDump).join("\n  ");
    }
  }
}

console.log(`прыжков ${jumps}, контактов ${contacts}, встретились t=${met}`);
if (steal.length) {
  console.log("vpr_scan украл пару (не слоты 4+5):");
  steal.forEach((x) => console.log("  " + x));
}
console.log(`живой след: пик ${peak} Б @ t=${peakT}`);
if (peakInfo) console.log("  " + peakInfo);
(peakList || []).forEach((x) => console.log("   " + x));
if (met < 0 || jumps < 2) {
  console.log("СЦЕНА НЕ ВОСПРОИЗВЕЛАСЬ");
  process.exit(2);
}
if (peak) {
  console.log("ВЕРДИКТ: ПРОВАЛ — после прыжка через две мумии остаётся след");
  process.exit(1);
}
console.log("ВЕРДИКТ: OK — следа нет");
process.exit(0);
