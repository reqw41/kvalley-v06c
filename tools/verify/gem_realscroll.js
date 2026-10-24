// ЗАДАЧА A: «сокровища портятся ПРИ СКРОЛЛЕ» — воспроизведение НАСТОЯЩИМ скроллом,
// а не перерисовкой комнаты через vec_nat_room (прошлый агент проверял именно так и
// корня не нашёл).
//
// МЕТОД. Скролл запускается ЧЕСТНО: один раз подставляем sentidoProta/ProtaX так, чтобы
// chkScroll сам решил «пора» (GS -> 9), дальше игра работает штатно 8 шагов по 4
// знакоместа. Снимаем плоскости p0/p1/p2 в конце скролла (последний кадр GS=9) и
// сравниваем с ЭТАЛОНОМ — той же комнатой, нарисованной vec_nat_room с нуля в отдельном
// экземпляре эмулятора. После 8 шагов окно карты стоит ровно на целевой комнате, значит
// экраны обязаны совпасть БАЙТ-В-БАЙТ. Всё, что не совпало, — порча скролла.
//
// Запуск: node tools/verify/gem_realscroll.js [пирамида] [dir: l|r] [rom] [sym]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const PIR = Number(process.argv[2] || 2);
const DIR = (process.argv[3] || "l").toLowerCase();
const ROM = process.argv[4] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[5] || REPO + "/build/kvalley_8c.sym";

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
}

// плоскости в плоский буфер [pl][col][lo]
function grab(rd) {
  const b = Buffer.alloc(3 * 32 * 256);
  for (let pl = 0; pl < 3; pl++) for (let c = 0; c < 32; c++) for (let lo = 0; lo < 256; lo++)
    b[(pl * 32 + c) * 256 + lo] = rd(0x8000 + pl * 0x2000 + c * 256 + lo);
  return b;
}
const at = (b, pl, col, lo) => b[(pl * 32 + col) * 256 + lo];

function scanMap(rd, MAP) {
  const cells = [];
  for (let row = 0; row < 22; row++) for (let col = 0; col < 96; col++) {
    const id = rd(MAP + row * 96 + col);
    let kind = null, tile = null;
    if (id >= 0x43 && id <= 0x48) { kind = "гем"; tile = 0x86 + id - 0x43; }
    else if (id >= 0x40 && id <= 0x42) { kind = "блеск"; tile = 0x51 + id - 0x40; }
    if (kind) cells.push({ row, col, id, tile, kind, room: Math.floor(col / 32) });
  }
  return cells;
}

// ---- 1. эталон: комната нарисована с нуля на ОЧИЩЕННЫХ плоскостях --------------------
// Обнуление обязательно: часть путей блиттера пишет не во все три плоскости, и «эталон»
// поверх старой картинки унаследовал бы её мусор (проверено: без обнуления эталон сам
// содержит p2-грязь в клетках блёсток).
function reference(room) {
  const e = boot(); gotoPyramid(e, PIR);
  const { cpu, rd, wr, L } = e;
  for (let a = 0x8000; a < 0x0E000; a++) wr(a, 0);
  wr(L.ProtaRoom, room);
  cpu.sp = (cpu.sp - 2) & 0xffff; wr(cpu.sp, 0); wr(cpu.sp + 1, 0);
  cpu.pc = L.vec_nat_room;
  for (let i = 0; i < 20000000 && cpu.pc !== 0; i++) cpu.instruction();
  if (cpu.pc !== 0) throw new Error("vec_nat_room не вернулся");
  return grab(rd);
}

// ---- 2. настоящий скролл ------------------------------------------------------------
const e = boot();
gotoPyramid(e, PIR);
const { v06c, rd, wr, L } = e;
const room0 = rd(L.ProtaRoom);
console.log(`пирамида ${rd(L.piramideActual)}, комната ${room0}, последовательность ${DIR}`);

// ПРЯМОЙ ЗАМЕР ДЕФЕКТА: на входе в vec_blit_brillo (B=row, C=col) смотрим, ЧТО ЛЕЖИТ В p2
// этой клетки. Блеск обязан быть чистым idx4 (p0=0,p1=шейп,p2=0); если p2 не ноль ДО блита
// и блит его не чистит, клетка выйдет с чужими пикселями вплотную к сокровищу.
let brilloTotal = 0, brilloDirtyIn = 0, brilloDirtyOut = 0;
e.cpu.instruction_orig = null;
v06c.check_breakpoint = function () {
  if (e.cpu.pc !== L.vec_blit_brillo) return false;
  const row = e.cpu.b(), col = e.cpu.c();
  let dirty = 0;
  for (let y = 0; y < 8; y++) if (rd(0x0C000 + col * 256 + (255 - (row * 8 + y)))) dirty++;
  brilloTotal++; if (dirty) brilloDirtyIn++;
  pending.push({ row, col });
  return false;
};
const pending = [];
function drainPending() {          // p2 после блита (блит клетки укладывается в один кадр)
  for (const p of pending) {
    let dirty = 0;
    for (let y = 0; y < 8; y++) if (rd(0x0C000 + p.col * 256 + (255 - (p.row * 8 + y)))) dirty++;
    if (dirty) brilloDirtyOut++;
  }
  pending.length = 0;
}

let last = null;
for (let d of DIR) {
  const from = rd(L.ProtaRoom);
  // комнат ровно три (0..2): за край не съезжаем, иначе окно карты уходит в мусор
  if (from === 0) d = "r"; else if (from === 2) d = "l";
  // один раз ставим героя на край и ждём, пока chkScroll сам переведёт в GS=9
  let m = 0;
  while (rd(L.GameStatus) !== 9 && m < 300) {
    wr(L.sentidoProta, d === "l" ? 1 : 2);
    wr(L.ProtaX, d === "l" ? 0 : 0x0F6);
    v06c.oneInterrupt(true); m++;
  }
  if (rd(L.GameStatus) !== 9) throw new Error("скролл не запустился");
  let frames = 0;
  while (rd(L.GameStatus) === 9 && frames < 400) {
    v06c.oneInterrupt(true); frames++;
    drainPending();
    last = grab(rd);
  }
  console.log(`  шаг '${d}': GS=9 через ${m} кадров, скролл ${frames} кадров, комната ${from} -> ${rd(L.ProtaRoom)}`);
}
const roomEnd = rd(L.ProtaRoom);
v06c.check_breakpoint = () => false;
console.log(`блёсток нарисовано за скролл: ${brilloTotal}; ` +
  `p2 БЫЛА грязной до блита: ${brilloDirtyIn}; ОСТАЛАСЬ грязной после блита: ${brilloDirtyOut}`);

const ref = reference(roomEnd);

// ---- 3. диф -------------------------------------------------------------------------
// Считаем только игровое поле: ряды 1..22 => lo 72..247.
const bad = new Map();  // "col,row" -> {p0,p1,p2}
let diffBytes = 0;
for (let pl = 0; pl < 3; pl++) for (let col = 0; col < 32; col++) for (let lo = 72; lo <= 247; lo++) {
  if (at(last, pl, col, lo) === at(ref, pl, col, lo)) continue;
  diffBytes++;
  const srow = Math.floor((255 - lo) / 8);
  const k = col + "," + srow;
  if (!bad.has(k)) bad.set(k, [0, 0, 0]);
  bad.get(k)[pl]++;
}
console.log(`\nРАСХОЖДЕНИЕ со свежим рендером той же комнаты: ${diffBytes} байт, ${bad.size} клеток`);

const cells = scanMap(rd, L.MapaRAM).filter(c => c.room === roomEnd);
const cellKey = c => (c.col % 32) + "," + (c.row + 1);
const known = new Map(cells.map(c => [cellKey(c), c]));

const byKind = { гем: 0, блеск: 0, прочее: 0 };
for (const [k, v] of [...bad.entries()].sort()) {
  const c = known.get(k);
  byKind[c ? c.kind : "прочее"]++;
}
console.log(`  из них: гемов ${byKind["гем"]}, блёсток ${byKind["блеск"]}, прочих ${byKind["прочее"]}`);
if (bad.size) {
  console.log("  список (стб,ряд) p0/p1/p2 [что за клетка]:");
  for (const [k, v] of [...bad.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 40)) {
    const c = known.get(k);
    console.log(`    ${k.padEnd(7)} ${v[0]}/${v[1]}/${v[2]}  ${c ? c.kind + " тайл 0x" + c.tile.toString(16) : ""}`);
  }
}

// ---- 4. побайтный дамп клеток гемов и блёсток ПОСЛЕ настоящего скролла ---------------
function cellIdx(b, col, srow) {
  const out = [];
  for (let y = 0; y < 8; y++) {
    const lo = 255 - (srow * 8 + y);
    let s = "";
    for (let x = 0; x < 8; x++) {
      const p0 = (at(b, 0, col, lo) >> (7 - x)) & 1, p1 = (at(b, 1, col, lo) >> (7 - x)) & 1,
        p2 = (at(b, 2, col, lo) >> (7 - x)) & 1;
      const i = (p0 << 3) | (p1 << 2) | (p2 << 1);
      s += i ? i.toString(16).toUpperCase() : ".";
    }
    out.push(s);
  }
  return out;
}
console.log(`\n--- клетки гемов/блёсток комнаты ${roomEnd}: ПОСЛЕ СКРОЛЛА | ЭТАЛОН ---`);
for (const c of cells) {
  const col = c.col % 32, srow = c.row + 1;
  const a = cellIdx(last, col, srow), r = cellIdx(ref, col, srow);
  const same = a.join() === r.join();
  console.log(`${c.kind} 0x${c.tile.toString(16)} @стб ${col} ряд ${srow}` + (same ? "" : "   <<< НЕ СОВПАЛО"));
  for (let y = 0; y < 8; y++) console.log(`   ${a[y]}   ${r[y]}`);
}
