// msx_gate_zoom.js — зумы ворот KV (MSX) + доказательство перекрытия героя правой створкой.
// Состояния ворот рисуются НЕ игрой, а прямо из VRAM (pattern generator + color table)
// по известной раскладке animExitClosed/Closing/Open — детерминированно и без побочек.
// Использование: node tools/gfx/msx_gate_zoom.js <rom> <outdir>
"use strict";
const fs = require("fs");
const { makeEmu, renderScreen, png, MSXPAL, MSXNAME } = require("./msx_door_lib.js");
const ROM = process.argv[2], OUT = process.argv[3] || "build/msxref";
fs.mkdirSync(OUT, { recursive: true });
const h = x => x.toString(16).padStart(2, "0").toUpperCase();
const L = []; const say = s => { L.push(s); process.stderr.write(s + "\n"); };

const TILES_SALIDA = [0x6C,0x7B,0x6D,0x7C,0x6E,0x7D,0x63,0x64,0x65,0x66,0x67,0x6F,0x5F,0x60,0x7E,0x70];
const TILES_SALIDA2 = [0x71,0x80,0x7F,0x72,0x61,0x62,0x81,0x5C,0x5D,0x5E];
const id2pat = id => id === 0 ? 0 : (id >> 4) === 6 ? TILES_SALIDA[id & 15] : TILES_SALIDA2[id & 15];
const STATES = { closed: 0x67DE, closing: 0x67ED, open: 0x67FC };

const e = makeEmu(ROM);
e.runFrames(200); e.press(" "); e.runFrames(40);
let f = 0;
while (f < 3000 && !(e.rd(0xE000) === 4 && e.rd(0xE0B2) === 0xD8 && e.rd(0xE0B0) !== 0xE1)) { e.runFrames(1); f++; }
const R = e.regs(), B = renderScreen(e.vram(), R).bases;
say(`кадр ${f}: пирамида ${e.rd(0xE054)}; VDP R=[${R.map(h).join(" ")}]`);

// где ворота на экране
const v = e.vram();
let lever = -1;
for (let i = 0; i < 768; i++) if (v[B.nameBase + i] === 0x5E) { lever = i; break; }
const LC = lever % 32, LR = (lever / 32) | 0;              // тайл 0x5E = строка 1 ворот
const DC = LC, DR = LR - 1, BANK = (DR >> 3) * 0x800;       // банк по строке экрана
say(`ворота: тайл-колонка ${DC}, тайл-строка ${DR}, банк color/pattern = ${DR >> 3}`);

// --- рендер произвольной 5x3 раскладки паттернов в собственный буфер ---
function renderTiles(pats, vram, bank) {
  const W = 5 * 8, H = 3 * 8, pix = new Uint8Array(W * H);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    const p = pats[r * 5 + c];
    for (let y = 0; y < 8; y++) {
      const g = p ? vram[B.patBase + bank + p * 8 + y] : 0, col = p ? vram[B.colBase + bank + p * 8 + y] : 0;
      const fg = col >> 4, bg = col & 15;
      for (let x = 0; x < 8; x++) pix[(r * 8 + y) * W + c * 8 + x] = (g & (0x80 >> x)) ? fg : bg;
    }
  }
  return { pix, W, H };
}
function dump(path, pix, W, H, zoom, grid) {
  const buf = Buffer.alloc(W * zoom * H * zoom * 3);
  for (let y = 0; y < H * zoom; y++) for (let x = 0; x < W * zoom; x++) {
    let c = MSXPAL[pix[((y / zoom) | 0) * W + ((x / zoom) | 0)]];
    if (grid && ((x % (8 * zoom)) === 0 || (y % (8 * zoom)) === 0)) c = [80, 80, 255];
    const o = (y * W * zoom + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
  }
  fs.writeFileSync(path, png(W * zoom, H * zoom, buf)); return path;
}

const out = {};
for (const [nm, addr] of Object.entries(STATES)) {
  const pats = [...Array(15)].map((_, i) => id2pat(e.rd(addr + i)));
  const t = renderTiles(pats, v, BANK);
  out[nm] = dump(`${OUT}/gate_${nm}_x8.png`, t.pix, t.W, t.H, 8, true);
  say(`ворота "${nm}" -> ${out[nm]}`);
}

// --- рычаг: тайл 0x5C во всех 4 фазах мигания + тайл 0x5D (поднят) ---
const PAL = [0, 1, 2, 3].map(i => e.rd(0x4C0D + i));      // ColoresPalanca
say(`\nColoresPalanca (ROM $4C0D) = ${PAL.map(h).join(" ")}`);
const leverImgs = [];
for (let ph = 0; ph < 4; ph++) {
  const vv = Uint8Array.from(v);
  for (let y = 5; y < 8; y++) vv[B.colBase + BANK + 0x5C * 8 + y] = PAL[ph];   // фазы мигания
  const t = renderTiles([0x5C, 0, 0, 0, 0, 0x5E, 0, 0, 0, 0, 0, 0, 0, 0, 0], vv, BANK);
  // вырезаем только колонку рычага 8x16
  const W = 8, H = 16, pix = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pix[y * W + x] = t.pix[y * t.W + x];
  leverImgs.push(dump(`${OUT}/lever_down_phase${ph}_${h(PAL[ph])}_x8.png`, pix, W, H, 8, false));
}
{
  const t = renderTiles([0x5D, 0, 0, 0, 0, 0x5E, 0, 0, 0, 0, 0, 0, 0, 0, 0], v, BANK);
  const W = 8, H = 16, pix = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pix[y * W + x] = t.pix[y * t.W + x];
  leverImgs.push(dump(`${OUT}/lever_up_x8.png`, pix, W, H, 8, false));
}
say("рычаг: " + leverImgs.join(", "));

// проверяем, какие именно строки color table тайла 0x5C игра шевелит
const rowSets = [...Array(8)].map(() => new Set());
for (let i = 0; i < 40; i++) { const vv = e.vram();
  for (let y = 0; y < 8; y++) rowSets[y].add(vv[B.colBase + BANK + 0x5C * 8 + y]); e.runFrames(1); }
say("\nтайл $5C, наблюдаемые значения color table по строкам за 40 кадров:");
rowSets.forEach((s, y) => say(`  строка ${y}: ${[...s].map(h).join(" ")}${s.size > 1 ? "   <-- МИГАЕТ" : ""}`));
const rowSetsD = [...Array(8)].map(() => new Set());
for (let i = 0; i < 40; i++) { const vv = e.vram();
  for (let y = 0; y < 8; y++) rowSetsD[y].add(vv[B.colBase + BANK + 0x5D * 8 + y]); e.runFrames(1); }
say("тайл $5D (рычаг поднят): " + rowSetsD.map((s, y) => `${y}:${[...s].map(h).join("/")}`).join(" ") +
  (rowSetsD.every(s => s.size === 1) ? "  -> НЕ мигает" : "  -> мигает"));

// --- A/B: перекрытие героя правой створкой ---
// ждём кадр, где герой максимально заходит на створку
let best = null;
for (let i = 0; i < 120; i++) {
  const vv = e.vram(), r = e.regs();
  if (vv[B.sprAttr] === 0xD0 || vv[B.sprAttr + 2] !== 0xD8) { e.runFrames(1); continue; }
  const withSpr = renderScreen(vv, r);
  const vNo = Uint8Array.from(vv); for (let k = 0; k < 4; k++) vNo[B.sprAttr + k * 4] = 0xE1;   // прячем створку
  const noSpr = renderScreen(vNo, r);
  let heroWith = 0, heroNo = 0;
  for (let o = 0; o < 256 * 192; o++) { if (withSpr.src[o] === 4 || withSpr.src[o] === 5) heroWith++;
    if (noSpr.src[o] === 4 || noSpr.src[o] === 5) heroNo++; }
  if (!best || heroNo - heroWith > best.hidden) best = { i, withSpr, noSpr, heroWith, heroNo, hidden: heroNo - heroWith,
    sx: vv[B.sprAttr + 1], sy: vv[B.sprAttr], hx: vv[B.sprAttr + 17], hy: vv[B.sprAttr + 16] };
  e.runFrames(1);
}
say(`\n=== A/B ПЕРЕКРЫТИЕ ===\nхудший кадр +${best.i}: пикселей героя без створки ${best.heroNo}, со створкой ${best.heroWith}, ` +
    `СКРЫТО створкой ${best.hidden} (${(100 * best.hidden / best.heroNo).toFixed(0)}%)`);
const X0 = Math.max(0, (DC - 1) * 8), Y0 = Math.max(0, (DR - 1) * 8), WW = 56, HH = 48;
function crop(sc) { const pix = new Uint8Array(WW * HH);
  for (let y = 0; y < HH; y++) for (let x = 0; x < WW; x++) pix[y * WW + x] = sc.pix[(Y0 + y) * 256 + X0 + x];
  return pix; }
const p1 = dump(`${OUT}/overlap_with_leaf_x8.png`, crop(best.withSpr), WW, HH, 8, false);
const p2 = dump(`${OUT}/overlap_leaf_hidden_x8.png`, crop(best.noSpr), WW, HH, 8, false);
say(`со створкой: ${p1}\nстворка убрана (что было бы без неё): ${p2}`);

// створка отдельно: спрайты D8+DC / E0+E4 (16x32), два перекрытых спрайта дают 2 цвета
{
  const W = 16, H = 32, pix = new Uint8Array(W * H);
  const put = (pat, col, oy) => { for (let y = 0; y < 16; y++) { const l = v[B.sprPat + pat * 8 + y], r = v[B.sprPat + pat * 8 + 16 + y];
    for (let x = 0; x < 16; x++) { const byte = x < 8 ? l : r; if (byte & (0x80 >> (x & 7))) if (!pix[(oy + y) * W + x]) pix[(oy + y) * W + x] = col; } } };
  put(0xD8, 1, 0); put(0xDC, 3, 0); put(0xE0, 1, 16); put(0xE4, 3, 16);
  say(`\nправая створка (спрайты): ${dump(`${OUT}/leaf_sprites_x8.png`, pix, W, H, 8, false)}`);
}
fs.writeFileSync(`${OUT}/REPORT2.txt`, L.join("\n"));
