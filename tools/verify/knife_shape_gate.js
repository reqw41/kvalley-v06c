// knife_shape_gate.js — ГЕЙТ ФОРМЫ СПРАЙТА НОЖА (задача #46).
//
// ЗАЧЕМ. Короткий путь вывода ножа (vec_knife_* в vec_sprout.asm) построен на ТРЁХ
// допущениях об арте, и если арт когда-нибудь поменяют, нож начнёт рисоваться обрезанным
// молча — глазами это ловится только на живой игре в момент отскока:
//   1. ЧЕРНИЛА ТОЛЬКО В 8 ВЕРХНИХ СТРОКАХ клетки 16x16 (vkn_blit гоняет ровно 8 строк);
//   2. ПРАВАЯ ПОЛОВИНА (столбец +8..15) ПУСТА (вывод берёт только левую половину);
//   3. ШИРИНА ЧЕРНИЛ <= 8 пикселей (тогда сдвиг X&7 укладывается в 2 столбца, а при
//      нулевом сдвиге — в 1; ровно так считает габарит vkn_one).
// Проверяются все четыре кадра анимации 0xF0/0xF4/0xF8/0xFC — те, что ставит
// updateKnifeAtt (pat = 0xF0 + (timer & 0x0C)).
//
// Паттерн берётся ИЗ ЖИВОЙ ОЗУ (набор sprites2 распаковывается в vec_spr_buf на старте),
// адрес — по правилу vsp_pat: база = vec_spr_buf + (pat-0xA0)*8, 16 байт левой половины,
// 16 байт правой.
//
// Запуск: node tools/verify/knife_shape_gate.js [rom] [sym]
"use strict";
const { make, toGame } = require("./beam_harness.js");
const T = __dirname;
const ROM = process.argv[2] || T + "/../../build/kvalley_8c.rom";
const SYM = process.argv[3] || T + "/../../build/kvalley_8c.sym";
const E = make(ROM, SYM);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
const { L, rd } = E;
if (L.vec_spr_buf === undefined) { console.log("нет символа vec_spr_buf"); process.exit(2); }
let bad = 0;
for (const pat of [0xF0, 0xF4, 0xF8, 0xFC]) {
  const base = L.vec_spr_buf + ((pat & 0xFC) - 0xA0) * 8;
  const b = []; for (let i = 0; i < 32; i++) b.push(rd(base + i));
  let lastRow = -1, right = 0, minc = 99, maxc = -1;
  for (let r = 0; r < 16; r++) {
    if (b[r]) { lastRow = r;
      for (let c = 0; c < 8; c++) if ((b[r] >> (7 - c)) & 1) { if (c < minc) minc = c; if (c > maxc) maxc = c; } }
    right |= b[16 + r];
  }
  const w = maxc < 0 ? 0 : maxc - minc + 1;
  const rowsOk = lastRow < 8, rightOk = right === 0, wOk = w <= 8;
  if (!(rowsOk && rightOk && wOk)) bad++;
  console.log(`pat 0x${pat.toString(16).toUpperCase()} @0x${base.toString(16)}: строк с чернилами 0..${lastRow}` +
    ` ${rowsOk ? "OK" : "ПРОВАЛ (>7)"}, правая половина ${rightOk ? "пуста OK" : "НЕ ПУСТА — ПРОВАЛ"}` +
    `, ширина ${w} ${wOk ? "OK" : "ПРОВАЛ (>8)"}`);
}
if (bad) { console.log(`ФОРМА НОЖА ИЗМЕНИЛАСЬ: ${bad} паттернов нарушают допущения короткого пути (vkn_blit/vkn_one) — ПРОВАЛ`); process.exit(1); }
console.log("KNIFE SHAPE OK: чернила в 8 верхних строках, правая половина пуста, ширина <= 8");
