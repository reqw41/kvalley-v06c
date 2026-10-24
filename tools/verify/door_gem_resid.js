// Жалоба с железа: все сокровища собраны, идёшь вправо у ворот — мусор и следы мумий.
// Skip LAST решается в подготовке, drawPuerta блитует клетки ПОСЛЕ. Пачка со skip
// пишет слот-maze на новые тайлы. Стенд: последняя гема, герой и мумия у выхода,
// ходьба вправо, живой остаток вне габаритов (как mummy_contact_probe).
"use strict";
const { make, toGame } = require("./beam_harness.js");
const ROM = process.argv[2] || "build/kvalley_8c.rom";
const SYM = process.argv[3] || "build/kvalley_8c.sym";
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory } = E;
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
      if (list.length < 8)
        list.push(`p${pl} X=${col * 8} стр=${lo} экран=${LIVE[i].toString(2).padStart(8, "0")}`);
    }
  }
  return { n, list };
}

if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
for (let i = 0; i < 20; i++) tick([]);
if (L.vec_god) wr(L.vec_god, 1);
wr(L.controlPlayer, rd(L.controlPlayer) | 0x40);

const pira = rd(L.piramideActual);
let door = -1, dd = null;
for (let d = 0; d < 4; d++) {
  const b = [];
  for (let i = 0; i < 7; i++) b.push(rd(L.pyramidDoors + d * 7 + i));
  if (b[0] !== 0xFF && b[5] !== 0 && b[5] !== pira && door < 0) { door = d; dd = b; }
}
if (door < 0) { console.log("FAIL нет выходной двери"); process.exit(2); }

const dY = dd[0], dX = dd[2], dRoom = dd[3];
wr(L.ProtaRoom, dRoom);
wr(L.ProtaY, dY);
wr(L.ProtaX, (dX - 40) & 255);
wr(L.ProtaXdecimal, 0);
wr(L.protaStatus, 0);

const MD = L.momiaDat, STEP = 22;
for (let m = 0; m < 4; m++) {
  const p = MD + m * STEP;
  wr(p, 4); wr(p + 3, 0xE0);
}
for (let sl = 6; sl <= 13; sl++) wr(L.sprAttrib + 4 * sl, 0xE0);
const mx = (dX - 16) & 255;
wr(MD, 0); wr(MD + 3, dY); wr(MD + 5, mx); wr(MD + 6, dRoom);
wr(L.sprAttrib + 24, dY); wr(L.sprAttrib + 25, mx);
wr(L.sprAttrib + 26, 0x28); wr(L.sprAttrib + 27, 0x0A);

for (let i = 0; i < 6; i++) tick([]);
wr(L.gemasCogidas, rd(L.gemasTotales));

const dsk = L.vso_fix;
let dirtySkip = 0, packs = 0, skips = 0, lasts = 0, clearT = -1;
v06c.check_breakpoint = function () {
  if (cpu.pc !== dsk) return false;
  packs++;
  if (rd(L.vcm_sk)) skips++;
  if (rd(L.vpr_sl) === 2) lasts++;
  if (rd(L.vfl_dany) && rd(L.vcm_sk)) dirtySkip++;
  return false;
};

let peak = 0, peakT = -1, peakList = null;
for (let t = 0; t < 90; t++) {
  tick([39]);
  if (rd(L.flagStageClear) && clearT < 0) clearT = t;
  const st = rd(L.pyramidDoors + door * 7 + 4);
  if (clearT >= 0 && (t - clearT) % 8 === 0) {
    const r = liveResidue();
    if (r.n > peak) { peak = r.n; peakT = t; peakList = r.list; }
  }
  if ((st & 0xF0) >= 0x40 && t > clearT + 8) break;
}

console.log(`пир=${pira} дверь ${door} Y=${dY} X=${dX} комн=${dRoom} clear@${clearT} ` +
  `st=${rd(L.pyramidDoors + door * 7 + 4).toString(16)} ` +
  `hX=${rd(L.ProtaX)} packs=${packs} skip=${skips} last=${lasts} dirtySkip=${dirtySkip}`);
console.log(`живой след: пик ${peak} Б @ t=${peakT}`);
(peakList || []).forEach((x) => console.log("   " + x));
if (clearT < 0) { console.log("FAIL сцена не собрала гемы"); process.exit(2); }
if ((rd(L.pyramidDoors + door * 7 + 4) & 0xF0) < 0x20) {
  console.log("FAIL дверь не нарисовалась"); process.exit(2);
}
if (packs < 10) { console.log("FAIL пачка не звалась"); process.exit(2); }
if (peak) { console.log("ВЕРДИКТ: ПРОВАЛ — у ворот остаётся мусор"); process.exit(1); }
console.log("ВЕРДИКТ: OK — у ворот после всех гемов следа нет");
process.exit(0);
