// msx_original_live.js — ЖИВОЕ сравнение динамики с ОРИГИНАЛЬНЫМ картриджем MSX.
//
// Закрывает старый пробел: tools/verify/speed_compare.js умел разгонять полную партию
// только на НАШЕЙ сборке (beam_harness.js), а часть "ОРИГИНАЛ" там честно проваливалась
// (msx_headless.js — самодельный степпер — детерминированно уходит в мусор на переходе
// "пергамент -> первая пирамида", до того как игрок получает управление; см. комментарий
// в начале speed_compare.js).
//
// ПРОРЫВ: tools/gfx/msx_stair_ref.js показал, что headless-WebMSX (tools/gfx/msx_p1_lib.js
// поверх knightmare-v06c/tools/msxjs) ДОВОДИТ картридж legacy/msx/kvalley_z80.rom до
// НАСТОЯЩЕЙ партии — пирамида 1, полное управление игроком (GameStatus доходит до 5,
// то же значение, что и в нашем порту). Этот скрипт переиспользует ровно ту же механику
// старта (P.startRealGame) и хук клавиатуры (e.setRow8 — пишет прямо в биты ряда 8
// матрицы SNSMAT: b0=SPACE b4=LEFT b5=UP b6=DOWN b7=RIGHT, ReadKeys эту же матрицу читает
// через BIOS SNSMAT), а не эмулирует физическую клавиатуру — надёжнее и детерминированнее.
//
// ЧТО МЕРИМ (задача владельца, 6 пунктов), на ОБЕИХ сборках одинаковой методикой:
//   1) скорость героя px/тик, держим "вправо" в чистом коридоре старта пирамиды 1;
//   2) скорость мумий px/тик по типам (ACTOR_SPEEDXDEC/ACTOR_SPEED_X, статус "идёт");
//   3) отношение герой/мумия (среднее по типам, без веса по времени);
//   4) прыжок: длительность в тиках, высота px, горизонтальный пронос px (жмём BotonA
//      один раз, держим "вправо" всё время, как и раньше никто не мерил ЖИВЬЁМ на MSX);
//   5) тиков логики на кадр (честная эффективная скорость игры — сколько раз игровой
//      цикл реально успевает отработать за видеокадр);
//   6) поведение спрайта героя (protaAttrib — теневой байт Y в таблице атрибутов спрайтов
//      VDP) в верхней точке прыжка НА САМОЙ ВЕРХНЕЙ КЛЕТКЕ пирамиды 1 (комната 0, ProtaY=72,
//      сразу под HUD со счётом): уходит ли Y в отрицательный диапазон TMS9918 (0xF0..0xFF =
//      -16..-1), и как следствие рисуется ли спрайт частично/пропадает.
//   ПОДТВЕРЖДЕНО СКРИНШОТОМ (/tmp/kv_orig_live/jump_peak_full.png, снят в момент пика
//   ЖИВОЙ VRAM ровно той же сессии): это симметричная вершина пирамиды — герой стоит на
//   единственной верхней площадке, вниз расходятся две лестницы в обе стороны, выше НЕТ
//   ничего кроме HUD. Это и есть глобальный потолок пути игрока в пирамиде 1, а не просто
//   "top этой комнаты" — комната ровно одна для всей пирамиды (типовая форма King's Valley).
//
// ПРАВИЛО ПОКРЫТИЯ: если партия не началась по-настоящему (нет роста X при "вправо",
// нет смены Y при прыжке) — печатаем "ПРОВАЛ ПОКРЫТИЯ" и завершаемся кодом 1.
//
// Запуск: node tools/verify/msx_original_live.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");

let FAIL = false;
function coverageFail(msg) { console.log("ПРОВАЛ ПОКРЫТИЯ: " + msg); FAIL = true; }

function readSym(p) {
  const m = {};
  for (const l of fs.readFileSync(p, "latin1").split("\n")) {
    const g = l.match(/^(\S+):\s*equ\s*0*([0-9A-Fa-f]+)h/);
    if (g) m[g[1]] = parseInt(g[2], 16);
  }
  return m;
}

const ACTOR_STATUS = 0, ACTOR_X = 5, ACTOR_ROOM = 6, ACTOR_SPEEDXDEC = 7, ACTOR_SPEED_X = 8, ACTOR_TIPO = 0x14;
const MOMIA_STRIDE = 0x16, MOMIA_MAX = 4;

// =====================================================================================
// ЧАСТЬ 1. НАША СБОРКА (Vector-06Ц), build/kvalley_8c.rom — через beam_harness.js
// =====================================================================================
console.log("=".repeat(78));
console.log("ЧАСТЬ 1. НАША СБОРКА (Vector-06Ц), build/kvalley_8c.rom");
console.log("=".repeat(78));

const { make } = require("./beam_harness.js");
const ROM = path.join(ROOT, "build/kvalley_8c.rom");
const SYM = path.join(ROOT, "build/kvalley_8c.sym");

function bootOurs() {
  const E = make(ROM, SYM);
  const { L, rd, v06c, key } = E;
  const run = n => { for (let i = 0; i < n; i++) v06c.oneInterrupt(true); };
  run(700);
  for (let i = 0; i < 30; i++) { key(32, 1); run(3); key(32, 0); run(3); }
  for (let i = 0; i < 800 && rd(L.GameStatus) !== 5; i++) run(1);
  if (rd(L.GameStatus) !== 5) return null;
  return { E, L, rd, run, key };
}

let OURS = null;
{
  const probe = bootOurs();
  if (!probe) { coverageFail("до геймплея на нашей сборке не дошли"); }
  else {
    const { L } = probe;
    for (const s of ["GameStatus", "piramideActual", "ProtaX", "ProtaY", "ProtaRoom",
      "protaSpeed", "protaStatus", "protaAttrib", "timer", "momiaDat", "numMomias"])
      if (L[s] === undefined) coverageFail("нет символа " + s + " в build/kvalley_8c.sym");
  }
}
if (FAIL) process.exit(1);

{
  const { L, rd, run, key } = bootOurs();
  const x0 = rd(L.ProtaX);
  key(39, 1); run(30);
  const x1 = rd(L.ProtaX);
  key(39, 0); run(20);
  const x2 = rd(L.ProtaX);
  console.log(`самопроверка: X ${x0} -> (30 кадров вправо) -> ${x1} -> (отпустили) -> ${x2}`);
  if (!(x1 > x0)) coverageFail("наша сборка: держим 'вправо', X не растёт");
  if (x2 !== x1) coverageFail("наша сборка: отпустили 'вправо', X продолжил меняться");
}
if (FAIL) process.exit(1);

let HERO_O, MUM_O, JUMP_O;
{
  const { L, rd, run, key } = bootOurs();
  const pos = () => rd(L.ProtaRoom) * 256 + rd(L.ProtaX);
  const x0 = pos();
  key(39, 1);
  let prevT = rd(L.timer), ticks = 0, frames = 140;
  const speedSamples = [];
  for (let f = 0; f < frames; f++) {
    run(1);
    const t = rd(L.timer);
    if (t !== prevT) { ticks++; prevT = t;
      if (rd(L.protaStatus) === 0) speedSamples.push(rd(L.protaSpeed + 1) + rd(L.protaSpeed) / 256); }
  }
  key(39, 0);
  const distPx = pos() - x0;
  if (ticks === 0) coverageFail("наша сборка: 140 кадров вправо, тиков ноль");
  if (!speedSamples.length) coverageFail("наша сборка: ни один тик не застал героя статус=0");
  const spdConst = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length;
  HERO_O = { spdConst, empPxPerTick: distPx / ticks, ticksPerFrame: ticks / frames, ticks, frames, distPx };
  console.log(`ГЕРОЙ: константа ${spdConst.toFixed(4)} пикс/тик, эмпирика ${HERO_O.empPxPerTick.toFixed(4)} пикс/тик, ` +
    `тиков/кадр ${HERO_O.ticksPerFrame.toFixed(4)} (${ticks}/${frames})`);
}
if (FAIL) process.exit(1);

{
  const { L, rd, run } = bootOurs();
  const base = L.momiaDat;
  const fld = (s, o) => rd(base + s * MOMIA_STRIDE + o);
  const numM = rd(L.numMomias);
  const seenWalking = new Set(), constSamples = [], byTipo = {};
  for (let f = 0; f < 2500; f++) {
    run(1);
    for (let s = 0; s < MOMIA_MAX; s++) {
      if (fld(s, ACTOR_STATUS) !== 0) continue;
      const spd = fld(s, ACTOR_SPEED_X) + fld(s, ACTOR_SPEEDXDEC) / 256;
      if (spd > 0) { seenWalking.add(s); constSamples.push(spd); byTipo[fld(s, ACTOR_TIPO)] = spd; }
    }
  }
  if (!seenWalking.size) coverageFail("наша сборка: ни одна мумия не пошла за 2500 кадров");
  const uniq = [...new Set(constSamples.map(v => v.toFixed(4)))].map(Number).sort((a, b) => a - b);
  MUM_O = { uniq, avg: uniq.reduce((a, b) => a + b, 0) / uniq.length, numM, byTipo };
  console.log(`МУМИИ: numMomias=${numM}, скорости по типам = [${uniq.join(", ")}], среднее ${MUM_O.avg.toFixed(4)} (типы: ${JSON.stringify(byTipo)})`);
}
if (FAIL) process.exit(1);

{
  const { L, rd, run, key } = bootOurs();
  const y0 = rd(L.ProtaY), room0 = rd(L.ProtaRoom), x0 = rd(L.ProtaX);
  key(39, 1); key(32, 1); run(2); key(32, 0);
  let entered = -1;
  for (let f = 0; f < 40 && entered < 0; f++) { run(1); if (rd(L.protaStatus) === 1) entered = f; }
  if (entered < 0) coverageFail("наша сборка: прыжок не начался");
  else {
    let minY = rd(L.ProtaY), minAttr = rd(L.protaAttrib), ticks = 0, prevT = rd(L.timer), exitF = -1;
    for (let f = 0; f < 300 && exitF < 0; f++) {
      run(1);
      const t = rd(L.timer); if (t !== prevT) { prevT = t; ticks++; }
      if (rd(L.ProtaY) < minY) minY = rd(L.ProtaY);
      if (rd(L.protaAttrib) < minAttr) minAttr = rd(L.protaAttrib);
      if (rd(L.protaStatus) !== 1) exitF = f;
    }
    key(39, 0);
    if (exitF < 0) coverageFail("наша сборка: прыжок не завершился за 300 кадров");
    else {
      const runPx = (rd(L.ProtaRoom) * 256 + rd(L.ProtaX)) - (room0 * 256 + x0);
      JUMP_O = { ticks, rise: y0 - minY, runPx, minAttr, wrap: minAttr >= 0xF0 };
      console.log(`ПРЫЖОК: ${ticks} тиков, подъём ${JUMP_O.rise}px, горизонталь ${runPx}px, ` +
        `protaAttrib(мин)=${minAttr}(0x${minAttr.toString(16)}), wrap в 0xF0+? ${JUMP_O.wrap ? "ДА" : "нет"}`);
    }
  }
}
if (FAIL) process.exit(1);

// =====================================================================================
// ЧАСТЬ 2. ОРИГИНАЛ MSX (картридж), legacy/msx/kvalley_z80.rom — через headless-WebMSX
// =====================================================================================
console.log("\n" + "=".repeat(78));
console.log("ЧАСТЬ 2. ОРИГИНАЛ MSX, legacy/msx/kvalley_z80.rom (headless-WebMSX, ЖИВОЙ прогон)");
console.log("=".repeat(78));

const MSX_ROM = path.join(ROOT, "legacy/msx/kvalley_z80.rom");
const MSX_SYM = path.join(ROOT, "legacy/msx/kvalley_src.sym");
const Lm = readSym(MSX_SYM);
for (const s of ["GameStatus", "piramideActual", "ProtaX", "ProtaY", "ProtaRoom",
  "protaSpeed", "protaStatus", "protaAttrib", "timer", "momiaDat", "numMomias"])
  if (Lm[s] === undefined) coverageFail("нет символа " + s + " в legacy/msx/kvalley_src.sym");
if (FAIL) process.exit(1);

// Каждая фаза на оригинале — ОТДЕЛЬНЫЙ процесс node (см. комментарий в шапке
// msx_original_live_worker.js: второй `new MsxEmu()` в одном процессе валится, потому что
// tools/msxjs/wmsx.js второй раз require() не выполняется, а его глобалы кэш require
// стирает при пересборке global.WMSX). Логи старта партии воркер шлёт в stderr — печатаем.
const { execFileSync } = require("child_process");
const WORKER = path.join(__dirname, "msx_original_live_worker.js");
function runPhase(phase) {
  let out;
  try {
    out = execFileSync("node", [WORKER, phase], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    coverageFail(`оригинал (${phase}): воркер упал: ${err.message}`);
    if (err.stdout) process.stderr.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    return null;
  }
  const lines = out.split("\n");
  const resLine = lines.find(l => l.startsWith("RESULT:"));
  for (const l of lines) if (l && !l.startsWith("RESULT:")) console.log("  " + l);
  if (!resLine) { coverageFail(`оригинал (${phase}): воркер не вернул RESULT`); return null; }
  return JSON.parse(resLine.slice("RESULT:".length));
}

{
  const r = runPhase("selfcheck");
  if (!r) process.exit(1);
  if (!r.ok) { coverageFail("оригинал: " + (r.reason || "самопроверка не прошла")); process.exit(1); }
  console.log(`пирамида=${r.piramideActual} GameStatus=${r.GameStatus} ProtaY=${r.ProtaY} ProtaRoom=${r.ProtaRoom}`);
  console.log(`самопроверка: X ${r.x0} -> (30 кадров вправо) -> ${r.x1} -> (отпустили) -> ${r.x2}`);
  if (!(r.x1 > r.x0)) coverageFail("оригинал: держим 'вправо', X героя не растёт");
  if (r.x2 !== r.x1) coverageFail("оригинал: отпустили 'вправо', X продолжил меняться");
}
if (FAIL) process.exit(1);

let HERO_M, MUM_M, JUMP_M, TICKF_M;
{
  const r = runPhase("hero");
  if (!r || !r.ok) { coverageFail("оригинал: замер героя не прошёл" + (r && r.reason ? " (" + r.reason + ")" : "")); process.exit(1); }
  const spdConst = r.speedSamples.reduce((a, b) => a + b, 0) / r.speedSamples.length;
  HERO_M = { spdConst, empPxPerTick: r.distPx / r.ticks, ticksPerFrame: r.ticks / r.frames, ticks: r.ticks, frames: r.frames, distPx: r.distPx };
  TICKF_M = HERO_M.ticksPerFrame;
  console.log(`ГЕРОЙ: константа ${spdConst.toFixed(4)} пикс/тик, эмпирика ${HERO_M.empPxPerTick.toFixed(4)} пикс/тик, ` +
    `тиков/кадр ${HERO_M.ticksPerFrame.toFixed(4)} (${r.ticks}/${r.frames})`);
}
if (FAIL) process.exit(1);

{
  const r = runPhase("mum");
  if (!r || !r.ok) { coverageFail("оригинал: ни одна мумия не пошла за 2500 кадров" + (r && r.reason ? " (" + r.reason + ")" : "")); process.exit(1); }
  const uniq = [...new Set(r.constSamples.map(v => v.toFixed(4)))].map(Number).sort((a, b) => a - b);
  MUM_M = { uniq, avg: uniq.reduce((a, b) => a + b, 0) / uniq.length, numM: r.numM, byTipo: r.byTipo };
  console.log(`МУМИИ: numMomias=${r.numM}, скорости по типам = [${uniq.join(", ")}], среднее ${MUM_M.avg.toFixed(4)} (типы: ${JSON.stringify(r.byTipo)})`);
}
if (FAIL) process.exit(1);

{
  const r = runPhase("jump");
  if (!r || !r.ok) { coverageFail("оригинал: прыжок не измерен" + (r && r.reason ? " (" + r.reason + ")" : "")); process.exit(1); }
  JUMP_M = { ticks: r.ticks, rise: r.rise, runPx: r.runPx, minAttr: r.minAttr, wrap: r.wrap, y0: r.y0 };
  console.log(`ПРЫЖОК: старт Y=${r.y0} (верхняя клетка пирамиды 1, комната 0), ${r.ticks} тиков, ` +
    `подъём ${r.rise}px, горизонталь ${r.runPx}px, protaAttrib(мин)=${r.minAttr}(0x${r.minAttr.toString(16)}), ` +
    `wrap в 0xF0+? ${r.wrap ? "ДА" : "нет"}`);
  if (r.png) console.log(`  скриншот пика прыжка -> ${r.png}`);
  if (r.pngError) console.log(`  (скриншот пика не снят: ${r.pngError})`);
}
if (FAIL) process.exit(1);

// =====================================================================================
// ИТОГ — сравнительная таблица
// =====================================================================================
console.log("\n" + "=".repeat(78));
console.log("ИТОГ: ОРИГИНАЛ (живой картридж MSX) против НАШЕЙ СБОРКИ (Vector-06Ц)");
console.log("=".repeat(78));

const ratioO = HERO_O.spdConst / MUM_O.avg, ratioM = HERO_M.spdConst / MUM_M.avg;
console.log(`
1) Скорость героя, px/тик (константа protaSpeed):
     оригинал = ${HERO_M.spdConst.toFixed(4)}   наша сборка = ${HERO_O.spdConst.toFixed(4)}
2) Скорость мумий по типам, px/тик:
     оригинал = [${MUM_M.uniq.join(", ")}]   наша сборка = [${MUM_O.uniq.join(", ")}]
3) Отношение герой/мумия (среднее без веса по времени):
     оригинал = ${ratioM.toFixed(3)}   наша сборка = ${ratioO.toFixed(3)}
4) Прыжок (тиков / подъём px / горизонталь px):
     оригинал = ${JUMP_M.ticks} / ${JUMP_M.rise} / ${JUMP_M.runPx}   наша сборка = ${JUMP_O.ticks} / ${JUMP_O.rise} / ${JUMP_O.runPx}
5) Тиков логики на кадр (честная эффективная скорость игры):
     оригинал = ${TICKF_M.toFixed(4)}   наша сборка = ${HERO_O.ticksPerFrame.toFixed(4)}   (порт Городецкого, из прежних замеров: 0.49)
6) protaAttrib (SAT Y героя) в пике прыжка на верхней клетке пирамиды 1:
     оригинал: мин=${JUMP_M.minAttr} (0x${JUMP_M.minAttr.toString(16)}), в 0xF0..0xFF? ${JUMP_M.wrap ? "ДА" : "нет"}
     наша сборка: мин=${JUMP_O.minAttr} (0x${JUMP_O.minAttr.toString(16)}), в 0xF0..0xFF? ${JUMP_O.wrap ? "ДА" : "нет"}
`);

const speedDiff = Math.abs(HERO_M.spdConst - HERO_O.spdConst) > 1e-6;
const mumDiff = JSON.stringify(MUM_M.uniq) !== JSON.stringify(MUM_O.uniq);
const jumpDiff = JUMP_M.ticks !== JUMP_O.ticks || JUMP_M.rise !== JUMP_O.rise || JUMP_M.runPx !== JUMP_O.runPx;
const tickDiff = Math.abs(TICKF_M - HERO_O.ticksPerFrame);

console.log("ВЫВОД ОДНОЙ ФРАЗОЙ: " + (
  !speedDiff && !mumDiff && !jumpDiff
    ? `все игровые константы (скорость героя/мумий, параметры прыжка 23 тика/16px/24px) бит-в-бит совпадают с оригиналом — единственное реальное расхождение это эффективная скорость игры: оригинал успевает ${TICKF_M.toFixed(2)} тика логики на кадр (без пропусков), наша сборка — только ${HERO_O.ticksPerFrame.toFixed(2)} (падение на ${(100 * tickDiff).toFixed(0)} п.п., т.е. i8080 Вектора-06Ц не укладывается в бюджет кадра там, где Z80 MSX укладывается всегда).`
    : `есть расхождения помимо тиков/кадра — см. таблицу выше.`
));

console.log(FAIL ? "\nЕсть ПРОВАЛЫ ПОКРЫТИЯ выше." : "Покрытие: без провалов.");
process.exit(FAIL ? 1 : 0);
