// vsp_shift_plan.js — ВАРИАНТЫ ПЕРЕДЕЛКИ vsp_row И ЧЕСТНЫЙ ПЕРЕСЧЁТ ПЛАВНОСТИ.
// Опирается на замер vsp_shift_cost.js (тот же прогон), см. его шапку про модель тактов.
// Экономия падает ТОЛЬКО в те кадры, где петля реально работала, и ровно по фактическим
// виткам этого кадра — поэтому «доля кадров с тиком длиннее кадра» считается честно.
//
// ВЕРДИКТ ЗАМЕРА (2026-08-03, 1445 кадров геймплея, сверено с z80_smooth.js такт-в-такт):
//   ТАБЛИЧНЫЙ СДВИГ НЕ НУЖЕН И НЕ ПОМОЖЕТ.
//   * vsp_row = 2575 т на КАДР ГЕЙМПЛЕЯ (8475 т в тех 30.4% кадров, где подготовка вообще
//     идёт) = 5.3% среднего игрового тика. Цифра «8696 т/кадр» — это нормировка на кадр
//     С ВЫВОДОМ, на любой кадр приходится втрое меньше.
//   * ПОТОЛОК любой правки (петля исчезла целиком): кадров с тиком длиннее кадра
//     25.9% -> 24.8%. Минус 1.1 п.п. Реальные варианты дают 0.3-0.8% тика = 0.0 п.п.
//   * Таблица физически не может обогнать rrca на шине Вектора: цепочка rrca стоит в
//     среднем 13.7 т (s распределён РОВНО: 9.9-15.0% на каждое из 8 значений), а сама
//     выборка из таблицы — ld l,a + ld a,(hl) = 16 т, и это БЕЗ учёта того, что все три
//     пары (BC=паттерн, HL=столбец, DE=перелив) заняты и свободной под таблицу нет.
//     Полутаблицы по нибблам ещё хуже: две выборки + or = >=40 т.
//   Куда смотреть вместо этого — см. «ТОП-20 УЧАСТКОВ ВНУТРИ ТИКА» в vsp_shift_cost.js.
//
// Запуск: node tools/verify/vsp_shift_plan.js [rom] [sym] [кадров]
"use strict";
const M = require("./vsp_shift_cost.js");
const { tick, rowCy, it, op, zr, orC, shPer, FR, N, NR, st, sum } = M;

// ---------- где вообще живут опоздания ----------
console.log(`\n\n############ ГДЕ ЖИВУТ ОПОЗДАНИЯ ############`);
const lateIdx = []; for (let i = 0; i < N; i++) if (tick[i] > FR) lateIdx.push(i);
const lateRow = lateIdx.map(i => rowCy[i]);
const lateTick = lateIdx.map(i => tick[i]);
const lateWithRow = lateIdx.filter(i => it[i] > 0).length;
console.log(`  кадров с тиком > кадра: ${lateIdx.length}/${N} = ${(100 * lateIdx.length / N).toFixed(1)}%`);
console.log(`  из них vsp_row вообще работал в ${lateWithRow} (${(100 * lateWithRow / lateIdx.length).toFixed(1)}%)`);
console.log(`  в опоздавших кадрах: тик avg ${st(lateTick).avg.toFixed(0)} (${(st(lateTick).avg / FR * 100).toFixed(0)}% кадра), p50 ${st(lateTick).p50}, min ${Math.min(...lateTick)}`);
console.log(`  vsp_row в них avg ${st(lateRow).avg.toFixed(0)} т = ${(100 * sum(lateRow) / sum(lateTick)).toFixed(2)}% их суммарного тика`);
// «пограничные» кадры: те, что опоздали меньше чем на 30%
const near = lateIdx.filter(i => tick[i] < FR * 1.3);
console.log(`  опоздавших НЕ БОЛЬШЕ ЧЕМ на 30% (только их и может спасти локальная правка): ${near.length} (${(100 * near.length / N).toFixed(1)}% всех кадров)`);
console.log(`  запас, который нужен каждому из них: медиана ${st(near.map(i => tick[i] - FR)).p50} т; а vsp_row там даёт всего ${st(near.map(i => rowCy[i])).p50} т (медиана)`);

// ---------- варианты ----------
// Цены инструкций (i8080 на шине Вектора), см. z80_lines.js
const A = { LDAX: 8, INX: 8, ORA_A: 4, JCC: 12, JMP: 12, RRCA: 4, PUSH: 16, POP: 12,
            ANI: 8, ORA_M: 8, NOP: 4, MOV_MA: 8, DCR: 8, STAX: 8, MOV_AL: 8, CPI: 8,
            XRA_A: 4, MOV_RR: 8, MVI: 8, LDA: 16, STA: 16, RET: 12, ADI: 8, MOV_AM: 8 };

// каждая функция: (s, isOr, transparent) -> такты витка
const head = A.LDAX + A.INX + A.ORA_A + A.JCC;                  // 32: чтение паттерна + гейт прозрачности
const tailCP = A.MOV_AL + A.CPI + A.JCC;                        // 28: конец столбца
const stores = A.MOV_MA + A.DCR + A.STAX + A.DCR;               // 32: две записи + два указателя

const V = [];
const add = (name, bytes, f, perCall, perInit, note) => V.push({ name, bytes, f, perCall, perInit, note });

// V0 — как сейчас
add("V0  как сейчас", 0, (s, o, t) => t
  ? head + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.XRA_A + A.STAX + A.DCR + tailCP
  : head + A.JMP + 4 * s + A.PUSH + A.ANI + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.POP + A.ANI + A.STAX + A.DCR + tailCP,
  0, 0, "база");

// V1 — стек-стэш: push af/pop af -> ld (de),a / ld a,(de) (повёрнутый байт временно
//      лежит в ячейке перелива, её всё равно перезапишем). 0 байт данных, +0 байт кода.
add("V1  push/pop -> стэш в (de)", 0, (s, o, t) => t
  ? head + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.XRA_A + A.STAX + A.DCR + tailCP
  : head + A.JMP + 4 * s + A.STAX + A.ANI + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.MOV_AM /*ld a,(de)=8*/ + A.ANI + A.STAX + A.DCR + tailCP,
  0, 0, "-12 т на непрозрачном витке");

// V2 — V1 + разворот петли x2 (гейт конца столбца раз в два витка)
add("V2  V1 + разворот x2", 0, (s, o, t) => (t
  ? head + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.XRA_A + A.STAX + A.DCR
  : head + A.JMP + 4 * s + A.STAX + A.ANI + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.MOV_AM + A.ANI + A.STAX + A.DCR) + tailCP / 2,
  4 * A.STA, 0, "+~45 Б кода, +4 самомод-патча на вызов");

// V3 — V1 + разворот x4
add("V3  V1 + разворот x4", 0, (s, o, t) => (t
  ? head + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.XRA_A + A.STAX + A.DCR
  : head + A.JMP + 4 * s + A.STAX + A.ANI + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.MOV_AM + A.ANI + A.STAX + A.DCR) + tailCP / 4,
  12 * A.STA, 0, "+~135 Б кода, +12 патчей на вызов");

// V4 — ТАБЛИЦА ПОВОРОТА R_s[b]=ror(b,s): убирает jp+rrca, но стоит ld c,a + ld a,(bc)
//      (BC освободить нельзя -> считаем ИДЕАЛЬНЫЙ случай: указатель таблицы в свободной паре)
add("V4  таблица ror(b,s), 8x256 Б (недостижимо)", 2048, (s, o, t) => t
  ? head + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.XRA_A + A.STAX + A.DCR + tailCP
  : head + A.MOV_RR /*ld l,a*/ + A.MOV_AM /*ld a,(hl)*/ + A.STAX + A.ANI + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.MOV_AM + A.ANI + A.STAX + A.DCR + tailCP,
  0, 0, "лишний регистр-пара, которой нет");

// V5 — ДВЕ таблицы на s: main=b>>s и spill=b<<(8-s), 512 Б на s. Идеальный случай:
//      обе записи без масок и без стэша. Для ОДНОГО s (остальные — старым путём).
add("V5  2 таблицы на ОДНО s (512 Б), идеал", 512, (s, o, t) => t
  ? head + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.XRA_A + A.STAX + A.DCR + tailCP
  : head + A.MOV_RR + A.MOV_AM + (o ? A.ORA_M : A.NOP) + A.MOV_MA + A.DCR + A.MOV_RR + A.MOV_AM + A.STAX + A.DCR + tailCP,
  0, 0, "работает лишь на 1/8 витков — ниже отдельный расчёт");

// V6 — ПОТОЛОК: vsp_row исчезла целиком (0 тактов)
add("V6  ПОТОЛОК: петли нет вообще", 0, () => 0, 0, 0, "верхняя граница любой правки");

function evalV(v) {
  const newRow = [], save = [];
  for (let i = 0; i < N; i++) {
    const r = shPer[i], itN = it[i], zrN = zr[i];
    const orFrac = itN ? orC[i] / itN : 0;
    let c = 0;
    for (let s = 0; s < 8; s++)
      c += r[s] * (v.f(s, true, false) * orFrac + v.f(s, false, false) * (1 - orFrac));
    c += zrN * (v.f(0, true, true) * orFrac + v.f(0, false, true) * (1 - orFrac));
    if (itN > 0) { c += (itN / 16) * v.perCall; }
    newRow.push(c); save.push(rowCy[i] - c);
  }
  const nt = tick.map((t, i) => t - save[i]);
  const lateN = nt.filter(x => x > FR).length;
  return { rowAvg: sum(newRow) / N, save: sum(save) / N, lateN, pct: 100 * lateN / N,
           tickAvg: sum(nt) / N, p90: st(nt).p90 };
}

console.log(`\n\n############ ВАРИАНТЫ ############`);
console.log(`базовая плавность: ${lateIdx.length}/${N} = ${(100 * lateIdx.length / N).toFixed(1)}% кадров с тиком длиннее кадра`);
console.log(`\n  вариант                                    Б  vsp_row т/кадр  экономия  %тика  ДЛИННЕЕ КАДРА`);
for (const v of V) {
  const r = evalV(v);
  console.log(`  ${v.name.padEnd(42)} ${String(v.bytes).padStart(4)}  ${r.rowAvg.toFixed(0).padStart(6)}       ${r.save.toFixed(0).padStart(7)}  ${(100 * r.save / (sum(tick) / N)).toFixed(2).padStart(5)}%   ${r.lateN}/${N} = ${r.pct.toFixed(1)}%  (было ${(100 * lateIdx.length / N).toFixed(1)}%)`);
}

// ---------- чувствительность «весь тик быстрее на N%» (как в z80_smooth.js) ----------
console.log(`\n############ ЧУВСТВИТЕЛЬНОСТЬ ТИКА (для сверки с z80_smooth.js) ############`);
for (const k of [0.02, 0.04, 0.05, 0.06, 0.08, 0.10, 0.15, 0.20, 0.30, 0.50]) {
  let c = 0; for (const v of tick) if (v * (1 - k) > FR) c++;
  console.log(`  весь тик быстрее на ${(k * 100).toFixed(0).padStart(2)}%: длиннее кадра ${(100 * c / N).toFixed(1)}%`);
}

// ---------- сколько вообще может дать вся ПОДГОТОВКА и весь ТИК ----------
console.log(`\n############ МАСШТАБ: ЧТО ЕЩЁ ЛЕЖИТ В ТИКЕ ############`);
console.log(`  средний тик ${(sum(tick) / N).toFixed(0)} т (${(sum(tick) / N / FR * 100).toFixed(0)}% кадра)`);
console.log(`  vsp_row     ${(sum(rowCy) / N).toFixed(0)} т = ${(100 * sum(rowCy) / sum(tick)).toFixed(1)}% тика`);
