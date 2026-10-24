#!/usr/bin/env node
// Скорость героя на лестнице (px/с по времени кадров) для сборки: сцена natural не даёт устойчивых
// шагов состояния 3 без нормализации старта, сцена climb не берёт лестницу ни на одной сборке, поэтому
// здесь свой короткий стенд. Пирамида 1, комната 0, vec_god=1. Герой ставится прямой записью в
// безопасной точке (tickMain2, tickInProgress==0) на пол на каждые 4 px по X во всех рядах; зажаты
// «вверх»+«вправо» или «вверх»+«влево»; когда герой хватает лестницу (protaStatus 3), собираются шаги
// с состоянием 3 в начале и в конце и сдвигом по Y ровно 1: сумма |dY| делится на время между стартами шагов.
// Использование: node dbltick_ladder.js rom sym [out.json]
"use strict";
const fs = require("fs");
const { make, toGame } = require("./beam_harness.js");
const [ROM, SYM, OUT] = process.argv.slice(2);
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory, key } = E;
const FR = 59904;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
wr(L.vec_god, 1);
let frames = 0;
const orig = v06c.oneInterrupt.bind(v06c);
v06c.oneInterrupt = (...a) => { const z = orig(...a); frames++; return z; };
const now = () => frames * FR + E.cyc();
const MAP0 = Array.from({ length: 22 * 96 }, (_, i) => rd(L.MapaRAMRoot + i));
const tests = [];
for (let r = 5; r <= 21; r++) for (let X = 8; X < 248; X += 4) for (const dir of [39, 37]) tests.push({ r, X, dir });
let ti = 0, phase = "inject", cur = null, lastTimer = -1, steps = 0, gap = 0;
let prev = null, ladderRuns = 0;
const rows = [];
let runRows = [];
const snap = () => ({ x: rd(L.ProtaX), y: rd(L.ProtaY), st: rd(L.protaStatus), gs: rd(L.GameStatus), t: now() });
function endRun() {
  if (runRows.length >= 8) { rows.push(...runRows); ladderRuns++; }
  runRows = [];
}
function boundary() {
  const tm = rd(L.timer);
  if (phase === "gap") { if (tm === lastTimer) return; lastTimer = tm; if (--gap > 0) return; phase = "inject"; }
  if (phase === "inject") {
    if (ti >= tests.length || ladderRuns >= 6) { phase = "end"; return; }
    cur = tests[ti++];
    for (let i = 0; i < MAP0.length; i++) if (rd(L.MapaRAMRoot + i) !== MAP0[i]) wr(L.MapaRAMRoot + i, MAP0[i]);
    wr(L.ProtaX, cur.X); wr(L.ProtaXdecimal, 0); wr(L.ProtaY, 8 * (cur.r - 2)); wr(L.ProtaRoom, 0); wr(L.protaStatus, 0);
    if (L.objetoCogido !== undefined) wr(L.objetoCogido, 0);
    key(38, 1); key(cur.dir, 1);
    phase = "run"; steps = 0; lastTimer = rd(L.timer); prev = snap(); runRows = [];
    return;
  }
  if (phase === "run") {
    if (tm === lastTimer) return;
    lastTimer = tm; steps++;
    const s = snap();
    // шаг: между двумя последовательными границами; время — между границами (старты следующего шага ~ границе + пауза)
    if (prev.st === 3 && s.st === 3 && prev.gs === 5 && s.gs === 5 && Math.abs(s.y - prev.y) <= 1 && Math.abs(s.x - prev.x) <= 2) runRows.push({ dy: Math.abs(s.y - prev.y), dt: s.t - prev.t });
    else if (runRows.length) { /* серия прервана */ endRun(); }
    prev = s;
    const inLadder = s.st === 3;
    if (steps >= 120 || (steps > 20 && !inLadder && !runRows.length && !rows.length && steps > 40)) {
      key(38, 0); key(cur.dir, 0); endRun(); phase = "gap"; gap = 4; lastTimer = rd(L.timer);
    } else if (steps >= 30 && runRows.length === 0 && prev.st !== 3) {
      key(38, 0); key(cur.dir, 0); phase = "gap"; gap = 4; lastTimer = rd(L.timer);
    } else if (runRows.length >= 24) {
      key(38, 0); key(cur.dir, 0); endRun(); phase = "gap"; gap = 4; lastTimer = rd(L.timer);
    }
  }
}
v06c.check_breakpoint = function () {
  if (cpu.pc === L.tickMain2 && rd(L.tickInProgress) === 0) boundary();
  return false;
};
let guard = 0;
while (phase !== "end" && guard++ < 300000) orig(true), frames++;
v06c.check_breakpoint = () => false;
const px = rows.reduce((a, r) => a + r.dy, 0), cyc = rows.reduce((a, r) => a + r.dt, 0);
// dt между границами конца шага = полный интервал между завершениями шагов
const res = { rom: ROM, tests_run: ti, ladder_runs: ladderRuns, samples: rows.length, pixels: px, cycles: cyc, px_per_s: cyc ? px * FR * 50 / cyc : null, dt_hist: rows.reduce((h, r) => { const k = Math.round(r.dt / FR); h[k] = (h[k] || 0) + 1; return h; }, {}) };
console.log(JSON.stringify(res));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
