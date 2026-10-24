// Скриншот комнаты с сокровищами: ЧЕСТНЫЙ кадр эмулятора (v06c.bmp через PixelFiller),
// 1:1 с браузером. Нужен, чтобы глазами сверить «до/после» по цвету гемов.
//
// Запуск: node tools/verify/gem_shot.js <пирамида> <сколько-скроллов l/r> <out.png> [rom] [sym]
//   node tools/verify/gem_shot.js 2 ""  /tmp/a.png   — комната, где стоит герой
//   node tools/verify/gem_shot.js 2 "l" /tmp/b.png   — после честного скролла влево
"use strict";
const fs = require("fs"), vm = require("vm"), zlib = require("zlib");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const PIR = Number(process.argv[2] || 2);
const DIR = process.argv[3] || "";
const OUT = process.argv[4] || "/tmp/gem_shot.png";
const ROM = process.argv[5] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[6] || REPO + "/build/kvalley_8c.sym";
const PHASE = Number(process.env.KV_PHASE || 0);   // доп. кадры: слот ауры мерцает по фазам

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
const L = {};
for (const line of fs.readFileSync(SYM, "latin1").split("\n")) {
  const m = line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16);
}
const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), timer = new ctx.I8253(),
  ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(), io = new ctx.IO(keyboard, timer, memory, ay, floppy);
const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
const v06c = new ctx.Vector06c(cpu, memory, io, ay, tape);
const W = 576, H = 288;
v06c.bmp = new Uint32Array(W * H); v06c.displayFrame = () => {};
v06c.check_breakpoint = () => false; v06c.dbg = null;
const img = new Uint8Array(fs.readFileSync(ROM));
memory.init_from_array(img.subarray(0, 0x10000), 0x100);
memory.detach_boot && memory.detach_boot();
cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;
const rd = a => memory.read(a, false), wr = (a, v) => memory.write(a, v, false);

let n = 0; while (n < 4000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); n++; }
while (rd(L.piramideActual) !== PIR) {
  const cur = rd(L.piramideActual);
  wr(L.piramideDest, cur + 1); wr(L.subStatus, 0); wr(L.GameStatus, 8);
  let m = 0; while (m < 4000 && rd(L.piramideActual) === cur) { v06c.oneInterrupt(true); m++; }
  if (rd(L.piramideActual) === cur) throw new Error("пирамида не сменилась");
}
let k = 0; while (k < 2000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); k++; }

for (let d of DIR) {
  const from = rd(L.ProtaRoom);
  if (from === 0) d = "r"; else if (from === 2) d = "l";
  let m = 0;
  while (rd(L.GameStatus) !== 9 && m < 300) {
    wr(L.sentidoProta, d === "l" ? 1 : 2); wr(L.ProtaX, d === "l" ? 0 : 0x0F6);
    v06c.oneInterrupt(true); m++;
  }
  let f = 0; while (rd(L.GameStatus) === 9 && f < 400) { v06c.oneInterrupt(true); f++; }
}
for (let f = 0; f < 4 + PHASE; f++) v06c.oneInterrupt(true);
process.stderr.write(`пирамида ${rd(L.piramideActual)} комната ${rd(L.ProtaRoom)} GS=${rd(L.GameStatus)} -> ${OUT}\n`);

// KV_CROP="стб,ряд,ширина_в_клетках,высота_в_клетках,увеличение" — вырезка вокруг клетки.
// Экран лежит в bmp 576x288 с рамкой: пиксель Вектора = 2 bmp-точки по X, 1 по Y.
// Замерено KV_BOUNDS: непустая область x 32..543, y 49..239 => клетка (col,row)
// начинается в (32+col*16, 48+row*8).
let bmp = v06c.bmp, w = W, h = H;
if (process.env.KV_BOUNDS) {   // калибровка: где в bmp лежит поле 256x256
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if ((bmp[y * W + x] & 0xffffff) !== 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  process.stderr.write(`непустая область bmp: x ${x0}..${x1}, y ${y0}..${y1}\n`);
}
if (process.env.KV_CROP) {
  const [c0, r0, cw, ch, z] = process.env.KV_CROP.split(",").map(Number);
  const x0 = 32 + c0 * 16, y0 = 48 + r0 * 8, sw = cw * 16, sh = ch * 8;
  w = sw * z; h = sh * z;
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    out[y * w + x] = bmp[(y0 + ((y / z) | 0)) * W + (x0 + ((x / z) | 0))];
  bmp = out;
}
const rgb = Buffer.alloc(w * h * 3);
for (let i = 0; i < w * h; i++) { const c = bmp[i] >>> 0; rgb[i * 3] = c & 255; rgb[i * 3 + 1] = (c >> 8) & 255; rgb[i * 3 + 2] = (c >> 16) & 255; }
const W2 = w, H2 = h;
const crcT = (() => { const t = []; for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c; } return t; })();
function crc(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 0xff] ^ (c >>> 8); return c ^ 0xffffffff; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const tt = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(tt) >>> 0); return Buffer.concat([l, tt, c]); }
const raw = Buffer.alloc(H2 * (W2 * 3 + 1));
for (let y = 0; y < H2; y++) { raw[y * (W2 * 3 + 1)] = 0; rgb.copy(raw, y * (W2 * 3 + 1) + 1, y * W2 * 3, (y + 1) * W2 * 3); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W2, 0); ihdr.writeUInt32BE(H2, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(OUT, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
