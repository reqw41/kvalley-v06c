// lo_cov.js — пробный прогон сценариев на одной сборке: покрытие и скорость стенда.
const { runScenario } = require("./lo_lib.js");
const { scenarios } = require("./lo_scen.js");
const rom = process.argv[2], sym = process.argv[3], only = process.argv[4];
for (const s of scenarios()) {
  if (only && s.name !== only) continue;
  const t0 = Date.now();
  const R = runScenario(rom, sym, s, {});
  const g = R.steps.filter(x => x.g !== undefined);
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  console.log(s.name, "ticks", R.api.gtick, "steps", R.steps.length, "pure", Math.round(mean(g.map(x => x.pure))), "T", Math.round(mean(g.map(x => x.T))), "ms", Date.now() - t0);
  const c = s.cov; c.pyr = [...c.pyr];
  console.log("  ", JSON.stringify(c));
}
