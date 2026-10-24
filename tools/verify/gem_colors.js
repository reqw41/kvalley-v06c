// ЗАДАЧА B: «сделать шесть сокровищ разноцветными».
// Инструмент делает ДВЕ вещи сразу:
//   1) показывает, в какой слот палитры попал каждый тайл гема 0x86-0x8B (по факту
//      пикселей на экране, а не по коду);
//   2) доказывает, что кроме клеток гемов НИЧЕГО не изменилось: рендерит все комнаты
//      двумя ПЗУ (старым и новым) на очищенных плоскостях и перечисляет различающиеся
//      клетки. Это и есть проверка эквивалентности для удалённой петли vbt8_item
//      (рычаг 0x5C и все прочие тайлы обязаны совпасть байт-в-байт).
//
// Запуск: node tools/verify/gem_colors.js <новый.rom> <новый.sym> [старый.rom старый.sym]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const NROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const NSYM = process.argv[3] || REPO + "/build/kvalley_8c.sym";
const OROM = process.argv[4], OSYM = process.argv[5];

function boot(rom, sym) {
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
  for (const line of fs.readFileSync(sym, "latin1").split("\n")) {
    const m = line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16);
  }
  const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), timer = new ctx.I8253(),
    ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(), io = new ctx.IO(keyboard, timer, memory, ay, floppy);
  const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
  const v06c = new ctx.Vector06c(cpu, memory, io, ay, tape);
  v06c.bmp = new Uint32Array(576 * 288); v06c.displayFrame = () => {};
  v06c.check_breakpoint = () => false; v06c.dbg = null;
  const img = new Uint8Array(fs.readFileSync(rom));
  memory.init_from_array(img.subarray(0, 0x10000), 0x100);
  memory.detach_boot && memory.detach_boot();
  cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;
  return { v06c, cpu, memory, L, rd: a => memory.read(a, false), wr: (a, v) => memory.write(a, v, false) };
}
function gotoPyramid(e, want) {
  const { v06c, rd, wr, L } = e;
  let n = 0; while (n < 4000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); n++; }
  while (rd(L.piramideActual) !== want) {
    const cur = rd(L.piramideActual);
    wr(L.piramideDest, cur + 1); wr(L.subStatus, 0); wr(L.GameStatus, 8);
    let m = 0; while (m < 4000 && rd(L.piramideActual) === cur) { v06c.oneInterrupt(true); m++; }
    if (rd(L.piramideActual) === cur) throw new Error("пирамида не сменилась");
  }
  let k = 0; while (k < 2000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); k++; }
}
function drawRoom(e, room) {           // чистые плоскости + vec_nat_room = «идеальный» кадр
  const { cpu, wr, L } = e;
  for (let a = 0x8000; a < 0x0E000; a++) wr(a, 0);
  wr(L.ProtaRoom, room);
  cpu.sp = (cpu.sp - 2) & 0xffff; wr(cpu.sp, 0); wr(cpu.sp + 1, 0);
  cpu.pc = L.vec_nat_room;
  for (let i = 0; i < 20000000 && cpu.pc !== 0; i++) cpu.instruction();
  if (cpu.pc !== 0) throw new Error("vec_nat_room не вернулся");
}
function grab(rd) {
  const b = Buffer.alloc(3 * 32 * 256);
  for (let pl = 0; pl < 3; pl++) for (let c = 0; c < 32; c++) for (let lo = 0; lo < 256; lo++)
    b[(pl * 32 + c) * 256 + lo] = rd(0x8000 + pl * 0x2000 + c * 256 + lo);
  return b;
}
const at = (b, pl, col, lo) => b[(pl * 32 + col) * 256 + lo];
function cellIdxSet(b, col, srow) {
  const s = new Set();
  for (let y = 0; y < 8; y++) {
    const lo = 255 - (srow * 8 + y);
    for (let x = 0; x < 8; x++) {
      const i = (((at(b, 0, col, lo) >> (7 - x)) & 1) << 3) | (((at(b, 1, col, lo) >> (7 - x)) & 1) << 2) |
        (((at(b, 2, col, lo) >> (7 - x)) & 1) << 1);
      if (i) s.add(i);
    }
  }
  return s;
}
const PLANES = { 2: "p2", 4: "p1", 6: "p1+p2", 8: "p0", 10: "p0+p2", 12: "p0+p1", 14: "p0+p1+p2" };
const NAMES = { 2: "серый 0F6h", 4: "слот АУРЫ (мерцает)", 6: "красный 05Fh", 8: "тон A камня",
  10: "тон B камня", 12: "белый 0FFh", 14: "зелёный 038h" };

const PYRS = [1, 2, 3, 5, 6, 9, 13];
const seen = new Map();       // тайл -> Set(idx)
let cmpCells = 0, cmpGemCells = 0, cmpOther = [];

for (const p of PYRS) {
  const en = boot(NROM, NSYM); gotoPyramid(en, p);
  const eo = OROM ? boot(OROM, OSYM) : null; if (eo) gotoPyramid(eo, p);
  const { rd, L } = en;
  for (let room = 0; room < 3; room++) {
    drawRoom(en, room); const bn = grab(en.rd);
    let bo = null; if (eo) { drawRoom(eo, room); bo = grab(eo.rd); }
    for (let row = 0; row < 22; row++) for (let col = 0; col < 32; col++) {
      const id = rd(L.MapaRAM + row * 96 + room * 32 + col);
      const srow = row + 1;
      if (id >= 0x43 && id <= 0x48) {
        const tile = 0x86 + id - 0x43;
        if (!seen.has(tile)) seen.set(tile, new Set());
        for (const i of cellIdxSet(bn, col, srow)) seen.get(tile).add(i);
      }
      if (!bo) continue;
      let diff = false;
      for (let pl = 0; pl < 3 && !diff; pl++) for (let y = 0; y < 8; y++) {
        const lo = 255 - (srow * 8 + y);
        if (at(bn, pl, col, lo) !== at(bo, pl, col, lo)) { diff = true; break; }
      }
      if (!diff) continue;
      cmpCells++;
      if (id >= 0x43 && id <= 0x48) cmpGemCells++;
      else if (cmpOther.length < 20) cmpOther.push(`пир ${p} комн ${room} стб ${col} ряд ${srow} map 0x${id.toString(16)}`);
    }
  }
}

console.log("--- ЦВЕТ КАЖДОГО ТАЙЛА ГЕМА (замер по пикселям экрана) ---");
for (const t of [0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b]) {
  const s = seen.get(t);
  if (!s) { console.log(`  тайл 0x${t.toString(16)}: не встретился на проверенных пирамидах`); continue; }
  const list = [...s];
  const ok = list.length === 1;
  const i = list[0];
  console.log(`  тайл 0x${t.toString(16)}: idx ${list.join(",")}` +
    (ok ? `  = ${PLANES[i]} -> ${NAMES[i]}` : "   <<< НЕ ОДНОТОННЫЙ"));
}
const uniq = new Set([...seen.values()].map(s => [...s].join(",")));
console.log(`РАЗНЫХ ЦВЕТОВ У ГЕМОВ: ${uniq.size} из ${seen.size} тайлов` + (uniq.size === seen.size ? " — все разные" : "  <<< ЕСТЬ ПОВТОРЫ"));

if (OROM) {
  console.log(`\n--- СРАВНЕНИЕ С ${OROM} (все комнаты пирамид ${PYRS.join(",")}) ---`);
  console.log(`  различающихся клеток: ${cmpCells}, из них клеток гемов: ${cmpGemCells}`);
  if (cmpOther.length) { console.log("  НЕ-ГЕМОВЫЕ различия (первые 20):"); for (const s of cmpOther) console.log("    " + s); }
  else console.log("  НЕ-ГЕМОВЫХ различий НЕТ — остальной рендер не тронут");
}
