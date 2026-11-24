// [mummy-zx-a] Покрытие кода: какие байты образа ни разу не исполнялись по сценариям lo_scen.
// node tools/verify/mz_cov.js <rom> <sym> <сценарий,...>  -> непокрытые участки >= MIN байт с метками
"use strict";
const BH = require("./beam_harness.js");
const X = new Uint8Array(65536); let LL = null;
const om = BH.make; BH.make = function (rom, sym) {
  const E = om(rom, sym); const { cpu } = E; LL = E.L;
  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () { X[cpu.pc] = 1; oI(); };
  return E;
};
const { runScenario } = require("./lo_lib.js"); const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, names] = process.argv;
for (const n of names.split(',')) { const s = scenarios().find(x => x.name === n); runScenario(rom, sym, s, { snap: false }); }
const labs = Object.entries(LL).filter(([k, v]) => v >= 0x100 && v < 0x75A5).sort((a, b) => a[1] - b[1]);
const MIN = +(process.env.MIN || 12);
// участок между соседними метками: исполнялся ли хоть один байт
const out = [];
for (let i = 0; i < labs.length; i++) {
  const [k, a] = labs[i]; const b = i + 1 < labs.length ? labs[i + 1][1] : 0x75A5;
  if (b <= a) continue; let any = 0; for (let p = a; p < b; p++) any |= X[p];
  if (!any) out.push([k, a, b - a]);
}
// слить соседние
const m = []; for (const r of out) { const l = m[m.length - 1]; if (l && l[1] + l[2] === r[1]) { l[2] += r[2]; l[3].push(r[0]); } else m.push([r[0], r[1], r[2], [r[0]]]); }
let tot = 0; for (const r of m.filter(r => r[2] >= MIN).sort((a, b) => b[2] - a[2])) { tot += r[2]; console.log(r[1].toString(16), String(r[2]).padStart(5), r[3].slice(0, 8).join(' ')); }
console.log('total', tot);
