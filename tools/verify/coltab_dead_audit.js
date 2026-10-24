// coltab_dead_audit.js — ЗАДАЧА #35: перепись ВСЕХ загрузок MSX-таблицы цвета и доказательство,
// что каждая из них холостая.
//
// ЧТО ДЕЛАЕТ (на живом ROM, ничего не патчит):
//   * окно = вызов верхнеуровневого VDP-помощника (UnpackPatterns / unpackGFXset / fillVRAM3Bank /
//     setFillVRAM / DEtoVRAMset) ИЗ ИГРОВОГО КОДА. Точка вызова берётся как адрес возврата со
//     стека в момент входа — это устойчиво к прерываниям (в отличие от теневого стека вызовов);
//   * внутри окна ставит трап на ОБА приёмника MSX-цвета — vec_de_col (bulk DE->VRAM) и
//     vec_fill_col (заливка); оба упираются в vec_col_store;
//   * на время каждого захода в цветовой путь включает наблюдение за ВСЕМИ записями в память
//     с указанием PC, который писал. Записи делятся на служебные (vec_vdp_ptr / vec_fill_val /
//     стек), «чужие» (сделанные из обработчика прерывания — музыка/таймеры) и НАСТОЯЩИЕ
//     (что-либо, записанное самим цветовым путём: тень паттернов, vec_spr_buf, vec_tilemode,
//     vec_mixbuf, экранные плоскости);
//   * считает такты цветового пути и такты всего окна по каждой точке вызова.
//
// Сценарий: логотип Konami -> титул/меню -> геймплей пирамиды 1 -> четыре чита N (пирамиды 2..5,
// пирамида 5 = другая схема ColoresPiedra) с прохождением карты долины между ними.
// soundnik.soundStep НЕ глушим — он тактует ВИ53 (часы музыки).
//
// Запуск: node tools/verify/coltab_dead_audit.js [rom] [sym]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const ROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[3] || REPO + "/build/kvalley_8c.sym";
const hex = x => "0x" + (x >>> 0).toString(16);

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
const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), timer = new ctx.I8253(),
  ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(), io = new ctx.IO(keyboard, timer, memory, ay, floppy);
const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
const v06c = new ctx.Vector06c(cpu, memory, io, ay, tape);
v06c.bmp = new Uint32Array(576 * 288); v06c.displayFrame = () => {};
v06c.check_breakpoint = () => false; v06c.dbg = null;
memory.init_from_array(new Uint8Array(fs.readFileSync(ROM)).subarray(0, 0x10000), 0x100);
memory.detach_boot && memory.detach_boot();
cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;
timer.Write(3, 0x36); timer.Write(3, 0x76); timer.Write(3, 0xb6); ay.reset && ay.reset();

const L = {};
for (const line of fs.readFileSync(SYM, "latin1").split("\n")) {
  const m = line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16);
}
const syms = Object.entries(L).map(([n, a]) => [a, n]).sort((x, y) => x[0] - y[0]);
const resolve = t => { let p = syms[0]; for (const s of syms) { if (s[0] <= t) p = s; else break; }
  return t === p[0] ? p[1] : `${p[1]}+${t - p[0]}`; };

const ord = memory.read.bind(memory), owr = memory.write.bind(memory);
const rd = a => ord(a & 0xffff, false), r16 = a => rd(a) | (rd(a + 1) << 8);
const run = n => { for (let i = 0; i < n; i++) v06c.oneInterrupt(true); };
const key = (c, d) => { const ev = { keyCode: c, which: c, preventDefault() {}, stopPropagation() {} };
  d ? keyboard.keyDown(ev) : keyboard.keyUp(ev); };

// служебные ячейки цветового пути — их запись НЕ считается «данными»
const BOOK = new Set([L.vec_vdp_ptr, L.vec_vdp_ptr + 1, L.vec_fill_val]);
// диапазон кода цветового пути: всё между vec_fill_col и концом vec_de_col + сам vec_col_store
const COLCODE = a => (a >= L.vec_fill_col && a < L.vec_fill_all) ||
                     (a >= L.vec_de_col && a < L.vec_de_sprb) ||
                     (a >= L.vec_col_store && a < L.vec_col_store + 4) ||
                     (a >= L.vec_is_gem_col && a < L.vec_is_gem_col + 48);
let inCol = null, curPC = 0;
memory.write = function (a, v, s) {
  a &= 0xffff;
  if (inCol) {
    const sp = cpu.sp & 0xffff;
    if (BOOK.has(a)) inCol.book++;
    else if (a >= sp - 6 && a <= sp + 8) inCol.book++;         // стековая возня
    else if (!COLCODE(curPC)) inCol.alien.set(curPC, (inCol.alien.get(curPC) || 0) + 1);
    else inCol.real.set(a, (inCol.real.get(a) || 0) + 1);      // писал САМ цветовой путь
  }
  return owr(a, v, s);
};

// --- окна верхнеуровневых VDP-помощников ------------------------------------------------
const ENTRIES = new Set([L.UnpackPatterns, L.unpackGFXset, L.fillVRAM3Bank, L.setFillVRAM,
  L.DEtoVRAMset, L.fillVRAM3Bank2]);
const COL_ENTRIES = new Set([L.vec_de_col, L.vec_fill_col]);
let cyc = 0, armed = false, phase = "boot", win = null;
const sites = new Map();  // ключ "call-site" -> статистика

const orig = cpu.instruction.bind(cpu);
cpu.instruction = function () {
  const pc = cpu.pc & 0xffff, sp0 = cpu.sp & 0xffff;
  const bc = (cpu.reg(0) << 8) | cpu.reg(1), hl = (cpu.reg(4) << 8) | cpu.reg(5);
  curPC = pc;
  if (armed) {
    if (!win && ENTRIES.has(pc)) win = { ra: r16(sp0), sp: sp0, t0: cyc, hl, colCyc: 0, colN: 0,
      bytes: 0, real: new Map(), alien: new Map(), book: 0 };
    else if (win && pc === win.ra && sp0 > win.sp) {
      const k = `${resolve(win.ra - 3)} (HL=${hex(win.hl)})`;
      let s = sites.get(k);
      if (!s) sites.set(k, s = { n: 0, cyc: 0, colCyc: 0, colN: 0, bytes: 0, real: new Map(),
        alien: new Map(), book: 0, phases: new Set() });
      s.n++; s.cyc += cyc - win.t0; s.colCyc += win.colCyc; s.colN += win.colN;
      s.bytes += win.bytes; s.book += win.book; s.phases.add(phase);
      for (const [a, n] of win.real) s.real.set(a, (s.real.get(a) || 0) + n);
      for (const [a, n] of win.alien) s.alien.set(a, (s.alien.get(a) || 0) + n);
      win = null;
    }
    if (win && !inCol && COL_ENTRIES.has(pc)) {
      inCol = { t0: cyc, sp: sp0, real: win.real, alien: win.alien };
      win.colN++; win.bytes += bc & 0xffff;
    }
  }
  orig();
  cyc += cpu.vcycles | 0;
  if (inCol) {
    const sp1 = cpu.sp & 0xffff;
    // выход из цветового пути: PC ушёл из его кода при SP не глубже входного
    if (!COLCODE(cpu.pc & 0xffff) && sp1 >= inCol.sp) {
      if (win) win.colCyc += cyc - inCol.t0;
      inCol = null;
    }
  }
};

// --- сценарий ---------------------------------------------------------------------------
armed = true;
phase = "1 логотип Konami + титул";
run(300);
for (let i = 0; i < 400 && rd(L.GameStatus) !== 1; i++) run(1);
run(40);
phase = "2 меню -> карта -> пирамида 1";
let ok = false;
for (let blk = 0; blk < 60 && !ok; blk++) {
  for (let f = 0; f < 25; f++) { key(32, true); run(1);
    if (rd(L.GameStatus) === 5 && (rd(L.flagPiramideMap) & 1)) { ok = true; break; } }
  key(32, false); run(5);
}
if (!ok) { console.error("НЕ удалось войти в геймплей"); process.exit(2); }
run(60);
for (let p = 2; p <= 5; p++) {
  phase = `${p + 1} чит N -> карта -> пирамида ${p}`;
  key(78, true); run(3); key(78, false);
  for (let f = 0; f < 900 && !(rd(L.GameStatus) === 5 && (rd(L.flagPiramideMap) & 1) &&
       rd(L.piramideActual) === p); f++) run(1);
  run(40);
}

// --- отчёт ------------------------------------------------------------------------------
const rows = [...sites.entries()].filter(([, s]) => s.colN > 0).sort((a, b) => b[1].colCyc - a[1].colCyc);
let grandCyc = 0, grandReal = 0;
console.log("ТОЧКИ ВЫЗОВА, ЗАХОДЯЩИЕ В MSX-ТАБЛИЦУ ЦВЕТА (vec_de_col / vec_fill_col -> vec_col_store)\n");
console.log("окон | заходов | байт цвета | тактов ЦВЕТА | тактов окна | НАСТОЯЩИХ записей | чужих (ISR)");
for (const [k, s] of rows) {
  grandCyc += s.colCyc; grandReal += s.real.size;
  const r = s.real.size ? `!!! ${s.real.size} адр. [${[...s.real.keys()].sort((a, b) => a - b)
    .slice(0, 8).map(hex).join(",")}]` : "0 (ПУСТО)";
  const al = [...s.alien.values()].reduce((a, b) => a + b, 0);
  console.log(`${String(s.n).padStart(4)} |${String(s.colN).padStart(8)} |${String(s.bytes).padStart(9)} Б |` +
    `${String(s.colCyc).padStart(11)} |${String(s.cyc).padStart(10)} | ${r.padEnd(22)}| ${al}`);
  console.log(`     ${k}    [${[...s.phases].sort().join("; ")}]`);
}
console.log(`\nИТОГО: ${rows.length} точек вызова, ${grandCyc} тактов в цветовом пути, ` +
  `НАСТОЯЩИХ записей в буферы: ${grandReal}`);
const otherSites = [...sites.entries()].filter(([, s]) => s.colN === 0).length;
console.log(`(ещё ${otherSites} точек вызова VDP-помощников в цвет НЕ заходят — это паттерны/имена/спрайты)`);
process.exit(grandReal === 0 ? 0 : 1);
