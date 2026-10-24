// gameover_wall_gate.js — ГЕЙТ СЦЕНЫ GAME OVER: чистка площадки под надписью обязана
// затрагивать РОВНО прямоугольник оригинала и ничего больше.
//
// ЖАЛОБА С ЖЕЛЕЗА (2026-08-11): при показе GAME OVER пропадают два тайла стены.
//
// ЧТО ПРОВЕРЯЕТ (два независимых среза, оба обязаны быть непустыми):
//  A. МЕХАНИЗМ. Ловушка на PC=setFillVRAM во время clrGameOverArea: пять заливок обязаны
//     идти по адресам 0x3929, 0x3949, 0x3969, 0x3989, 0x39A9, каждая по 12 клеток
//     (оригинал: `ld hl,3929h / ld b,5 / {ld bc,0Ch / call setFillVRAM / ld a,20h /
//     call ADD_A_HL}`, где setFillVRAM СОХРАНЯЕТ HL — он делает out (c),a, а не ld (hl)).
//     Меньше пяти заливок — ПРОВАЛ (выборка пуста), любой адрес мимо — ПРОВАЛ.
//  B. ЭКРАН. Снимок фреймбуфера на входе в clrGameOverArea и на выходе (PC=NextGameStatus_,
//     между ними НИ ОДНОГО кадра — спрайты стоять обязаны). Клетка, изменившаяся ВНЕ
//     прямоугольника ряды 9-13 x столбцы 9-20, — затёртый фон, ПРОВАЛ.
//
// ПОЧЕМУ ГЕЙТ ПАДАЕТ НА ПУСТОЙ ВЫБОРКЕ: не доехали до clrGameOverArea (или до
// NextGameStatus_ после него) — выход 1 с текстом «выборка пуста», а не «ОК».
//
// Запуск: node tools/verify/gameover_wall_gate.js [rom] [sym]
"use strict";
const { make, toGame } = require("./beam_harness.js");

const rom = process.argv[2] || "build/kvalley_8c.rom";
const sym = process.argv[3] || rom.replace(/\.rom$/, ".sym");
const E = make(rom, sym);
const { memory, L, rd, key, run, v06c, cpu } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 0xff, false);

const ZONE_ROW0 = 9, ZONE_ROW1 = 13, ZONE_COL0 = 9, ZONE_COL1 = 20;
const WANT = [0x3929, 0x3949, 0x3969, 0x3989, 0x39a9];

// ТОЛЬКО ФОНОВЫЕ ПЛОСКОСТИ p0/p1/p2. p3 — плоскость СПРАЙТОВ, и она законно меняется
// между снимками: каждый блит клетки тянет за собой vec_su_fixup + vfr_gate (обновить
// save-under и тут же перерисовать фигуру, чей фон переписали). Ловить фон надо в фоне.
const PLANES = 3;
function snap() {
  const out = new Uint8Array(4 * 32 * 256);
  for (let p = 0; p < PLANES; p++)
    for (let col = 0; col < 32; col++)
      for (let lo = 0; lo < 256; lo++)
        out[((p * 32) + col) * 256 + lo] = memory.bytes[memory.tobank(0x8000 + p * 0x2000 + col * 256 + lo)];
  return out;
}
const at = (s, p, col, lo) => s[((p * 32) + col) * 256 + lo];
const cellLo = (row, k) => (255 - row * 8 - k) & 255;

let phase = 0, snapA = null, snapB = null;
const fills = [];
v06c.check_breakpoint = function () {
  if (cpu.pc === L.clrGameOverArea && phase === 0) { phase = 1; snapA = snap(); }
  if (phase === 1 && cpu.pc === L.setFillVRAM)
    fills.push({ hl: cpu.hl(), bc: cpu.bc() });
  if (phase === 1 && cpu.pc === L.NextGameStatus_) { phase = 2; snapB = snap(); }
  return false;
};

console.log(`ROM=${rom}`);
const gs = toGame(E);
if (gs !== 5) { console.error(`ПРОВАЛ: не дошли до геймплея (GameStatus=${gs})`); process.exit(1); }
run(60);
// KV_NO_KILL=1 — НЕГАТИВНЫЙ КОНТРОЛЬ покрытия: не убиваем героя вовсе. Гейт обязан
// упасть с «выборка пуста», а не отрапортовать ОК. Проверено: exit 1.
if (!process.env.KV_NO_KILL) {
  wr(L.Vidas, 0);                     // следующая смерть = Game Over
  key(68, 1); run(6); key(68, 0);     // чит D: штатная смерть мимо гейта God mode
}
for (let f = 0; f < 3000 && phase !== 2; f++) run(1);
// KV_SHOT=путь.png — кадр сцены GAME OVER (идеальный фреймбуфер, без луча) для docs/.
if (process.env.KV_SHOT && phase === 2) { run(40); E.pngFrom(E.idealBmp(), process.env.KV_SHOT); }

let fail = 0;
const chk = (ok, msg) => { if (!ok) { console.log("   ОШИБКА: " + msg); fail++; } };

// --- A. механизм ---------------------------------------------------------------------
console.log(`\nA. ЗАЛИВКИ площадки: ${fills.length}`);
for (const f of fills) {
  const a = f.hl & 0x3fff;
  console.log(`   HL=0x${f.hl.toString(16)} (ряд ${(a - 0x3800) >> 5}, столбец ${a & 31}), BC=${f.bc}`);
}
if (!snapA) { console.error("\nПРОВАЛ: не доехали до clrGameOverArea — выборка пуста, проверять нечего"); process.exit(1); }
if (!snapB) { console.error("\nПРОВАЛ: clrGameOverArea не довела до NextGameStatus_ — выборка пуста"); process.exit(1); }
chk(fills.length === 5, `заливок ${fills.length}, ожидалось 5`);
for (let i = 0; i < Math.min(5, fills.length); i++) {
  chk((fills[i].hl & 0x3fff) === WANT[i],
    `заливка ${i + 1}: HL=0x${(fills[i].hl & 0x3fff).toString(16)}, ожидалось 0x${WANT[i].toString(16)}` +
    ` (setFillVRAM обязана СОХРАНЯТЬ HL — в оригинале она пишет через out (c),a)`);
  chk(fills[i].bc === 0x0c, `заливка ${i + 1}: BC=${fills[i].bc}, ожидалось 12`);
}

// --- B. экран ------------------------------------------------------------------------
const bad = [];
for (let row = 0; row < 32; row++)
  for (let col = 0; col < 32; col++) {
    if (row >= ZONE_ROW0 && row <= ZONE_ROW1 && col >= ZONE_COL0 && col <= ZONE_COL1) continue;
    let d = 0;
    for (let p = 0; p < PLANES; p++)
      for (let k = 0; k < 8; k++) {
        const lo = cellLo(row, k);
        if (at(snapA, p, col, lo) !== at(snapB, p, col, lo)) d++;
      }
    if (d) bad.push({ row, col, d });
  }
console.log(`\nB. КЛЕТКИ, изменившиеся ВНЕ прямоугольника оригинала (ряды ${ZONE_ROW0}-${ZONE_ROW1},` +
  ` столбцы ${ZONE_COL0}-${ZONE_COL1}): ${bad.length}`);
for (const b of bad)
  console.log(`   ряд ${b.row} столбец ${b.col} (name 0x${(0x3800 + b.row * 32 + b.col).toString(16)}), различий байт ${b.d}`);
chk(bad.length === 0, `чистка площадки GAME OVER затёрла ${bad.length} клеток фона вне прямоугольника оригинала`);

if (fail) { console.log(`\nРЕЗУЛЬТАТ: ПРОВАЛ (${fail})`); process.exit(1); }
console.log("\nРЕЗУЛЬТАТ: ОК (5 заливок по адресам оригинала, фон вне площадки не тронут)");
