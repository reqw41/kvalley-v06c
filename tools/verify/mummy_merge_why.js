// mummy_merge_why.js — КРАТНОСТЬ ЗАПИСИ НА БАЙТАХ МУМИИ и почему она не 1.00.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СТЕНД. pack_bytes_prof считает кратность по ВСЕМ байтам пачки скопом
// (1.83 на базе) — по нему нельзя сказать, сколько раз переписывается байт ИМЕННО мумии,
// а этап 1 эксперимента «композит25» обязан дать 1.00 именно на них. Заодно стенд
// отвечает на главный вопрос замера: слитая запись объекта в этой линии УЖЕ ЕСТЬ
// (vso_merge1 + vsm_multi умеет и OR, и гашение ANDN чужих плоскостей), но включается
// она ВСЕЙ ПАЧКОЙ СРАЗУ — vsp_fastmark отказывает за любой один негодный объект. Стенд
// разделяет пачки на слитые и обычные и печатает, что мешает.
//
// ЧТО СЧИТАЕТ (на каждую РАБОЧУЮ пачку):
//   ГАБАРИТ МУМИЙ = объединение старого (шапка слота +1/+2/+3/+4/+5) и нового (запись
//     вывода +0x97/+0x98/+0x99/+0x9F/+0x9B) габаритов слотов 6..13, снятое НА ВХОДЕ в
//     пачку — именно эти байты пачка обязана переписать ровно по разу;
//   кратность записи на этих байтах, с разбивкой «пачка слитая / пачка обычная»;
//   кто пишет (метка-писатель) отдельно по байтам мумий;
//   причины отказа vsp_fastmark по адресу исполненного ret.
//
// СЦЕНЫ:
//   --scene stack  (по умолчанию) — та же, что у pack_bytes_prof/pack_prof: бог-режим,
//     две мумии принудительно поставлены ВПЛОТНУЮ к герою (hX +-14). Это худший случай:
//     габариты пересекаются, попарная проверка vsp_fastmark валит всю пачку.
//   --scene walk — герой просто идёт, мумии живут своей жизнью (естественная сцена).
//
// Запуск: node tools/verify/mummy_merge_why.js [rom] [sym] [--ticks N] [--scene stack|walk]
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NTICKS = 600, SCENE = "stack";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--ticks") NTICKS = +args[++i];
  else if (a === "--scene") SCENE = args[++i];
}
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory, keyboard } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
for (const s of ["vec_spr_out", "vso_fix", "vsp_fast", "vsp_fastmark", "GameStatus", "timer"])
  if (L[s] === undefined) { console.error("нет символа " + s); process.exit(2); }

if (toGame(E) !== 5) { console.error("НЕ ВОШЛИ В ИГРУ — замер невозможен"); process.exit(2); }
function tick() { const t0 = rd(L.timer); let n = 0;
  do { v06c.oneInterrupt(true); if (++n > 16) { console.error("СТЕНД ВСТАЛ: тик не случился за 16 кадров"); process.exit(3); } }
  while (rd(L.timer) === t0); }
for (let i = 0; i < 40; i++) tick();
wr(L.vec_god, 1);

const MD = L.momiaDat, STEP = (L.momiaDat2 !== undefined) ? (L.momiaDat2 - L.momiaDat) : 16;
function place() {                       // сцена stack: мумии вплотную к герою
  const hY = rd(L.ProtaY), hX = rd(L.ProtaX), room = rd(L.ProtaRoom);
  for (let m = 0; m < 2; m++) { const p = MD + m * STEP;
    wr(p + 0, 0); wr(p + 3, hY); wr(p + 5, (hX + (m ? 14 : -14)) & 255); wr(p + 6, room); }
  wr(L.enemyAttrib, hY); wr(L.enemyAttrib + 1, (hX + 14) & 255);
  wr(L.enemyAttrib + 2, hY); wr(L.enemyAttrib + 3, (hX - 14) & 255);
}
// ЗОНД «А ЕСЛИ БЫ ПАРА НЕ ВЕТИРОВАЛА ПАЧКУ» (NOVOPEFF=1): vop_eff приколачивается к
// «паре можно слитую запись» прямо в образе (xor a / ret). Это НЕ рабочая правка — она
// рисует героя неверно; она отвечает на один вопрос: сколько пачек станет слитыми, если
// снять именно этот veto, и что станет следующей причиной отказа.
if (process.env.NOVOPEFF) { wr(L.vop_eff, 0xAF); wr(L.vop_eff + 1, 0xC9);
  console.log("(зонд: vop_eff приколочен к нулю — пара пачку больше не ветирует)"); }
if (SCENE === "stack") { place(); for (let i = 0; i < 10; i++) tick(); }
keyboard.keyDown({ keyCode: 39, which: 39, preventDefault() {}, stopPropagation() {} });

// --- карта меток для атрибуции писателя ------------------------------------------------
const syms = Object.entries(L).filter(([k, v]) => v >= 0x100 && v < 0x8000).sort((a, b) => a[1] - b[1]);
const addrs = syms.map(x => x[1]);
const near = pc => { let l = 0, h = addrs.length - 1, r = 0;
  while (l <= h) { const m = (l + h) >> 1; if (addrs[m] <= pc) { r = m; l = m + 1; } else h = m - 1; } return syms[r][0]; };

// --- габарит мумий на входе в пачку ----------------------------------------------------
const MUM = [];                          // слоты мумий (разрез как в mummy_survey/beam_late)
for (let i = 6; i <= 13; i++) MUM.push(i);
function mummyFootprint() {
  const set = new Set();
  const paint = (hi, lo, nc) => { if (!hi || !nc) return;
    for (let c = 0; c < nc; c++) { const h = hi + c; if (h < 0x80 || h >= 0xE0) continue;
      for (let r = 0; r < 16; r++) set.add((h << 8) | ((lo + r) & 0xFF)); } };
  for (const idx of MUM) { const P = 0xE000 + idx * 256;
    if (rd(P)) { const lo = rd(P + 2), nc = rd(P + 3);          // СТАРЫЙ габарит (шапка)
      paint(rd(P + 1), lo, nc); paint(rd(P + 4), lo, nc); paint(rd(P + 5), lo, nc); }
    const pd = rd(P + 0x96);
    if (pd === 1 || pd === 3) { const lo = rd(P + 0x98), nc = rd(P + 0x99);   // НОВЫЙ (запись)
      paint(rd(P + 0x97), lo, nc); paint(rd(P + 0x9F), lo, nc); paint(rd(P + 0x9B), lo, nc); } }
  return set;
}

// --- причины отказа vsp_fastmark (по адресу исполненного ret, как в fast_why) -----------
const lst = (() => { const fs = require("fs"), f = REPO + "/build/kvalley_8c.lst", map = {};
  if (!fs.existsSync(f)) return map;
  for (const line of fs.readFileSync(f, "latin1").split("\n")) {
    const m = line.match(/^\s*\d+\+?\s+([0-9A-Fa-f]{4})\s+[0-9A-Fa-f]{2}/);
    if (m) { const a = parseInt(m[1], 16); if (!(a in map)) map[a] = line.replace(/\s+$/, ""); } }
  return map; })();
const FM = L.vsp_fastmark, why = {};
let fmCalls = 0, fmOk = 0;
{ let fret = -1, fsp = -1, prevPC = -1, lastPC = -1, n0 = 0;
  const retOf = () => memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8);
  const oi = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    const pc = cpu.pc;
    if (fret >= 0) lastPC = prevPC;
    prevPC = pc;
    if (pc === FM && fret < 0) { fsp = cpu.sp; fret = retOf(); n0 = rd(L.vsp_n); }
    else if (fret >= 0 && pc === fret && cpu.sp > fsp) {
      const exitAt = lastPC; fret = -1; fmCalls++;
      if (rd(L.vsp_fast)) fmOk++;
      else { const k = `0x${(exitAt >>> 0).toString(16)}`;
        (why[k] = why[k] || { n: 0, src: lst[exitAt] || "(нет в листинге)", objs: 0 }).n++;
        why[k].objs += n0; } }
    return oi();
  }; }

// --- учёт записей внутри пачки ---------------------------------------------------------
let inPack = false, fp = null, cnt = null, byLabel = {}, packFast = 0;
let packs = 0, packsFast = 0, packsSlow = 0;
const packsMum = { fast: 0, slow: 0 };
const mult = { fast: {}, slow: {} };
let mumBytes = { fast: 0, slow: 0 }, mumWrites = { fast: 0, slow: 0 };
let packsWithMum = 0;
const origW = memory.write.bind(memory);
memory.write = function (a, v, fl) {
  if (inPack && fp && fp.has(a)) {
    cnt[a] = (cnt[a] || 0) + 1;
    const k = near(cpu.pc); byLabel[k] = (byLabel[k] || 0) + 1;
  }
  return origW(a, v, fl);
};
v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (pc === L.vec_spr_out) { inPack = true; fp = mummyFootprint(); cnt = {}; packFast = rd(L.vsp_fast); }
  else if (inPack && pc === L.vso_fix + 3) {
    inPack = false; packs++;
    const g = packFast ? "fast" : "slow";
    if (packFast) packsFast++; else packsSlow++;
    const keys = Object.keys(cnt);
    if (keys.length) { packsWithMum++; packsMum[g]++;
      for (const a of keys) { const n = cnt[a]; mult[g][n] = (mult[g][n] || 0) + 1;
        mumBytes[g]++; mumWrites[g] += n; } }
  }
  return false;
};
let done = 0;
while (done < NTICKS) { tick(); done++; if (SCENE === "stack" && done % 30 === 0) place(); }
v06c.check_breakpoint = () => false; memory.write = origW;

// --- отчёт -----------------------------------------------------------------------------
console.log(`ROM=${path.basename(ROM)} сцена=${SCENE} тиков=${NTICKS}`);
console.log(`ПАЧЕК ${packs}: слитых ${packsFast} (${(100 * packsFast / (packs || 1)).toFixed(1)}%), обычных ${packsSlow}`);
if (!packsWithMum) { console.log("ГЕЙТ ПРОВАЛЕН: ни одной пачки с байтами мумий — выборка пуста."); process.exit(2); }
console.log(`пачек, в которых габарит мумий непуст: ${packsWithMum}`
  + ` — из них СЛИТЫХ ${packsMum.fast} (${(100 * packsMum.fast / packsWithMum).toFixed(1)}%), обычных ${packsMum.slow}`);
for (const g of ["fast", "slow"]) {
  const b = mumBytes[g], w = mumWrites[g];
  if (!b) { console.log(`  ${g === "fast" ? "СЛИТЫЕ" : "ОБЫЧНЫЕ"} пачки: байтов мумии 0 (выборки нет)`); continue; }
  console.log(`  ${g === "fast" ? "СЛИТЫЕ" : "ОБЫЧНЫЕ"} пачки: КРАТНОСТЬ ЗАПИСИ НА БАЙТ МУМИИ ${(w / b).toFixed(2)}`
    + ` (${b} байт-пачек, ${w} записей)`);
  const d = Object.entries(mult[g]).sort((x, y) => x[0] - y[0]);
  console.log("     " + d.map(([n, c]) => `${n}x:${(100 * c / b).toFixed(1)}%`).join("  "));
}
const bAll = mumBytes.fast + mumBytes.slow, wAll = mumWrites.fast + mumWrites.slow;
console.log(`  ИТОГО по сцене: кратность ${(wAll / bAll).toFixed(2)} на байт мумии`);
console.log("--- кто пишет в байты мумий (всего записей) ---");
for (const [k, v] of Object.entries(byLabel).sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(`   ${String(v).padStart(8)}  ${k}`);
console.log(`--- РЕШЕНИЯ vsp_fastmark: ${fmCalls}, разрешено ${fmOk} = ${(100 * fmOk / (fmCalls || 1)).toFixed(1)}%`);
for (const [a, v] of Object.entries(why).sort((x, y) => y[1].n - x[1].n).slice(0, 8))
  console.log(`   ${String(v.n).padStart(5)} (${(100 * v.n / (fmCalls || 1)).toFixed(1)}%)  ${a}  ${v.src.trim().slice(0, 90)}`);
