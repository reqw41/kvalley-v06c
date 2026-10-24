// ЗАДАЧА #22: «на 2-й пирамиде после скролла испорчен гем».
// Инструмент СНАЧАЛА отвечает на вопрос фактами, а не рассуждением:
//   1) какие тайлы лежат под map-кодами гемов (0x43..0x48 -> tilesGemas 0x86..0x8B);
//   2) как эти тайлы выглядят в паттерн-кэше (ASCII-дамп pat_maze_base);
//   3) где в карте пирамиды стоят гемы (комната/ряд/столбец);
//   4) во что их превращает блиттер НА ЭКРАНЕ (карта индексов палитры на клетку).
//
// Запуск: node tools/verify/gem_scroll_probe.js [пирамида] [rom] [sym]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const PIR = Number(process.argv[2] || 2);
const ROM = process.argv[3] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[4] || REPO + "/build/kvalley_8c.sym";

function boot() {
  const g = {}; g.window = g;
  const stub = () => ({ width: 0, height: 0, style: {}, getContext: () => ({
    createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), drawImage: () => {}, fillRect: () => {},
    save: () => {}, restore: () => {}, scale: () => {}, setTransform: () => {} }) });
  g.document = { createElement: stub, getElementById: stub };
  g.requestAnimationFrame = () => 0; g.setTimeout = () => 0; g.print = () => 0;
  g.console = { log() {}, debug() {}, warn() {}, error() {}, info() {} };
  const ctx = vm.createContext(g);
  for (const f of ["i8080-js/i8080_trace.js", "i8080-js/i8080_disasm.js", "i8080-js/i8080.js",
    "src/fili.js", "src/ay.js", "src/fd1793.js", "src/fddimage.js", "src/i8253.js",
    "src/io.js", "src/keyboard.js", "src/memory.js", "src/sound.js", "src/tv.js"])
    vm.runInContext(fs.readFileSync(base + "/" + f, "utf8"), ctx, { filename: f });
  const L = {};
  for (const line of fs.readFileSync(SYM, "latin1").split("\n")) {
    const m = line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16);
  }
  const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), timer = new ctx.I8253(),
    ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(), io = new ctx.IO(keyboard, timer, memory, ay, floppy);
  const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
  const v06c = new ctx.Vector06c(cpu, memory, io, ay, tape);
  v06c.bmp = new Uint32Array(576 * 288); v06c.displayFrame = () => {};
  v06c.check_breakpoint = () => false; v06c.dbg = null;
  const img = new Uint8Array(fs.readFileSync(ROM));
  memory.init_from_array(img.subarray(0, 0x10000), 0x100);
  memory.detach_boot && memory.detach_boot();
  cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;
  return { v06c, cpu, memory, L, rd: a => memory.read(a, false), wr: (a, v) => memory.write(a, v, false) };
}

// Перевод на нужную пирамиду: пишем НАПРЯМУЮ и ждём СМЕНЫ piramideActual (см. грабли #3).
function gotoPyramid(e, want) {
  const { v06c, rd, wr, L } = e;
  let n = 0; while (n < 4000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); n++; }
  if (rd(L.GameStatus) !== 5) throw new Error("не дошли до геймплея");
  while (rd(L.piramideActual) !== want) {
    const cur = rd(L.piramideActual);
    wr(L.piramideDest, cur + 1); wr(L.subStatus, 0); wr(L.GameStatus, 8);
    let m = 0; while (m < 4000 && rd(L.piramideActual) === cur) { v06c.oneInterrupt(true); m++; }
    if (rd(L.piramideActual) === cur) throw new Error("пирамида не сменилась");
  }
  let k = 0; while (k < 2000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); k++; }
  return rd(L.piramideActual);
}

const e = boot();
const { v06c, rd, wr, L } = e;
const act = gotoPyramid(e, PIR);
console.log(`пирамида ${act}, комната ${rd(L.ProtaRoom)}, гемов всего ${rd(L.gemasTotales)}`);

// --- 1. Паттерны тайлов из кэша лабиринта -------------------------------------------
const PATB = L.pat_maze_base;
function patRows(tile) {                    // folded = tile*8, база maze для 0x40..0x8b
  const rows = [];
  for (let r = 0; r < 8; r++) rows.push(rd(PATB + tile * 8 + r));
  return rows;
}
function ascii(tile) {
  return patRows(tile).map(b => {
    let s = ""; for (let i = 7; i >= 0; i--) s += (b >> i) & 1 ? "#" : ".";
    return s;
  });
}
const SHOW = [0x4b, 0x4c, 0x51, 0x52, 0x53, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b];
console.log("\n--- паттерны (кэш лабиринта) ---");
for (let r = 0; r < 8; r++) {
  let line = "";
  for (const t of SHOW) line += ascii(t)[r] + "  ";
  console.log(line);
}
console.log(SHOW.map(t => ("0x" + t.toString(16)).padEnd(10)).join(""));

// --- 2. Где гемы в карте ------------------------------------------------------------
const MAP = L.MapaRAM;
function scanMap() {
  const gems = [], items = [], brillos = [];
  for (let row = 0; row < 22; row++) for (let col = 0; col < 96; col++) {
    const id = rd(MAP + row * 96 + col);
    if (id >= 0x43 && id <= 0x48) gems.push({ row, col, id, tile: 0x86 + id - 0x43 });
    if (id >= 0x30 && id <= 0x32) items.push({ row, col, id, tile: 0x4b });   // нож на полу
    if (id === 0x80) items.push({ row, col, id, tile: 0x4c });                // кирка на полу
    if (id >= 0x40 && id <= 0x42) brillos.push({ row, col, id });
  }
  return { gems, items, brillos };
}
const { gems, items, brillos } = scanMap();
console.log("\n--- гемы в карте пирамиды (map-код -> тайл) ---");
for (const g of gems)
  console.log(`  комната ${Math.floor(g.col / 32)} стб ${g.col % 32} ряд ${g.row} : ` +
    `map 0x${g.id.toString(16)} -> тайл 0x${g.tile.toString(16)}`);
console.log("--- ножи/кирки на полу ---");
for (const g of items)
  console.log(`  комната ${Math.floor(g.col / 32)} стб ${g.col % 32} ряд ${g.row} : ` +
    `map 0x${g.id.toString(16)} -> тайл 0x${g.tile.toString(16)}`);
console.log(`  блёсток вокруг гемов: ${brillos.length}`);

// --- 3. Что на экране: индекс палитры по каждому пикселю клетки ----------------------
function idxAt(col, row, y, x) {           // экранная клетка (row 0..23, col 0..31)
  const lo = 255 - (row * 8 + y);
  const p0 = (rd(0x8000 + col * 256 + lo) >> (7 - x)) & 1;
  const p1 = (rd(0xa000 + col * 256 + lo) >> (7 - x)) & 1;
  const p2 = (rd(0xc000 + col * 256 + lo) >> (7 - x)) & 1;
  return (p0 << 3) | (p1 << 2) | (p2 << 1);
}
function cellDump(col, srow) {
  const out = [];
  for (let y = 0; y < 8; y++) {
    let s = "";
    for (let x = 0; x < 8; x++) { const i = idxAt(col, srow, y, x); s += i ? i.toString(16).toUpperCase() : "."; }
    out.push(s);
  }
  return out;
}
const room = rd(L.ProtaRoom);
const here = [...gems, ...items].filter(g => Math.floor(g.col / 32) === room);
console.log(`\n--- экран (комната ${room}): индекс палитры в клетках гемов/предметов ---`);
for (const g of here) {
  const col = g.col % 32, srow = g.row + 1;   // экранные ряды 1..22
  const shape = ascii(g.tile), scr = cellDump(col, srow);
  const set = new Set(); for (const r of scr) for (const ch of r) if (ch !== ".") set.add(ch);
  console.log(`тайл 0x${g.tile.toString(16)} @стб ${col} ряд ${srow}: индексы {${[...set].join(",")}}` +
    (set.size > 1 ? "  <-- ДВУХЦВЕТНЫЙ" : ""));
  for (let y = 0; y < 8; y++) console.log(`   ${shape[y]}   ${scr[y]}`);
}

// --- 4. СОСЕДНИЙ ЭКРАН. Скролл рисует 4 новых столбца тем же vec_nr_win, что и вход в
// комнату (см. шапку vec_nat_room), поэтому «как выглядит соседняя комната после переезда»
// честно моделируется вызовом vec_nat_room с другим ProtaRoom. Форсировать GS=9 НЕЛЬЗЯ —
// картинка разваливается сильнее настоящего бага (это артефакт форса, уже наступали).
function drawRoom(n) {
  const { cpu, wr, rd, L } = e;
  wr(L.ProtaRoom, n);
  const RET = 0x0000;                       // страж: код там не исполняется
  cpu.sp = (cpu.sp - 2) & 0xffff;
  wr(cpu.sp, RET & 255); wr(cpu.sp + 1, RET >> 8);
  cpu.pc = L.vec_nat_room;
  for (let i = 0; i < 20000000 && cpu.pc !== RET; i++) cpu.instruction();
  if (cpu.pc !== RET) throw new Error("vec_nat_room не вернулся");
}
for (const other of [...new Set(gems.map(g => Math.floor(g.col / 32)))].filter(r => r !== room)) {
  drawRoom(other);
  console.log(`\n--- СОСЕДНИЙ ЭКРАН: комната ${other} перерисована vec_nr_win (тот же путь, что шаг скролла) ---`);
  for (const g of [...gems, ...items].filter(x => Math.floor(x.col / 32) === other)) {
    const col = g.col % 32, srow = g.row + 1, shape = ascii(g.tile), scr = cellDump(col, srow);
    const set = new Set(); for (const r of scr) for (const ch of r) if (ch !== ".") set.add(ch);
    console.log(`тайл 0x${g.tile.toString(16)} @стб ${col} ряд ${srow}: индексы {${[...set].join(",")}}` +
      (g.tile >= 0x86 && set.size > 1 ? "  <-- ГЕМ ИСПОРЧЕН" : ""));
    for (let y = 0; y < 8; y++) console.log(`   ${shape[y]}   ${scr[y]}`);
  }
}

// --- 5. Сводка по всем пирамидам: сколько гемов попадает в «предметный» двухцветный путь
if (process.env.KV_ALL) {
  console.log("\n--- сводка по пирамидам: тайлы гемов ---");
  for (let p = act; p <= 15; p++) {
    if (p !== rd(L.piramideActual)) gotoPyramid(e, p);
    const s = scanMap();
    const bad = s.gems.filter(g => g.tile === 0x88 || g.tile === 0x8b);
    const cnt = {}; for (const g of s.gems) cnt["0x" + g.tile.toString(16)] = (cnt["0x" + g.tile.toString(16)] || 0) + 1;
    console.log(`  пирамида ${p}: гемов ${s.gems.length} ${JSON.stringify(cnt)}` +
      `  ножей/кирок ${s.items.length}` + (bad.length ? `  >>> В ДВУХЦВЕТНОМ ПУТИ: ${bad.length}` : ""));
  }
}
