#!/usr/bin/env node
// mumjump_probe.js — репро «мумия прыгает через стоящего/идущего героя».
// Классифицирует остаток: orphan (TEST≠0,REF=0) vs hole (TEST=0,REF≠0).
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NT = 800, ROW = 8;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--row") ROW = +args[++i];
  else if (/^\d+$/.test(a)) NT = +a;
}
const E = make(ROM, SYM);
const { L, rd, v06c, memory, keyboard, cpu } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
for (const s of ["setAttribProta", "updateMomiaAtr", "vec_nat_room", "sprAttrib",
                 "enemyAttrib", "ProtaY", "ProtaX", "protaStatus", "GameStatus",
                 "piramideActual", "timer", "momiaDat", "ProtaRoom", "valoresSalto",
                 "vec_god"]) {
  if (L[s] == null) { console.log("нет символа", s); process.exit(2); }
}
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
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
function classify() {
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
  let orphan = 0, hole = 0, other = 0, clipOrphan = 0;
  const list = [];
  for (let pl = 0; pl < 3; pl++)
    for (let col = 0; col < 32; col++)
      for (let lo = 72; lo <= 255; lo++) {
        const i = pl * 0x2000 + col * 256 + lo;
        const t = TEST[i], r = REF[i];
        if (t === r) continue;
        if (t !== 0 && r === 0) { orphan++; if (lo >= 240) clipOrphan++; }
        else if (t === 0 && r !== 0) hole++;
        else other++;
        if (list.length < 10) list.push(`p${pl} X=${col * 8} lo=${lo} T=${t} R=${r}`);
      }
  return { orphan, hole, other, clipOrphan, list, d: orphan + hole + other, TEST, REF };
}
function yS(v) { return v >= 0xf0 ? v - 256 : v; }
function pairN() {
  let n = 0;
  for (const sl of [0, 1, 2, 3, 4, 5, 6, 7]) if (rd(0xe000 + sl * 256 + 0xd2)) n++;
  return n;
}
function forceMumJump(dir) {
  // Salta: status=1, clear A-bit in control, frame=2, JMP_P=valoresSalto, JUMPSENT=0
  wr(MD + 0, 1);
  wr(MD + 1, (rd(MD + 1) & ~0x10) | (dir & 0x0c));
  wr(MD + 2, dir === 8 ? 2 : 1);
  wr(MD + 0x0b, 2);
  const vs = L.valoresSalto;
  wr(MD + 0x0c, vs & 255);
  wr(MD + 0x0d, (vs >> 8) & 255);
  wr(MD + 0x0e, 0);
}

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
wr(L.vec_god, 1); // бессмертие: контакт не уводит в GS=6 (иначе ложный пик classify)
wr(L.ProtaY, ROW); wr(L.ProtaX, 100); wr(L.protaStatus, 0);
wr(MD + 0, 0); wr(MD + 3, ROW); wr(MD + 5, 80); wr(MD + 6, rd(L.ProtaRoom));
wr(L.enemyAttrib, ROW); wr(L.enemyAttrib + 1, 80);
for (let i = 0; i < 20; i++) tick([]);

console.log(`ROM=${path.basename(ROM)} ROW=${ROW} NT=${NT} X=${rd(L.ProtaX)} mX=${rd(L.enemyAttrib + 1)}`);
{
  const ctl = classify();
  console.log(`контроль: d=${ctl.d} orphan=${ctl.orphan} hole=${ctl.hole}`);
  if (ctl.d) { console.log("контроль не ноль", ctl.list); process.exit(3); }
}

let peakOrphan = 0, peakHole = 0, peakT = -1, peakList = null;
let mumJumps = 0, contacts = 0, samples = 0;
let inMumJump = false, sawPair = false, sawCross = false;
let heroWalk = false;
let lastMumSt = rd(MD);

for (let t = 0; t < NT; t++) {
  // держим ряд; мумию подводим к герою и периодически форсим прыжок
  if (rd(L.enemyAttrib) < 0xd0 && Math.abs(yS(rd(L.enemyAttrib)) - ROW) > 20) {
    wr(L.enemyAttrib, ROW); wr(MD + 3, ROW);
  }
  if (yS(rd(L.ProtaY)) > ROW + 40) wr(L.ProtaY, ROW);
  wr(L.protaStatus, 0); // герой не прыгает — стоит/идёт

  const hx = rd(L.ProtaX);
  const phase = t % 120;
  // фаза: подойти справа/слева, форс-прыжок, герой стоит или идёт
  heroWalk = (Math.floor(t / 240) % 2) === 1;
  const fromRight = (Math.floor(t / 120) % 2) === 0;
  const approachX = fromRight ? (hx + 20 - Math.min(phase, 20)) & 255
                              : (hx - 20 + Math.min(phase, 20)) & 255;
  if (rd(MD) !== 1) {
    wr(L.enemyAttrib + 1, approachX); wr(MD + 5, approachX);
    wr(MD + 2, fromRight ? 1 : 2); // sentido
    wr(MD + 1, fromRight ? 4 : 8); // control left/right
  }
  if (phase === 25 && rd(MD) !== 1) {
    forceMumJump(fromRight ? 4 : 8);
  }

  const keys = heroWalk ? (t % 100 < 50 ? [39] : [37]) : [];
  tick(keys);

  const mst = rd(MD);
  const py = yS(rd(L.ProtaY)), my = yS(rd(L.enemyAttrib));
  const mx = rd(L.enemyAttrib + 1);
  const pf = pairN();
  const adj = Math.abs(rd(L.ProtaX) - mx) <= 24;

  if (mst === 1) {
    if (!inMumJump) { inMumJump = true; sawPair = false; sawCross = false; mumJumps++; }
    if (pf) sawPair = true;
    if (adj && Math.abs(my - py) > 4) sawCross = true;
    if (adj || pf) {
      contacts++;
      samples++;
      const r = classify();
      if (r.orphan > peakOrphan) {
        peakOrphan = r.orphan; peakHole = r.hole; peakT = t; peakList = r;
        console.log(`t=${t} orphan=${r.orphan} hole=${r.hole} other=${r.other} clipO=${r.clipOrphan} ` +
          `pair=${pf} cross=${sawCross} adj=${adj} py=${py} my=${my} hx=${rd(L.ProtaX)} mx=${mx} st=${mst}`);
        for (const x of r.list) console.log("  ", x);
      }
    }
  } else if (inMumJump) {
    // landing sample
    if (sawPair || sawCross || adj) {
      samples++;
      const r = classify();
      if (r.orphan > peakOrphan) {
        peakOrphan = r.orphan; peakHole = r.hole; peakT = t; peakList = r;
        console.log(`LAND t=${t} orphan=${r.orphan} hole=${r.hole} clipO=${r.clipOrphan} py=${py} my=${my}`);
        for (const x of r.list) console.log("  ", x);
      }
    }
    inMumJump = false;
  }
  lastMumSt = mst;
}

console.log(`итого: mumJumps=${mumJumps} contacts=${contacts} samples=${samples}`);
console.log(`ПИК orphan=${peakOrphan} hole=${peakHole} @ t=${peakT}`);
if (peakList) for (const x of peakList.list) console.log("  ", x);
process.exit(peakOrphan > 0 ? 1 : 0);
