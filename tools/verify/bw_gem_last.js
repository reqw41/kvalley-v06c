// bw_gem_last: ПОСЛЕДНИЙ гем берётся по-настоящему (герой наступает на него), затем stage clear.
// Жалоба владельца 2026-10-15: серый след героя после последнего гема. Остаток вне габаритов — как door_gem_resid.
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
const GEM=+process.env.GEM||0, DX=+process.env.DX||0, DY=+process.env.DY||0, N=+process.env.N||120;
const G = L.datosGemas + GEM * 9;
const gY = rd(G + 2), gX = rd(G + 4), gRoom = rd(G + 5);
// остальные гемы считаем собранными; берём ровно один, последний
wr(L.gemasCogidas, rd(L.gemasTotales) - 1);
wr(L.ProtaRoom, gRoom); wr(L.ProtaY, (gY + DY) & 255); wr(L.ProtaX, (gX + DX) & 255);
wr(L.ProtaXdecimal, 0); wr(L.protaStatus, 0);
for (let m = 0; m < 4; m++) { const p = L.momiaDat + m * 22; wr(p, 4); wr(p + 3, 0xE0); }
for (let sl = 6; sl <= 13; sl++) wr(L.sprAttrib + 4 * sl, 0xE0);
let haz = 0, gates = 0;
v06c.check_breakpoint = function () {
  if (cpu.pc === L.vfr_gate) { gates++; if (rd(L.vsp_rdy) === 0 && rd(L.vfr_need) && rd(L.vsp_n) > 0) haz++; }
  return false;
};
let peak = 0, peakT = -1, list = null, taken = -1, clearT = -1, series = [];
for (let t = 0; t < N; t++) {
  tick(process.env.WALK?[39]:[]);
  if (taken < 0 && rd(L.gemasCogidas) >= rd(L.gemasTotales)) taken = t;
  if (rd(L.flagStageClear) && clearT < 0) clearT = t;
  if (taken >= 0) {
    const r = liveResidue(); series.push(r.n);
    if (r.n > peak) { peak = r.n; peakT = t; list = r.list; }
  }
}
console.log(`repair_in_pack=${haz} gates=${gates}`);
console.log(`gem ${GEM} Y=${gY} X=${gX} room=${gRoom} dx=${DX} dy=${DY} taken@${taken} clear@${clearT} peak=${peak}@${peakT} series=${series.slice(0,30).join(",")}`);
(list || []).forEach((x) => console.log("   " + x));
process.exit(taken < 0 ? 2 : peak ? 1 : 0);
