// vsp_shift_cost.js — РАЗБОР ПЕТЛИ СДВИГА vsp_row И РАСЧЁТ ТАБЛИЧНЫХ ВАРИАНТОВ.
//
// ЧТО МЕРЯЕТ (прогон живого геймплея, тот же сценарий, что beam_top/z80_smooth):
//   1) сколько тактов в кадре съедает vsp_row, сколько витков, каков расклад
//      «прозрачная строка / сдвиг», распределение s = X&7 и половин (nop/or);
//   2) сколько тактов длится ИГРОВОЙ ТИК (H_TIMI) в каждом кадре и какую долю в нём
//      занимает vsp_row — ПОКАДРОВО, а не в среднем;
//   3) честная плавность: для каждого варианта петли пересчитывает ТИК КАЖДОГО КАДРА
//      (вычитая ровно ту экономию, которая набежала в этом кадре по фактическим
//      виткам этого кадра) и заново считает долю кадров с тиком длиннее кадра.
//      Это строже, чем «ускорить весь тик на N%»: экономия падает только туда, где
//      петля реально работала.
//
// МОДЕЛЬ ТАКТОВ — как в z80_lines.js/z80_gain.js (шина Вектора: слоты = M1 + память +
// порты + ceil(внутренние/4), такт = 4 слота). Проверка: сумма по петле совпадает с
// z80_lines.js vsp_row vsp_masks.
//
// Запуск: node tools/verify/vsp_shift_cost.js [rom] [sym] [кадров]
"use strict";
const { make, toGame } = require("./beam_harness.js");
const T = __dirname;
const ROM = process.argv[2] || T + "/../../build/kvalley_8c.rom";
const SYM = process.argv[3] || T + "/../../build/kvalley_8c.sym";
const NF = +(process.argv[4] || 4000);
const FR = 59904;

const E = make(ROM, SYM);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
const { L, rd, v06c, memory, cpu } = E;

const ROW = L.vsp_row, MASKS = L.vsp_masks, JP = L.vsp_jp, R0 = L.vsp_r0,
      ZROW = L.vsp_zrow, ORM = L.vsp_orm, PREP = L.vec_spr_prep, FAST = L.vsp_fastmark;

// ---- покадровые счётчики ----
let cyRow = 0, cyPrep = 0, iters = 0, opaque = 0, transp = 0;
const sHist = new Float64Array(8);          // витки со сдвигом, по s
const sHistZ = new Float64Array(8);         // прозрачные витки, по s (s текущего объекта)
let halfNop = 0, halfOr = 0;                // витки по половинам (0x00 = 1-я, 0xB6 = 2-я)
let curS = 0, curOr = 0;

// бакеты по меткам — только то, что исполняется ВНУТРИ игрового тика
const labs = []; for (const k in L) if (L[k] >= 0 && L[k] < 0x10000) labs.push([L[k], k]);
labs.sort((a, b) => a[0] - b[0]);
const laddr = labs.map(x => x[0]);
function labOf(pc) { let lo = 0, hi = laddr.length - 1, r = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (laddr[m] <= pc) { r = m; lo = m + 1; } else hi = m - 1; }
  return labs[r][1]; }
const bucket = new Float64Array(0x10000);   // по PC, потом свернём к меткам
let inTick = false;

const oI = cpu.instruction.bind(cpu);
cpu.instruction = function () {
  const pc = cpu.pc; oI(); const vc = cpu.vcycles | 0;
  if (inTick) bucket[pc] += vc;
  if (pc >= PREP && pc < FAST) cyPrep += vc;
  if (pc >= ROW && pc < MASKS) {
    cyRow += vc;
    if (pc === ROW) {
      iters++;
      curOr = rd(ORM);
      if (curOr) halfOr++; else halfNop++;
    } else if (pc === JP) {
      opaque++;
      const tgt = rd(JP + 1) | (rd(JP + 2) << 8);
      curS = (R0 - tgt) & 7;
      sHist[curS]++;
    } else if (pc === ZROW) {
      transp++;
      const tgt = rd(JP + 1) | (rd(JP + 2) << 8);
      sHistZ[(R0 - tgt) & 7]++;
    }
  }
};

// ---- границы кадра и тика (как в z80_smooth.js) ----
const ISR = L.vec_isr, TICK = L.H_TIMI;
let TT = 0;                                     // глобальный счётчик тактов
const oI2 = cpu.instruction;
cpu.instruction = function () { const v0 = 0; oI2(); TT += cpu.vcycles | 0; };

function retOf() { return memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8); }
let cur = null; const frames = []; let tret = -1, tsp = -1;
v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (pc === ISR && rd(L.vec_isr_depth) === 0) {
    if (cur) frames.push(cur);
    cur = { t0: TT, tickEnd: -1, gs: rd(L.GameStatus),
            r0: cyRow, i0: iters, o0: opaque, z0: transp,
            sh0: Array.from(sHist), no0: halfNop, or0: halfOr, p0: cyPrep,
            rowEnd: -1, itEnd: -1, opEnd: -1, zEnd: -1, shEnd: null, noEnd: -1, orEnd: -1, pEnd: -1 };
  }
  if (!cur) return false;
  if (pc === TICK && tret < 0) { tsp = cpu.sp; tret = retOf(); inTick = (rd(L.GameStatus) === 5); }
  else if (tret >= 0 && pc === tret && cpu.sp > tsp) {
    tret = -1; inTick = false; cur.tickEnd = TT;
    cur.rowEnd = cyRow; cur.itEnd = iters; cur.opEnd = opaque; cur.zEnd = transp;
    cur.shEnd = Array.from(sHist); cur.noEnd = halfNop; cur.orEnd = halfOr; cur.pEnd = cyPrep;
  }
  return false;
};

let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let held = -1;
for (let f = 0; f < NF; f++) {
  if (f % 25 === 0) { const ks = [37, 39, 38, 40]; const k = ks[(rnd() * 4) | 0];
    if (k !== held) { if (held > 0) E.key(held, 0); E.key(k, 1); held = k; } }
  if (f > 0 && f % 400 === 0) { E.key(78, 1); v06c.oneInterrupt(true); E.key(78, 0); }
  if (cur) cur.gs = rd(L.GameStatus);
  v06c.oneInterrupt(true);
}
if (held > 0) E.key(held, 0);
if (cur) frames.push(cur);

// ---- разбор: только кадры геймплея, где тик замерен целиком ----
const G = frames.filter(f => f.gs === 5 && f.tickEnd >= 0);
const tick = G.map(f => f.tickEnd - f.t0);
const rowCy = G.map(f => f.rowEnd - f.r0);
const it = G.map(f => f.itEnd - f.i0);
const op = G.map(f => f.opEnd - f.o0);
const zr = G.map(f => f.zEnd - f.z0);
const noC = G.map(f => f.noEnd - f.no0);
const orC = G.map(f => f.orEnd - f.or0);
const prepCy = G.map(f => f.pEnd - f.p0);
const shPer = G.map(f => f.shEnd.map((v, i) => v - f.sh0[i]));

const st = a => { const b = a.slice().sort((x, y) => x - y);
  const q = p => b[Math.min(b.length - 1, Math.floor(b.length * p))];
  return { avg: b.reduce((s, x) => s + x, 0) / b.length, p50: q(.5), p90: q(.9), p99: q(.99), max: b[b.length - 1] }; };
const sum = a => a.reduce((s, x) => s + x, 0);
const N = G.length;
const withRow = G.map((f, i) => it[i] > 0);
const NR = withRow.filter(Boolean).length;

console.log(`ROM=${ROM}  кадров геймплея с замеренным тиком: ${N} (кадр = ${FR} тактов)`);
console.log(`из них кадров, где vsp_row вообще работал: ${NR} (${(100 * NR / N).toFixed(1)}%)`);

const TK = st(tick), RW = st(rowCy), PR = st(prepCy);
console.log(`\n=== ИГРОВОЙ ТИК (H_TIMI) ===`);
console.log(`  avg ${TK.avg.toFixed(0)} (${(TK.avg / FR * 100).toFixed(1)}% кадра)  p50 ${TK.p50} (${(TK.p50/FR*100).toFixed(0)}%)  p90 ${TK.p90} (${(TK.p90/FR*100).toFixed(0)}%)  p99 ${TK.p99}  max ${TK.max}`);
const late = tick.filter(v => v > FR).length;
console.log(`  ДЛИННЕЕ КАДРА: ${late}/${N} = ${(100 * late / N).toFixed(1)}%`);

console.log(`\n=== vsp_row В ТИКЕ ===`);
console.log(`  тактов/кадр (все кадры)   avg ${RW.avg.toFixed(0)} = ${(RW.avg / TK.avg * 100).toFixed(1)}% тика, ${(RW.avg / FR * 100).toFixed(1)}% кадра`);
console.log(`  тактов/кадр (где работал) avg ${(sum(rowCy) / NR).toFixed(0)}   p90 ${RW.p90}  max ${RW.max}`);
console.log(`  vec_spr_prep целиком      avg ${PR.avg.toFixed(0)} т/кадр, из них vsp_row ${(RW.avg / PR.avg * 100).toFixed(1)}%`);
console.log(`  витков/кадр avg ${(sum(it) / N).toFixed(2)}  (где работал ${(sum(it) / NR).toFixed(2)}); вызовов петли ~${(sum(it) / N / 16).toFixed(2)}/кадр`);
console.log(`  такт/виток (средний по факту): ${(sum(rowCy) / sum(it)).toFixed(1)}`);
console.log(`  прозрачных витков ${sum(zr)} (${(100 * sum(zr) / sum(it)).toFixed(1)}%), со сдвигом ${sum(op)} (${(100 * sum(op) / sum(it)).toFixed(1)}%)`);
console.log(`  половина 1 (nop) ${sum(noC)} витков (${(100 * sum(noC) / sum(it)).toFixed(1)}%), половина 2 (or (hl)) ${sum(orC)} (${(100 * sum(orC) / sum(it)).toFixed(1)}%)`);

const SH = new Float64Array(8), SZ = new Float64Array(8);
for (const r of shPer) for (let s = 0; s < 8; s++) SH[s] += r[s];
console.log(`\n=== РАСПРЕДЕЛЕНИЕ СДВИГА s (только НЕпрозрачные витки) ===`);
const tot = sum(Array.from(SH));
for (let s = 0; s < 8; s++)
  console.log(`  s=${s}: ${SH[s].toFixed(0).padStart(7)} витков  ${(100 * SH[s] / tot).toFixed(1).padStart(5)}%   (rrca ${4 * s} т)`);
console.log(`  средний s = ${(Array.from(SH).reduce((a, v, i) => a + v * i, 0) / tot).toFixed(2)}, средняя цена rrca-цепочки ${(4 * Array.from(SH).reduce((a, v, i) => a + v * i, 0) / tot).toFixed(1)} т/виток`);

// ---- где на самом деле лежат такты ИГРОВОГО ТИКА ----
const per = new Map();
let tickAll = 0;
for (let pc = 0; pc < 0x10000; pc++) {
  if (!bucket[pc]) continue;
  const k = labOf(pc); per.set(k, (per.get(k) || 0) + bucket[pc]); tickAll += bucket[pc];
}
const topT = [...per.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\n=== ТОП-20 УЧАСТКОВ ВНУТРИ ИГРОВОГО ТИКА (тактов на кадр геймплея) ===`);
console.log(`  всего в тике ${(tickAll / N).toFixed(0)} т/кадр`);
for (const [k, v] of topT.slice(0, 20))
  console.log(`  ${(v / N).toFixed(0).padStart(6)} т/кадр  ${(100 * v / tickAll).toFixed(1).padStart(5)}%  ${k}`);
const rowShare = (per.get("vsp_row") || 0) + (per.get("vsp_jp") || 0) + (per.get("vsp_r7") || 0)
  + (per.get("vsp_r0") || 0) + (per.get("vsp_m1") || 0) + (per.get("vsp_orm") || 0)
  + (per.get("vsp_m2") || 0) + (per.get("vsp_cpe") || 0) + (per.get("vsp_zrow") || 0) + (per.get("vsp_orm2") || 0);
console.log(`  [сумма всех меток vsp_row..vsp_masks] ${(rowShare / N).toFixed(0)} т/кадр = ${(100 * rowShare / tickAll).toFixed(1)}% тика`);

module.exports = { G, tick, rowCy, it, op, zr, noC, orC, shPer, FR, N, NR, st, sum, SH };

// ============================ РАСЧЁТ ВАРИАНТОВ ============================
// Цена витка задаётся функцией (s, isOr, isTransparent) -> такты.
// Плюс фиксированная цена НА ВЫЗОВ петли (настройка операндов/указателей) — дельта к
// нынешней настройке; и цена НА КАДР (например, построение таблицы).
const CALLS_PER_FRAME = sum(it) / N / 16;

function evalVariant(name, bytes, perIter, perCallDelta, perFrameDelta, note) {
  // новая цена в каждом кадре
  let newRow = [], saveArr = [];
  for (let i = 0; i < N; i++) {
    const r = shPer[i];
    // распределяем прозрачные/непрозрачные и половины по факту кадра:
    // s известен по-виточно только для непрозрачных; для прозрачных берём средний s кадра
    let c = 0;
    const opN = op[i], zrN = zr[i], orN = orC[i], itN = it[i];
    const orFrac = itN ? orN / itN : 0;
    for (let s = 0; s < 8; s++) {
      c += r[s] * (perIter(s, true, false) * orFrac + perIter(s, false, false) * (1 - orFrac));
    }
    c += zrN * (perIter(0, true, true) * orFrac + perIter(0, false, true) * (1 - orFrac));
    const calls = itN / 16;
    c += calls * perCallDelta;
    if (itN > 0) c += perFrameDelta;
    newRow.push(c);
    saveArr.push(rowCy[i] - c);
  }
  const newTick = tick.map((t, i) => t - saveArr[i]);
  const lateNew = newTick.filter(v => v > FR).length;
  const avgSave = sum(saveArr) / N;
  const TKn = st(newTick);
  return { name, bytes, avgSave, newRowAvg: sum(newRow) / N, lateNew, pctLate: 100 * lateNew / N,
           p50: TKn.p50, p90: TKn.p90, avgTick: TKn.avg, note };
}

// --- цены по модели шины (i8080 на Векторе) ---
const C = { LDAX: 8, INX: 8, ORA_A: 4, JCC: 12, JMP: 12, RRCA: 4, PUSH: 16, POP: 12,
            ANI: 8, ORA_M: 8, NOP: 4, MOV_MA: 8, DCR: 8, STAX: 8, MOV_AL: 8, CPI: 8,
            XRA_A: 4, MOV_RR: 8, MVI: 8, LDA: 16, STA: 16, RET: 12, CALL: 24, ADI: 8,
            MOV_AM: 8, XCHG: 4, DAD: 12, LXI: 12, RRC: 4, XRI: 8, RAL: 4 };

const V = [];

// V0 — как сейчас (сверка модели с фактом)
V.push(evalVariant("V0 текущая петля (сверка модели)", 0,
  (s, isOr, tr) => tr
    ? (C.LDAX + C.INX + C.ORA_A + C.JCC + (isOr ? C.ORA_M : C.NOP) + C.MOV_MA + C.DCR + C.XRA_A + C.STAX + C.DCR + C.MOV_AL + C.CPI + C.JCC)
    : (C.LDAX + C.INX + C.ORA_A + C.JCC + C.JMP + 4 * s + C.PUSH + C.ANI + (isOr ? C.ORA_M : C.NOP) + C.MOV_MA + C.DCR + C.POP + C.ANI + C.STAX + C.DCR + C.MOV_AL + C.CPI + C.JCC),
  0, 0, "контроль модели"));

console.log(`\n=== СВЕРКА МОДЕЛИ: расчёт V0 ${V[0].newRowAvg.toFixed(0)} т/кадр против факта ${RW.avg.toFixed(0)} (расхождение ${((V[0].newRowAvg / RW.avg - 1) * 100).toFixed(2)}%) ===`);

module.exports.evalVariant = evalVariant;
module.exports.C = C;
module.exports.CALLS_PER_FRAME = CALLS_PER_FRAME;
