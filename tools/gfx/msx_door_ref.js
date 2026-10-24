// msx_door_ref.js — ЭТАЛОН ВОРОТ (дверь входа/выхода) King's Valley (MSX, Konami 1985).
// Снимает с картриджа в headless-WebMSX:
//   1) серию кадров прохода героя сквозь правую створку (спрайты 0-3 против героя 4-5),
//   2) MSX color table всех тайлов двери и рычага в обоих состояниях,
//   3) цвета/паттерны спрайтов створки,
//   4) зумы PNG области ворот.
// Использование: node tools/gfx/msx_door_ref.js <rom> <outdir>
"use strict";
const fs = require("fs");
const { makeEmu, renderScreen, savePNG, MSXNAME } = require("./msx_door_lib.js");

const ROM = process.argv[2], OUT = process.argv[3] || "build/msxref";
fs.mkdirSync(OUT, { recursive: true });
const h = x => x.toString(16).padStart(2, "0").toUpperCase();
const R = [];
const say = s => { R.push(s); process.stderr.write(s + "\n"); };

const A = { GameStatus: 0xE000, subStatus: 0xE001, timer: 0xE003, piramideActual: 0xE054,
  sprAttrib: 0xE0B0, protaAttrib: 0xE0C0, protaColorRopa: 0xE0C3, ProtaColorPiel: 0xE0C7,
  statusEntrada: 0xE130, ProtaY: 0xE137, ProtaX: 0xE139, pyramidDoors: 0xE1C5, ElemEnProceso: 0xE1F4 };
const ROMSYM = { drawPuerta: 0x6772, animExitClosed: 0x67DE, animExitClosing: 0x67ED, animExitOpen: 0x67FC };

// map-ID -> паттерн, из getTileFromID (tilesSalida #60 / tilesSalida2 #70)
const TILES_SALIDA = [0x6C,0x7B,0x6D,0x7C,0x6E,0x7D,0x63,0x64,0x65,0x66,0x67,0x6F,0x5F,0x60,0x7E,0x70];
const TILES_SALIDA2 = [0x71,0x80,0x7F,0x72,0x61,0x62,0x81,0x5C,0x5D,0x5E];
const id2pat = id => id === 0 ? 0 : (id >> 4) === 6 ? TILES_SALIDA[id & 15] : (id >> 4) === 7 ? TILES_SALIDA2[id & 15] : -1;

const e = makeEmu(ROM);
e.runFrames(200); e.press(" "); e.runFrames(40);

// --- ФАЗА 1: ловим кадр gs=04 (вход в пирамиду), где выставлены спрайты створки ---
let f = 0;
while (f < 3000 && !(e.rd(A.GameStatus) === 4 && e.rd(A.sprAttrib + 2) === 0xD8 && e.rd(A.sprAttrib) !== 0xE1)) { e.runFrames(1); f++; }
say(`ФАЗА 1: спрайты створки выставлены на кадре ${f}; пирамида ${e.rd(A.piramideActual)}`);

const vdpR = e.regs();
const B = renderScreen(e.vram(), vdpR).bases;
say(`VDP: R=[${vdpR.map(h).join(" ")}]  name=$${B.nameBase.toString(16)} color=$${B.colBase.toString(16)} ` +
    `pattern=$${B.patBase.toString(16)} sprAttr=$${B.sprAttr.toString(16)} sprPat=$${B.sprPat.toString(16)} ` +
    `спрайты ${B.spr16 ? "16x16" : "8x8"} бордюр/фон=${vdpR[7] & 15}`);

// область ворот на экране: ищем в таблице имён тайл нижней части рычага 0x5E
function findLever(v) {
  for (let i = 0; i < 768; i++) if (v[B.nameBase + i] === 0x5E) return { col: i % 32, row: (i / 32) | 0 };
  for (let i = 0; i < 768; i++) if (v[B.nameBase + i] === 0x5C || v[B.nameBase + i] === 0x5D) return { col: i % 32, row: ((i / 32) | 0) + 1 };
  return null;
}
let lv = findLever(e.vram());
say(`рычаг (тайл 0x5E) найден в таблице имён: col=${lv.col} row=${lv.row}`);
// дверь 5x3 тайла начиная со столбца рычага, строка = row-1
const DC = lv.col, DR = lv.row - 1;
const X0 = Math.max(0, (DC - 1) * 8), Y0 = Math.max(0, (DR - 1) * 8), WW = 56, HH = 48;

// --- серия кадров прохода героя ---
const files = [], frames = [];
for (let i = 0; i < 30; i++) {
  const v = e.vram(), sc = renderScreen(v, e.regs());
  const spr = []; for (let k = 0; k < 8; k++) spr.push([0,1,2,3].map(j => v[B.sprAttr + k * 4 + j]));
  // какие плоскости видны в окне ворот и сколько пикселей героя (пл.4/5) перекрыто створкой (пл.0-3)
  let heroPix = 0, doorPix = 0, maskedHero = 0;
  const doorSet = new Set([0, 1, 2, 3]);
  for (let y = Y0; y < Y0 + HH; y++) for (let x = X0; x < X0 + WW; x++) {
    const p = sc.src[y * 256 + x];
    if (p === 4 || p === 5) heroPix++; else if (doorSet.has(p)) doorPix++;
  }
  const nm = `pass_${String(i).padStart(2, "0")}`;
  files.push(savePNG(`${OUT}/${nm}.png`, sc, X0, Y0, WW, HH, 8, { grid: false }));
  frames.push({ i, gs: e.rd(A.GameStatus), sub: e.rd(A.subStatus), statEnt: e.rd(A.statusEntrada),
    py: e.rd(A.ProtaY), px: e.rd(A.ProtaX), heroPix, doorPix,
    spr: spr.map((a, k) => `p${k}:Y=${h(a[0])} X=${h(a[1])} pat=${h(a[2])} col=${a[3] & 15}`) });
  if (i === 0) savePNG(`${OUT}/full_entering.png`, sc, 0, 0, 256, 192, 3);
  e.runFrames(3);
}
fs.writeFileSync(`${OUT}/pass_frames.json`, JSON.stringify(frames, null, 1));
say(`ФАЗА 1: 30 кадров прохода (шаг 3 кадра) -> ${OUT}/pass_XX.png`);
say(`  спрайты в кадре 0: ${frames[0].spr.join(" | ")}`);

// --- ФАЗА 2: цвета спрайтов створки (паттерны 0xD8/0xDC/0xE0/0xE4) ---
const v0 = e.vram();
say("\n=== СПРАЙТЫ ПРАВОЙ СТВОРКИ (плоскости 0-3, ВСЕГДА выше героя) ===");
for (let k = 0; k < 6; k++) {
  const y = v0[B.sprAttr + k * 4], x = v0[B.sprAttr + k * 4 + 1], p = v0[B.sprAttr + k * 4 + 2], c = v0[B.sprAttr + k * 4 + 3] & 15;
  const who = k < 4 ? "СТВОРКА" : "ГЕРОЙ  ";
  say(`  плоскость ${k} (${who}): Y=$${h(y)} X=$${h(x)} паттерн=$${h(p)} цвет=${c} (${MSXNAME[c]})`);
}
// битмапы спрайтовых паттернов створки
for (const p of [0xD8, 0xDC, 0xE0, 0xE4]) {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    const l = v0[B.sprPat + p * 8 + y], r = v0[B.sprPat + p * 8 + 16 + y];
    rows.push((l.toString(2).padStart(8, "0") + r.toString(2).padStart(8, "0")).replace(/0/g, ".").replace(/1/g, "#"));
  }
  fs.writeFileSync(`${OUT}/sprpat_${h(p)}.txt`, rows.join("\n"));
}

// --- ФАЗА 3: тайлы двери в трёх состояниях + их MSX color table ---
function colorOf(v, pat) {                     // строки цвета тайла во всех трёх банках
  const b = [0, 1, 2].map(bk => [...Array(8)].map((_, y) => v[B.colBase + bk * 0x800 + pat * 8 + y]));
  const same = JSON.stringify(b[0]) === JSON.stringify(b[1]) && JSON.stringify(b[1]) === JSON.stringify(b[2]);
  return { rows: b[0], same, banks: b };
}
function patRows(v, pat) { return [...Array(8)].map((_, y) => v[B.patBase + pat * 8 + y]); }

const STATES = { "закрыта (animExitClosed)": ROMSYM.animExitClosed,
  "закрывается (animExitClosing)": ROMSYM.animExitClosing,
  "открыта (animExitOpen)": ROMSYM.animExitOpen };
const romAt = a => e.rd(a);
const stateTiles = {};
for (const [nm, addr] of Object.entries(STATES)) {
  const ids = [...Array(15)].map((_, i) => romAt(addr + i));
  stateTiles[nm] = ids.map(id2pat);
}
say("\n=== РАСКЛАДКА ВОРОТ 5x3 ТАЙЛА (паттерны; 00 = пусто) ===");
for (const [nm, pats] of Object.entries(stateTiles)) {
  say(`  ${nm}:`);
  for (let r = 0; r < 3; r++) say("     " + pats.slice(r * 5, r * 5 + 5).map(p => p <= 0 ? "--" : h(p)).join(" "));
}

const allPats = [...new Set(Object.values(stateTiles).flat().filter(p => p > 0))].sort((a, b) => a - b);
say("\n=== MSX COLOR TABLE ТАЙЛОВ ВОРОТ И РЫЧАГА (8 строк, старший ниббл = перо, младший = фон) ===");
const NOTE = { 0x5C: "РЫЧАГ ОПУЩЕН (дверь закрыта)", 0x5D: "РЫЧАГ ПОДНЯТ (дверь открыта/открывается)",
  0x5E: "низ рычага (мигает!)", 0x63: "верх проёма жёлтый 1", 0x64: "верх проёма жёлтый 2",
  0x67: "лестница в проёме", 0x6F: "кирпичи закрывающиеся" };
const colorDump = {};
for (const p of allPats) {
  const c = colorOf(e.vram(), p);
  colorDump[h(p)] = { rows: c.rows.map(h), sameInAllBanks: c.same, note: NOTE[p] || "" };
  const inState = Object.entries(stateTiles).filter(([, ps]) => ps.includes(p)).map(([n]) => n.split(" ")[0]).join("/");
  say(`  тайл $${h(p)} [${inState}]${NOTE[p] ? " — " + NOTE[p] : ""}`);
  say(`      ${c.rows.map(h).join(" ")}   ${c.same ? "(все 3 банка совпали)" : "!! БАНКИ РАЗЛИЧАЮТСЯ"}`);
  const cols = [...new Set(c.rows.flatMap(b => [b >> 4, b & 15]))].sort((a, b) => a - b);
  say(`      цвета: ${cols.map(i => `${i}=${MSXNAME[i]}`).join(", ")}`);
}
fs.writeFileSync(`${OUT}/door_colors.json`, JSON.stringify({ tiles: colorDump, states: stateTiles }, null, 1));

// --- ФАЗА 4: мигание рычага. drawBrilloGemas пишет 3 байта в color table $2E5 (тайл 0x5C, строки 5-7)
say("\n=== АНИМАЦИЯ ЦВЕТА РЫЧАГА (ROM ColoresPalanca $4C0D, VRAM color table $2E5 = тайл $5C строки 5-7) ===");
say(`  ColoresPalanca = ${[0, 1, 2, 3].map(i => h(romAt(0x4C0D + i))).join(" ")}`);
const seen = [];
for (let i = 0; i < 16; i++) {
  const vv = e.vram();
  seen.push([0x2E5, 0x2E6, 0x2E7].map(a => h(vv[a])).join(" ") + ` (t=${h(e.rd(A.timer))})`);
  e.runFrames(2);
}
say("  наблюдаемые байты VRAM $2E5-$2E7 подряд: " + [...new Set(seen.map(s => s.split(" (")[0]))].join(" | "));

// --- ФАЗА 5: принудительно рисуем дверь в трёх состояниях и снимаем зумы ---
function drawState(addr) {
  const st = e.m.cpu.saveState();
  e.callSub(ROMSYM.drawPuerta, { DE: addr });
  return renderScreen(e.vram(), e.regs());
}
const zoomFiles = {};
for (const [nm, addr] of Object.entries(STATES)) {
  const key = nm.split(" ")[0];
  const sc = drawState(addr);
  zoomFiles[key] = savePNG(`${OUT}/gate_${key}.png`, sc, X0, Y0, WW, HH, 8, { grid: true });
  savePNG(`${OUT}/gate_${key}_full.png`, sc, 0, 0, 256, 192, 2);
  e.runFrames(1);
}
say("\nзумы состояний ворот: " + Object.values(zoomFiles).join(", "));
fs.writeFileSync(`${OUT}/REPORT.txt`, R.join("\n"));
say(`\nвсё в ${OUT}/`);
