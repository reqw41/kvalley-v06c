// [memory-for-speed] Потерянные прерывания: импульс INT пришёл, когда iff=0 (DI) — на Векторе он теряется целиком.
// Считает их по сценариям lo_scen и по ближайшей метке .sym к PC в момент потери.
// node tools/verify/ms_lostint.js <rom> <sym> [сценарии=stress,tour1]
"use strict";
const BH = require("./beam_harness.js");
let lost = 0, frames = 0; const where = {}; let LL = null;
const om = BH.make; BH.make = function (rom, sym) {
  const E = om(rom, sym); const { cpu, v06c, L } = E; LL = L;
  const names = Object.entries(L).filter(([k, v]) => typeof v === "number").sort((a, b) => a[1] - b[1]);
  const near = pc => { let lo = 0, hi = names.length - 1, r = "?"; while (lo <= hi) { const m = (lo + hi) >> 1; if (names[m][1] <= pc) { r = names[m][0]; lo = m + 1; } else hi = m - 1; } return r; };
  // Кадр = вызов oneInterrupt; вход в ISR = PC 0x38. Кадр без входа в ISR — прерывание потеряно; место — PC, где
  // стоял процессор на строке 0 растра (точка импульса в tv.js: raster_line 0, pixel 176) с iff=0.
  let got = 0, atIrq = null;
  const oo = v06c.oneInterrupt.bind(v06c);
  v06c.oneInterrupt = function (u) { got = 0; atIrq = null; const r = oo(u); frames++; if (!got) { lost++; const k = atIrq || "?"; where[k] = (where[k] || 0) + 1; } return r; };
  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () { if (cpu.pc === 0x38) got++; const f = v06c.filler; if (f && f.raster_line === 0 && !cpu.iff && atIrq === null && f.raster_pixel >= 150 && f.raster_pixel <= 200) atIrq = near(cpu.pc); return oI(); };
  return E;
};
const { runScenario } = require("./lo_lib.js"); const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, names = "stress,tour1"] = process.argv;
for (const n of names.split(",")) runScenario(rom, sym, scenarios().find(x => x.name === n), { snap: false });
console.log(`импульсов INT ${frames}, потеряно ${lost}`);
for (const [k, n] of Object.entries(where).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(" ", k, n);
