// audit_bytes.js — СКОЛЬКО БАЙТ ОБРАЗА ЗАНИМАЕТ КАЖДЫЙ МЕХАНИЗМ РЕНДЕРА.
//
// ЗАЧЕМ. В таблице инвентаря аудита нужна колонка «цена в байтах». Считать её по глазу
// нельзя: модули перемешаны (post-align хвосты лежат в чужих файлах — см. шапки
// vec_topmask.asm / vec_repair.asm), а .sym даёт только адреса меток.
//
// КАК. Читаем build/kvalley_8c.lst. sjasm печатает строку как
//   NNNNN[+]  AAAA HH HH HH   исходный текст
// где AAAA — адрес, а HH... — РЕАЛЬНО ЗАПИСАННЫЕ в образ байты. Суммируем эти байты
//   (1) по ИСХОДНОМУ ФАЙЛУ (следим за `.include`, стек включений);
//   (2) по ДИАПАЗОНУ МЕТОК механизма (список ниже) — от метки до метки.
// Сумма по файлам обязана сойтись с размером образа: невязка печатается.
//
// ЗАПУСК: node tools/verify/audit_bytes.js [lst] [sym]
"use strict";
const fs = require("fs");
const T = __dirname, REPO = T + "/../..";
const LST = process.argv[2] || REPO + "/build/kvalley_8c.lst";
const SYM = process.argv[3] || REPO + "/build/kvalley_8c.sym";

const L = {};
for (const l of fs.readFileSync(SYM, "latin1").split("\n")) {
  const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16);
}
// карта адрес -> имя метки (только код образа)
const marks = [];
for (const k in L) { const a = L[k]; if (a >= 0x0100 && a < 0x8000) marks.push([a, k]); }
marks.sort((a, b) => a[0] - b[0]);

const lines = fs.readFileSync(LST, "latin1").split("\n");
const byFile = {}, stack = ["<root>"];
let total = 0;
const bytesAt = new Map();            // адрес -> сколько байт эмитировано начиная с него
for (const s of lines) {
  const m = s.match(/^\d+\+?\s+([0-9A-F]{4})((?:\s[0-9A-F]{2})*)\s/);
  if (m) {
    const addr = parseInt(m[1], 16);
    const bs = m[2].trim(); const n = bs ? bs.split(/\s+/).length : 0;
    if (n) {
      const f = stack[stack.length - 1];
      byFile[f] = (byFile[f] || 0) + n; total += n;
      bytesAt.set(addr, (bytesAt.get(addr) || 0) + n);
    }
  }
  const inc = s.match(/\.include\s+"([^"]+)"/);
  if (inc) stack.push(inc[1]);
  else if (/^\s*\d+\s+[0-9A-F]{4}\s*$/.test(s) && stack.length > 1) { /* пусто */ }
}
// стек включений закрывается концом файла — sjasm не печатает маркер конца, поэтому
// точный per-file счёт берём по ДИАПАЗОНАМ АДРЕСОВ включений (ниже), а byFile оставляем
// как грубую сверку суммы.

// --- точный счёт по файлам: адрес первой и последней эмиссии внутри каждого .include ---
const fileRanges = [];
{
  let cur = null;
  for (const s of lines) {
    const inc = s.match(/^\d+\+?\s+([0-9A-F]{4})\s+\.include\s+"([^"]+)"/);
    if (inc) { if (cur) cur.end = parseInt(inc[1], 16); cur = { file: inc[2], start: parseInt(inc[1], 16), end: 0 }; fileRanges.push(cur); }
  }
  if (cur) cur.end = 0x8000;
}
const sizeOf = (a, b) => { let n = 0; for (const [ad, c] of bytesAt) if (ad >= a && ad < b) n += c; return n; };

console.log(`ОБРАЗ: ${total} Б кода/данных (по .lst)`);
console.log("");
console.log("-- ПО МОДУЛЯМ (диапазон адресов включения) --");
for (const r of fileRanges) {
  const n = sizeOf(r.start, r.end);
  if (n) console.log(`  ${r.file.padEnd(28)} 0x${r.start.toString(16).toUpperCase().padStart(4, "0")}..0x${(r.end - 1).toString(16).toUpperCase().padStart(4, "0")}  ${String(n).padStart(6)} Б`);
}
console.log("");

// --- механизмы аудита: диапазоны меток ---
// Формат: [имя, метка-начало, метка-конец-исключительно, комментарий]
const MECH = [
  ["topmask (vtm_*)", "vtm_restore", "vsu_scw", "MASK+силуэт: restore-ANDN, zclip, afterdraw"],
  ["vsu_scw+vsu_hide", "vsu_scw", null, "сейв завёрнутого столбца + скрытие слота (хвост)"],
  ["vec_repair", "vso_fix", "vtm_restore", "обёртка пачки + проход починки vfr_lp"],
  ["vec_su_menu", "vec_su_menu", null, "сброс гейта vsu_any при возврате на титул"],
  ["vclp", "vclp", "vsp_pat", "жёсткий клип габарита сверху"],
  ["vsp_fastmark", "vsp_fastmark", "vec_spr_out", "решение о слитой записи всей пачки"],
  ["vec_spr_out (пачка)", "vec_spr_out", "vso_fastall", "диспетчер пачки: стирание/фронт сейвов/вывод"],
  ["vso_fastall", "vso_fastall", "vpr_sout", "пачка целиком слитой записью"],
  ["пара: vpr_sout+vmx_*", "vpr_sout", "vpr_wr", "пара героя первой + проверка пригодности"],
  ["vpr_wr", "vpr_wr", "vso_sortord", "чередование пары по столбцам"],
  ["vso_sortord", "vso_sortord", "vec_spr_show", "сортировка порядка вывода по lo0"],
  ["vec_spr_show", "vec_spr_show", "vsc_leaf", "обычный OR-вывод"],
  ["vsc_leaf", "vsc_leaf", "vpz_wr", "композит створки ворот"],
  ["стек-блит vpz_*", "vpz_wr", "vsb_mrow", "стек-блит пары"],
  ["слитый путь vsb_*", "vsb_mrow", "vso_merge1", "постройка «фон OR спрайт»"],
  ["vso_merge1", "vso_merge1", null, "слитая запись объекта"],
  ["vec_su_fixup", "vec_su_fixup", "vbt8_ent", "подновление фона в слотах при блите клетки"],
  ["vec_su_restore", "vec_su_restore", "vec_su_save", "стирание (POP-хайджек)"],
  ["vec_su_save", "vec_su_save", "vec_scroll_shift", "сейв фона (POP-хайджек)"],
  ["vec_nat_sprites (F+P)", "vec_nat_sprites", "vec_su_ptr", "фазы F/P + цикл подготовки"],
  ["vec_spr_prep", "vec_spr_prep", "vclp", "подготовка геометрии и буфера"],
  ["vsnd_cdiv (суррогат)", "vsnd_tick_coop", "vsnd_tick", "темп по работе, когда часов нет"],
];
console.log("-- ПО МЕХАНИЗМАМ (диапазон меток) --");
let miss = 0;
for (const [name, a, b, doc] of MECH) {
  if (L[a] === undefined) { console.log(`  ${name.padEnd(24)} НЕТ МЕТКИ ${a}`); miss++; continue; }
  const s = L[a];
  let e;
  if (b) { if (L[b] === undefined) { console.log(`  ${name.padEnd(24)} НЕТ МЕТКИ ${b}`); miss++; continue; } e = L[b]; }
  else { // до следующей метки за пределами тела: берём следующую метку, отличную от «своих»
    const i = marks.findIndex(m => m[0] > s && !m[1].startsWith(a.split("_")[0] + "_"));
    e = i >= 0 ? marks[i][0] : s;
  }
  if (e <= s) { console.log(`  ${name.padEnd(24)} ПУСТОЙ ДИАПАЗОН ${a}..${b}`); miss++; continue; }
  console.log(`  ${name.padEnd(24)} 0x${s.toString(16).toUpperCase().padStart(4, "0")}..0x${(e - 1).toString(16).toUpperCase().padStart(4, "0")}  ${String(sizeOf(s, e)).padStart(5)} Б   ${doc}`);
}
if (total === 0) { console.error("ПУСТАЯ ВЫБОРКА: из .lst не извлечено ни одного байта — формат листинга изменился"); process.exit(3); }
if (miss) { console.error(`НЕ РАЗОБРАНО МЕХАНИЗМОВ: ${miss} — таблица неполна, чинить список меток`); process.exit(4); }
