#!/usr/bin/env node
// overlap_walk_probe.js — репро «полоска/шлейф при vop_i1=6 (перекрытие мумии, ходьба)».
// ЧИСТЫЙ hide: setAttribProta/updateMomiaAtr заглушены (0xC9) внутри снапа, как в
// classify() mumjump_probe. REF и TEST снимаются ОДНИМ методом; diff = устойчивый мусор.
// --gem: перенести гем 2 на героя и собрать перед ходьбой (репро «полоска после гема»).
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let WALK = 16, HIDE = 3, GEM = false, TRACE = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--walk") WALK = +args[++i];
  else if (a === "--hide") HIDE = +args[++i];
  else if (a === "--gem") GEM = true;
  else if (a === "--trace") TRACE = true;
}
const E = make(ROM, SYM);
const { L, rd, v06c, memory, keyboard, cpu } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }

function tick() {
  const t0 = rd(L.timer);
  do v06c.oneInterrupt(true); while (rd(L.timer) === t0);
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
function hideGrab() {
  const s = snap();
  wr(L.setAttribProta, 0xC9); wr(L.updateMomiaAtr, 0xC9); // АИ молчит — парковка честная
  for (let n = 0; n < HIDE; n++) {
    for (let sl = 0; sl < 21; sl++) wr(L.sprAttrib + 4 * sl, 0xE0);
    tick();
  }
  const b = grab();
  rest(s);
  return b;
}
function diff(TEST, REF, lim) {
  let orphan = 0, hole = 0, other = 0;
  const list = [];
  for (let pl = 0; pl < 3; pl++)
    for (let col = 0; col < 32; col++)
      for (let lo = 72; lo <= 255; lo++) {
        const i = pl * 0x2000 + col * 256 + lo;
        const t = TEST[i], r = REF[i];
        if (t === r) continue;
        if (t !== 0 && r === 0) orphan++;
        else if (t === 0 && r !== 0) hole++;
        else other++;
        if (list.length < (lim || 12)) list.push(`p${pl} X=${col * 8} lo=${lo} T=${t.toString(2).padStart(8,"0")} R=${r.toString(2).padStart(8,"0")}`);
      }
  return { orphan, hole, other, list };
}

for (let i = 0; i < 40; i++) tick();
wr(L.vec_god, 1);
const hY = rd(L.ProtaY), hX = rd(L.ProtaX);
const MD = L.momiaDat;
wr(MD + 0, 0); wr(MD + 3, hY); wr(MD + 5, (hX + 8) & 255); wr(MD + 6, rd(L.ProtaRoom));
wr(L.enemyAttrib, hY); wr(L.enemyAttrib + 1, (hX + 8) & 255);
if (GEM) {
  const GB = L.datosGemas + 9 * 2;
  wr(GB + 2, hY); wr(GB + 4, hX);
  wr(L.itmGSkip, 0); wr(L.itmGShOk, 0);
  for (let t = 0; t < 10 && rd(GB + 1) !== 3; t++) tick();
  console.log(`гем: status=${rd(L.datosGemas + 9 * 2 + 1)} vop=${rd(L.vop_i1)}`);
}
for (let t = 0; t < 6; t++) tick();
console.log(`ROM=${path.basename(ROM)} gem=${GEM} walk=${WALK} hide=${HIDE} X=${rd(L.ProtaX)} mX=${rd(L.enemyAttrib + 1)} vop=${rd(L.vop_i1)}`);
const REF = hideGrab();
{
  const c = diff(hideGrab(), REF, 4);
  console.log(`контроль (повторный hide, без движения): orphan=${c.orphan} hole=${c.hole} other=${c.other}`);
}
keyboard.keyDown({ keyCode: 39, which: 39, preventDefault() {}, stopPropagation() {} });
let peak = 0, peakT = -1, peakD = null;
for (let t = 0; t < WALK; t++) {
  tick();
  if (TRACE || t === WALK - 1) {
    const d = diff(hideGrab(), REF);
    if (TRACE) console.log(`t=${t} X=${rd(L.ProtaX)} mX=${rd(L.enemyAttrib + 1)} vop=${rd(L.vop_i1)} orphan=${d.orphan} hole=${d.hole} other=${d.other}`);
    if (d.orphan + d.other > peak) { peak = d.orphan + d.other; peakT = t; peakD = d; }
  }
}
keyboard.keyUp({ keyCode: 39, which: 39, preventDefault() {}, stopPropagation() {} });
console.log(`ПИК orphan+other=${peak} @ t=${peakT}`);
if (peakD) for (const x of peakD.list) console.log("  ", x);
process.exit(peak > 0 ? 1 : 0);
