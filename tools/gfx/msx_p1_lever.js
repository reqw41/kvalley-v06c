// msx_p1_lever.js — 1) покадровое наблюдение рычага ИМЕННО В МОМЕНТ ВХОДА в пирамиду 1
//                     (когда тайл $5C реально стоит в таблице имён),
//                   2) сверка цветов ворот пирамиды 1 (реальная игра) и пирамиды 5 (аттракт-демо,
//                     на которой снимали прошлый эталон), плюс цвет камня лабиринта.
// node tools/gfx/msx_p1_lever.js <rom> <outdir>
"use strict";
const fs = require("fs");
const L = require("./msx_p1_lib.js");
const { A, ROM, id2pat, MSXNAME } = L;
const ROMPATH = process.argv[2], OUT = process.argv[3] || "build/msxref2";
fs.mkdirSync(OUT, { recursive: true });
const h = x => x.toString(16).padStart(2, "0").toUpperCase();
const LOG = []; const say = s => { LOG.push(s); process.stdout.write(s + "\n"); };
const GATE_TILES = [0x5C,0x5D,0x5E,0x5F,0x60,0x61,0x62,0x63,0x64,0x65,0x66,0x67,0x6C,0x6D,0x6E,
                    0x6F,0x70,0x71,0x72,0x7B,0x7C,0x7D,0x7E,0x7F,0x80,0x81];

const e = L.makeEmu(ROMPATH);
L.startRealGame(e, say);
const B = L.bases(e);
let gate = null, f = 0;
while (f < 400 && !gate) { e.runFrames(1); f++; gate = L.findGate(e, B); }
const DIDX = [0,1,2,3].findIndex(i => { const s = e.rd(A.pyramidDoors + i * 7 + 4); return s && s !== 0xFF; });
const DST = A.pyramidDoors + DIDX * 7 + 4;
const BANK = gate.r >> 3;
const X0 = (gate.c - 1) * 8, Y0 = (gate.r - 1) * 8, WW = 56, HH = 40;
const colRows = (pat, bank = BANK) => [...Array(8)].map((_, y) => e.vram()[B.colBase + bank * 0x800 + pat * 8 + y]);
const leverTile = () => e.vram()[B.nameBase + gate.r * 32 + gate.c];

// --- 1. ждём, пока при ВХОДЕ дверь дойдёт до состояния «закрыта» (статус $53) ---
let w = 0; while (w < 1200 && !(e.rd(DST) === 0x53 || leverTile() === 0x5C)) { e.runFrames(1); w++; }
say(`\n=== ВХОД: дверь закрылась (статус $${h(e.rd(DST))}) через ${w} кадров, тайл рычага $${h(leverTile())} ===`);
say("покадрово, шаг 1 кадр (никаких пропусков):");
say("  n | timer | тайл рычага | color table тайла $5C (строки 0..7)      | вывод");
const seen = new Map();
for (let i = 0; i < 24; i++) {
  const lt = leverTile(), c = colRows(0x5C).map(h);
  const key = c.join(" ");
  seen.set(key, (seen.get(key) || 0) + 1);
  const lo = c.slice(5).join(" ");
  say(`  ${String(i).padStart(2)} |  ${h(e.rd(A.timer))}   |     $${h(lt)}     | ${key} | низ рычага = ${lo}`);
  L.savePNG(`${OUT}/lever_entry_${String(i).padStart(2, "0")}.png`,
    L.renderScreen(e.vram(), e.regs()), X0, Y0, WW, HH, 8, { grid: true });
  e.runFrames(1);
}
say(`РАЗНЫХ вариантов color table $5C за 24 кадра: ${seen.size}`);
for (const [k, v] of seen) { const rows = k.split(" ").map(x => parseInt(x, 16));
  say(`   ${k}   (${v} кадр(ов))  строки 5-7: перо ${rows[5] >> 4} (${MSXNAME[rows[5] >> 4]}) / фон ${rows[5] & 15} (${MSXNAME[rows[5] & 15]})`); }
say(`фаза берётся как (timer>>1)&3 из таблицы ColoresPalanca = ${[0,1,2,3].map(i => h(e.rd(ROM.ColoresPalanca + i))).join(" ")}`);
say(`строки 0..4 тайла $5C НЕИЗМЕННЫ: ${colRows(0x5C).slice(0,5).map(h).join(" ")}`);

// --- 2. полный снимок цветов всех тайлов ворот на пирамиде 1 ---
const snap1 = {}; for (const t of GATE_TILES) snap1[h(t)] = colRows(t).map(h).join(" ");
const stone1 = [0x40,0x41,0x42,0x43,0x44].map(t => `${h(t)}:${colRows(t).map(h).join(" ")}`);
say(`\nкамень лабиринта пирамиды 1: ${stone1.join("  |  ")}`);

// --- 3. прыгаем на пирамиду 5 (схема, на которой снимался прошлый эталон = аттракт-демо) ---
const keepPassed = () => { e.writeMem(A.PiramidesPasadas, 0xFF); e.writeMem(A.PiramidesPasadas + 1, 0xFF); };
e.writeMem(A.piramideDest, 5); e.writeMem(A.subStatus, 0); e.writeMem(A.GameStatus, 8);
let g = 0; while (g < 6000 && !(e.rd(A.piramideActual) === 5 && e.rd(A.GameStatus) === 5)) { keepPassed(); e.runFrames(1); g++; }
for (let i = 0; i < 80; i++) { keepPassed(); e.runFrames(1); }
say(`\n=== перешли на пирамиду ${e.rd(A.piramideActual)} за ${g} кадров ===`);
const g5 = L.findGate(e, B); const BANK5 = g5 ? g5.r >> 3 : BANK;
const snap5 = {}; for (const t of GATE_TILES) snap5[h(t)] = colRows(t, BANK5).map(h).join(" ");
const stone5 = [0x40,0x41,0x42,0x43,0x44].map(t => `${h(t)}:${colRows(t, BANK5).map(h).join(" ")}`);
say(`камень лабиринта пирамиды 5: ${stone5.join("  |  ")}`);
say("\n=== СВЕРКА ЦВЕТОВ ТАЙЛОВ ВОРОТ: пирамида 1 vs пирамида 5 ===");
let diff = 0;
for (const t of GATE_TILES) { const k = h(t);
  if (snap1[k] !== snap5[k]) { diff++; say(`  РАЗЛИЧИЕ тайл $${k}: п1 = ${snap1[k]} | п5 = ${snap5[k]}`); } }
say(diff === 0 ? "  РАЗЛИЧИЙ НЕТ — цвета ворот одинаковы на пирамидах 1 и 5 (ChgStoneColor трогает только $40-$44)"
               : `  различий: ${diff}`);
fs.writeFileSync(`${OUT}/gate_colors_p1_vs_p5.json`, JSON.stringify({ p1: snap1, p5: snap5, stone1, stone5 }, null, 1));
fs.writeFileSync(`${OUT}/REPORT_lever.txt`, LOG.join("\n"));
say(`\nвсё в ${OUT}/`);
