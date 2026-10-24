// БЮДЖЕТ КАДРА ПО КАТЕГОРИЯМ — с ПОЛНЫМ покрытием и самопроверкой.
//
// ЧТО БЫЛО СЛОМАНО (до 2026-08-03). Старая версия раскладывала кадр по ТОЧКАМ ВХОДА
// игрового тика и считала, что RENDER = вход в updateSprites. После задачи #14 подготовка
// и ВЫВОД спрайтов разделены: подготовка (vec_spr_prep) осталась в тике, а ВЫВОД
// (vec_spr_out + save-under + vec_spr_show) переехал в ISR и в updateSprites больше не
// заходит. Вся пачка вывода, скан клавиатуры, палитра, звуковые часы и обвязка ISR молча
// падали в OTHER: в худшем кадре получалось RENDER=0 при OTHER=70.9%. Плюс две тихие
// поломки: (1) `drawBrilloGemas` снят из игры ещё задачей #35, а имя осталось в списке
// LOGIC (ENTRY[undefined]); (2) бракетинг по SP ЛОМАЕТСЯ на SP-хайджеках (vec_su_restore/
// vec_su_save/vbt_row/vec_scroll кладут в SP адрес данных) — на них старый стек фаз
// схлопывался и такты уходили в OTHER.
//
// КАК СДЕЛАНО СЕЙЧАС.
//  1) СКОУП-СТЕК ПО АДРЕСУ ВОЗВРАТА, А НЕ ПО SP. На входе в известную процедуру читаем
//     адрес возврата со стека и запоминаем пару (ret, sp). Кадр закрывается ровно тогда,
//     когда PC==ret И sp==sp_входа+2. SP-хайджеки такому стеку не мешают (PC внутри петли
//     хайджека ни разу не равен ret). Прерывание — тоже «процедура» (vec_isr), поэтому
//     ISR, пришедший посреди игрового тика, не приписывается тику.
//  2) ПОКРЫТИЕ ЗАМКНУТО. Категорий столько, чтобы НЕОТНЕСЁННЫХ тактов почти не осталось,
//     а те, что остались, инструмент печатает САМ: строка «НЕ ОТНЕСЕНО» + топ меток, куда
//     эти такты пришлись (ближайшая метка .sym). Молчаливого OTHER больше нет.
//  3) РЕНДЕР РАЗДЕЛЁН на ПОДГОТОВКУ (тик) и ВЫВОД (ISR), каждая — со своими подкатегориями.
//  4) Заодно печатается ПЛОСКИЙ ПРОФИЛЬ по меткам (exclusive, такты/кадр) для СРЕДНЕГО и
//     для ХУДШЕГО кадра — они устроены по-разному (в среднем есть halt, в худшем его нет).
//
// СВЕРКА: сумма всех категорий обязана равняться сумме тактов кадра; инструмент печатает
// невязку явно (должна быть 0).
//
// Запуск: node tools/verify/frame_budget_cats.js [rom] [sym] [--pyr=6] [--pf=500] [--top=24]
//   --pyr — сколько пирамид пройти читом N, --pf — кадров геймплея на пирамиду.
//   Сценарий тот же, что в mummy_survey.js, чтобы числа сходились между инструментами.
// ОТЧЁТ идёт тремя срезами: СРЕДНИЙ кадр геймплея, ХУДШИЕ 10% (среднее по децили — по ним
// и надо принимать решения) и ХУДШИЙ ОДИН кадр (это почти всегда выброс: кадр смены сцены,
// где форсируются все 21 слот).
"use strict";
const fs = require("fs");
const { make, toGame } = require("./beam_harness.js");
const T = __dirname, REPO = T + "/../..";
const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith("--"))
  .map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v === undefined ? "1" : v]; }));
const ROM = args[0] || REPO + "/build/kvalley_8c.rom";
const SYM = args[1] || REPO + "/build/kvalley_8c.sym";

const TOP = +(opt.top || 24);
const BUDGET = 59904;

const E = make(ROM, SYM);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
const { L, rd, v06c, memory, cpu, key, run } = E;

// ---- плоская карта PC -> метка (для отчёта и для расследования неотнесённых тактов) ----
const labels = [];
for (const l of fs.readFileSync(SYM, "latin1").split("\n")) {
  const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);
  if (m) { const a = parseInt(m[2], 16); if (a >= 0 && a < 0x10000) labels.push([a, m[1]]); }
}
labels.sort((a, b) => a[0] - b[0]);
const symIdx = new Uint16Array(0x10000);
{ let k = 0; for (let a = 0; a < 0x10000; a++) { while (k + 1 < labels.length && labels[k + 1][0] <= a) k++; symIdx[a] = k; } }
const NL = labels.length;

// ---------------------------- КАТЕГОРИИ ----------------------------
// Порядок = порядок печати. Каждая категория — точка входа (или несколько).
// «own» значит: собственный код процедуры МИНУС всё, что она зовёт из перечисленных ниже.
const GROUPS = [
  ["ISR / вне игрового тика", [
    ["ISR_OVH", ["vec_isr"], "вход/выход ISR, спасение теней Z80, клавиши S/P/L/N/H/E"],
    ["SND_CLK", ["vsnd_sample", "vsnd_tick_clk", "vsnd_tick", "vec_snd_apply", "vec_snd_show", "vec_snd_hush"], "часы музыки (замер+решение), без плеера"],
    ["MUSIC", ["updateSound"], "плеер AY (зовётся через vsnd_tick)"],
    ["FLUSHVI", ["vec_vi_ch"], "AY-регистры -> ВИ53"],
    ["PALETTE", ["vsp_load", "vec_brillo_pal"], "палитра в VBlank + блеск idx4"],
    ["KEYS", ["vec_scan_keys"], "скан клавиатуры Вектора (порт 3)"],
    ["OUT_REST", ["vec_su_restore"], "ВЫВОД: стирание (слот -> fb, POP-хайджек)"],
    ["OUT_SAVE", ["vec_su_save"], "ВЫВОД: сейв фона (fb -> слот, POP-хайджек)"],
    ["OUT_DRAW", ["vec_spr_show"], "ВЫВОД: обычный блит спрайта в fb (OR поверх чистого фона)"],
    ["OUT_MERGE", ["vso_merge1", "vpr_wr"], "ВЫВОД: СЛИТАЯ запись (фон OR спрайт одним проходом)"],
    ["OUT_OVH", ["vec_spr_out"], "ВЫВОД: список/диспетчер/vso_setord (own)"],
    ["COMPOSE", ["vec_compose"], "дренаж dirty-клеток HUD"],
  ]],
  ["ИГРОВОЙ ТИК (H_TIMI)", [
    ["PREP_OWN", ["vec_nat_sprites"], "ПОДГОТОВКА: флаги/список/распространение (own)"],
    ["PREP_GEO", ["vec_spr_prep"], "ПОДГОТОВКА: геометрия объекта (own)"],
    ["PREP_SHIFT", ["vsp_pat"], "ПОДГОТОВКА: сдвиг паттерна в буфер слота"],
    ["PREP_MARK", ["vsp_fastmark"], "ПОДГОТОВКА: разметка пересечений"],
    ["PREP_SORT", ["vso_sortord", "vpr_scan"], "ПОДГОТОВКА: сортировка порядка вывода + поиск пары"],
    ["AI_MOM", ["AI_Momias"], "ИИ мумий"],
    ["AI_PRO", ["AI_Prota"], "ИИ героя"],
    ["KNIFE", ["AI_Cuchillos"], "ИИ ножей"],
    ["CHK_KNF", ["chkCogeKnife"], "проверка: герой поднимает нож с пола"],
    ["CHK_GEM", ["chkCogeGema"], "проверка: герой берёт гем"],
    ["CHK_PICO", ["chkCogePico"], "проверка: герой берёт кирку"],
    ["CHK_MOM", ["chkTocaMomia"], "проверка: герой коснулся мумии"],
    ["LOGIC", ["chkScroll", "AI_Gemas", "AI_Salidas", "MurosTrampa", "spiningDoors", "escalerasEntrada"], "прочая игровая логика"],
    ["CTRL", ["chkControls"], "чтение управления"],
    ["TICK_OWN", ["H_TIMI"], "остаток тика: tickMain/runGame/gameLogic/tickGame, HUD, блит (own)"],
  ]],
  ["ВНЕ ISR", [
    ["IDLE", [], "halt (простой основного цикла)"],
    ["MAIN", [], "dummyLoop (ei/jp вокруг halt)"],
    ["UNATTRIB", [], "НЕ ОТНЕСЕНО НИ К ЧЕМУ — расшифровка ниже"],
  ]],
];
const CATS = [];
const ENTRY = new Map();          // pc -> категория
const missing = [];
for (const [, list] of GROUPS) for (const [cat, names] of list) {
  CATS.push(cat);
  for (const n of names) {
    if (L[n] === undefined) { missing.push(n); continue; }
    ENTRY.set(L[n], cat);
  }
}
if (missing.length) console.log("ВНИМАНИЕ: нет в .sym (категория останется пустой): " + missing.join(", "));
// Вектор RST7 (0x0038 = `jp vec_isr`, ставится в vec_init): формально это НЕ вызов, а
// аппаратный рестарт, поэтому имени в .sym у него нет и такты падали в «не отнесено».
ENTRY.set(0x38, "ISR_OVH");
const CI = {}; CATS.forEach((c, i) => CI[c] = i);
const NC = CATS.length;
const I_IDLE = CI.IDLE, I_MAIN = CI.MAIN, I_UNAT = CI.UNATTRIB;
// «MAIN» = плоские метки основного цикла: там нет вызовов, скоуп-стек пуст по построению.
const MAINSYM = new Set(["dummyLoop"]);

// ---------------------------- ЗАМЕР ----------------------------
const STACKTOP = L.stackTop || 0x75a5;
let scope = [];                    // {cat, ret, sp}
let curCat = -1;
let fCat = new Float64Array(NC);   // такты категории в текущем кадре
let fSym = new Float64Array(NL);   // такты метки в текущем кадре (exclusive)
let fUnat = new Float64Array(NL);  // неотнесённые такты по меткам
let recording = false;
let leaks = 0, maxDepth = 0;

const oI = cpu.instruction.bind(cpu);
cpu.instruction = function () {
  const pc = cpu.pc & 0xffff, sp = cpu.sp & 0xffff;
  if (recording) {
    // 1) закрыть все скоупы, чей возврат состоялся
    while (scope.length) {
      const f = scope[scope.length - 1];
      if (pc === f.ret && sp === ((f.sp + 2) & 0xffff)) scope.pop(); else break;
    }
    // 2) войти в новый скоуп
    const c = ENTRY.get(pc);
    if (c !== undefined) {
      const ret = memory.bytes[memory.tobank(sp)] | (memory.bytes[memory.tobank((sp + 1) & 0xffff)] << 8);
      scope.push({ cat: CI[c], ret, sp });
      if (scope.length > maxDepth) maxDepth = scope.length;
      if (scope.length > 48) { scope.length = 0; leaks++; }   // страховка от `ld sp,stackTop`
    }
    curCat = scope.length ? scope[scope.length - 1].cat : -1;
  }
  oI();
  if (!recording) return;
  const vc = cpu.vcycles | 0;
  const si = symIdx[pc];
  fSym[si] += vc;
  if (cpu.last_opcode === 0x76) { fCat[I_IDLE] += vc; return; }
  if (curCat >= 0) { fCat[curCat] += vc; return; }
  if (MAINSYM.has(labels[si][1])) { fCat[I_MAIN] += vc; return; }
  fCat[I_UNAT] += vc; fUnat[si] += vc;
};

// ---------------------------- СБОР КАДРОВ ----------------------------
const GS = L.GameStatus, FPM = L.flagPiramideMap, ENEMY = L.enemyAttrib, PROTAROOM = L.ProtaRoom;
function mummies() { let n = 0; for (let i = 0; i < 4; i++) if (rd(ENEMY + i * 4) !== 0xE0) n++; return n; }

const sumCat = new Float64Array(NC), sumSym = new Float64Array(NL);
const sumUnat = new Float64Array(NL);
let nFrames = 0;
let best = null;                    // худший (самый нагруженный) кадр
const allFrames = [];
const workHist = [];
// доп. счётчики для «плавности»
let lateFrames = 0;

// СЦЕНАРИЙ — ТОТ ЖЕ, ЧТО В mummy_survey.js: NP пирамид по PF кадров, псевдослучайная
// ходьба, переход на следующую пирамиду читом N. Это канонический «загруженный геймплей»
// репозитория; повторять его тут важно, чтобы числа сходились с mummy_survey/beam_late.
const NP = +(opt.pyr || 6), PF = +(opt.pf || 500);
let seed = 2024; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const KS = [37, 39, 38, 40]; let held = -1;
let prevRoom = rd(PROTAROOM);
function frame() {
  fCat.fill(0); fSym.fill(0); fUnat.fill(0);
  recording = true; v06c.oneInterrupt(true); recording = false;
  const room = rd(PROTAROOM), scroll = room !== prevRoom; prevRoom = room;
  return !(rd(GS) !== 5 || !(rd(FPM) & 1) || scroll);
}
const plan = [];
for (let p = 0; p < NP; p++) { plan.push(["hop", p]); for (let f = 0; f < PF; f++) plan.push(["walk", f]); }
for (const [what, f] of plan) {
  if (what === "hop") {
    if (f === 0) continue;
    if (held > 0) { key(held, 0); held = -1; }
    key(78, 1); frame(); key(78, 0);
    for (let i = 0; i < 3000 && rd(GS) !== 5; i++) frame();
    for (let i = 0; i < 40; i++) frame();
    continue;
  }
  if (f % 17 === 0) { const k = KS[(rnd() * 4) | 0]; if (k !== held) { if (held > 0) key(held, 0); key(k, 1); held = k; } }
  const ok = frame();
  if (rd(GS) !== 5) { for (let i = 0; i < 3000 && rd(GS) !== 5; i++) frame(); continue; }
  if (!ok) continue;
  let tot = 0; for (let i = 0; i < NC; i++) tot += fCat[i];
  const work = tot - fCat[I_IDLE];
  if (fCat[I_IDLE] === 0) lateFrames++;
  nFrames++; workHist.push(work);
  for (let i = 0; i < NC; i++) sumCat[i] += fCat[i];
  for (let i = 0; i < NL; i++) { sumSym[i] += fSym[i]; sumUnat[i] += fUnat[i]; }
  const snap = { work, tot, cat: Float32Array.from(fCat), sym: Float32Array.from(fSym), unat: Float32Array.from(fUnat), mum: mummies(), f };
  allFrames.push(snap);
  if (!best || work > best.work) best = snap;
}
if (!nFrames) { console.log("не набрано кадров геймплея"); process.exit(1); }

// ---------------------------- ОТЧЁТ ----------------------------
const pc2 = x => (100 * x / BUDGET).toFixed(1);
function report(cat, sym, unat, tot, work, tag, extra) {
  console.log("\n================ " + tag + " ================");
  console.log(extra || "");
  console.log(`ВСЕГО тактов в кадре ${Math.round(tot)} | РАБОТА ${Math.round(work)} (${pc2(work)}% кадра) | простой(halt) ${Math.round(cat[I_IDLE])} | бюджет ${BUDGET}`);
  const resid = Math.round(tot) - BUDGET;
  console.log(`сверка покрытия: сумма категорий ${Math.round(tot)} тактов, кадр Вектора ${BUDGET} -> невязка ${resid} (кадры не выровнены по IRQ ровно, |невязка| < 100 = норма)`);
  for (const [gname, list] of GROUPS) {
    let gs = 0; for (const [c] of list) gs += cat[CI[c]];
    console.log(`\n-- ${gname}: ${Math.round(gs)} тактов (${pc2(gs)}%)`);
    const rows = list.map(([c, , note]) => [c, cat[CI[c]], note]).sort((a, b) => b[1] - a[1]);
    for (const [c, v, note] of rows) {
      if (v < 1 && c !== "UNATTRIB") continue;
      console.log(`   ${c.padEnd(11)} ${String(Math.round(v)).padStart(6)} т  ${(pc2(v) + "%").padStart(6)}   ${note}`);
    }
  }
  const un = cat[I_UNAT];
  console.log(`\n>>> НЕ ОТНЕСЕНО НИ К ЧЕМУ: ${Math.round(un)} тактов = ${pc2(un)}% кадра (${(100 * un / work).toFixed(2)}% работы)`);
  if (un > 0) {
    const idx = [...unat.keys()].filter(i => unat[i] > 0).sort((a, b) => unat[b] - unat[a]).slice(0, 12);
    for (const i of idx) console.log(`      ${String(Math.round(unat[i])).padStart(6)} т  ${labels[i][1]} @0x${labels[i][0].toString(16)}`);
  }
  console.log(`\n-- ПЛОСКИЙ ПРОФИЛЬ ПО МЕТКАМ (exclusive), топ-${TOP} тактов/кадр:`);
  const si = [...sym.keys()].filter(i => sym[i] > 0).sort((a, b) => sym[b] - sym[a]).slice(0, TOP);
  let acc = 0;
  for (const i of si) {
    acc += sym[i];
    console.log(`   ${String(Math.round(sym[i])).padStart(6)} т ${(pc2(sym[i]) + "%").padStart(6)}  ${labels[i][1].padEnd(20)} @0x${labels[i][0].toString(16)}`);
  }
  console.log(`   (топ-${TOP} = ${Math.round(acc)} т, ${(100 * acc / tot).toFixed(1)}% кадра)`);
  // Свёртка меток в ПРОЦЕДУРЫ по префиксу имени (vsrt_*, vsp_*, vns_*, ...) — читаемый
  // список «горячих мест», в котором одна процедура не размазана по десятку локальных меток.
  const grp = new Map();
  for (let i = 0; i < NL; i++) {
    if (!sym[i]) continue;
    const n = labels[i][1];
    const k = PREFIX(n);
    grp.set(k, (grp.get(k) || 0) + sym[i]);
  }
  console.log(`\n-- ТО ЖЕ, СВЁРНУТО В ПРОЦЕДУРЫ (префикс метки), топ-${TOP}:`);
  const gs2 = [...grp.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);
  for (const [k, v] of gs2)
    console.log(`   ${String(Math.round(v)).padStart(6)} т ${(pc2(v) + "%").padStart(6)}  ${k}`);
}
// Локальные метки процедур в этом репозитории имеют общий префикс до первого '_'
// (vsrt_w/vsrt_wk -> vsrt_*), поэтому свёртка по нему = свёртка по процедуре.
// Особые случаи выписаны явно: там префикс либо слишком общий, либо метка одиночная.
const PREFIX_MAP = {
  vsrt: "vso_sortord (сортировка порядка вывода)", vso: "vec_spr_out (список/диспетчер)",
  vsb: "vec_spr_show (блит спрайта)", vss: "vec_spr_show (блит спрайта)",
  vsm: "vso_merge1 (слитая запись)", vpr: "vec_spr_out (парная запись vpr_*)",
  vsp: "vec_spr_prep/vsp_pat (геометрия+сдвиг)", vsd: "vec_spr_prep (габарит/маски vsd_*)",
  vop: "vec_spr_prep (объединение боксов vop_*)", vom: "vec_spr_prep (пересечения vom_*)",
  vfm: "vsp_fastmark (разметка)", vns: "vec_nat_sprites (цикл слотов)",
  vfl: "vec_nat_sprites (флаги/список vfl*)", vfla: "vec_nat_sprites (флаги/список vfl*)",
  vflp: "vec_nat_sprites (флаги/список vfl*)", vflf: "vec_nat_sprites (флаги/список vfl*)",
  vsu: "vec_su_restore/save (POP-хайджек)", vkn: "нож (vec_knife_*)",
  vbt: "блиттер тайлов (vbt_*)", vw: "write-path (vw_*)", vcw: "vec_cache_wr",
};
function PREFIX(n) {
  const p = n.split("_")[0];
  if (PREFIX_MAP[p]) return PREFIX_MAP[p];
  if (/^vec_su_/.test(n)) return "vec_su_restore/save (POP-хайджек)";
  if (/^vec_spr_prep/.test(n)) return "vec_spr_prep/vsp_pat (геометрия+сдвиг)";
  if (/^vec_spr_out/.test(n)) return "vec_spr_out (список/диспетчер)";
  if (/^vec_nat_sprites/.test(n)) return "vec_nat_sprites (цикл слотов)";
  if (/^updateSound/.test(n) || /^WRTPSG/.test(n) || /^vsnd/.test(n)) return "музыка (updateSound/WRTPSG)";
  if (/^vec_isr/.test(n)) return "vec_isr (обвязка)";
  return n;
}

const avgCat = Float64Array.from(sumCat, v => v / nFrames);
const avgSym = Float64Array.from(sumSym, v => v / nFrames);
const avgUnat = Float64Array.from(sumUnat, v => v / nFrames);
let avgTot = 0; for (let i = 0; i < NC; i++) avgTot += avgCat[i];
workHist.sort((a, b) => a - b);
const p = q => workHist[Math.min(workHist.length - 1, Math.floor(q * workHist.length))];

console.log(`ROM=${ROM}`);
console.log(`кадров ГЕЙМПЛЕЯ в замере: ${nFrames} (пирамид ${NP} x ${PF} кадров)`);
console.log(`РАБОТА кадра: p10 ${p(0.1)} | p50 ${p(0.5)} | p90 ${p(0.9)} | max ${workHist[workHist.length - 1]}`);
console.log(`кадров БЕЗ ЕДИНОГО halt (тик не влез в кадр): ${lateFrames} (${(100 * lateFrames / nFrames).toFixed(1)}%)`);
console.log(`скоуп-стек: максимальная глубина ${maxDepth}, аварийных сбросов ${leaks}`);

report(avgCat, avgSym, avgUnat, avgTot, avgTot - avgCat[I_IDLE], `СРЕДНИЙ кадр геймплея (n=${nFrames})`);

// ХУДШИЕ 10% — среднее по децили: одиночный максимум почти всегда выброс (кадр загрузки
// комнаты), а решение про кэш принимается по устойчиво тяжёлым кадрам.
const worst = allFrames.slice().sort((a, b) => b.work - a.work).slice(0, Math.max(1, Math.round(nFrames * 0.1)));
{
  const c = new Float64Array(NC), s = new Float64Array(NL), u = new Float64Array(NL);
  for (const fr of worst) { for (let i = 0; i < NC; i++) c[i] += fr.cat[i] / worst.length;
    for (let i = 0; i < NL; i++) { s[i] += fr.sym[i] / worst.length; u[i] += fr.unat[i] / worst.length; } }
  let t = 0; for (let i = 0; i < NC; i++) t += c[i];
  report(c, s, u, t, t - c[I_IDLE], `ХУДШИЕ 10% кадров (n=${worst.length}, среднее)`);
}
report(best.cat, best.sym, best.unat, best.tot, best.work, `ХУДШИЙ ОДИН кадр (кадр #${best.f}, мумий ${best.mum})`);
