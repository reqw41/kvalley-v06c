// msx_p1_entry.js — ЭТАЛОН сцены ВХОДА героя в уровень на ПЕРВОЙ пирамиде (реальная игра, не демо).
// Снимает серию кадров, полную таблицу «map-ID -> паттерн -> 8 байт MSX color table» для блока 5x3
// и покадровую историю тайла/цвета рычага (вопрос про мигание).
// node tools/gfx/msx_p1_entry.js <rom> <outdir>
"use strict";
const fs = require("fs");
const L = require("./msx_p1_lib.js");
const { A, ROM, id2pat, MSXNAME } = L;

const ROMPATH = process.argv[2], OUT = process.argv[3] || "build/msxref2";
fs.mkdirSync(OUT, { recursive: true });
const h = x => x.toString(16).padStart(2, "0").toUpperCase();
const LOG = []; const say = s => { LOG.push(s); process.stdout.write(s + "\n"); };

const e = L.makeEmu(ROMPATH);
L.startRealGame(e, say);
const B = L.bases(e);
say(`VDP: name=$${B.nameBase.toString(16)} color=$${B.colBase.toString(16)} pattern=$${B.patBase.toString(16)} ` +
    `sprAttr=$${B.sprAttr.toString(16)} sprPat=$${B.sprPat.toString(16)} фон=${B.bgIdx}`);

// ждём, пока дверь входа появится на экране (тайл рычага в таблице имён)
let gate = null, f = 0;
while (f < 400 && !gate) { e.runFrames(1); f++; gate = L.findGate(e, B); }
say(`ворота найдены на кадре +${f}: колонка ${gate.c}, строка ${gate.r} (блок 5x3), ` +
    `банк SCREEN2 = ${gate.r >> 3}..${(gate.r + 2) >> 3}`);
const DOOR = [0, 1, 2, 3].map(i => ({ i, st: e.rd(A.pyramidDoors + i * 7 + 4) })).filter(d => d.st && d.st !== 0xFF);
say(`статусы 4 дверей: ${[0,1,2,3].map(i => h(e.rd(A.pyramidDoors + i * 7 + 4))).join(" ")}`);
const DIDX = DOOR.length ? DOOR[0].i : 3;
const DST = A.pyramidDoors + DIDX * 7 + 4;
say(`входная дверь = индекс ${DIDX}, адрес статуса $${DST.toString(16)}`);

const X0 = (gate.c - 1) * 8, Y0 = (gate.r - 1) * 8, WW = 56, HH = 40;   // 7x5 тайлов

// ---------- вспомогательное ----------
const nameGrid = () => { const v = e.vram(), g = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) g.push(v[B.nameBase + (gate.r + r) * 32 + gate.c + c]);
  return g; };
const colRows = (pat, bank) => [...Array(8)].map((_, y) => e.vram()[B.colBase + bank * 0x800 + pat * 8 + y]);
const patRows = (pat, bank) => [...Array(8)].map((_, y) => e.vram()[B.patBase + bank * 0x800 + pat * 8 + y]);
const bankOf = row => row >> 3;

const STATES = { closed: ROM.animExitClosed, closing: ROM.animExitClosing, open: ROM.animExitOpen };
const stateIDs = {}; for (const [n, a] of Object.entries(STATES)) stateIDs[n] = [...Array(15)].map((_, i) => e.rd(a + i));
const statePats = {}; for (const [n, ids] of Object.entries(stateIDs)) statePats[n] = ids.map(id2pat);
const whichState = g => { for (const [n, p] of Object.entries(statePats))
  if (p.every((x, i) => (x <= 0 ? true : x === g[i]))) return n; return "?"; };

// ---------- ФАЗА 1: серия кадров входа ----------
const series = [];
const STEP = 2, N = 60;
for (let i = 0; i < N; i++) {
  const sc = L.renderScreen(e.vram(), e.regs());
  const g = nameGrid(), st = e.rd(DST);
  const lever = g[0], lbank = bankOf(gate.r);
  const nm = `entry_${String(i).padStart(2, "0")}`;
  L.savePNG(`${OUT}/${nm}.png`, sc, X0, Y0, WW, HH, 8, { grid: true });
  if (i % 6 === 0) L.savePNG(`${OUT}/${nm}_full.png`, sc, 0, 0, 256, 192, 3);
  series.push({ i, frame: i * STEP, doorStatus: h(st), sub: e.rd(A.subStatus), statEnt: e.rd(A.statusEntrada),
    protaY: h(e.rd(A.ProtaY)), protaX: h(e.rd(A.ProtaX)), state: whichState(g),
    leverTile: h(lever), leverColor: colRows(lever, lbank).map(h).join(" "),
    vram2E5: [0x2E5, 0x2E6, 0x2E7].map(a => h(e.vram()[a])).join(" "),
    grid: [0, 1, 2].map(r => g.slice(r * 5, r * 5 + 5).map(h).join(" ")) });
  e.runFrames(STEP);
  if (e.rd(A.GameStatus) !== 4) { say(`GameStatus вышел из 4 на шаге ${i}`); break; }
}
fs.writeFileSync(`${OUT}/entry_series.json`, JSON.stringify(series, null, 1));
say(`\n=== СЕРИЯ КАДРОВ ВХОДА (шаг ${STEP} кадра), ${series.length} шт -> ${OUT}/entry_XX.png ===`);
say("  шаг | стат.двери | состояние | рычаг | цвет рычага (8 строк) | прот Y,X");
let prevKey = "";
for (const s of series) {
  const k = `${s.doorStatus}|${s.state}|${s.leverTile}|${s.leverColor}`;
  say(`  ${String(s.i).padStart(3)} |    $${s.doorStatus}     | ${s.state.padEnd(8)} | $${s.leverTile}  | ${s.leverColor} | ${s.protaY},${s.protaX}${k === prevKey ? "" : "   <-- ИЗМЕНЕНИЕ"}`);
  prevKey = k;
}

module.exports = {};
