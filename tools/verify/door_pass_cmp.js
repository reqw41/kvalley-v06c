// door_pass_cmp.js <z80.json> <port.json> [out.json] — сравнение исходов прохода двери с допуском в один шаг
// (0.66 px: фаза нажатия относительно кадра у Z80 даёт 31 или 32 шага, порт всегда 32).
// Критерии на каждый сценарий: проход состоялся; падение (сдвиг Y вниз) есть/нет совпадает; X на выходе из
// двери в пределах 1.4 px; если ни тот ни другой не упал — конечный X в пределах 1.4 px.
"use strict";
const fs = require("fs");
const Z = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), V = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const X = s => { if (!s) return null; const [a, b] = s.split(".").map(Number); return a + b / 256; };
let tileEq = 0, finTileEq = 0, noHalf = 0, n = 0, passEq = 0, fallEq = 0, xeOk = 0, finOk = 0, all = 0, maxdx = 0, fallsExtra = 0, fallsMissing = 0;
const bad = [];
Z.forEach((z, i) => {
  const v = V[i]; n++;
  const p = v.pass === z.pass, f = (v.maxDY > 0) === (z.maxDY > 0);
  let xo = true; if (z.pass) { const d = Math.abs(X(v.xe) - X(z.xe)); maxdx = Math.max(maxdx, d); xo = d <= 1.4; }
  let fo = true; if (z.maxDY === 0 && v.maxDY === 0) fo = Math.abs(X(v.fin) - X(z.fin)) <= 1.4;
  if (v.maxDY > 0 && z.maxDY === 0) fallsExtra++;
  if (v.maxDY === 0 && z.maxDY > 0) fallsMissing++;
  if (v.tileAtEnd === z.tileAtEnd) tileEq++; if (v.finTile === z.finTile) finTileEq++; if (v.finBit0 === 0) noHalf++;
  if (p) passEq++; if (f) fallEq++; if (xo) xeOk++; if (fo) finOk++;
  if (p && f && xo && fo && v.tileAtEnd === z.tileAtEnd && v.finTile === z.finTile && v.finBit0 === 0) all++; else bad.push({ d: z.d, dir: z.dir, x: z.x, dec: z.dec, delay: z.delay, z80: [z.xe, z.fin, z.maxDY], port: [v.xe, v.fin, v.maxDY] });
});
const lens = a => [...new Set(a.filter(r => r.pass).map(r => r.len6))].sort((a, b) => a - b);
const spins = a => [...new Set(a.filter(r => r.pass && r.spin >= 0).map(r => r.spin))].sort((a, b) => a - b);
const res = { n, tileAtSpinEndEqual: tileEq, finTileEqual: finTileEq, doorNotSpinningAtEnd: noHalf, passEq, fallEq, xeWithin1step: xeOk, finWithin1step: finOk, allEqual: all, maxdx: +maxdx.toFixed(2), fallsExtra, fallsMissing,
  len6Z80: lens(Z), len6Port: lens(V), spinZ80: spins(Z), spinPort: spins(V), bad: bad.slice(0, 5) };
console.log(JSON.stringify(res));
if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(res, null, 1));
process.exit(all === n ? 0 : 1);
