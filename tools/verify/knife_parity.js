// knife_parity.js — СВЕРКА КАРТИНКИ ПО ИГРОВЫМ ТИКАМ НА СЦЕНЕ С НОЖОМ (задача #46).
//
// ЗАЧЕМ. coltab_frame_parity.js гоняет штатную раскладку клавиш, в которой герой НИ РАЗУ
// не бросает нож, — то есть ровно тот путь, который правится задачей #46, там не
// исполняется. Здесь та же сверка (три видимые плоскости байт в байт на каждом
// контрольном тике), но сцена — «нож в руке + импульсы FIRE», как в knife_cost.js.
//
// ВВОД ПО ТИКАМ и один и тот же форс на обеих сборках, иначе они разойдутся по игре.
// ГРАБЛИ ФОРСА — см. knife_cost.js: нож в руку даём только когда он свободен (статус<=2),
// иначе бросок перехватывает нож посреди отскока и оставляет спрайт-призрак.
//
// Если байты расходятся — печатается, СКОЛЬКО из них лежит внутри габаритов ножей
// (слоты 15-18 обеих сборок, 16x16 вокруг Y,X): правка про производительность обязана
// давать НОЛЬ расхождений, правка про примесь — расхождения ТОЛЬКО в пикселях ножа.
//
// Запуск: node tools/verify/knife_parity.js <до.rom> <после.rom> [тиков=1200]
"use strict";
const { make } = require("./beam_harness.js");
const A = make(process.argv[2], process.argv[2].replace(/\.rom$/, ".sym"));
const B = make(process.argv[3], process.argv[3].replace(/\.rom$/, ".sym"));
const NT = +(process.argv[4] || 1200);
for (const M of [A, B]) { M.tick = 0; M.prevT = M.rd(M.L.timer); M.held = new Set(); M.frames = 0; }

function keysFor(t) {
  const k = [];
  if (t < 260) { if ((t >> 2) & 1) k.push(32); return k; }
  if ((t & 31) < 16) k.push(39); else k.push(37);
  if ((t & 15) === 3) k.push(32);
  return k;
}
function setKeys(M, t) {
  const want = new Set(keysFor(t));
  for (const c of M.held) if (!want.has(c)) M.key(c, 0);
  for (const c of want) if (!M.held.has(c)) M.key(c, 1);
  M.held = want;
}
function snap(M) {
  const b = new Uint8Array(3 * 8192);
  for (let i = 0; i < 8192; i++) {
    b[i] = M.memory.read(0x8000 + i); b[8192 + i] = M.memory.read(0xA000 + i); b[16384 + i] = M.memory.read(0xC000 + i);
  }
  return b;
}
function toTick(M, T) {
  while (M.tick <= T && M.frames < 400000) {
    setKeys(M, M.tick);
    if (M.tick >= 260) { const st = M.rd(M.L.knifesData);
      if (st <= 2) { M.memory.write(M.L.objetoCogido, 0x10, false); M.memory.write(M.L.IDcuchilloCoge, 0, false); } }
    M.v06c.oneInterrupt(true); M.frames++;
    const t = M.rd(M.L.timer); if (t !== M.prevT) { M.prevT = t; M.tick++; }
  }
  return snap(M);
}
// габариты ножей обеих сборок: байт fb (плоскость, столбец, строка) внутри 16x16 вокруг Y,X
function knifeBoxes(M) {
  const out = [];
  for (let i = 15; i <= 18; i++) {
    const a = M.L.sprAttrib + i * 4;
    const Y = M.rd(a), X = M.rd(a + 1);
    if (Y >= 0xD0) continue;
    const lo = (239 - Y) & 255, c0 = (X >> 3) & 31;
    out.push({ lo, c0 });
  }
  return out;
}
function inBox(boxes, plane, col, row) {
  for (const b of boxes) if (col >= b.c0 && col <= b.c0 + 2 && row >= b.lo && row <= b.lo + 15) return true;
  return false;
}
let bad = 0, checked = 0, firstBad = -1, totalDiff = 0, diffInKnife = 0;
for (let T = 20; T <= NT; T += 10) {
  const sa = toTick(A, T), sb = toTick(B, T);
  checked++;
  const boxes = knifeBoxes(A).concat(knifeBoxes(B));
  let d = 0, dk = 0;
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) {
    d++; const plane = (i / 8192) | 0, off = i % 8192, col = (off >> 8) & 31, row = off & 255;
    if (inBox(boxes, plane, col, row)) dk++;
  }
  if (d) { bad++; totalDiff += d; diffInKnife += dk; if (firstBad < 0) firstBad = T; }
  if (T % 500 === 0) process.stderr.write(` ${T}`);
}
process.stderr.write("\n");
console.log(`СЦЕНА С НОЖОМ: ${checked} контрольных тиков (каждый 10-й, тики 20..${NT})`);
console.log(`  кадров потрачено: до=${A.frames}, после=${B.frames} (${(100 * (A.frames - B.frames) / A.frames).toFixed(1)}% меньше кадров на ту же игру)`);
console.log(`  GS до=${A.rd(A.L.GameStatus)} после=${B.rd(B.L.GameStatus)}`);
if (!bad) { console.log("ВЕРДИКТ: плоскости совпадают БАЙТ В БАЙТ на каждом контрольном тике — OK"); process.exit(0); }
console.log(`РАСХОЖДЕНИЕ на ${bad} тиках из ${checked}, первое — тик ${firstBad}`);
console.log(`  байт разошлось всего ${totalDiff}, из них в габаритах ножа ${diffInKnife} (${(100 * diffInKnife / totalDiff).toFixed(1)}%)`);
process.exit(1);
