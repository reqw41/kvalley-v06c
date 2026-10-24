// stair_top_probe.js — ЗАДАЧА #55: ВЕРХНЯЯ ПЛОЩАДКА ЛЕСТНИЦЫ НА ВСЕХ ЧЕТЫРЁХ СХЕМАХ КАМНЯ.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СТЕНД. Площадка красится ЧЕТЫРЬМЯ цветами, из которых один (тёмно-жёлтый
// оригинала) ЖИВЁТ В РАЗНЫХ СЛОТАХ ПАЛИТРЫ на разных схемах: idx8 на схеме 0, idx10 на
// схемах 1..3 (формула задачи #54). Проверка «на пирамиде 1 всё жёлтое» ничего не значит —
// ровно так задача #54 и поймала рычаг, который был синим на схемах 1..3. Поэтому читом N
// обходятся пирамиды 1/5/9/13 (по одной на схему), и слот проверяется НЕ ПО НОМЕРУ, а по
// РЕАЛЬНОМУ RGB палитры, снятому В МОМЕНТ ОТРИСОВКИ клетки.
//
// ЭТАЛОН (снят с картриджа стендом tools/gfx/msx_stair_ref.js, VRAM 0x0000+тайл*8):
//   0x73/0x82  ea f9 f0 f0 f0 f0 f0 f0     0x74/0x83  ea ef f0 f0 f0 f0 f0 f0
//   MSX E=серый(14) A=тёмно-жёлтый(10) F=белый(15) 9=светло-красный
// ЧТО ОБЯЗАН ДАТЬ БЛИТТЕР (idx = p0*8+p1*4+p2*2):
//   строка 0 у всех четырёх: перо idx2 СЕРЫЙ, фон = ЖЁЛТЫЙ СЛОТ СХЕМЫ (idx8 или idx10);
//   строка 1 у 0x73/0x82:    перо idx12 БЕЛЫЙ, фон idx6 СВЕТЛО-КРАСНЫЙ;
//   строка 1 у 0x74/0x83:    перо idx2 СЕРЫЙ,  фон idx12 БЕЛЫЙ;
//   строки 2-7 у всех:       перо idx12 БЕЛЫЙ, фон idx0 ЧЁРНЫЙ (как у тела лестницы).
// «Перо» и «фон» берутся ИЗ ПАТТЕРНА тайла, прочитанного из pat_maze_cell, — стенд не
// повторяет логику блиттера, он сверяет пиксель с ТЕМ ЖЕ паттерном, что рисует игра.
//
// КОНТРОЛЬ ТЕЛА ЛЕСТНИЦЫ 0x75/0x76/0x84/0x85: они обязаны ОСТАТЬСЯ чисто белыми (idx12 по
// шейпу, idx0 по фону). Если правка площадки заденет тело — это видно здесь, а не на глаз.
//
// Запуск: node tools/verify/stair_top_probe.js [rom] [sym] [--png КАТАЛОГ]
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
function writePng(out, W, H, px) {           // px: Uint32Array ABGR (как кладёт filler)
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) { const c = px[y * W + x] >>> 0, o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = c & 255; raw[o + 1] = (c >> 8) & 255; raw[o + 2] = (c >> 16) & 255; } }
  function crc32(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; }
  const ch = (t, d) => { const b = Buffer.concat([Buffer.from(t, "ascii"), d]);
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b), 0); return Buffer.concat([l, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ch("IHDR", ihdr), ch("IDAT", zlib.deflateSync(raw)), ch("IEND", Buffer.alloc(0))]));
}
const { make } = require("./beam_harness.js");
const T = __dirname;
const pos = process.argv.slice(2).filter(a => /\.(rom|sym)$/.test(a));
const ROM = pos[0] || T + "/../../build/kvalley_8c.rom";
const SYM = pos[1] || ROM.replace(/\.rom$/, ".sym");
const gi = process.argv.indexOf("--png"), PNGDIR = gi > 0 ? process.argv[gi + 1] : null;
if (PNGDIR) fs.mkdirSync(PNGDIR, { recursive: true });
const E = make(ROM, SYM);
const { L, rd, v06c, run, key, cpu } = E;
const need = n => { if (L[n] === undefined) { console.log(`нет символа ${n} в ${SYM}`); process.exit(2); } return L[n]; };
const A = {};
for (const n of ["GameStatus", "piramideActual", "flagPiramideMap"]) A[n] = need(n);
need("pat_maze_cell"); need("vbt8_ent"); need("vbt8_e"); need("vw_byte");

// ОЖИДАНИЯ ПО СТРОКАМ: [индекс пера, индекс фона]. YEL = «жёлтый слот схемы», проверяется
// не номером, а RGB (см. isYellow): на схеме 0 это idx8, на схемах 1..3 idx10.
const YEL = "YEL";
const TOPA = [[2, YEL], [12, 6], [12, 0], [12, 0], [12, 0], [12, 0], [12, 0], [12, 0]];
const TOPB = [[2, YEL], [2, 12], [12, 0], [12, 0], [12, 0], [12, 0], [12, 0], [12, 0]];
const BODY = [[12, 0], [12, 0], [12, 0], [12, 0], [12, 0], [12, 0], [12, 0], [12, 0]];
const WANT = { 0x73: TOPA, 0x82: TOPA, 0x74: TOPB, 0x83: TOPB,
               0x75: BODY, 0x76: BODY, 0x84: BODY, 0x85: BODY };
const NAME = { 0x73: "верх ▶ лев", 0x74: "верх ▶ прав", 0x82: "верх ◀ прав", 0x83: "верх ◀ лев",
               0x75: "тело ▶ лев", 0x76: "тело ▶ прав", 0x84: "тело ◀ прав", 0x85: "тело ◀ лев" };
const WATCH = new Set(Object.keys(WANT).map(Number));

const idxAt = (col, lo, b) => { const a = 0x8000 + ((col & 31) << 8) + (lo & 255);
  return ((rd(a) >> b) & 1) << 3 | ((rd(a + 0x2000) >> b) & 1) << 2 | ((rd(a + 0x4000) >> b) & 1) << 1; };
const palette = () => v06c.filler ? v06c.filler.palette : E.io.Palette;
// ПОРЯДОК БАЙТ СЛОТА — ABGR, а не ARGB (грабля задачи #54: прочитанный наоборот красный
// объявляется синим, и стенд рапортует «жёлтых 0» при верной картинке).
const rgbOf = v => { v = v >>> 0; return { r: v & 255, g: (v >> 8) & 255, b: (v >> 16) & 255 }; };
const hexOf = v => { const c = rgbOf(v); return [c.r, c.g, c.b].map(x => x.toString(16).padStart(2, "0")).join(""); };
const isYellow = v => { const c = rgbOf(v); return c.r >= 0xA0 && c.g >= 0x80 && c.b <= 0x80; };
// Паттерн тайла — из того же кэша, что читает блиттер (тайлы лабиринта с 0x40).
const patRow = (tile, r) => rd(L.pat_maze_cell + (tile - 0x40) * 8 + r);

let seen, card, curPira = -1;
let tCol = 0, tNo = 0, tSP = -1, tRet = -1;
v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (pc === L.vbt8_ent) { const t = rd(L.vw_byte);
    if (WATCH.has(t)) { tNo = t; tCol = cpu.reg(1); tSP = cpu.sp;
      tRet = E.memory.read(cpu.sp, false) | (E.memory.read(cpu.sp + 1, false) << 8); } }
  else if (tSP >= 0 && pc === tRet && cpu.sp > tSP) {
    tSP = -1;
    if (curPira >= 0 && rd(A.piramideActual) !== curPira) return false;
    const e = rd(L.vbt8_e), P = palette();
    const px = []; for (let r = 0; r < 8; r++) { const row = [];
      for (let b = 7; b >= 0; b--) row.push(idxAt(tCol, (e - r) & 255, b)); px.push(row); }
    const rec = seen.get(tNo) || { cells: 0, bad: [], pal: new Map(), at: new Set() };
    rec.cells++;
    // КООРДИНАТА КЛЕТКИ (столбец/ряд) — в том же виде, в каком их печатает coltab_frame_parity.
    // Нужна, чтобы доказать: расхождение кадров после правки лежит ТОЛЬКО в клетках площадки.
    rec.at.add(`c${tCol}/r${(255 - e) >> 3}`);
    for (const i of [0, 2, 6, 8, 10, 12]) rec.pal.set(i, P[i] >>> 0);
    for (let r = 0; r < 8; r++) {
      const pat = patRow(tNo, r), [wFg, wBg] = WANT[tNo][r];
      for (let b = 7; b >= 0; b--) {
        const on = (pat >> b) & 1, want = on ? wFg : wBg, got = px[r][7 - b];
        const ok = want === YEL ? isYellow(P[got] >>> 0) : got === want;
        if (!ok) rec.bad.push(`строка ${r} пикс ${7 - b} (${on ? "перо" : "фон"}): ждали ` +
          `${want === YEL ? "ЖЁЛТЫЙ слот" : "idx" + want}, получили idx${got} ${hexOf(P[got])}`);
      }
    }
    seen.set(tNo, rec);
    if (PNGDIR && !card.has(tNo)) card.set(tNo, px.map(row => row.map(i => P[i] >>> 0)));
  }
  return false;
};

run(700);
for (let i = 0; i < 30; i++) { key(32, 1); run(3); key(32, 0); run(3); }
if (rd(A.piramideActual) !== 1) { console.log(`ПРОВАЛ: старт дал пирамиду ${rd(A.piramideActual)}, ждали 1`); process.exit(1); }

const SCHEME = p => ((p - 1) >> 2) & 3;
let bad = 0, checkedCells = 0, missing = [];
for (const target of [1, 5, 9, 13]) {
  // ГИСТОГРАММА ЧИСТИТСЯ ДО ПЕРЕХОДА, А НЕ ПОСЛЕ. Лабиринт рисуется ОДИН РАЗ — при входе в
  // комнату, то есть ровно внутри перехода. Первая версия стенда чистила её после прибытия
  // и жила на том, что герой успеет перейти в соседнюю комнату; на пирамиде 13 он не успевал,
  // и стенд отчитывался «НЕ ВСТРЕТИЛСЯ» по всем восьми тайлам — это была дыра ПОКРЫТИЯ, а
  // не пропавшая лестница. Фильтр curPira отсекает кадры чужой пирамиды, поэтому чистка
  // заранее безопасна: до прибытия в гистограмму ничего не попадёт.
  seen = new Map(); card = new Map(); curPira = target;
  while (rd(A.piramideActual) < target) {
    const before = rd(A.piramideActual);
    key(78, true); run(3); key(78, false);
    for (let f = 0; f < 4000 && !(rd(A.GameStatus) === 5 && rd(A.piramideActual) !== before); f++) v06c.oneInterrupt(true);
  }
  const pira = rd(A.piramideActual);
  // ПЕРЕРИСОВКА СОСЕДНИХ КОМНАТ: гоняем героя, чтобы в выборку попал не один экран.
  for (let f = 0; f < 900; f++) { if ((f & 63) < 32) key(39, true); else { key(39, false); key(37, true); }
    v06c.oneInterrupt(true); if (rd(A.piramideActual) !== pira) break; }
  key(39, false); key(37, false);

  const sc = SCHEME(pira);
  const yel = [...seen.values()][0];
  console.log(`\n===== ПИРАМИДА ${pira} (схема ${sc}) =====`);
  if (yel) console.log(`  палитра в момент отрисовки: idx2=${hexOf(yel.pal.get(2))} idx6=${hexOf(yel.pal.get(6))}` +
    ` idx8=${hexOf(yel.pal.get(8))} idx10=${hexOf(yel.pal.get(10))} idx12=${hexOf(yel.pal.get(12))}`);
  for (const t of Object.keys(WANT).map(Number)) {
    const r = seen.get(t);
    if (!r) { console.log(`  0x${t.toString(16)} ${NAME[t].padEnd(12)} НЕ ВСТРЕТИЛСЯ`); missing.push(`pyr${pira}/0x${t.toString(16)}`); continue; }
    checkedCells += r.cells;
    if (r.bad.length) { bad++;
      console.log(`  0x${t.toString(16)} ${NAME[t].padEnd(12)} клеток ${r.cells}  ❌ расхождений ${r.bad.length}`);
      for (const m of r.bad.slice(0, 4)) console.log(`        ${m}`);
    } else console.log(`  0x${t.toString(16)} ${NAME[t].padEnd(12)} клеток ${r.cells}  ✅ совпало с эталоном MSX`);
  }
  if (process.argv.includes("--cells")) {
    const tops = [0x73, 0x74, 0x82, 0x83].flatMap(t => [...(seen.get(t)?.at || [])]).sort();
    console.log(`  клетки ПЛОЩАДКИ (${tops.length}): ${tops.join(" ")}`);
    const body = [0x75, 0x76, 0x84, 0x85].flatMap(t => [...(seen.get(t)?.at || [])]).sort();
    console.log(`  клетки ТЕЛА (${body.length}): ${body.join(" ")}`);
  }
  if (PNGDIR && card.size) {
    const ids = [...card.keys()].sort((a, b) => a - b), S = 12, GAP = 4;
    const W = 8 * S, H = ids.length * (8 * S + GAP) - GAP, buf = new Uint32Array(W * H);
    ids.forEach((id, n) => { const px = card.get(id);
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const v = px[r][c];
        for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) buf[(n * (8 * S + GAP) + r * S + dy) * W + c * S + dx] = v; } });
    writePng(path.join(PNGDIR, `stair_pyr${String(pira).padStart(2, "0")}_scheme${sc}.png`), W, H, buf);
    console.log(`  карточки клеток (сверху вниз ${ids.map(i => "0x" + i.toString(16)).join(", ")}):` +
      ` stair_pyr${String(pira).padStart(2, "0")}_scheme${sc}.png`);
    // ПАРАМИ, КАК ЭТО ВИДНО НА ЭКРАНЕ: площадка — полоса в 16 пикселей из двух клеток, и
    // асимметрия строки 1 (розовая подсветка с одной стороны, серая кромка с другой) на
    // одиночной карточке не читается. Ровно эти картинки идут в сверку с MSX-эталоном.
    for (const [l, r, tag] of [[0x73, 0x74, "right"], [0x83, 0x82, "left"]]) {
      if (!card.has(l) || !card.has(r)) continue;
      const S = 12, W = 16 * S, H = 8 * S, buf = new Uint32Array(W * H);
      for (let r0 = 0; r0 < 8; r0++) for (let c = 0; c < 16; c++) {
        const v = (c < 8 ? card.get(l)[r0][c] : card.get(r)[r0][c - 8]);
        for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) buf[(r0 * S + dy) * W + c * S + dx] = v;
      }
      writePng(path.join(PNGDIR, `pair_${tag}_pyr${String(pira).padStart(2, "0")}_scheme${sc}.png`), W, H, buf);
    }
  }
}
// ГЕЙТ ОБЯЗАН ПАДАТЬ НА ПУСТОЙ ВЫБОРКЕ: если ни одна клетка не проверена, «зелёный» ничего
// не значит. Отсутствие тайла на какой-то пирамиде — тоже провал: лестницы есть везде.
console.log(`\nПОКРЫТИЕ: проверено клеток ${checkedCells} на 4 схемах, тайлов под наблюдением ${WATCH.size}`);
if (!checkedCells) { console.log("❌ ГЕЙТ ПУСТ: ни одной клетки лестницы не отрисовано"); process.exit(1); }
if (missing.length) { console.log(`❌ НЕ ВСТРЕТИЛИСЬ: ${missing.join(", ")}`); process.exit(1); }
console.log(bad ? `❌ ГЕЙТ КРАСНЫЙ: тайлов с расхождением ${bad}` : "✅ ГЕЙТ ЗЕЛЁНЫЙ: площадка и тело лестницы совпали с эталоном MSX на всех 4 схемах");
process.exit(bad ? 1 : 0);
