// [memory-for-speed] Цена сдвига кадра мумии: вызовы vsp_pat с паттерном мумии (0x28-0x33, 0x88-0x93), такты внутри
// vsp_pat (до возврата) по значению сдвига vsp_sh, и сколько таких вызовов на игровой шаг. node ms_mumshift.js <rom> <sym> [сценарии]
"use strict";
const BH = require("./beam_harness.js");
const acc = {}; let LL = null, ticks = 0;
const om = BH.make; BH.make = function (rom, sym) {
  const E = om(rom, sym); const { cpu, memory, L } = E; LL = L; let st = null;
  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    const pc = cpu.pc;
    if (!st && pc === (process.env.LBL ? L[process.env.LBL] : L.vsp_pat)) {
      const p = memory.read((memory.read(L.vec_nsp_ptr, false) | (memory.read(L.vec_nsp_ptr + 1, false) << 8)) + 2, false);
      const mum = (p >= 0x28 && p < 0x34) || (p >= 0x88 && p < 0x94);
      st = { sp: cpu.sp, c: 0, mum, sh: memory.read(L.vsp_sh, false) };
    }
    oI(); if (st) { st.c += cpu.vcycles | 0; if (cpu.sp > st.sp) { if (st.mum) { const k = "sh" + st.sh; const a = acc[k] = acc[k] || { n: 0, t: 0 }; a.n++; a.t += st.c; } st = null; } }
  };
  return E;
};
const { runScenario } = require("./lo_lib.js"); const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, names = "stress,tour1"] = process.argv;
for (const n of names.split(",")) { const R = runScenario(rom, sym, scenarios().find(x => x.name === n), { snap: false }); ticks += R.steps.filter(x => x.g !== undefined).length; }
let N = 0, T = 0; for (const [k, a] of Object.entries(acc).sort()) { N += a.n; T += a.t; console.log(k, "вызовов", a.n, "тактов/вызов", Math.round(a.t / a.n)); }
console.log("всего вызовов мумии", N, "на шаг", (N / ticks).toFixed(2), "тактов на шаг", Math.round(T / ticks), "в среднем на вызов", Math.round(T / N));
