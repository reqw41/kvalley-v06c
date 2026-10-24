#!/usr/bin/env node
// load_devector_rec.js — разбор записи «чёрного ящика» Devector (rec-*.bin/.json)
// и поиск кадра, где артефакт ПОЯВИЛСЯ.
//
// Формат (см. форк devector-fork/src/extention/state_recorder.ts): .bin = кадры
// ПОДРЯД по 65536 Б, от старого к новому; .json = метаданные (seq/cc/pc/sp).
//
// Что делает:
//   1) по каждому кадру строит «лишние биты» = fb & ~фон, где фон — кадр ДО начала
//      события (кадр 0 записи) с поправкой на спрайты… нет: спрайты двигаются, поэтому
//      берём проще и честнее — ПОКАДРОВУЮ РАЗНИЦУ fb и ищем биты, которые ПОЯВИЛИСЬ
//      и больше НЕ ИСЧЕЗЛИ до конца записи (это и есть «прилипший» мусор);
//   2) печатает первый кадр, где такой бит родился, с PC/тактами — это точка расследования;
//   3) --slot N печатает шапку/запись вывода слота N по кадрам вокруг события.
//
// Запуск: node tools/verify/load_devector_rec.js rec-20260819-0012.bin [--last N] [--slot 6]
"use strict";
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const BIN = args.find(a => /\.bin$/.test(a));
if (!BIN) { console.log("нужен путь к rec-*.bin"); process.exit(2); }
const JSONP = BIN.replace(/\.bin$/, ".json");
const LAST = args.includes("--last") ? +args[args.indexOf("--last") + 1] : 0;
const SLOT = args.includes("--slot") ? +args[args.indexOf("--slot") + 1] : -1;

const FRAME = 0x10000;
const buf = fs.readFileSync(BIN);
const meta = fs.existsSync(JSONP) ? JSON.parse(fs.readFileSync(JSONP, "utf8")) : null;
const n = Math.floor(buf.length / FRAME);
const from = LAST > 0 ? Math.max(0, n - LAST) : 0;
console.log(`кадров: ${n}${meta ? ` (${meta.seconds?.toFixed?.(1)} с)` : ""}, разбираю с ${from}`);

// плоскости fb: p0 0x8000, p1 0xA000, p2 0xC000 (по 0x2000)
const PLANES = [0x8000, 0xA000, 0xC000];
const frameAt = i => buf.subarray(i * FRAME, (i + 1) * FRAME);

// «Прилипший» бит: появился в кадре i и жив во ВСЕХ кадрах до конца записи.
const last = frameAt(n - 1);

// Маска ЖИВЫХ спрайтов ПОСЛЕДНЕГО кадра: спрайт, стоящий на месте до конца записи,
// тоже «прилипший», но он законный. Берём габариты по записи вывода и по шапке слота
// (+1 столбец и +2 строки запаса), все три плоскости.
const liveMask = new Uint8Array(0x6000);
for (let sl = 0; sl < 21; sl++) {
  const p = 0xE000 + sl * 256;
  for (const [hiO, loO, ncO] of [[1, 2, 3], [0x97, 0x98, 0x99]]) {
    const hi = last[p + hiO], lo = last[p + loO], nc = last[p + ncO];
    if (!nc || nc > 4 || hi < 0x80) continue;
    const c0 = (hi & 0x1F) - 1;
    for (let c = 0; c <= nc; c++)
      for (let r = -2; r < 26; r++) {
        const col = (c0 + c) & 0x1F, row = (lo + r) & 255;
        for (let pl = 0; pl < 3; pl++) liveMask[pl * 0x2000 + col * 256 + row] = 1;
      }
  }
}
const masked = (pl, off) => liveMask[pl * 0x2000 + off] === 1;
let reported = 0;
for (let i = from + 1; i < n && reported < 12; i++) {
  const prev = frameAt(i - 1), cur = frameAt(i);
  for (let pl = 0; pl < 3 && reported < 12; pl++) {
    const base = PLANES[pl];
    for (let off = 0; off < 0x2000 && reported < 12; off++) {
      const a = base + off;
      if (masked(pl, off)) continue;              // под живым спрайтом последнего кадра
      const born = cur[a] & ~prev[a] & 0xFF;      // биты, зажёгшиеся в этом кадре
      const stuck = born & last[a] & 0xFF;        // и дожившие до конца записи
      if (!stuck) continue;
      // отсеиваем «живой» спрайт: если бит гас хоть раз позже — не прилип
      let persistent = stuck;
      for (let j = i + 1; j < n && persistent; j++) persistent &= frameAt(j)[a];
      if (!persistent) continue;
      const col = off >> 8, lo = off & 255;
      const m = meta?.meta?.[i];
      console.log(`кадр ${i}${m ? ` seq=${m.seq} cc=${m.cc} pc=${m.pc.toString(16)}` : ""}: ` +
        `p${pl} X=${col * 8} lo=${lo} биты=${persistent.toString(2).padStart(8, "0")}`);
      reported++;
    }
  }
}
if (!reported) console.log("прилипших битов не найдено — артефакт лучевой либо вне записи");

if (SLOT >= 0) {
  console.log(`--- слот ${SLOT} по кадрам:`);
  const p = 0xE000 + SLOT * 256;
  for (let i = from; i < n; i += Math.max(1, Math.floor((n - from) / 40))) {
    const f = frameAt(i);
    console.log(`f${i}: valid=${f[p]} hdr=${f[p+1].toString(16)},${f[p+2].toString(16)},nc=${f[p+3]} ` +
      `hib=${f[p+4].toString(16)} hic=${f[p+5].toString(16)} out[p=${f[p+0x96]} ${f[p+0x97].toString(16)},${f[p+0x98].toString(16)},nc=${f[p+0x99]}]`);
  }
}
