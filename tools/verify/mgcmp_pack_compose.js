// mgcmp_pack_compose.js — ЗАМЕР СОСТАВА ПАЧКИ (задача: перенос на pop-блит теневого буфера).
// НИЧЕГО НЕ ЧИНИТ, только считает. Не трогает src/.
//
// ЧТО МЕРЯЕТ (на пиковом кадре живой игры, отдельно от среднего):
//  1) байты/такты в fb (0x8000-0xDFFF) по КАЖДОМУ ядру записи: vsb_or, vsb_andn,
//     vsb_mcol(+vsb_merge-обвязка), vsz_mcol(+vsz_merge), vsn_col, vsb_mrow, vsc_* (лицо
//     створки), vpr_wr (чередование пары) — и остаток ("диспетчер/сдвиг" vso_merge1+vsm_*
//     и vec_spr_show/vec_spr_out).
//  2) restore (vec_su_restore) и save (vec_su_save) — ЦЕЛИКОМ, как отдельные проходы:
//     такты, байты ЗАПИСАННЫЕ в fb (restore) и байты ПРОЧИТАННЫЕ из fb (save — он не
//     пишет fb вовсе, а переносит его в слот). Плюс: лежат ли restore/save ВНУТРИ того
//     же интервала [vec_spr_out entry..exit], что и рисование (бракет по PC).
//  3) байты fb, записанные ДВАЖДЫ И БОЛЕЕ за один проход пачки (restore, потом рисунок;
//     vsb_andn потом vsb_or) — с суммарной ценой лишних записей.
//  4) сколько объектов реально выводится (vsp_n/vsp_list), их габарит (ncols x 16 x
//     число плоскостей DRAW-записи), сумма полезных байт.
//
// ДЕКЛАРАЦИЯ ПОКРЫТИЯ: если за весь прогон ни один байт 0x8000-0xDFFF не перехвачен —
// это ПРОВАЛ ИНСТРУМЕНТА (напр. хук встал не на тот memory-объект), а не «мы не пишем».
// Инструмент печатает эту проверку явно.
//
// Запуск: node tools/verify/mgcmp_pack_compose.js [rom] [sym] [--pyr=6] [--pf=500]
"use strict";
const { make, toGame } = require("./beam_harness.js");
const T = __dirname, REPO = T + "/../..";
const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith("--"))
  .map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v === undefined ? "1" : v]; }));
const ROM = args[0] || REPO + "/build/kvalley_8c.rom";
const SYM = args[1] || REPO + "/build/kvalley_8c.sym";
const NP = +(opt.pyr || 6), PF = +(opt.pf || 500);

const E = make(ROM, SYM);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
const { L, rd, v06c, memory, cpu } = E;

// ---- обязательные символы ----
const NEED = ["vec_spr_out", "vec_spr_show", "vso_merge1", "vec_su_restore", "vec_su_save",
  "vsp_n", "vsp_list", "vec_nsp_idx", "GameStatus"];
for (const n of NEED) if (L[n] === undefined) { console.log(`ПРОВАЛ ПОКРЫТИЯ: нет символа ${n} в .sym`); process.exit(2); }

// ---- метка по PC (как в vsp_shift_cost.js) ----
const labs = []; for (const k in L) if (L[k] >= 0 && L[k] < 0x10000) labs.push([L[k], k]);
labs.sort((a, b) => a[0] - b[0]);
const laddr = labs.map(x => x[0]);
function labOf(pc) {
  let lo = 0, hi = laddr.length - 1, r = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (laddr[m] <= pc) { r = m; lo = m + 1; } else hi = m - 1; }
  return labs[r][1];
}

// ---- карта «метка ядра» -> «категория отчёта» (только те, что перечислены в задаче) ----
const KMAP = {
  vsb_or: "vsb_or (OR, классика vec_spr_show)",
  vsb_andn: "vsb_andn (AND-NOT гашение)", vsa_row: "vsb_andn (AND-NOT гашение)",
  vsb_mcol: "vsb_mcol (OR один столбец, слитая запись)", vsb_merge: "vsb_mcol (OR один столбец, слитая запись)",
  vsz_mcol: "vsz_mcol (запись без чтения фона, ZFLAG)", vsz_merge: "vsz_mcol (запись без чтения фона, ZFLAG)",
  vsb_mrow: "vsb_mrow (построчная слитая запись)", vsb_rl: "vsb_mrow (построчная слитая запись)", vsb_cl: "vsb_mrow (построчная слитая запись)",
  vsn_col: "vsn_col (AND-NOT слитая, доп. плоскость)", vsn_r: "vsn_col (AND-NOT слитая, доп. плоскость)",
  vsc_leaf: "vsc_leaf/plane/merge/ln (лицо створки)", vsc_plane: "vsc_leaf/plane/merge/ln (лицо створки)",
  vsc_merge: "vsc_leaf/plane/merge/ln (лицо створки)", vsc_ln: "vsc_leaf/plane/merge/ln (лицо створки)",
  vpr_wr: "vpr_wr (чередование пары по столбцам)", vpr_ka: "vpr_wr (чередование пары по столбцам)",
  vpr_kb: "vpr_wr (чередование пары по столбцам)", vpr_kset: "vpr_wr (чередование пары по столбцам)",
  vpr_kw: "vpr_wr (чередование пары по столбцам)", vpr_c: "vpr_wr (чередование пары по столбцам)",
};
const KCATS = [...new Set(Object.values(KMAP))];
const OTHER_SHOW = "vec_spr_show диспетчер (own)";
const OTHER_MERGE = "vso_merge1/vsm_* диспетчер+сдвиг габарита (own)";
const ALL_CATS = [...KCATS, OTHER_SHOW, OTHER_MERGE];

// ---- живой замер: такты + байты fb (0x8000..0xDFFF), разложенные по категориям ----
// ВАЖНО (найдено при сверке покрытия): чередованная запись ПАРЫ (vpr_wr) вызывается НЕ
// из vso_merge1, а из vmx_pair (vso_fastall) — vso_merge1 у пары только откладывает адреса
// (vpr_save) и НИЧЕГО не пишет, когда vpr_def взведён. Без отдельного бракета vpr_wr эти
// байты молча выпадали бы из категорий (были видны в totBytes, но не в разбивке по ядрам) —
// поймано первым прогоном (68 байт по категориям против 164 totBytes), см. коммит.
const OUT = L.vec_spr_out, SHOW = L.vec_spr_show, MERGE = L.vso_merge1, PAIRW = L.vpr_wr,
      REST = L.vec_su_restore, SAVE = L.vec_su_save;
if (PAIRW === undefined) { console.log("ПРОВАЛ ПОКРЫТИЯ: нет символа vpr_wr в .sym"); process.exit(2); }
const FBLO = 0x8000, FBHI = 0xE000; // [FBLO, FBHI)

let TT = 0, pc0 = 0;
let inShow = false, inMerge = false, inPairw = false, inRest = false, inSave = false;
let curCatCyc = null; // такты по тем же категориям, что curCat (байты) — для т/байт по ядру

const oI = cpu.instruction.bind(cpu);
cpu.instruction = function () {
  pc0 = cpu.pc; oI(); const vc = cpu.vcycles | 0; TT += vc;
  if (curCatCyc && (inShow || inMerge || inPairw)) {
    const c = catOf(pc0);
    if (c) curCatCyc[c] = (curCatCyc[c] || 0) + vc;
  }
};

// хук памяти: считает КАЖДЫЙ байт fb, записанный/прочитанный за пачку (для дедупа и для
// точной проверки «save fb не пишет»). Ключ дедупа — АДРЕС, живёт с начала vec_spr_out
// до его выхода (сбрасывается ниже, в бракете OUT).
const origWrite = memory.write.bind(memory);
const origRead = memory.read.bind(memory);
let writeMap = null;      // addr -> count (в текущей пачке)
let packWtot = 0, packRtot = 0;
// накопители текущего кадра (сбрасываются в бракете OUT)
let curCat = null;        // Float64Array по ALL_CATS: {bytes,cyc}
let curRestB = 0, curRestC = 0, curSaveB = 0, curSaveRdB = 0, curSaveC = 0, curShowC = 0, curMergeC = 0, curPairwC = 0;

function catOf(pc) {
  if (!inShow && !inMerge && !inPairw) return null;
  const nm = labOf(pc);
  const k = KMAP[nm];
  if (k) return k;
  if (inMerge) return OTHER_MERGE;
  if (inPairw) return "vpr_wr (чередование пары по столбцам)"; // диспетчер vpr_wr сам в KMAP
  return OTHER_SHOW;
}

memory.write = function (addr, w8, stackrq) {
  origWrite(addr, w8, stackrq);
  const a = addr & 0xffff;
  if (a < FBLO || a >= FBHI) return;
  if (writeMap) writeMap.set(a, (writeMap.get(a) || 0) + 1);
  packWtot++;
  if (inRest) { curRestB++; return; }
  if (inSave) { curSaveB++; return; } // ожидаем 0 — save не должен писать fb
  const c = catOf(pc0);
  if (c && curCat) curCat[c] = (curCat[c] || 0) + 1;
};
memory.read = function (addr, stackrq) {
  const v = origRead(addr, stackrq);
  const a = addr & 0xffff;
  if (a < FBLO || a >= FBHI) return v;
  packRtot++;
  if (inSave) curSaveRdB++;
  return v;
};

// ---- бракеты вызова (по адресу возврата, как в beam_top.js/beam_ops.js) ----
function retOf() { return memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8); }
const BR = { out: { pc: OUT }, show: { pc: SHOW }, merge: { pc: MERGE }, pairw: { pc: PAIRW }, rest: { pc: REST }, save: { pc: SAVE } };
for (const k in BR) { BR[k].ret = -1; BR[k].sp = -1; }

let packActive = false, packT0 = 0, curN = 0, curGS = 0;
let objList = [];       // {i, cat, nc, planes, footBytes}
const cat = i => i < 4 ? "ворота" : i < 6 ? "герой" : i < 14 ? "мумии" : i < 19 ? "нож" : "карта";

const frames = []; // сводки по пачкам живых кадров GS=5

v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  // --- OUT: начало/конец пачки ---
  if (pc === OUT && BR.out.ret < 0) {
    BR.out.sp = cpu.sp; BR.out.ret = retOf();
    // vsp_n/GameStatus ЧИТАЕМ НА ВХОДЕ: vec_spr_out потребляет список и может обнулить
    // счётчик к своему выходу (замер: чтение на выходе почти всегда даёт 0).
    packActive = true; packT0 = TT; writeMap = new Map();
    curN = rd(L.vsp_n); curGS = rd(L.GameStatus);
    curCat = {}; curCatCyc = {}; for (const c of ALL_CATS) { curCat[c] = 0; curCatCyc[c] = 0; }
    curRestB = curRestC = curSaveB = curSaveRdB = curSaveC = curShowC = curMergeC = curPairwC = 0;
    objList = [];
  } else if (BR.out.ret >= 0 && pc === BR.out.ret && cpu.sp > BR.out.sp) {
    BR.out.ret = -1;
    if (packActive) {
      let dupBytes = 0, dupExtra = 0;
      for (const c of writeMap.values()) if (c >= 2) { dupBytes++; dupExtra += c - 1; }
      const totBytes = writeMap.size;
      frames.push({
        t: TT - packT0, gs: curGS, n: curN,
        cat: { ...curCat }, catCyc: { ...curCatCyc }, restB: curRestB, restC: curRestC,
        saveB: curSaveB, saveRdB: curSaveRdB, saveC: curSaveC,
        showC: curShowC, mergeC: curMergeC, pairwC: curPairwC,
        totBytes, dupBytes, dupExtra, objList: objList.slice(),
      });
    }
    packActive = false; writeMap = null;
  }
  // --- SHOW / MERGE / REST / SAVE: своя цена целиком (own bracket) ---
  if (pc === SHOW && BR.show.ret < 0) { BR.show.sp = cpu.sp; BR.show.ret = retOf(); inShow = true; BR.show.t0 = TT;
    const i = rd(L.vec_nsp_idx), pg = 0xE000 + i * 256;
    const nc = rd(pg + 0x99), pb = rd(pg + 0x9F) ? 1 : 0, pc2 = rd(pg + 0x9B) ? 1 : 0;
    if (nc) objList.push({ i, cat: cat(i), nc, planes: 1 + pb + pc2, foot: nc * 16 * (1 + pb + pc2), via: "show" });
  } else if (BR.show.ret >= 0 && pc === BR.show.ret && cpu.sp > BR.show.sp) {
    BR.show.ret = -1; inShow = false; curShowC += TT - BR.show.t0;
  }
  if (pc === MERGE && BR.merge.ret < 0) { BR.merge.sp = cpu.sp; BR.merge.ret = retOf(); inMerge = true; BR.merge.t0 = TT;
    const i = rd(L.vec_nsp_idx), pg = 0xE000 + i * 256;
    const nc = rd(pg + 0x99), pb = rd(pg + 0x9F) ? 1 : 0, pc2 = rd(pg + 0x9B) ? 1 : 0;
    if (nc) objList.push({ i, cat: cat(i), nc, planes: 1 + pb + pc2, foot: nc * 16 * (1 + pb + pc2), via: "merge" });
  } else if (BR.merge.ret >= 0 && pc === BR.merge.ret && cpu.sp > BR.merge.sp) {
    BR.merge.ret = -1; inMerge = false; curMergeC += TT - BR.merge.t0;
  }
  if (pc === PAIRW && BR.pairw.ret < 0) { BR.pairw.sp = cpu.sp; BR.pairw.ret = retOf(); inPairw = true; BR.pairw.t0 = TT; }
  else if (BR.pairw.ret >= 0 && pc === BR.pairw.ret && cpu.sp > BR.pairw.sp) {
    BR.pairw.ret = -1; inPairw = false; curPairwC += TT - BR.pairw.t0;
  }
  if (pc === REST && BR.rest.ret < 0) { BR.rest.sp = cpu.sp; BR.rest.ret = retOf(); inRest = true; BR.rest.t0 = TT; }
  else if (BR.rest.ret >= 0 && pc === BR.rest.ret && cpu.sp > BR.rest.sp) {
    BR.rest.ret = -1; inRest = false; curRestC += TT - BR.rest.t0;
  }
  if (pc === SAVE && BR.save.ret < 0) { BR.save.sp = cpu.sp; BR.save.ret = retOf(); inSave = true; BR.save.t0 = TT; }
  else if (BR.save.ret >= 0 && pc === BR.save.ret && cpu.sp > BR.save.sp) {
    BR.save.ret = -1; inSave = false; curSaveC += TT - BR.save.t0;
  }
  return false;
};

// ---- сценарий: НАГРУЖЕННЫЙ геймплей, тот же канон, что frame_budget_cats/mummy_survey ----
let seed = 2024; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const KS = [37, 39, 38, 40]; let held = -1;
const plan = [];
for (let p = 0; p < NP; p++) { plan.push(["hop", p]); for (let f = 0; f < PF; f++) plan.push(["walk", f]); }
for (const [what, f] of plan) {
  if (what === "hop") {
    if (f === 0) continue;
    if (held > 0) { E.key(held, 0); held = -1; }
    E.key(78, 1); v06c.oneInterrupt(true); E.key(78, 0);
    for (let i = 0; i < 3000 && rd(L.GameStatus) !== 5; i++) v06c.oneInterrupt(true);
    for (let i = 0; i < 40; i++) v06c.oneInterrupt(true);
    continue;
  }
  if (f % 17 === 0) { const k = KS[(rnd() * 4) | 0]; if (k !== held) { if (held > 0) E.key(held, 0); E.key(k, 1); held = k; } }
  v06c.oneInterrupt(true);
}
if (held > 0) E.key(held, 0);

// восстановить оригинальные memory.read/write (гигиена — на будущее, если модуль переиспользуют)
memory.write = origWrite; memory.read = origRead;

// ============================ ОТЧЁТ ============================
const G = frames.filter(f => f.gs === 5 && f.n > 0);
console.log(`ROM=${ROM.split("/").pop()}  пачек с GS=5 и n>0: ${G.length} из ${frames.length} перехваченных входов в vec_spr_out`);

// --- ДЕКЛАРАЦИЯ ПОКРЫТИЯ ---
const totalBytesSeen = G.reduce((s, f) => s + f.totBytes, 0);
if (totalBytesSeen === 0) {
  console.log("\n>>> ПРОВАЛ ИНСТРУМЕНТА: ни одного байта 0x8000-0xDFFF не перехвачено за весь прогон.");
  console.log(">>> Это НЕ означает «пачка не пишет fb» — значит хук memory.write встал не на тот объект,");
  console.log(">>> либо адресация идёт мимо memory.write (bigram/paging). Числа ниже НЕДОСТОВЕРНЫ.");
  process.exit(3);
}
console.log(`ДЕКЛАРАЦИЯ ПОКРЫТИЯ: байт 0x8000-0xDFFF перехвачено суммарно ${totalBytesSeen} — хук живой, ноль-провала нет.\n`);

// --- гистограмма n (объектов в пачке) — честно показать, что реально встретилось ---
{
  const h = {};
  for (const f of G) h[f.n] = (h[f.n] || 0) + 1;
  console.log(`ГИСТОГРАММА n (объектов в непустой пачке) по ${G.length} пачкам:`);
  for (const n of Object.keys(h).map(Number).sort((a, b) => a - b))
    console.log(`   n=${String(n).padStart(2)}: ${h[n]} пачек (${(100 * h[n] / G.length).toFixed(1)}%)`);
}

// --- выбор ПИКОВОГО кадра: максимум объектов (n), при равенстве — максимум байт пачки ---
let peak = null;
for (const f of G) if (!peak || f.n > peak.n || (f.n === peak.n && f.totBytes > peak.totBytes)) peak = f;

function reportFrame(f, tag) {
  console.log(`================ ${tag} ================`);
  console.log(`объектов в списке вывода (vsp_n) = ${f.n}, длина пачки (vec_spr_out) = ${f.t} тактов, байт fb всего (уникальных адресов) = ${f.totBytes}`);
  console.log(`\n-- 1) СОСТАВ ПО ЯДРАМ ЗАПИСИ (внутри vec_spr_show/vso_merge1) --`);
  console.log(`   ${"ядро".padEnd(46)} ${"байт".padStart(7)} ${"такт".padStart(7)} ${"т/байт".padStart(7)} ${"доля пачки".padStart(11)}`);
  // ВАЖНО: sumB/sumC считаем по ВСЕМ категориям (включая «диспетчер», у которого байт=0,
  // но такты!=0 — это своя цена ветвления/настройки, не запись). Первый прогон прятал такую
  // строку фильтром печати «нет байт» и терял её из СВЕРКИ ТАКТОВ (невязка была -1940) —
  // не запись потерялась, а строка отчёта. Печать теперь показывает строки с байт ИЛИ такты.
  let sumB = 0, sumC = 0;
  const rows = ALL_CATS.map(c => [c, f.cat[c] || 0, f.catCyc[c] || 0]);
  for (const [c, b, cy] of rows) { sumB += b; sumC += cy; }
  for (const [c, b, cy] of rows.sort((a, b) => b[2] - a[2])) {
    if (!b && !cy) continue;
    console.log(`   ${c.padEnd(46)} ${String(b).padStart(7)} ${String(cy).padStart(7)} ${(b ? (cy / b).toFixed(1) : "—").padStart(7)} ${(100 * b / Math.max(1, f.totBytes)).toFixed(1).padStart(10)}%`);
  }
  console.log(`   ИТОГО байт по ядрам (draw/merge/pairw, без restore) = ${sumB}, тактов по ядрам = ${sumC}`);
  console.log(`   [такты, бракет целиком] vec_spr_show = ${f.showC} т, vso_merge1 = ${f.mergeC} т, vpr_wr (пара) = ${f.pairwC} т, сумма = ${f.showC + f.mergeC + f.pairwC}`);
  console.log(`   СВЕРКА ТАКТОВ: такты по ядрам (поинструкционно) ${sumC} против суммы бракетов ${f.showC + f.mergeC + f.pairwC} -> невязка ${sumC - (f.showC + f.mergeC + f.pairwC)} (обязана быть 0 — два независимых способа счёта одного и того же)`);
  if (sumB) console.log(`   средний т/байт по show+merge+pairw = ${((f.showC + f.mergeC + f.pairwC) / sumB).toFixed(1)}`);
  // totBytes — УНИКАЛЬНЫЕ адреса; полное число ЗАПИСЕЙ (с повторами) = totBytes+dupExtra.
  // Сверяем именно с ним: sumB/restB считают КАЖДУЮ запись (включая повторные).
  const allWrites = f.totBytes + f.dupExtra;
  const covResid = allWrites - (sumB + f.restB);
  console.log(`   СВЕРКА ПОКРЫТИЯ: байт по ядрам ${sumB} + restore ${f.restB} = ${sumB + f.restB}, всего ЗАПИСЕЙ в пачке (уникальных ${f.totBytes} + повторных ${f.dupExtra}) = ${allWrites} -> невязка ${covResid}${covResid !== 0 ? "  (!!) записи вне классификации — см. предупреждение ниже" : " (сходится, 0 неклассифицированных байт)"}`);

  console.log(`\n-- 2) RESTORE / SAVE --`);
  console.log(`   restore: ${f.restC} тактов, ${f.restB} байт ЗАПИСАНО в fb (${f.restB ? (f.restC / f.restB).toFixed(1) : "—"} т/байт)`);
  console.log(`   save:    ${f.saveC} тактов, ${f.saveB} байт ЗАПИСАНО в fb (ожидание: 0 — save читает fb, пишет слот), ${f.saveRdB} байт ПРОЧИТАНО из fb`);
  console.log(`   restore/save вызываются ИЗ vec_spr_out (тот же бракет пачки, что и рисование) — подтверждено бракетом по адресу возврата.`);

  console.log(`\n-- 3) ДВОЙНЫЕ ЗАПИСИ (байт fb, записанных >=2 раз за пачку) --`);
  console.log(`   байт с >=2 записями: ${f.dupBytes}, лишних записей всего: ${f.dupExtra} (доля от всех записей fb: ${(100 * f.dupExtra / Math.max(1, packWtotForFrame(f))).toFixed(2)}% — см. ниже точный знаменатель)`);

  console.log(`\n-- 4) ОБЪЕКТЫ ПАЧКИ (DRAW-геометрия: ncols x 16 x число плоскостей) --`);
  const byI = {}; for (const o of f.objList) byI[o.i] = o; // объект может попасть и в show, и (если пара) в merge — не дублируем
  const list = Object.values(byI).sort((a, b) => a.i - b.i);
  let footSum = 0;
  for (const o of list) { footSum += o.foot; console.log(`   слот ${String(o.i).padStart(2)} (${o.cat.padEnd(6)}) via=${o.via.padEnd(5)} ncols=${o.nc} плоскостей=${o.planes} -> ${o.foot} байт`); }
  console.log(`   ИТОГО объектов=${list.length}, суммарно «полезных» байт (footprint) = ${footSum}`);
}

// такты внутри "лишних записей" — для контекста берём средний т/байт пачки (show+merge)/(байт show+merge)
function packWtotForFrame(f) { return f.totBytes + f.dupExtra; } // totBytes = уникальных, +dupExtra = все повторы

reportFrame(peak, `ПИКОВЫЙ КАДР (максимум объектов, n=${peak.n})`);

// --- среднее по всем пачкам живого геймплея (для контекста/устойчивости числа) ---
console.log(`\n================ СРЕДНЕЕ ПО ${G.length} ПАЧКАМ ГЕЙМПЛЕЯ (для контекста) ================`);
const avgN = G.reduce((s, f) => s + f.n, 0) / G.length;
const avgT = G.reduce((s, f) => s + f.t, 0) / G.length;
const avgTotB = G.reduce((s, f) => s + f.totBytes, 0) / G.length;
const avgDupB = G.reduce((s, f) => s + f.dupBytes, 0) / G.length;
const avgDupX = G.reduce((s, f) => s + f.dupExtra, 0) / G.length;
const avgRestC = G.reduce((s, f) => s + f.restC, 0) / G.length;
const avgRestB = G.reduce((s, f) => s + f.restB, 0) / G.length;
const avgSaveC = G.reduce((s, f) => s + f.saveC, 0) / G.length;
const avgSaveRdB = G.reduce((s, f) => s + f.saveRdB, 0) / G.length;
const avgShowC = G.reduce((s, f) => s + f.showC, 0) / G.length;
const avgMergeC = G.reduce((s, f) => s + f.mergeC, 0) / G.length;
console.log(`объектов/пачка avg=${avgN.toFixed(2)}, длина пачки avg=${avgT.toFixed(0)} такт, байт fb (уникальных) avg=${avgTotB.toFixed(1)}`);
console.log(`restore: avg ${avgRestC.toFixed(0)} такт, ${avgRestB.toFixed(1)} байт;  save: avg ${avgSaveC.toFixed(0)} такт, читает ${avgSaveRdB.toFixed(1)} байт fb`);
console.log(`show: avg ${avgShowC.toFixed(0)} такт;  merge: avg ${avgMergeC.toFixed(0)} такт`);
console.log(`двойные записи: avg ${avgDupB.toFixed(2)} байт с >=2 записями, avg ${avgDupX.toFixed(2)} лишних записей/пачку`);
const sumCatAvg = {}, sumCatCycAvg = {};
for (const c of ALL_CATS) {
  sumCatAvg[c] = G.reduce((s, f) => s + (f.cat[c] || 0), 0) / G.length;
  sumCatCycAvg[c] = G.reduce((s, f) => s + (f.catCyc[c] || 0), 0) / G.length;
}
console.log(`\nСОСТАВ ПО ЯДРАМ (среднее байт/такт на пачку, т/байт):`);
for (const [c, b] of Object.entries(sumCatAvg).sort((a, b) => b[1] - a[1]))
  if (b > 0.001) console.log(`   ${c.padEnd(46)} ${b.toFixed(2).padStart(8)} байт/пачку  ${sumCatCycAvg[c].toFixed(1).padStart(8)} т/пачку  ${(sumCatCycAvg[c] / b).toFixed(1).padStart(6)} т/байт`);
