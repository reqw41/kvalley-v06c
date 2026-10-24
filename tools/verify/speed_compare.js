// speed_compare.js — ЗАМЕР: скорость героя и мумий (наша сборка) + попытка того же
// на оригинальном MSX-картридже, для ответа на вопрос владельца «не бегает ли герой
// быстрее мумий, чем в оригинале».
//
// НАША СБОРКА (build/kvalley_8c.rom, beam_harness.js): полный живой прогон.
//   - скорость героя: (а) прямое чтение protaSpeed, пока герой идёт (status=0) и
//     держится "вправо"; (б) эмпирический замер — смещение (room*256+X) по тикам
//     таймера в открытом коридоре старта пирамиды 1.
//   - скорость мумий: то же самое для живых мумий в состоянии "идёт" (ACTOR_STATUS=0)
//     через таблицу momiaDat (ACTOR_SPEEDXDEC/ACTOR_SPEED_X), плюс эмпирический замер
//     смещения по тикам.
//   - прыжок: держим "вправо", жмём пробел (BotonA) один раз, ждём protaStatus=1,
//     считаем тики/подъём/горизонталь до выхода из состояния "прыжок".
//   - тики/кадр: сколько раз `timer` реально меняется на N кадров в чистом коридоре
//     (без стен/дверей) — если < 1, логика пропускает часть кадров (бюджет времени).
//
// ОРИГИНАЛ MSX (legacy/msx/kvalley_z80.rom, msx_headless.js): по разбору ReadKeys в
// kvalley_src.asm ряд 8 SNSMAT (active-low): бит0=SPACE(BotonA), бит4=LEFT, бит5=UP,
// бит6=DOWN, бит7=RIGHT.
// ПРОБЛЕМА (см. README.md инструментов): headless-стенд писался под локстеп первых
// ~300-800 тиков (заставка/меню/демо), НЕ под полный прогон. Эмпирически (см. ниже)
// прогон детерминированно падает в мусор при переходе "пергамент -> первая пирамида"
// (около кадра 400-450: GameStatus/ProtaRoom/protaStatus слипаются в один байт), ДО
// того как игрок получает управление (protaControl всё это время = 0, ProtaX не
// движется). Воспроизводится и с зажатым "вправо", и без — не баг клавиш, а нехватка
// стаба BIOS/VDP при отрисовке комнаты. Живых чисел с оригинала эмулятор не даёт:
// скрипт это ЧЕСТНО печатает и код возврата не занижает.
//
// Что мы МОЖЕМ сказать про оригинал без живого прогона — статические факты из
// дизассемблера (legacy/msx/kvalley_src.asm), перепроверенные побайтно на СВОЁМ же
// порту (src/game/kvalley_game.asm): protaSpeed при ходьбе = 0x00A8 (см. finEntraSale),
// таблица tiposMomia = 5F,59,A4,A8,BA — в ОБОИХ листингах идентичны, и подпрограмма
// mueveElemento уже верифицирована бит-в-бит юнит-тестом (400 случайных структур,
// tools/verify/README.md). Это не "прогон", а сверка исходников — помечено отдельно.
//
// Запуск: node tools/verify/speed_compare.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const { make } = require("./beam_harness.js");
const MsxHeadless = require("./msx_headless.js");

let FAIL = false;
function coverageFail(msg) { console.log("ПРОВАЛ ПОКРЫТИЯ: " + msg); FAIL = true; }

const ROM = path.join(ROOT, "build/kvalley_8c.rom");
const SYM = path.join(ROOT, "build/kvalley_8c.sym");
const MSX_ROM = path.join(ROOT, "legacy/msx/kvalley_z80.rom");
const MSX_SYM = path.join(ROOT, "legacy/msx/kvalley_src.sym");

function readSym(p) {
  const m = {};
  for (const l of fs.readFileSync(p, "latin1").split("\n")) {
    const g = l.match(/^(\S+):\s*equ\s*0*([0-9A-Fa-f]+)h/);
    if (g) m[g[1]] = parseInt(g[2], 16);
  }
  return m;
}

// --- ЕДИНЫЙ старт партии на нашей сборке: пирамида 1, полное управление игроком.
// (та же последовательность, что в tools/verify/trap_wall_gate.js/hero_top_stress.js)
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

console.log("=".repeat(78));
console.log("ЧАСТЬ 1. НАША СБОРКА (Vector-06Ц), build/kvalley_8c.rom");
console.log("=".repeat(78));

{
  const probe = bootOurs();
  if (!probe) { coverageFail("до геймплея на нашей сборке не дошли"); process.exit(1); }
  const { L } = probe;
  for (const s of ["GameStatus", "piramideActual", "ProtaX", "ProtaY", "ProtaRoom",
    "ProtaXdecimal", "protaSpeed", "protaStatus", "protaControl", "KeyHold", "timer",
    "momiaDat", "numMomias", "objetoCogido"])
    if (L[s] === undefined) coverageFail("нет символа " + s + " в build/kvalley_8c.sym");
}
if (FAIL) process.exit(1);

const ACTOR_STATUS = 0, ACTOR_X = 5, ACTOR_ROOM = 6, ACTOR_SPEEDXDEC = 7, ACTOR_SPEED_X = 8;
const MOMIA_STRIDE = 0x16, MOMIA_MAX = 4;

// --- САМООЧЕВИДНАЯ ПРОВЕРКА: вправо -> X растёт, отпустили -> перестаёт ---
{
  const { L, rd, run, key } = bootOurs();
  console.log(`старт: piramideActual=${rd(L.piramideActual)}, ProtaX=${rd(L.ProtaX)} ProtaY=${rd(L.ProtaY)} ProtaRoom=${rd(L.ProtaRoom)}`);
  const x0 = rd(L.ProtaX);
  key(39, 1); run(30);
  const x1 = rd(L.ProtaX);
  key(39, 0); run(20);
  const x2 = rd(L.ProtaX);
  console.log(`самопроверка: X ${x0} -> (держим вправо 30 кадров) -> ${x1} -> (отпустили, +20 кадров) -> ${x2}`);
  if (!(x1 > x0)) coverageFail("держим 'вправо' 30 кадров, а X героя не растёт (x0=" + x0 + " x1=" + x1 + ")");
  if (x2 !== x1) coverageFail("отпустили 'вправо', а X героя продолжил меняться (x1=" + x1 + " x2=" + x2 + ")");
}
if (FAIL) process.exit(1);

// --- ХОД 1: скорость героя, чистый коридор от старта, держим "вправо" ---
let HERO;
{
  const { L, rd, run, key } = bootOurs();
  const pos = () => rd(L.ProtaRoom) * 256 + rd(L.ProtaX);
  const x0 = pos();
  key(39, 1);
  let prevT = rd(L.timer), ticks = 0, framesUsed = 0;
  const HERO_WINDOW = 140; // подобрано пробой: до первой стены на пирамиде 1
  const speedSamples = [];
  for (let f = 0; f < HERO_WINDOW; f++) {
    run(1); framesUsed++;
    const t = rd(L.timer);
    if (t !== prevT) {
      ticks++; prevT = t;
      if (rd(L.protaStatus) === 0) {
        const lo = rd(L.protaSpeed), hi = rd(L.protaSpeed + 1);
        speedSamples.push(hi + lo / 256);
      }
    }
  }
  key(39, 0);
  const x1 = pos();
  const distPx = x1 - x0;
  if (ticks === 0) coverageFail("герой держал 'вправо' " + HERO_WINDOW + " кадров, тиков таймера ноль");
  if (!speedSamples.length) coverageFail("ни один тик не застал героя в статусе 'идёт' (protaStatus=0) для чтения protaSpeed");
  const protaSpeedConst = speedSamples.length ? speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length : NaN;
  const empPxPerTick = ticks ? distPx / ticks : NaN;
  const empPxPerFrame = framesUsed ? distPx / framesUsed : NaN;
  const ticksPerFrame = framesUsed ? ticks / framesUsed : NaN;
  console.log(`\nГЕРОЙ (наша сборка), окно ${HERO_WINDOW} кадров чистого коридора пирамиды 1:`);
  console.log(`  чтение protaSpeed, пока идёт: ${protaSpeedConst.toFixed(4)} пикс/тик (${speedSamples.length} проб, разброс: ${[...new Set(speedSamples.map(v=>v.toFixed(4)))].join(",")})`);
  console.log(`  эмпирика: смещение ${distPx}px за ${ticks} тиков (${framesUsed} кадров) = ${empPxPerTick.toFixed(4)} пикс/тик, ${empPxPerFrame.toFixed(4)} пикс/КАДР`);
  console.log(`  тиков/кадр в этом окне: ${ticksPerFrame.toFixed(4)} (${ticks}/${framesUsed})`);
  HERO = { protaSpeedConst, empPxPerTick, empPxPerFrame, ticksPerFrame, ticks, framesUsed, distPx };
}
if (FAIL) process.exit(1);

// --- ХОД 2: скорость мумий ---
let MUM;
{
  const { L, rd, run } = bootOurs();
  const base = L.momiaDat;
  const fld = (slot, off) => rd(base + slot * MOMIA_STRIDE + off);
  const posM = slot => fld(slot, ACTOR_ROOM) * 256 + fld(slot, ACTOR_X);
  const numM = rd(L.numMomias);
  console.log(`numMomias (мумий в этой пирамиде) = ${numM}`);

  const seenWalking = new Set();
  const constSamples = [];               // из ACTOR_SPEEDXDEC/ACTOR_SPEED_X, пока status=0, speed>0
  let zeroSpeedSamples = 0;              // status=0, но скорость 0 (пустой/неактивный слот)
  // эмпирика: суммарный путь / число тиков ПОДРЯД в статусе "идёт" на слот, отдельными пробегами
  const runs = [];                       // {slot, dist, ticks}
  let curRun = new Array(MOMIA_MAX).fill(null); // {startPos, ticks}
  let prevT = rd(L.timer);
  const prevStatus = new Array(MOMIA_MAX).fill(-1);
  const MUM_WINDOW = 2500;
  for (let f = 0; f < MUM_WINDOW; f++) {
    run(1);
    const t = rd(L.timer);
    if (t === prevT) continue;
    prevT = t;
    for (let s = 0; s < MOMIA_MAX; s++) {
      const st = fld(s, ACTOR_STATUS);
      if (st === 0) {
        const lo = fld(s, ACTOR_SPEEDXDEC), hi = fld(s, ACTOR_SPEED_X);
        const spd = hi + lo / 256;
        if (spd > 0) {
          seenWalking.add(s);
          constSamples.push(spd);
          if (prevStatus[s] !== 0) curRun[s] = { startPos: posM(s), ticks: 0 };
          curRun[s].ticks++;
        } else {
          zeroSpeedSamples++;
          curRun[s] = null;
        }
      } else {
        if (curRun[s] && curRun[s].ticks >= 5) {
          const dist = Math.abs(posM(s) - curRun[s].startPos);
          if (dist < 40) runs.push({ slot: s, dist, ticks: curRun[s].ticks }); // отсекаем скачок комнаты
        }
        curRun[s] = null;
      }
      prevStatus[s] = st;
    }
  }
  // закрыть незавершённые пробеги в конце окна
  for (let s = 0; s < MOMIA_MAX; s++)
    if (curRun[s] && curRun[s].ticks >= 5) {
      const dist = Math.abs(posM(s) - curRun[s].startPos);
      if (dist < 40) runs.push({ slot: s, dist, ticks: curRun[s].ticks });
    }
  if (!seenWalking.size) coverageFail("за " + MUM_WINDOW + " кадров ни одна мумия не оказалась в статусе 'идёт' с ненулевой скоростью (ACTOR_STATUS=0)");
  if (!constSamples.length) coverageFail("не удалось прочитать ACTOR_SPEEDXDEC/ACTOR_SPEED_X ни разу");
  if (!runs.length) coverageFail("не набралось ни одного непрерывного пробега мумии (>=5 тиков подряд статус='идёт') для эмпирического замера");
  if (!FAIL) {
    const uniqConst = [...new Set(constSamples.map(v => v.toFixed(4)))].map(Number).sort((a, b) => a - b);
    const avgConst = constSamples.reduce((a, b) => a + b, 0) / constSamples.length;
    const totalDist = runs.reduce((a, r) => a + r.dist, 0), totalTicks = runs.reduce((a, r) => a + r.ticks, 0);
    const avgEmp = totalDist / totalTicks;
    console.log(`\nМУМИИ (наша сборка), окно ${MUM_WINDOW} кадров, слотов замечено идущими (скорость>0): ${seenWalking.size}/${MOMIA_MAX}` +
      ` (проб со скоростью=0, то есть пустой/неактивный слот в статусе 0: ${zeroSpeedSamples}):`);
    console.log(`  чтение ACTOR_SPEEDXDEC/ACTOR_SPEED_X (только >0): константы = [${uniqConst.join(", ")}] пикс/тик, среднее по пробам ${avgConst.toFixed(4)}`);
    console.log(`  эмпирика: ${runs.length} непрерывных пробегов, суммарно ${totalDist}px за ${totalTicks} тиков = ${avgEmp.toFixed(4)} пикс/тик`);
    console.log(`  (эмпирика ЗАНИЖЕНА относительно константы: мумия в статусе "идёт" часто стоит,`);
    console.log(`   упёршись в стену/дверь, и не продвигается, хотя chkChocaAndar ещё не сменил статус —`);
    console.log(`   для "скорости при ходьбе" верна КОНСТАНТА ACTOR_SPEEDXDEC/ACTOR_SPEED_X, не голое смещение)`);
    MUM = { avgConst, avgEmp, uniqConst, samples: constSamples.length };
  }
}
if (FAIL) process.exit(1);

// --- ХОД 3: прыжок героя ---
let JUMP;
{
  const { L, rd, run, key } = bootOurs();
  const y0 = rd(L.ProtaY), room0 = rd(L.ProtaRoom), x0 = rd(L.ProtaX);
  key(39, 1); // держим "вправо" всю дорогу — замеряем прыжок со сдвигом
  key(32, 1); run(2); key(32, 0);
  let entered = -1;
  for (let f = 0; f < 40 && entered < 0; f++) { run(1); if (rd(L.protaStatus) === 1) entered = f; }
  if (entered < 0) {
    coverageFail("прыжок не начался: нажали BotonA у старта пирамиды, protaStatus за 40 кадров в 1 не перешёл (=" + rd(L.protaStatus) + ")");
  } else {
    let minY = rd(L.ProtaY), ticksInJump = 0, prevT = rd(L.timer), exitFrame = -1;
    for (let f = 0; f < 300 && exitFrame < 0; f++) {
      run(1);
      const t = rd(L.timer);
      if (t !== prevT) { prevT = t; ticksInJump++; }
      if (rd(L.ProtaY) < minY) minY = rd(L.ProtaY);
      if (rd(L.protaStatus) !== 1) exitFrame = f;
    }
    key(39, 0);
    const yEnd = rd(L.ProtaY), roomEnd = rd(L.ProtaRoom), xEnd = rd(L.ProtaX);
    const rise = y0 - minY;
    const runPx = (roomEnd * 256 + xEnd) - (room0 * 256 + x0);
    if (exitFrame < 0) coverageFail("прыжок не завершился за 300 кадров (завис в protaStatus=1)");
    if (!FAIL) {
      console.log(`\nПРЫЖОК героя (наша сборка): начался на кадре ${entered} после нажатия BotonA;`);
      console.log(`  длительность в статусе 'прыжок': ${ticksInJump} тиков (${exitFrame} кадров реального времени)`);
      console.log(`  подъём по Y: старт ${y0} -> пик ${minY} = ${rise}px вверх; выход по Y=${yEnd}`);
      console.log(`  смещение по X за весь замер (взлёт+вправо всё время): ${runPx}px (room ${room0}->${roomEnd}, X ${x0}->${xEnd})`);
      JUMP = { ticksInJump, exitFrame, rise, runPx };
    }
  }
}
if (FAIL) process.exit(1);

console.log("\n" + "=".repeat(78));
console.log("ЧАСТЬ 2. ОРИГИНАЛ MSX (кассета/картридж), legacy/msx/kvalley_z80.rom");
console.log("=".repeat(78));

{
  const Lm = readSym(MSX_SYM);
  for (const s of ["GameStatus", "flagPiramideMap", "protaControl", "KeyHold", "ProtaX",
    "ProtaY", "ProtaRoom", "protaStatus", "protaSpeed", "timer"])
    if (Lm[s] === undefined) console.log("  (нет символа " + s + " в kvalley_src.sym)");

  const m = MsxHeadless(new Uint8Array(fs.readFileSync(MSX_ROM)));
  const rdm = a => m.mem[a & 0xffff];
  const RIGHT = 0x80, SPACE = 0x01;
  const keym = (mask, down) => { if (down) m.kbd[8] &= ~mask; else m.kbd[8] |= mask; };

  for (let i = 0; i < 200; i++) m.frame();
  for (let i = 0; i < 60 && rdm(Lm.GameStatus) !== 5; i++) { keym(SPACE, 1); for (let j = 0; j < 4; j++) m.frame(); keym(SPACE, 0); for (let j = 0; j < 4; j++) m.frame(); }
  console.log(`старт: GameStatus=${rdm(Lm.GameStatus)} (5 = «идёт логика игры/пергамента»)`);

  keym(RIGHT, 1);
  let reachedRoom = false, crashed = false;
  const x0 = rdm(Lm.ProtaX);
  for (let f = 0; f < 900; f++) {
    m.frame();
    if (rdm(Lm.flagPiramideMap) === 1 && rdm(Lm.GameStatus) === 5) reachedRoom = true;
    // признак ухода в мусор: несколько разных game-переменных подряд получили один и тот же байт
    if (rdm(Lm.GameStatus) === rdm(Lm.protaStatus) && rdm(Lm.GameStatus) === rdm(Lm.ProtaRoom) && rdm(Lm.GameStatus) > 6) { crashed = true; break; }
  }
  keym(RIGHT, 0);
  const x1 = rdm(Lm.ProtaX);

  if (crashed || !reachedRoom) {
    coverageFail("MSX headless НЕ довёл ORIGINAL до управляемого геймплея в пирамиде: " +
      (crashed ? "эмулятор ушёл в мусор при переходе пергамент->пирамида (GameStatus/ProtaRoom/protaStatus слиплись в один байт, типично на кадре 400-450)"
               : "flagPiramideMap так и не стал 1") +
      `. За время попытки держали 'вправо', X героя ${x0} -> ${x1} (герой физически не пошёл, protaControl держался в 0 всё время до сбоя).` +
      " Это ограничение самого стенда (написан под локстеп первых сотен тиков демо/меню, не под полный прогон, см. tools/verify/README.md) — числа с оригинала эмуляцией не добыты, дальше только статический разбор ROM.");
  } else {
    console.log(`X героя ${x0} -> ${x1} за проверку`);
  }

  // --- статические факты из дизассемблера (НЕ прогон) ---
  console.log("\nСТАТИЧЕСКИ (из legacy/msx/kvalley_src.asm, сверено с src/game/kvalley_game.asm — НЕ живой прогон):");
  console.log("  protaSpeed при обычной ходьбе (finEntraSale): ld bc,0x00A8 -> 0xA8/256 = 0.6563 пикс/тик.");
  console.log("  То же значение и тот же байт-код (ld bc,0x0A8 / push+pop hl) — в src/game/kvalley_game.asm:7955.");
  console.log("  tiposMomia (скорость = старший nibble байта / 256): 5F,59,A4,A8,BA");
  console.log("    -> 0.3125, 0.3125, 0.6250, 0.6250, 0.6875 пикс/тик (типы 0..4)");
  console.log("    идентичный список байт в src/game/kvalley_game.asm:7756-7760 (наш порт).");
  console.log("  mueveElemento (общий шаг движения героя/мумий) уже сверен побитно юнит-тестом");
  console.log("    400 случайных структур+скоростей (tools/verify/README.md, unit_routine.js) — расхождений нет.");
}

console.log("\n" + "=".repeat(78));
console.log("ИТОГ");
console.log("=".repeat(78));
if (HERO && MUM) {
  const typesAvg = MUM.uniqConst.reduce((a, b) => a + b, 0) / MUM.uniqConst.length; // без веса по времени
  const ratioConst = HERO.protaSpeedConst / typesAvg;
  console.log(`Наша сборка: герой ${HERO.protaSpeedConst.toFixed(4)} пикс/тик, мумии (типы ${MUM.uniqConst.join("/")}) среднее ${typesAvg.toFixed(4)} пикс/тик`);
  console.log(`  ОТНОШЕНИЕ герой/мумия (по константам, среднее БЕЗ веса по времени наблюдения) = ${ratioConst.toFixed(3)}`);
  console.log(`  (диапазон по типам мумий: герой быстрее в ${(HERO.protaSpeedConst / Math.max(...MUM.uniqConst)).toFixed(3)}..${(HERO.protaSpeedConst / Math.min(...MUM.uniqConst)).toFixed(3)} раза)`);
  console.log(`  тиков/кадр в нашей сборке (чистый коридор): ${HERO.ticksPerFrame.toFixed(3)} — т.е. ~${(100 * (1 - HERO.ticksPerFrame)).toFixed(0)}% кадров логика НЕ обновляется`);
}
const origTypes = [0.3125, 0.3125, 0.625, 0.625, 0.6875];
const origTypesAvg = [...new Set(origTypes)].reduce((a, b) => a + b, 0) / new Set(origTypes).size;
console.log(`Оригинал (статически): герой 0.6563 пикс/тик, мумии 0.3125/0.6250/0.6875 (по типу, среднее ${origTypesAvg.toFixed(4)})`);
console.log(`  ОТНОШЕНИЕ герой/мумия (по константам ROM, среднее без веса по времени) = ${(0.65625 / origTypesAvg).toFixed(3)}`);
console.log(`  (диапазон: ${(0.65625/0.6875).toFixed(3)}..${(0.65625/0.3125).toFixed(3)} раза)`);
console.log(`  Байт-коды констант и структур идентичны нашей сборке -> по ПРОЕКТНОЙ скорости (пикс/тик) отличий нет.`);
console.log(`  Живым прогоном оригинал не подтверждён (см. ЧАСТЬ 2) — величина тиков/кадр оригинала не измерена.`);
console.log(FAIL ? "\nЕсть ПРОВАЛЫ ПОКРЫТИЯ выше." : "\nПокрытие: без провалов там, где прогон был возможен.");
process.exit(FAIL ? 1 : 0);
