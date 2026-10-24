// audit_bigbet.js — ЧЕСТНАЯ ЦЕНА «БОЛЬШОЙ СТАВКИ»: вывод СРАЗУ ПРИ ПОДГОТОВКЕ
// вместо отложенной пачки в ISR.
//
// ВОПРОС АУДИТА (владелец): «нужен ли вообще отложенный вывод пачкой, когда верх поля
// больше не гонится с HUD?». Ответ нельзя дать рассуждением — его даёт ФАЗА КАДРА.
//
// ЧТО МЕРЯЕТСЯ. Для КАЖДОГО подготовленного объекта снимается:
//   tp  — такт КАДРА (0..59903 от кадрового IRQ), на котором КОНЧИЛАСЬ его подготовка
//         vec_spr_prep. Это ровно тот момент, в который «вывод сразу при подготовке»
//         писал бы байты в fb;
//   to  — такт КАДРА, на котором его РЕАЛЬНО вывела пачка (vec_spr_show / vso_merge1 /
//         отложенная запись пары vpr_wr) — это текущая архитектура, база сравнения;
//   геометрия из записи вывода слота (+0x98 lo0, +0x99 ncols, +0x96 pending).
// Луч: beamOfLo(lo) из beam_harness (учитывает vec_vscroll из .sym).
//   bTop = beam(lo0+15) — луч проходит ВЕРХНЮЮ строку спрайта (самая ранняя);
//   bBot = beam(lo0)    — луч проходит НИЖНЮЮ строку (самая поздняя).
// КЛАССИФИКАЦИЯ момента записи t относительно [bTop, bBot]:
//   OK     t <  bTop  — весь спрайт записан ДО луча, кадр показан целиком;
//   TEAR   bTop <= t <= bBot — луч ВНУТРИ спрайта: верх старый, низ новый (разрыв);
//   LATE   t >  bBot  — луч уже прошёл весь спрайт: кадр опоздал целиком.
// Плюс площадь разрыва в пикселях (строки, чей луч попал между «стёрто» и «нарисовано»
// — здесь консервативно: строки, чей луч прошёл ДО записи, считаем испорченными).
//
// ПОЧЕМУ ЭТО И ЕСТЬ ОТВЕТ. Пачка стоит в НАЧАЛЕ кадра (ISR), подготовка — В ТИКЕ,
// а тик длиннее кадра. Если распределение tp окажется размазанным по всему кадру,
// «вывод сразу» = запись в случайной фазе относительно луча, и никакой перенос HUD
// этого не лечит: HUD убрал гонку ТОЛЬКО в верхних 16 строках поля.
//
// ЗАПУСК: node tools/verify/audit_bigbet.js [rom] [sym] [тиков=2000] [knife]
"use strict";
const { make } = require("./beam_harness.js");
const T = __dirname, REPO = T + "/../..";
const args = process.argv.slice(2);
const ROM = args[0] || REPO + "/build/kvalley_8c.rom";
const SYM = args[1] || REPO + "/build/kvalley_8c.sym";
const NT = +(args[2] || 2000);
const KNIFE = args[3] === "knife";

const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory, beamOfLo } = E;
const need = ["vec_spr_prep", "vec_spr_show", "vso_merge1", "vpr_wr", "vec_spr_out",
              "vec_nsp_idx", "vec_isr", "vec_isr_depth", "GameStatus", "timer", "vpr_def", "vsp_n"];
for (const n of need) if (L[n] === undefined) { console.error("НЕТ СИМВОЛА " + n + " в .sym — замер невозможен"); process.exit(2); }

const FRAME = 59904;
// Фаза кадра: такты от запроса IRQ. Берём напрямую у филлера (тот же счёт, что в
// beam_harness.cyc), чтобы не зависеть от того, сколько кадров длится текущий тик.
function cyc() { const f = v06c.filler; if (!f) return -1; let p = (f.raster_line * 768 + f.raster_pixel) - 176; if (p < 0) p += 312 * 768; return (p / 4) | 0; }

const PREP = L.vec_spr_prep, SHOW = L.vec_spr_show, MERGE = L.vso_merge1, PAIRW = L.vpr_wr;
const recs = [];               // {idx, tp, to, lo0, nc, pend, depth}
const bySlot = new Array(21).fill(null);
let gs = 0, prepRet = -1, prepSp = -1, prepIdx = -1;
const bshow = { ret: -1, sp: -1, d: null }, bmerge = { ret: -1, sp: -1, d: null };
let pend = [];
const pairw = { ret: -1, sp: -1 };
function retOf() { return memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8); }

v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (gs !== 5) return false;
  // --- подготовка объекта ---
  if (pc === PREP && prepRet < 0) { prepSp = cpu.sp; prepRet = retOf(); prepIdx = rd(L.vec_nsp_idx); }
  else if (prepRet >= 0 && pc === prepRet && cpu.sp > prepSp) {
    const i = prepIdx, pg = 0xE000 + i * 256;
    const r = { idx: i, tp: cyc(), to: -1, lo0: rd(pg + 0x98), nc: rd(pg + 0x99), pend: rd(pg + 0x96) };
    prepRet = -1;
    if (i >= 0 && i < 21) { recs.push(r); bySlot[i] = r; }
  }
  // --- реальный вывод объекта пачкой ---
  if (pc === SHOW && bshow.ret < 0) { bshow.sp = cpu.sp; bshow.ret = retOf(); bshow.d = rd(L.vec_nsp_idx); }
  else if (bshow.ret >= 0 && pc === bshow.ret && cpu.sp > bshow.sp) {
    const i = bshow.d; bshow.ret = -1;
    if (bySlot[i] && bySlot[i].to < 0) bySlot[i].to = cyc();
  }
  if (pc === MERGE && bmerge.ret < 0) { bmerge.sp = cpu.sp; bmerge.ret = retOf(); bmerge.d = rd(L.vec_nsp_idx); }
  else if (bmerge.ret >= 0 && pc === bmerge.ret && cpu.sp > bmerge.sp) {
    const i = bmerge.d; bmerge.ret = -1;
    if (rd(L.vpr_def)) pend.push(i);                       // запись отложена в vpr_wr (пара)
    else if (bySlot[i] && bySlot[i].to < 0) bySlot[i].to = cyc();
  }
  if (pc === PAIRW && pairw.ret < 0) { pairw.sp = cpu.sp; pairw.ret = retOf(); }
  else if (pairw.ret >= 0 && pc === pairw.ret && cpu.sp > pairw.sp) {
    pairw.ret = -1; const t = cyc();
    for (const i of pend) if (bySlot[i] && bySlot[i].to < 0) bySlot[i].to = t;
    pend = [];
  }
  return false;
};

// --- ввод ПО ИГРОВЫМ ТИКАМ (как beam_ab.js), чтобы сцена не зависела от тактов ---
function keysKnife(t) { const k = []; if (t < 260) { if ((t >> 2) & 1) k.push(32); return k; } if ((t & 31) < 16) k.push(39); else k.push(37); if ((t & 15) === 3) k.push(32); return k; }
function keysFor(t) {
  if (KNIFE) return keysKnife(t);
  const k = [];
  if (t < 900) { if ((t >> 2) & 1) k.push(32); }
  else if (t < 1000) k.push(39);
  else if (t < 1010) k.push(78);
  else if (t < 1300) k.push(t & 8 ? 39 : 37);
  else if (t < 1310) k.push(78);
  else if (t < 1600) k.push(t & 8 ? 38 : 39);
  else if (t < 1640) k.push(78);
  else if (t < 2000) k.push(t & 8 ? 39 : 37);
  else if (t < 2060) k.push(78);
  else k.push(t & 8 ? 37 : 39);
  return k;
}
let held = new Set(), tick = 0, prevT = 0, nf = 0, gsFrames = 0;
while (tick <= NT && nf < 500000) {
  const want = new Set(keysFor(tick));
  for (const c of held) if (!want.has(c)) E.key(c, 0);
  for (const c of want) if (!held.has(c)) E.key(c, 1);
  held = want;
  gs = rd(L.GameStatus);
  if (gs === 5) gsFrames++;
  v06c.oneInterrupt(true); nf++;
  const t = rd(L.timer); if (t !== prevT) { prevT = t; tick++; }
}
for (const c of held) E.key(c, 0);

// ===== ГЕЙТ ПУСТОЙ ВЫБОРКИ =====
const good = recs.filter(r => r.pend === 1 && r.nc > 0);
if (gsFrames < 100 || good.length < 100) {
  console.error(`ПУСТАЯ ВЫБОРКА: кадров геймплея ${gsFrames}, подготовленных объектов ${good.length} — сцена не воспроизвелась`);
  process.exit(3);
}

const VS = (L.vec_vscroll === undefined) ? 0x1F : L.vec_vscroll;
const BEAM_TOPFIELD = beamOfLo(255);
function classify(t, lo0) {
  // строки спрайта: lo0..lo0+15 (по возрастанию lo = вверх по экрану)
  const bTop = beamOfLo((lo0 + 15) & 255), bBot = beamOfLo(lo0);
  if (t < bTop) return { c: "OK", px: 0, bTop, bBot };
  if (t > bBot) return { c: "LATE", px: 16, bTop, bBot };
  let px = 0;
  for (let k = 0; k <= 15; k++) { const b = beamOfLo((lo0 + k) & 255); if (b < t) px++; }
  return { c: "TEAR", px, bTop, bBot };
}

function stat(a) {
  if (!a.length) return "—";
  const s = a.slice().sort((x, y) => x - y);
  const m = s.reduce((q, v) => q + v, 0) / s.length;
  return `avg ${m.toFixed(0)} p10 ${s[(s.length * .1) | 0]} p50 ${s[s.length >> 1]} p90 ${s[(s.length * .9) | 0]} max ${s[s.length - 1]}`;
}
const cat = i => i < 4 ? "ворота" : i < 6 ? "герой" : i < 14 ? "мумии" : i < 19 ? "нож" : "карта";
const CATS = ["ворота", "герой", "мумии", "нож", "карта"];

console.log(`ROM=${ROM.split("/").pop()}  тиков ${NT}, кадров ${nf}, кадров геймплея ${gsFrames}`);
console.log(`vec_vscroll=0x${VS.toString(16)}  луч на верх поля (fb 255) — такт ${BEAM_TOPFIELD}; кадр ${FRAME}`);
console.log(`подготовлено объектов ${good.length}; из них реально выведено пачкой ${good.filter(r => r.to >= 0).length}`);
console.log("");
console.log(`ФАЗА КАДРА, ГДЕ КОНЧАЕТСЯ ПОДГОТОВКА (сюда попал бы «вывод сразу»): ${stat(good.map(r => r.tp))}`);
console.log(`ФАЗА КАДРА, ГДЕ ОБЪЕКТ ВЫВОДИТ ПАЧКА (текущая архитектура):        ${stat(good.filter(r => r.to >= 0).map(r => r.to))}`);
console.log("");

// гистограмма фазы подготовки децилями кадра
{
  const h = new Array(10).fill(0);
  for (const r of good) h[Math.min(9, (r.tp / (FRAME / 10)) | 0)]++;
  console.log("ГИСТОГРАММА фазы подготовки по децилям кадра (0 = сразу после IRQ):");
  console.log("  " + h.map((v, i) => `${i}:${(100 * v / good.length).toFixed(1)}%`).join("  "));
}
console.log("");

function table(title, timeOf) {
  const rows = {};
  for (const c of CATS) rows[c] = { n: 0, ok: 0, tear: 0, late: 0, px: 0 };
  const all = { n: 0, ok: 0, tear: 0, late: 0, px: 0 };
  for (const r of good) {
    const t = timeOf(r); if (t < 0) continue;
    const Ytop = 255 - (((r.lo0 + 15) & 255)); // экранная строка верха (для отсева карты и т.п.)
    const cl = classify(t, r.lo0);
    const c = cat(r.idx);
    for (const o of [rows[c], all]) { o.n++; o[cl.c === "OK" ? "ok" : cl.c === "TEAR" ? "tear" : "late"]++; o.px += cl.px * r.nc * 8; }
  }
  console.log(title);
  console.log("  объект    n      OK%    РАЗРЫВ%  ОПОЗДАЛ%   испорчено пикс");
  for (const c of CATS) { const o = rows[c]; if (!o.n) continue;
    console.log(`  ${c.padEnd(8)} ${String(o.n).padStart(5)}  ${(100 * o.ok / o.n).toFixed(1).padStart(6)}  ${(100 * o.tear / o.n).toFixed(1).padStart(7)}  ${(100 * o.late / o.n).toFixed(1).padStart(8)}  ${String(o.px).padStart(12)}`); }
  console.log(`  ${"ИТОГО".padEnd(8)} ${String(all.n).padStart(5)}  ${(100 * all.ok / all.n).toFixed(1).padStart(6)}  ${(100 * all.tear / all.n).toFixed(1).padStart(7)}  ${(100 * all.late / all.n).toFixed(1).padStart(8)}  ${String(all.px).padStart(12)}`);
  console.log("");
  return all;
}

const A = table("ЕСЛИ ПИСАТЬ СРАЗУ ПРИ ПОДГОТОВКЕ (гипотеза «большой ставки»):", r => r.tp);
const B = table("КАК ЕСТЬ СЕЙЧАС — отложенная пачка в ISR:", r => r.to);

console.log("ВЕРДИКТ ПО ЛУЧУ (доля объектов, показанных БЕЗ дефекта):");
console.log(`  вывод сразу при подготовке: ${(100 * A.ok / A.n).toFixed(1)}%   испорчено ${A.px} пикс`);
console.log(`  отложенная пачка (сейчас):  ${(100 * B.ok / B.n).toFixed(1)}%   испорчено ${B.px} пикс`);
const worse = (A.px - B.px);
console.log(`  дельта порчи «сразу» минус «пачкой»: ${worse > 0 ? "+" : ""}${worse} пикс`);

// ===== ЗОНАЛЬНЫЙ РАЗРЕЗ: верх поля против середины =====
// Смысл: HUD ушёл из поля, верхние 16 строк перестали быть горячими. Проверяем, где
// именно остаётся гонка при «выводе сразу».
{
  const zones = [[0, 16], [16, 48], [48, 96], [96, 192]];
  const z = zones.map(() => ({ n: 0, bad: 0 }));
  for (const r of good) {
    const Ytop = 255 - (((r.lo0 + 15) & 255));
    if (Ytop < 0 || Ytop > 190) continue;
    const cl = classify(r.tp, r.lo0);
    for (let i = 0; i < zones.length; i++) if (Ytop >= zones[i][0] && Ytop < zones[i][1]) { z[i].n++; if (cl.c !== "OK") z[i].bad++; }
  }
  console.log("");
  console.log("ГДЕ ОСТАЁТСЯ ГОНКА ПРИ «ВЫВОДЕ СРАЗУ» (по строке верха спрайта Ytop):");
  zones.forEach((q, i) => { if (z[i].n) console.log(`  Ytop ${String(q[0]).padStart(3)}..${String(q[1] - 1).padStart(3)}: ${z[i].bad}/${z[i].n} = ${(100 * z[i].bad / z[i].n).toFixed(1)}% с дефектом`); });
}
