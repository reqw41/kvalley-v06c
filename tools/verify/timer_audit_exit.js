// timer_audit_exit.js — аудит темпа: время открытия двери-выхода (openCloseExit, timer&0x1F) в кадрах, Z80 против порта.
//   node tools/verify/timer_audit_exit.js z80 | <rom> <sym>     -> JSON {t:[кадры от записи 0x30 до смены старшего полубайта]}
"use strict";
const fs = require("fs");
const mode = process.argv[2];
function readSym(p) { const m = {}; for (const l of fs.readFileSync(p, "latin1").split("\n")) { const g = l.match(/^(\S+):\s*equ\s*0*([0-9A-Fa-f]+)h/); if (g) m[g[1]] = parseInt(g[2], 16); } return m; }
let A, rd, wr, frames; // frames(n): n кадров 50 Гц
if (mode === "z80") {
  const P = require("../gfx/msx_p1_lib.js");
  const e = P.makeEmu(__dirname + "/../../legacy/msx/kvalley_z80.rom"); A = readSym(__dirname + "/../../legacy/msx/kvalley_src.sym");
  wr = (a, v) => e.m.bus.write(a, v & 255); rd = a => e.rd(a); P.hookKbd(e);
  let f = 0; while (f < 3000 && rd(A.GameStatus) !== 1) { e.runFrames(1); f++; }
  for (let t = 0; t < 40 && rd(A.GameStatus) !== 3; t++) e.tap("SPACE", 6, 4);
  for (let i = 0; i < 400 && rd(A.GameStatus) <= 4; i++) { wr(A.piramideDest, 2); wr(A.piramideActual, 2); e.runFrames(1); }
  for (let i = 0; i < 4000 && rd(A.GameStatus) !== 5; i++) e.runFrames(1);
  e.runFrames(100); frames = n => e.runFrames(n);
} else {
  const { boot } = require("./door_pass_lib.js"); const B = boot(mode, process.argv[3]);
  A = B.L; rd = B.rd; wr = B.wr; const E = B.E; frames = n => { for (let i = 0; i < n; i++) E.run(1); };
}
const out = [];
for (let ph = 0; ph < 4; ph++) {
  frames(ph);
  let d = -1; for (let k = 0; k < 4; k++) if (rd(A.pyramidDoors + k * 7) !== 0xff) { d = k; break; }
  const p = A.pyramidDoors + d * 7 + 4; const seq = [];
  wr(p, 0x30); let last = rd(p) >> 4, n = 0; seq.push([0, last]);
  for (let t = 1; t < 1200; t++) { frames(1); const s = rd(p) >> 4; if (s !== last) { seq.push([t, s]); last = s; } if (s >= 4 || s === 0) break; }
  out.push(seq);
}
console.log("RES " + JSON.stringify(out));
