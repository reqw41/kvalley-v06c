// СКВОЗНОЙ ГЕЙТ ЗАЛИВКИ КЛИП-ЗОНЫ НА ЖИВОЙ ИГРЕ (vtm_zclip/vtm_zc1).
//
// ЧТО ПРОВЕРЯЕТ. Каждый байт, который заливка записала в кадр, обязан лежать В ГАБАРИТЕ
// ТОГО ЖЕ ОБЪЕКТА: страницы плоскостей берутся из слота (+0xF5/F6/F7 — их положил
// vtm_setf5 в момент отрисовки), ширина — из ШАПКИ слота (+3 ncols, она описывает ровно
// нарисованный габарит), строки — клип-зона 0xF0..0xFF, и то ТОЛЬКО ЕСЛИ ГАБАРИТ
// ОБЪЕКТА ПО ВЕРТИКАЛИ (строки lo0..lo0+15 ПО МОДУЛЮ 256, lo0 — шапка, +2) до этой зоны
// ДОСТАЁТ. Любой адрес вне этого — дефект:
//   * «чужой столбец» — вылез за ncols, но остался в своей плоскости (пример: мумия
//     ncols=2 на столбце 29 заливала ещё и столбец 31 — ПРАВУЮ СТЕНУ лабиринта);
//   * «ЗА ГРАНИЦУ ПЛОСКОСТИ» — push инкрементирует SP целиком, 0xBF+1 = 0xC0, то есть
//     столбец 0 СОСЕДНЕЙ плоскости (левая стена), а 0xDF+1 = 0xE0 — вообще СТРАНИЦА
//     СЛОТА 0, служебные данные.
//   * «ЧУЖАЯ СТРОКА» (проверка 2026-09-11) — столбец свой, но объект ДО КЛИП-ЗОНЫ НЕ
//     ДОСТАЁТ: он стоит в середине поля (lo0+15 < 240), а заливка всё равно чистит
//     строки 240..255 — ДВА ВЕРХНИХ РЯДА ЗНАКОМЕСТ ПОЛЯ, то есть фон лабиринта в его
//     столбцах. Снять СВОИ пиксели заливка там не может по построению: всё, что объект
//     нарисовал, лежит в строках lo0..lo0+15, и ровно их снимает ANDN силуэта в
//     vtm_restore по тому же lo0 шапки.
//
// ЧТО НАМЕРЕННО НЕ СЧИТАЕТСЯ ДЕФЕКТОМ — «ЗАПАС» ЗАЛИВКИ. У объекта, который до зоны
// ДОСТАЁТ, заливка чистит ВСЮ клип-зону 240..255, а не только пересечение с габаритом.
// Это не промах, а замысел: клип-зона — область, где геометрия объекта ПРИЖАТА (vclp
// клампит lo0 к 248 и выталкивает верхние строки спрайта из буфера), и ANDN силуэта там
// снимает не всё; запас накрывает и НЕДАВНЮЮ позицию объекта, из которой сирота и
// остаётся. Байты запаса считаются ОТДЕЛЬНО и печатаются СПРАВОЧНО — чтобы цена замысла
// была на виду, но гейт на них не краснел.
// Отдельно считается ПОРЧА: записанный байт был НЕНУЛЕВЫМ, то есть стёрт реальный фон
// лабиринта (в клип-зоне его рисует только блиттер тайлов из карты, никто больше туда
// не пишет — значит «было не ноль» = «была картинка карты»). Порчу никто не
// перерисовывает, она КОПИТСЯ — жалоба с железа docs/DEFECT-2026-08-26-hw-masked-artifacts.md.
//
// ПОКРЫТИЕ ОБЪЯВЛЕНО И ГЕЙТ ПАДАЕТ НА ПУСТОЙ ВЫБОРКЕ. Нужны ДВА семейства случаев:
//   --min   (по умолч. 8) вызовов с объектом в СТОЛБЦАХ 28..31 — только там виден
//           переход через границу плоскости (проверка по столбцам);
//   --minmid(по умолч. 8) вызовов с объектом В СЕРЕДИНЕ ПОЛЯ (lo0+15 < 240, габарит не
//           достаёт до клип-зоны) — только там видна проверка по строкам.
//   --mintop(по умолч. 8) вызовов с объектом, ДОСТАЮЩИМ до клип-зоны (lo0 >= 225) —
//           без них «0 дефектов» читается как «заливка ни разу не работала».
// «Ноль дефектов из нуля случаев» не значит ничего.
// Сцена строится принудительно: мумии расставляются по X у правого края (как в
// mummy_composite_gate), герой бессмертен (vec_god), ввод — по ИГРОВЫМ ТИКАМ.
// С --free сцена НЕ принуждается (свободная игра): нужна для честного счёта ПОРЧИ.
//
// НЕГАТИВНЫЙ КОНТРОЛЬ (BREAK=1): перед каждым вызовом заливки ncols в шапке слота
// увеличивается на 1 (и тут же возвращается, чтобы не сломать следующую пачку) — заливка
// кладёт на столбец больше положенного. Гейт ОБЯЗАН покраснеть; если и тут зелено —
// врёт сам гейт. Второй, исторический негативный контроль — прогон на сборке ДО правки
// (там ширина зашита четвёркой): см. docs/FIX-2026-09-11-vtm_zc1-plane-overrun.md.
//
// Запуск: node tools/verify/clipzone_live_gate.js [rom] [sym] [--ticks N] [--min N]
//                                                 [--minmid N] [--mintop N] [--free]
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NTICKS = 900, MINEDGE = 8, MINMID = 8, MINTOP = 8, FREE = false;
for (let i = 0; i < args.length; i++) { const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a; else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--ticks") NTICKS = +args[++i]; else if (a === "--min") MINEDGE = +args[++i];
  else if (a === "--minmid") MINMID = +args[++i]; else if (a === "--mintop") MINTOP = +args[++i];
  else if (a === "--free") FREE = true; }
const BREAK = process.env.BREAK === "1";
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
for (const s of ["vtm_zclip", "vtm_zc1", "vtm_zpl", "vec_nsp_idx", "timer", "GameStatus"])
  if (L[s] === undefined) { console.error("нет символа " + s); process.exit(2); }
if (toGame(E) !== 5) { console.error("НЕ ВОШЛИ В ИГРУ — замер невозможен"); process.exit(2); }

function tick() { const t0 = rd(L.timer); let n = 0;
  do { v06c.oneInterrupt(true); if (++n > 16) { console.error("СТЕНД ВСТАЛ: тик не случился за 16 кадров"); process.exit(3); } }
  while (rd(L.timer) === t0); }
for (let i = 0; i < 40; i++) tick();
if (L.vec_god !== undefined) wr(L.vec_god, 1);

// СЦЕНА: мумии у ПРАВОГО КРАЯ. X=232..252 -> столбец X>>3 = 29..31 (у мумии к X ещё
// прибавляется 3 — компенсация прижатого арта, см. vsp_xmum), поэтому берём весь веер.
// ЧЕРЕДОВАНИЕ ПО ВЫСОТЕ (2026-09-11): чётная расстановка ставит мумий по герою (середина
// поля), НЕЧЁТНАЯ — в ВЕРХНИЙ РЯД (Y = 8 и 0, то есть lo0 = 239-Y = 231 и 239). Без
// второй половины сцена не гоняет заливку НИ РАЗУ и её «0 дефектов» ничего не значит.
const MD = L.momiaDat, STEP = (L.momiaDat2 !== undefined) ? (L.momiaDat2 - L.momiaDat) : 16;
const XS = [232, 236, 240, 244, 248, 252];
const TOPY = [8, 0];
function place(k) { const hY = rd(L.ProtaY), room = rd(L.ProtaRoom);
  for (let m = 0; m < 2; m++) { const p = MD + m * STEP;
    const y = (k & 1) ? TOPY[m] : (hY + (m ? 0 : 16)) & 255;
    wr(p + 0, 0); wr(p + 3, y); wr(p + 5, XS[(k + m) % XS.length]); wr(p + 6, room);
    if (L.enemyAttrib !== undefined && m === 0) { wr(L.enemyAttrib, y); wr(L.enemyAttrib + 1, XS[k % XS.length]); } } }

// --- ловушка писателя -----------------------------------------------------------------
const ZC = L.vtm_zc1, ZCEND = L.vtm_zc1 + 8;   // тело заливки: ровно 8 push
let calls = 0, callsEdge = 0, callsMid = 0, callsTop = 0, bytes = 0;
let badCol = 0, badPlane = 0, badRow = 0, marginRow = 0;
let dmgCol = 0, dmgPlane = 0, dmgRow = 0, dmgMargin = 0;
const colHist = new Map(), examples = [], rowExamples = [], dmgAddr = new Set();
const dmgRowAddr = new Set(), dmgMarginAddr = new Set();
let allowed = null, allowedRow = null, info = null, brk = null;
{ const oi = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    const pc = cpu.pc;
    if (pc === L.vtm_zclip) {
      const idx = rd(L.vec_nsp_idx), P = 0xE000 + idx * 256;
      const pages = [rd(P + 0xF5), rd(P + 0xF6), rd(P + 0xF7)], nc = rd(P + 3), lo0 = rd(P + 2);
      // СТРОКИ ГАБАРИТА: ровно 16 подряд байт ПО МОДУЛЮ 256 от lo0 (vclp гарантирует
      // lo0 <= 248, но модуль берём честно — стенд не должен опираться на инвариант,
      // который проверяет). Пересечение с клип-зоной 240..255 и есть «своя» строка.
      const rows = new Set();
      for (let k = 0; k < 16; k++) { const r = (lo0 + k) & 255; if (r >= 240) rows.add(r); }
      info = { idx, pages, nc, lo0, rows };
      allowed = new Set(); allowedRow = new Set();
      for (const p of pages) { if (!p) continue;
        for (let c = 0; c < nc; c++) { const pg = ((p + c) & 0xFF) << 8;
          for (let lo = 240; lo < 256; lo++) { allowed.add(pg | lo); if (rows.has(lo)) allowedRow.add(pg | lo); } } }
      calls++;
      if (!rows.size) callsMid++; else callsTop++;   // габарит целиком ниже клип-зоны / достаёт
      const col = pages[0] & 0x1F;
      colHist.set(col, (colHist.get(col) || 0) + 1);
      if (col >= 28) callsEdge++;
      if (BREAK && nc) { brk = { a: P + 3, v: nc }; memory.bytes[memory.tobank(P + 3)] = nc + 1; }
    } else if (pc === L.vtm_zpl && brk) {         // ncols уже прочитан в E — вернуть шапку
      memory.bytes[memory.tobank(brk.a)] = brk.v; brk = null;
    }
    return oi();
  }; }
{ const ow = memory.write.bind(memory);
  memory.write = function (a, v, f) {
    const pc = cpu.pc;
    if (pc >= ZC && pc <= ZCEND && allowed) {
      const ad = a & 0xFFFF;
      if (!allowed.has(ad)) {
        const pl = (ad >> 8) & 0xE0;
        const own = info.pages.some(p => p && (p & 0xE0) === pl);
        const old = rd(ad);
        if (own) { badCol++; if (old) dmgCol++; } else { badPlane++; if (old) dmgPlane++; }
        if (old) dmgAddr.add(ad);
        if (old && examples.length < 8)
          examples.push(`0x${ad.toString(16)} было 0b${old.toString(2).padStart(8, "0")}`
            + ` (страницы ${info.pages.map(x => x.toString(16)).join("/")}, ncols=${info.nc}, слот ${info.idx})`
            + (own ? " — чужой столбец своей плоскости" : " — ЗА ГРАНИЦУ ПЛОСКОСТИ"));
      } else if (!allowedRow.has(ad)) {
        const old = rd(ad);
        if (info.rows.size) {            // объект ДО зоны достаёт — это «запас», справочно
          marginRow++;
          if (old) { dmgMargin++; dmgMarginAddr.add(ad); }
          bytes++;
          return ow(a, v, f);
        }
        badRow++;
        if (old) { dmgRow++; dmgRowAddr.add(ad); }
        if (old && rowExamples.length < 8)
          rowExamples.push(`0x${ad.toString(16)} было 0b${old.toString(2).padStart(8, "0")}`
            + ` (lo0=${info.lo0}, габарит строк ${info.lo0}..${(info.lo0 + 15) & 255}, ncols=${info.nc},`
            + ` страницы ${info.pages.map(x => x.toString(16)).join("/")}, слот ${info.idx}) — ЧУЖАЯ СТРОКА`);
      }
      bytes++;
    }
    return ow(a, v, f);
  }; }

// --- прогон ---------------------------------------------------------------------------
const KEYS = [[39], [39], [], [37], [], [32], [39], []];
for (let i = 0; i < NTICKS; i++) {
  if (!FREE && i % 12 === 0) place(i / 12 | 0);
  const keys = KEYS[(i >> 3) % KEYS.length];
  for (const c of [37, 39, 32]) keys.includes(c) ? E.key(c, 1) : E.key(c, 0);
  tick();
  if (rd(L.GameStatus) !== 5) { for (let j = 0; j < 60 && rd(L.GameStatus) !== 5; j++) tick(); }
}

const bad = badCol + badPlane, dmg = dmgCol + dmgPlane;
console.log(`ПОКРЫТИЕ: ${NTICKS} игровых тиков, вызовов заливки ${calls}, записано ${bytes} Б`);
console.log(`  столбцы объекта: ${[...colHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => k + ":" + v).join(" ")}`);
console.log(`  из них ПРАВЫЙ КРАЙ (столбцы 28..31): ${callsEdge} вызовов (нужно >= ${MINEDGE})`);
console.log(`  из них СЕРЕДИНА ПОЛЯ (габарит не достаёт до строки 240): ${callsMid} вызовов`
  + ` (нужно >= ${MINMID})`);
console.log(`  из них ДОСТАЮТ до клип-зоны (заливка законна): ${callsTop} вызовов`);
console.log(`ВНЕ ГАБАРИТА ПО СТОЛБЦАМ: ${bad} Б (чужой столбец ${badCol}, за границу плоскости ${badPlane})`);
console.log(`ЗАЛИВКА У ОБЪЕКТА, НЕ ДОСТАЮЩЕГО ДО КЛИП-ЗОНЫ: ${badRow} Б`);
console.log(`(справочно) ЗАПАС заливки у достающих объектов: ${marginRow} Б,`
  + ` из них стёрт ненулевой фон ${dmgMargin} Б на ${dmgMarginAddr.size} адресах`);
console.log(`ПОРЧА (стёрт НЕНУЛЕВОЙ фон карты): ${dmg} Б, уникальных адресов ${dmgAddr.size}`
  + ` (чужой столбец ${dmgCol}, за границу плоскости ${dmgPlane})`);
console.log(`ПОРЧА ПО СТРОКАМ: ${dmgRow} Б, уникальных адресов ${dmgRowAddr.size}`);
// Порча СЧИТАЕТСЯ ОДИН РАЗ НА АДРЕС: затёртый нулём байт остаётся нулём, и следующий
// перелив пишет ноль по нулю — поэтому «ВНЕ ГАБАРИТА» на порядки больше «ПОРЧИ», а сама
// порча и есть та самая НАКОПИТЕЛЬНАЯ потеря пикселей, которую видно на железе.
for (const e of examples) console.log("   " + e);
for (const e of rowExamples) console.log("   " + e);
if (!calls || callsEdge < MINEDGE || callsMid < MINMID || callsTop < MINTOP) {
  console.log("ГЕЙТ ПРОВАЛЕН: выборка пуста, либо в ней нет объектов у правого края,"
    + " либо нет объектов в середине поля, либо заливка ни разу не отработала.");
  process.exit(2);
}
if (bad || badRow) {
  console.log(`ПРОВАЛ: заливка вышла за габарит объекта — по столбцам ${bad} Б, по строкам ${badRow} Б.`);
  process.exit(1);
}
console.log("ЧИСТО: все записи заливки лежат в габарите своего объекта (и по столбцам, и по строкам).");
