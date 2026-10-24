// timer_audit.js — аудит темпа, завязанного на timer: Z80 (WebMSX) против порта. Время в кадрах 50 Гц (у Z80 один
// runFrames(1) = +1 timer; у порта один oneInterrupt). Сценарии делают журнал [кадр, значение] по изменениям.
//   node tools/verify/timer_audit.js z80 <сценарий> | <rom> <sym> <сценарий>  -> строка "RES {json}"
"use strict";
const fs = require("fs");
const mode = process.argv[2];
const scen = mode === "z80" ? process.argv[3] : process.argv[4];
function readSym(p) { const m = {}; for (const l of fs.readFileSync(p, "latin1").split("\n")) { const g = l.match(/^(\S+):\s*equ\s*0*([0-9A-Fa-f]+)h/); if (g) m[g[1]] = parseInt(g[2], 16); } return m; }
let A, rd, wr, frames, hold, boot0;
const pre = process.env.PYR ? +process.env.PYR : 2;
if (mode === "z80") {
  const P = require("../gfx/msx_p1_lib.js");
  const e = P.makeEmu(__dirname + "/../../legacy/msx/kvalley_z80.rom"); A = readSym(__dirname + "/../../legacy/msx/kvalley_src.sym");
  wr = (a, v) => e.m.bus.write(a, v & 255); rd = a => e.rd(a); P.hookKbd(e);
  let f = 0; while (f < 3000 && rd(A.GameStatus) !== 1) { e.runFrames(1); f++; }
  for (let t = 0; t < 40 && rd(A.GameStatus) !== 3; t++) e.tap("SPACE", 6, 4);
  if (scen === "pergamino") { var seqEmu = e; }
  else {
    for (let i = 0; i < 400 && rd(A.GameStatus) <= 4; i++) { wr(A.piramideDest, pre); wr(A.piramideActual, pre); e.runFrames(1); }
    for (let i = 0; i < 4000 && rd(A.GameStatus) !== 5; i++) e.runFrames(1);
    e.runFrames(100);
  }
  frames = n => e.runFrames(n);
  hold = k => { e.setRow8("RIGHT", !!(k & 128)); e.setRow8("LEFT", !!(k & 16)); e.setRow8("UP", !!(k & 32)); e.setRow8("DOWN", !!(k & 64)); e.setRow8("SPACE", !!(k & 1)); };
} else {
  const { boot } = require("./door_pass_lib.js"); const B = boot(process.argv[2], process.argv[3]);
  A = B.L; rd = B.rd; wr = B.wr; const E = B.E; frames = n => { for (let i = 0; i < n; i++) E.run(1); };
  hold = k => { B.st.keys = k; };
}
const log = [];
function watch(name, getter, n, every) { // журнал изменений значения
  let last = null; const out = [];
  for (let t = 0; t < n; t++) { const v = getter(); if (v !== last) { out.push([t, v]); last = v; } frames(1); }
  return out;
}
function hideMummies(keep) { for (let m = 0; m < 4; m++) if (m !== keep) { wr(A.momiaDat + m * 22, 4); wr(A.momiaDat + m * 22 + 6, 3); } }
function hero(y, x, sent) { wr(A.ProtaY, y); wr(A.ProtaX, x); wr(A.ProtaXdecimal, 0); wr(A.ProtaRoom, 1); wr(A.protaStatus, 0); wr(A.sentidoProta, sent); }
const R = {};
if (scen === "trap") { // стена-ловушка: Y по кадрам
  hideMummies(-1); hero(48, 56, 2); wr(A.numMuroTrampa, 1); const p = A.muroTrampaDat;
  [1, 16, 0, 160, 1].forEach((v, i) => wr(p + i, v));
  R.trapY = watch("y", () => rd(p + 1), 600);
} else if (scen === "mwalk") { // мумия: таймер ходьбы (+0x11) и стресс (+0x15) при ходьбе по ровному полу
  hideMummies(0); hero(48, 56, 2); const m = A.momiaDat;
  [0, 8, 2, 56, 0, 20, 1].forEach((v, i) => wr(m + i, v)); // status, control, sentido, Y, Xdec, X, room (пол ряда 8: Y=56)
  wr(m + 0x11, 0x30); wr(m + 0x14, 0); wr(m + 0x15, 0x06);
  R.timer = []; R.stress = []; R.status = []; R.x = []; let lt = -1, ls = -1, lst = -1, lx = -1;
  for (let t = 0; t < 400; t++) { const a = rd(m + 0x11), s = rd(m + 0x15), st = rd(m); if (a !== lt) { R.timer.push([t, a]); lt = a; } if (s !== ls) { R.stress.push([t, s]); ls = s; } if (st !== lst) { R.status.push([t, st]); lst = st; } frames(1); }
  R.x = rd(m + 5);
} else if (scen === "mthink") { // поза «думает»: статус 7, счётчик +0x11 = 3
  hideMummies(0); hero(48, 56, 2); const m = A.momiaDat;
  [7, 0, 1, 56, 0, 20, 1].forEach((v, i) => wr(m + i, v)); wr(m + 0x11, 3); wr(m + 0x14, 0); wr(m + 0x15, 0x06);
  R.timer = watch("t", () => rd(m + 0x11) * 256 + rd(m), 600);
} else if (scen === "knife") { // бросок ножа в стену: статус героя и ножа
  hideMummies(-1); hero(56, 8, 2); wr(A.objetoCogido, 0x10); wr(A.knifesData, 2);
  frames(6); hold(1); frames(14); hold(0);
  R.hero = []; R.knife = []; R.spr = []; let lh = -1, lk = "", lsp = -1;
  for (let t = 0; t < 400; t++) { const h = rd(A.protaStatus); if (h !== lh) { R.hero.push([t, h]); lh = h; }
    let k = []; for (let i = 0; i < 4; i++) k.push(rd(A.knifesData + i * 17)); const ks = k.join(","); const sp = rd(A.knifeAttrib + 2); if (sp !== lsp) { R.spr.push([t, sp]); lsp = sp; } if (ks !== lk) { R.knife.push([t, ks, rd(A.knifesData + 4), rd(A.knifesData + 2)]); lk = ks; } frames(1); }
} else if (scen === "dig") { // кирка: статус героя и agujeroCnt
  hideMummies(-1); hero(56, 8, 2); wr(A.objetoCogido, 0x20);
  frames(6); hold(1); frames(14); hold(0);
  R.hero = []; R.cnt = []; let lh = -1, lc = -1;
  for (let t = 0; t < 400; t++) { const h = rd(A.protaStatus), c = rd(A.agujeroCnt); if (h !== lh) { R.hero.push([t, h]); lh = h; } if (c !== lc) { R.cnt.push([t, c]); lc = c; } frames(1); }
} else if (scen === "gameover") { // пауза game over: GS 7 -> дальше
  hideMummies(0); hero(56, 20, 2); wr(A.Vidas, 1); { const m = A.momiaDat; [0, 0, 2, 56, 0, 20, 1].forEach((v, i) => wr(m + i, v)); }
  R.gs = watch("gs", () => rd(A.GameStatus) * 256 + rd(A.subStatus), 3500);
} else if (scen === "pergamino") { // цвет стрелки на карте
  R.col = []; let lg = -1, lc = -1;
  for (let t = 0; t < 3000; t++) { const g = rd(A.GameStatus), c = rd(A.colorFlechaMap); if (g !== lg) { R.col.push(["gs", t, g]); lg = g; }
    if (c !== lc) { R.col.push([t, c]); lc = c; } if (g === 5) break; frames(1); if (t % 7 === 0 && rd(A.GameStatus) < 3) { } }
}
console.log("RES " + JSON.stringify(R));
