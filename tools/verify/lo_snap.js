// lo_snap.js — прогон одного сценария и дамп снимков игрового состояния.
// node lo_snap.js <rom> <sym> <сценарий> <out.bin> [тиков]
// Формат: JSON-заголовок + '\n' + подряд снимки одинакового размера.
"use strict";
const fs = require("fs");
const { runScenario } = require("./lo_lib.js");
const { scenarios } = require("./lo_scen.js");
const [rom, sym, name, out, ticks] = process.argv.slice(2);
const s = scenarios().find(x => x.name === name);
if (!s) throw new Error("нет сценария " + name);
if (ticks) s.ticks = +ticks;
const R = runScenario(rom, sym, s, { snap: true });
const g = R.steps.filter(x => x.g !== undefined);
const cov = s.cov; cov.pyr = [...cov.pyr];
const head = { scen: name, n: R.snaps.length, size: R.snaps[0].length, ranges: R.ranges, cov, frames: R.framesTotal,
  pure: g.map(x => x.pure), T: g.map(x => x.T), f0: g.map(x => x.f0) };
fs.writeFileSync(out, Buffer.concat([Buffer.from(JSON.stringify(head) + "\n"), ...R.snaps]));
console.log(name, "ticks", R.snaps.length, "pure_mean", Math.round(head.pure.reduce((a, b) => a + b, 0) / head.pure.length));
