// Аналитический счёт тактов i8080 для горячих циклов демо metalgear-v06c.
// Нужен как НЕЗАВИСИМАЯ сверка эмуляторного замера: если стенд и этот счёт
// расходятся больше чем на несколько процентов — врёт один из них.
//
// Источник: /Users/boris/projects/metalgear-v06c/src/demo.asm (метки popblit,
// ggb_pairs, cmp_pass_and/or, vsb-аналоги). Мнемоника в исходнике Z80-подобная,
// но собирается zasm --8080, поэтому такты берём i8080 (КР580ВМ80А).
"use strict";

// такты i8080 по использованным в горячих циклах инструкциям
const T = {
  "pop rp": 10,
  "mov m,r": 7,
  "mov r,m": 7,
  "dcr r": 5,
  "inr r": 5,
  "inx rp": 5,
  "ana m": 7,
  "ora m": 7,
  "ora r": 4,     // ORA A (проверка на ноль) — регистр, НЕ память
  "lda addr": 13,
  "sta addr": 13,
  "mvi r": 7,
  "ldax rp": 7,
  "stax rp": 7,
  "jmp": 10,
  "jnz": 10,     // i8080: условный jmp = 10 всегда (в отличие от Z80)
  "adi": 7,
  "aci": 7,
  "mov r,r": 5,
  "dad rp": 10,
  "lxi": 10,
  "sphl": 5,
  "lhld": 16,
  "shld": 16,
  "call": 17,
  "ret": 10,
  "di": 4,
  "ei": 4,
  "xchg": 4,
};
const t = (...ops) => ops.reduce((s, o) => s + T[o], 0);

const R = [];
const add = (name, bytes, cycles, note) =>
  R.push({ name, bytes, cycles, per: cycles / bytes, note });

// --- popblit: тело развёрнуто REPT GB_H/2 = 17 раз на колонко-план ---
// pop de / mov m,e / dcr l / mov m,d / dcr l  -> 2 байта в VRAM
const popPair = t("pop rp", "mov m,r", "dcr r", "mov m,r", "dcr r");
// оверхед на один колонко-план: ldax b(=ld a,(bc)) / ora a / jz / mov h,a /
// lda pb_l / mov l,a / inx b / jmp
const popColOver = t("ldax rp", "ora r", "jnz", "mov r,r", "lda addr", "mov r,r", "inx rp", "jmp");
const GB_H = 34;
add("popblit: 1 колонко-план (34 Б)", GB_H, (GB_H / 2) * popPair + popColOver,
    "чистая выброска готового буфера в VRAM");

// Снейк: 4 плана x 4 колонки = 16 колонко-планов x 34 Б = 544 Б
const SNAKE_CP = 16, GUARD_CP = 6;
const popblitTotal = (cp) => cp * ((GB_H / 2) * popPair + popColOver)
  + t("di", "lxi", "dad rp", "shld", "lhld", "sphl") + t("lhld", "sphl", "ei", "ret");
add("sb_blit: Снейк 16 колонко-планов (544 Б)", SNAKE_CP * GB_H, popblitTotal(SNAKE_CP),
    "весь спрайт Снейка одним блитом");
add("gd_blit: охранник 6 колонко-планов (204 Б)", GUARD_CP * GB_H, popblitTotal(GUARD_CP),
    "планы p0,p1,p3; p2 охранник не трогает");

// --- OldTower-вариант pop-блита: строка тайла СРАЗУ в 4 плоскости (docs/reference/
// OLDTOWER_ANALYSIS.md §1). Отличие от MG: H меняется на КАЖДОМ байте (add b/mov h,a),
// потому что обход идёт по плоскостям внутри строки, а не по колонке целиком.
const otRow = t("pop rp", "mov m,r", "adi", "mov r,r", "mov m,r", "adi", "mov r,r")
            + t("pop rp", "mov m,r", "adi", "mov r,r", "mov m,r")
            + t("adi", "mov r,r")   // sub c / mov h,a — откат на плоскость 0
            + t("dcr r");           // dcr l — строка ниже
add("OldTower: строка тайла в 4 плоскости (4 Б)", 4, otRow,
    "обход по плоскостям: H меняется на каждом байте");

// --- композит в ОЗУ (вне пачки): маска+данные, ggb_pairs ---
// mov a,m(de) / ana m / inx h / ora m / inx h / mov m,a(de) / inx d / dcr b / jnz
const pairByte = t("ldax rp", "ana m", "inx rp", "ora m", "inx rp", "stax rp", "inx rp", "dcr r", "jnz");
add("композит маска+данные, 1 байт (ggb_pairs)", 1, pairByte,
    "buf = (buf & ~M) | S — ДВА источника за один проход");

// --- заполнение буфера ФОНОМ из тайлов (ggb_col/ggc_cp). Шаг 3, т.к. тайл
// лежит interleaved [p1,p2,p3] по строкам. У НАС этот шаг дешевле: фон уже
// лежит готовым блоком в слоте, копировать можно подряд (или pop-ом).
const bgByte = t("mov r,m", "stax rp", "inx rp", "inx rp", "inx rp", "inx rp", "dcr r", "jnz");
add("фон из тайлов в буфер, 1 байт (ggc_cp)", 1, bgByte,
    "шаг 3 по interleaved-тайлу; у нас фон уже блоком в слоте");

// --- композит Снейка: два прохода на план (cmp_pass_and + cmp_pass_or) ---
const andByte = t("ldax rp", "ana m", "stax rp", "inx rp", "inx rp", "dcr r", "jnz");
const orByte  = t("ldax rp", "ora m", "stax rp", "inx rp", "inx rp", "dcr r", "jnz");
add("композит Снейка, 1 байт (AND-проход + OR-проход)", 1, andByte + orByte,
    "маска ОДНА на три плана, поэтому два прохода вместо ggb_pairs");

// --- наши ядра для сравнения (числа из docs/DESIGN-2026-08-06-sprout-unification.md §1.2) ---
const OURS = [
  ["наш vsz_mcol (fb = S, фон нулевой)", 24, "перезапись без чтения фона"],
  ["наш vsb_mcol (fb = BG | S, фон из слота)", 36, "композит ВНУТРИ пачки"],
  ["наш vsc_merge (петлевой композит створки)", 59, "счётчик в памяти"],
];

const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
console.log("=== metalgear-v06c: аналитический счёт (i8080) ===");
console.log(pad("цикл", 46), padl("байт", 6), padl("тактов", 8), padl("т/байт", 8));
for (const r of R)
  console.log(pad(r.name, 46), padl(r.bytes, 6), padl(r.cycles, 8), padl(r.per.toFixed(1), 8), " " + r.note);

console.log("\n=== сравнение цены ОДНОГО байта fb ===");
console.log(pad("механизм", 46), padl("т/байт", 8));
console.log(pad("MG popblit (готовый буфер -> VRAM)", 46), padl((popPair / 2).toFixed(1), 8), " тело без оверхеда");
console.log(pad("MG popblit с оверхедом колонко-плана", 46),
  padl((((GB_H / 2) * popPair + popColOver) / GB_H).toFixed(1), 8));
for (const [n, v, note] of OURS) console.log(pad(n, 46), padl(v.toFixed(1), 8), " " + note);
console.log(pad("план 'компилированный блиттер' (наш)", 46), padl("20.0", 8), " эмит кода в тике + CALL в пачке");

// --- ПОЛНАЯ цена байта: композит + выброска, для сравнения схем ---
console.log("\n=== ПОЛНАЯ цена байта (композит + попадание в fb) ===");
const popPer = ((GB_H / 2) * popPair + popColOver) / GB_H;
console.log(pad("MG: композит в ОЗУ (пары) + popblit", 46),
  padl((pairByte + popPer).toFixed(1), 8), " из них В ПАЧКЕ только " + popPer.toFixed(1));
console.log(pad("MG: композит Снейка (2 прохода) + popblit", 46),
  padl((andByte + orByte + popPer).toFixed(1), 8), " из них В ПАЧКЕ только " + popPer.toFixed(1));
console.log(pad("наш vsb_mcol (всё внутри пачки)", 46), padl("36.0", 8), " из них В ПАЧКЕ все 36.0");

console.log("\nВЫВОД: MG платит за байт БОЛЬШЕ суммарно, но в ПАЧКЕ (под лучом) —");
console.log("       " + popPer.toFixed(1) + " т/байт против наших 36.0. Схема меняет не общую");
console.log("       нагрузку, а её РАСПРЕДЕЛЕНИЕ: дорогое уезжает из-под луча.");
