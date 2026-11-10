// [mummy-zx] Цена шага по сценариям lo_scen (тот же ввод по номеру тика, что у lo_align):
// такты шага, подготовка спрайтов (vec_nat_sprites), пачка вывода (vso_fix, все глубины ISR),
// кадры на шаг и доля двухкадровых шагов. Старт тиков — как в lo_align (кадр, где GS впервые = 5).
// node tools/verify/mz_measure.js <rom> <sym> <сценарии...>   -> JSON в stdout
"use strict";
const BH = require("./beam_harness.js");
BH.toGame = function (E) { const { run, key, rd, L } = E; run(400); key(112, 1); key(114, 1);
  for (let i = 0; i < 640 && rd(L.GameStatus) !== 5; i++) run(1); key(112, 0); key(114, 0);
  for (let i = 0; i < 4000 && rd(L.GameStatus) !== 5; i++) run(1); return rd(L.GameStatus); };
const origMake = BH.make;
let PACK = null;
BH.make = function (rom, sym) {
  const E = origMake(rom, sym); const { cpu, memory, L } = E;
  const st = { total: 0, n: 0, inP: false, sp: 0, t0: 0, TT: 0 };
  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    const pc = cpu.pc;
    if (!st.inP && pc === L.vso_fix) { st.inP = true; st.sp = cpu.sp; st.t0 = st.TT; }
    oI(); st.TT += cpu.vcycles | 0;
    if (st.inP && cpu.sp > st.sp) { st.inP = false; st.total += st.TT - st.t0; st.n++; }
  };
  PACK = st; return E;
};
const { runScenario } = require("./lo_lib.js");
const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, ...names] = process.argv;
const out = {};
for (const n of names) {
  const s = scenarios().find(x => x.name === n);
  const R = runScenario(rom, sym, s, { snap: false });
  const g = R.steps.filter(x => x.g !== undefined);
  // интервал шага = кадры от старта этого тика до старта следующего
  const iv = []; for (let i = 0; i + 1 < R.steps.length; i++) if (R.steps[i].g !== undefined) iv.push(R.steps[i + 1].f0 - R.steps[i].f0);
  const hist = {}; for (const v of iv) hist[v] = (hist[v] || 0) + 1;
  const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
  out[n] = {
    ticks: g.length, frames: R.framesTotal,
    T_mean: Math.round(mean(g.map(x => x.T))), T_p90: pct(g.map(x => x.T), 0.9),
    prep_mean: Math.round(mean(g.map(x => x.nat))), prep_p90: pct(g.map(x => x.nat), 0.9),
    isr_mean: Math.round(mean(g.map(x => x.isr))),
    pack_per_call: Math.round(PACK.total / Math.max(1, PACK.n)), pack_per_tick: Math.round(PACK.total / Math.max(1, g.length)),
    frames_per_step: +(mean(iv)).toFixed(3), share_2f: +((hist[2] || 0) / Math.max(1, iv.length)).toFixed(3), hist,
  };
  console.error(n, JSON.stringify(out[n]));
}
console.log(JSON.stringify(out));
