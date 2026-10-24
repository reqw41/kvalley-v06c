// ПОЯЧЕЕЧНАЯ КАРТА БЛОКА ИГРОВЫХ ПЕРЕМЕННЫХ (GameStatus..stackArea-1).
//
// Чем отличается от tools/debug/lowram_audit.js: тот считает ЛЮБЫЕ обращения, а блочные
// очистки (startCode и loadGameGfx через vec_ldir_fwd) проходят по ВСЕМУ блоку и дают
// R>0/W>0 на каждом байте — из-за этого мёртвых ячеек в его отчёте не видно вовсе.
// Здесь обращения из тела vec_ldir_* ИСКЛЮЧЕНЫ, поэтому «R=0 W=0» означает ровно
// «к ячейке не обращался никто, кроме зануления».
//
// Сценарий шире: чит N прогоняет ВСЕ 15 пирамид (иначе массивы объектов — кирки,
// вращающиеся двери, стены-ловушки — меряются только по первой-второй пирамиде и их
// хвосты выглядят мёртвыми ложно).
//
// Запуск: node tools/debug/varblock_map.js [rom] [sym]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const ROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[3] || ROM.replace(/\.rom$/, ".sym");

const g = {}; g.window = g;
const stub = () => ({ width: 0, height: 0, style: {}, getContext: () => ({
  createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {},
  getImageData: () => ({ data: new Uint8ClampedArray(4) }), drawImage: () => {}, fillRect: () => {},
  save: () => {}, restore: () => {}, scale: () => {}, setTransform: () => {} }) });
g.document = { createElement: stub, getElementById: stub };
g.requestAnimationFrame = () => 0; g.setTimeout = () => 0; g.print = () => 0; g.console = console;
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js", "i8080-js/i8080_disasm.js", "i8080-js/i8080.js",
  "src/fili.js", "src/ay.js", "src/fd1793.js", "src/fddimage.js", "src/i8253.js",
  "src/io.js", "src/keyboard.js", "src/memory.js", "src/sound.js", "src/tv.js"])
  vm.runInContext(fs.readFileSync(base + "/" + f, "utf8"), ctx, { filename: f });

const L = {};
for (const line of fs.readFileSync(SYM, "latin1").split("\n")) {
  const m = line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16);
}
// ЗАДАЧА#48 (2026-08-04): блок переехал в p3 (GameStatus=0xFD38), а стек — НИЖЕ него
// (stackArea=0xF6A5), поэтому старая граница `stackArea-1` для новой раскладки не годится.
// Конец блока теперь — последняя переменная muroTrampaDat (15 Б, шаг 5, 3 ловушки).
const LO = L.GameStatus,
      HI = L.stackArea > L.GameStatus ? L.stackArea - 1 : L.muroTrampaDat + 14;
// Тело блочных копий/очисток: обращения отсюда — это зануление, а не «жизнь» ячейки.
const CL_LO = L.vec_ldir_fwd, CL_HI = L.vec_ldir_bwd_lp + 16;

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
timer.Write(3, 0x36); timer.Write(3, 0x76); timer.Write(3, 0xb6);

const N = HI - LO + 1;
const R = new Uint32Array(N), W = new Uint32Array(N);   // БЕЗ обращений из vec_ldir_*
const Rc = new Uint32Array(N), Wc = new Uint32Array(N); // только очистки
const srcPC = {};                                       // адрес -> Set(pc)
const ord = memory.read.bind(memory), owr = memory.write.bind(memory);
const note = (aa, pc, arr, carr) => {
  const clear = pc >= CL_LO && pc <= CL_HI;
  if (clear) { carr[aa - LO]++; return; }
  arr[aa - LO]++;
  const s = srcPC[aa] || (srcPC[aa] = new Set());
  if (s.size < 8) s.add(pc);
};
memory.read = function (a, s) {
  const aa = a & 0xffff;
  if (aa >= LO && aa <= HI) note(aa, cpu.pc & 0xffff, R, Rc);
  return ord(a, s);
};
memory.write = function (a, v, s) {
  const aa = a & 0xffff;
  if (aa >= LO && aa <= HI) note(aa, cpu.pc & 0xffff, W, Wc);
  return owr(a, v, s);
};

const rd = a => ord(a & 0xffff, false), wr = (a, v) => owr(a & 0xffff, v, false);
let frames = 0;
const run = n => { for (let i = 0; i < n; i++) { v06c.oneInterrupt(true); frames++; } };
const key = (code, down) => { const e = { keyCode: code, which: code, preventDefault() {}, stopPropagation() {} };
  if (down) keyboard.keyDown(e); else keyboard.keyUp(e); };
const GS = L.GameStatus;

run(400);
let ok = false;
for (let blk = 0; blk < 60 && !ok; blk++) {
  for (let f = 0; f < 25; f++) { key(32, true); run(1); if (rd(GS) === 5 && (rd(L.flagPiramideMap) & 1)) { ok = true; break; } }
  key(32, false); run(5);
}
if (!ok) { console.log("НЕ ВОШЛИ В ГЕЙМПЛЕЙ"); process.exit(2); }

let seed = 20260803; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const KEYS = [37, 39, 38, 40, 32];
const play = n => {
  for (let f = 0; f < n; f++) {
    const k = KEYS[(rnd() * KEYS.length) | 0];
    key(k, true); run(1); if (rnd() < 0.35) key(k, false);
    for (const kk of KEYS) if (rnd() < 0.2) key(kk, false);
  }
  for (const kk of KEYS) key(kk, false);
  run(10);
};
const pyrSeen = {};
play(500);
pyrSeen[rd(L.piramideActual)] = (pyrSeen[rd(L.piramideActual)] || 0) + 1;
// --- ВСЕ 15 пирамид читом N ------------------------------------------------------
// Чередуем N (+1) и H (+5): одним N дальше 9-й пирамиды не уехать за разумное число кадров,
// а максимумы объектов (12 кирок, 2 вращающиеся двери, 6 гемов) сидят в 12-14-й.
for (let step = 0; step < 22; step++) {
  const ck = (step % 3 === 2) ? 72 : 78;
  key(ck, true); run(3); key(ck, false);
  for (let f = 0; f < 900; f++) { run(1); if (rd(GS) === 5) break; }
  run(40);
  pyrSeen[rd(L.piramideActual)] = (pyrSeen[rd(L.piramideActual)] || 0) + 1;
  play(420);
}
// --- редкие ветки ------------------------------------------------------------------
for (const st of [6, 7, 8, 10]) {
  wr(GS, st); wr(L.subStatus, 0); run(400);
  if (rd(GS) !== 5) for (let b = 0; b < 20 && rd(GS) !== 5; b++) { key(32, true); run(10); key(32, false); run(10); }
}
run(100);

// ------------------------------- ОТЧЁТ ---------------------------------------------
const syms = Object.entries(L).map(([n, a]) => [a, n]).filter(([a]) => a >= LO && a <= HI)
  .sort((x, y) => x[0] - y[0]);
console.log(`прогон ${frames} кадров; пирамиды: ${JSON.stringify(pyrSeen)}`);
console.log(`исключены обращения из vec_ldir_* (0x${CL_LO.toString(16)}-0x${CL_HI.toString(16)})`);
console.log("\n== по символам: живые байты / размер, хвост без обращений ==");
let deadTotal = 0;
for (let i = 0; i < syms.length; i++) {
  const a = syms[i][0], b = (i + 1 < syms.length ? syms[i + 1][0] : HI + 1) - 1;
  if (b < a) continue;
  let live = 0, last = -1;
  for (let p = a; p <= b; p++) if (R[p - LO] || W[p - LO]) { live++; last = p; }
  const tail = b - last;              // сколько байт хвоста ни разу не тронуто
  deadTotal += (b - a + 1) - live;
  const mark = live === 0 ? "  <== ВСЯ ЯЧЕЙКА БЕЗ ОБРАЩЕНИЙ" : (tail > 0 ? `  хвост ${tail}Б без обращений` : "");
  console.log(`0x${a.toString(16)}-0x${b.toString(16)} ${String(b - a + 1).padStart(4)}Б ${syms[i][1].padEnd(18)} живых ${String(live).padStart(4)} R=${(() => { let s = 0; for (let p = a; p <= b; p++) s += R[p - LO]; return s; })()} W=${(() => { let s = 0; for (let p = a; p <= b; p++) s += W[p - LO]; return s; })()}${mark}`);
}
console.log(`\nвсего байт без единого обращения (кроме зануления): ${deadTotal}`);
console.log("\n== сплошные зоны без обращений (>=2Б) ==");
let s = -1, tot = 0;
for (let a = LO; a <= HI + 1; a++) {
  const busy = a > HI || R[a - LO] || W[a - LO];
  if (!busy) { if (s < 0) s = a; }
  else if (s >= 0) { if (a - s >= 2) { console.log(`  0x${s.toString(16)}-0x${(a - 1).toString(16)}  ${a - s}Б`); tot += a - s; } s = -1; }
}
console.log(`  итого в зонах >=2Б: ${tot}Б`);
