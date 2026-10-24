// Герой в прыжке влево/вправо у стены: не должен входить в тайл стены и не должен заворачиваться
// через край экрана. Образец — mum_wall_step.js. Гипотеза дефекта (14.10, железо): прыжок даёт
// X±2 за шаг 25 Гц, а chkChocaSalto смотрит боковые стены только при X&7==4 -> при нечётном
// стартовом X проверка не срабатывает ни разу.
//
// Метод. Пирамида 1, комната 0, vec_god=1. Состояние героя ставится прямой записью в безопасной
// точке (pc==tickMain2, tickInProgress==0): X, Y=8*(r-2), статус 0, комната 0. Дальше зажаты
// <- (или ->) и пробел один шаг. Пробы в начале КАЖДОГО исходного тика (pc==runGame) и в конце
// шага (tickMain2 при tickInProgress==0), так что у сборки с двойным тиком проверяется каждый
// исходный тик, а не только граница шага. Стартовые X: все от стены до +48 пикселей, т.е. все
// X&7=0..7 по шесть раз на каждую площадку/пол. Старт засчитывается, только если первый тик
// действительно начал прыжок (статус 1) — иначе герой не стоял на полу.
// Критерий: в каждой пробе зонд героя (слева X+3, справа X+12; по Y: +0, +8, +14 как у
// chkChocaSalto) не стоит в тайле семейства 0x10 глубже принятой остановки (см. penetration);
// |dX| > 8 между пробами в той же комнате / смена комнаты -> заворот через край.
// w — ближайший тайл семейства 0x10 в строках героя (r-2, r-1) на старте: только отбор стартов.
// Использование: node hero_jump_wall.js [rom] [sym]   env: MAXSTEPS, VERBOSE, JSON=путь
"use strict";
const fs = require("fs");
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const ROM = process.argv[2] || "build/kvalley_8c.rom";
const SYM = process.argv[3] || "build/kvalley_8c.sym";
const MAXSTEPS = +(process.env.MAXSTEPS || 60);
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory, key } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
for (const n of ["GameStatus", "tickMain2", "tickInProgress", "runGame", "MapaRAMRoot", "ProtaX", "ProtaY", "ProtaRoom", "protaStatus", "timer", "vec_god"])
  if (L[n] === undefined) { console.log("нет символа " + n); process.exit(2); }
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
wr(L.vec_god, 1);

const tile = (room, row, col) => rd(L.MapaRAMRoot + row * 96 + room * 32 + col);
// строки 0-1 — рамка табло/потолок, в проверке стен не участвуют
const wall = (row, col) => col >= 0 && col < 32 && row >= 2 && row < 22 && (tile(0, row, col) & 0xF0) === 0x10;
const KL = 37, KR = 39, KA = 32;
// Карта комнат на старте стенда: подобранные по пути гемы/ножи правят MapaRAM, и без восстановления
// «стоит ли герой на полу» зависело бы от истории прогонов (у разных сборок она разная).
const MAPN = 22 * 96, MAP0 = Array.from({ length: MAPN }, (_, i) => rd(L.MapaRAMRoot + i));

// Список прогонов: [направление, строка пола r, X]
const tests = [];
for (let r = 3; r <= 21; r++) {
  const rows = [r - 2, r - 1];
  for (const dir of ["L", "R"]) {
    for (let X = 4; X < 252; X++) {
      let w = -1;
      if (dir === "L") {
        for (let c = (X + 3) >> 3; c >= 0 && w < 0; c--) if (rows.some(rr => wall(rr, c))) w = c;
        if (w < 0) continue;
        const d = X - (8 * w + 4);
        if (d < 1 || d > 48) continue;
      } else {
        for (let c = (X + 12) >> 3; c < 32 && w < 0; c++) if (rows.some(rr => wall(rr, c))) w = c;
        if (w < 0) continue;
        const d = (8 * w - 12) - X;
        if (d < 1 || d > 48) continue;
      }
      const ext = [];
      for (let rr = r - 2; rr >= 2 && wall(rr, w); rr--) ext.push(rr);
      for (let rr = r - 1; rr < 22 && wall(rr, w); rr++) if (!ext.includes(rr)) ext.push(rr);
      if (!ext.length) { for (let rr = 2; rr < 22; rr++) if (wall(rr, w) && Math.abs(rr - r) <= 2) ext.push(rr); }
      tests.push({ dir, r, X, w, ext });
    }
  }
}

if (process.env.ONLY) { const keep = new Set(process.env.ONLY.split(",")); for (let i = tests.length - 1; i >= 0; i--) if (!keep.has(tests[i].dir + ":" + tests[i].r + ":" + tests[i].X)) tests.splice(i, 1); }
let gapLeft = 0, cur = null, ti = 0, phase = "inject", tickNo = 0, lastTimer = -1, stepsDone = 0;
const results = [];
let gsLost = 0;
const snap = () => ({ x: rd(L.ProtaX), y: rd(L.ProtaY), room: rd(L.ProtaRoom), st: rd(L.protaStatus) });
function sample() { cur.samples.push(snap()); }
// Зонд вошёл в стену глубже принятой остановки? Принятая остановка прыжка: слева зонд X+3 в крайнем
// (правом) пикселе тайла стены, справа зонд X+12 в первом пикселе. Стена — столбец w, найденный на
// старте в строках героя (r-2, r-1), его вертикальная протяжённость ext = связный отрезок строк
// столбца w с тайлами семейства 0x10 (строки табло 0-1 не берём). Глубина считается, только пока
// какая-либо проба героя по Y (+0, +8, +14, как у chkChocaSalto) лежит в ext: выше стены герой
// может пройти законно. Потолки и уступы над героем сюда не входят — это другой класс проверок.
function penetration(t, s) {
  if (s.room !== 0) return 0;
  if (!t.ext.some(rr => [0, 8, 14].some(dy => ((s.y + dy) & 255) >> 3 === rr))) return 0;
  return t.dir === "L" ? Math.max(0, (8 * t.w + 7) - (s.x + 3)) : Math.max(0, (s.x + 12) - 8 * t.w);
}
function finish() {
  const t = cur;
  t.standing = t.samples.length > 1 && t.samples[1].st === 1;
  t.maxDepth = 0; t.wrap = false; t.roomChange = false; t.firstBad = null;
  if (t.standing) {
    for (let i = 0; i < t.samples.length; i++) {
      const s = t.samples[i];
      if (s.room !== 0) { t.roomChange = true; if (!t.firstBad) t.firstBad = { i, ...s }; }
      if (i > 0 && s.room === t.samples[i - 1].room && Math.abs(s.x - t.samples[i - 1].x) > 8) { t.wrap = true; if (!t.firstBad) t.firstBad = { i, ...s }; }
      const depth = penetration(t, s);
      if (depth > t.maxDepth) t.maxDepth = depth;
      if (depth > 0 && !t.firstBad) t.firstBad = { i, ...s, depth };
    }
    t.fail = t.maxDepth > 0 || t.wrap || t.roomChange;
  }
  t.trace = t.samples.map(q => q.x + "," + q.y + "," + q.st + (q.room ? "," + q.room : "")).join(" ");
  delete t.samples; delete t.ext0;
  if (process.env.TRACE) console.log(t.dir, "r" + t.r, "X" + t.X, "w" + t.w, t.standing ? "" : "НЕ СТОЯЛ", t.trace);
  results.push(t);
}
function boundary() {
  const tm = rd(L.timer);
  if (phase === "run") {
    if (tm === lastTimer) return; // пауза 25 Гц: шага не было
    stepsDone++;
    lastTimer = tm;
    sample();
    if (stepsDone === 1) { key(KA, 0); }
    const s = cur.samples[cur.samples.length - 1];
    const jumped = cur.samples.some(q => q.st === 1);
    const done = stepsDone >= MAXSTEPS || (jumped && s.st === 0 && stepsDone > 3) || (stepsDone === 1 && s.st !== 1 && s.st !== 0);
    if (!done) return;
    key(KL, 0); key(KR, 0); key(KA, 0);
    if (rd(L.GameStatus) !== 5) { gsLost++; }
    finish();
    phase = "gap"; gapLeft = 4; lastTimer = rd(L.timer);   // 4 шага с отпущенными клавишами: у игры должен быть виден фронт пробела
    return;
  }
  if (phase === "gap") {
    const tm2 = rd(L.timer);
    if (tm2 === lastTimer) return;
    lastTimer = tm2;
    if (--gapLeft > 0) return;
    phase = "inject";
  }
  if (phase === "inject") {
    if (ti >= tests.length) { phase = "end"; return; }
    cur = { ...tests[ti++], samples: [] };
    for (let i = 0; i < MAPN; i++) if (rd(L.MapaRAMRoot + i) !== MAP0[i]) wr(L.MapaRAMRoot + i, MAP0[i]);
    wr(L.ProtaX, cur.X); wr(L.ProtaXdecimal, 0); wr(L.ProtaY, 8 * (cur.r - 2)); wr(L.ProtaRoom, 0);
    wr(L.protaStatus, 0);
    if (L.objetoCogido !== undefined) wr(L.objetoCogido, 0); // подобранные по пути нож/кирка превратили бы пробел в бросок/копание
    key(cur.dir === "L" ? KL : KR, 1); key(KA, 1);
    phase = "run"; stepsDone = 0; lastTimer = rd(L.timer);
    sample(); // индекс 0 — старт
  }
}
v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (process.env.DEBUGKEYS && phase === "run" && pc === L.runGame) console.log("  runGame timer", rd(L.timer), "KeyHold", rd(L.KeyHold), "KeyTrigger", rd(L.KeyTrigger), "st", rd(L.protaStatus), "X", rd(L.ProtaX), "Y", rd(L.ProtaY), "tip", rd(L.tickInProgress));
  if (phase === "run" && pc === L.runGame && stepsDone >= 0 && cur.samples.length > 0) {
    // проба перед исходным тиком (для двойного тика ловит и середину шага)
    if (rd(L.tickInProgress) === 1) {
      const s = snap(); const last = cur.samples[cur.samples.length - 1];
      if (s.x !== last.x || s.y !== last.y || s.st !== last.st || s.room !== last.room) cur.samples.push(s);
    }
  }
  // середина шага 25 Гц: вход во второй doSalto_once = состояние после первого полушага (у оригинала 50 Гц это
  // начало следующего тика, там пробу берёт ветка runGame выше)
  if (L.doSalto_once !== undefined && pc === L.doSalto_once && phase === "run" && cur.samples.length > 0 && rd(L.tickInProgress) === 1) {
    const s = snap(); const last = cur.samples[cur.samples.length - 1];
    if (s.x !== last.x || s.y !== last.y || s.st !== last.st || s.room !== last.room) cur.samples.push(s);
  }
  if (pc === L.tickMain2 && rd(L.tickInProgress) === 0) boundary();
  return false;
};
let guard = 0;
while (phase !== "end" && guard++ < 400000) { v06c.oneInterrupt(true); }
v06c.check_breakpoint = () => false;

// отчёт
const cov = {}, fails = [];
for (const t of results) {
  const kind = t.r >= 19 ? "пол" : "площадка";
  const k = t.dir + "/" + kind;
  cov[k] = cov[k] || { res: Array(8).fill(0), fail: Array(8).fill(0), n: 0, skipped: 0 };
  if (!t.standing) { cov[k].skipped++; continue; }
  cov[k].n++; cov[k].res[t.X & 7]++;
  if (t.fail) { cov[k].fail[t.X & 7]++; fails.push(t); }
}
console.log("GameStatus!=5 после тестов:", gsLost);
console.log("тестов", results.length, "стартов-прыжков", results.filter(t => t.standing).length, "не стояли", results.filter(t => !t.standing).length);
let miss = [];
for (const k of Object.keys(cov).sort()) {
  const c = cov[k];
  console.log(k.padEnd(12), "n=" + String(c.n).padStart(4), "пропуск=" + c.skipped, "по X&7:", c.res.join(","), "ПРОХОД СКВОЗЬ:", c.fail.join(","));
  c.res.forEach((v, i) => { if (!v) miss.push(k + " X&7=" + i); });
}
for (const d of ["L", "R"]) for (const kd of ["пол", "площадка"]) if (!cov[d + "/" + kd]) miss.push(d + "/" + kd + " (нет сценариев)");
const failX = {};
for (const t of fails) { const k = t.dir + " r" + t.r; (failX[k] = failX[k] || []).push(t.X); }
for (const k of Object.keys(failX)) console.log("  fail " + k + " X=" + failX[k].join(","));
if (process.env.VERBOSE) for (const t of fails.slice(0, 20)) console.log("  ", JSON.stringify(t));
const res = { rom: ROM, tests: results.length, standing: results.filter(t => t.standing).length, coverage: cov, failures: fails.map(t => ({ dir: t.dir, row: t.r, X: t.X, Xand7: t.X & 7, wallCol: t.w, maxDepth: t.maxDepth, wrap: t.wrap, roomChange: t.roomChange, first: t.firstBad, trace: t.trace })), all: results.map(t => ({ dir: t.dir, row: t.r, X: t.X, wallCol: t.w, standing: t.standing, fail: !!t.fail, trace: t.trace })), uncovered: miss };
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(res, null, 1));
console.log("всего проходов сквозь стену:", fails.length, " по стартовым X&7:", [0, 1, 2, 3, 4, 5, 6, 7].map(i => fails.filter(t => (t.X & 7) === i).length).join(","));
if (!results.some(t => t.standing)) { console.log("FAIL пустая выборка"); process.exit(1); }
if (miss.length) { console.log("NO COVERAGE:", miss.join("; ")); process.exit(3); }
// Эталон — оригинал 50 Гц (сборка 85a7d11^, тот же стенд): 22 старта, родные огрехи Konami (потолок/уступ у края
// прыжка), которые не правим. Гейт зелёный, если проходов не больше эталона и каждый проход — старт из эталона.
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, "ref", "hero_jump_wall_orig50.json"), "utf8"));
const refKeys = new Set(REF.failures.map(f => f.dir + ":" + f.row + ":" + f.X));
const extra = fails.filter(t => !refKeys.has(t.dir + ":" + t.r + ":" + t.X));
console.log("эталон оригинала 50 Гц:", refKeys.size, "проходов; сверх эталона:", extra.length, "(" + extra.map(t => t.dir + t.r + "/X" + t.X).slice(0, 12).join(" ") + ")");
if (fails.length > refKeys.size || extra.length) { console.log("FAIL герой прошёл сквозь стену чаще оригинала 50 Гц"); process.exit(1); }
console.log("OK");
process.exit(0);
