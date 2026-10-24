// audit_peak.js — ИЗ ЧЕГО СОСТОИТ ДЛИННЫЙ ШАГ ЛОГИКИ (виновники пиков).
//
// ЗАЧЕМ. audit_tickfit показывает, что «дёргается» = число кадров на шаг логики скачет
// (1/2/3). Скачет оно потому, что длина шага гуляет: коэффициент вариации ~47%. Чтобы
// решать, ЧТО резать, нужно знать, чем ДЛИННЫЙ шаг отличается от короткого — а не какова
// средняя цена механизма.
//
// КАК. Каждый шаг логики (H_TIMI, в котором tickInProgress ушёл 0->1) профилируется
// SELF-TIME по диапазонам адресов (каждая инструкция кладёт такты в тот диапазон, где её
// PC). Диапазоны берутся из карты модулей (см. audit_bytes.js) и разбиты так, чтобы
// отделить НАШ рендер от ИГРОВОЙ логики. Затем шаги делятся на децили по длине, и
// печатается раскладка: короткие 10%, средний, длинные 10% — и ДЕЛЬТА между ними.
// Дельта и есть ответ «кто виноват в пиках».
//
// ЗАПУСК: node tools/verify/audit_peak.js [rom] [sym] [тиков=1500] [scene]
//   scene: walk | top | knife
"use strict";
const { make, toGame } = require("./beam_harness.js");
const T = __dirname, REPO = T + "/../..";
const a = process.argv.slice(2);
const ROM = a[0] || REPO + "/build/kvalley_8c.rom";
const SYM = a[1] || REPO + "/build/kvalley_8c.sym";
const NT = +(a[2] || 1500);
const SCENE = a[3] || "walk";
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory } = E;
const FRAME = 59904;

// Диапазоны: наш рендер — по меткам; игровая логика — всё, что ниже 0x4260 (модули игры
// и ресурсы, см. карту audit_bytes.js), кроме уже названного.
const R = [
  ["ФАЗЫ F/P + список", 0x5238, 0x566D],
  ["подготовка: геометрия", 0x5A8F, 0x5F83],
  ["клип vclp", 0x5F83, 0x5FC8],
  ["подготовка: сдвиг спрайта", 0x5FC8, 0x619E],
  ["подготовка: сдвиг плоскостей", 0x6994, 0x6CC0],
  ["зеркала/ldir", 0x6CC0, 0x6D78],
  ["решение о слитой (fastmark)", 0x619E, 0x628A],
  ["сортировка порядка", 0x6630, 0x66B4],
  ["поиск/проверка пары", 0x63BF, 0x65A6],
  ["пачка: диспетчер", 0x628A, 0x63BF],
  ["пачка: запись пары", 0x65A6, 0x6630],
  ["пачка: OR-вывод", 0x66B4, 0x6730],
  ["пачка: створка", 0x6730, 0x6818],
  ["пачка: стек-блит", 0x6818, 0x68A6],
  ["пачка: слитая запись", 0x68A6, 0x6994],
  ["save/restore фона", 0x5676, 0x5829],
  ["блит клетки + su_fixup", 0x4A65, 0x5238],
  ["ISR/звук/палитра", 0x4367, 0x4A65],
  ["topmask+repair (хвосты)", 0x745F, 0x75A5],
  ["ИГРОВАЯ ЛОГИКА (порт Z80)", 0x0100, 0x4260],
  ["прочее", 0x0000, 0x10000],
].map(r => ({ name: r[0], lo: r[1], hi: r[2] }));

let TT = 0;
let cur = null;                       // текущий шаг: {t0, prof:Float64Array}
const oInstr = cpu.instruction.bind(cpu);
cpu.instruction = function () {
  const pc = cpu.pc; oInstr(); const c = cpu.vcycles | 0; TT += c;
  if (cur) { for (let i = 0; i < R.length; i++) { const r = R[i]; if (pc >= r.lo && pc < r.hi) { cur.prof[i] += c; break; } } }
};
function retOf() { return memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8); }
const steps = [];
let tRet = -1, tSp = -1, gs = 0, logicRan = false, pending = null;
v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (pc === L.H_TIMI && tRet < 0) { tSp = cpu.sp; tRet = retOf(); logicRan = false; pending = { t0: TT, prof: new Float64Array(R.length) }; cur = pending; }
  else if (tRet >= 0 && pc === tRet && cpu.sp > tSp) {
    if (gs === 5 && logicRan && pending) { pending.len = TT - pending.t0; steps.push(pending); }
    tRet = -1; cur = null; pending = null;
  }
  return false;
};
const oW = memory.write.bind(memory);
memory.write = function (addr, w8, stackrq) {
  if ((addr & 0xffff) === L.tickInProgress && (w8 & 1) && tRet >= 0) logicRan = true;
  return oW(addr, w8, stackrq);
};

function keys(t) {
  if (SCENE === "knife") { const k = []; if (t < 260) { if ((t >> 2) & 1) k.push(32); return k; } k.push((t & 31) < 16 ? 39 : 37); if ((t & 15) === 3) k.push(32); return k; }
  if (SCENE === "top") { const k = []; if (t < 200) { if ((t >> 2) & 1) k.push(32); return k; } k.push((t % 200) < 100 ? 39 : 37); if ((t & 15) < 6) k.push(32); return k; }
  const k = [];
  if (t < 200) { if ((t >> 2) & 1) k.push(32); }
  else if (t < 600) k.push(t & 8 ? 39 : 37);
  else if (t < 610) k.push(78);
  else if (t < 1000) k.push(t & 4 ? 38 : 39);
  else if (t < 1010) k.push(78);
  else k.push(t & 8 ? 37 : 39);
  return k;
}
if (toGame(E) !== 5) { console.error("НЕ ВОШЛИ В ИГРУ — замер невозможен"); process.exit(2); }
let held = new Set(), tick = 0, prevT = 0, nf = 0, gsFrames = 0;
while (tick <= NT && nf < 500000) {
  const want = new Set(keys(tick));
  for (const c of held) if (!want.has(c)) E.key(c, 0);
  for (const c of want) if (!held.has(c)) E.key(c, 1);
  held = want;
  gs = rd(L.GameStatus); if (gs === 5) gsFrames++;
  if (SCENE === "top" && tick >= 200 && (tick % 32) === 0 && gs === 5) {
    if (rd(L.ProtaY) > 20) memory.write(L.ProtaY, 12, false);
    for (let m = 0; m < 8; m++) { const y = rd(L.enemyAttrib + m * 4); if (y < 0xD0 && y > 20) memory.write(L.enemyAttrib + m * 4, 12, false); }
  }
  v06c.oneInterrupt(true); nf++;
  const t = rd(L.timer); if (t !== prevT) { prevT = t; tick++; }
}
for (const c of held) E.key(c, 0);
if (steps.length < 100) { console.error(`ПУСТАЯ ВЫБОРКА: шагов логики ${steps.length}`); process.exit(3); }

steps.sort((x, y) => x.len - y.len);
const n = steps.length, k = Math.max(1, (n * 0.1) | 0);
const grp = (arr) => { const p = new Float64Array(R.length); let len = 0; for (const s of arr) { len += s.len; for (let i = 0; i < R.length; i++) p[i] += s.prof[i]; } return { p, len: len / arr.length, m: arr.length }; };
const lo = grp(steps.slice(0, k)), mid = grp(steps), hi = grp(steps.slice(n - k));

console.log(`ROM=${ROM.split("/").pop()}  сцена=${SCENE}  шагов логики ${n}, кадров геймплея ${gsFrames}`);
console.log(`длина шага: короткие 10% = ${lo.len.toFixed(0)} т, средний = ${mid.len.toFixed(0)} т, ДЛИННЫЕ 10% = ${hi.len.toFixed(0)} т  (кадр ${FRAME})`);
console.log("");
console.log("статья                          коротк.10%   средний   ДЛИННЫЕ10%   ДЕЛЬТА(длин-средн)  доля дельты");
const dlt = R.map((r, i) => hi.p[i] / hi.m - mid.p[i] / mid.m);
const dsum = dlt.reduce((s, v) => s + Math.max(0, v), 0);
const rows = R.map((r, i) => [r.name, lo.p[i] / lo.m, mid.p[i] / mid.m, hi.p[i] / hi.m, dlt[i]]);
rows.sort((x, y) => y[4] - x[4]);
for (const [nm, a1, a2, a3, d] of rows) {
  if (Math.abs(a2) < 1 && Math.abs(d) < 1) continue;
  console.log(`${nm.padEnd(30)} ${a1.toFixed(0).padStart(9)} ${a2.toFixed(0).padStart(9)} ${a3.toFixed(0).padStart(11)} ${(d > 0 ? "+" : "") + d.toFixed(0).padStart(12)} ${(100 * Math.max(0, d) / dsum).toFixed(1).padStart(10)}%`);
}
const sm = (o) => { let s = 0; for (let i = 0; i < R.length; i++) s += o.p[i] / o.m; return s; };
console.log(`${"ИТОГО".padEnd(30)} ${sm(lo).toFixed(0).padStart(9)} ${sm(mid).toFixed(0).padStart(9)} ${sm(hi).toFixed(0).padStart(11)} ${("+" + (sm(hi) - sm(mid)).toFixed(0)).padStart(13)}`);
