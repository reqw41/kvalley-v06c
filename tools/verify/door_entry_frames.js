#!/usr/bin/env node
// door_entry_frames.js — покадровая съёмка ВХОДА в пирамиду (ворота закрываются за героем).
// Жалоба с железа 2026-08-18: (1) пара точек справа ворот становятся КРАСНЫМИ при входе;
// (2) во время закрытия герой окрашивается в цвет кожи (idx6 вместо idx2 одежды).
// Каждый кадр: PNG + счёт idx6-пикселей внутри bbox героя (по записи слота 4) и вне его.
"use strict";
const fs = require("fs"), path = require("path");
const { make } = require("./beam_harness.js");
const T = __dirname;
const ROM = process.argv[2] || T + "/../../build/kvalley_8c.rom";
const SYM = process.argv[3] || ROM.replace(/\.rom$/, ".sym");
const DIR = T + "/../../docs/door_entry_frames";
fs.mkdirSync(DIR, { recursive: true });

const E = make(ROM, SYM);
const { L, rd, v06c, key, pngFrom, idealBmp } = E;
const runf = n => { for (let i = 0; i < n; i++) v06c.oneInterrupt(true); };

function doorClosing() {
  const base = L.pyramidDoors;
  for (let i = 0; i < 4; i++) {
    if (rd(base + i * 7) === 0xff) continue;
    const st = rd(base + i * 7 + 4);
    if (((st >> 4) & 15) === 5) return st & 15;
  }
  return -1;
}
// idx6-пиксели по fb; возвращает [вН_bbox, вне_bbox, список вне (первые 6)]
function idx6map() {
  const h4 = 0xE400;
  const hi0 = rd(h4 + 0x97), lo0 = rd(h4 + 0x98), nc = rd(h4 + 0x99);
  const c0 = hi0 & 0x1F;
  let inB = 0, outB = 0; const list = [];
  for (let col = 0; col < 32; col++)
    for (let lo = 72; lo <= 255; lo++) {
      const p0 = rd(0x8000 + col * 256 + lo), p1 = rd(0xA000 + col * 256 + lo),
            p2 = rd(0xC000 + col * 256 + lo), p3 = rd(0xE000 + col * 256 + lo) & 0; // p3 слоты — не экран
      const m6 = p1 & p2 & ~p0 & 0xFF;
      if (!m6) continue;
      let bits = 0; for (let b = 0; b < 8; b++) if (m6 & (1 << b)) bits++;
      const inside = nc && col >= c0 && col < c0 + nc && lo >= lo0 && lo < lo0 + 24;
      if (inside) inB += bits; else { outB += bits; if (list.length < 6) list.push(`col=${col} lo=${lo} m=${m6.toString(2)}`); }
    }
  return { inB, outB, list };
}

runf(400);
key(112, 1); key(116, 1);
for (let i = 0; i < 80 && rd(L.GameStatus) !== 4 && rd(L.GameStatus) !== 5; i++) runf(8);
key(112, 0); key(116, 0);
console.log("GS=" + rd(L.GameStatus) + " pyr=" + rd(L.piramideActual));

let n = 0, frames = 0, started = false;
while (frames < 1200) {
  v06c.oneInterrupt(true); frames++;
  const c = doorClosing();
  const gs = rd(L.GameStatus), en = rd(L.statusEntrada);
  if (gs === 4 && en === 1) started = true;
  if (started && (c >= 0 || (gs === 4 && en === 1))) {
    const m = idx6map();
    const name = `f${String(n).padStart(3, "0")}_c${c}`;
    if (n % 4 === 0 || m.inB > 44 || m.outB > 156) pngFrom(idealBmp(), path.join(DIR, name + ".png"));
    console.log(`${name} GS=${gs} en=${en} Y=${rd(L.ProtaY)} X=${rd(L.ProtaX)} idx6 in=${m.inB} out=${m.outB} ${m.list.join(" | ")}`);
    n++;
    if (n > 400) break;
  }
  if (started && gs === 5 && c < 0) { console.log("gameplay, ворота закрыты"); break; }
}
