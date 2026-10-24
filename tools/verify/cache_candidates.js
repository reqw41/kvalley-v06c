// ОЦЕНКА КАНДИДАТОВ НА КЭШ — по факту, а не по рассуждению.
//
// Меряет ровно те величины, от которых зависит окупаемость кэша:
//  1) КЭШ СДВИНУТЫХ СПРАЙТОВ. Ключ = (паттерн, зеркало, сдвиг X&7), значение = 48 Б
//     готового буфера слота (смещения 0xA0..0xCF, их пишет vsp_pat). Считаем:
//     сколько вызовов vsp_pat, сколько тактов каждый, и КАКАЯ ДОЛЯ ПОПАДАЕТ в LRU-кэш
//     на 1/2/4/8/16/32 записи. Кэш окупается только если попаданий много: промах стоит
//     дороже отсутствия кэша (лишняя проверка), попадание экономит vsp_pat минус копию.
//  2) ДЛИНА СПИСКА ВЫВОДА vsp_n — от неё квадратично зависит вставочная сортировка
//     vso_sortord (в худшем кадре она стоит 21 тыс. тактов).
//  3) ПОВТОР ГЕОМЕТРИИ. Ключ = (idx, Y, X, pat): сколько подготовок объекта идут с ТЕМ ЖЕ
//     набором, что и в прошлый раз (тогда весь vec_spr_prep — холостой).
//
// Запуск: node tools/verify/cache_candidates.js [rom] [sym] [пирамид] [кадров на пирамиду]
"use strict";
const { make, toGame } = require("./beam_harness.js");
const T = __dirname, REPO = T + "/../..";
const ROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[3] || REPO + "/build/kvalley_8c.sym";
const NP = +(process.argv[4] || 6), PF = +(process.argv[5] || 500);
const E = make(ROM, SYM);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
const { L, rd, v06c, memory, cpu, key } = E;

const PAT = L.vsp_pat, PREP = L.vec_spr_prep, SORT = L.vso_sortord;
// 4) ПРОВЕРКИ ПОДБОРА (chkCogeGema/chkCogePico/chkCogeKnife/chkTocaMomia) идут КАЖДЫЙ тик
//    полным перебором предметов уровня. Гемы и кирки НЕ ДВИГАЮТСЯ — исход проверки может
//    измениться только если сдвинулся герой (или предмет исчез/появился). Считаем, сколько
//    тактов эти проверки тратят В КАДРАХ, ГДЕ ГЕРОЙ НЕ СДВИНУЛСЯ, — это верхняя оценка
//    выигрыша от гейта «позиция героя не менялась».
const CHK = { chkCogeGema: L.chkCogeGema, chkCogePico: L.chkCogePico, chkCogeKnife: L.chkCogeKnife, chkTocaMomia: L.chkTocaMomia };
const chkTot = {}, chkStill = {}; for (const k in CHK) { chkTot[k] = 0; chkStill[k] = 0; }
let inChk = null, heroStill = false, framesStill = 0;
let prevHero = "";
const rdb = a => memory.bytes[memory.tobank(a & 0xffff)];

// --- сбор ключей вызовов vsp_pat -------------------------------------------------
const patCalls = [];        // {key, cyc}
const prepCalls = [];       // {key}
const nHist = new Array(32).fill(0);
const sortCost = [];
let live = false;
let inPat = null, inPrep = null, inSort = null;
// TT считает такты БЕЗ ВЛОЖЕННЫХ ПРЕРЫВАНИЙ. Игровой тик сам идёт ИЗ ISR (глубина 1) —
// его считать надо; а вот RST7, пришедший ПОСРЕДИ тика (глубина >=2), добавляет к любому
// замеряемому окну 10-20 тыс. чужих тактов (тик идёт с ei) и врёт про цену процедуры.
let TT = 0; const isrSt = [];
const oI = cpu.instruction.bind(cpu);
cpu.instruction = function () {
  const pc = cpu.pc & 0xffff, sp = cpu.sp & 0xffff;
  while (isrSt.length) { const f = isrSt[isrSt.length - 1];
    if (pc === f.ret && sp === ((f.sp + 2) & 0xffff)) isrSt.pop(); else break; }
  if (pc === 0x38) isrSt.push({ ret: memory.bytes[memory.tobank(sp)] | (memory.bytes[memory.tobank(sp + 1)] << 8), sp });
  if (live) {
    if (pc === PAT && !inPat) {
      const ptr = rdb(L.vec_nsp_ptr) | (rdb(L.vec_nsp_ptr + 1) << 8);
      const pat = rdb(ptr + 2), sh = rdb(L.vsp_sh);
      inPat = { key: pat * 8 + (sh & 7), t0: TT, ret: memory.bytes[memory.tobank(sp)] | (memory.bytes[memory.tobank(sp + 1)] << 8), sp };
    } else if (inPat && pc === inPat.ret && sp === ((inPat.sp + 2) & 0xffff)) {
      patCalls.push({ key: inPat.key, cyc: TT - inPat.t0 }); inPat = null;
    }
    if (pc === PREP && !inPrep) {
      const ptr = rdb(L.vec_nsp_ptr) | (rdb(L.vec_nsp_ptr + 1) << 8);
      const idx = rdb(L.vec_nsp_idx);
      inPrep = { key: idx + "," + rdb(ptr) + "," + rdb(ptr + 1) + "," + rdb(ptr + 2), idx, t0: TT,
                 ret: memory.bytes[memory.tobank(sp)] | (memory.bytes[memory.tobank(sp + 1)] << 8), sp };
    } else if (inPrep && pc === inPrep.ret && sp === ((inPrep.sp + 2) & 0xffff)) {
      prepCalls.push({ key: inPrep.key, idx: inPrep.idx, cyc: TT - inPrep.t0 }); inPrep = null;
    }
    if (pc === SORT && !inSort) {
      nHist[Math.min(31, rdb(L.vsp_n))]++;
      inSort = { n: rdb(L.vsp_n), t0: TT, ret: memory.bytes[memory.tobank(sp)] | (memory.bytes[memory.tobank(sp + 1)] << 8), sp };
    } else if (inSort && pc === inSort.ret && sp === ((inSort.sp + 2) & 0xffff)) {
      sortCost.push([inSort.n, TT - inSort.t0]); inSort = null;
    }
    if (!inChk) { for (const k in CHK) if (pc === CHK[k]) {
      inChk = { k, t0: TT, ret: memory.bytes[memory.tobank(sp)] | (memory.bytes[memory.tobank(sp + 1)] << 8), sp }; break; } }
    else if (pc === inChk.ret && sp === ((inChk.sp + 2) & 0xffff)) {
      const d = TT - inChk.t0; chkTot[inChk.k] += d; if (heroStill) chkStill[inChk.k] += d; inChk = null;
    }
  }
  oI(); if (isrSt.length < 2) TT += cpu.vcycles | 0;
};

// --- сценарий: как в mummy_survey/frame_budget_cats -------------------------------
let seed = 2024; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const KS = [37, 39, 38, 40]; let held = -1;
let frames = 0;
const step = () => {
  const h = rd(L.ProtaX) + "," + rd(L.ProtaY) + "," + rd(L.ProtaRoom) + "," + rd(L.sentidoProta);
  heroStill = (h === prevHero); prevHero = h;
  v06c.oneInterrupt(true);
  if (live) { frames++; if (heroStill) framesStill++; }
};
for (let p = 0; p < NP; p++) {
  if (p > 0) { live = false; if (held > 0) { key(held, 0); held = -1; }
    key(78, 1); step(); key(78, 0);
    for (let i = 0; i < 3000 && rd(L.GameStatus) !== 5; i++) step();
    for (let i = 0; i < 40; i++) step(); }
  live = true;
  for (let f = 0; f < PF; f++) {
    if (f % 17 === 0) { const k = KS[(rnd() * 4) | 0]; if (k !== held) { if (held > 0) key(held, 0); key(k, 1); held = k; } }
    step();
    if (rd(L.GameStatus) !== 5) { live = false; for (let i = 0; i < 3000 && rd(L.GameStatus) !== 5; i++) step(); live = true; }
  }
  if (held > 0) { key(held, 0); held = -1; }
}
live = false;

// ---------------------------- ОТЧЁТ ----------------------------
console.log(`кадров геймплея ${frames}; вызовов vsp_pat ${patCalls.length}, vec_spr_prep ${prepCalls.length}`);
const sum = a => a.reduce((x, y) => x + y, 0);
const patCyc = sum(patCalls.map(c => c.cyc));
console.log(`\n=== 1. КЭШ СДВИНУТЫХ СПРАЙТОВ (ключ = паттерн x зеркало x сдвиг) ===`);
console.log(`vsp_pat: ${patCalls.length} вызовов, ${patCyc} тактов = ${(patCyc / frames).toFixed(0)} т/кадр, средний вызов ${(patCyc / patCalls.length).toFixed(0)} т`);
const uniq = new Set(patCalls.map(c => c.key));
console.log(`уникальных ключей за прогон: ${uniq.size} (полная таблица = ${uniq.size} x 48 Б = ${uniq.size * 48} Б)`);
for (const N of [1, 2, 4, 8, 16, 32, 64]) {
  const lru = []; let hit = 0, saved = 0;
  for (const c of patCalls) {
    const i = lru.indexOf(c.key);
    if (i >= 0) { hit++; saved += c.cyc; lru.splice(i, 1); }
    lru.unshift(c.key); if (lru.length > N) lru.pop();
  }
  const COPY = 900;   // 48 Б стек-блитом из кэша в буфер слота (~17.5 т/Б + обвязка)
  const MISS = 60;    // проверка ключа на промахе
  const net = saved - hit * COPY - (patCalls.length - hit) * MISS;
  console.log(`  LRU ${String(N).padStart(2)} записей (${String(N * 51).padStart(5)} Б): попаданий ${(100 * hit / patCalls.length).toFixed(1).padStart(5)}%  ` +
    `сэкономлено брутто ${(saved / frames).toFixed(0).padStart(5)} т/кадр  ЧИСТО ${(net / frames).toFixed(0).padStart(5)} т/кадр`);
}
// повтор ключа с прошлого кадра того же слота (простейший кэш «на слот»)
{
  const last = {}; let hit = 0, saved = 0;
  for (const c of patCalls) { /* ключ без слота, но проверим «тот же, что в прошлый раз вообще» */ }
  let prev = null;
  for (const c of patCalls) { if (prev === c.key) { hit++; saved += c.cyc; } prev = c.key; }
  console.log(`  «тот же ключ, что у предыдущего вызова» (кэш на 1 запись, без LRU): ${(100 * hit / patCalls.length).toFixed(1)}%`);
}

console.log(`\n=== 2. ДЛИНА СПИСКА ВЫВОДА vsp_n (вход в vso_sortord) ===`);
const tot = sum(nHist);
for (let i = 0; i < 32; i++) if (nHist[i]) console.log(`  n=${String(i).padStart(2)}: ${String(nHist[i]).padStart(6)} (${(100 * nHist[i] / tot).toFixed(1)}%)`);
const byN = {};
for (const [n, c] of sortCost) { (byN[n] = byN[n] || []).push(c); }
console.log("  цена сортировки по длине списка (среднее / максимум тактов):");
for (const n of Object.keys(byN).sort((a, b) => a - b))
  console.log(`    n=${String(n).padStart(2)}  ${String(Math.round(sum(byN[n]) / byN[n].length)).padStart(6)} / ${String(Math.max(...byN[n])).padStart(6)}   вызовов ${byN[n].length}`);
console.log(`  ВСЕГО сортировка: ${sum(sortCost.map(x => x[1]))} т = ${(sum(sortCost.map(x => x[1])) / frames).toFixed(0)} т/кадр`);

console.log(`\n=== 3. ПОВТОР ГЕОМЕТРИИ (тот же слот с теми же Y,X,pat, что в прошлый раз) ===`);
{
  const last = {}; let hit = 0, hitCyc = 0, totCyc = 0;
  for (const c of prepCalls) {
    totCyc += c.cyc;
    if (last[c.idx] === c.key) { hit++; hitCyc += c.cyc; }
    last[c.idx] = c.key;
  }
  console.log(`  vec_spr_prep: ${prepCalls.length} вызовов, ${totCyc} т = ${(totCyc / frames).toFixed(0)} т/кадр`);
  console.log(`  из них «всё то же самое»: ${hit} (${(100 * hit / prepCalls.length).toFixed(1)}%), ${(hitCyc / frames).toFixed(0)} т/кадр — это ХОЛОСТАЯ работа`);
}

console.log(`\n=== 4. ПРОВЕРКИ ПОДБОРА: сколько тратится ВПУСТУЮ, пока герой стоит ===`);
console.log(`  кадров, где (ProtaX,ProtaY,ProtaRoom,направление) НЕ изменились: ${framesStill} из ${frames} (${(100 * framesStill / frames).toFixed(1)}%)`);
let ct = 0, cs = 0;
for (const k in CHK) { ct += chkTot[k]; cs += chkStill[k];
  console.log(`  ${k.padEnd(14)} ${(chkTot[k] / frames).toFixed(0).padStart(5)} т/кадр, из них при неподвижном герое ${(chkStill[k] / frames).toFixed(0).padStart(5)} т/кадр`);
}
console.log(`  ИТОГО ${(ct / frames).toFixed(0)} т/кадр, «герой не двигался» ${(cs / frames).toFixed(0)} т/кадр (${(100 * cs / ct).toFixed(0)}% всех проверок)`);
