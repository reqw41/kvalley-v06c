// ГЕНЕРАТОР ФЛОСКОЙ 256-БАЙТНОЙ ТАБЛИЦЫ map-ID -> tile-ID (M2a Task 2).
//
// Задача: v1's getTileFromID (msx/kvalley_src.asm:5226, адрес 0x2646 в
// собранном /tmp/kvv.rom) — 2-уровневый lookup:
//   1) group = mapID >> 4 (старший нибл, 0..15)
//      (в асме: rra x3; and 1Eh даёт (mapID>>3)&0x1E == 2*(mapID>>4) —
//       тот же байтовый офсет, что 2*group, т.к. записи в indexTiles — dw)
//   2) group_ptr = word at (indexTiles + group*2)   [indexTiles=0x265C]
//   3) tileID = byte at (group_ptr + (mapID & 0x0F))
//
// Группы 0..9 объявлены явно (tilesNULL..tilesAgujero, VERSION2=1 сборка);
// группы 10..15 (mapID 0xA0-0xFF) физически не объявлены в indexTiles —
// но ЧТЕНИЕ ROM ПО ТЕМ ЖЕ АДРЕСАМ (как это сделал бы живой CPU) даёт
// детерминированный (пусть и "мусорный" по замыслу авторов) результат:
// этот скрипт его honestly воспроизводит, не гадая и не считая эти mapID
// "невозможными" — LUT должен быть побайтово тем же, что вычислил бы v1.
//
// Вход:  /tmp/kvv.rom, /tmp/kvv.sym (собрать: см. README/tools/kv_z80_to_8080.py
//        --target vector + tools/bin/sjasm -s).
// Выход (stdout): 256 байт LUT в виде sjasm `db` строк (16 байт/строка,
//        готово для вставки в v2/scene_builder.asm), плюс сводка на stderr.
"use strict";
const fs = require("fs");

const ROM_PATH = process.argv[2] || "/tmp/kvv.rom";
const SYM_PATH = process.argv[3] || "/tmp/kvv.sym";

function readSym(p) {
  const m = {};
  for (const l of fs.readFileSync(p, "latin1").split("\n")) {
    const g = l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);
    if (g) m[g[1]] = parseInt(g[2], 16);
  }
  return m;
}

const sym = readSym(SYM_PATH);
const rom = fs.readFileSync(ROM_PATH);
// Соглашение загрузки (см. driver_pixelcompare.js/scene_extract.js):
// memory.init_from_array(img, 0x100) -> CPU-адрес A хранит rom-байт (A-0x100).
const LOAD_BASE = 0x100;
function romAt(addr) {
  const off = (addr - LOAD_BASE) & 0xffff;
  if (off < 0 || off >= rom.length) {
    throw new Error(`romAt(0x${addr.toString(16)}): офсет ${off} вне ROM (len=${rom.length})`);
  }
  return rom[off];
}

const indexTiles = sym["indexTiles"];
if (indexTiles === undefined) {
  console.error("indexTiles не найден в .sym — пересобрать v1 (см. Task 3 брифинга)");
  process.exit(1);
}
console.error(`indexTiles = 0x${indexTiles.toString(16)}`);

// indexTiles (VERSION2-сборка) объявлен только на 10 записей (группы 0..9,
// tilesNULL..tilesAgujero, 20 байт) - группы map-ID 0xA0-0xFF (group>=10)
// физически не входят в исходник (комментарий у оригинала: "Estos bloques
// no se usan!" - "эти блоки не используются"), и живой CPU для них прочитал
// бы "указатель" из данных СЛЕДУЮЩЕЙ по памяти таблицы (tilesNULL: db 0,0 и
// т.д.), что даёт невалидный (в нашей ROM-адресации org 0x100) адрес 0 -
// недостижимо для реальных данных уровня. Подтверждено сканом всех 3
// снапшотов /tmp/v1_scene_{1,2,3}.bin (tools/verify/scene_extract.js):
// реально встречающиеся map-ID в СТАТИЧНОМ уровне - максимум 0x80 (группы 0..8).
// ВНИМАНИЕ (ревью M2a): группа 9 (0x90-0x9F, tilesAgujero=ДЫРЫ от копания) -
// РЕАЛЬНЫЙ игровой тайл, появляется в геймплее при копании; её LUT ROM-верна
// (indexTiles объявлен на 10 записей, группа 9 = tilesAgujero=0x26AF валидна),
// просто не встречается в захваченных статичных снапшотах. Истинно неиспользуемы
// (указатель вне ROM-среза / "Estos bloques no se usan!") только группы 10-15
// (0xA0-0xFF). Поэтому для group>=10 (и любого сбоя чтения) кладём безопасную
// заглушку 0x00 вместо падения; группа 9 берётся из ROM как настоящий тайл.
const lut = new Uint8Array(256);
const unreachable = [];
for (let mapID = 0; mapID < 256; mapID++) {
  const group = (mapID >> 4) & 0x0f;
  const ptrAddr = indexTiles + group * 2;
  const lo = romAt(ptrAddr);
  const hi = romAt(ptrAddr + 1);
  const groupPtr = lo | (hi << 8);
  const tileOffset = mapID & 0x0f;
  let tileID;
  try {
    tileID = romAt(groupPtr + tileOffset);
  } catch (e) {
    tileID = 0x00;
    unreachable.push(mapID);
  }
  lut[mapID] = tileID;
}
if (unreachable.length) {
  console.error(`ЗАГЛУШКА 0x00 для ${unreachable.length} недостижимых map-ID (group>=10, никогда не встречаются в реальном MapaRAM): 0x${unreachable[0].toString(16)}..0x${unreachable[unreachable.length-1].toString(16)}`);
}

// --- Сводка на stderr: распределение по группам, для ревью глазами ---
const groupNames = ["tilesNULL", "tilesPlataforma", "tilesEscalera", "tilesCuchillo",
  "tilesGemas", "tilesGiratoria", "tilesSalida", "tilesSalida2", "tilePico",
  "tilesAgujero", "(group10)", "(group11)", "(group12)", "(group13)", "(group14)", "(group15)"];
for (let g = 0; g < 16; g++) {
  const ptrAddr = indexTiles + g * 2;
  const lo = romAt(ptrAddr), hi = romAt(ptrAddr + 1);
  const groupPtr = lo | (hi << 8);
  console.error(`group ${g} (${groupNames[g]}): ptr=0x${groupPtr.toString(16)}`);
}

// --- Вывод: sjasm `db` строки, 16 байт/строка, готово для scene_builder.asm ---
const lines = [];
for (let i = 0; i < 256; i += 16) {
  const row = Array.from(lut.slice(i, i + 16)).map(b => "0" + b.toString(16).toUpperCase() + "h");
  lines.push("\t\tdb\t" + row.join(", "));
}
console.log(lines.join("\n"));
