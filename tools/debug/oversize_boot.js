// ПРОВЕРКА ПОТОЛКА ОБРАЗА: грузится ли и стартует ли .rom БОЛЬШЕ прежних 28К.
//
// Зачем: паддинг образа до 28*1024 стоял в build.sh как самодельное ограничение, и было
// неизвестно, переживёт ли загрузчик образ длиннее. Скрипт добивает текущий ROM нулями до
// заданного размера и проверяет, что игра доходит до геймплея (GameStatus=5) и рисует кадр.
//
// Запуск: node tools/debug/oversize_boot.js [rom] [sym] [размер1 размер2 ...]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const ROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[3] || REPO + "/build/kvalley_8c.sym";
const SIZES = process.argv.slice(4).map(Number);
const L = {};
for (const l of fs.readFileSync(SYM, "latin1").split("\n")) {
  const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16);
}
const orig = fs.readFileSync(ROM);
const sizes = SIZES.length ? SIZES : [orig.length, 28 * 1024, 30 * 1024, 0x8000 - 0x100];

function boot(img) {
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
  const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), timer = new ctx.I8253(),
    ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(), io = new ctx.IO(keyboard, timer, memory, ay, floppy);
  const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
  const v = new ctx.Vector06c(cpu, memory, io, ay, tape);
  v.bmp = new Uint32Array(576 * 288); v.displayFrame = () => {};
  v.check_breakpoint = () => false; v.dbg = null;
  memory.init_from_array(new Uint8Array(img).subarray(0, 0x10000), 0x100);
  memory.detach_boot && memory.detach_boot();
  cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;
  return { v, memory, keyboard };
}
let fail = 0;
for (const n of sizes) {
  const img = Buffer.concat([orig, Buffer.alloc(Math.max(0, n - orig.length))]).subarray(0, Math.max(n, orig.length));
  const e = boot(img);
  const rd = a => e.memory.read(a & 0xffff);
  const key = (c, d) => { const ev = { keyCode: c, which: c, preventDefault() {}, stopPropagation() {} };
    d ? e.keyboard.keyDown(ev) : e.keyboard.keyUp(ev); };
  for (let f = 0; f < 400; f++) e.v.oneInterrupt(true);
  let ok = false;
  for (let blk = 0; blk < 60 && !ok; blk++) {
    for (let f = 0; f < 25; f++) { key(32, true); e.v.oneInterrupt(true);
      if (rd(L.GameStatus) === 5 && (rd(L.flagPiramideMap) & 1)) { ok = true; break; } }
    key(32, false); for (let f = 0; f < 5; f++) e.v.oneInterrupt(true);
  }
  for (let f = 0; f < 120; f++) e.v.oneInterrupt(true);
  // непустой кадр = картинка есть
  let px = 0; for (let i = 0; i < e.v.bmp.length; i++) if (e.v.bmp[i] !== e.v.bmp[0]) px++;
  const verdict = ok && px > 1000;
  if (!verdict) fail = 1;
  console.log(`образ %s Б (до 0x%s): GameStatus=%d, непустых пикселей %d -> %s`
    .replace("%s", String(img.length)).replace("%s", (0x100 + img.length).toString(16))
    .replace("%d", rd(L.GameStatus)).replace("%d", px).replace("%s", verdict ? "СТАРТУЕТ" : "НЕ СТАРТУЕТ"));
}
process.exit(fail);
