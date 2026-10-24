// msx_stair_ref.js — ЭТАЛОН ОРИГИНАЛА: ВЕРХНЯЯ ПЛОЩАДКА ЛЕСТНИЦЫ (задача #55).
//
// Что снимает. Запускает НАСТОЯЩУЮ партию на картридже legacy/msx/kvalley_z80.rom
// (headless-WebMSX), доходит до геймплея пирамиды 1 и:
//   1) находит в name table (VRAM 0x3800) все пары «верх лестницы» — 0x73/0x74 у лестницы,
//      уходящей вниз-ВПРАВО, и 0x83/0x82 у уходящей вниз-ВЛЕВО;
//   2) печатает их 8 строк паттерна (VRAM 0x2000+tile*8) и цвета (VRAM 0x0000+tile*8)
//      с расшифровкой MSX-цветов по именам;
//   3) кладёт PNG: полный экран + зум клеток площадки с соседними ступенями.
// Почему не «по исходнику»: COLOR_InGame лежит СЖАТЫМ (UnpackPatterns), а расчёт по
// комментариям к дизассемблеру — не эталон. Тут байты сняты с ЖИВОЙ VRAM.
//
// Запуск: node tools/gfx/msx_stair_ref.js [каталог PNG]
"use strict";
const P = require("./msx_p1_lib.js");
const { makeEmu, savePNG, MSXNAME } = P;
const OUT = process.argv[2] || "/tmp/kv_stair";
require("fs").mkdirSync(OUT, { recursive: true });

const e = makeEmu("/Users/boris/projects/kvalley-v06c/legacy/msx/kvalley_z80.rom");
P.startRealGame(e, s => console.log("  " + s));
e.runFrames(160);                       // дождаться, пока лабиринт дорисован
const sc = e.snap(), B = sc.bases, v = e.vram();
console.log(`пирамида ${e.rd(P.A.piramideActual)}, name=0x${B.nameBase.toString(16)} ` +
            `col=0x${B.colBase.toString(16)} pat=0x${B.patBase.toString(16)}`);

// ---- 1. где на экране стоят тайлы лестницы ----
const STAIR = { 0x73: "верх ▶ левый", 0x74: "верх ▶ правый", 0x75: "тело ▶ левый", 0x76: "тело ▶ правый",
                0x83: "верх ◀ левый", 0x82: "верх ◀ правый", 0x85: "тело ◀ левый", 0x84: "тело ◀ правый" };
const found = {};
for (let i = 0; i < 768; i++) { const t = v[B.nameBase + i];
  if (STAIR[t]) (found[t] = found[t] || []).push({ r: (i / 32) | 0, c: i % 32 }); }
for (const t of Object.keys(STAIR).map(Number))
  console.log(`  0x${t.toString(16)} ${STAIR[t].padEnd(14)} клеток ${(found[t] || []).length}` +
    ((found[t] || []).length ? "  напр. (ряд " + found[t][0].r + ", столбец " + found[t][0].c + ")" : ""));

// ---- 2. паттерн + цвет площадки, построчно ----
// Банк цвета/паттерна выбирается ТРЕТЬЮ экрана (ряд>>3); проверяем все три — у King's
// Valley они совпадают, но утверждать это без замера нельзя.
const rows = (base, tile, bank) => [...Array(8)].map((_, y) => v[base + bank * 0x800 + tile * 8 + y]);
console.log("\nПАТТЕРН И ЦВЕТ (все три банка сверены):");
for (const t of [0x73, 0x74, 0x75, 0x76, 0x83, 0x82, 0x85, 0x84]) {
  const p = rows(B.patBase, t, 0), c = rows(B.colBase, t, 0);
  for (const bank of [1, 2]) {
    const p2 = rows(B.patBase, t, bank), c2 = rows(B.colBase, t, bank);
    if (p2.join() !== p.join() || c2.join() !== c.join()) console.log(`  !!! банк ${bank} у 0x${t.toString(16)} ОТЛИЧАЕТСЯ`);
  }
  console.log(`0x${t.toString(16)} ${STAIR[t]}`);
  for (let y = 0; y < 8; y++) {
    const bits = [...Array(8)].map((_, b) => (p[y] >> (7 - b)) & 1 ? "#" : ".").join("");
    const fg = c[y] >> 4, bg = c[y] & 15;
    console.log(`   строка ${y}: ${bits}  pat=${p[y].toString(16).padStart(2, "0")}` +
      ` col=${c[y].toString(16).padStart(2, "0")}  перо ${fg} ${MSXNAME[fg]} / фон ${bg} ${MSXNAME[bg]}`);
  }
}

// ---- 3. картинки ----
savePNG(`${OUT}/msx_full.png`, sc, 0, 0, 256, 192, 3);
// ПАРА КЛЕТОК ПЛОЩАДКИ КРУПНО — ровно тот формат, в котором её показывает стенд приёмки
// tools/verify/stair_top_probe.js (pair_*.png), чтобы сверка шла картинка-в-картинку.
{
  const { MSXPAL } = P, S = 12;
  for (const [l, r, tag] of [[0x73, 0x74, "right"], [0x83, 0x82, "left"]]) {
    const W = 16 * S, H = 8 * S, buf = Buffer.alloc(W * H * 3);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
      const t = x < 8 ? l : r, bit = 7 - (x & 7);
      const pat = rows(B.patBase, t, 0)[y], col = rows(B.colBase, t, 0)[y];
      const c = MSXPAL[((pat >> bit) & 1) ? (col >> 4) : (col & 15)];
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
        const o = ((y * S + dy) * W + x * S + dx) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; }
    }
    require("fs").writeFileSync(`${OUT}/msx_pair_${tag}.png`, require("./msx_door_lib.js").png(W, H, buf));
    console.log(`пара клеток -> ${OUT}/msx_pair_${tag}.png`);
  }
}
// зум на первую найденную площадку каждого направления: 4 клетки вширь, 4 вглубь
for (const [top, tag] of [[0x73, "right"], [0x83, "left"]]) {
  const f = (found[top] || [])[0]; if (!f) { console.log(`0x${top.toString(16)}: на экране нет`); continue; }
  const x0 = Math.max(0, (f.c - 2) * 8), y0 = Math.max(0, (f.r - 1) * 8);
  savePNG(`${OUT}/msx_stairtop_${tag}.png`, sc, x0, y0, 48, 40, 10, { grid: true });
  console.log(`зум 0x${top.toString(16)} -> ${OUT}/msx_stairtop_${tag}.png (ряд ${f.r}, столбец ${f.c})`);
}
console.log(`полный экран -> ${OUT}/msx_full.png`);
