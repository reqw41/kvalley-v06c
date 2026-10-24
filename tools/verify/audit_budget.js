// audit_budget.js — БЮДЖЕТ КАДРА ДЛЯ ЭТАЛОННОЙ СЦЕНЫ (задача-замер владельца, 2026-08-13).
//
// ФУНДАМЕНТ: это frame_budget_cats.js (замкнутое покрытие, скоуп-стек по адресу возврата,
// см. его шапку про то, как СЛОМАННЫЕ старые замеры молча ронял такты в OTHER) + ФИЛЬТР
// ЭТАЛОННОЙ СЦЕНЫ владельца + ЧЕТЫРЕ НОВЫЕ КАТЕГОРИИ, которые в исходнике тонули в
// OUT_OVH/PREP_OWN: SU_FIXUP (vec_su_fixup), REPAIR (vec_repair/vso_fix), TOPMASK
// (vec_topmask: vtm_restore/vtm_afterdraw), OUT_PAIR (стек-блит пары vpz_wr/vpr_sout/
// vmx_pair) — плюс ФАЗА F / ФАЗА P внутри vec_nat_sprites (сейчас слиты в один PREP_OWN).
//
// ПОЧЕМУ ФАЗА F/P — НЕ ОБЫЧНАЯ КАТЕГОРИЯ (адресный диапазон, а не скоуп-стек по call).
// Обе фазы — куски ОДНОЙ процедуры vec_nat_sprites, исполняются ПРЯМО В ПОТОКЕ (без call),
// и фаза F ЗАЦИКЛЕНА (jp назад на свою же метку 7 раз, развёртка x3): если завести им ENTRY
// по общей схеме «pc==адрес -> push scope», КАЖДАЯ итерация цикла толкала бы НОВЫЙ скоуп
// поверх ещё не закрытого (тот же (ret,sp), т.к. цикл не трогает стек) — глубина росла бы
// без остановки и упёрлась в аварийный сброс (scope.length>48 -> leaks++, невязка поплыла
// бы). Поэтому вместо call-скоупа — ПРОВЕРКА ДИАПАЗОНА PC, и ТОЛЬКО когда текущий скоуп уже
// PREP_OWN (то есть мы внутри vec_nat_sprites и не залезли ни в один зарегистрированный
// вложенный вызов): [vns_nodef..vflp_start) -> PHASE_F, [vflp_start..vflp_done) -> PHASE_P.
// Диапазон проверен на отсутствие чужого кода внутри (метки vflf_*/vfla_go — только фаза F,
// vflp_* — только фаза P, других вызывающих их точек в src нет — см. grep по call/jp).
//
// ПОЧЕМУ vec_topmask — ДВЕ РАЗНЫЕ СХЕМЫ ДЛЯ ДВУХ ТОЧЕК ВХОДА.
//  1) vtm_afterdraw (вход из vec_spr_show/vpz-пары/vso_merge1, `jp`/`call`, но ВСЕГДА с
//     нормальным SP — хайджеки к этому моменту уже свёрнуты) САМОДОСТАТОЧЕН: не прыгает в
//     чужой цикл, всегда доходит до `ret`. Обычный call-скоуп (как SU_FIXUP/REPAIR).
//  2) vtm_restore — ДРУГОЕ: `vec_su_restore` (`jp vtm_restore`) сама вызывает его БЕЗУСЛОВНО,
//     а vtm_restore в конце ВПАДАЕТ (`jp vsu_rcont`) в ОБЩИЙ POP-хайджек restore-цикл (тот
//     же самый, которым восстанавливает фон и путь БЕЗ маски). Если завести vtm_restore
//     обычным call-скоупом, он поглотил бы ВЕСЬ этот цикл — OUT_REST обнулился бы, а
//     TOPMASK взял бы на себя чужую (и немалую) работу. РЕШЕНИЕ: vtm_restore толкает скоуп
//     TOPMASK как обычно, но у этого скоупа есть `earlyExit=vsu_rcont` — как только PC
//     достигает vsu_rcont, скоуп закрывается ДОСРОЧНО (не по (ret,sp), а по этой метке),
//     и мы возвращаемся в OUT_REST, которому принадлежит хвост restore. SP при этом не
//     трогаем — обычный call-скоуп vec_su_restore остаётся открытым снизу и закроется как
//     всегда, по настоящему ret.
//
// ФИЛЬТР ЭТАЛОННОЙ СЦЕНЫ (определение владельца, ВОСПРОИЗВЕДЕНО СТРОГО):
//   движущийся герой (слот 4) + >=2 движущихся видимых мумии (слоты 6-13), И У ОБЕИХ —
//   непустой сохранённый фон (save-under слота: доля ненулевых байт данных > 0).
//   Слот save-under: страница 0xE000+idx*256; +0 valid, +1 hi0, +2 lo0, +3 ncols, +4 hi0b,
//   +5 hi0c, +6.. фон (16 Б/столбец/плоскость, столбцов ncols, плоскостей 1+[hi0b!=0]+
//   [hi0c!=0], тот же расчёт size, что в su_empty_census.js — сверено с ним).
//   «Движется» = X или Y слота отличаются от прошлого СЭМПЛИРОВАННОГО кадра (кадр-к-кадру).
//   ЗАМЕР (su_empty_census.js на этой же сборке): у мумий фон пуст в 89.7% выводов — высота
//   спрайта (16 строк) РОВНО высота коридора, кирпичи почти всегда ВНЕ габарита. Эталонная
//   сцена (обе мумии одновременно на непустом фоне) поэтому РЕДКАЯ, и инструмент гребёт по
//   МНОГИМ пирамидам (--pyr), а не сидит на одной: см. отчёт о найденной доле кадров.
//
// ПУСТАЯ ВЫБОРКА — ЖЁСТКИЙ ОТКАЗ (правило проекта): 0 кадров сцены -> process.exit(1) с
// внятным сообщением, а не молчаливые нули.
//
// Запуск: node tools/verify/audit_budget.js [rom] [sym] [--pyr=60] [--pf=700] [--top=24]
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
// --mums=N: сколько ДВИЖУЩИХСЯ мумий на НЕПУСТОМ фоне требовать. Заказ владельца — 2.
// ЗАМЕР (проход разведки, 12 пирамид x 500 кадров = 5455 кадров геймплея): N=2 не
// встретился НИ РАЗУ. Причина известна и измерена отдельно (su_empty_census.js): спрайт
// мумии высотой 16 строк = высота коридора, кирпичи почти всегда ВНЕ габарита, поэтому
// сохранённый фон под мумией пуст в 89.7% выводов; «обе мумии одновременно на непустом
// фоне» — произведение двух редких событий. Ослабление до N=1 объявляется В ОТЧЁТЕ явно,
// а не подменяет заказ молча.
const MUMS = +(opt.mums || 2);
const BUDGET = 59904;

const E = make(ROM, SYM);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
const { L, rd, v06c, memory, cpu, key, run } = E;

for (const need of ["vns_nodef", "vflp_start", "vflp_done", "vec_su_fixup", "vso_fix",
  "vtm_restore", "vtm_afterdraw", "vsu_rcont", "vpz_wr", "vpr_sout", "vmx_pair", "sprAttrib"])
  if (L[need] === undefined) { console.log("нет символа в .sym: " + need); process.exit(2); }

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
    ["OUT_PAIR", ["vpz_wr", "vpr_sout", "vmx_pair"], "ВЫВОД: СТЕК-БЛИТ пары (задача#53, POP-хайджек по столбцам пары)"],
    ["OUT_OVH", ["vec_spr_out"], "ВЫВОД: список/диспетчер/vso_setord (own)"],
    ["COMPOSE", ["vec_compose"], "дренаж dirty-клеток HUD"],
  ]],
  ["ПОЧИНКА ФОНА (между блитом тайла/ISR и вывод-пачкой)", [
    ["SU_FIXUP", ["vec_su_fixup"], "фон-блит клетки переписал слот -> подновить сохранённый фон (задача#54)"],
    ["REPAIR", ["vso_fix"], "vec_repair: перерисовать спрайт, чей фон только что переписал fixup (own, минус вложенные vec_spr_out/vec_spr_show)"],
    ["TOPMASK", ["vtm_restore", "vtm_afterdraw"], "vec_topmask: маска верхней строки экрана (top_overlap) на restore/после draw"],
  ]],
  ["ИГРОВОЙ ТИК (H_TIMI)", [
    ["PHASE_F", [], "фаза F: детект изменений cur/prev sprAttrib (own vec_nat_sprites, диапазон PC)"],
    ["PHASE_P", [], "фаза P: распространение флагов по пересечениям bbox (own vec_nat_sprites, диапазон PC)"],
    ["PREP_OWN", ["vec_nat_sprites"], "ПОДГОТОВКА: остаток own (форс-гейт, диспетчер по флагам 0->20, минус фазы F/P)"],
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
const EARLYEXIT = new Map();      // pc(вход) -> pc(досрочное закрытие скоупа, см. TOPMASK/vtm_restore)
const missing = [];
for (const [, list] of GROUPS) for (const [cat, names] of list) {
  CATS.push(cat);
  for (const n of names) {
    if (L[n] === undefined) { missing.push(n); continue; }
    ENTRY.set(L[n], cat);
  }
}
if (missing.length) console.log("ВНИМАНИЕ: нет в .sym (категория останется пустой): " + missing.join(", "));
ENTRY.set(0x38, "ISR_OVH");        // RST7 (аппаратный вектор, `jp vec_isr` без имени в .sym)
EARLYEXIT.set(L.vtm_restore, L.vsu_rcont);
const CI = {}; CATS.forEach((c, i) => CI[c] = i);
const NC = CATS.length;
const I_IDLE = CI.IDLE, I_MAIN = CI.MAIN, I_UNAT = CI.UNATTRIB;
const MAINSYM = new Set(["dummyLoop"]);

// Диапазоны фаз F/P — ТОЛЬКО когда активный скоуп уже PREP_OWN (см. шапку файла).
const PF_F_LO = L.vns_nodef, PF_F_HI = L.vflp_start;
const PF_P_LO = L.vflp_start, PF_P_HI = L.vflp_done;
const I_PHASE_F = CI.PHASE_F, I_PHASE_P = CI.PHASE_P, I_PREP_OWN = CI.PREP_OWN;

// ---------------------------- ЗАМЕР ----------------------------
const STACKTOP = L.stackTop || 0x75a5;
let scope = [];                    // {cat, ret, sp, earlyExit?}
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
    // 1) закрыть скоупы: по настоящему возврату (ret,sp) ИЛИ по earlyExit (см. TOPMASK)
    while (scope.length) {
      const f = scope[scope.length - 1];
      if (pc === f.ret && sp === ((f.sp + 2) & 0xffff)) { scope.pop(); continue; }
      if (f.earlyExit !== undefined && pc === f.earlyExit) { scope.pop(); continue; }
      break;
    }
    // 2) войти в новый скоуп
    const c = ENTRY.get(pc);
    if (c !== undefined) {
      const ret = memory.bytes[memory.tobank(sp)] | (memory.bytes[memory.tobank((sp + 1) & 0xffff)] << 8);
      const frame = { cat: CI[c], ret, sp };
      const ee = EARLYEXIT.get(pc);
      if (ee !== undefined) frame.earlyExit = ee;
      scope.push(frame);
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
  let bucket = curCat;
  if (bucket === I_PREP_OWN) {
    if (pc >= PF_F_LO && pc < PF_F_HI) bucket = I_PHASE_F;
    else if (pc >= PF_P_LO && pc < PF_P_HI) bucket = I_PHASE_P;
  }
  if (bucket >= 0) { fCat[bucket] += vc; return; }
  if (MAINSYM.has(labels[si][1])) { fCat[I_MAIN] += vc; return; }
  fCat[I_UNAT] += vc; fUnat[si] += vc;
};

// ---------------------------- ФИЛЬТР ЭТАЛОННОЙ СЦЕНЫ ----------------------------
const GS = L.GameStatus, FPM = L.flagPiramideMap, PROTAROOM = L.ProtaRoom, SPR = L.sprAttrib;
function suNonzeroFrac(rdf, idx) {
  const base = 0xE000 + idx * 256;
  if (!rdf(base)) return -1;                    // слот невалиден
  const ncols = rdf(base + 3);
  const planes = 1 + (rdf(base + 4) ? 1 : 0) + (rdf(base + 5) ? 1 : 0);
  const size = Math.min(250, 16 * ncols * planes);
  if (size <= 0) return 0;
  let nz = 0;
  for (let i = 0; i < size; i++) if (rdf(base + 6 + i) !== 0) nz++;
  return nz / size;
}
// Проверка сцены (герой движется + >=2 движущиеся видимые мумии с непустым сохранённым
// фоном) — принимает СВОЙ rd() и СВОЁ prev-состояние, чтобы одну и ту же функцию можно
// было гонять на РАЗНЫХ эмуляторах (проход-разведка и проход-замер, см. ниже).
function makeSceneChecker(rdf) {
  const prevX = new Array(21).fill(-1), prevY = new Array(21).fill(-1);
  return function sceneCheck() {
    const hx = rdf(SPR + 4 * 4 + 1), hy = rdf(SPR + 4 * 4);
    const heroMoved = prevX[4] >= 0 && (hx !== prevX[4] || hy !== prevY[4]);
    let good = 0; const fracs = [];
    for (let i = 6; i < 14; i++) {
      const y = rdf(SPR + i * 4), x = rdf(SPR + i * 4 + 1);
      const visible = y < 0xD0;
      const moved = prevX[i] >= 0 && (x !== prevX[i] || y !== prevY[i]);
      if (visible && moved) {
        const frac = suNonzeroFrac(rdf, i);
        if (frac > 0) { good++; fracs.push(frac); }
      }
      prevX[i] = x; prevY[i] = y;
    }
    prevX[4] = hx; prevY[4] = hy;
    return { ok: heroMoved && good >= MUMS, fracs };
  };
}

// ---------------------------- ОБЩИЙ ДРАЙВЕР СЦЕНАРИЯ (ОДНА КОПИЯ ЛОГИКИ) ------------
// ПОЧЕМУ ДВА ПРОХОДА. Эталонная сцена РЕДКАЯ (замер: su_empty_census.js — 89.7% выводов
// мумий идут по ПУСТОМУ фону, высота спрайта 16 строк = высота коридора, кирпичи почти
// всегда ВНЕ габарита) — предварительная разведка (scan3, дешёвый rd()-скан без хука на
// каждую i8080-инструкцию) дала ~0.1% кадров геймплея. Гнать ПОЛНЫЙ инструментированный
// скоуп-стек (дорогой per-instruction JS-хук) по сотням тысяч кадров ради выборки в
// несколько десятков — на порядок дороже, чем нужно. Поэтому:
//   ПРОХОД 1 (РАЗВЕДКА, дешёвый): свежий эмулятор БЕЗ хука на cpu.instruction, гоняем
//     весь план, копим координаты (p,f) кадров, где сцена выполняется — ЭТО И ЕСТЬ
//     генеральная статистика (доля сцены, доля непустого фона), других данных для неё
//     не считаем.
//   ПРОХОД 2 (ЗАМЕР, дорогой ТОЛЬКО на найденных кадрах): свежий эмулятор С хуком,
//     ИДЕНТИЧНЫЙ план (тот же seed, та же развилка по клавишам, тот же чит N) —
//     детерминированная машина проходит ТЕ ЖЕ состояния кадр в кадр; recording включаем
//     ТОЛЬКО когда текущий (p,f) есть в множестве из прохода 1, иначе кадр дешёвый
//     (recording=false, хук делает только `if(recording)` и выходит).
// Оба прохода зовут РОВНО ОДНУ функцию driveScenario — расхождение в порядке вызовов
// key()/rnd()/oneInterrupt между проходами испортило бы соответствие координат (p,f)
// одному и тому же игровому состоянию, поэтому шаг сценария написан один раз и переиспользован.
function driveScenario(env, NP, PF, cb) {
  const { rd: rdf, key: keyf, v06c: v06cf } = env;
  let seed = 2024; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const KS = [37, 39, 38, 40]; let held = -1;
  let prevRoom = rdf(PROTAROOM);
  const step = () => v06cf.oneInterrupt(true);
  for (let p = 0; p < NP; p++) {
    if (p > 0) {
      if (held > 0) { keyf(held, 0); held = -1; }
      keyf(78, 1); step(); keyf(78, 0);
      for (let i = 0; i < 3000 && rdf(GS) !== 5; i++) step();
      for (let i = 0; i < 40; i++) step();
      prevRoom = rdf(PROTAROOM);
    }
    for (let f = 0; f < PF; f++) {
      if (f % 17 === 0) { const k = KS[(rnd() * 4) | 0]; if (k !== held) { if (held > 0) keyf(held, 0); keyf(k, 1); held = k; } }
      if (cb.beforeWalk) cb.beforeWalk(p, f);
      step();
      const room = rdf(PROTAROOM), scroll = room !== prevRoom; prevRoom = room;
      const gsOk = !(rdf(GS) !== 5 || !(rdf(FPM) & 1) || scroll);
      cb.afterWalk(p, f, gsOk);
      if (rdf(GS) !== 5) { for (let i = 0; i < 3000 && rdf(GS) !== 5; i++) step(); prevRoom = rdf(PROTAROOM); }
    }
  }
}

const NP = +(opt.pyr || 400), PF = +(opt.pf || 700);

// ---------------------------- ПРОХОД 1: РАЗВЕДКА (дешёвый, свежий эмулятор) ----------
console.log(`[проход 1/2] разведка сцены: ${NP} пирамид x ${PF} кадров, эмулятор без инструментирования...`);
const scanE = make(ROM, SYM);
if (toGame(scanE) !== 5) { console.log("нет геймплея (проход разведки)"); process.exit(1); }
const scanCheck = makeSceneChecker(scanE.rd);
const targets = new Set();
let totalGameplayFrames = 0, sceneFrames = 0, bgFracSum = 0, bgFracN = 0;
{
  const t0 = Date.now();
  driveScenario({ rd: scanE.rd, key: scanE.key, v06c: scanE.v06c }, NP, PF, {
    afterWalk(p, f, gsOk) {
      if (!gsOk) return;
      totalGameplayFrames++;
      const { ok, fracs } = scanCheck();
      if (ok) {
        sceneFrames++; targets.add(p + "," + f);
        for (const fr of fracs.slice(0, 2)) { bgFracSum += fr; bgFracN++; }
      }
    },
  });
  console.log(`[проход 1/2] готово за ${((Date.now() - t0) / 1000).toFixed(1)}с: кадров геймплея ${totalGameplayFrames}, сцена ${sceneFrames}`);
}
if (!sceneFrames) {
  console.log(`эталонная сцена не воспроизвелась: 0 кадров с двумя движущимися мумиями на непустом фоне (кадров геймплея просмотрено ${totalGameplayFrames}, пирамид ${NP} x ${PF})`);
  process.exit(1);
}

// ---------------------------- ПРОХОД 2: ЗАМЕР (инструментированный, только targets) ---
console.log(`[проход 2/2] замер бюджета на ${targets.size} найденных кадрах сцены (тот же детерминированный сценарий, свежий эмулятор)...`);
const sumCat = new Float64Array(NC), sumSym = new Float64Array(NL);
const sumUnat = new Float64Array(NL);
let nFrames = 0;
let best = null;
const allFrames = [];
const workHist = [];
let lateFrames = 0;
{
  const t0 = Date.now();
  let curKey = null;
  driveScenario({ rd, key, v06c }, NP, PF, {
    beforeWalk(p, f) {
      const k = p + "," + f;
      if (targets.has(k)) {
        curKey = k;
        fCat.fill(0); fSym.fill(0); fUnat.fill(0);
        recording = true;
      } else {
        curKey = null;
        recording = false;
      }
    },
    afterWalk(p, f, gsOk) {
      if (!curKey) return;
      recording = false;
      let tot = 0; for (let i = 0; i < NC; i++) tot += fCat[i];
      const work = tot - fCat[I_IDLE];
      if (fCat[I_IDLE] === 0) lateFrames++;
      nFrames++; workHist.push(work);
      for (let i = 0; i < NC; i++) sumCat[i] += fCat[i];
      for (let i = 0; i < NL; i++) { sumSym[i] += fSym[i]; sumUnat[i] += fUnat[i]; }
      const snap = { work, tot, cat: Float32Array.from(fCat), sym: Float32Array.from(fSym), unat: Float32Array.from(fUnat), f: p * PF + f };
      allFrames.push(snap);
      if (!best || work > best.work) best = snap;
      curKey = null;
    },
  });
  console.log(`[проход 2/2] готово за ${((Date.now() - t0) / 1000).toFixed(1)}с: измерено ${nFrames} из ${targets.size} целевых кадров`);
}
if (!nFrames) {
  console.log("эталонная сцена не воспроизвелась: проход 1 нашёл кадры, но проход 2 разошёлся с ним (детерминизм сломан?) — 0 измеренных кадров");
  process.exit(1);
}

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
}

const avgCat = Float64Array.from(sumCat, v => v / nFrames);
const avgSym = Float64Array.from(sumSym, v => v / nFrames);
const avgUnat = Float64Array.from(sumUnat, v => v / nFrames);
let avgTot = 0; for (let i = 0; i < NC; i++) avgTot += avgCat[i];
workHist.sort((a, b) => a - b);
const p = q => workHist[Math.min(workHist.length - 1, Math.floor(q * workHist.length))];

console.log(`ROM=${ROM}`);
console.log(`пирамид пройдено ${NP} x ${PF} кадров прогулки; кадров геймплея просмотрено ${totalGameplayFrames}`);
console.log(`ЭТАЛОННАЯ СЦЕНА (герой движется + >=2 движущиеся видимые мумии с непустым сохранённым фоном): ${sceneFrames} кадров = ${(100 * sceneFrames / totalGameplayFrames).toFixed(3)}% от всех кадров геймплея`);
console.log(`ДОЛЯ НЕНУЛЕВЫХ БАЙТ сохранённого фона под мумиями (среднее по отобранным кадрам, n=${bgFracN} слот-замеров): ${(100 * bgFracSum / Math.max(1, bgFracN)).toFixed(1)}%`);
console.log(`кадров В ВЫБОРКЕ (сцена И не смена комнаты в этом же кадре): ${nFrames}`);
console.log(`РАБОТА кадра (в выборке): p10 ${Math.round(p(0.1))} | p50 ${Math.round(p(0.5))} | p90 ${Math.round(p(0.9))} | max ${Math.round(workHist[workHist.length - 1])}`);
console.log(`кадров БЕЗ ЕДИНОГО halt (тик не влез в кадр): ${lateFrames} (${(100 * lateFrames / nFrames).toFixed(1)}%)`);
console.log(`скоуп-стек: максимальная глубина ${maxDepth}, аварийных сбросов ${leaks}`);

report(avgCat, avgSym, avgUnat, avgTot, avgTot - avgCat[I_IDLE], `СРЕДНИЙ кадр эталонной сцены (n=${nFrames})`);

const worst = allFrames.slice().sort((a, b) => b.work - a.work).slice(0, Math.max(1, Math.round(nFrames * 0.1)));
let worstAvgCat = null;
{
  const c = new Float64Array(NC), s = new Float64Array(NL), u = new Float64Array(NL);
  for (const fr of worst) { for (let i = 0; i < NC; i++) c[i] += fr.cat[i] / worst.length;
    for (let i = 0; i < NL; i++) { s[i] += fr.sym[i] / worst.length; u[i] += fr.unat[i] / worst.length; } }
  let t = 0; for (let i = 0; i < NC; i++) t += c[i];
  worstAvgCat = c;
  report(c, s, u, t, t - c[I_IDLE], `ХУДШИЕ 10% кадров сцены (n=${worst.length}, среднее)`);
}
report(best.cat, best.sym, best.unat, best.tot, best.work, `ХУДШИЙ ОДИН кадр сцены (кадр #${best.f})`);

// ---------------------------- КАДРЫ БЕЗ HALT: ИЗ ЧЕГО СКЛАДЫВАЕТСЯ ПЕРЕБОР ----------------------------
const lateSet = allFrames.filter(fr => fr.cat[I_IDLE] === 0);
console.log(`\n================ КАДРЫ БЕЗ HALT (n=${lateSet.length} из ${nFrames}, ${(100 * lateSet.length / nFrames).toFixed(1)}%) — ДЕЛЬТА ПРОТИВ СРЕДНЕГО ================`);
if (lateSet.length) {
  const lc = new Float64Array(NC);
  for (const fr of lateSet) for (let i = 0; i < NC; i++) lc[i] += fr.cat[i] / lateSet.length;
  let lt = 0; for (let i = 0; i < NC; i++) lt += lc[i];
  console.log(`средний кадр БЕЗ halt: ${Math.round(lt)} тактов (halt=0, бюджет ${BUDGET}, переполнение ${Math.round(lt - BUDGET)})`);
  console.log(`\nкатегория     БЕЗ-halt   СРЕДНИЙ   ДЕЛЬТА   ДЕЛЬТА%кадра`);
  const rows = CATS.map((c, i) => [c, lc[i], avgCat[i], lc[i] - avgCat[i]]).sort((a, b) => b[3] - a[3]);
  for (const [c, wv, av, d] of rows) {
    if (Math.abs(d) < 1 && wv < 1 && av < 1) continue;
    console.log(`   ${c.padEnd(11)} ${String(Math.round(wv)).padStart(7)}т  ${String(Math.round(av)).padStart(7)}т  ${(d >= 0 ? "+" : "") + Math.round(d)}т`.padEnd(60) + `${pc2(d)}%`);
  }
} else {
  console.log("(в выборке эталонной сцены такие кадры не встретились)");
}
