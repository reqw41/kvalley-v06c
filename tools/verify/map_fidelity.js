// ПОЛНОСТЬЮ ЛИ MapaRAM ОПИСЫВАЕТ ИГРОВОЕ ПОЛЕ? Это гейт для любой оптимизации, которая
// хочет пропускать работу по сравнению байтов карты (напр. «не переносить клетку, если
// map[r][c] == map[r][c-4]» при скролле, см. заметку в шапке vec_nr_win).
//
// Метод без моделирования блиттера: патчим ROM В ПАМЯТИ так, что шаг скролла НЕ сдвигает
// плоскости, а перерисовывает ВСЁ окно (c0=0, cend=32), и ставим waitCounter=0x24 —
// тогда смещение окна первого шага равно 0, то есть комната перерисовывается из карты
// ровно на своём текущем месте. Разница экрана до/после = клетки, нарисованные МИМО карты.
//
// Запуск: node tools/verify/map_fidelity.js [rom] [sym]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const ROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[3] || REPO + "/build/kvalley_8c.sym";

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
  if (v06c.soundnik) v06c.soundnik.soundStep = () => {};
  const img = new Uint8Array(fs.readFileSync(ROM));
  memory.init_from_array(img.subarray(0, 0x10000), 0x100);
  memory.detach_boot && memory.detach_boot();
  cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;
  return { v06c, cpu, memory, L, rd: a => memory.read(a, false), wr: (a, v) => memory.write(a, v, false) };
}
function grab(rd) {
  const b = Buffer.alloc(3 * 32 * 256);
  for (let pl = 0; pl < 3; pl++) for (let c = 0; c < 32; c++) for (let lo = 0; lo < 256; lo++)
    b[(pl * 32 + c) * 256 + lo] = rd(0x8000 + pl * 0x2000 + c * 256 + lo);
  return b;
}
function trial(delay) {
  const e = boot(), { v06c, cpu, rd, wr, L } = e;
  const GS = L.GameStatus, SENT = L.sentidoProta, PX = L.ProtaX, WC = L.waitCounter, ROOM = L.ProtaRoom;
  const T6 = L.tickScroll6, SHIFT = L.vec_scroll_shift, NRWIN = L.vec_nr_win;
  let callAt = -1;
  for (let a = T6 - 40; a < T6; a++)
    if (rd(a) === 0xCD && rd(a + 1) === (SHIFT & 255) && rd(a + 2) === (SHIFT >> 8)) callAt = a;
  if (callAt < 0) throw new Error("не найден call vec_scroll_shift перед tickScroll6");
  wr(callAt, 0); wr(callAt + 1, 0); wr(callAt + 2, 0);          // сдвиг -> 3 x nop
  if (rd(T6 - 2) !== 0x3E) throw new Error("ожидался ld a,28 перед tickScroll6");
  wr(T6 - 1, 0);                                                // c0 = 0 в обеих ветках
  if (rd(T6 + 3) !== 0xC6) throw new Error("ожидался add a,4");
  wr(T6 + 4, 32);                                               // cend = 32 (всё окно)
  let n = 0; while (n < 3000 && rd(GS) !== 5) { v06c.oneInterrupt(true); n++; }
  for (let i = 0; i < delay; i++) v06c.oneInterrupt(true);
  const room = rd(ROOM);
  let m = 0; while (rd(GS) !== 9 && m < 200) { wr(SENT, 2); wr(PX, 0xF6); v06c.oneInterrupt(true); m++; }
  if (rd(GS) !== 9) return null;
  wr(WC, 0x24);                                                 // смещение окна 1-го шага = 0
  let hits = 0, before = null, after = null;
  v06c.check_breakpoint = function () {
    if (cpu.pc === NRWIN) { hits++; if (hits === 1) before = grab(rd); else if (hits === 2) after = grab(rd); }
    return false;
  };
  let f = 0; while (rd(GS) === 9 && f < 400 && !after) { v06c.oneInterrupt(true); f++; }
  if (!before || !after) return null;
  let bad = 0; const cells = new Set();
  for (let pl = 0; pl < 3; pl++) for (let c = 0; c < 32; c++) for (let lo = 72; lo <= 247; lo++) {
    const i = (pl * 32 + c) * 256 + lo;
    if (before[i] !== after[i]) { bad++; cells.add(`стб${c}/ряд${Math.floor((255 - lo) / 8)}`); }
  }
  return { room, bad, cells: [...cells] };
}
for (const d of [50, 200, 400, 700, 1000, 1400]) {
  const r = trial(d);
  if (!r) { console.log(`задержка ${d}: скролл не запустился`); continue; }
  console.log(`задержка ${d} (комната ${r.room}): экран расходится с перерисовкой из карты на ${r.bad} Б` +
    (r.cells.length ? `, клетки: ${r.cells.slice(0, 12).join(" ")}${r.cells.length > 12 ? " …" : ""}`
                    : " — карта описывает поле полностью"));
}
