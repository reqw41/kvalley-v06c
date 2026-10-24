// mummy_composite_gate.js — ПОБАЙТНЫЙ ГЕЙТ ТОЧНОСТИ СЛИТОЙ ЗАПИСИ МУМИИ.
//
// ЧТО ДОКАЗЫВАЕТ. Слитая запись («композит»: фон-из-слота, гашение силуэтом и OR спрайта
// за ОДНУ запись на байт — vso_merge1 + vsm_multi/vsn_col) обязана давать ТОТ ЖЕ КАДР,
// что старый трёхпроходный путь (vec_su_restore -> vsb_andn -> vsb_or). Проверяем не
// модель, а сами два пути: ОДНА И ТА ЖЕ пачка исполняется ДВАЖДЫ из ОДНОГО состояния
// машины — как есть (слитая) и с принудительным vsp_fast=0 (старый путь), — после чего
// вся видимая память 0x8000-0xDFFF сравнивается побайтно.
//
// ПОЧЕМУ НЕ МОДЕЛЬ. Модель — третья реализация, и она врёт своими ошибками: у
// spr_resid_gate раздел D моделирует слитую запись, но его счётчик покрытия
// «МНОГОПЛОСКОСТНЫЙ объект» на ВСЕХ прогонах равен НУЛЮ — то есть мумию (одна плоскость
// рисует, две гасит) он не проверял ни разу. Прямое A/B двух путей от этой дыры свободно.
//
// ДВА ВЕРДИКТА, А НЕ ОДИН. Расхождения делятся ПО МЕСТУ:
//   (1) НА ГАБАРИТЕ МУМИЙ (старый U новый, все плоскости) — это и есть точность
//       композита. Допуск НОЛЬ байт, иначе ГЕЙТ ПРОВАЛЕН;
//   (2) ПЕРЕЛИВ ЗАЛИВКИ КЛИП-ЗОНЫ: байты, которые в СТАРОМ прогоне записал vtm_zc1.
//       Заливка занижает 4 СТОЛБЦА ФИКСИРОВАННО, начиная со страницы hi0 объекта, и у
//       объекта в столбцах 29-31 уезжает ЗА ГРАНИЦУ ПЛОСКОСТИ — в столбец 0 СЛЕДУЮЩЕЙ
//       (замер: мумия на 0xBD = p1/столбец 29 -> нули в 0xC0F1 = p2/столбец 0). Стирается
//       ФОН ЛАБИРИНТА: «ДО пачки» и «слит» совпадают, а «стар» = 0. Здесь НЕПРАВ СТАРЫЙ
//       путь, а слитая запись просто не повторяет его ошибку. Это НЕ провал гейта, но
//       печатается отдельной строкой с числами — дефект существует и до правки.
//   (3) ПРОЧЕЕ — всё остальное: провал.
//
// КАК СНИМАЕТСЯ СОСТОЯНИЕ. Полный снимок памяти + регистров + страничных переменных (как
// в topright_jump_probe.classify). Пачка прогоняется ШАГАМИ ЦП, без прерываний: ровно
// один прямой проход от vec_spr_out до возврата в vso_fix+3. После обоих прогонов
// состояние восстанавливается, и эмулятор исполняет пачку «по-настоящему» сам.
//
// ПОКРЫТИЕ ОБЪЯВЛЕНО И ГЕЙТ ПАДАЕТ НА ПУСТОЙ ВЫБОРКЕ: сравниваются только пачки, которые
// (а) идут слитым путём и (б) содержат хотя бы одну мумию с pending=1. Меньше MINPACK
// таких пачек — КРАСНЫЙ: «ноль расхождений из нуля сравнений» не значит ничего.
//
// НЕГАТИВНЫЙ КОНТРОЛЬ (BREAK=1): в слитом прогоне портится один байт буфера спрайта
// мумии. Гейт ОБЯЗАН покраснеть на габарите мумий; если и тут зелено — врёт сам гейт.
//
// Запуск: node tools/verify/mummy_composite_gate.js [rom] [sym] [--ticks N] [--min N]
//   DIAG=1 — печатать геометрию слотов для первых двух расхождений.
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NTICKS = 400, MINPACK = 30;
for (let i = 0; i < args.length; i++) { const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a; else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--ticks") NTICKS = +args[++i]; else if (a === "--min") MINPACK = +args[++i]; }
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory, keyboard } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
for (const s of ["vec_spr_out", "vso_fix", "vsp_fast", "vtm_zc1", "timer", "GameStatus"])
  if (L[s] === undefined) { console.error("нет символа " + s); process.exit(2); }
const BREAK = process.env.BREAK === "1", DIAG = process.env.DIAG === "1";

if (toGame(E) !== 5) { console.error("НЕ ВОШЛИ В ИГРУ — замер невозможен"); process.exit(2); }
function tick() { const t0 = rd(L.timer); let n = 0;
  do { v06c.oneInterrupt(true); if (++n > 16) { console.error("СТЕНД ВСТАЛ: тик не случился за 16 кадров"); process.exit(3); } }
  while (rd(L.timer) === t0); }
for (let i = 0; i < 40; i++) tick();
wr(L.vec_god, 1);
// Мумии держим рядом с героем, но НЕ вплотную: вплотную габариты пересекаются, пачка
// уходит на обычный путь и выборка слитых пачек с мумией становится пустой.
const MD = L.momiaDat, STEP = (L.momiaDat2 !== undefined) ? (L.momiaDat2 - L.momiaDat) : 16;
function place() { const hY = rd(L.ProtaY), hX = rd(L.ProtaX), room = rd(L.ProtaRoom);
  for (let m = 0; m < 2; m++) { const p = MD + m * STEP;
    wr(p + 0, 0); wr(p + 3, hY); wr(p + 5, (hX + (m ? 40 : -40)) & 255); wr(p + 6, room); }
  wr(L.enemyAttrib, hY); wr(L.enemyAttrib + 1, (hX + 40) & 255);
  wr(L.enemyAttrib + 2, hY); wr(L.enemyAttrib + 3, (hX - 40) & 255); }
place(); for (let i = 0; i < 10; i++) tick();
keyboard.keyDown({ keyCode: 39, which: 39, preventDefault() {}, stopPropagation() {} });

// --- снимок/восстановление состояния ---------------------------------------------------
function snap() { return { m: memory.bytes.slice(), sp: cpu.sp, pc: cpu.pc, regs: cpu.regs.slice(),
  iff: cpu.iff, ip: cpu.iff_pending, sf: cpu.sf, pf: cpu.pf, hf: cpu.hf, zf: cpu.zf, cf: cpu.cf,
  ms: memory.mode_stack, mm: memory.mode_map, pm: memory.page_map, ps: memory.page_stack, cw: memory.cw }; }
function rest(s) { memory.bytes.set(s.m); cpu.sp = s.sp; cpu.pc = s.pc; cpu.iff = s.iff; cpu.iff_pending = s.ip;
  cpu.sf = s.sf; cpu.pf = s.pf; cpu.hf = s.hf; cpu.zf = s.zf; cpu.cf = s.cf;
  for (let i = 0; i < 8; i++) cpu.regs[i] = s.regs[i];
  memory.mode_stack = s.ms; memory.mode_map = s.mm; memory.page_map = s.pm; memory.page_stack = s.ps; memory.cw = s.cw; }
function grabFB() { const b = Buffer.alloc(0x6000); for (let i = 0; i < 0x6000; i++) b[i] = rd(0x8000 + i); return b; }

// --- габарит мумий (слоты 6..13), старый U новый ---------------------------------------
const MUM = []; for (let i = 6; i <= 13; i++) MUM.push(i);
function mummyPending() { for (const i of MUM) if (rd(0xE000 + i * 256 + 0x96) === 1) return true; return false; }
function mummyFootprint() {
  const set = new Set();
  const paint = (hi, lo, nc) => { if (!hi || !nc) return;
    for (let c = 0; c < nc; c++) { const h = hi + c; if (h < 0x80 || h >= 0xE0) continue;
      for (let r = 0; r < 16; r++) set.add((h << 8) | ((lo + r) & 0xFF)); } };
  for (const idx of MUM) { const P = 0xE000 + idx * 256;
    if (rd(P)) { const lo = rd(P + 2), nc = rd(P + 3);
      paint(rd(P + 1), lo, nc); paint(rd(P + 4), lo, nc); paint(rd(P + 5), lo, nc); }
    const pd = rd(P + 0x96);
    if (pd === 1 || pd === 3) { const lo = rd(P + 0x98), nc = rd(P + 0x99);
      paint(rd(P + 0x97), lo, nc); paint(rd(P + 0x9F), lo, nc); paint(rd(P + 0x9B), lo, nc); } }
  return set;
}

// --- прогон одной пачки шагами ЦП ------------------------------------------------------
const END = L.vso_fix + 3;
function runPack() { let n = 0;
  while (cpu.pc !== END) { cpu.instruction(); if (++n > 8000000) return false; }
  return true; }

// --- сам гейт --------------------------------------------------------------------------
let cmp = 0, mumObjs = 0, stuck = 0;
let badMumPacks = 0, badMumBytes = 0, spillPacks = 0, spillBytes = 0, otherPacks = 0, otherBytes = 0;
const exMum = [], exSpill = [], exOther = [];
let nested = false, diag = 0;
const ZC = L.vtm_zc1, ZCEND = ZC + 24;      // тело заливки клип-зоны: 8 push + dec b + jp
v06c.check_breakpoint = function () {
  if (nested) return false;
  if (cpu.pc !== L.vec_spr_out) return false;
  if (!rd(L.vsp_fast)) return false;         // пачка и так идёт старым путём — сравнивать нечего
  if (!mummyPending()) return false;         // в пачке нет мумии — не наша выборка
  const S = snap(), fp = mummyFootprint(), fb0 = grabFB();
  for (const i of MUM) if (rd(0xE000 + i * 256 + 0x96) === 1) mumObjs++;
  nested = true;
  // (1) как есть — СЛИТЫЙ путь
  if (BREAK) { for (const i of MUM) if (rd(0xE000 + i * 256 + 0x96) === 1) {
      const P = 0xE000 + i * 256; wr(P + 0xA0, rd(P + 0xA0) ^ 0x55); break; } }
  if (!runPack()) { stuck++; rest(S); nested = false; return false; }
  const fbA = grabFB();
  // (2) тот же вход — ПРИНУДИТЕЛЬНО старый путь; попутно ловим, что записала заливка
  rest(S); wr(L.vsp_fast, 0);
  const zc = new Set();
  const ow = memory.write.bind(memory);
  memory.write = function (a, v, f) { if (cpu.pc >= ZC && cpu.pc <= ZCEND) zc.add(a & 0xffff); return ow(a, v, f); };
  const ok = runPack();
  memory.write = ow;
  if (!ok) { stuck++; rest(S); nested = false; return false; }
  const fbB = grabFB();
  rest(S); nested = false;
  cmp++;
  let dm = 0, ds = 0, dx = 0; const em = [], es = [], eo = [];
  for (let i = 0; i < 0x6000; i++) if (fbA[i] !== fbB[i]) {
    const a = 0x8000 + i;
    const line = `p${(a >> 13) & 3} X=${((a >> 8) & 31) * 8} стр=${a & 255}`
      + ` ДО=${fb0[i].toString(2).padStart(8, "0")} слит=${fbA[i].toString(2).padStart(8, "0")}`
      + ` стар=${fbB[i].toString(2).padStart(8, "0")}`;
    if (fp.has(a)) { dm++; if (em.length < 4) em.push(line); }
    else if (zc.has(a)) { ds++; if (es.length < 4) es.push(line); }
    else { dx++; if (eo.length < 4) eo.push(line); } }
  if (dm) { badMumPacks++; badMumBytes += dm; if (exMum.length < 3) exMum.push(em); }
  if (ds) { spillPacks++; spillBytes += ds; if (exSpill.length < 2) exSpill.push(es); }
  if (dx) { otherPacks++; otherBytes += dx; if (exOther.length < 3) exOther.push(eo); }
  if (DIAG && (dm || ds || dx) && diag < 2) { diag++;
    console.log("  --- ДИАГНОСТИКА: геометрия слотов на входе в пачку ---");
    for (let idx = 0; idx < 21; idx++) { const P = 0xE000 + idx * 256;
      if (!rd(P) && rd(P + 0x96) !== 1) continue;
      console.log(`    сл${idx} v=${rd(P)} шапка hi0=0x${rd(P + 1).toString(16)} lo0=${rd(P + 2)} nc=${rd(P + 3)}`
        + ` | зап pend=${rd(P + 0x96)} hi0=0x${rd(P + 0x97).toString(16)} lo0=${rd(P + 0x98)} nc=${rd(P + 0x99)}`
        + ` | MASK D4=${rd(P + 0xD4)} F5=0x${rd(P + 0xF5).toString(16)}`); } }
  return false;
};
let steps = 0;
while (steps < NTICKS) { tick(); steps++; if (steps % 40 === 0) place(); }
v06c.check_breakpoint = () => false;

console.log(`ROM=${path.basename(ROM)} тиков=${NTICKS}${BREAK ? "  (НЕГАТИВНЫЙ КОНТРОЛЬ: байт спрайта мумии испорчен)" : ""}`);
console.log(`ПОКРЫТИЕ: слитых пачек с живой мумией сравнено ${cmp} (нужно >= ${MINPACK}),`
  + ` выводов мумий в них ${mumObjs}` + (stuck ? `, прогонов сорвалось ${stuck}` : ""));
console.log(`(1) ТОЧНОСТЬ КОМПОЗИТА — расхождений НА ГАБАРИТЕ МУМИЙ: ${badMumPacks} пачек, ${badMumBytes} байт`);
exMum.forEach(e => e.forEach(x => console.log("      " + x)));
console.log(`(2) ПЕРЕЛИВ ЗАЛИВКИ КЛИП-ЗОНЫ старого пути (байты, записанные vtm_zc1): ${spillPacks} пачек, ${spillBytes} байт`);
exSpill.forEach(e => e.forEach(x => console.log("      " + x)));
console.log(`(3) ПРОЧИЕ расхождения: ${otherPacks} пачек, ${otherBytes} байт`);
exOther.forEach(e => e.forEach(x => console.log("      " + x)));
if (cmp < MINPACK) { console.log(`ГЕЙТ ПРОВАЛЕН: выборка мала (${cmp} < ${MINPACK}) — «ноль расхождений» ничего не доказывает.`); process.exit(2); }
if (badMumBytes || otherBytes) { console.log("ГЕЙТ ПРОВАЛЕН: слитая запись расходится со старым путём вне заливки клип-зоны."); process.exit(1); }
console.log("ГЕЙТ ЗЕЛЁНЫЙ: на габарите мумий слитая запись байт-в-байт совпадает со старым путём."
  + (spillBytes ? "  (перелив клип-зоны — дефект СТАРОГО пути, см. (2))" : ""));
