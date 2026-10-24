// shutter_sprite_probe.js — «сколько кадров шторки спрайты героя/мумий ещё видны».
//
// ЖАЛОБА ВЛАДЕЛЬЦА: при смерти героя и при переходе читом N шторка стирает лабиринт,
// а спрайты героя и мумий остаются висеть до самого конца очистки.
//
// МЕТОД. Шторка (drawCortinilla) гасит РОВНО ОДИН столбец имён за кадр: счётчик
// waitCounter идёт 31..0, столбец = counter XOR 0x1F, то есть 0,1,...,31 слева направо.
// Значит после кадра k столбцы 0..k обязаны быть пустым тайлом. Пробник читает ВИДИМЫЕ
// плоскости (0x8000/0xA000/0xC000) и считает в уже стёртых столбцах байты, отличные от
// эталона пустого тайла (эталон берётся как самый частый байт плоскости в стёртой зоне).
// Каждый такой байт — пиксель, который шторка НЕ стёрла: остаток спрайта.
//
// Запуск: node tools/verify/shutter_sprite_probe.js [rom] [sym]
"use strict";
const fs = require("fs");
const { make, toGame } = require("./beam_harness.js");

let rom = null, sym = null;
for (const a of process.argv.slice(2)) {
  if (/\.sym$/i.test(a)) sym = a; else if (/\.rom$/i.test(a)) rom = a;
}
rom = rom || "build/kvalley_8c.rom";
sym = sym || rom.replace(/\.rom$/, ".sym");
const PNG = process.env.KV_PNG || "";

const E = make(rom, sym);
const { rd, key, run, L, memory } = E;
const wr = (a, v) => { memory.bytes[memory.tobank(a & 0xffff)] = v & 255; };
const PLANES = [0x8000, 0xA000, 0xC000];       // видимые плоскости (p3 0xE000 невидим: 8 цветов)
// адрес байта: база + col*256 + lo, lo = (31 - r) & 255, r = растровая строка
const at = (base, col, r) => base + col * 256 + ((31 - r) & 255);

// Ряд имён R (0..23) занимает растровые строки 32+R*8 .. +7 (Y поля = r-32).
function cellBytes(col, R) {
  const out = [];
  for (const p of PLANES) for (let i = 0; i < 8; i++) out.push(rd(at(p, col, 32 + R * 8 + i)));
  return out;
}
// СЫРЫЕ БАЙТЫ ГАБАРИТА КАЖДОГО СПРАЙТА ПО ПЛОСКОСТЯМ (запрос владельца: «виден ОДИН
// СЛОЙ героя»). Герой — пара слотов sprAttrib #4 (одежда) и #5 (кожа), поэтому остаток
// в одной плоскости и ноль в другой означал бы, что снят только один слот пары.
// Возвращает [{i, per: [[байты p0],[байты p1],[байты p2]], cols:[c0,c1]}].
function boxBytes(spr) {
  return spr.map(s => {
    const c0 = s.X >> 3, c1 = (s.X + 15) >> 3;
    const per = PLANES.map(p => {
      const b = [];
      for (let c = c0; c <= c1; c++) for (let i = 0; i < 16; i++)
        b.push({ c, ri: (s.Y + i) & 7, v: rd(at(p, c, 32 + s.Y + i)) });
      return b;
    });
    return { i: s.i, per, c0, c1 };
  });
}
// Снимок всей сетки имён: 32 столбца x 24 ряда отпечатков по 24 байта.
function gridSnap() {
  const g = [];
  for (let c = 0; c < 32; c++) { const col = []; for (let R = 0; R < 24; R++) col.push(cellBytes(c, R).join(",")); g.push(col); }
  return g;
}

function attrs() {
  // 6 записей sprAttrib (герой = 4 спрайта) + 8 enemyAttrib (мумии), шаг 4: Y,X,pat,col
  const list = [];
  for (let i = 0; i < 14; i++) {
    const a = L.sprAttrib + i * 4;
    list.push({ i, Y: rd(a), X: rd(a + 1), pat: rd(a + 2) });
  }
  return list;
}
const visible = s => { const y = (s.Y + 0x30) & 255; return y >= 0x20; };
// vec_nsp_prev — снимок ТОГО, ЧТО СЕЙЧАС НАРИСОВАНО в планах (21 слот по 3 байта Y,X,pat).
function drawnSprites() {
  const out = [];
  for (let i = 0; i < 21; i++) {
    const a = L.vec_nsp_prev + i * 3, Y = rd(a);
    if (((Y + 0x30) & 255) < 0x20) continue;      // скрыт/за полем
    out.push({ i, Y, X: rd(a + 1), pat: rd(a + 2) });
  }
  return out;
}

function shutterScan(tag) {
  // ждём начала шторки: GameStatus=4, subStatus=0, waitCounter=0x20
  let f = 0;
  while (f < 900 && !(rd(L.GameStatus) === 4 && rd(L.subStatus) === 0 && rd(L.waitCounter) >= 0x1F)) { run(1); f++; }
  if (f >= 900) { console.log(`${tag}: шторка не началась за ${f} кадров (GS=${rd(L.GameStatus)} sub=${rd(L.subStatus)})`); return null; }
  const spr = attrs().filter(visible);
  console.log(`${tag}: старт шторки (кадров до старта ${f}); видимых спрайтов ${spr.length}: ` +
    spr.map(s => `#${s.i}(Y=${s.Y},X=${s.X},p=${s.pat})`).join(" "));
  // Шторка гасит один столбец за ИГРОВОЙ ТИК, а тик при ней идёт не каждый кадр (блит 24
  // клеток под DI съедает 2 вложенных vblank). Поэтому крутим по КАДРАМ до её конца.
  const rows = [];
  let prevWc = rd(L.waitCounter), maxCol = -1, k = 0;
  for (; k < 400; k++) {
    run(1);
    const wc = rd(L.waitCounter), sub = rd(L.subStatus), gs = rd(L.GameStatus);
    if (gs !== 4 || sub !== 0 || wc > 31) break;   // шторка кончилась (waitCounter ушёл в 0xFF)
    if (wc !== prevWc) { maxCol = (wc ^ 0x1F); prevWc = wc; }
    rows.push({ k, wc, maxCol, grid: gridSnap(), spr: drawnSprites(), box: boxBytes(spr) });
    if (PNG) E.png(`${PNG}_${tag}_f${String(k).padStart(3, "0")}.png`);
  }
  if (!rows.length) { console.log(`${tag}: шторка не отработала ни кадра`); return null; }
  // Эталон пустого тайла — самый частый отпечаток в ПОСЛЕДНЕМ кадре (экран уже чист).
  const cnt = new Map(); const last = rows[rows.length - 1].grid;
  for (let c = 0; c < 32; c++) for (let R = 0; R < 24; R++) cnt.set(last[c][R], (cnt.get(last[c][R]) || 0) + 1);
  let ref = null, bn = -1; for (const [g, n] of cnt) if (n > bn) { bn = n; ref = g; }
  console.log(`  кадров шторки ${rows.length}; пустой тайл занимает ${bn} из 768 клеток последнего кадра`);
  // Клетка «грязная», если она в УЖЕ СТЁРТОМ столбце и не равна пустому тайлу.
  let dirtyFrames = 0, sprFrames = 0;
  const lines = [];
  for (const r of rows) {
    const bad = [];
    for (let c = 0; c <= r.maxCol; c++) for (let R = 0; R < 24; R++) if (r.grid[c][R] !== ref) bad.push([c, R]);
    // Сколько из них накрыты рамкой нарисованного спрайта (vec_nsp_prev): это и есть «спрайт виден».
    // «Спрайт ещё виден» — грязь в клетках, накрытых рамкой спрайта НА МОМЕНТ НАЧАЛА ШТОРКИ
    // (позиции зафиксированы: vec_nsp_prev после гашения обнуляется и мерить по нему нечего).
    const onSpr = bad.filter(([c, R]) => spr.some(s =>
      c >= (s.X >> 3) && c <= ((s.X + 15) >> 3) && R >= (s.Y >> 3) && R <= ((s.Y + 15) >> 3)));
    r.bad = bad.length; r.onSpr = onSpr.length;
    if (bad.length) dirtyFrames++;
    if (onSpr.length) sprFrames++;
    lines.push(`${r.bad}/${r.onSpr}`);
  }
  console.log(`  грязных клеток / из них под спрайтом, по кадрам: ` + lines.join(" "));
  const lastDirty = rows.filter(r => r.bad > 0).pop();
  if (lastDirty) console.log(`  последний грязный кадр #${lastDirty.k} (стёрто до столбца ${lastDirty.maxCol}), клеток ${lastDirty.bad}`);
  console.log(`  ИТОГО кадров шторки: ${rows.length}; с грязью в стёртой зоне ${dirtyFrames}` +
    ` (транзитная — тик длиннее кадра, клетки текущего столбца ещё не долиты);` +
    ` СО СПРАЙТОМ В СТЁРТОЙ ЗОНЕ: ${sprFrames}`);
  // --- ПО ПЛОСКОСТЯМ В ГАБАРИТЕ СПРАЙТА (запрос владельца: «остаётся один слой») --------
  const refB = ref.split(",").map(Number);          // 24 байта пустого тайла: 8 на плоскость
  const emptyOf = (pi, ri) => refB[pi * 8 + ri];
  const PN = ["p0(0x8000)", "p1(0xA000)", "p2(0xC000)"];
  const planeFrames = [0, 0, 0], planeMax = [0, 0, 0];
  const heroFrames = [0, 0, 0];
  const HERO = new Set([4, 5]);                     // пара слотов героя: одежда + кожа
  for (const r of rows) {
    const seen = [0, 0, 0], seenHero = [0, 0, 0];
    for (const bx of r.box) for (let pi = 0; pi < 3; pi++) {
      let n = 0;
      for (const q of bx.per[pi]) if (q.c <= r.maxCol && q.v !== emptyOf(pi, q.ri)) n++;
      seen[pi] += n; if (HERO.has(bx.i)) seenHero[pi] += n;
    }
    for (let pi = 0; pi < 3; pi++) {
      if (seen[pi]) planeFrames[pi]++;
      if (seenHero[pi]) heroFrames[pi]++;
      if (seen[pi] > planeMax[pi]) planeMax[pi] = seen[pi];
    }
  }
  if (process.env.KV_VERBOSE === "1") {   // потрассно: не отмирает ли один слой пары раньше
    const tr = rows.map(r => {
      const h = [0, 0, 0];
      for (const bx of r.box) if (HERO.has(bx.i)) for (let pi = 0; pi < 3; pi++)
        for (const q of bx.per[pi]) if (q.c <= r.maxCol && q.v !== emptyOf(pi, q.ri)) h[pi]++;
      return h.join("/");
    });
    console.log(`  габарит ГЕРОЯ по кадрам, байт p0/p1/p2: ` + tr.join(" "));
  }
  for (let pi = 0; pi < 3; pi++)
    console.log(`  ПЛОСКОСТЬ ${PN[pi]}: кадров с байтами спрайта в стёртой зоне ${planeFrames[pi]}` +
      ` (только габарит героя, слоты 4+5: ${heroFrames[pi]}), максимум байт за кадр ${planeMax[pi]}`);
  return { frames: sprFrames, rows, spr: spr.length, planeFrames, heroFrames, total: rows.length };
}

// ---- сцена 1: СМЕРТЬ ------------------------------------------------------------------
console.log("=== сцена 1: смерть героя ===");
if (toGame(E) !== 5) { console.log("не доехали до геймплея"); process.exit(2); }
run(120);
console.log(`геймплей: ProtaY=${rd(L.ProtaY)} ProtaX=${rd(L.ProtaX)} мумий=${rd(L.numMomias)}`);
// СМЕРТЬ ШТАТНАЯ: телепортируем героя на мумию — срабатывает chkTocaMomia -> momiaMataProta
// (флаг flagVivo=0 И музыка смерти 0x1D). Пока музыка играет, tickMuerto ждёт: без неё
// игровая музыка не кончается никогда и статус 6 висит вечно.
{
  const M = L.momiaDat;                    // запись мумии: статус+0, Y+3, Xдроб+4, X+5, комната+6
  wr(L.ProtaY, rd(M + 3)); wr(L.ProtaXdecimal, rd(M + 4));
  wr(L.ProtaX, rd(M + 5)); wr(L.ProtaRoom, rd(M + 6));
  console.log(`  герой телепортирован на мумию: Y=${rd(L.ProtaY)} X=${rd(L.ProtaX)} room=${rd(L.ProtaRoom)}`);
  let f = 0; while (f < 240 && rd(L.flagVivo) !== 0) { run(1); f++; }
  console.log(`  flagVivo=${rd(L.flagVivo)} через ${f} кадров, GameStatus=${rd(L.GameStatus)}`);
}
const death = shutterScan("СМЕРТЬ");

// ---- сцена 2: переход читом N ---------------------------------------------------------
console.log("");
console.log("=== сцена 2: переход читом N ===");
{
  let f = 0;
  while (f < 2000 && !(rd(L.GameStatus) === 5 && (rd(L.flagPiramideMap) & 1))) { run(1); f++; }
  if (f >= 2000) { console.log("не вернулись в геймплей после смерти"); process.exit(2); }
  run(90);
}
console.log(`геймплей: ProtaY=${rd(L.ProtaY)} ProtaX=${rd(L.ProtaX)} пирамида=${rd(L.piramideActual)}`);
key(78, 1); run(3); key(78, 0);
const hop = shutterScan("ЧИТ-N");

// ---- декларация покрытия --------------------------------------------------------------
console.log("");
const COVER = [["смерть", death], ["чит N", hop]];
let ok = true;
for (const [n, r] of COVER) {
  if (!r) { console.log(`  СЦЕНА НЕ ЗАМЕРЕНА: ${n} — ПРОВАЛ ПОКРЫТИЯ`); ok = false; continue; }
  if (r.spr === 0) { console.log(`  СЦЕНА ПУСТА: ${n} — ни одного видимого спрайта, мерить нечего`); ok = false; continue; }
  console.log(`  ${n}: видимых спрайтов ${r.spr}, кадров шторки с остатками ${r.frames}`);
}
if (!ok) process.exit(1);
process.exit(0);
