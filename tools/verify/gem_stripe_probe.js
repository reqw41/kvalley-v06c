#!/usr/bin/env node
// gem_stripe_probe.js — репро «полоска мусора после сбора гема, едет с героем по X».
// Метод: REF = fb сразу после сбора+hide(1-2 тика); TEST = fb после ходьбы+hide.
// НЕ использовать vec_nat_room как эталон (перерисует гем с карты) и не 12 hide-тиков.
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let WALK = 40, HIDE = 2;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--walk") WALK = +args[++i];
  else if (a === "--hide") HIDE = +args[++i];
}
const E = make(ROM, SYM);
const { L, rd, v06c, memory, keyboard, cpu } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }

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
function hideGrab() {
  const s = snap();
  for (let n = 0; n < HIDE; n++) {
    for (let sl = 0; sl < 21; sl++) wr(L.sprAttrib + 4 * sl, 0xE0);
    tick([]);
  }
  const b = grab();
  rest(s);
  return b;
}

for (let i = 0; i < 40; i++) tick([]);
wr(L.vec_god, 1);

// гем 2 комнаты 0 — штатное место в нише (X 12-20, герою некуда идти), поэтому
// переносим ГЕМ к герою на простор: механика сбора/стирания/fixup та же, а после
// сбора есть куда ходить. Старая картинка гема остаётся в fb — одинакова в REF и
// TEST, diff её не видит.
const room = rd(L.ProtaRoom);
const gi = 2;
const GB = L.datosGemas + 9 * gi;
const hY = rd(L.ProtaY), hX = rd(L.ProtaX);
wr(GB + 2, hY); wr(GB + 4, hX);
const gY = rd(GB + 2), gX = rd(GB + 4);
console.log(`ROM=${path.basename(ROM)} room=${room} gem#${gi} перенесён на героя Y=${gY} X=${gX} walk=${WALK} hide=${HIDE}`);
wr(L.protaStatus, 0); wr(L.itmGSkip, 0); wr(L.itmGShOk, 0); // тень itmGate недействительна, иначе гейт снимет chkCogeGema (герой не двигался)

// мумия вплотную (перекрытие -> vop_i1=6, как на железе в кадр сбора)
const MD = L.momiaDat;
wr(MD + 0, 0); wr(MD + 3, hY); wr(MD + 5, (hX + 8) & 255); wr(MD + 6, rd(L.ProtaRoom));
wr(L.enemyAttrib, hY); wr(L.enemyAttrib + 1, (hX + 8) & 255);
let picked = -1;
for (let t = 0; t < 30; t++) {
  tick([]);
  const st = rd(GB + 1);
  if (st === 2 && picked < 0) {
    picked = t;
    console.log(`t=${t} сбор: status=2 vop_i1=${rd(L.vop_i1)} heroX=${rd(L.ProtaX)} heroY=${rd(L.ProtaY)}`);
  }
  if (st === 3) { console.log(`t=${t} стёрт: status=3 vop_i1=${rd(L.vop_i1)}`); break; }
}
if (rd(GB + 1) !== 3) { console.log("гем не собрался, status=", rd(GB + 1)); process.exit(2); }
tick([]); tick([]); // дать блеску/анимации сбора отработать пару тиков

const REF = hideGrab();

// идти вправо (клавишу держим, не тыкаем)
keyboard.keyDown({ keyCode: 39, which: 39, preventDefault() {}, stopPropagation() {} });
for (let t = 0; t < WALK; t++) tick([]);
keyboard.keyUp({ keyCode: 39, which: 39, preventDefault() {}, stopPropagation() {} });
tick([]);
console.log(`после ходьбы heroX=${rd(L.ProtaX)} heroY=${rd(L.ProtaY)}`);
const TEST = hideGrab();

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
      if (list.length < 30) list.push(`p${pl} X=${col * 8} lo=${lo} T=${t.toString(2).padStart(8,"0")} R=${r.toString(2).padStart(8,"0")}`);
    }
console.log(`diff: orphan=${orphan} hole=${hole} other=${other}`);
for (const x of list) console.log("  ", x);
process.exit(orphan + other > 0 ? 1 : 0);
