#!/usr/bin/env node
// Валидатор i8080-чистоты: sjasm 0.39 — Z80-ассемблер и молча примет Z80-only
// опкоды, которых на ванильном i8080/Векторе НЕТ. Этот чекер парсит .lst и
// падает, если хоть одна ИНСТРУКЦИЯ эмитит Z80-only опкод. Гейт ПЕРЕД приёмом.
//
// Использование: node tools/verify/check_i8080.js <file.lst> [<file2.lst> ...]
// Выход: 0 = чисто; 1 = найдены Z80-only опкоды (печатает где).
"use strict";
const fs = require("fs");

// Первый байт опкодов, которых на i8080 НЕТ (Z80-only):
//  08=EX AF,AF'  10=DJNZ  18=JR  20/28/30/38=JR cc  (i8080: undefined/8085-only)
//  CB=bit/rot prefix  D9=EXX  DD=IX prefix  ED=extended(LDIR..)  FD=IY prefix
const ILLEGAL = new Set([0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38,
                         0xCB, 0xD9, 0xDD, 0xED, 0xFD]);
const NAME = {0x08:"EX AF,AF'",0x10:"DJNZ",0x18:"JR",0x20:"JR NZ",0x28:"JR Z",
              0x30:"JR NC",0x38:"JR C",0xCB:"CB-prefix(bit/rot/shift)",0xD9:"EXX",
              0xDD:"DD-prefix(IX)",0xED:"ED-prefix(LDIR/block/16-bit)",0xFD:"FD-prefix(IY)"};

// Источники, которые ЭМИТЯТ данные, а не инструкции — их байты пропускаем:
const DATA_RE = /^\s*(?:[A-Za-z_]\w*:\s*)?\.?(db|dw|ds|dm|byte|word|defb|defw|defs)\b/i;
// Строки, которые вообще не эмитят опкод инструкции (директивы/метки/пусто):
const NONINSN_RE = /^\s*(?:[A-Za-z_]\w*:\s*)?(?:$|;|org\b|equ\b|include\b|=|\.)/i;

function checkLst(path) {
  const lines = fs.readFileSync(path, "latin1").split("\n");
  const hits = [];
  for (const raw of lines) {
    // формат sjasm .lst: "NNN[+]  AAAA  BB BB BB  \t<source>"
    // выделяем адрес(4 hex), эмитированные байты и текст-источник (после таба).
    const m = raw.match(/^\s*\d+[+]?\s+([0-9A-Fa-f]{4})\s+((?:[0-9A-Fa-f]{2}\s)+)\t?(.*)$/);
    if (!m) continue;
    const addr = m[1];
    const bytes = m[2].trim().split(/\s+/).map(h => parseInt(h, 16));
    const src = m[3] || "";
    if (bytes.length === 0) continue;
    // пропускаем данные (db/ds/...) и строки-продолжения байтов (нет источника-мнемоники)
    if (DATA_RE.test(src)) continue;
    if (NONINSN_RE.test(src)) continue;
    if (src.trim() === "") continue; // продолжение данных/операндов без мнемоники
    const op = bytes[0];
    if (ILLEGAL.has(op)) {
      hits.push({ path, addr, op, name: NAME[op], src: src.trim() });
    }
  }
  return hits;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node tools/verify/check_i8080.js <file.lst> [...]");
  process.exit(2);
}
let all = [];
for (const f of files) all = all.concat(checkLst(f));
if (all.length === 0) {
  console.log("i8080-чистота: OK (Z80-only опкоды не найдены в " + files.length + " файл(ах))");
  process.exit(0);
}
console.log("i8080-чистота: НАЙДЕНЫ Z80-ONLY ОПКОДЫ (" + all.length + "):");
for (const h of all) {
  console.log("  " + h.path + " @0x" + h.addr + ": опкод 0x" +
              h.op.toString(16).padStart(2, "0") + " = " + h.name + "  |  " + h.src);
}
console.log("Эти опкоды НЕ исполнятся на ванильном i8080/Векторе. Заменить на i8080-эквиваленты.");
process.exit(1);
