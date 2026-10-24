#!/usr/bin/env node
// topjump_live_probe.js — ЖИВОЙ детектор мусора при перепрыгивании мумии на верхней
// строке (жалоба 2026-08-18: «точка от зелёной мумии проскакивает, редко, god-mode»).
// Без hide-стенда: после каждого тика лишние биты = fb & ~фон & ~прямоугольники живых
// слотов. Первый ненуль -> лог, повтор тика с watchpoint по адресу.
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NT = 400, ROW = 8, M2 = false, TIGHT = false, LO0 = 200;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--row") ROW = +args[++i];
  else if (a === "--m2") M2 = true;     // вторая мумия (слот 7, p1 = зелёная)
  else if (a === "--tight") TIGHT = true;
  else if (a === "--all") LO0 = 40;
  else if (/^\d+$/.test(a)) NT = +a;
}
const E = make(ROM, SYM);
const { L, rd, v06c, memory, keyboard, cpu } = E;
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
function grabP(base) { const b = Buffer.alloc(0x2000); for (let i = 0; i < 0x2000; i++) b[i] = rd(base + i); return b; }
function hideBG() { // фон: hide 12 тиков с заглушенным АИ
  const s = snap();
  wr(L.setAttribProta, 0xC9); wr(L.updateMomiaAtr, 0xC9);
  for (let n = 0; n < 12; n++) { for (let sl = 0; sl < 21; sl++) wr(L.sprAttrib + 4 * sl, 0xE0); tick(); }
  const bg = [grabP(0x8000), grabP(0xA000), grabP(0xC000)];
  rest(s); return bg;
}
// прямоугольники живых слотов: по ЗАПИСИ вывода и ШАПКЕ (обе, ±1 столбец/±2 строки запас)
function rects() {
  const rs = [];
  for (let sl = 0; sl < 21; sl++) {
    const p = 0xE000 + sl * 256;
    for (const [hiO, loO, ncO] of [[1, 2, 3], [0x97, 0x98, 0x99]]) {
      const hi = rd(p + hiO), lo = rd(p + loO), nc = rd(p + ncO);
      if (!nc || nc > 4 || hi < 0x80) continue;
      if (TIGHT) rs.push({ c0: hi & 0x1F, c1: (hi & 0x1F) + nc - 1, lo0: lo, lo1: lo + 23 });
      else rs.push({ c0: (hi & 0x1F) - 1, c1: (hi & 0x1F) + nc, lo0: lo - 2, lo1: lo + 26 });
    }
  }
  return rs;
}
function inRects(rs, col, lo) {
  for (const r of rs) if (col >= r.c0 && col <= r.c1 && ((lo - r.lo0) & 255) <= ((r.lo1 - r.lo0) & 255)) return true;
  return false;
}
for (let i = 0; i < 40; i++) tick();
wr(L.vec_god, 1);
const MD = L.momiaDat + (M2 ? 22 : 0);
const EA = L.enemyAttrib + (M2 ? 4 : 0);
wr(L.ProtaY, ROW); wr(L.ProtaX, 100); wr(L.protaStatus, 0);
wr(MD + 0, 0); wr(MD + 3, ROW); wr(MD + 5, 120); wr(MD + 6, rd(L.ProtaRoom));
wr(EA, ROW); wr(EA + 1, 120);
if (M2) { wr(L.momiaDat + 0, 4); wr(L.enemyAttrib, 0xE0); } // первую в лимбо
for (let t = 0; t < 20; t++) tick();
console.log(`ROM=${path.basename(ROM)} ROW=${ROW} NT=${NT} m2=${M2} tight=${TIGHT} EA_Y=${rd(EA)} EA_X=${rd(EA + 1)}`);
const BG = hideBG();
let found = 0;
for (let t = 0; t < NT; t++) {
  const phase = t % 40;
  const dir = (Math.floor(t / 40) % 2) === 0 ? 39 : 37;
  if (phase === 0) key(dir, 1);
  if (phase === 6) key(32, 1);
  if (phase === 16) key(32, 0);
  if (phase === 38) key(dir, 0);
  tick();
  if (rd(L.ProtaY) > 0xE0) wr(L.ProtaY, ROW);
  const rs = rects();
  const lines = [];
  for (let pl = 0; pl < 3; pl++) {
    const base = [0x8000, 0xA000, 0xC000][pl], bg = BG[pl];
    for (let col = 0; col < 32; col++)
      for (let lo = LO0; lo <= 255; lo++) {
        const v = rd(base + col * 256 + lo) & ~bg[col * 256 + lo] & 0xFF;
        if (!v) continue;
        if (inRects(rs, col, lo)) continue;
        lines.push(`p${pl} col=${col} lo=${lo} v=${v.toString(2).padStart(8, "0")}`);
      }
  }
  if (lines.length) {
    found++;
    console.log(`t=${t} py=${rd(L.ProtaY)} my=${rd(EA)} hX=${rd(L.ProtaX)} mX=${rd(EA + 1)} vop=${rd(L.vop_i1)} st=${rd(L.protaStatus)} ЛИШНИХ=${lines.length}`);
    for (const x of lines.slice(0, 8)) console.log("  ", x);
    if (found >= 6) break;
  }
}
console.log("тиков с мусором:", found);
