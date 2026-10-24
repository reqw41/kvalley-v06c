// audit_alive.js — ЖИВ ЛИ МЕХАНИЗМ: доказательство ЗАПИСЬЮ, а не комментарием.
//
// ЗАЧЕМ. Инвентарь рендера набит машинерией, построенной под гонку с лучом на ВЕРХУ
// ИГРОВОГО ПОЛЯ (табло тогда жило в поле). Табло уехало в кайму; вопрос — что из этого
// стало мёртвым. Счётчик вызовов на этот вопрос НЕ отвечает: процедура может исправно
// вызываться и исправно ничего не менять.
//
// МЕТОД. Оборачиваем memory.write. Пока PC внутри интересующей процедуры (бракетинг по
// адресу возврата + SP, как в frame_budget_cats), считаем:
//   calls  — сколько раз вызвана;
//   w      — сколько байт записано ВСЕГО;
//   wEff   — сколько записей РЕАЛЬНО поменяли байт (новое значение != старому);
//   wVis   — сколько из wEff пришлись в ВИДИМЫЙ фреймбуфер 0x8000..0xDFFF
//            (p0 0x80-0x9F, p1 0xA0-0xBF, p2 0xC0-0xDF; 0xE0+ = служебный p3/слоты);
//   callsVis — в скольких ВЫЗОВАХ был хоть один wVis (это и есть «сработал по делу»).
// МЕХАНИЗМ С callsVis = 0 НА ВСЕХ СЦЕНАХ — КАНДИДАТ НА СНЯТИЕ: он не поменял на экране
// ни одного пикселя ни разу.
// ВАЖНО: обратное неверно. callsVis > 0 не доказывает НУЖНОСТЬ (запись могла быть
// идемпотентным повтором того, что и так было бы нарисовано) — но доказывает, что
// снятие механизма изменит картинку, то есть требует отдельной приёмки.
//
// ЗАПУСК: node tools/verify/audit_alive.js [rom] [sym] [тиков=1500]
"use strict";
const { make, toGame } = require("./beam_harness.js");
const T = __dirname, REPO = T + "/../..";
const args = process.argv.slice(2);
const ROM = args[0] || REPO + "/build/kvalley_8c.rom";
const SYM = args[1] || REPO + "/build/kvalley_8c.sym";
const NT = +(args[2] || 1500);

const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory } = E;

// ---- инвентарь аудита: имя -> метка входа ----
const WANT = [
  ["vtm_restore",   "vtm_restore",   "topmask: ANDN силуэта на restore (+0xD4/+0xD5)"],
  ["vtm_zclip",     "vtm_zclip",     "topmask: зануление lo 240..255 после ANDN"],
  ["vtm_afterdraw", "vtm_afterdraw", "topmask: снятие силуэта в +0xD5 после вывода"],
  ["vfr_gate",      "vfr_gate",      "vec_repair: починка спрайта после фон-блита"],
  ["vec_su_fixup",  "vec_su_fixup",  "подновление фона в слотах при блите клетки"],
  ["vsu_scw",       "vsu_scw",       "сейв ЗАВЁРНУТОГО столбца (lo0>=241)"],
  ["vclp",          "vclp",          "жёсткий клип габарита сверху"],
  ["vsc_leaf",      "vsc_leaf",      "композит створки ворот"],
  ["vpz_wr",        "vpz_wr",        "стек-блит пары героя"],
  ["vpz_pair",      "vpz_pair",      "стек-блит: путь пары (столбец-пара)"],
  ["vpr_sout",      "vpr_sout",      "пара героя первой, обычным механизмом"],
  ["vmx_pair",      "vmx_pair",      "пара героя первой, слитой записью"],
  ["vmx_check",     "vmx_check",     "проверка пригодности пары (тик)"],
  ["vpr_scan",      "vpr_scan",      "поиск пары в списке вывода (тик)"],
  ["vsb_mcol",      "vsb_mcol",      "слитый путь: столбец с фоном"],
  ["vsb_mrow",      "vsb_mrow",      "слитый путь: строка"],
  ["vsp_fastmark",  "vsp_fastmark",  "решение о слитой записи всей пачки"],
  ["vso_sortord",   "vso_sortord",   "сортировка порядка вывода по lo0"],
  ["vso_fastall",   "vso_fastall",   "пачка целиком слитой записью"],
  ["vec_su_save",   "vec_su_save",   "сейв фона под спрайт"],
  ["vec_su_restore","vec_su_restore","стирание спрайта (restore фона)"],
  ["vec_spr_show",  "vec_spr_show",  "обычный OR-вывод спрайта"],
  ["vso_merge1",    "vso_merge1",    "слитая запись «фон OR спрайт»"],
];
const M = [];
for (const [name, sym, doc] of WANT) {
  if (L[sym] === undefined) { M.push({ name, doc, missing: true }); continue; }
  M.push({ name, doc, pc: L[sym], ret: -1, sp: -1, calls: 0, w: 0, wEff: 0, wVis: 0, callsVis: 0, curVis: 0, cyc: 0, t0: 0, missing: false });
}
const live = [];                      // стек активных механизмов (вложенность допустима)

// ТАКТЫ. Считаем ИНКЛЮЗИВНО (вся работа внутри вызова, включая вложенные вызовы) — так
// цена механизма сопоставима с бюджетом кадра. Модель тактов берём у эмулятора
// (cpu.vcycles): она уже «реальная» (цикл 4 такта, inr/dcr/inx = 8), бумажные таблицы
// i8080 занижены и в этом проекте не годятся.
let TT = 0;
// SELF-TIME ПО ДИАПАЗОНУ АДРЕСОВ — точная цена механизма без двойного счёта.
// Инклюзивный бракетинг по возврату врёт там, где в процедуру ВХОДЯТ ПЕРЕХОДОМ
// (vtm_restore = `jp` из vec_su_restore, выход `jp vsu_rcont`): такому «вызову» достаётся
// весь остаток чужой процедуры. Здесь каждая инструкция кладёт свои такты в тот диапазон,
// в котором лежит её PC — сумма по диапазонам аддитивна и не зависит от способа входа.
const RANGES = [
  ["vec_topmask.asm  (весь)", 0x74AC, 0x759F],
  ["vec_repair.asm   (весь)", 0x745F, 0x74AC],
  ["vclp", 0x5F83, 0x5FC8],
  ["vsp_fastmark", 0x619E, 0x628A],
  ["vso_sortord", 0x6630, 0x66B4],
  ["пара vpr_sout+vmx_*", 0x63BF, 0x65A6],
  ["vpr_wr (чередование)", 0x65A6, 0x6630],
  ["vsc_leaf", 0x6730, 0x6818],
  ["стек-блит vpz_*", 0x6818, 0x68A6],
  ["слитый путь vsb_*", 0x68A6, 0x697B],
  ["vec_su_fixup", 0x4A9A, 0x4B9F],
  ["vec_su_restore", 0x5676, 0x5714],
  ["vec_su_save", 0x5714, 0x5829],
  ["vec_spr_show", 0x66B4, 0x6730],
  ["vec_nat_sprites (F/P)", 0x5238, 0x566D],
  ["vec_spr_prep", 0x5A8F, 0x5F83],
].map(r => ({ name: r[0], lo: r[1], hi: r[2], c: 0 }));
const oInstr = cpu.instruction.bind(cpu);
cpu.instruction = function () { const pc = cpu.pc; oInstr(); const c = cpu.vcycles | 0; TT += c;
  for (const r of RANGES) if (pc >= r.lo && pc < r.hi) { r.c += c; break; } };

// ---- перехват записи ----
const origWrite = memory.write.bind(memory);
memory.write = function (addr, w8, stackrq) {
  if (live.length) {
    const a = addr & 0xffff;
    const old = memory.bytes[memory.tobank(memory.bigram_select(a, stackrq))];
    const eff = (old !== (w8 & 0xff));
    const vis = eff && a >= 0x8000 && a < 0xE000;
    for (const m of live) { m.w++; if (eff) m.wEff++; if (vis) { m.wVis++; m.curVis++; } }
  }
  return origWrite(addr, w8, stackrq);
};

function retOf() { return memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8); }
let gs = 0;
v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  for (const m of M) {
    if (m.missing) continue;
    if (pc === m.pc && m.ret < 0) { m.sp = cpu.sp; m.ret = retOf(); m.calls++; m.curVis = 0; m.t0 = TT; live.push(m); }
    else if (m.ret >= 0 && pc === m.ret && cpu.sp > m.sp) {
      m.ret = -1; if (m.curVis) m.callsVis++; m.cyc += TT - m.t0;
      const k = live.lastIndexOf(m); if (k >= 0) live.splice(k, 1);
    }
  }
  return false;
};

// ---- сценарий: несколько сцен, ввод ПО ИГРОВЫМ ТИКАМ ----
// Пирамиды листаем читом N (клавиша 78) — он работает только при старте F1+F5 (toGame).
// ВЕРХНЯЯ СТРОКА ЛАБИРИНТА — ОБЯЗАТЕЛЬНАЯ ЧАСТЬ ПОКРЫТИЯ. Гейты topmask/vclp/vsu_scw
// открываются только при lo0 >= 224 (Y героя <= 15), то есть на САМОЙ ВЕРХНЕЙ строке и
// в прыжке с неё. Обычная прогулка туда не попадает НИ РАЗУ — замер без этой фазы
// объявил бы весь topmask мёртвым (проверено: 0 срабатываний на 1500 тиков прогулки).
// Поэтому с тика TOP0 герой и мумии принудительно ставятся на верхнюю строку (приём
// hero_top_stress.js) и жмётся прыжок (клавиша 32).
const TOP0 = 1000, TOPROW = 12;
function keysFor(t) {
  const k = [];
  if (t < 200) { if ((t >> 2) & 1) k.push(32); }
  else if (t < 500) k.push(t & 8 ? 39 : 37);          // бег влево-вправо, пирамида 1 (низ)
  else if (t < 560) k.push(t & 4 ? 38 : 39);          // вверх по лестнице
  else if (t < 700) k.push(t & 8 ? 39 : 37);
  else if (t < 710) k.push(78);                       // чит N: следующая пирамида
  else if (t < TOP0) { k.push(t & 8 ? 39 : 37); if ((t & 15) === 3) k.push(32); }   // бег + нож
  else { k.push((t % 200) < 100 ? 39 : 37); if ((t & 15) < 6) k.push(32); }         // верх + прыжки
  return k;
}
const seen = new Set();
let held = new Set(), tick = 0, prevT = 0, nf = 0, gsFrames = 0;
if (toGame(E) !== 5) { console.error("НЕ ВОШЛИ В ИГРУ (GameStatus != 5) — замер невозможен"); process.exit(2); }
while (tick <= NT && nf < 500000) {
  const want = new Set(keysFor(tick));
  for (const c of held) if (!want.has(c)) E.key(c, 0);
  for (const c of want) if (!held.has(c)) E.key(c, 1);
  held = want;
  gs = rd(L.GameStatus); seen.add(gs); if (gs === 5) gsFrames++;
  // нож в руку, чтобы путь броска исполнялся (как в beam_ab.js/knife_cost.js)
  if (tick >= 700 && tick < TOP0) { const st = rd(L.knifesData); if (st <= 2) { memory.write(L.objetoCogido, 0x10, false); memory.write(L.IDcuchilloCoge, 0, false); } }
  // фаза «верхняя строка»: подтягиваем героя и мумий наверх раз в 32 тика (чаще нельзя —
  // насильная запись Y каждый тик подвешивает героя, и логика перестаёт его двигать)
  if (tick >= TOP0 && (tick % 32) === 0 && gs === 5) {
    if (rd(L.ProtaY) > TOPROW + 8) memory.write(L.ProtaY, TOPROW, false);
    for (let m = 0; m < 8; m++) { const y = rd(L.enemyAttrib + m * 4); if (y < 0xD0 && y > TOPROW + 8) memory.write(L.enemyAttrib + m * 4, TOPROW, false); }
  }
  v06c.oneInterrupt(true); nf++;
  const t = rd(L.timer); if (t !== prevT) { prevT = t; tick++; }
}
for (const c of held) E.key(c, 0);

// ---- ГЕЙТ ПУСТОЙ ВЫБОРКИ ----
if (gsFrames < 200) { console.error(`ПУСТАЯ ВЫБОРКА: кадров геймплея ${gsFrames} — сцена не воспроизвелась`); process.exit(3); }
const anchor = M.find(m => m.name === "vec_spr_show");
if (!anchor || anchor.calls === 0) { console.error("ПУСТАЯ ВЫБОРКА: vec_spr_show ни разу не вызван — стенд не рисует"); process.exit(3); }
// ДЕКЛАРАЦИЯ ПОКРЫТИЯ: фаза «верхняя строка» обязана состояться, иначе весь topmask
// объявится мёртвым по недосмотру стенда, а не по существу.
const tm = M.find(m => m.name === "vtm_afterdraw");
if (!tm || tm.w === 0) { console.error("ПРОВАЛ ПОКРЫТИЯ: фаза «верхняя строка» не состоялась (vtm_afterdraw не сработал ни разу)"); process.exit(3); }

console.log(`ROM=${ROM.split("/").pop()}  тиков ${NT}, кадров ${nf}, кадров геймплея ${gsFrames}`);
console.log(`сцены (GameStatus), которые встретились: ${[...seen].sort((a, b) => a - b).join(" ")}`);
console.log("");
console.log(`ТАКТЫ приведены НА КАДР ГЕЙМПЛЕЯ (кадр Вектора = 59904 такта), инклюзивно.`);
console.log("ВНИМАНИЕ: механизмы ПОДГОТОВКИ (vclp, vsp_fastmark, vso_sortord, vpr_scan,");
console.log("vmx_check, vec_su_save, vec_su_fixup, vtm_afterdraw, vsc_leaf) пишут ТОЛЬКО в");
console.log("страницы слотов p3 — у них «в видимый fb = 0» ПО УСТРОЙСТВУ и мёртвости не значит.");
console.log("");
console.log("механизм          вызовов   такт/кадр   записей   изменивших   в ВИДИМЫЙ fb   вызовов «по делу»   что это");
for (const m of M) {
  if (m.missing) { console.log(`${m.name.padEnd(16)}  НЕТ МЕТКИ В .sym                                                   ${m.doc}`); continue; }
  console.log(`${m.name.padEnd(16)} ${String(m.calls).padStart(8)} ${(m.cyc / gsFrames).toFixed(0).padStart(11)} ${String(m.w).padStart(9)} ${String(m.wEff).padStart(12)} ${String(m.wVis).padStart(14)} ${String(m.callsVis).padStart(19)}   ${m.doc}`);
}
console.log("");
const dead = M.filter(m => !m.missing && m.calls > 0 && m.callsVis === 0);
const never = M.filter(m => !m.missing && m.calls === 0);
console.log("SELF-TIME ПО ДИАПАЗОНАМ АДРЕСОВ (такты/кадр геймплея, БЕЗ двойного счёта):");
for (const r of RANGES.slice().sort((a, b) => b.c - a.c))
  console.log(`  ${r.name.padEnd(24)} 0x${r.lo.toString(16).toUpperCase()}..0x${(r.hi - 1).toString(16).toUpperCase()}  ${(r.c / gsFrames).toFixed(0).padStart(7)} т/кадр  ${(100 * r.c / gsFrames / 59904).toFixed(2).padStart(5)}% кадра`);
console.log("");
console.log("НИ РАЗУ НЕ ВЫЗВАНЫ:      " + (never.length ? never.map(m => m.name).join(", ") : "—"));
console.log("ВЫЗЫВАЮТСЯ, НО НИ ОДНОГО ВИДИМОГО ПИКСЕЛЯ НЕ ПОМЕНЯЛИ: " + (dead.length ? dead.map(m => m.name).join(", ") : "—"));
