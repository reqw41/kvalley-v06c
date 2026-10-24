// НЕГАТИВНЫЙ КОНТРОЛЬ ЗОНЫ ПАМЯТИ: «эта зона свободна» — доказательство, а не мнение.
//
// ЗАЧЕМ. Опись памяти в шапке src/v06c/vec_boot.asm дважды за неделю оказывалась ложной
// («0xD100-0xD3FF свободно в p2», «0xF6A0-0xF83F затирает заливка HideSprites»), и оба
// раза это мина: положишь туда данные — получишь мусор на экране или потерю данных.
// Трасса R/W/X (tools/debug/lowram_audit.js) показывает, кто ОБРАЩАЕТСЯ к байтам, но не
// видит ГЛАВНОГО для видеопамяти: зону может никто не читать программно, а луч всё равно
// её показывает. Этот скрипт проверяет именно это.
//
// КАК. Гоняются ДВА эмулятора в лок-степе с одинаковым вводом. Во втором перед КАЖДЫМ
// кадром зона заливается байтом 0xFF. После кадра считается CRC32 кадрового буфера
// (v06c.bmp — то, что реально вывел луч со всеми палитрами). Расхождение CRC хотя бы на
// одном кадре = зона ВИДНА на экране => она НЕ свободна. Совпадение на всём прогоне =
// заливка зоны не влияет ни на картинку, ни на ход игры.
// Дополнительно сверяются игровые переменные (GameStatus/piramideActual): если заливка
// увела логику в сторону, это тоже видно.
//
// СЦЕНАРИЙ (покрывает все экраны, где раскладка памяти разная): логотип Konami -> меню/
// титул -> геймплей пирамиды 1 -> карта долины и пирамида 2 (чит N) -> ещё карта и
// пирамида 3. Заливка идёт ВЕСЬ прогон, включая загрузки уровня.
//
// Запуск: node tools/debug/zone_negctrl.js <lo> <hi> [rom] [sym] [кадров]
//   node tools/debug/zone_negctrl.js d100 d3ff        # «свободная» дыра p2
//   node tools/debug/zone_negctrl.js f6a0 f83f        # хвост буфера спрайтов p3
"use strict";
const {make} = require("../verify/beam_harness.js");
const REPO = __dirname + "/../..";
const LO = parseInt(process.argv[2], 16), HI = parseInt(process.argv[3], 16);
if (!(LO >= 0 && HI >= LO && HI <= 0xffff)) {
  console.error("нужны границы зоны: node zone_negctrl.js <lo16> <hi16> [rom] [sym] [кадров]");
  process.exit(2);
}
const ROM = process.argv[4] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[5] || ROM.replace(/\.rom$/, ".sym");
const NF = parseInt(process.argv[6] || "3000", 10);

const A = make(ROM, SYM), B = make(ROM, SYM);   // A = контроль, B = с заливкой
const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crcBmp(u32) { let c = 0xffffffff;
  for (let i = 0; i < u32.length; i++) { const v = u32[i] >>> 0;
    c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); c = crcT[(c ^ (v >>> 8)) & 0xff] ^ (c >>> 8);
    c = crcT[(c ^ (v >>> 16)) & 0xff] ^ (c >>> 8); c = crcT[(c ^ (v >>> 24)) & 0xff] ^ (c >>> 8); }
  return (c ^ 0xffffffff) >>> 0; }
function fill(E) { const m = E.memory;
  for (let a = LO; a <= HI; a++) m.bytes[m.tobank(a)] = 0xff; }

// один кадр в обоих, заливка только в B; возвращает true, если картинки разошлись
let diffFrames = 0, firstDiff = -1, firstDiffGS = -1, varDiff = 0;
const GS = A.L.GameStatus, PIR = A.L.piramideActual;
function step() {
  fill(B);
  A.v06c.oneInterrupt(true); B.v06c.oneInterrupt(true);
  const d = crcBmp(A.v06c.bmp) !== crcBmp(B.v06c.bmp);
  if (d) { diffFrames++; if (firstDiff < 0) { firstDiff = frame; firstDiffGS = A.rd(GS); } }
  if (A.rd(GS) !== B.rd(GS) || A.rd(PIR) !== B.rd(PIR)) varDiff++;
  frame++;
  return d;
}
const key = (c, d) => { A.key(c, d); B.key(c, d); };
let frame = 0;
const gsSeen = {};
function run(n) { for (let i = 0; i < n && frame < NF; i++) { step(); gsSeen[A.rd(GS)] = (gsSeen[A.rd(GS)] || 0) + 1; } }

run(400);                                     // логотип Konami + титул
for (let blk = 0; blk < 60 && A.rd(GS) !== 5; blk++) {   // старт партии
  for (let f = 0; f < 25 && A.rd(GS) !== 5; f++) { key(32, 1); run(1); }
  key(32, 0); run(5);
}
run(200);                                     // геймплей пирамиды 1
for (let hop = 0; hop < 2; hop++) {           // карта долины + следующая пирамида
  key(78, 1); run(3); key(78, 0);
  for (let f = 0; f < 900 && A.rd(GS) !== 5; f++) run(1);
  run(150);
}
while (frame < NF) run(50);

console.log(`зона 0x${LO.toString(16)}-0x${HI.toString(16)} (${HI - LO + 1} Б), ${frame} кадров, ` +
            `ROM=${ROM.split("/").pop()}`);
console.log(`  экраны в прогоне (GameStatus:кадров): ${JSON.stringify(gsSeen)}`);
console.log(`  кадров с РАЗНОЙ картинкой: ${diffFrames}` +
            (firstDiff >= 0 ? ` (первый — кадр ${firstDiff}, GameStatus=${firstDiffGS})` : ""));
console.log(`  кадров с разошедшимися GameStatus/piramideActual: ${varDiff}`);
if (diffFrames || varDiff) {
  console.log("ВЕРДИКТ: зона ВЛИЯЕТ на кадр/логику — она НЕ свободна");
  process.exit(1);
}
console.log("ВЕРДИКТ: заливка 0xFF каждый кадр не изменила ни кадра — зона свободна");
