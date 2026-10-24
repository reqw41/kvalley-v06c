// coltab_frame_parity.js — ЗАДАЧА #35: доказательство «картинка не изменилась» для правки,
// которая МЕНЯЕТ СКОРОСТЬ игры.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ГЕЙТ. Снятие холостых загрузок цвета освободило ~7% кадра, поэтому игра
// перестала терять прерывания: на ОДНОМ И ТОМ ЖЕ номере кадра новая сборка уже на несколько
// игровых тиков впереди. Покадровая сверка (honest_diff / rom_ab_parity) это честно ловит как
// расхождение, хотя рендер не изменился ни на бит. Поэтому сверяем не по НОМЕРУ КАДРА,
// а по НОМЕРУ ИГРОВОГО ТИКА: тик = приращение счётчика `timer` (его крутит ISR), и обе
// сборки исполняют одну и ту же логику тик-в-тик.
//
// ЧТО СВЕРЯЕТСЯ на каждом тике: последний кадр тика — три ВИДИМЫЕ плоскости p0/p1/p2
// (0x8000/0xA000/0xC000, по 8 КБ) БАЙТ В БАЙТ + все 16 слотов палитры.
// Клавиши подаются ПО ТИКАМ, а не по кадрам, иначе сборки получили бы разный ввод.
// soundnik.soundStep НЕ глушим — он тактует ВИ53 (часы музыки).
//
// АДРЕСА — ТОЛЬКО ИЗ .sym (2026-07-31, задача #37). Раньше здесь были зашиты timer=0x6C03,
// GameStatus=0x6C00, flagPiramideMap=0x6C51, piramideActual=0x6C54. После уплотнения нижней
// ОЗУ (база переменных 0x6C00 -> 0x7092) по этим адресам лежит КОД: гейт «сверял» мусор,
// счётчик тиков не рос и прогон вырождался. .sym читается ОТДЕЛЬНО ДЛЯ КАЖДОЙ сборки
// (рядом с её .rom) — именно потому, что сравниваемые сборки могут иметь РАЗНУЮ раскладку.
//
// Запуск: node tools/verify/coltab_frame_parity.js <до.rom> <после.rom> [тиков=2600]
//         (рядом с каждым .rom обязан лежать одноимённый .sym)
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
function mk(rom) {
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
    ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(),
    io = new ctx.IO(keyboard, t8253, memory, ay, floppy);
  const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
  const v = new ctx.Vector06c(cpu, memory, io, ay, tape);
  v.bmp = new Uint32Array(576 * 288); v.displayFrame = () => {}; v.check_breakpoint = () => false; v.dbg = null;
  memory.init_from_array(new Uint8Array(fs.readFileSync(rom)).subarray(0, 0x10000), 0x100);
  memory.detach_boot && memory.detach_boot();
  cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;
  t8253.Write(3, 0x36); t8253.Write(3, 0x76); t8253.Write(3, 0xb6); ay.reset && ay.reset();
  // адреса переменных — из .sym рядом с этим .rom (у сборок «до» и «после» они могут отличаться)
  const symfile = rom.replace(/\.rom$/, ".sym");
  const L = {};
  for (const l of fs.readFileSync(symfile, "latin1").split("\n")) {
    const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16); }
  for (const n of ["timer", "GameStatus", "flagPiramideMap", "piramideActual"])
    if (L[n] === undefined) { console.log(`нет символа ${n} в ${symfile}`); process.exit(2); }
  return { v, memory, keyboard, io, L, tick: 0, prevT: 0, held: new Set() };
}
const A = mk(process.argv[2]), B = mk(process.argv[3]);
const NT = +(process.argv[4] || 2600);

// клавиши как ФУНКЦИЯ ТИКА: SPACE-долбёжка до входа в игру, потом чит N на новые пирамиды,
// между ними — движение вправо/влево, чтобы двигались герой, мумии и гемы.
function keysFor(t) {
  const k = [];
  if (t < 900) { if ((t >> 2) & 1) k.push(32); }        // SPACE через такт: логотип -> меню -> старт
  else if (t < 1000) { k.push(39); }                     // вправо
  else if (t < 1010) { k.push(78); }                     // чит N: следующая пирамида
  else if (t < 1300) { if (t & 8) k.push(39); else k.push(37); }
  else if (t < 1310) { k.push(78); }
  else if (t < 1600) { if (t & 8) k.push(38); else k.push(39); }
  else if (t < 1640) { k.push(78); }                     // ещё пирамиды -> смена схемы кирпичей
  else if (t < 2000) { if (t & 8) k.push(39); else k.push(37); }
  else if (t < 2060) { k.push(78); }
  else { if (t & 8) k.push(37); else k.push(39); }
  return k;
}
function setKeys(M, t) {
  const want = new Set(keysFor(t));
  for (const c of M.held) if (!want.has(c))
    M.keyboard.keyUp({ keyCode: c, which: c, preventDefault() {}, stopPropagation() {} });
  for (const c of want) if (!M.held.has(c))
    M.keyboard.keyDown({ keyCode: c, which: c, preventDefault() {}, stopPropagation() {} });
  M.held = want;
}
// снимок = 3 видимые плоскости (по 8 КБ) + 16 слотов палитры
function snap(M) {
  const b = new Uint8Array(3 * 8192 + 16 * 4);
  for (let i = 0; i < 8192; i++) {
    b[i] = M.memory.read(0x8000 + i); b[8192 + i] = M.memory.read(0xA000 + i);
    b[16384 + i] = M.memory.read(0xC000 + i);
  }
  for (let i = 0; i < 16; i++) { const c = M.io.Palette[i] >>> 0;
    b[24576 + i * 4] = c & 255; b[24577 + i * 4] = (c >> 8) & 255; b[24578 + i * 4] = (c >> 16) & 255; }
  return b;
}
// прогон ДО ГРАНИЦЫ тиков T -> T+1; снимок берётся ровно на границе, когда тик T отработан
// целиком (в «медленной» сборке он может занимать 2 кадра, в «быстрой» 1 — работа та же).
function toTick(M, T) {
  let frames = 0;
  while (M.tick <= T && frames < 400000) {
    setKeys(M, M.tick);
    M.v.oneInterrupt(true); frames++;
    const t = M.memory.read(M.L.timer);
    if (t !== M.prevT) { M.prevT = t; M.tick++; }
  }
  M.frames = (M.frames || 0) + frames;
  return snap(M);
}
let bad = 0, firstBad = -1, checked = 0;
// РАЗБИВКА РАСХОЖДЕНИЙ ПО КЛЕТКАМ ЭКРАНА. Снимок — три плоскости подряд по 8192 Б,
// внутри плоскости адрес = столбец*256 + (255-Y). Переводим в клетку 8x8 (столбец, ряд),
// чтобы видеть, ГДЕ именно картинка разошлась: правка, затрагивающая только ворота и
// рычаг, обязана уложиться в их клетки и никуда больше.
const cells = new Map();
function diffCell(i) {
  if (i >= 3 * 8192) { cells.set("палитра", (cells.get("палитра") || 0) + 1); return; }
  const off = i % 8192, col = off >> 8, row = (255 - (off & 255)) >> 3;
  const k = `c${col}/r${row}`;
  cells.set(k, (cells.get(k) || 0) + 1);
}
const marks = [], seen = new Map();          // покрытие: GameStatus -> сколько контрольных тиков
for (let T = 20; T <= NT; T += 10) {
  const sa = toTick(A, T), sb = toTick(B, T);
  if (!sa || !sb) continue;
  const st = `GS=${A.memory.read(A.L.GameStatus)}/fpm=${A.memory.read(A.L.flagPiramideMap) & 1}`;
  seen.set(st, (seen.get(st) || 0) + 1);
  checked++;
  let d = 0; for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) { d++; diffCell(i); }
  if (d) { bad++; if (firstBad < 0) { firstBad = T; marks.push(`тик ${T}: ${d} байт`); } }
  if (T % 500 === 0) process.stderr.write(` ${T}`);
}
process.stderr.write("\n");
const gs = A.memory.read(A.L.GameStatus), pyr = A.memory.read(A.L.piramideActual),
      pyrB = B.memory.read(B.L.piramideActual);
console.log(`СВЕРКА ПО ИГРОВЫМ ТИКАМ: ${checked} контрольных тиков (каждый 10-й, тики 20..${NT})`);
console.log(`  сверялось на тик: p0/p1/p2 по 8192 Б + 16 слотов палитры = ${3 * 8192 + 64} Б`);
console.log(`  кадров потрачено: до=${A.frames}, после=${B.frames} ` +
  `(на ${(100 * (A.frames - B.frames) / A.frames).toFixed(1)}% меньше кадров на ту же игру)`);
console.log(`  финальное состояние: GS=${gs}, пирамида до=${pyr} после=${pyrB}`);
console.log(`  покрытие экранов: ${[...seen].map(([k, v]) => `${k}:${v}`).join(", ")}`);
if (bad) {
  console.log(`РАСХОЖДЕНИЕ на ${bad} тиках, первое — ${marks.join("; ")}`);
  console.log(`  клетки 8x8, где картинка разошлась (столбец/ряд -> байт):`);
  console.log(`  ` + [...cells.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`).join("  "));
  process.exit(1);
}
console.log("ВЕРДИКТ: на КАЖДОМ игровом тике плоскости и палитра совпадают БАЙТ В БАЙТ — OK");
