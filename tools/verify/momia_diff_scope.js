// momia_diff_scope.js — ГДЕ ИМЕННО РАЗОШЛИСЬ ДВЕ СБОРКИ. Тот же тик-в-тик прогон, что у
// coltab_frame_parity.js (одинаковый скрипт клавиш, снимок на границе игрового тика,
// поэтому обе сборки исполняют одну и ту же логику), но расхождение не просто считается,
// а АТРИБУТИРУЕТСЯ: попал ли байт в габарит какой-нибудь МУМИИ (слоты 6-13) или нет.
//
// ЗАЧЕМ. Правка цвета мумий обязана менять картинку РОВНО в клетках мумий и нигде больше.
// Обычная сверка на такой правке всегда красная (цвет и должен был измениться), и по её
// выводу нельзя отличить «поменялся цвет мумии» от «поехал фон».
//
// Габарит берётся ОБЪЕДИНЕНИЕМ по обеим сборкам и по двум источникам сразу — ШАПКЕ
// save-under (слот +1..+3) и ЗАПИСИ ВЫВОДА (слот +0x97..+0x99), потому что на границе
// тика мумия может быть уже подготовлена в новую позицию, но ещё нарисована в старой.
// Габарит расширен на 1 столбец и на 1 строку с каждой стороны: гашение чужой плоскости
// и стирание прошлого кадра ходят по тем же байтам.
//
// Запуск: node tools/verify/momia_diff_scope.js <romA> <romB> [тиков=2600]
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
  const L = {};
  for (const l of fs.readFileSync(rom.replace(/\.rom$/, ".sym"), "latin1").split("\n")) {
    const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16); }
  return { v, memory, keyboard, io, L, tick: 0, prevT: 0, held: new Set() };
}
const A = mk(process.argv[2]), B = mk(process.argv[3]);
const NT = +(process.argv[4] || 2600);
function keysFor(t) {                       // ТОТ ЖЕ скрипт, что в coltab_frame_parity
  const k = [];
  if (t < 900) { if ((t >> 2) & 1) k.push(32); }
  else if (t < 1000) { k.push(39); }
  else if (t < 1010) { k.push(78); }
  else if (t < 1300) { if (t & 8) k.push(39); else k.push(37); }
  else if (t < 1310) { k.push(78); }
  else if (t < 1600) { if (t & 8) k.push(38); else k.push(39); }
  else if (t < 1640) { k.push(78); }
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
function snap(M) {
  const b = new Uint8Array(3 * 8192);
  for (let i = 0; i < 8192; i++) {
    b[i] = M.memory.read(0x8000 + i); b[8192 + i] = M.memory.read(0xA000 + i);
    b[16384 + i] = M.memory.read(0xC000 + i);
  }
  return b;
}
// габариты мумий: [c0, c1) x [loLow, loHigh] с запасом в один байт по каждой оси
function boxes(M) {
  const out = [];
  for (let idx = 6; idx <= 13; idx++) {
    const pg = 0xE000 + idx * 256;
    for (const [hiA, loA, ncA] of [[1, 2, 3], [0x97, 0x98, 0x99]]) {
      const hi = M.memory.read(pg + hiA), lo = M.memory.read(pg + loA), nc = M.memory.read(pg + ncA);
      if (!nc || !hi) continue;
      const c0 = hi & 0x1F;
      // столбец fb = 16 подряд байт ВВЕРХ от lo0 (lo0 = 239-Y = НИЗ фигуры, см. vec_spr_prep)
      out.push([Math.max(0, c0 - 1), Math.min(32, c0 + nc + 1), Math.max(0, lo - 1), Math.min(255, lo + 16)]);
    }
  }
  return out;
}
function toTick(M, T) {
  let frames = 0;
  while (M.tick <= T && frames < 400000) {
    setKeys(M, M.tick);
    M.v.oneInterrupt(true); frames++;
    const t = M.memory.read(M.L.timer);
    if (t !== M.prevT) { M.prevT = t; M.tick++; }
  }
  return snap(M);
}
let ticksDiff = 0, bytesIn = 0, bytesOut = 0, checked = 0;
const outCells = new Map();
for (let T = 20; T <= NT; T += 10) {
  const sa = toTick(A, T), sb = toTick(B, T);
  checked++;
  const bx = boxes(A).concat(boxes(B));
  let d = 0;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] === sb[i]) continue;
    d++;
    const col = (i & 8191) >> 8, lo = i & 255;
    let inside = false;
    for (const [c0, c1, l0, l1] of bx) if (col >= c0 && col < c1 && lo >= l0 && lo <= l1) { inside = true; break; }
    if (inside) bytesIn++;
    else { bytesOut++; const k = `c${col}/lo${lo}`; outCells.set(k, (outCells.get(k) || 0) + 1); }
  }
  if (d) ticksDiff++;
}
console.log(`контрольных тиков ${checked}, с расхождением ${ticksDiff}`);
console.log(`байт расхождения: В ГАБАРИТАХ МУМИЙ ${bytesIn}, ВНЕ ${bytesOut}`);
if (bytesOut) {
  const top = [...outCells].sort((a, b) => b[1] - a[1]).slice(0, 40);
  console.log("байты ВНЕ габаритов мумий (адрес -> сколько раз): " + top.map(([k, n]) => `${k}:${n}`).join("  "));
}
console.log(bytesOut === 0
  ? "ВЕРДИКТ: картинка расходится ТОЛЬКО в габаритах мумий — OK"
  : "ВЕРДИКТ: есть расхождения ВНЕ мумий — разобраться");
