// msx_p1_leaf.js — спрайты ПРАВОЙ СТВОРКИ ворот в момент входа героя в пирамиду 1 (реальная игра).
"use strict";
const L = require("./msx_p1_lib.js");
const { A, MSXNAME } = L;
const h = x => x.toString(16).padStart(2, "0").toUpperCase();
const e = L.makeEmu(process.argv[2]);
L.startRealGame(e, () => {});
const B = L.bases(e);
let gate = null, f = 0;
while (f < 400 && !gate) { e.runFrames(1); f++; gate = L.findGate(e, B); }
e.runFrames(6);
const v = e.vram();
console.log("ВХОД в пирамиду 1: атрибуты спрайтов (Y X паттерн цвет)");
for (let k = 0; k < 6; k++) {
  const a = [0, 1, 2, 3].map(j => v[B.sprAttr + k * 4 + j]);
  console.log(`  плоскость ${k}: Y=$${h(a[0])} X=$${h(a[1])} pat=$${h(a[2])} цвет=${a[3] & 15} (${MSXNAME[a[3] & 15]}) ` +
              (k < 4 ? "<- СТВОРКА ворот" : "<- герой"));
}
for (const p of [0xD8, 0xDC, 0xE0, 0xE4]) {
  console.log(`спрайт-паттерн $${h(p)}:`);
  for (let y = 0; y < 16; y++) {
    const l = v[B.sprPat + p * 8 + y], r = v[B.sprPat + p * 8 + 16 + y];
    console.log("   " + (l.toString(2).padStart(8, "0") + r.toString(2).padStart(8, "0")).replace(/0/g, ".").replace(/1/g, "#"));
  }
}
