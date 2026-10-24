// АУДИТ НИЖНЕЙ ОЗУ: кто реально читает/пишет/исполняет байты зоны переменных.
//
// Зачем: раскладка переменных (сейчас 0x7092..0x7FFF; была 0x6B00, потом 0x6C00 — база
// переезжает, поэтому все адреса в скрипте берутся из .sym) — цепочка equ, и решать
// «что мёртвое, а что живое» можно только замером. Скрипт считает ЧТЕНИЯ, ЗАПИСИ и
// ВЫБОРКИ КОМАНД по каждому адресу, отдельно на буте и в игре, и печатает:
//   - сводку по символам (из .sym): R/W/X на каждую именованную ячейку;
//   - сплошные зоны БЕЗ ОБРАЩЕНИЙ (кандидаты на выселение);
//   - минимальный SP за прогон (реальный пик стека).
//
// Сценарий покрывает: бут, меню/демо, геймплей с ходьбой/прыжками/лестницами, 6 переходов
// через карту долины (чит N), смерть (GameStatus=6), Game Over (7), Stage Clear (8),
// финал игры (10) — то есть и те ветки, которые обычным вводом не достать.
//
// Запуск: node tools/debug/lowram_audit.js [rom] [sym] [lo] [hi]
// KV_ZONES="cd00-dfff,d100-d3ff" — вывести R/W/X ИМЕННО по этим диапазонам (для сверки
//   утверждений описи памяти: «зона свободна» доказывается числами, а не словами).
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";
const ROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[3] || REPO + "/build/kvalley_8c.sym";
const LO = parseInt(process.argv[4] || "0", 16), HI = parseInt(process.argv[5] || "7fff", 16);

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
const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), timer = new ctx.I8253(),
  ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(), io = new ctx.IO(keyboard, timer, memory, ay, floppy);
const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
const v06c = new ctx.Vector06c(cpu, memory, io, ay, tape);
v06c.bmp = new Uint32Array(576 * 288); v06c.displayFrame = () => {};
v06c.check_breakpoint = () => false; v06c.dbg = null;
// soundnik.soundStep НЕ глушим: он тактует ВИ53, на нём часы музыки.
const img = new Uint8Array(fs.readFileSync(ROM));
memory.init_from_array(img.subarray(0, 0x10000), 0x100);
memory.detach_boot && memory.detach_boot();
cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;

const N = HI - LO + 1;
const rB = new Uint32Array(N), wB = new Uint32Array(N), xB = new Uint32Array(N);  // бут
const rG = new Uint32Array(N), wG = new Uint32Array(N), xG = new Uint32Array(N);  // игра
const rPC = {}, wPC = {};   // адрес -> {pc: n} для расследования
let phase = 0, minSP = 0xffff, minSPpc = 0, frames = 0, scrolls = 0;
const SPTOP = L.stackTop;
const WATCH = (process.env.KV_WATCH || "").split(",").filter(Boolean).map(s => parseInt(s, 16));

const ord = memory.read.bind(memory), owr = memory.write.bind(memory);
memory.read = function (a, s) {
  const aa = a & 0xffff;
  if (aa >= LO && aa <= HI) {
    (phase ? rG : rB)[aa - LO]++;
    if (phase && WATCH.includes(aa)) { const k = (cpu.pc & 0xffff).toString(16); (rPC[aa] = rPC[aa] || {})[k] = ((rPC[aa] || {})[k] || 0) + 1; }
  }
  return ord(a, s);
};
memory.write = function (a, v, s) {
  const aa = a & 0xffff;
  if (aa >= LO && aa <= HI) {
    (phase ? wG : wB)[aa - LO]++;
    if (phase && WATCH.includes(aa)) { const k = (cpu.pc & 0xffff).toString(16); (wPC[aa] = wPC[aa] || {})[k] = ((wPC[aa] || {})[k] || 0) + 1; }
  }
  return owr(a, v, s);
};
const oins = cpu.instruction.bind(cpu);
cpu.instruction = function () {
  const pc = cpu.pc & 0xffff;
  if (pc >= LO && pc <= HI) (phase ? xG : xB)[pc - LO]++;
  // ВАЖНО: SP в игре ХАЙДЖЕКАЕТСЯ (POP-блиты, vec_scroll) и уезжает в ПЗУ и в слоты
  // save-under — такие значения к глубине стека отношения не имеют. Считаем только SP
  // внутри окна стека.
  // ЗАДАЧА#48: окно было «SPTOP-3072 .. SPTOP» — эвристика от старой раскладки, когда стек
  // жил в нижней ОЗУ (0x74A5) и хайджек в p3 (0xE000-0xF4FF) в неё заведомо не попадал.
  // После переезда стека в p3 (0xF6A5-0xF7A4) это окно накрыло слоты save-under и аудит
  // печатал «пик стека 1183 Б» (min SP = 0xF306 в vsu_rcol — это POP-хайджек, а не стек).
  // Теперь окно — РОВНО отведённое стеку плюс 256 Б вниз, чтобы был виден и перерасход.
  const sp = cpu.sp & 0xffff;
  if (sp < minSP && sp <= SPTOP && sp > (L.stackArea || SPTOP - 256) - 256) { minSP = sp; minSPpc = pc; }
  return oins();
};

const rd = a => ord(a & 0xffff, false), wr = (a, v) => owr(a & 0xffff, v, false);
const gsHist = {}, roomHist = {};
const run = n => { for (let i = 0; i < n; i++) { v06c.oneInterrupt(true); frames++;
  if (phase) { const s = ord(L.GameStatus, false); gsHist[s] = (gsHist[s] || 0) + 1;
    const r = ord(L.ProtaRoom, false); roomHist[r] = (roomHist[r] || 0) + 1; } } };
const key = (code, down) => { const e = { keyCode: code, which: code, preventDefault() {}, stopPropagation() {} };
  if (down) keyboard.keyDown(e); else keyboard.keyUp(e); };
const GS = L.GameStatus;

run(400);                                    // лого Konami + меню + кусок демо
phase = 1;                                   // дальше — «игровой» счётчик
let ok = false;
for (let blk = 0; blk < 60 && !ok; blk++) {
  for (let f = 0; f < 25; f++) { key(32, true); run(1); if (rd(GS) === 5 && (rd(L.flagPiramideMap) & 1)) { ok = true; break; } }
  key(32, false); run(5);
}
if (!ok) { console.log("НЕ ВОШЛИ В ГЕЙМПЛЕЙ"); process.exit(2); }
run(60);
// --- геймплей: ходьба/прыжки/лестницы, псевдослучайный ввод -----------------------
let seed = 20260731; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const KEYS = [37, 39, 38, 40, 32];
// длинный проход вправо/влево
for (const dir of [39, 37, 39]) { key(dir, true); run(300); key(dir, false); run(20); }
// СКРОЛЛ КОМНАТЫ (GameStatus=9, vss_*): героя ставим на край, как в gem_realscroll.js —
// сам он туда доходит не всегда (стены), а стек скролла мерить обязательно.
for (const d of ["r", "l", "r", "l"]) {
  const from = rd(L.ProtaRoom); const dir = from === 0 ? "r" : from === 2 ? "l" : d;
  let m = 0;
  while (rd(GS) !== 9 && m < 300) { wr(L.sentidoProta, dir === "l" ? 1 : 2); wr(L.ProtaX, dir === "l" ? 0 : 0xf6); run(1); m++; }
  let f = 0; while (rd(GS) === 9 && f < 400) { run(1); f++; }
  scrolls += (f > 0 ? 1 : 0);
  run(20);
}
for (let f = 0; f < 1600; f++) {
  const k = KEYS[(rnd() * KEYS.length) | 0];
  key(k, true); run(1); if (rnd() < 0.35) key(k, false);
  for (const kk of KEYS) if (rnd() < 0.2) key(kk, false);
}
for (const kk of KEYS) key(kk, false);
run(30);
// --- 6 переходов через карту долины (чит N = keyCode 78) --------------------------
for (let step = 0; step < 6; step++) {
  key(78, true); run(3); key(78, false);
  for (let f = 0; f < 900; f++) { run(1); if (rd(GS) === 5) break; }
  run(40);
}
// --- ветки, которых обычным вводом не достать: смерть / game over / stage clear / финал
for (const st of [6, 7, 8, 10]) {
  wr(GS, st); wr(L.subStatus, 0);
  run(400);
  if (rd(GS) !== 5) { // вернуться в игру, если застряли
    for (let blk = 0; blk < 20 && rd(GS) !== 5; blk++) { key(32, true); run(10); key(32, false); run(10); }
  }
}
run(100);

// ---------------------------------- ОТЧЁТ ------------------------------------------
const syms = Object.entries(L).map(([n, a]) => [a, n]).filter(([a]) => a >= LO && a <= HI)
  .sort((x, y) => x[0] - y[0]);
console.log("скроллов комнаты: " + scrolls);
console.log("покрытие: GameStatus", JSON.stringify(gsHist), " ProtaRoom", JSON.stringify(roomHist));
console.log(`прогон: ${frames} кадров; min SP = 0x${minSP.toString(16)} (pc=0x${minSPpc.toString(16)})`);
if (L.stackTop) console.log(`пик стека = ${L.stackTop - minSP} Б (stackTop=0x${L.stackTop.toString(16)})`);

const sum = (arr, a, b) => { let s = 0; for (let i = a; i <= b; i++) s += arr[i - LO]; return s; };
console.log("\n== по символам (R/W/X в игре; W-бут) ==");
for (let i = 0; i < syms.length; i++) {
  const a = syms[i][0], b = (i + 1 < syms.length ? syms[i + 1][0] : HI + 1) - 1;
  if (b < a) continue;
  const r = sum(rG, a, b), w = sum(wG, a, b), x = sum(xG, a, b), wb = sum(wB, a, b), rb = sum(rB, a, b);
  const dead = (r + w + x === 0) ? "  <-- МЁРТВОЕ В ИГРЕ" : "";
  console.log(`0x${a.toString(16)}-0x${b.toString(16)} ${String(b - a + 1).padStart(5)}Б ${syms[i][1].padEnd(20)} R=${r} W=${w} X=${x} (бут R=${rb} W=${wb})${dead}`);
}
console.log("\n== сплошные зоны без ЕДИНОГО обращения (>=8Б, игра+бут-чтения) ==");
let s = -1;
for (let a = LO; a <= HI + 1; a++) {
  const idx = a - LO;
  const busy = a > HI || rG[idx] || wG[idx] || xG[idx] || rB[idx] || xB[idx];
  if (!busy) { if (s < 0) s = a; }
  else if (s >= 0) { if (a - s >= 8) console.log(`  0x${s.toString(16)}-0x${(a - 1).toString(16)}  ${a - s}Б`); s = -1; }
}
const ZONES = (process.env.KV_ZONES || "").split(",").filter(Boolean);
if (ZONES.length) {
  console.log("\n== ИТОГО ПО ЗАПРОШЕННЫМ ЗОНАМ (R/W/X в игре, отдельно бут) ==");
  for (const z of ZONES) {
    const m = z.match(/^\s*([0-9a-fA-F]+)\s*-\s*([0-9a-fA-F]+)\s*$/);
    if (!m) { console.log(`  «${z}»: не разобрал, нужен вид lo-hi в hex`); continue; }
    const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
    if (a < LO || b > HI || b < a) { console.log(`  0x${z}: вне окна замера 0x${LO.toString(16)}-0x${HI.toString(16)}`); continue; }
    const r = sum(rG, a, b), w = sum(wG, a, b), x = sum(xG, a, b),
          rb = sum(rB, a, b), wb = sum(wB, a, b), xb = sum(xB, a, b);
    let touched = 0; for (let i = a; i <= b; i++) if (rG[i-LO]||wG[i-LO]||xG[i-LO]||rB[i-LO]||xB[i-LO]) touched++;
    console.log(`  0x${a.toString(16)}-0x${b.toString(16)} ${b-a+1}Б: игра R=${r} W=${w} X=${x}; ` +
                `бут R=${rb} W=${wb} X=${xb}; байт с обращениями ${touched} из ${b-a+1}`);
  }
}
for (const a of WATCH) {
  console.log(`\n== кто трогает 0x${a.toString(16)} ==`);
  console.log("  чтения:", JSON.stringify(rPC[a] || {}), "\n  записи:", JSON.stringify(wPC[a] || {}));
}
