// spr_rom_cost.js — ЗАДАЧА #12: замер цены перевода спрайтов в образ.
//
// Печатает для одной сборки:
//   1) такты loadGameGfx — вся загрузка графики уровня (в старой сборке внутрь входила
//      распаковка GFX_MOMIA + RLE-проход по набору героя);
//   2) такты loadAnimation — СМЕНА ПРЕДМЕТА В РУКАХ (подбор ножа/кирки, сброс);
//   3) РЕЗИДЕНТНОСТЬ освобождаемого куска ОЗУ 0xF6A0-0xF83F (416 Б): сколько чтений и
//      записей туда пришло за прогон (~1700 игровых тиков: геймплей, три перехода читом N,
//      возврат в меню, пять смен предмета в руках). Ожидание в новой сборке — 0 и 0;
//      в старой ровно 2080 чтений (5 x 416 Б кэша зеркал) и 1342 записи (191+320+320+191+320 Б
//      распакованных наборов). Вне окна замера кусок по-прежнему затирают две сплошные
//      заливки — бут-зануление vec_init_clr и HideSprites (0xC000-0xFFFF на экране карты).
//
// Запуск: node tools/verify/spr_rom_cost.js [rom] [sym]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const ROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[3] || ROM.replace(/\.rom$/, ".sym");

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
const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), t8253 = new ctx.I8253(),
  ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(), io = new ctx.IO(keyboard, t8253, memory, ay, floppy);
const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
const v06c = new ctx.Vector06c(cpu, memory, io, ay, tape);
v06c.bmp = new Uint32Array(576 * 288); v06c.displayFrame = () => {};
v06c.check_breakpoint = () => false; v06c.dbg = null;
memory.init_from_array(new Uint8Array(fs.readFileSync(ROM)).subarray(0, 0x10000), 0x100);
memory.detach_boot && memory.detach_boot();
cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;
t8253.Write(3, 0x36); t8253.Write(3, 0x76); t8253.Write(3, 0xb6); ay.reset && ay.reset();
const L = {};
for (const line of fs.readFileSync(SYM, "latin1").split("\n")) {
  const m = line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16); }

const ord = memory.read.bind(memory), owr = memory.write.bind(memory);
const rd = a => ord(a & 0xffff, false), r16 = a => rd(a) | (rd(a + 1) << 8);
const key = (c, d) => { const ev = { keyCode: c, which: c, preventDefault() {}, stopPropagation() {} };
  d ? keyboard.keyDown(ev) : keyboard.keyUp(ev); };

// освобождаемый кусок: смещения 0..0x1A0 виртуальной базы vec_spr_buf
const FREE0 = L.vec_spr_buf, FREE1 = L.vec_spr_buf + 0x1a0;
let fRd = 0, fWr = 0, count = false;
memory.read = function (a, s) { const x = a & 0xffff;
  if (count && x >= FREE0 && x < FREE1) fRd++; return ord(a, s); };
memory.write = function (a, v, s) { const x = a & 0xffff;
  if (count && x >= FREE0 && x < FREE1) fWr++; return owr(a, v, s); };

let cyc = 0;
const wins = { loadGameGfx: [], loadAnimation: [] };
let openName = null, openT = 0, openRA = 0;
const orig = cpu.instruction.bind(cpu);
cpu.instruction = function () {
  const pc = cpu.pc, sp = cpu.sp;
  orig(); const t0 = cyc; cyc += cpu.vcycles | 0;
  if (!openName) {
    for (const n of ["loadGameGfx", "loadAnimation"])
      if (pc === L[n]) { openName = n; openT = t0; openRA = r16(sp); break; }
  } else if (pc === openRA) { wins[openName].push(cyc - openT); openName = null; }
};

for (let f = 0; f < 400; f++) v06c.oneInterrupt(true);
for (let f = 0; f < 1500 && rd(L.GameStatus) !== 5; f++) { key(32, true); v06c.oneInterrupt(true); }
key(32, false);
count = true;
// геймплей + два перехода читом N (загрузка уровня, экран карты) + подбор/сброс предметов
for (let f = 0; f < 200; f++) { key(39, f % 16 < 8); v06c.oneInterrupt(true); }
// СНАЧАЛА тик-сценарий (ходьба + чит N на новые пирамиды), потом пять смен предмета в руках
// настоящим путём подбора cogeObjeto -> loadAnimation.
function keysFor(t) {           // 1:1 со сценарием coltab_frame_parity.js (доходит до карты долины)
  if (t < 100) return [39];
  if (t < 110) return [78];
  if (t < 400) return [(t & 8) ? 39 : 37];
  if (t < 410) return [78];
  if (t < 700) return [(t & 8) ? 38 : 39];
  if (t < 740) return [78];
  if (t < 1100) return [(t & 8) ? 39 : 37];
  if (t < 1160) return [78];
  return [(t & 8) ? 37 : 39];
}
let tick = 0, prevT = rd(L.timer), held = new Set();
for (let f = 0; f < 200000 && tick < 1700; f++) {
  const want = new Set(keysFor(tick));
  for (const c of held) if (!want.has(c)) key(c, false);
  for (const c of want) if (!held.has(c)) key(c, true);
  held = want;
  v06c.oneInterrupt(true);
  const t = rd(L.timer); if (t !== prevT) { prevT = t; tick++; }
}
for (const obj of [0x10, 0x20, 0x00, 0x10, 0x00]) {
  cpu.set_a(obj);
  const SENT = 0x0038, sp0 = cpu.sp;
  cpu.sp = (cpu.sp - 2) & 0xffff; owr(cpu.sp, SENT & 0xff); owr(cpu.sp + 1, SENT >> 8);
  const savePC = cpu.pc, iff = cpu.iff; cpu.pc = L.cogeObjeto; cpu.iff = false;
  for (let n = 0; n < 2000000; n++) { cpu.instruction(); if (cpu.pc === SENT && cpu.sp >= sp0) break; }
  cpu.pc = savePC; cpu.iff = iff;
  for (let f = 0; f < 20; f++) v06c.oneInterrupt(true);
}
const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
console.log(`ROM: ${ROM}`);
console.log(`  финал: GameStatus=${rd(L.GameStatus)}, пирамида=${rd(L.piramideActual)}`);
console.log(`  loadGameGfx   : ${wins.loadGameGfx.length} замер(ов), ${avg(wins.loadGameGfx)} тактов — загрузка графики уровня`);
console.log(`  loadAnimation : ${wins.loadAnimation.length} замер(ов), ${avg(wins.loadAnimation)} тактов — смена предмета в руках`);
console.log(`  ОЗУ 0x${FREE0.toString(16)}-0x${(FREE1 - 1).toString(16)} (416 Б): чтений ${fRd}, записей ${fWr}`);
