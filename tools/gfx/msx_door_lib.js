// msx_door_lib.js — общая часть: headless-WebMSX + рендер MSX SCREEN 2 в PNG.
// Приоритет спрайтов TMS9918 воспроизведён точно: побеждает МЕНЬШИЙ номер плоскости,
// цвет 0 у победителя = прозрачно (но плоскость всё равно маскирует старшие),
// лимит 4 спрайта на строку (5-й не выводится).
"use strict";
const fs = require("fs"), zlib = require("zlib");
const MSXJS = "/Users/boris/Projects/knightmare-v06c/tools/msxjs";

const MSXPAL = [
  [0,0,0],[0,0,0],[62,184,73],[116,208,125],[89,85,224],[128,118,241],[185,94,81],[101,219,239],
  [219,101,89],[255,137,125],[204,195,94],[222,208,135],[58,162,65],[183,102,181],[204,204,204],[255,255,255]];
const MSXNAME = ["прозрачный","чёрный","зелёный средний","зелёный светлый","синий тёмный","синий светлый",
  "красный тёмный","циан","красный средний","красный светлый","жёлтый тёмный","жёлтый светлый",
  "зелёный тёмный","магента","серый","белый"];

let CRCT = null;
function crc(buf) { if (!CRCT) { CRCT = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRCT[n] = c; } }
  let c = 0xFFFFFFFF; for (const b of buf) c = CRCT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF); }
function png(w, h, rgb) {
  const stride = w * 3 + 1, raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgb.copy(raw, y * stride + 1, y * w * 3, (y + 1) * w * 3); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4);
    d.copy(b, 8); b.writeUInt32BE(crc(Buffer.concat([Buffer.from(t), d])) >>> 0, 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function renderScreen(vram, R) {
  const nameBase = (R[2] & 0x7F) * 0x400, colBase = (R[3] & 0x80) * 0x40, patBase = (R[4] & 0x04) * 0x800;
  const sprAttr = (R[5] & 0x7F) * 0x80, sprPat = (R[6] & 0x07) * 0x800;
  const spr16 = !!(R[1] & 2), mag = (R[1] & 1) ? 2 : 1, bgIdx = R[7] & 0x0F;
  const pix = new Uint8Array(256 * 192).fill(bgIdx);
  const src = new Int16Array(256 * 192).fill(-1);
  for (let row = 0; row < 24; row++) { const bank = (row >> 3) * 0x800;
    for (let col = 0; col < 32; col++) { const name = vram[nameBase + row * 32 + col];
      for (let y = 0; y < 8; y++) {
        const p = vram[patBase + bank + name * 8 + y], c = vram[colBase + bank + name * 8 + y];
        const fg = c >> 4, bg = c & 15;
        for (let x = 0; x < 8; x++) pix[(row * 8 + y) * 256 + col * 8 + x] = (p & (0x80 >> x)) ? (fg || bgIdx) : (bg || bgIdx);
      } } }
  const sprSize = spr16 ? 16 : 8, sz = sprSize * mag, planes = [];
  for (let i = 0; i < 32; i++) {
    const y = vram[sprAttr + i * 4]; if (y === 0xD0) break;
    const x = vram[sprAttr + i * 4 + 1], pat = vram[sprAttr + i * 4 + 2], ca = vram[sprAttr + i * 4 + 3];
    planes.push({ i, y, x, pat, col: ca & 15, ec: !!(ca & 0x80),
      sy: (y > 0xD0 ? y - 256 : y) + 1, sx: x - ((ca & 0x80) ? 32 : 0) });
  }
  for (let sy = 0; sy < 192; sy++) { let onLine = 0;
    for (const s of planes) {
      if (sy < s.sy || sy >= s.sy + sz) continue;
      if (++onLine > 4) break;
      const ly = ((sy - s.sy) / mag) | 0, base = sprPat + (spr16 ? (s.pat & 0xFC) : s.pat) * 8;
      for (let lx = 0; lx < sprSize; lx++) {
        const byte = spr16 ? vram[base + (lx < 8 ? ly : ly + 16)] : vram[base + ly];
        if (!(byte & (0x80 >> (lx & 7)))) continue;
        for (let m = 0; m < mag; m++) { const px = s.sx + lx * mag + m;
          if (px < 0 || px >= 256) continue; const o = sy * 256 + px;
          if (src[o] >= 0) continue; src[o] = s.i; if (s.col !== 0) pix[o] = s.col; } }
    } }
  return { pix, src, planes, bases: { nameBase, colBase, patBase, sprAttr, sprPat, spr16, bgIdx } };
}

// zoom с nearest-neighbour; opts.grid — сетка 8px; opts.markPlanes — подсветить контур спрайт-плоскостей
function savePNG(path, sc, x0, y0, w, h, zoom, opts = {}) {
  const W = w * zoom, H = h * zoom, buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sxp = x0 + ((x / zoom) | 0), syp = y0 + ((y / zoom) | 0);
    let c = (sxp >= 0 && sxp < 256 && syp >= 0 && syp < 192) ? MSXPAL[sc.pix[syp * 256 + sxp]] : [255, 0, 255];
    if (opts.grid && zoom >= 4 && ((x % (8 * zoom)) === 0 || (y % (8 * zoom)) === 0)) c = [c[0] * .6 | 0, c[1] * .6 | 0, 255];
    const o = (y * W + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
  }
  fs.writeFileSync(path, png(W, H, buf));
  return path;
}

function makeEmu(rom) {
  const MsxEmu = require(MSXJS + "/emu.js");
  const e = new MsxEmu(); e.loadCartridge(rom);
  e.regs = () => Array.from(e.m.vdp.eval("register")).slice(0, 8).map(x => x & 255);
  e.vram = () => e.m.vdp.vram;
  e.rd = a => e.m.bus.read(a);
  e.press = (k, hold = 10, after = 30) => { const kb = e.W.room.keyboard;
    kb.processKey(k, true); e.runFrames(hold); kb.processKey(k, false); e.runFrames(after); };
  e.hold = (k, on) => e.W.room.keyboard.processKey(k, on);
  e.snap = () => renderScreen(e.vram(), e.regs());
  return e;
}

module.exports = { makeEmu, renderScreen, savePNG, png, MSXPAL, MSXNAME };
