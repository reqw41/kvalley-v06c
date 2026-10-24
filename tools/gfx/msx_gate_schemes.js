// msx_gate_schemes.js — ворота KV (MSX) на четырёх схемах камня: пирамиды 1, 5, 9, 13.
// Для блока 5x3 снимает map-ID -> паттерн -> 8 байт MSX color table (во ВСЕХ трёх банках
// SCREEN 2) и 8 байт битмапа; отдельно полные таблицы рычага 0x5C/0x5D/0x5E.
// Использование: node tools/gfx/msx_gate_schemes.js <rom> <outdir>
"use strict";
const fs = require("fs");
const { makeEmu, renderScreen, png, MSXPAL, MSXNAME } = require("./msx_door_lib.js");
const ROM = process.argv[2], OUT = process.argv[3] || "build/msxref";
fs.mkdirSync(OUT, { recursive: true });
const h = x => x.toString(16).padStart(2, "0").toUpperCase();
const L = []; const say = s => { L.push(s); process.stderr.write(s + "\n"); };
const A = { GameStatus: 0xE000, subStatus: 0xE001, piramideActual: 0xE054, piramideDest: 0xE055,
  PiramidesPasadas: 0xE062, sprAttrib: 0xE0B0, ProtaY: 0xE137, ProtaX: 0xE139,
  pyramidDoors: 0xE1C5, flagStageClear: 0xE133 };
const TILES_SALIDA = [0x6C,0x7B,0x6D,0x7C,0x6E,0x7D,0x63,0x64,0x65,0x66,0x67,0x6F,0x5F,0x60,0x7E,0x70];
const TILES_SALIDA2 = [0x71,0x80,0x7F,0x72,0x61,0x62,0x81,0x5C,0x5D,0x5E];
const id2pat = id => id === 0 ? 0 : (id >> 4) === 6 ? TILES_SALIDA[id & 15] : TILES_SALIDA2[id & 15];
const STATES = { closed: 0x67DE, closing: 0x67ED, open: 0x67FC };
const NOTE = { 0x5C: "РЫЧАГ ВНИЗ (дверь закрыта)", 0x5D: "РЫЧАГ ВВЕРХ (дверь открыта)", 0x5E: "низ рычага",
  0x63: "потолок проёма 1", 0x64: "потолок проёма 2", 0x65: "правый край проёма", 0x66: "ступень верх",
  0x67: "лестница в проёме", 0x6C: "левая стойка верх", 0x6D: "левая стойка серед", 0x6E: "левая стойка низ",
  0x7B: "правая стойка верх", 0x7C: "правая стойка серед", 0x7D: "правая стойка низ" };

const e = makeEmu(ROM);
const keepPassed = () => { e.writeMem(A.PiramidesPasadas, 0xFF); e.writeMem(A.PiramidesPasadas + 1, 0xFF); };
e.runFrames(200); e.press(" "); e.runFrames(40);
let f = 0; while (f < 4000 && e.rd(A.GameStatus) !== 5) { keepPassed(); e.runFrames(1); f++; }
e.runFrames(4);
const B = renderScreen(e.vram(), e.regs()).bases;

function gotoPyramid(n) {
  if (e.rd(A.piramideActual) === n) return true;
  e.writeMem(A.piramideDest, n); e.writeMem(A.subStatus, 0); e.writeMem(A.GameStatus, 8);
  let w = 0; while (w < 6000 && !(e.rd(A.piramideActual) === n && e.rd(A.GameStatus) === 5)) { keepPassed(); e.runFrames(1); w++; }
  for (let i = 0; i < 60; i++) { keepPassed(); e.runFrames(1); }
  return e.rd(A.piramideActual) === n;
}
function findLever() { const v = e.vram();
  for (let i = 0; i < 768; i++) if (v[B.nameBase + i] === 0x5E) return { c: i % 32, r: (i / 32) | 0 }; return null; }
function dump(path, pix, W, H, zoom, grid) {
  const buf = Buffer.alloc(W * zoom * H * zoom * 3);
  for (let y = 0; y < H * zoom; y++) for (let x = 0; x < W * zoom; x++) {
    let c = MSXPAL[pix[((y / zoom) | 0) * W + ((x / zoom) | 0)]];
    if (grid && ((x % (8 * zoom)) === 0 || (y % (8 * zoom)) === 0)) c = [70, 70, 255];
    const o = (y * W * zoom + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; }
  fs.writeFileSync(path, png(W * zoom, H * zoom, buf)); return path; }

const colRows = (v, pat, bank) => [...Array(8)].map((_, y) => v[B.colBase + bank * 0x800 + pat * 8 + y]);
const patRows = (v, pat, bank) => [...Array(8)].map((_, y) => v[B.patBase + bank * 0x800 + pat * 8 + y]);
const bmp = rs => rs.map(b => b.toString(2).padStart(8, "0").replace(/0/g, ".").replace(/1/g, "#"));

const RESULT = {};
const PYR = [1, 5, 9, 13];
for (const P of PYR) {
  if (!gotoPyramid(P)) { say(`!! пирамида ${P} недостижима`); continue; }
  e.writeMem(A.flagStageClear, 1);
  const v = e.vram();
  const lv = findLever();
  const DR = lv ? lv.r - 1 : -1, DC = lv ? lv.c : -1;
  const bankScreen = DR >= 0 ? (DR >> 3) : -1;
  say(`\n############ ПИРАМИДА ${P} (схема камня ${((P - 1) >> 2) & 3}) ############`);
  say(`ворота на экране: колонка ${DC}, строка ${DR}, банк SCREEN2 = ${bankScreen}`);

  // цвет кирпича лабиринта для сравнения (тайл 0x40, ChgStoneColor)
  say(`кирпич лабиринта (тайл $40): ${colRows(v, 0x40, Math.max(0, bankScreen)).map(h).join(" ")}`);

  // per-cell дамп 5x3 для трёх состояний
  const cells = {};
  for (const [nm, addr] of Object.entries(STATES)) {
    const ids = [...Array(15)].map((_, i) => e.rd(addr + i));
    cells[nm] = ids.map((id, k) => { const p = id2pat(id);
      return { r: (k / 5) | 0, c: k % 5, mapId: h(id), pat: p ? h(p) : "--",
        color: p ? [0, 1, 2].map(bk => colRows(v, p, bk).map(h).join(" ")) : null,
        bitmap: p ? bmp(patRows(v, p, Math.max(0, bankScreen))) : null, note: NOTE[p] || "" }; });
  }
  // сводка цветов по состоянию open (самое информативное)
  say("раскладка 5x3, состояние OPEN — паттерн / color table (банк экрана):");
  for (let r = 0; r < 3; r++) {
    const line = cells.open.slice(r * 5, r * 5 + 5).map(c => c.pat === "--" ? "  --  " : ` $${c.pat} `).join("");
    say("   " + line);
  }
  const uniq = new Map();
  for (const nm of Object.keys(STATES)) for (const c of cells[nm]) if (c.pat !== "--") {
    const key = c.pat; if (!uniq.has(key)) uniq.set(key, c); }
  for (const [pat, c] of [...uniq.entries()].sort()) {
    const same = c.color[0] === c.color[1] && c.color[1] === c.color[2];
    const cols = [...new Set(c.color[Math.max(0, bankScreen)].split(" ").flatMap(b => { const n = parseInt(b, 16); return [n >> 4, n & 15]; }))].sort((a, b) => a - b);
    say(`  $${pat}${c.note ? " " + c.note : ""}: ${c.color[Math.max(0, bankScreen)]}  ${same ? "(3 банка одинаковы)" : "!!БАНКИ РАЗНЫЕ: b0=" + c.color[0] + " b1=" + c.color[1] + " b2=" + c.color[2]}`);
    say(`      цвета MSX: ${cols.map(i => `${i}=${MSXNAME[i]}`).join(", ")}`);
  }
  RESULT[`pyr${P}`] = { stoneScheme: ((P - 1) >> 2) & 3, doorCol: DC, doorRow: DR, bank: bankScreen,
    brick40: [0, 1, 2].map(bk => colRows(v, 0x40, bk).map(h).join(" ")), cells };

  // зумы: блок 5x3 + окружение, состояния closed/open с живого экрана
  if (lv) {
    const WX = Math.max(0, (DC - 1) * 8), WY = Math.max(0, (DR - 1) * 8), WW = 64, HH = 48;
    const crop = () => { const sc = renderScreen(e.vram(), e.regs()), p = new Uint8Array(WW * HH);
      for (let y = 0; y < HH; y++) for (let x = 0; x < WW; x++) p[y * WW + x] = sc.pix[(WY + y) * 256 + WX + x]; return p; };
    say(`  зум закрытых ворот: ${dump(`${OUT}/pyr${String(P).padStart(2, "0")}_gate_closed_x8.png`, crop(), WW, HH, 8, true)}`);
    // открыть дверь штатной анимацией
    const doorIdx = [0, 1, 2, 3].reduce((a, i) => { const b = A.pyramidDoors + i * 7;
      const d = Math.abs(e.rd(b) - e.rd(A.ProtaY)) + Math.abs(e.rd(b + 2) - e.rd(A.ProtaX));
      return d < a.d ? { i, d } : a; }, { i: 0, d: 1e9 }).i;
    e.writeMem(A.pyramidDoors + doorIdx * 7 + 4, 0x30);
    for (let i = 0; i < 200 && (e.rd(A.pyramidDoors + doorIdx * 7 + 4) & 0xF0) < 0x40; i++) e.runFrames(1);
    e.runFrames(4);
    say(`  зум открытых ворот: ${dump(`${OUT}/pyr${String(P).padStart(2, "0")}_gate_open_x8.png`, crop(), WW, HH, 8, true)}`);
    const sc = renderScreen(e.vram(), e.regs());
    say(`  полный экран:       ${dump(`${OUT}/pyr${String(P).padStart(2, "0")}_full.png`, sc.pix, 256, 192, 3, false)}`);
    e.writeMem(A.pyramidDoors + doorIdx * 7 + 4, 0x20);
    for (let i = 0; i < 40; i++) e.runFrames(1);
  }
}

// ---------- РЫЧАГ: полные таблицы во всех банках + фазы мигания ----------
say("\n############ РЫЧАГ: тайлы $5C / $5D / $5E ############");
const v = e.vram();
for (const p of [0x5C, 0x5D, 0x5E]) {
  say(`\nтайл $${h(p)} — ${NOTE[p]}`);
  for (let bk = 0; bk < 3; bk++) say(`  color table банк ${bk} ($${(B.colBase + bk * 0x800 + p * 8).toString(16)}): ${colRows(v, p, bk).map(h).join(" ")}`);
  for (let bk = 0; bk < 3; bk++) say(`  битмап    банк ${bk} ($${(B.patBase + bk * 0x800 + p * 8).toString(16)}): ${patRows(v, p, bk).map(h).join(" ")}`);
  say("  вид (банк 0):"); bmp(patRows(v, p, 0)).forEach((s, i) => {
    const c = colRows(v, p, 0)[i]; say(`     ${s}   перо ${c >> 4} (${MSXNAME[c >> 4]}) / фон ${c & 15} (${MSXNAME[c & 15]})`); });
}
// какие строки мигают
say("\nнаблюдение за color table 80 кадров:");
for (const p of [0x5C, 0x5D, 0x5E]) {
  const sets = [...Array(3)].map(() => [...Array(8)].map(() => new Set()));
  for (let i = 0; i < 80; i++) { const vv = e.vram();
    for (let bk = 0; bk < 3; bk++) for (let y = 0; y < 8; y++) sets[bk][y].add(vv[B.colBase + bk * 0x800 + p * 8 + y]);
    e.runFrames(1); }
  for (let bk = 0; bk < 3; bk++) {
    const blink = sets[bk].map((s, y) => s.size > 1 ? y : -1).filter(y => y >= 0);
    say(`  $${h(p)} банк ${bk}: ${sets[bk].map(s => [...s].map(h).join("/")).join(" ")}` +
      (blink.length ? `   <-- МИГАЮТ строки ${blink.join(",")}` : "   (статично)"));
  }
}
// зумы рычага: 4 фазы ColoresPalanca + рычаг вверх
const PALC = [0, 1, 2, 3].map(i => e.rd(0x4C0D + i));
say(`\nColoresPalanca (ROM $4C0D) = ${PALC.map(h).join(" ")}`);
function leverImg(pat, override) {
  const W = 8, H = 16, pix = new Uint8Array(W * H), vv = e.vram();
  const draw = (p, oy) => { for (let y = 0; y < 8; y++) {
    let col = vv[B.colBase + p * 8 + y]; if (override && p === 0x5C && y >= 5) col = override;
    const g = vv[B.patBase + p * 8 + y], fg = col >> 4, bg = col & 15;
    for (let x = 0; x < 8; x++) pix[(oy + y) * W + x] = (g & (0x80 >> x)) ? fg : bg; } };
  draw(pat, 0); draw(0x5E, 8);
  return { pix, W, H };
}
const li = [];
PALC.forEach((c, i) => { const t = leverImg(0x5C, c);
  li.push(dump(`${OUT}/lever_down_phase${i}_${h(c)}_x8.png`, t.pix, t.W, t.H, 12, false)); });
{ const t = leverImg(0x5D, null); li.push(dump(`${OUT}/lever_up_x8.png`, t.pix, t.W, t.H, 12, false)); }
say("зумы рычага: " + li.join("\n              "));

fs.writeFileSync(`${OUT}/gate_schemes.json`, JSON.stringify(RESULT, null, 1));
fs.writeFileSync(`${OUT}/REPORT5.txt`, L.join("\n"));
