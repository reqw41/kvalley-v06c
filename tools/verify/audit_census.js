// audit_census.js — ПЕРЕПИСЬ ЦЕНЫ И ЧАСТОТЫ СРАБАТЫВАНИЯ механизмов рендера (замер, БЕЗ
// правок игрового кода).
//
// ЧТО СЧИТАЕТ (три части отчёта):
//  (1) по каждой процедуре из списка ниже: сколько раз вызвана, сколько тактов суммарно
//      (полная стоимость вызова, бракетинг вход/выход по SP — как в burst_cost.js/beam_ab.js,
//      НЕ self-time), avg/p50/p90/max тактов на вызов, и сколько вызовов «завершились
//      впустую» — по критерию, определённому ЧТЕНИЕМ КОДА для каждой процедуры отдельно
//      (см. таблицу WASTE-КРИТЕРИЕВ в шапке PROCS ниже).
//  (2) покрытие 0x0100..0x7600: список меток, чьё тело (адрес до адреса следующей метки)
//      НИ РАЗУ не исполнилось, с размером тела в байтах, отдельно по файлам vec_topmask.asm,
//      vec_repair.asm, vec_sprout.asm, vec_sprites.asm, vec_saveunder.asm. Метки, чьё тело
//      целиком ДАННЫЕ (db/dw — определяется по build/kvalley_8c.lst, а не гаданием),
//      исключены из «мёртвого КОДА» и показаны отдельно.
//  (3) счётчики частот событий за прогон.
//
// МЕТКИ ИЗ ЗАДАНИЯ, КОТОРЫХ НЕТ В .sym (проверено, не выдумано): vec_repair (файл
// vec_repair.asm, но метки с таким именем нет — реальные точки входа vso_fix/vfr_gate,
// вошли в перепись напрямую), vec_topmask (файл vec_topmask.asm, метки нет — реальные точки
// входа vtm_*, ни одна не значится в задании поимённо, поэтому НЕ измеряется отдельной
// строкой; её мёртвый код всё равно виден в части (2), т.к. она сканируется целиком по
// файлу), vsz_mcol (в коде когда-то было такое имя — см. комментарии-история в
// vec_sprout.asm, сейчас функциональность разошлась по vsz_merge/vpz_wr, ни одна не
// называется vsz_mcol буквально).
//
// Запуск:
//   node tools/verify/audit_census.js [rom] [sym] [минимум_тиков=1500]
//
// ПУСТАЯ ВЫБОРКА ОБЯЗАНА ВАЛИТЬ ИНСТРУМЕНТ (ненулевой код возврата): если toGame() не
// довёл до GameStatus=5, если суммарный тик-бюджет вышел меньше заявленного, или если ни
// одна из обязательных сцен (GS 4/5/9/10) не встретилась — process.exit(2) с сообщением.
"use strict";
const fs = require("fs"), path = require("path");
const { make, toGame } = require("./beam_harness.js");

const T = __dirname;
const ROM = process.argv[2] || T + "/../../build/kvalley_8c.rom";
const SYM = process.argv[3] || T + "/../../build/kvalley_8c.sym";
const MINTICKS = +(process.argv[4] || 1500);
if (!(MINTICKS >= 1)) { console.error("минимум тиков должен быть >= 1"); process.exit(2); }

const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory, key } = E;

function need(names) {
  const miss = names.filter(n => L[n] === undefined);
  if (miss.length) { console.error("нет символов в .sym: " + miss.join(", ")); process.exit(2); }
}
need([
  "vec_isr", "vec_isr_depth", "vsp_rdy", "vsp_fast", "vsp_n", "vfr_need", "vsu_any",
  "vns_defer", "vns_full", "vop_i1", "vpr_at", "vpr_mix", "vpr_sl", "vec_nsp_idx", "vsu_lo",
  "vec_snd_mode", "vtm_have", "GameStatus", "timer", "updateSound", "vfla_go", "vso_rloop",
  "vec_spr_out", "vso_fix", "vec_spr_prep", "vec_spr_show", "vso_merge1", "vec_su_save",
  "vec_su_restore", "vfr_gate", "vec_su_fixup", "vsp_fastmark", "vso_sortord", "vpr_scan",
  "vmx_check", "vmx_pair", "vpr_sout", "vpz_wr", "vpz_pair", "vsc_leaf", "vec_nat_sprites",
  "vso_fastall", "vsb_mcol", "vsb_mrow", "vclp", "vsu_scw", "vsnd_tick", "vsnd_sample",
  "vec_vi_ch", "Vidas", "objetoCogido", "IDcuchilloCoge", "knifesData",
  "piramideActual",
]);
const HAVE_REPAIR = L.vec_repair !== undefined;      // ожидаем false — см. шапку
const HAVE_TOPMASK = L.vec_topmask !== undefined;     // ожидаем false
const HAVE_VSZMCOL = L.vsz_mcol !== undefined;        // ожидаем false

// ============================== ЧАСТЬ 0: адрес -> метка (для покрытия) ====================
const LO = 0x0100, HI = 0x7600;
const marks = [];
for (const k in L) { const a = L[k]; if (a >= LO && a < HI) marks.push([a, k]); }
marks.sort((x, y) => x[0] - y[0]);
// тело метки = [addr, nextAddr), nextAddr = адрес следующей ПО АДРЕСУ метки (клип HI)
function bodyEnd(i) { return i + 1 < marks.length ? Math.min(marks[i + 1][0], HI) : HI; }

// --- классификация байт КОД/ДАННЫЕ по build/kvalley_8c.lst (db/dw -> данные) -------------
const LST = T + "/../../build/kvalley_8c.lst";
const isData = new Uint8Array(HI - LO); // 1 = байт положен директивой db/dw (не инструкция)
{
  const txt = fs.readFileSync(LST, "latin1").split("\n");
  let dataLineNo = null; // номер исходной строки, чьи байты — данные (для строк-продолжений)
  for (const line of txt) {
    const parts = line.split("\t");
    const head = parts[0] || "";
    const mh = head.match(/^(\d+)\+?\s+([0-9A-Fa-f]{4})\s*([0-9A-Fa-f ]*)/);
    if (!mh) continue;
    const lineNo = +mh[1], addr = parseInt(mh[2], 16);
    const hexbytes = mh[3].replace(/\s+/g, "");
    const nbytes = (hexbytes.length / 2) | 0;
    const mnem = (parts[1] || "").trim().toLowerCase();
    let dataHere = false;
    if (mnem === "db" || mnem === "dw" || mnem === "ds") { dataHere = true; dataLineNo = lineNo; }
    else if (mnem) { dataLineNo = null; } // настоящая инструкция — сброс продолжения
    else if (nbytes > 0 && dataLineNo === lineNo) { dataHere = true; } // хвост db/dw-строки
    if (dataHere && nbytes > 0 && addr >= LO && addr < HI) {
      for (let i = 0; i < nbytes && addr + i < HI; i++) isData[addr + i - LO] = 1;
    }
  }
}

// --- метка -> файл, для пяти файлов задания (по факту определения `^label:` в исходнике) --
const TARGET_FILES = ["vec_topmask.asm", "vec_repair.asm", "vec_sprout.asm", "vec_sprites.asm", "vec_saveunder.asm"];
const labelFile = new Map();
for (const fn of TARGET_FILES) {
  const p = T + "/../../src/v06c/" + fn;
  const src = fs.readFileSync(p, "latin1").split("\n");
  for (const line of src) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (m) labelFile.set(m[1], fn);
  }
}

// покрытие исполненных адресов (полностью отдельно от переписи процедур — снимается ВСЕГДА)
const coverage = new Uint8Array(HI - LO);

// ============================== ЧАСТЬ 1: процедуры ==========================================
// WASTE-РЕЖИМЫ (определены ЧТЕНИЕМ КОДА, см. отчёт ниже за подробным разбором каждой):
//  entry   — предикат читает память/регистры В МОМЕНТ ВХОДА (до того как тело успело
//            что-то поменять) и оценивает ТОТ ЖЕ гейт, что стоит первым в процедуре;
//  exit    — предикат читает память РОВНО в момент выхода (для vmx_check — это единственный
//            надёжный способ, т.к. отказ может случиться и в середине процедуры);
//  witness — «пусто», если за время вызова PC ни разу не заглянул в один из адресов,
//            которые лежат ТОЛЬКО на продуктивном пути (после всех гейтов);
//  linked  — «пусто» вычисляется гейтом ДРУГОЙ процедуры (vfr_gate), в которую этот вызов
//            проваливается (vso_fix зовёт vec_spr_out, потом falls through в vfr_gate);
//  const0/const1 — гейта нет вовсе: вызывается ТОЛЬКО когда вызывающий уже доказал годность
//            (const0), либо процедура — мёртвый стаб (const1, всегда `ret`, см. vec_compose).
const slotAddr = () => 0xE000 + (rd(L.vec_nsp_idx) & 0xff) * 256;

const PROCS = [
  { name: "vec_spr_out", addr: L.vec_spr_out, mode: "witness", witness: [L.vso_rloop, L.vso_fastall],
    note: "впустую = ret по vsp_rdy!=1 ИЛИ ret по vsp_n==0 (список либо не готов, либо пуст)" },
  { name: "vso_fix", addr: L.vso_fix, mode: "linked",
    note: "впустую = тот же гейт, что у vfr_gate (vso_fix проваливается в него по di/fallthrough)" },
  { name: "vec_spr_prep", addr: L.vec_spr_prep, mode: "entry",
    sample: () => { const a = ((cpu.h << 8) | cpu.l) & 0xffff; const y = rd(a); return ((y + 0x30) & 0xff) < 0x20; },
    note: "впустую = координата Y объекта в зоне парковки 0xD0..0xEF (скрыт, pending=2 — тело идёт в vsp_hide)" },
  { name: "vec_spr_show", addr: L.vec_spr_show, mode: "entry", sample: () => rd(slotAddr() + 0x99) === 0,
    note: "впустую = ncols==0 в записи вывода слота (страховка «слот не заполнен», см. vss_nomask/ret z)" },
  { name: "vso_merge1", addr: L.vso_merge1, mode: "entry", sample: () => rd(slotAddr() + 0x99) === 0,
    note: "впустую = ncols==0 (страховка от петли на 256 столбцов, ret z в самом начале)" },
  { name: "vec_su_save", addr: L.vec_su_save, mode: "entry", sample: () => rd(slotAddr() + 0x96) >= 2,
    note: "впустую = pending>=2 (объект скрыт/дубль) — уходит в vsu_hide, фон не снимается" },
  { name: "vec_su_restore", addr: L.vec_su_restore, mode: "entry", sample: () => rd(slotAddr() + 0x00) === 0,
    note: "впустую = слот невалиден (valid==0) — ret z в самом начале" },
  { name: "vfr_gate", addr: L.vfr_gate, mode: "entry",
    sample: () => (rd(L.vsp_rdy) !== 0) || (rd(L.vfr_need) === 0),
    note: "впустую = vsp_rdy!=0 (список ещё не выведен) ИЛИ vfr_need==0 (чинить нечего) — из задания" },
  { name: "vec_su_fixup", addr: L.vec_su_fixup, mode: "entry", sample: () => rd(L.vsu_any) === 0,
    note: "впустую = vsu_any==0 (валидных слотов нет) — из задания" },
  { name: "vsp_fastmark", addr: L.vsp_fastmark, mode: "entry",
    sample: () => (rd(L.vop_i1) !== 0) || (rd(L.vsp_n) === 0) || (rd(L.vsp_n) >= 8),
    note: "впустую = один из трёх ранних ret (непрозрачный герой / пустой список / >=8 объектов) — решение остаётся старым путём" },
  { name: "vso_sortord", addr: L.vso_sortord, mode: "entry", sample: () => rd(L.vsp_n) === 0,
    note: "впустую = vsp_n==0 (петля пустой сортировки, ret z)" },
  { name: "vpr_scan", addr: L.vpr_scan, mode: "entry", sample: () => rd(L.vsp_n) < 2,
    note: "впустую = vsp_n<2 (меньше двух объектов — паре взяться неоткуда, ret z до цикла)" },
  { name: "vmx_check", addr: L.vmx_check, mode: "exit", sample: () => rd(L.vpr_mix) === 0xFE,
    note: "впустую = vpr_mix остался 0xFE (пара не найдена/не годна) — из задания, читается РОВНО в момент выхода" },
  { name: "vmx_pair", addr: L.vmx_pair, mode: "const0",
    note: "гейта нет: вызывающий (vec_spr_out) уже проверил vpr_mix!=0xFE и vpr_sl==0 — впустую не бывает по построению" },
  { name: "vpr_sout", addr: L.vpr_sout, mode: "witness", witness: [L.vec_spr_show],
    note: "впустую = ни разу не позвал vec_spr_show (обе половины пары скрыты, pending=2 -> vps_nd); restore/save всё равно отрабатывают" },
  { name: "vpz_wr", addr: L.vpz_wr, mode: "const0",
    note: "гейта нет: общий хвост стек-блита, вызывается только когда фон под объектом доказанно нулевой (vpz_ok==2)" },
  { name: "vpz_pair", addr: L.vpz_pair, mode: "const0",
    note: "гейта нет: вызывается только когда vpz_ok==2 для ОБЕИХ половин пары (см. vpr_wr)" },
  { name: "vsc_leaf", addr: L.vsc_leaf, mode: "const0",
    note: "гейта нет: вызывается только когда признак заливки створки (+0xD3) взведён" },
  { name: "vec_nat_sprites", addr: L.vec_nat_sprites, mode: "witness", witness: [L.vfla_go],
    note: "впустую = фаза F не нашла ни одного изменившегося флага (vfl_any==0) -> vsp_n=0, ret до фазы P и цикла подготовки" },
  { name: "vso_fastall", addr: L.vso_fastall, mode: "const0",
    note: "гейта нет: вызывается только когда vsp_fast!=0 (решение принято тиком заранее), список заведомо непуст" },
  { name: "vsb_mcol", addr: L.vsb_mcol, mode: "const0", note: "внутренний писатель столбца, гейта нет" },
  { name: "vsb_mrow", addr: L.vsb_mrow, mode: "const0", note: "внутренний писатель строки, гейта нет" },
  { name: "vclp", addr: L.vclp, mode: "entry", sample: () => rd(L.vsu_lo) <= 248,
    note: "впустую = lo0<=248 (габарит не заходит в зазор над полем, клип не нужен) — ret в начале" },
  { name: "vsu_scw", addr: L.vsu_scw, mode: "const0",
    note: "гейта нет: вызывается только когда lo0>=241 доказан вызывающим (vsu_sc_e)" },
  { name: "vsnd_tick", addr: L.vsnd_tick, mode: "witness", witness: [L.updateSound],
    note: "впустую = НЕ дошёл до updateSound за этот вызов (кадр музыки ещё не накопился, либо часы «молчат» и переносят остаток)" },
  { name: "vsnd_sample", addr: L.vsnd_sample, mode: "entry", sample: () => rd(L.vtm_have) === 0,
    note: "впустую = vtm_have==0 (часов ВИ53 нет — замер накопителя не идёт), ret z в начале" },
  { name: "vec_vi_ch", addr: L.vec_vi_ch, mode: "const0",
    note: "пишется только с WRTPSG на чипе ВИ53 — впустую не входит" },
];
for (const p of PROCS) { p.calls = 0; p.total = 0; p.waste = 0; p.durs = []; }
const nameToIdx = new Map(PROCS.map((p, i) => [p.name, i]));
const vsoFixIdx = nameToIdx.get("vso_fix");

const entryByAddr = new Map();
PROCS.forEach((p, i) => { if (entryByAddr.has(p.addr)) throw new Error("дублирующийся адрес у " + p.name); entryByAddr.set(p.addr, i); });
const witnessByAddr = new Map();
PROCS.forEach((p, i) => { if (p.mode === "witness") for (const w of p.witness) {
  if (!witnessByAddr.has(w)) witnessByAddr.set(w, []); witnessByAddr.get(w).push(i);
}});

const openFrames = [];
function finalizeFrame(f) {
  const pr = PROCS[f.p];
  pr.total += f.cur; pr.durs.push(f.cur);
  let waste;
  if (pr.mode === "entry") waste = !!f.entryWaste;
  else if (pr.mode === "witness") waste = !f.witnessHit;
  else if (pr.mode === "exit") waste = !!pr.sample();
  else if (pr.mode === "const0") waste = false;
  else if (pr.mode === "const1") waste = true;
  else if (pr.mode === "linked") waste = !!f.customWaste;
  if (waste) pr.waste++;
  if (pr.name === "vec_spr_out" && !waste) {
    packNonWaste++;
    if (rd(L.vsp_fast) !== 0) packFast++;
    const d = rd(L.vec_isr_depth);
    if (d >= 2) packDepthGE2++; else packDepth1++;
  }
}

// ============================== ЧАСТЬ 3: счётчики событий ===================================
let irqFrames = 0, irqRdy2 = 0;
let packNonWaste = 0, packFast = 0, packDepthGE2 = 0, packDepth1 = 0;
let prevFN = 0, armFN = 0, prevSA = 0, armSA = 0, prevVD = 0, armVD = 0, prevVF = 0, armVF = 0;

v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (pc >= LO && pc < HI) coverage[pc - LO] = 1;

  if (pc === L.vec_isr) { irqFrames++; if (rd(L.vsp_rdy) === 2) irqRdy2++; }

  { const fn = rd(L.vfr_need); if (fn !== 0 && prevFN === 0) armFN++; prevFN = fn;
    const sa = rd(L.vsu_any); if (sa !== 0 && prevSA === 0) armSA++; prevSA = sa;
    const vd = rd(L.vns_defer); if (vd !== 0 && prevVD === 0) armVD++; prevVD = vd;
    const vf = rd(L.vns_full); if (vf !== 0 && prevVF === 0) armVF++; prevVF = vf; }

  const wl = witnessByAddr.get(pc);
  if (wl) for (const idx of wl) for (const f of openFrames) if (f.p === idx) f.witnessHit = true;

  if (pc === L.vfr_gate) {
    const w = (rd(L.vsp_rdy) !== 0) || (rd(L.vfr_need) === 0);
    for (const f of openFrames) if (f.p === vsoFixIdx) f.customWaste = w;
  }

  for (let i = openFrames.length - 1; i >= 0; i--) {
    const f = openFrames[i];
    if (pc === f.ret && cpu.sp > f.sp) { finalizeFrame(f); openFrames.splice(i, 1); }
  }

  const pidx = entryByAddr.get(pc);
  if (pidx !== undefined) {
    const pr = PROCS[pidx];
    const sp = cpu.sp;
    const ret = memory.read(sp, false) | (memory.read(sp + 1, false) << 8);
    const f = { p: pidx, ret, sp, cur: 0, witnessHit: false, customWaste: undefined };
    if (pr.mode === "entry") f.entryWaste = pr.sample();
    openFrames.push(f);
    pr.calls++;
  }
  return false;
};
const oI = cpu.instruction.bind(cpu);
cpu.instruction = function () {
  oI();
  const c = cpu.vcycles | 0;
  for (let i = 0; i < openFrames.length; i++) openFrames[i].cur += c;
};

// ============================== ПРОГОН: несколько сцен =======================================
const gsHist = {};
let totalTicks = 0, totalFrames = 0, prevTimerVal = 0;
function sampleFrame() {
  totalFrames++;
  const gs = rd(L.GameStatus);
  gsHist[gs] = (gsHist[gs] || 0) + 1;
}
function driveTicks(ticks, keysFn) {
  let held = new Set(); const start = totalTicks, end = totalTicks + ticks; let nf = 0;
  prevTimerVal = rd(L.timer);
  while (totalTicks < end && nf < 400000) {
    const want = new Set(keysFn(totalTicks - start));
    for (const c of held) if (!want.has(c)) key(c, 0);
    for (const c of want) if (!held.has(c)) key(c, 1);
    held = want;
    v06c.oneInterrupt(true); nf++; sampleFrame();
    const t = rd(L.timer);
    if (t !== prevTimerVal) { prevTimerVal = t; totalTicks++; }
  }
  for (const c of held) key(c, 0);
}
function idleFrames(n) { for (let i = 0; i < n; i++) { v06c.oneInterrupt(true); sampleFrame(); } }
function pulse(code, down, up) { key(code, 1); idleFrames(down); key(code, 0); idleFrames(up); }

// --- ключи (коды из уже принятых в проекте инструментов: 37=влево,38=вверх,39=вправо,
//     40=вниз, 32=SPACE/прыжок-нож, 78='N', 72='H', 71='G', 68='D', 69='E', 112=F1, 116=F5) ---
function keysMove(t) {                                  // ходьба + прыжки, обе стороны
  const k = []; if (t & 8) k.push(39); else k.push(37);
  if ((t & 31) === 5) k.push(32);
  return k;
}
function keysClimb(t) {                                  // долгие пробеги в одну сторону +
  const k = [];                                           // вверх — переход комнат/лестницы
  const ph = t % 240;
  if (ph < 120) k.push(39); else if (ph < 180) k.push(38); else k.push(37);
  if ((t & 63) === 7) k.push(32);
  return k;
}
function keysKnife(t) {                                  // бросок ножа (тот же приём, что
  const k = [];                                            // в beam_ab.js --knife)
  if ((t & 31) < 16) k.push(39); else k.push(37);
  if ((t & 15) === 3) k.push(32);
  return k;
}

console.log(`ROM=${ROM} SYM=${SYM} минимум тиков=${MINTICKS}`);
console.log(`команда: node tools/verify/audit_census.js ${ROM} ${SYM} ${MINTICKS}`);
const gsAfterStart = toGame(E);
if (gsAfterStart !== 5) { console.error(`toGame() не довёл до GameStatus=5 (получили ${gsAfterStart}) — пустая выборка`); process.exit(2); }
console.log("вход в игру: F1+F5, GameStatus=5 подтверждён\n");

// СЦЕНА 1: низ пирамиды 1 — ходьба и прыжки
driveTicks(600, keysMove);
// СЦЕНА 1b: ВЕРХНЯЯ СТРОКА (нужна для vclp/vsu_scw — клип габарита в зазоре над полем
// срабатывает только при lo0>=249, то есть Y уходит В МИНУС при прыжке из строки Y=8..14).
// Приём — ровно тот, что уже принят в проекте (tools/verify/topjump_shot.js): телепорт
// ProtaY поверх штатного движения (не правка игрового кода, а поза стенда), дальше герой
// прыгает штатной логикой сам.
{
  memory.write(L.ProtaY, 8, false);
  idleFrames(10);
  let held3 = new Set();
  for (let i = 0; i < 900; i++) {
    const want = new Set(); if (i % 20 < 3) want.add(32);
    want.add((i % 120) < 60 ? 39 : 37);
    for (const c of held3) if (!want.has(c)) key(c, 0);
    for (const c of want) if (!held3.has(c)) key(c, 1);
    held3 = want;
    v06c.oneInterrupt(true); sampleFrame();
  }
  for (const c of held3) key(c, 0);
  console.log(`сцена «верхняя строка»: ProtaY сейчас ${rd(L.ProtaY)}, GameStatus ${rd(L.GameStatus)}`);
}
// СЦЕНА 2: нож — форс objetoCogido в руке + импульсы FIRE (приём из beam_ab.js/knife_cost.js)
{
  let held = new Set(); const start = totalTicks, end = totalTicks + 400; let nf = 0;
  prevTimerVal = rd(L.timer);
  while (totalTicks < end && nf < 400000) {
    const want = new Set(keysKnife(totalTicks - start));
    for (const c of held) if (!want.has(c)) key(c, 0);
    for (const c of want) if (!held.has(c)) key(c, 1);
    held = want;
    const st = rd(L.knifesData);
    if (st <= 2) { memory.write(L.objetoCogido, 0x10, false); memory.write(L.IDcuchilloCoge, 0, false); }
    v06c.oneInterrupt(true); nf++; sampleFrame();
    const t = rd(L.timer);
    if (t !== prevTimerVal) { prevTimerVal = t; totalTicks++; }
  }
  for (const c of held) key(c, 0);
}
// СЦЕНА 3: подъём/лестницы — низкая пирамида
driveTicks(500, keysClimb);
// СЦЕНА 3b: ГАРАНТИРОВАННЫЙ СКРОЛЛ (GS=9). Пирамида 1 — один экран (стена раньше порога
// chkScroll, застревание у края бьёт смертью, не скроллом — проверено замером). Пирамида 2
// по src/res/maps/pyramids.txt содержит room=1 (второй экран вправо): чит N переводит на
// неё, бег вправо с прыжками через препятствия доводит ProtaX до порога 0xF4 -> chkScroll3
// ставит GameStatus=9 (подтверждено отдельным прогоном).
{
  pulse(78, 3, 40);
  for (let i = 0; i < 1200 && !(rd(L.piramideActual) === 2 && rd(L.GameStatus) === 5); i++) idleFrames(1);
  memory.write(L.Vidas, 9, false);
  let held2 = new Set(); let scrolled = false;
  for (let i = 0; i < 6000 && !scrolled; i++) {
    const want = new Set([39, ...((i % 40 < 8) ? [32] : [])]);
    for (const c of held2) if (!want.has(c)) key(c, 0);
    for (const c of want) if (!held2.has(c)) key(c, 1);
    held2 = want;
    v06c.oneInterrupt(true); sampleFrame();
    if (rd(L.GameStatus) === 9) scrolled = true;
  }
  for (const c of held2) key(c, 0);
  idleFrames(300);
  console.log(`сцена скролла: пирамида ${rd(L.piramideActual)}, скролл пойман=${scrolled}, GameStatus сейчас ${rd(L.GameStatus)}`);
}
// СЦЕНА 4: чит H — прыжок на дальние пирамиды (несколько раз, до верхних номеров)
for (let i = 0; i < 3; i++) { pulse(72, 3, 90); }
console.log(`после читов H: пирамида ${rd(L.piramideActual)}, GameStatus=${rd(L.GameStatus)}`);
// СЦЕНА 5: верх поздней пирамиды — то же движение, другой набор кирпичей/цветов
driveTicks(500, keysClimb);
driveTicks(300, keysMove);
// СЦЕНА 6: смерть героя читом D (из геймплея, с запасом жизней, чтобы не улететь в game over)
memory.write(L.Vidas, 9, false);
pulse(68, 4, 300);
{ // «воскрешение»: жмём SPACE, пока не вернёмся в GS=5 с flagVivo=1 (приём из cheat_god_death.js)
  let revived = false;
  for (let i = 0; i < 900 && !revived; i++) { key(32, 1); idleFrames(2); key(32, 0); idleFrames(6);
    if (rd(L.GameStatus) === 5) revived = true; }
  console.log(`после чита D: GameStatus=${rd(L.GameStatus)} (воскрешение ${revived ? "удалось" : "НЕ удалось"})`);
}
// СЦЕНА 7: карта долины — короткое ожидание сразу после чита N (штатная точка перехода)
pulse(78, 3, 40);
idleFrames(200);
console.log(`после чита N: GameStatus=${rd(L.GameStatus)}, пирамида ${rd(L.piramideActual)}`);
// добьём немного геймплея, чтобы вернуться в стабильное состояние перед читом E
if (rd(L.GameStatus) !== 5) idleFrames(400);
driveTicks(200, keysMove);
// СЦЕНА 8: финальный экран читом E (допустим из GS 1..8, у нас сейчас 5)
if (rd(L.GameStatus) >= 1 && rd(L.GameStatus) <= 8) {
  pulse(69, 3, 900);
  console.log(`после чита E: GameStatus=${rd(L.GameStatus)}`);
} else {
  console.log(`чит E пропущен: GameStatus=${rd(L.GameStatus)} вне разрешённого диапазона 1..8`);
}
idleFrames(200);

// финализировать незакрытые (на конец прогона) вызовы, чтобы calls/durs совпадали
for (const f of openFrames.slice()) finalizeFrame(f);
openFrames.length = 0;

// ============================== ПРОВЕРКИ ПУСТОЙ ВЫБОРКИ =====================================
if (totalTicks < MINTICKS) {
  console.error(`ПРОВАЛ: прогон дал только ${totalTicks} тиков геймплейного ввода, заявлен минимум ${MINTICKS}`);
  process.exit(2);
}
const REQUIRED_GS = [4, 5, 9, 10];
const missingGS = REQUIRED_GS.filter(gs => !gsHist[gs]);
if (missingGS.length) {
  console.error(`ПРОВАЛ: за прогон не встретились GameStatus ${missingGS.join(",")} — часть заявленных сцен не воспроизвелась`);
  console.error("гистограмма GameStatus (кадров): " + JSON.stringify(gsHist));
  process.exit(2);
}
if (totalFrames === 0 || irqFrames === 0) { console.error("ПРОВАЛ: ноль кадров прерывания за весь прогон"); process.exit(2); }

// ============================== ОТЧЁТ ========================================================
console.log("\n===== СЦЕНЫ (гистограмма GameStatus по кадрам) =====");
console.log("  4=карта 5=геймплей 9=скролл 10=финал (и другие: 1=титул,2=демо?,3=джингл,6..8=смерть/StageClear)");
for (const gs of Object.keys(gsHist).map(Number).sort((a, b) => a - b))
  console.log(`  GS=${gs}: ${gsHist[gs]} кадров`);
console.log(`ВОСПРОИЗВЕДЕНЫ (обязательные): ${REQUIRED_GS.filter(gs => gsHist[gs]).map(gs => `GS=${gs}(${gsHist[gs]})`).join(", ")}`);
console.log(`итого игровых тиков ${totalTicks}, кадров прерывания ${totalFrames}, кадровых IRQ (глубина 0) ${irqFrames}`);

console.log("\n===== ЧАСТЬ 1: ПЕРЕПИСЬ ПРОЦЕДУР =====");
console.log("метка              вызвано  выз/тик   такты-сумма    avg    p50    p90    max  впустую  впустую%");
for (const pr of PROCS) {
  const d = pr.durs.slice().sort((a, b) => a - b);
  const avg = d.length ? pr.total / d.length : 0;
  const p50 = d.length ? d[d.length >> 1] : 0;
  const p90 = d.length ? d[(d.length * 0.9) | 0] : 0;
  const max = d.length ? d[d.length - 1] : 0;
  const perTick = pr.calls / totalTicks;
  const wastePct = pr.calls ? (100 * pr.waste / pr.calls) : 0;
  console.log(`${pr.name.padEnd(18)} ${String(pr.calls).padStart(7)} ${perTick.toFixed(3).padStart(8)} `
    + `${String(pr.total).padStart(13)} ${avg.toFixed(0).padStart(6)} ${String(p50).padStart(6)} `
    + `${String(p90).padStart(6)} ${String(max).padStart(6)} ${String(pr.waste).padStart(8)} ${wastePct.toFixed(1).padStart(7)}%`);
}
console.log("\nкритерии «впустую» по каждой процедуре:");
for (const pr of PROCS) console.log(`  ${pr.name}: ${pr.note}`);
console.log(`\nметки БЕЗ соответствия в .sym (заявлены в задании, отсутствуют — не измерены отдельной строкой):`);
console.log(`  vec_repair: нет метки (файл vec_repair.asm; реальные точки входа vso_fix/vfr_gate — обе выше в переписи)`);
console.log(`  vec_topmask: нет метки (файл vec_topmask.asm; реальные точки входа vtm_* — не названы в задании поимённо, не измерены отдельно, но участвуют в части 2)`);
console.log(`  vsz_mcol: нет метки (функциональность сейчас в vsz_merge/vpz_wr, ни один так не называется)`);

console.log("\n===== ЧАСТЬ 2: ПОКРЫТИЕ 0x0100..0x7600 (мёртвый код) =====");
let totalDeadBytes = 0, totalCodeBytes = 0;
const byFile = new Map(TARGET_FILES.map(f => [f, { dead: [], deadBytes: 0, dataLabels: [] }]));
for (let i = 0; i < marks.length; i++) {
  const [addr, nameLbl] = marks[i];
  const end = bodyEnd(i);
  const len = end - addr; if (len <= 0) continue;
  let dataBytes = 0, hit = false;
  for (let a = addr; a < end; a++) { if (isData[a - LO]) dataBytes++; if (coverage[a - LO]) hit = true; }
  const codeBytes = len - dataBytes;
  const file = labelFile.get(nameLbl);
  if (!file) continue; // метки вне пяти файлов задания в часть 2 не идут
  totalCodeBytes += codeBytes;
  if (codeBytes === 0) { byFile.get(file).dataLabels.push([nameLbl, len]); continue; }
  if (!hit) { byFile.get(file).dead.push([nameLbl, addr, codeBytes, len]); byFile.get(file).deadBytes += codeBytes; totalDeadBytes += codeBytes; }
}
for (const fn of TARGET_FILES) {
  const b = byFile.get(fn);
  console.log(`\n--- ${fn}: мёртвых меток ${b.dead.length}, мёртвых байт кода ${b.deadBytes} ---`);
  b.dead.sort((x, y) => y[2] - x[2]);
  for (const [nm, addr, codeBytes, len] of b.dead)
    console.log(`  0x${addr.toString(16).padStart(4, "0")} ${nm.padEnd(20)} тело ${len} Б (код ${codeBytes} Б)`);
  if (b.dataLabels.length)
    console.log(`  (данные, не код, исключены из счёта: ${b.dataLabels.map(([n, l]) => `${n}(${l}Б)`).join(", ")})`);
}
console.log(`\nИТОГО по пяти файлам задания: код ${totalCodeBytes} Б, из них НЕ исполнилось ни разу: ${totalDeadBytes} Б (${(100 * totalDeadBytes / (totalCodeBytes || 1)).toFixed(1)}%)`);

console.log("\n===== ЧАСТЬ 3: ЧАСТОТЫ СОБЫТИЙ =====");
console.log(`vsp_rdy==2 в момент кадрового IRQ (глубина 0): ${irqRdy2} / ${irqFrames} кадровых IRQ (${(100 * irqRdy2 / irqFrames).toFixed(2)}%)`);
console.log(`пачек (vec_spr_out, непустых): ${packNonWaste}`);
console.log(`  из них слитым путём (vsp_fast!=0): ${packFast} (${packNonWaste ? (100 * packFast / packNonWaste).toFixed(1) : "0.0"}%)`);
console.log(`  из них на вложенном IRQ (vec_isr_depth>=2): ${packDepthGE2} (${packNonWaste ? (100 * packDepthGE2 / packNonWaste).toFixed(1) : "0.0"}%), на глубине 1: ${packDepth1}`);
console.log(`vfr_need взводился (переходы 0->ненулевое): ${armFN} раз (${(armFN / totalFrames).toFixed(4)} на кадр)`);
console.log(`vsu_any взводился: ${armSA} раз (${(armSA / totalFrames).toFixed(4)} на кадр)`);
console.log(`vns_defer взводился: ${armVD} раз (${(armVD / totalFrames).toFixed(4)} на кадр)`);
console.log(`vns_full взводился: ${armVF} раз (${(armVF / totalFrames).toFixed(4)} на кадр)`);

console.log("\nOK");
process.exit(0);
