// map_stream_audit.js — ЗАДАЧА #30: замер под вопрос «стримить ли графику карты долины».
//
// ЧТО МЕРЯЕТ (всё на живом ROM, ничего не патчит):
//   1) цену построения карты в тактах — окно = вызов setupPergamino, с разбивкой
//      по распаковкам (gfxMap / colorTableMap / gfxSprMapa) и по блитам знакомест;
//   2) КОМУ ПРИНАДЛЕЖАТ буферы, в которые распаковывается карта: для каждой распаковки
//      печатается диапазон реально записанных байт в тени паттернов (pat_maze_cell) и в
//      буфере спрайт-паттернов (vec_spr_buf). Если те же байты пишет геймплейный набор
//      (GFX_InGame / GFX_SPRITES2), то стриминг карты НЕ ОСВОБОДИТ НИ БАЙТА;
//   3) живы ли верхние банки тени паттернов: сколько разных VDP-адресов паттернов дошло
//      до vec_pat_wr в банках 0x2000 / 0x2800 / 0x3000 (ответ ожидается «295 / 0 / 0» —
//      банки схлопываются `and 7`, физически занято 608 Б pat_maze_cell).
//
// Чит перехода на следующую пирамиду — клавиша N (78). Карту ждём по вызову vbp_map.
// ВНИМАНИЕ: soundnik.soundStep НЕ глушим — он тактует ВИ53, на нём часы музыки.
//
// Запуск: node tools/verify/map_stream_audit.js [rom] [sym]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const ROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[3] || REPO + "/build/kvalley_8c.sym";
const hex = x => "0x" + (x >>> 0).toString(16);

// --- эмулятор ------------------------------------------------------------------------
const g = {}; g.window = g;
const fcx = () => ({ createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {},
  getImageData: () => ({ data: new Uint8ClampedArray(4) }), drawImage: () => {}, fillRect: () => {},
  save: () => {}, restore: () => {}, scale: () => {}, setTransform: () => {} });
const fc = () => ({ width: 0, height: 0, style: {}, getContext: fcx });
g.document = { createElement: fc, getElementById: fc };
g.requestAnimationFrame = () => 0; g.setTimeout = () => 0; g.print = () => 0;
g.console = { log() {}, debug() {}, warn() {}, error() {}, info() {} };
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js", "i8080-js/i8080_disasm.js", "i8080-js/i8080.js",
  "src/fili.js", "src/ay.js", "src/fd1793.js", "src/fddimage.js", "src/i8253.js",
  "src/io.js", "src/keyboard.js", "src/memory.js", "src/sound.js", "src/tv.js"])
  vm.runInContext(fs.readFileSync(base + "/" + f, "utf8"), ctx, { filename: f });
const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), timer = new ctx.I8253(),
  ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(), io = new ctx.IO(keyboard, timer, memory, ay, floppy);
const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
const v06c = new ctx.Vector06c(cpu, memory, io, ay, tape);
v06c.bmp = new Uint32Array(576 * 288); v06c.displayFrame = () => {};
v06c.check_breakpoint = () => false; v06c.dbg = null;
memory.init_from_array(new Uint8Array(fs.readFileSync(ROM)).subarray(0, 0x10000), 0x100);
memory.detach_boot && memory.detach_boot();
cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;
timer.Write(3, 0x36); timer.Write(3, 0x76); timer.Write(3, 0xb6); ay.reset && ay.reset();
const L = {};
for (const line of fs.readFileSync(SYM, "latin1").split("\n")) {
  const m = line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16);
}
const syms = Object.entries(L).map(([n, a]) => [a, n]).sort((x, y) => x[0] - y[0]);
const resolve = t => { let p = syms[0]; for (const s of syms) { if (s[0] <= t) p = s; else break; } return `${p[1]}+${t - p[0]}`; };
const ord = memory.read.bind(memory), owr = memory.write.bind(memory);
const rd = a => ord(a & 0xffff, false), r16 = a => rd(a) | (rd(a + 1) << 8);
const run = n => { for (let i = 0; i < n; i++) v06c.oneInterrupt(true); };
const key = (c, d) => { const ev = { keyCode: c, which: c, preventDefault() {}, stopPropagation() {} };
  d ? keyboard.keyDown(ev) : keyboard.keyUp(ev); };
// АДРЕСА — ТОЛЬКО ИЗ .sym (2026-07-31, задача #37): были зашиты 0x6C00/0x6C51/0x6C54, после
// уплотнения нижней ОЗУ (база переменных 0x6C00 -> 0x7092) там КОД, и ожидание геймплея
// никогда не срабатывало.
const A = {};
for (const n of ["GameStatus", "flagPiramideMap", "piramideActual"]) {
  if (L[n] === undefined) { console.log(`нет символа ${n} в ${SYM}`); process.exit(2); }
  A[n] = L[n]; }

// --- инструментация -------------------------------------------------------------------
const PAT = L.pat_maze_cell, PATLEN = 608, SPR = L.vec_spr_buf, SPRLEN = 768;
let watch = null;
memory.write = function (a, v, s) { if (watch) watch.add(a & 0xffff); return owr(a, v, s); };
const UP = L.UnpackPatterns, UG = L.unpackGFXset, BT = L.vec_blit_tile, PW = L.vec_pat_wr;
let cyc = 0, vbp = 0, armed = false, open = null;
let setupIn = -1, setupRA = -1, setupTotal = null;
const unpacks = [], blits = {}, patVDP = new Set();
const orig = cpu.instruction.bind(cpu);
cpu.instruction = function () {
  const pc = cpu.pc, sp = cpu.sp;
  const de = (cpu.reg(2) << 8) | cpu.reg(3), hl = (cpu.reg(4) << 8) | cpu.reg(5);
  orig();
  const t0 = cyc; cyc += cpu.vcycles | 0;
  if (pc === L.vbp_map) vbp++;
  if (pc === PW) patVDP.add(hl & 0x3fff);
  if (!armed) return;
  if (pc === L.setupPergamino && setupIn < 0 && setupTotal === null) { setupIn = t0; setupRA = r16(sp); }
  else if (setupIn >= 0 && pc === setupRA) { setupTotal = t0 - setupIn; setupIn = -1; }
  if (setupIn < 0) return;
  if (pc === BT) { const ra = r16(sp); blits[ra] = (blits[ra] || 0) + 1; }
  if ((pc === UP || pc === UG) && !open) { open = { n: pc === UP ? "UnpackPatterns" : "unpackGFXset", de, hl, t0, ra: r16(sp) }; watch = new Set(); }
  else if (open && pc === open.ra) {
    const w = [...watch].sort((x, y) => x - y);
    const sub = (a, b) => w.filter(x => x >= a && x < b);
    unpacks.push({ ...open, t: t0 - open.t0, pat: sub(PAT, PAT + PATLEN), spr: sub(SPR, SPR + SPRLEN) });
    open = null; watch = null;
  }
};

// --- прогон: титул -> геймплей -> чит N -> карта ---------------------------------------
run(400);
let ok = false;
for (let blk = 0; blk < 60 && !ok; blk++) {
  for (let f = 0; f < 25; f++) { key(32, true); run(1);
    if (rd(A.GameStatus) === 5 && (rd(A.flagPiramideMap) & 1)) { ok = true; break; } }
  key(32, false); run(5);
}
if (!ok) { console.error("НЕ удалось войти в геймплей"); process.exit(2); }
run(60);
armed = true;
key(78, true); run(3); key(78, false);
let f = 0; for (; f < 1200 && !vbp; f++) run(1);
if (!vbp) { console.error("карта не построилась за 1200 кадров"); process.exit(1); }
run(8);

// --- отчёт -----------------------------------------------------------------------------
const out = [];
out.push(`ЦЕНА ПОСТРОЕНИЯ КАРТЫ: setupPergamino = ${setupTotal} тактов ` +
  `(${(setupTotal / 59904).toFixed(1)} кадра при 59904 т/кадр); от нажатия N до карты ${f} кадров`);
out.push("  распаковки внутри setupPergamino (и что они записали в буферы):");
for (const u of unpacks) {
  const p = u.pat.length ? ` тень паттернов [${hex(u.pat[0])}..${hex(u.pat[u.pat.length - 1])}]=${u.pat.length}Б` : " тень паттернов 0Б";
  const s = u.spr.length ? ` vec_spr_buf [${hex(u.spr[0])}..${hex(u.spr[u.spr.length - 1])}]=${u.spr.length}Б` : " vec_spr_buf 0Б";
  out.push(`    ${u.n} DE=${hex(u.de)} ${String(u.t).padStart(8)} т ;${p};${s}`);
}
const totBlit = Object.values(blits).reduce((a, b) => a + b, 0);
out.push(`  блитов знакомест за построение: ${totBlit} (` +
  Object.entries(blits).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${resolve(+a)}:${n}`).join(", ") + ")");
const banks = [0, 0, 0];
for (const a of patVDP) { const b = (a - 0x2000) >> 11; if (b >= 0 && b < 3) banks[b]++; }
out.push(`ТЕНЬ ПАТТЕРНОВ: разных VDP-адресов по банкам 0x2000/0x2800/0x3000 = ${banks.join(" / ")} ` +
  `(всего ${patVDP.size}); физически под тень отведено ${PATLEN} Б (pat_maze_cell @${hex(PAT)}), 6 КБ НЕТ`);
console.log(out.join("\n"));
process.exit(banks[1] === 0 && banks[2] === 0 ? 0 : 1);
