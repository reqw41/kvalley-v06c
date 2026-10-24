// msx_p1_gate.js — ПОЛНЫЙ эталон ворот ПЕРВОЙ пирамиды King's Valley (MSX) в РЕАЛЬНОЙ игре.
//   ФАЗА A — вход героя в уровень (GameStatus 4): серия кадров + таблица блока 5x3.
//   ФАЗА B — мигание рычага: 16 кадров подряд, покадрово VRAM color table $2E0-$2F7.
//   ФАЗА C — выход из уровня (гемы собраны, дверь открылась, герой уходит): серия кадров.
//   ФАЗА D — сверка цветов ворот пирамиды 1 против пирамиды 5 (схема камня демо).
// node tools/gfx/msx_p1_gate.js <rom> <outdir>
"use strict";
const fs = require("fs");
const L = require("./msx_p1_lib.js");
const { A, ROM, id2pat, MSXNAME } = L;

const ROMPATH = process.argv[2], OUT = process.argv[3] || "build/msxref2";
fs.mkdirSync(OUT, { recursive: true });
const h = x => x.toString(16).padStart(2, "0").toUpperCase();
const LOG = []; const say = s => { LOG.push(s); process.stdout.write(s + "\n"); };
const bin = b => b.toString(2).padStart(8, "0").replace(/0/g, ".").replace(/1/g, "#");
const col = c => `перо ${c >> 4} (${MSXNAME[c >> 4]}) / фон ${c & 15} (${MSXNAME[c & 15]})`;

const e = L.makeEmu(ROMPATH);
L.startRealGame(e, say);
const B = L.bases(e);
const GEM = { cogidas: 0xE1F2, total: 0xE1F3 };

let gate = null, f = 0;
while (f < 400 && !gate) { e.runFrames(1); f++; gate = L.findGate(e, B); }
const DIDX = [0, 1, 2, 3].findIndex(i => { const s = e.rd(A.pyramidDoors + i * 7 + 4); return s && s !== 0xFF; });
const DBASE = A.pyramidDoors + DIDX * 7, DST = DBASE + 4;
const DOORY = e.rd(DBASE), DOORX = e.rd(DBASE + 2);
say(`ворота пирамиды 1: колонка ${gate.c}, строка ${gate.r}; дверь #${DIDX} Y=$${h(DOORY)} X=$${h(DOORX)}`);
const X0 = (gate.c - 1) * 8, Y0 = (gate.r - 1) * 8, WW = 56, HH = 40;
const BANK = gate.r >> 3;

const nameGrid = () => { const v = e.vram(), g = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) g.push(v[B.nameBase + (gate.r + r) * 32 + gate.c + c]);
  return g; };
const colRows = (pat, bank = BANK) => [...Array(8)].map((_, y) => e.vram()[B.colBase + bank * 0x800 + pat * 8 + y]);
const patRows = (pat, bank = BANK) => [...Array(8)].map((_, y) => e.vram()[B.patBase + bank * 0x800 + pat * 8 + y]);

const STATES = { closed: ROM.animExitClosed, closing: ROM.animExitClosing, open: ROM.animExitOpen };
const stateIDs = {}; for (const [n, a] of Object.entries(STATES)) stateIDs[n] = [...Array(15)].map((_, i) => e.rd(a + i));
const statePats = {}; for (const [n, ids] of Object.entries(stateIDs)) statePats[n] = ids.map(id2pat);
const whichState = g => { for (const [n, p] of Object.entries(statePats))
  if (p.every((x, i) => (x <= 0 ? true : x === g[i]))) return n; return "?"; };

const shot = (nm, zoom = 8, full = false) => { const sc = L.renderScreen(e.vram(), e.regs());
  const p = L.savePNG(`${OUT}/${nm}.png`, sc, X0, Y0, WW, HH, zoom, { grid: true });
  if (full) L.savePNG(`${OUT}/${nm}_full.png`, sc, 0, 0, 256, 192, 3); return p; };

// ---- таблица «map-ID -> паттерн -> цвета» для указанного состояния (по данным ROM + живой VRAM)
function tableFor(name) {
  const ids = stateIDs[name], pats = statePats[name], out = [];
  for (let k = 0; k < 15; k++) {
    const id = ids[k], pat = pats[k];
    out.push({ cell: `r${(k / 5) | 0}c${k % 5}`, id: h(id), pat: pat <= 0 ? "--" : h(pat),
      colors: pat <= 0 ? null : colRows(pat).map(h), bitmap: pat <= 0 ? null : patRows(pat).map(h) });
  }
  return out;
}
function printTable(name, tbl, note = {}) {
  say(`\n--- состояние ${name}: блок 5x3 (map-ID -> паттерн) ---`);
  for (let r = 0; r < 3; r++)
    say("    " + tbl.slice(r * 5, r * 5 + 5).map(c => `${c.id}->${c.pat}`).join("   "));
  say(`  цвета (VRAM color table, банк ${BANK}, 8 строк тайла, старший ниббл = перо, младший = фон):`);
  const done = new Set();
  for (const c of tbl) { if (c.pat === "--" || done.has(c.pat)) continue; done.add(c.pat);
    const cs = [...new Set(c.colors.flatMap(x => [parseInt(x, 16) >> 4, parseInt(x, 16) & 15]))].sort((a, b) => a - b);
    say(`    ${c.cell} map-ID $${c.id} -> паттерн $${c.pat}${note[c.pat] ? " (" + note[c.pat] + ")" : ""}`);
    say(`        цвет: ${c.colors.join(" ")}`);
    say(`        битмап: ${c.bitmap.join(" ")}`);
    say(`        задействованы MSX-цвета: ${cs.map(i => `${i}=${MSXNAME[i]}`).join(", ")}`);
  }
}
const NOTE = { "5C": "РЫЧАГ ВНИЗ", "5D": "РЫЧАГ ВВЕРХ", "5E": "низ рычага",
  "6C": "левая стойка верх", "6D": "левая стойка серед", "6E": "левая стойка низ",
  "7B": "правая стойка верх", "7C": "правая стойка серед", "7D": "правая стойка низ",
  "63": "потолок проёма 1", "64": "потолок проёма 2", "65": "правый край проёма",
  "66": "СТУПЕНЬКА верх", "67": "СТУПЕНЬКИ (лестница в проёме)", "6F": "кирпичи закрывающиеся",
  "70": "кирпичи закр. 2", "71": "кирпичи закр. 3", "72": "кирпичи закр. 4" };

// ================= ФАЗА A: ВХОД =================
say(`\n################ ФАЗА A — ВХОД ГЕРОЯ В УРОВЕНЬ (пирамида 1) ################`);
const entry = [];
for (let i = 0; i < 110; i++) {
  const g = nameGrid();
  entry.push({ i, doorStatus: h(e.rd(DST)), sub: e.rd(A.subStatus), state: whichState(g),
    protaY: h(e.rd(A.ProtaY)), protaX: h(e.rd(A.ProtaX)),
    lever: h(g[0]), leverColor: colRows(g[0]).map(h).join(" "),
    grid: [0, 1, 2].map(r => g.slice(r * 5, r * 5 + 5).map(h).join(" ")),
    file: shot(`entry_${String(i).padStart(3, "0")}`, 8, i % 10 === 0) });
  e.runFrames(2);
  if (e.rd(A.GameStatus) !== 4) break;
}
fs.writeFileSync(`${OUT}/entry_series.json`, JSON.stringify(entry, null, 1));
say(`серия входа: ${entry.length} кадров (шаг 2), ${OUT}/entry_NNN.png`);
say("  шаг|стат.двери|состояние|рычаг|цвет рычага            |прот");
let pk = "";
for (const s of entry) { const k = `${s.doorStatus}|${s.state}|${s.lever}|${s.leverColor}`;
  if (k !== pk) { say(`  ${String(s.i).padStart(3)}|   $${s.doorStatus}    |${s.state.padEnd(9)}|$${s.lever} |${s.leverColor}|${s.protaY},${s.protaX}`); pk = k; } }
const usedEntry = [...new Set(entry.map(s => s.state))];
say(`состояния блока, реально показанные при входе: ${usedEntry.join(", ")}`);
printTable("open (что видно почти весь вход)", tableFor("open"), NOTE);
printTable("closing", tableFor("closing"), NOTE);
printTable("closed", tableFor("closed"), NOTE);

// ================= ФАЗА B: МИГАНИЕ РЫЧАГА =================
say(`\n################ ФАЗА B — МИГАЕТ ЛИ РЫЧАГ ################`);
say(`ROM ColoresPalanca ($4C0D) = ${[0,1,2,3].map(i => h(e.rd(ROM.ColoresPalanca + i))).join(" ")}`);
say(`ROM coloresBrillo  ($4C09) = ${[0,1,2,3].map(i => h(e.rd(ROM.coloresBrillo + i))).join(" ")}`);
function blinkWatch(tag, n = 16) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const g = nameGrid();
    rows.push({ i, timer: h(e.rd(A.timer)), lever: h(g[0]),
      c5C: colRows(0x5C).map(h).join(" "), c5D: colRows(0x5D).map(h).join(" "), c5E: colRows(0x5E).map(h).join(" ") });
    e.runFrames(1);
  }
  say(`\n[${tag}] 16 кадров ПОДРЯД:`);
  say("  n |t |рычаг| color $5C (рычаг вниз)  | color $5D (рычаг вверх) | color $5E (низ)");
  for (const r of rows) say(`  ${String(r.i).padStart(2)}|${r.timer}| $${r.lever} | ${r.c5C} | ${r.c5D} | ${r.c5E}`);
  const uniq = k => [...new Set(rows.map(r => r[k]))];
  say(`  РАЗЛИЧНЫХ значений: $5C -> ${uniq("c5C").length}, $5D -> ${uniq("c5D").length}, $5E -> ${uniq("c5E").length}; ` +
      `показанный тайл рычага: ${[...new Set(rows.map(r => r.lever))].map(x => "$" + x).join(",")}`);
  uniq("c5C").forEach(v => say(`    $5C: ${v}`));
  return rows;
}
// момент входа (дверь ещё в анимации закрытия / уже закрыта)
blinkWatch("ВХОД, конец анимации двери");

// ================= ФАЗА C: ВЫХОД =================
say(`\n################ ФАЗА C — ВЫХОД ГЕРОЯ ИЗ УРОВНЯ (пирамида 1) ################`);
let g5 = 0; while (g5 < 400 && e.rd(A.GameStatus) !== 5) { e.runFrames(1); g5++; }
say(`геймплей (GameStatus 5) через ${g5} кадров; гемы ${e.rd(GEM.cogidas)}/${e.rd(GEM.total)}`);
// «собираем» все гемы -> chkAllGemas -> stage clear -> дверь снова рисуется (закрытой)
e.writeMem(GEM.cogidas, e.rd(GEM.total));
let w = 0; while (w < 400 && !e.rd(A.flagStageClear)) { e.runFrames(1); w++; }
say(`flagStageClear=1 через ${w} кадров; статус двери $${h(e.rd(DST))}`);
w = 0; while (w < 200 && e.rd(DST) !== 0x20) { e.runFrames(1); w++; }
gate = L.findGate(e, B) || gate;
say(`дверь перерисована: статус $${h(e.rd(DST))}, рычаг снова на экране col=${gate.c} row=${gate.r}`);
// закрытая дверь с мигающим рычагом
const closedShots = [];
for (let i = 0; i < 10; i++) { closedShots.push(shot(`exit_closed_${i}`, 8, i === 0)); e.runFrames(2); }
say(`закрытая дверь перед выходом: ${closedShots[0]} ... ${closedShots[9]}`);
blinkWatch("ВЫХОД, дверь закрыта, рычаг ВНИЗ");

// открываем дверь (в игре — прыжком по рычагу; тут ставим статус #30 «открывается»)
e.writeMem(A.timer, 0x14);
e.writeMem(DST, 0x30);
const openSeries = [];
for (let i = 0; i < 60; i++) {
  const g = nameGrid();
  openSeries.push({ i, doorStatus: h(e.rd(DST)), state: whichState(g), lever: h(g[0]),
    leverColor: colRows(g[0]).map(h).join(" "),
    grid: [0, 1, 2].map(r => g.slice(r * 5, r * 5 + 5).map(h).join(" ")),
    file: shot(`exit_open_${String(i).padStart(2, "0")}`, 8, i % 10 === 0) });
  e.runFrames(2);
  if ((e.rd(DST) & 0xF0) >= 0x40) break;
}
say(`открывание двери: ${openSeries.length} кадров`);
let pk2 = ""; for (const s of openSeries) { const k = `${s.doorStatus}|${s.state}|${s.lever}`;
  if (k !== pk2) { say(`  ${String(s.i).padStart(3)} стат=$${s.doorStatus} ${s.state.padEnd(9)} рычаг=$${s.lever} цвет=${s.leverColor}`); pk2 = k; } }
say(`статус двери: $${h(e.rd(DST))} (4x = открыта, ждёт выхода героя)`);
blinkWatch("ВЫХОД, дверь ОТКРЫТА, рычаг ВВЕРХ");
shot("exit_open_final", 8, true);

// заводим героя в проём
let fired = -1;
for (let i = 0; i < 400 && fired < 0; i++) {
  e.writeMem(A.ProtaY, DOORY); e.writeMem(A.ProtaX, DOORX);
  e.runFrames(1);
  if (e.rd(A.flagEntraSale) === 1) fired = i;
}
say(`герой вошёл в проём (flagEntraSale=1) через ${fired} кадров; statusEntrada=${e.rd(A.statusEntrada)}`);
const exitSeries = [];
for (let i = 0; i < 80; i++) {
  const g = nameGrid(), v = e.vram();
  exitSeries.push({ i, doorStatus: h(e.rd(DST)), state: whichState(g), lever: h(g[0]),
    leverColor: colRows(g[0]).map(h).join(" "),
    statEnt: e.rd(A.statusEntrada), protaY: h(e.rd(A.ProtaY)), protaX: h(e.rd(A.ProtaX)),
    spr: [0,1,2,3,4,5].map(k => [0,1,2,3].map(j => h(v[B.sprAttr + k * 4 + j])).join(" ")),
    grid: [0, 1, 2].map(r => g.slice(r * 5, r * 5 + 5).map(h).join(" ")),
    file: shot(`exit_pass_${String(i).padStart(2, "0")}`, 8, i % 8 === 0) });
  e.runFrames(2);
  if (e.rd(A.GameStatus) > 5) break;
}
fs.writeFileSync(`${OUT}/exit_series.json`, JSON.stringify({ openSeries, exitSeries }, null, 1));
say(`серия выхода: ${exitSeries.length} кадров -> ${OUT}/exit_pass_NN.png`);
let pk3 = ""; for (const s of exitSeries) { const k = `${s.doorStatus}|${s.state}|${s.lever}|${s.statEnt}`;
  if (k !== pk3) { say(`  ${String(s.i).padStart(3)} стат=$${s.doorStatus} ${s.state.padEnd(9)} рычаг=$${s.lever} (${s.leverColor}) statusEntrada=${s.statEnt} прот=${s.protaY},${s.protaX}`); pk3 = k; } }

fs.writeFileSync(`${OUT}/REPORT_p1.txt`, LOG.join("\n"));
say(`\nвсё в ${OUT}/`);
