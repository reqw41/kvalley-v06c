// msx_door_probe.js — разведка: когда в оригинале KV работает дверь (вход/выход) и где она на экране.
"use strict";
const { makeEmu, renderScreen } = require("./msx_door_lib.js");
const A = { GameStatus: 0xE000, subStatus: 0xE001, timer: 0xE003, piramideActual: 0xE054,
  puertaEntrada: 0xE056, puertaSalida: 0xE057, sprAttrib: 0xE0B0, protaAttrib: 0xE0C0,
  statusEntrada: 0xE130, flagEntraSale: 0xE132, protaStatus: 0xE134, sentidoProta: 0xE136,
  ProtaY: 0xE137, ProtaX: 0xE139, pyramidDoors: 0xE1C5, ElemEnProceso: 0xE1F4, flagStageClear: 0xE133 };
const e = makeEmu(process.argv[2]);
const h = x => x.toString(16).padStart(2, "0");
e.runFrames(200); e.press(" "); e.runFrames(60);
let prev = "";
for (let f = 0; f < 4000; f++) {
  const doors = [0, 1, 2, 3].map(i => e.rd(A.pyramidDoors + i * 7 + 4));
  const spr = []; for (let i = 0; i < 8; i++) spr.push([0,1,2,3].map(k => e.rd(A.sprAttrib + i * 4 + k)).map(h).join(""));
  const line = `gs=${h(e.rd(A.GameStatus))}.${h(e.rd(A.subStatus))} pyr=${e.rd(A.piramideActual)} ` +
    `doors=${doors.map(h).join(" ")} entra=${h(e.rd(A.flagEntraSale))} statEnt=${h(e.rd(A.statusEntrada))} ` +
    `prota=${h(e.rd(A.ProtaY))},${h(e.rd(A.ProtaX))} el=${e.rd(A.ElemEnProceso)} clear=${e.rd(A.flagStageClear)} spr=${spr.join("|")}`;
  const key = line.replace(/prota=[^ ]*/, "").replace(/spr=.*/, spr.slice(0, 4).join("|"));
  if (key !== prev) { console.log(`f${String(f).padStart(4)} ${line}`); prev = key; }
  e.runFrames(1);
}
