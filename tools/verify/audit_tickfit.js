// audit_tickfit.js — «ИГРА ИДЁТ НЕРАВНОМЕРНО»: сколько тактов надо снять с тика,
// чтобы она пошла ровно.
//
// МОДЕЛЬ ЖАЛОБЫ. Логика игры двигается только тогда, когда предыдущий тик УСПЕЛ
// закончиться (tickInProgress в tickMain — механизм ОРИГИНАЛА, не наш). Значит один
// игровой шаг занимает 1, 2 или 3 КАДРА — сколько влезло. Ровность = ПОСТОЯНСТВО этого
// числа, а не его величина: тик, которому всегда нужно 2 кадра, идёт ровно на 25 Гц;
// тик, которому то 1, то 2, — дёргается, хотя средняя скорость выше.
//
// ЧТО СЧИТАЕТ:
//  1) длину игрового тика в тактах (вход/выход H_TIMI, бракетинг по адресу возврата+SP);
//  2) гистограмму КАДРОВ НА ТИК и долю смен этого числа от тика к тику — прямую меру
//     дёрганья (чем больше смен, тем сильнее рывки);
//  3) КРИВУЮ ОКУПАЕМОСТИ: если снять с КАЖДОГО тика X тактов, какая доля тиков влезет в
//     один кадр и сколько останется смен. X идёт от 0 до 30000 шагом 2000. Это и есть
//     ответ «сколько стоит ровность» для плана упрощений.
//  4) то же для порога в ДВА кадра — вариант «принять 25 Гц, но ровно».
//
// ГРАНИЦЫ МОДЕЛИ (честно): кривая линейная — она считает, что снятые такты снимаются с
// каждого тика одинаково. Реальная правка снимает их неравномерно (гейт срабатывает не
// всегда), поэтому кривая — ВЕРХНЯЯ оценка выигрыша. Нижнюю даёт замер после правки.
//
// ЗАПУСК: node tools/verify/audit_tickfit.js [rom] [sym] [тиков=2000] [scene]
//   scene: walk (по умолчанию) | top (верхняя строка + прыжки) | knife
"use strict";
const { make, toGame } = require("./beam_harness.js");
const T = __dirname, REPO = T + "/../..";
const a = process.argv.slice(2);
const ROM = a[0] || REPO + "/build/kvalley_8c.rom";
const SYM = a[1] || REPO + "/build/kvalley_8c.sym";
const NT = +(a[2] || 2000);
const SCENE = a[3] || "walk";
// nocheat: НЕ жать чит N (пирамида остаётся первой). Нужно для ЧЕСТНОГО A/B со старыми
// сборками, где замка F1+F5 нет и чит не работает — иначе сборки играют разные уровни.
const NOCHEAT = a.includes("nocheat");

const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory } = E;
for (const s of ["H_TIMI", "GameStatus", "timer", "tickInProgress", "ProtaY", "enemyAttrib"])
  if (L[s] === undefined) { console.error("нет символа " + s + " в .sym"); process.exit(2); }
const FRAME = 59904;

let TT = 0;
const oI = cpu.instruction.bind(cpu);
cpu.instruction = function () { oI(); TT += cpu.vcycles | 0; };
function retOf() { return memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8); }

const ticks = [];                 // длина каждого исполненного игрового шага, тактов
let tRet = -1, tSp = -1, tT0 = 0, gs = 0, logicRan = false;
v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (pc === L.H_TIMI && tRet < 0) { tSp = cpu.sp; tRet = retOf(); tT0 = TT; logicRan = false; }
  else if (tRet >= 0 && pc === tRet && cpu.sp > tSp) {
    if (gs === 5 && logicRan) ticks.push(TT - tT0);
    tRet = -1;
  }
  // логика реально шла только если tickInProgress был взведён этим вызовом
  if (tRet >= 0 && pc === L.H_TIMI + 0) { /* no-op */ }
  return false;
};
// «логика шла» ловим по переходу tickInProgress 0->1 внутри текущего H_TIMI
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
  else if (t < 610) { if (HAS_LOCK && !NOCHEAT) k.push(78); }   // чит N живёт только за замком F1+F5
  else if (t < 1000) k.push(t & 4 ? 38 : 39);
  else if (t < 1010) { if (HAS_LOCK && !NOCHEAT) k.push(78); }
  else k.push(t & 8 ? 37 : 39);
  return k;
}
// ВХОД В ИГРУ. Штатно — F1+F5 (замок читов, 2026-08-11). У СТАРЫХ сборок (1.0b и раньше)
// этого замка ещё нет и комбинация ничего не делает — там старт обычным пробелом.
// Без отката инструмент молча не входил бы в игру и сравнивать A/B было бы не с чем.
// [2026-09-11] ПОЧИНКА ВХОДА. В трёхплоскостной линии читы сняты (050301b), и F1+F3
// больше НЕ запускает партию — сам замок vec_cheats_latch на месте, поэтому HAS_LOCK
// оставался true и стенд падал «НЕ ВОШЛИ В ИГРУ» на КАЖДОМ запуске, то есть метрика
// вместимости тика была недоступна вовсе. Теперь комбинация пробуется первой (она ещё
// нужна старым сборкам с читами), а при неудаче идёт обычный старт пробелом — тот же,
// которым входят pack_prof/pack_bytes_prof.
var HAS_LOCK = (L.vec_cheats !== undefined);
if (HAS_LOCK) HAS_LOCK = (toGame(E) === 5);
if (rd(L.GameStatus) !== 5) {
  E.run(400);
  for (let i = 0; i < 250 && rd(L.GameStatus) !== 5; i++) { E.key(32, 1); E.run(3); E.key(32, 0); E.run(5); }
  if (rd(L.GameStatus) !== 5) { console.error("НЕ ВОШЛИ В ИГРУ ни F1+F3, ни пробелом — замер невозможен"); process.exit(2); }
}
let held = new Set(), tick = 0, prevT = 0, nf = 0, gsFrames = 0;
const framesPerTick = [];         // кадров между стартами логики (tickInProgress 0→1)
let framesThis = 0, logicStarts = 0;
const oW2 = memory.write.bind(memory);
memory.write = function (addr, w8, stackrq) {
  if ((addr & 0xffff) === L.tickInProgress && (w8 & 1) && !(rd(L.tickInProgress) & 1)) {
    if (gs === 5 && logicStarts > 2) framesPerTick.push(framesThis);
    framesThis = 0;
    logicStarts++;
  }
  return oW2(addr, w8, stackrq);
};
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
  v06c.oneInterrupt(true); nf++; framesThis++;
  const t = rd(L.timer);
  if (t !== prevT) { prevT = t; tick++; }
}
for (const c of held) E.key(c, 0);

if (gsFrames < 200 || ticks.length < 100) { console.error(`ПУСТАЯ ВЫБОРКА: кадров геймплея ${gsFrames}, шагов логики ${ticks.length}`); process.exit(3); }

const srt = ticks.slice().sort((x, y) => x - y);
const mean = srt.reduce((s, v) => s + v, 0) / srt.length;
const sd = Math.sqrt(srt.reduce((s, v) => s + (v - mean) ** 2, 0) / srt.length);
console.log(`ROM=${ROM.split("/").pop()}  сцена=${SCENE}${NOCHEAT?"+nocheat":""}  тиков ${NT}, кадров ${nf}, кадров геймплея ${gsFrames}`);
console.log(`ШАГОВ ЛОГИКИ (tickInProgress 0->1): ${ticks.length}`);
console.log(`ДЛИНА ШАГА, тактов: avg ${mean.toFixed(0)}  sd ${sd.toFixed(0)} (${(100 * sd / mean).toFixed(1)}% — коэф. вариации)`);
console.log(`   p10 ${srt[(srt.length * .1) | 0]}  p50 ${srt[srt.length >> 1]}  p90 ${srt[(srt.length * .9) | 0]}  p99 ${srt[(srt.length * .99) | 0]}  max ${srt[srt.length - 1]}   (кадр = ${FRAME})`);

const hist = {};
for (const f of framesPerTick) hist[f] = (hist[f] || 0) + 1;
const keysH = Object.keys(hist).map(Number).sort((x, y) => x - y);
console.log(`КАДРОВ НА ШАГ: ` + keysH.map(k => `${k}:${(100 * hist[k] / framesPerTick.length).toFixed(1)}%`).join("  ")
  + `   (средн. ${(framesPerTick.reduce((s, v) => s + v, 0) / framesPerTick.length).toFixed(3)})`);
let sw = 0; for (let i = 1; i < framesPerTick.length; i++) if (framesPerTick[i] !== framesPerTick[i - 1]) sw++;
console.log(`СМЕН ЧИСЛА КАДРОВ ОТ ШАГА К ШАГУ: ${sw} из ${framesPerTick.length - 1} = ${(100 * sw / (framesPerTick.length - 1)).toFixed(1)}%  <-- ЭТО И ЕСТЬ «ДЁРГАЕТСЯ»`);
console.log("");
console.log("КРИВАЯ ОКУПАЕМОСТИ (верхняя оценка: снимаем X тактов с КАЖДОГО шага)");
console.log("   X тактов | влезает в 1 кадр | влезает в 2 кадра | ожидаемых смен*");
for (let X = 0; X <= 30000; X += 2000) {
  const f1 = ticks.filter(v => v - X <= FRAME).length / ticks.length;
  const f2 = ticks.filter(v => v - X <= 2 * FRAME).length / ticks.length;
  // ожидаемая доля смен при независимых шагах: 2*p*(1-p) для смеси 1/2 кадров
  const p = f1, exp = 2 * p * (1 - p);
  console.log(`   ${String(X).padStart(8)} | ${(100 * f1).toFixed(1).padStart(15)}% | ${(100 * f2).toFixed(1).padStart(16)}% | ${(100 * exp).toFixed(1).padStart(10)}%`);
}
// --- ВАРИАНТ «ФИКСИРОВАННЫЙ ТЕМП»: шаг логики раз в N кадров, безусловно ---
// Смысл: ровность даёт не скорость, а ПОСТОЯНСТВО. Если тик заведомо влезает в N кадров,
// принудительный период N убирает дрожание целиком (смен 0), ценой фиксированной скорости
// 50/N Гц. Считаем, какой доле шагов N кадров ХВАТАЕТ — остальные всё равно уедут дальше.
console.log("");
console.log("ВАРИАНТ «ФИКСИРОВАННЫЙ ПЕРИОД» (шаг логики строго раз в N кадров):");
for (let N = 1; N <= 4; N++) {
  const fit = ticks.filter(v => v <= N * FRAME).length / ticks.length;
  const seq = ticks.map(v => Math.max(N, Math.ceil(v / FRAME)));
  let s2 = 0; for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) s2++;
  console.log(`   N=${N} (${(50 / N).toFixed(1)} Гц): хватает ${(100 * fit).toFixed(1)}% шагов, смен ${(100 * s2 / (seq.length - 1)).toFixed(1)}%`);
}
console.log("");
console.log("  *ожидаемых смен = 2p(1-p): минимум там, где p близко к 0 или к 1. Ровность даёт");
console.log("   не «чуть быстрее», а ПЕРЕХОД ЧЕРЕЗ ГРАНИЦУ: либо все шаги в кадр, либо все — в два.");
