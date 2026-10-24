// ГЕНЕРАТОР КОМПИЛИРОВАННОГО СПРАЙТА (M3 recon/prototype — "compiled sprites",
// техника Rockman16/OldTower: "данные И ЕСТЬ код", см.
// docs/reference/OLDTOWER_ANALYSIS.md §8 и .superpowers/sdd/m3-compiled-recon-report.md).
//
// Задача: для ОДНОГО (frame,shift,color) сгенерировать ПРЯМОЛИНЕЙНЫЙ (без
// циклов/LUT-поиска) блок i8080-кода, который рисует спрайт 16x16 в
// план0/план1 (см. v2/driver_vector.asm spr_col/spc_wr1/spc_wr2 — тот же
// формат: OR-композиция для план1/red/ochre, AND-NOT для план0 white).
//
// КЛЮЧЕВАЯ ИДЕЯ (по указанию координатора — колоночно-ориентированный
// PUSH-стрим): в framebuffer'е Вектора-06Ц ОДНА байт-колонка экрана — это
// 256 ПОСЛЕДОВАТЕЛЬНЫХ адресов (H фиксирован = план+колонка, L = строка,
// убывает на 1 каждую строку вниз, см. driver_vector.asm spr_col: "dec l" на
// каждую строку). Это ЗНАЧИТ, что цепочка PUSH (SP = графический курсор,
// каждый PUSH пишет 2 ПОСЛЕДОВАТЕЛЬНЫХ байта по убывающим адресам) может
// пройтись по ВЕРТИКАЛЬНОМУ пробегу байт-колонки напрямую — НО только для
// "сплошных" (solid, все 8 бит спрайта) строк: PUSH пишет БЕЗУСЛОВНО, без
// чтения фона, поэтому для смешанных (mixed, край фигуры) строк нужен
// read-modify-write с ЗАПЕЧЁННОЙ маской (ani/or иммедиат, без рантайм-поиска).
// Прозрачные (s=0) строки не пишутся вовсе (курсор просто пропускает их).
//
// Классификация — НЕ по исходному байту паттерна, а по ИТОГОВОМУ байту
// экранной колонки (после сдвига X&7 и объединения "next" одной половины
// спрайта с "cur" соседней — см. §"MERGE" ниже, разрешено алгебраически:
// OR ассоциативен, AND-NOT по де Моргану тоже) — это позволяет распознать
// "solid" (0xFF) и в межколоночных стыках, а не только при shift=0.
//
// ФОРМАТ ВЫВОДА: genCompiledSprite(...) возвращает {lines, stats}. lines —
// массив строк ассемблера (sjasm Z80-подмножество, см. docs/reference —
// НЕ Z80-only опкоды, только i8080-легальные). Routine МОЖЕТ вызываться как
// обычная call/ret процедура (сама делает di/сохранение SP/PUSH-хайджек/
// восстановление SP/ei вокруг себя, см. sps_restore_sprite в driver_vector.asm
// — тот же приём, что и там: "внутри хайджек-окна нет ни одного call/ret").
//
// Вход HL при вызове = адрес БАЙТА план1, колонка0 (X>>3), строка0
// (то есть В ТОЧНОСТИ то же самое HL, что вычисляет spr_col ПЕРЕД своим
// циклом — H = 0A0h+((X>>3)&1Fh), L = ~vw_spry). Colour/shift/frame —
// ЗАПЕЧЕНЫ (это и есть "компиляция": один routine на КОНКРЕТНУЮ комбинацию).
//
// УПРОЩЕНИЕ ПРОТОТИПА (см. отчёт, честно указано): границы экрана (next-байт
// колонки уезжает за 31-ю колонку, см. driver_vector.asm "cp 0C0h"/"cp 0A0h")
// в ЭТОЙ версии генератора НЕ проверяются в рантайме — колонки считаются
// ВСЕГДА валидными. Для полного роллаута нужно вернуть per-колонку проверку
// (один раз на колонку, не на строку — дёшево, см. отчёт §"остаётся сделать").
"use strict";

function hex8(n) {
  n = n & 0xff;
  const s = n.toString(16).toUpperCase().padStart(2, "0");
  return (/^[0-9]/.test(s) ? s : "0" + s) + "h";
}
function hex16(n) {
  n = n & 0xffff;
  const s = n.toString(16).toUpperCase().padStart(4, "0");
  return (/^[0-9]/.test(s) ? s : "0" + s) + "h";
}

// classify(vals, mode) -> 16 записей {kind:'skip'} | {kind:'solid',lit} |
// {kind:'mixed',op:'or'|'and',imm}
function classify(vals, mode) {
  return vals.map((v) => {
    v &= 0xff;
    if (v === 0x00) return { kind: "skip" };
    if (v === 0xff) return { kind: "solid", lit: mode === "ANDNOT" ? 0x00 : 0xff };
    if (mode === "ANDNOT") return { kind: "mixed", op: "and", imm: (~v) & 0xff };
    return { kind: "mixed", op: "or", imm: v };
  });
}

// segment(ops) -> список {kind,len,lit?,op?,imm?} — соседние 'skip'/'solid'
// схлопнуты в пробег (тот же литерал по построению — 0xFF или 0x00
// константа режима), 'mixed' — по одному (не схлопывается: у каждой строки
// свой immediate).
function segment(ops) {
  const segs = [];
  let i = 0;
  while (i < ops.length) {
    const k = ops[i].kind;
    if (k === "mixed") {
      segs.push({ kind: "mixed", len: 1, op: ops[i].op, imm: ops[i].imm });
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && ops[j].kind === k) j++;
    segs.push({ kind: k, len: j - i, lit: ops[i].lit });
    i = j;
  }
  return segs;
}

// Кодогенерация ОДНОГО стрима (16 байт одной колонки одной плоскости).
// stats аккумулирует счётчики для отчёта (транспарент/solid/mixed байт,
// число push/rmw-касаний, предсказанные такты по стандартной табличке i8080).
const T = {
  movRR: 5, mviR: 7, movRM: 7, movMR: 7, mviM: 10,
  lxi: 10, lhld: 16, shld: 16, dad: 10, sphl: 5,
  push: 11, pop: 10, inx: 5, dcx: 5, inr: 5, dcr: 5,
  ani: 7, ori: 7, adi: 7, sui: 7, di: 4, ei: 4, ret: 10, call: 17, jp: 10, nop: 4,
};

function genStream(lines, stats, ops, { entryLabel, deltaH, streamName }) {
  lines.push(`        ; --- стрим ${streamName} (запечено: колонка/плоскость), deltaH=${deltaH & 0xff} ---`);
  lines.push(`        ld      hl, (${entryLabel})`);
  stats.cycles += T.lhld;
  if ((deltaH & 0xff) !== 0) {
    lines.push(`        ld      a, h`);
    lines.push(`        add     a, ${hex8(deltaH)}`);
    lines.push(`        ld      h, a`);
    stats.cycles += T.movRR + T.adi + T.movRR;
  }
  const segs = segment(ops);
  for (const seg of segs) {
    if (seg.kind === "skip") {
      stats.transparent += seg.len;
      if (seg.len <= 3) {
        for (let k = 0; k < seg.len; k++) { lines.push(`        dec     l`); stats.cycles += T.dcr; }
      } else {
        lines.push(`        ld      a, l`);
        lines.push(`        sub     ${seg.len}`);
        lines.push(`        ld      l, a`);
        stats.cycles += T.movRR + T.sui + T.movRR;
      }
    } else if (seg.kind === "mixed") {
      stats.mixed += 1;
      stats.rmwTouches += 1;
      lines.push(`        ld      a, (hl)`);
      lines.push(`        ${seg.op}      ${hex8(seg.imm)}`);
      lines.push(`        ld      (hl), a`);
      lines.push(`        dec     l`);
      stats.cycles += T.movRM + T.ori + T.movMR + T.dcr;
    } else { // solid
      stats.solid += seg.len;
      const N = seg.len;
      if (N === 1) {
        lines.push(`        ld      (hl), ${hex8(seg.lit)}`);
        lines.push(`        dec     l`);
        stats.cycles += T.mviM + T.dcr;
        stats.solidSingleTouches += 1;
      } else {
        const pairs = Math.floor(N / 2);
        lines.push(`        inc     l`);
        lines.push(`        ld      sp, hl`);
        lines.push(`        ld      bc, ${hex16((seg.lit << 8) | seg.lit)}`);
        stats.cycles += T.inr + T.sphl + T.lxi;
        for (let p = 0; p < pairs; p++) { lines.push(`        push    bc`); stats.cycles += T.push; }
        stats.pushPairs += pairs;
        lines.push(`        ld      hl, 0`);
        lines.push(`        add     hl, sp`);
        lines.push(`        dec     l`);
        stats.cycles += T.lxi + T.dad + T.dcr;
        if (N % 2 === 1) {
          lines.push(`        ld      (hl), ${hex8(seg.lit)}`);
          lines.push(`        dec     l`);
          stats.cycles += T.mviM + T.dcr;
          stats.solidSingleTouches += 1;
        }
      }
    }
  }
}

// genCompiledSprite({label, pattern32, shift, color}) -> {lines, stats}
//   pattern32: Array(32) сырых байт паттерна (0..15 левая колонка, 16..31
//              правая — см. driver_vector.asm "паттерн 32 байта на кадр").
//   shift:     0..7 (X&7)
//   color:     'white' | 'red' | 'ochre' (см. vec_cmap)
function genCompiledSprite({ label, pattern32, shift, color }) {
  if (pattern32.length !== 32) throw new Error("pattern32 должен быть 32 байта");
  const leftP = pattern32.slice(0, 16);
  const rightP = pattern32.slice(16, 32);

  let columns; // [{name, hiDelta, vals}]
  if (shift === 0) {
    columns = [
      { name: "col0", hiDelta: 0, vals: leftP.slice() },
      { name: "col1", hiDelta: 1, vals: rightP.slice() },
    ];
  } else {
    const col0 = leftP.map((p) => (p >>> shift) & 0xff);
    const col2 = rightP.map((p) => (p << (8 - shift)) & 0xff);
    const col1 = leftP.map((p, i) => (((p << (8 - shift)) & 0xff) | (rightP[i] >>> shift)) & 0xff);
    columns = [
      { name: "col0", hiDelta: 0, vals: col0 },
      { name: "col1", hiDelta: 1, vals: col1 },
      { name: "col2", hiDelta: 2, vals: col2 },
    ];
  }

  let planes;
  if (color === "white") planes = [{ name: "plane1", hiDelta: 0, mode: "OR" }, { name: "plane0", hiDelta: -0x20, mode: "ANDNOT" }];
  else if (color === "red") planes = [{ name: "plane1", hiDelta: 0, mode: "OR" }, { name: "plane0", hiDelta: -0x20, mode: "OR" }];
  else if (color === "ochre") planes = [{ name: "plane0", hiDelta: -0x20, mode: "OR" }];
  else throw new Error("color должен быть white|red|ochre, получено " + color);

  const stats = { transparent: 0, solid: 0, mixed: 0, rmwTouches: 0, pushPairs: 0, solidSingleTouches: 0, cycles: 0, streams: 0 };
  const lines = [];
  const entryLabel = `${label}_entry`;
  const realspLabel = `${label}_realsp`;

  lines.push(`; --- ${label}: КОМПИЛИРОВАННЫЙ спрайт (АВТОГЕНЕРИРОВАНО gen_compiled_sprite.js) ---`);
  lines.push(`; frame pattern запечён, shift=${shift}, color=${color}. Вход: HL = план1 колонка0 строка0`);
  lines.push(`; (то же HL, что вычисляет spr_col до цикла). Сама di/hijack-SP/ei вокруг себя.`);
  lines.push(`${label}:`);
  lines.push(`        ld      (${entryLabel}), hl   ; кэш входного HL (до порчи регистров)`);
  lines.push(`        di                      ; --- ХАЙДЖЕК SP: начало (см. sps_restore_sprite) ---`);
  lines.push(`        ld      hl, 0`);
  lines.push(`        add     hl, sp`);
  lines.push(`        ld      (${realspLabel}), hl  ; сохранить РЕАЛЬНЫЙ SP`);
  stats.cycles += T.shld + T.di + T.lxi + T.dad + T.shld;

  for (const col of columns) {
    for (const pl of planes) {
      const ops = classify(col.vals, pl.mode);
      const deltaH = (col.hiDelta + pl.hiDelta) & 0xff;
      genStream(lines, stats, ops, { entryLabel, deltaH, streamName: `${col.name}/${pl.name}` });
      stats.streams++;
    }
  }

  lines.push(`        ld      hl, (${realspLabel})`);
  lines.push(`        ld      sp, hl          ; --- ХАЙДЖЕК SP: восстановлен ---`);
  lines.push(`        ei`);
  lines.push(`        ret`);
  stats.cycles += T.lhld + T.sphl + T.ei + T.ret;
  lines.push(`${entryLabel}:      dw      0`);
  lines.push(`${realspLabel}:     dw      0`);
  lines.push(`${label}_end:`);

  // Всего байт-касаний экрана (для cyc/byte): каждая non-transparent строка
  // КАЖДОЙ обработанной стримом строки — это ОДНА запись в ОДНУ плоскость.
  const totalTouchedBytes = stats.solid + stats.mixed;
  stats.totalTouchedBytes = totalTouchedBytes;
  stats.cyclesPerByte = totalTouchedBytes ? stats.cycles / totalTouchedBytes : 0;

  return { lines, stats, label };
}

module.exports = { genCompiledSprite, classify, segment, hex8, hex16 };

// --- CLI-режим (демонстрация/отладка): node gen_compiled_sprite.js ---
if (require.main === module) {
  const demoPattern = [
    0x00, 0x03, 0x07, 0x00, 0x0f, 0x10, 0x00, 0x00, 0x00, 0x06, 0x03, 0x03, 0x13, 0x11, 0x18, 0x00,
    0x00, 0x80, 0xc0, 0x00, 0xe0, 0x10, 0x00, 0x00, 0x00, 0xc0, 0xc0, 0x80, 0x80, 0x00, 0x30, 0x10,
  ];
  const { lines, stats } = genCompiledSprite({ label: "csp_demo", pattern32: demoPattern, shift: 1, color: "white" });
  console.log(lines.join("\n"));
  console.error(JSON.stringify(stats, null, 2));
}
