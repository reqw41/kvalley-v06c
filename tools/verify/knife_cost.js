// knife_cost.js — ЦЕНА НОЖА в спрайтовом конвейере (задача «свой путь для фаз 7/8»).
//
// ЗАЧЕМ. Нож занимает слоты 15..18 таблицы атрибутов (knifeAttrib = sprAttrib+0x3C).
// В ПОЛЁТЕ (статус 5) он рисуется ТАЙЛОМ и конвейера не касается вовсе; вся цена сидит
// в ОТСКОКЕ/ПАДЕНИИ (статусы 7/8), где он идёт спрайтом через общий конвейер.
// Меряем ЧЕСТНО и с разбивкой по подпроходам, чтобы понимать, что именно снимет
// собственный короткий путь.
//
// ЧТО СЧИТАЕТ (только на кадрах геймплея, GameStatus=5):
//   * такты, отнесённые слотам ножа, по подпроходам: prep (подготовка в тике),
//     restore/save (стирание и снятие фона в пачке), show/merge (вывод в fb);
//   * то же в разрезе фазы ножа: 5 = полёт, 7/8 = отскок/падение;
//   * кадров каждой фазы; такты на кадр фазы;
//   * конец пачки vec_spr_out (p50/p90) отдельно для кадров с ножом-спрайтом и без;
//   * длина пачки (объектов) и доля слитых пачек.
//
// ВВОД ПО ИГРОВЫМ ТИКАМ (правило A/B спрайтовой подсистемы): подача клавиш — функция
// номера тика, поэтому две сборки проходят одну и ту же игру и цифры сопоставимы.
// Нож добывается форсом objetoCogido=0x10 (нож в руке) + импульсы FIRE (SPACE).
//
// Запуск: node tools/verify/knife_cost.js [rom] [sym] [тиков=2600]
"use strict";
const { make } = require("./beam_harness.js");
const T = __dirname;
const ROM = process.argv[2] || T + "/../../build/kvalley_8c.rom";
const SYM = process.argv[3] || T + "/../../build/kvalley_8c.sym";
const NT = +(process.argv[4] || 2600);
const E = make(ROM, SYM);
const { L, rd, v06c, memory, cpu, keyboard } = E;
const need = ["timer", "GameStatus", "objetoCogido", "IDcuchilloCoge", "knifesData", "numKnifes", "vec_isr",
  "vec_spr_out", "vec_su_save", "vec_su_restore", "vec_spr_show", "vec_nsp_idx", "vsp_n"];
for (const n of need) if (L[n] === undefined) { console.log("нет символа " + n); process.exit(2); }
const PREP = L.vec_spr_prep, MERGE = L.vso_merge1, PAIRW = L.vpr_wr, TICK = L.H_TIMI;
const KNIFE0 = 15, KNIFE1 = 18;

let TT = 0;
const oI = cpu.instruction.bind(cpu);
cpu.instruction = function () { oI(); TT += cpu.vcycles | 0; };
function retOf() { return memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8); }

// аккумуляторы текущего кадра
// фаза ножа СНИМАЕТСЯ В МОМЕНТ ВХОДА В ISR: кадров-прерываний меньше, чем вызовов
// oneInterrupt (при длинном тике следующее прерывание приходит вложенным, depth!=0),
// поэтому выравнивать по номеру вызова НЕЛЬЗЯ — на этом уже обожглись.
function knifePhase() {
  let ph = 0;
  const nk = rd(L.numKnifes);
  for (let i = 0; i < Math.min(nk, 6); i++) {
    const st = rd(L.knifesData + 17 * i);
    if (st === 5 && ph < 5) ph = 5;
    if (st === 7 || st === 8) ph = 7;
  }
  return ph;
}
let cur = null, knifeDepth = 0;
const frames = [];
const B = {};
function bp(name, pc, kind) { if (pc !== undefined) B[name] = { pc, kind, ret: -1, sp: -1, t0: 0, idx: -1 }; }
bp("prep", PREP, "slot");
bp("save", L.vec_su_save, "slot");
bp("rest", L.vec_su_restore, "slot");
bp("show", L.vec_spr_show, "slot");
bp("merge", MERGE, "slot");
// ЗАДАЧА#46: свой короткий путь ножа — считаем ЦЕЛИКОМ (vec_knife_erase/vec_knife_show),
// иначе сравнение «до/после» слепо: старый путь виден в prep/save/rest/show, новый — нет.
bp("kerase", L.vec_knife_erase, "knife");
bp("kshow", L.vec_knife_show, "knife");
bp("out", L.vec_spr_out, "win");
bp("tick", TICK, "win");

v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (pc === L.vec_isr && rd(L.vec_isr_depth) === 0) {
    if (cur) frames.push(cur);
    cur = { irq: TT, gs: rd(L.GameStatus), outS: -1, outE: -1, tickS: -1, tickE: -1,
            n: 0, fast: 0, c: { prep: 0, save: 0, rest: 0, show: 0, merge: 0, knife: 0, nested: 0 }, kn: 0,
            ph: knifePhase() };
  }
  if (!cur) return false;
  for (const k in B) {
    const b = B[k];
    if (pc === b.pc && b.ret < 0) {
      b.sp = cpu.sp; b.ret = retOf(); b.t0 = TT; b.idx = rd(L.vec_nsp_idx);
      if (k === "out") { cur.outS = TT; cur.n = rd(L.vsp_n); cur.fast = L.vsp_fast !== undefined ? rd(L.vsp_fast) : 0; }
      if (k === "tick") cur.tickS = TT;
      if (b.kind === "knife") knifeDepth++;
    } else if (b.ret >= 0 && pc === b.ret && cpu.sp > b.sp) {
      b.ret = -1;
      const d = TT - b.t0;
      if (k === "out") cur.outE = TT;
      else if (k === "tick") cur.tickE = TT;
      else if (b.kind === "knife") { knifeDepth--; cur.c.knife += d; if (d > 200) cur.kn = 1; }
      else if (b.idx >= KNIFE0 && b.idx <= KNIFE1) { cur.c[k] += d; cur.kn = 1;
        if (knifeDepth > 0) cur.c.nested += d; }   // сейв/стирание ВНУТРИ своего пути — не двоить
    }
  }
  return false;
};

// ---- ввод как функция игрового тика ----
const held = new Set();
function keysFor(t) {
  const k = [];
  if (t < 260) { if ((t >> 2) & 1) k.push(32); return k; }   // логотип -> меню -> старт
  // геймплей: бежим вправо/влево и импульсами жмём FIRE (бросок ножа)
  if ((t & 31) < 16) k.push(39); else k.push(37);
  if ((t & 15) === 3) k.push(32);                            // импульс FIRE раз в 16 тиков
  return k;
}
// ГРАБЛИ ФОРСА (2026-08-03). Голый форс objetoCogido=0x10 КАЖДЫЙ кадр ломает игру:
// бросок берёт нож по IDcuchilloCoge и ставит ему статус 4 БЕЗУСЛОВНО, поэтому нож
// перехватывается прямо посреди отскока — hideKnifeSpr не отрабатывает, и на экране
// навсегда остаётся спрайт-призрак, который конвейер стирает и рисует КАЖДЫЙ кадр
// (замер: +11.4 тыс. тактов на кадр в фазе «полёт», которой по построению цена нулевая).
// Поэтому нож в руку даём ТОЛЬКО когда он реально свободен (статус 0/1/2).
function forceKnife() {
  const st = rd(L.knifesData);
  if (st <= 2) { wr(L.objetoCogido, 0x10); wr(L.IDcuchilloCoge, 0); }
}
function setKeys(t) {
  const want = new Set(keysFor(t));
  for (const c of held) if (!want.has(c)) keyboard.keyUp({ keyCode: c, which: c, preventDefault() {}, stopPropagation() {} });
  for (const c of want) if (!held.has(c)) keyboard.keyDown({ keyCode: c, which: c, preventDefault() {}, stopPropagation() {} });
  held.clear(); for (const c of want) held.add(c);
}
function wr(a, v) { memory.write(a & 0xffff, v & 255, false); }

let tick = 0, prevT = rd(L.timer), fr = 0;
while (tick <= NT && fr < 400000) {
  setKeys(tick);
  if (tick >= 260) forceKnife();
  v06c.oneInterrupt(true); fr++;
  const t = rd(L.timer);
  if (t !== prevT) { prevT = t; tick++; }
}
if (cur) frames.push(cur);

// ---- сводка ----
// фазы выравниваем по кадрам: frames[i] соответствует phaseOfFrame[i] (оба растут по кадрам)
const acc = {};
for (const p of [0, 5, 7]) acc[p] = { n: 0, prep: 0, save: 0, rest: 0, show: 0, merge: 0, knife: 0, nested: 0, outE: [], len: 0, fast: 0 };
const outAll = [], outKnife = [], outNo = [];
let nGame = 0;
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  if (f.gs !== 5) continue;
  nGame++;
  const p = f.ph;
  const a = acc[p]; if (!a) continue;
  a.n++;
  for (const k of ["prep", "save", "rest", "show", "merge", "knife", "nested"]) a[k] += f.c[k];
  a.len += f.n; a.fast += f.fast ? 1 : 0;
  if (f.outE >= 0) { const w = f.outE - f.irq; a.outE.push(w); outAll.push(w); (f.kn ? outKnife : outNo).push(w); }
}
const pct = (arr, q) => { if (!arr.length) return 0; const s = arr.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))] | 0; };
const nm = { 0: "нет ножа-спрайта", 5: "полёт (тайл)", 7: "отскок/падение 7-8" };
console.log(`НОЖ: цена в спрайтовом конвейере. Кадров геймплея ${nGame} (тиков ${tick}, кадров всего ${fr})`);
console.log("фаза                 кадров   prep   save   rest   show  merge  СВОЙ   ИТОГО/кадр");
for (const p of [0, 5, 7]) {
  const a = acc[p]; if (!a.n) continue;
  const tot = a.prep + a.save + a.rest + a.show + a.merge + a.knife - a.nested;  // save/rest на своём пути уже внутри knife
  const d = x => (x / a.n).toFixed(0).padStart(6);
  console.log(`${nm[p].padEnd(20)} ${String(a.n).padStart(6)} ${d(a.prep)} ${d(a.save)} ${d(a.rest)} ${d(a.show)} ${d(a.merge)} ${d(a.knife)}   ${(tot / a.n).toFixed(0).padStart(6)}`);
}
for (const p of [0, 5, 7]) {
  const a = acc[p]; if (!a.n) continue;
  console.log(`  ${nm[p]}: конец пачки p50=${pct(a.outE, 0.5)} p90=${pct(a.outE, 0.9)}, объектов в пачке ${(a.len / a.n).toFixed(2)}, слитых пачек ${(100 * a.fast / a.n).toFixed(1)}%`);
}
console.log(`конец пачки ВСЕ: p50=${pct(outAll, 0.5)} p90=${pct(outAll, 0.9)} (n=${outAll.length})`);
console.log(`  кадры С ножом-спрайтом: p50=${pct(outKnife, 0.5)} p90=${pct(outKnife, 0.9)} (n=${outKnife.length})`);
console.log(`  кадры БЕЗ ножа:         p50=${pct(outNo, 0.5)} p90=${pct(outNo, 0.9)} (n=${outNo.length})`);
