// Сколько тактов от входа в ISR (RST7) до начала пачки вывода (vso_fix): цена шапки, в том числе тика музыки.
// node mus_hdr.js <tools/verify> <rom> <sym>  — геймплей после чит-входа F1+F3, 2500 кадров; печатает JSON.
const BH = require(process.argv[2] + "/beam_harness.js");
const E = BH.make(process.argv[3], process.argv[4]);
const { cpu, L, rd, run, v06c } = E;
let T = 0, t0 = null; const vals = [];
v06c.check_breakpoint = function () { T += cpu.vcycles || 0; if (cpu.pc === 0x38) t0 = T; if (cpu.pc === L.vso_fix && t0 !== null) { vals.push(T - t0); t0 = null; } return false; };
run(400); E.key(112, 1); E.key(114, 1);
for (let i = 0; i < 640 && rd(L.GameStatus) !== 5; i++) run(1);
E.key(112, 0); E.key(114, 0); run(2500);
vals.sort((a, b) => a - b); const q = p => vals[Math.floor(p * vals.length)];
console.log(JSON.stringify({ n: vals.length, p10: q(.1), p50: q(.5), p90: q(.9), mean: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) }));
