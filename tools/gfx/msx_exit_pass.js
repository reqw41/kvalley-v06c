// msx_exit_pass.js — ПОЛНЫЙ цикл ворот KV (MSX) на живом картридже:
//   пирамида помечается пройденной (PiramidesPasadas) -> дверь остаётся на экране закрытой
//   с мигающим рычагом; затем дверь переводится в «открывается» -> «открыта» -> прот
//   заводится в проём и уходит ЗА правую створку (спрайты 0-3).
// Каждый кадр рендерится дважды (как есть / со спрятанной створкой) — это A/B-доказательство
// приоритета плоскостей TMS9918.
"use strict";
const fs = require("fs");
const { makeEmu, renderScreen, png, MSXPAL } = require("./msx_door_lib.js");
const ROM = process.argv[2], OUT = process.argv[3] || "build/msxref";
fs.mkdirSync(OUT, { recursive: true });
const h = x => x.toString(16).padStart(2, "0").toUpperCase();
const L = []; const say = s => { L.push(s); process.stderr.write(s + "\n"); };
const A = { GameStatus: 0xE000, piramideActual: 0xE054, PiramidesPasadas: 0xE062, sprAttrib: 0xE0B0,
  flagEntraSale: 0xE132, flagStageClear: 0xE133, ProtaY: 0xE137, ProtaX: 0xE139,
  pyramidDoors: 0xE1C5, ElemEnProceso: 0xE1F4, statusEntrada: 0xE130 };

const e = makeEmu(ROM);
e.runFrames(200); e.press(" "); e.runFrames(40);
// весь вход держим «пирамида уже пройдена» — тогда finAnimEntrar оставит дверь (status #20)
let f = 0;
while (f < 4000 && e.rd(A.GameStatus) !== 5) { e.writeMem(A.PiramidesPasadas, 0xFF); e.writeMem(A.PiramidesPasadas + 1, 0xFF); e.runFrames(1); f++; }
e.runFrames(4);
say(`геймплей с кадра ${f}, пирамида ${e.rd(A.piramideActual)}`);
const B = renderScreen(e.vram(), e.regs()).bases;
const doors = [...Array(4)].map((_, i) => ({ i, y: e.rd(A.pyramidDoors + i * 7), x: e.rd(A.pyramidDoors + i * 7 + 2),
  room: e.rd(A.pyramidDoors + i * 7 + 3), st: e.rd(A.pyramidDoors + i * 7 + 4) }));
doors.forEach(d => say(`  дверь ${d.i}: Y=${h(d.y)} X=${h(d.x)} room=${h(d.room)} st=${h(d.st)}`));
const el = doors.reduce((a, b) => Math.abs(b.y - e.rd(A.ProtaY)) + Math.abs(b.x - e.rd(A.ProtaX)) <
  Math.abs(a.y - e.rd(A.ProtaY)) + Math.abs(a.x - e.rd(A.ProtaX)) ? b : a);
say(`входная дверь = ${el.i} (Y=${h(el.y)} X=${h(el.x)}), статус ${h(e.rd(A.pyramidDoors + el.i * 7 + 4))}`);
const DST = A.pyramidDoors + el.i * 7 + 4;

// окно ворот по рычагу
function findLever() { const v = e.vram();
  for (let i = 0; i < 768; i++) if (v[B.nameBase + i] === 0x5E) return { c: i % 32, r: (i / 32) | 0 }; return null; }
let lv = findLever();
if (!lv) { say("рычаг не найден — дверь стёрта, дальше только спрайтовая часть"); lv = { c: 26, r: 15 }; }
say(`рычаг на экране: col=${lv.c} row=${lv.r}; тайл над ним = $${h(e.vram()[B.nameBase + (lv.r - 1) * 32 + lv.c])}`);
const WX = Math.max(0, (lv.c - 1) * 8), WY = Math.max(0, (lv.r - 2) * 8), WW = 56, HH = 48;

function dump(path, pix, W, H, zoom) {
  const buf = Buffer.alloc(W * zoom * H * zoom * 3);
  for (let y = 0; y < H * zoom; y++) for (let x = 0; x < W * zoom; x++) {
    const c = MSXPAL[pix[((y / zoom) | 0) * W + ((x / zoom) | 0)]];
    const o = (y * W * zoom + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; }
  fs.writeFileSync(path, png(W * zoom, H * zoom, buf)); return path; }
const crop = sc => { const p = new Uint8Array(WW * HH);
  for (let y = 0; y < HH; y++) for (let x = 0; x < WW; x++) p[y * WW + x] = sc.pix[(WY + y) * 256 + WX + x]; return p; };
const shot = (nm, zoom = 8) => dump(`${OUT}/${nm}.png`, crop(renderScreen(e.vram(), e.regs())), WW, HH, zoom);

// --- 1. ЗАКРЫТАЯ дверь, рычаг мигает: 4 фазы ---
const closedShots = [];
for (let i = 0; i < 8; i++) { closedShots.push(shot(`live_closed_${i}`)); e.runFrames(2); }
say(`закрытые ворота (рычаг $${h(e.vram()[B.nameBase + (lv.r - 1) * 32 + lv.c])}, мигание): ${closedShots[0]} ... ${closedShots[7]}`);

// --- 2. ОТКРЫВАНИЕ: статус #30 ---
e.writeMem(A.flagStageClear, 1);
e.writeMem(DST, 0x30);
const openShots = [];
for (let i = 0; i < 40; i++) {
  const st = e.rd(DST);
  if (i % 5 === 0) openShots.push({ i, st: h(st), lever: h(e.vram()[B.nameBase + (lv.r - 1) * 32 + lv.c]), f: shot(`live_opening_${String(i).padStart(2, "0")}`) });
  e.runFrames(4);
  if ((e.rd(DST) & 0xF0) >= 0x40) break;
}
openShots.forEach(s => say(`  открывание i=${s.i} статус=$${s.st} тайл рычага=$${s.lever} -> ${s.f}`));
say(`статус двери после открывания: $${h(e.rd(DST))}`);
const openFile = shot("live_open");
say(`открытые ворота: ${openFile}, тайл рычага = $${h(e.vram()[B.nameBase + (lv.r - 1) * 32 + lv.c])}`);
dump(`${OUT}/live_open_full.png`, (() => { const sc = renderScreen(e.vram(), e.regs()); return sc.pix; })(), 256, 192, 3);

// --- 3. Заводим прота в проём: держим его координаты на salidaArea, пока не сработает chkSalePiram ---
e.writeMem(DST, 0x40);
let fired = -1;
for (let i = 0; i < 300 && fired < 0; i++) {
  e.writeMem(A.ProtaY, el.y); e.writeMem(A.ProtaX, el.x);
  e.runFrames(1);
  if (e.rd(A.flagEntraSale) === 1 && e.vram()[B.sprAttr + 2] === 0xD8 && e.vram()[B.sprAttr] !== 0xE1) fired = i;
}
say(`\nchkSalePiram сработала на итерации ${fired}; flagEntraSale=${e.rd(A.flagEntraSale)} statusEntrada=${e.rd(A.statusEntrada)}`);

const rows = [];
for (let s = 0; s < 26; s++) {
  const vv = e.vram(), r = e.regs();
  const withS = renderScreen(vv, r);
  const vNo = Uint8Array.from(vv); for (let k = 0; k < 4; k++) vNo[B.sprAttr + k * 4] = 0xE1;
  const noS = renderScreen(vNo, r);
  let hw = 0, hn = 0, cov = 0;
  for (let o = 0; o < 256 * 192; o++) { if (withS.src[o] === 4 || withS.src[o] === 5) hw++;
    if (noS.src[o] === 4 || noS.src[o] === 5) { hn++; if (withS.src[o] >= 0 && withS.src[o] <= 3) cov++; } }
  const t = String(s).padStart(2, "0");
  rows.push({ s, heroVisible: hw, heroTotal: hn, hidden: cov,
    leaf: `${h(vv[B.sprAttr])},${h(vv[B.sprAttr + 1])}`, leafPat: h(vv[B.sprAttr + 2]), leafCol: vv[B.sprAttr + 3] & 15,
    hero: `${h(vv[B.sprAttr + 16])},${h(vv[B.sprAttr + 17])}`, heroCol: vv[B.sprAttr + 19] & 15,
    real: dump(`${OUT}/exit_${t}_real.png`, crop(withS), WW, HH, 8),
    noleaf: dump(`${OUT}/exit_${t}_noleaf.png`, crop(noS), WW, HH, 8) });
  e.runFrames(2);
}
say("\nшаг | видно героя | всего | СКРЫТО створкой | створка Y,X pat col | герой Y,X col");
for (const r of rows) say(`  ${String(r.s).padStart(2)} | ${String(r.heroVisible).padStart(4)} | ${String(r.heroTotal).padStart(4)} | ` +
  `${String(r.hidden).padStart(4)} (${String(Math.round(100 * r.hidden / Math.max(1, r.heroTotal))).padStart(3)}%) | ` +
  `${r.leaf} $${r.leafPat} c${r.leafCol} | ${r.hero} c${r.heroCol}`);
const mx = rows.reduce((a, b) => b.hidden > a.hidden ? b : a);
say(`\nМАКСИМУМ перекрытия: шаг ${mx.s}, скрыто ${mx.hidden}/${mx.heroTotal} пикселей героя (${Math.round(100 * mx.hidden / mx.heroTotal)}%)`);
say(`  со створкой:      ${mx.real}\n  створка спрятана: ${mx.noleaf}`);
fs.writeFileSync(`${OUT}/exit_pass.json`, JSON.stringify(rows, null, 1));
fs.writeFileSync(`${OUT}/REPORT4.txt`, L.join("\n"));
