// [mummy-zx] Снимки кадров по категориям: мумия на фоне (рядом кирпич/лестница), у героя, у верха, на лестнице.
// Идёт сценарий lo_scen, после каждого тика логики классифицирует мумий в комнате героя,
// на первой встрече категории (после разминки) снимает экран. Тот же сценарий и тики для любой сборки.
// node tools/verify/mz_shots.js <rom> <sym> <outdir> <prefix> [сценарии через запятую]
"use strict";
const BH = require("./beam_harness.js");
BH.toGame = function (E) { const { run, key, rd, L } = E; run(400); key(112, 1); key(114, 1);
  for (let i = 0; i < 640 && rd(L.GameStatus) !== 5; i++) run(1); key(112, 0); key(114, 0);
  for (let i = 0; i < 4000 && rd(L.GameStatus) !== 5; i++) run(1); return rd(L.GameStatus); };
let LAST = null; const om = BH.make; BH.make = function (r, s) { LAST = om(r, s); return LAST; };
const { runScenario } = require("./lo_lib.js");
const { scenarios } = require("./lo_scen.js");
const fs = require("fs");
const [, , rom, sym, out, prefix, list] = process.argv;
fs.mkdirSync(out, { recursive: true });
const want = { contact: [], top: [], stairs: [], open: [] };
const NEED = 2, meta = [];
for (const name of (list || "stress,tour1").split(",")) {
  const s = scenarios().find(x => x.name === name);
  s.ticks = Math.min(s.ticks, 1200);
  const post0 = s.post;
  s.post = (t, api) => {
    post0 && post0(t, api);
    if (t < 30 || t % 7) return;
    const { L, rd } = api; const hy = rd(L.ProtaY), hx = rd(L.ProtaX), room = rd(L.ProtaRoom);
    for (let m = 0; m < 3; m++) {
      const p = L.momiaDat + m * 22; const st = rd(p);
      if (st === 4 || st === 5 || rd(p + 6) !== room) continue;
      if (rd(p + 3) === 0 && rd(p + 5) === 0) continue;   // пустой слот мумии
      const y = rd(p + 3), x = rd(p + 5);
      let cat = null;
      if (Math.abs(y - hy) < 18 && Math.abs(x - hx) < 20) cat = "contact";
      else if (st === 3) cat = "stairs";
      else if (y < 24) cat = "top";
      else cat = "open";
      if (want[cat].length < NEED && !want[cat].includes(name + t)) {
        // снимок после следующего показанного кадра (пачка выводит подготовленное в этом тике)
        LAST.run(2);
        const f = `${out}/${prefix}_${cat}_${want[cat].length + 1}.png`; LAST.png(f);
        want[cat].push(name + t); meta.push({ cat, scen: name, tick: t, mummy: { st, x, y }, hero: { x: hx, y: hy }, file: f });
      }
    }
  };
  runScenario(rom, sym, s, { snap: false });
}
fs.writeFileSync(`${out}/${prefix}_shots.json`, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta.map(m => [m.cat, m.scen, m.tick])));
