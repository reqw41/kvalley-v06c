// [mummy-zx] Профиль по меткам: такты внутри vec_nat_sprites (подготовка) и vso_fix (пачка) на сценарии lo_scen.
// node tools/verify/mz_prof.js <rom> <sym> <сценарий> [тиков] -> топ меток (такты/тик)
"use strict";
const BH = require("./beam_harness.js");
BH.toGame = function (E) { const { run, key, rd, L } = E; run(400); key(112, 1); key(114, 1);
  for (let i = 0; i < 640 && rd(L.GameStatus) !== 5; i++) run(1); key(112, 0); key(114, 0);
  for (let i = 0; i < 4000 && rd(L.GameStatus) !== 5; i++) run(1); return rd(L.GameStatus); };
const origMake = BH.make; const H = { prep: new Float64Array(65536), pack: new Float64Array(65536), L: null };
BH.make = function (rom, sym) {
  const E = origMake(rom, sym); const { cpu, memory, L } = E; H.L = L;
  let inN = false, nSp = 0, nRet = -1, inP = false, pSp = 0;
  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    const pc = cpu.pc;
    if (!inP && pc === L.vso_fix) { inP = true; pSp = cpu.sp; }
    if (!inN && !inP && pc === L.vec_nat_sprites) { inN = true; nSp = cpu.sp; nRet = memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8); }
    oI(); const c = cpu.vcycles | 0;
    if (inP) { H.pack[pc] += c; if (cpu.sp > pSp) inP = false; }
    else if (inN) { H.prep[pc] += c; if (cpu.pc === nRet && cpu.sp > nSp) inN = false; }
  };
  return E;
};
const { runScenario } = require("./lo_lib.js");
const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, name, nt] = process.argv;
const s = scenarios().find(x => x.name === name); if (nt) s.ticks = +nt;
const R = runScenario(rom, sym, s, { snap: false });
const g = R.steps.filter(x => x.g !== undefined).length;
const L = H.L; const labs = Object.entries(L).filter(([k, v]) => v >= 0x100 && v < 0x7800).sort((a, b) => a[1] - b[1]);
// группировка по «процедурам»: метки, на которые есть call (грубо — все метки), сворачиваем по префиксу до '_'+2 символа
function lab(pc) { let lo = 0, hi = labs.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (labs[m][1] <= pc) { r = labs[m][0]; lo = m + 1; } else hi = m - 1; } return r; }
const out = {};
for (const [k, arr] of [["prep", H.prep], ["pack", H.pack]]) {
  const by = {}; let tot = 0; for (let pc = 0; pc < 65536; pc++) if (arr[pc]) { const l = lab(pc); by[l] = (by[l] || 0) + arr[pc]; tot += arr[pc]; }
  out[k] = { per_tick: Math.round(tot / g), top: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([l, v]) => [l, Math.round(v / g)]) };
}
console.log(JSON.stringify({ ticks: g, ...out }, null, 0));
