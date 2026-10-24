// Траектория героя и мумий в демо (attract) по тикам логики: для сравнения двух сборок (демо ведёт одиночный doSalto_once).
// Использование: node demo_traj_dump.js rom sym out.json [кадров=9000]
"use strict";
const fs = require("fs");
const { make } = require("./beam_harness.js");
const [ROM, SYM, OUT, NF] = process.argv.slice(2);
const E = make(ROM, SYM); const { L, rd, v06c } = E;
const tr = []; let last = -1, jumps = 0;
for (let f = 0; f < +(NF || 9000); f++) {
  v06c.oneInterrupt(true);
  if (rd(L.tickInProgress) !== 0) continue;
  const t = rd(L.timer);
  if (t === last) continue;
  last = t;
  const gs = rd(L.GameStatus);
  if (rd(L.protaStatus) === 1) jumps++;
  tr.push([gs, rd(L.ProtaRoom), rd(L.ProtaX), rd(L.ProtaY), rd(L.protaStatus), ...[0, 1, 2, 3].map(i => rd(L.momiaDat + i * 22 + 5) + "/" + rd(L.momiaDat + i * 22 + 3) + "/" + rd(L.momiaDat + i * 22))].join(","));
}
fs.writeFileSync(OUT, JSON.stringify({ ticks: tr.length, heroJumpTicks: jumps, tr }));
console.log("ticks", tr.length, "тиков героя в прыжке", jumps);
