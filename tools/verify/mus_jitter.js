// Ритм музыки по кадрам в записанных сценариях: сколько вызовов updateSound пришлось на каждый кадр.
// node mus_jitter.js <tools/verify> <rom> <sym> <сценарии...>
const TV = process.argv[2];
const BH = require(TV + "/beam_harness.js");
const make0 = BH.make;
let calls = 0, perFrame = null;
BH.make = function (...a) {
  const E = make0(...a);
  const { v06c, cpu, L } = E;
  const US = L.updateSound;
  let cb = v06c.check_breakpoint;
  Object.defineProperty(v06c, "check_breakpoint", {
    get() { return function () { if (cpu.pc === US) calls++; return cb.apply(this, arguments); }; },
    set(f) { cb = f; }, configurable: true,
  });
  const oi = v06c.oneInterrupt.bind(v06c);
  Object.defineProperty(v06c, "oneInterrupt", {
    get() { return function (...b) { const c0 = calls; const r = oi(...b); if (perFrame) perFrame.push(calls - c0); return r; }; },
    set(f) { }, configurable: true,
  });
  return E;
};
BH.toGame = function (E) {
  const { run, key, rd, L } = E; run(400); key(112, 1); key(114, 1);
  for (let i = 0; i < 640 && rd(L.GameStatus) !== 5; i++) run(1); key(112, 0); key(114, 0);
  for (let i = 0; i < 4000 && rd(L.GameStatus) !== 5; i++) run(1); return rd(L.GameStatus);
};
const { runScenario } = require(TV + "/lo_lib.js");
const { scenarios } = require(TV + "/lo_scen.js");
const [, , , rom, sym, ...names] = process.argv;
for (const n of names) {
  const s = scenarios().find(x => x.name === n);
  perFrame = [];
  calls = 0;
  runScenario(rom, sym, s, { snap: false });
  const f = perFrame.slice(600); // без загрузки
  const N = f.length, T = f.reduce((a, b) => a + b, 0);
  const z = f.filter(x => x === 0).length, d = f.filter(x => x >= 2).length;
  // «хромые» места: подряд два кадра без тика; окно 25 кадров (полсекунды) — отклонение числа тиков
  let run2 = 0, cur = 0;
  for (const x of f) { if (x === 0) { cur++; if (cur === 2) run2++; } else cur = 0; }
  const W = 25, dev = [];
  for (let i = 0; i + W <= N; i += W) { let s2 = 0; for (let k = i; k < i + W; k++) s2 += f[k]; dev.push(s2 - W); }
  const ad = dev.map(Math.abs).sort((a, b) => a - b);
  const p = q => ad[Math.min(ad.length - 1, Math.floor(q * ad.length))];
  console.log(JSON.stringify({ scen: n, frames: N, tpf: +(T / N).toFixed(4), zero_pct: +(100 * z / N).toFixed(2), multi_pct: +(100 * d / N).toFixed(2), double_skip: run2, win25_p50: p(0.5), win25_p90: p(0.9), win25_max: ad[ad.length - 1] }));
}
