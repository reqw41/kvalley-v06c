// Сборка пропатченного ROM Городецкого: клавиша L = центрирование картинки.
//
// ЧТО НАЙДЕНО ЗАМЕРАМИ (gorod_patch_probe / _unpack / _lowpage / _freemap):
//   * файл ПАКОВАН. Голова файла (18 байт, адрес 0x100) — не пакована:
//       di / xor a / out(0x10),a / ld hl,0x0112 / ld de,0x6000 / ld bc,0x3934 / ldir / jp 0x6000
//     то есть весь остаток файла переезжает на 0x6000, дальше распаковщик 0x600d
//     (вход: HL=0x607b источник, DE=0x0100 приёмник, на стеке адрес возврата 0x0100)
//     разворачивает игру в 0x0100..0x5395 и делает ret на 0x0100.
//   * ISR игры: 0x0038 = jp 0x01df. В ISR сканируются ряды 0 (0xFE), 1 (0xFD), 7 (0x7F),
//     затем 0x0202: ld a,0x88 / out(0) / ld a,2 / out(1) / ld a,0x2F / out(3) / ld a,0 / out(2).
//   * ЕДИНСТВЕННЫЙ источник вертикального скролла — непосредственный операнд по адресу
//     0x020B (значение 0x2F), пишется в порт 3 РОВНО раз в кадр из 0x020A. Других записей
//     скролла за 2000 кадров нет.
//   * свободное ОЗУ после распаковки — только нижняя страница: 0x000B..0x0037 (45 байт),
//     0x003B..0x0046, 0x0056..0x0092, 0x0099..0x00FB. Всё 0x0100..0x7FFF занято.
//
// КУДА ВСТАЁТ ПАТЧ:
//   1) голова файла: BC 0x3934 -> 0x397A (перевозим ещё и наш блоб), jp 0x6000 -> jp 0x9934;
//   2) блоб (70 байт) уезжает вместе с полезной нагрузкой на 0x9934 (экранное ОЗУ, живо
//      всю распаковку: распаковщик пишет только 0x0100..0x5395, читает 0x607b..0x9933);
//   3) КОПИР на 0x9934 переносит ХУК в 0x000B..0x0027 и запускает распаковщик 0x600d,
//      подложив на стек адрес возврата = УСТАНОВЩИК вместо 0x0100;
//   4) УСТАНОВЩИК (после распаковки) правит ISR: 0x01FF `ld (0x10a5),a` -> `call 0x000B`,
//      затем jp 0x0100 (штатный вход игры);
//   5) ХУК на каждом кадре: доопрос ряда 5 (клавиша L, бит 4), по ФРОНТУ нажатия
//      переключает непосредственный операнд 0x020B: 0x2F <-> 0x0F (xor 0x20).
//
// ПОЧЕМУ 0x0F: экранная строка r показывает байтовую строку (scroll-r)&255. Картинка
// сейчас занимает строки 38..255 (поле MSX 192 строки = строки 64..255, прижато к низу).
// Центр для 192 строк = 32..223, то есть сдвиг ВВЕРХ на 32 -> scroll 0x2F-32 = 0x0F.
"use strict";
const fs = require("fs");
const SRC = process.argv[2] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const DST = process.argv[3] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley_Lcenter.rom";

const img = new Uint8Array(fs.readFileSync(SRC));
// --- проверка головы файла: патчим только то, что опознали ---
const head = [0xf3,0xaf,0xd3,0x10,0x21,0x12,0x01,0x11,0x00,0x60,0x01,0x34,0x39,0xed,0xb0,0xc3,0x00,0x60];
for (let i=0;i<head.length;i++) if (img[i]!==head[i]){
  console.log(`ОТКАЗ: голова файла не та, что разобрана: +${i.toString(16)} = 0x${img[i].toString(16)}, ждали 0x${head[i].toString(16)}`);
  process.exit(1);
}
if (img.length !== 0x3946){ console.log(`ОТКАЗ: длина ${img.length}, ждали 14662`); process.exit(1); }

const HOOK_DST = 0x000B;      // дом хука в свободной нижней странице
const BLOB_ORG = 0x9934;      // = 0x6000 + 0x3934, сразу за перевезённой нагрузкой
const SCROLL_IMM = 0x020B;    // непосредственный операнд `ld a,0x2F` в ISR
const ISR_SLOT   = 0x01FF;    // `ld (0x10a5),a` — 3 байта, ровно под `call nn`
const GAME_ENTRY = 0x0100;
const DEPACK     = 0x600D, DEPACK_SRC = 0x607B, DEPACK_DST = 0x0100;
const XOR_MASK   = 0x20;      // 0x2F (низ) <-> 0x0F (центр)

// ---------- ХУК (ассемблируется под HOOK_DST) ----------
const PREV = HOOK_DST + 0x1C;                 // ячейка «прошлое состояние L»
const hook = [
  0x32,0xa5,0x10,                 // ld (0x10a5),a   ; вытесненная инструкция ISR
  0x3e,0xdf,                      // ld a,0xDF       ; ряд 5 Вектора (O N M L K J I H)
  0xd3,0x03,                      // out (3),a
  0xdb,0x02,                      // in a,(2)        ; active-low: L нажата -> бит4 = 0
  0xe6,0x10,                      // and 0x10
  0x21,PREV&255,PREV>>8,          // ld hl,PREV
  0xbe,                           // cp (hl)
  0x77,                           // ld (hl),a
  0xc8,                           // ret z           ; состояние не менялось
  0xb7,                           // or a
  0xc0,                           // ret nz          ; отпустили — не реагируем
  0x3a,SCROLL_IMM&255,SCROLL_IMM>>8, // ld a,(0x020B)
  0xee,XOR_MASK,                  // xor 0x20
  0x32,SCROLL_IMM&255,SCROLL_IMM>>8, // ld (0x020B),a
  0xc9,                           // ret
  0x10,                           // PREV: db 0x10   ; «не нажата»
];
if (HOOK_DST+hook.length-1 !== PREV) { console.log(`ОТКАЗ: PREV посчитан неверно (${(HOOK_DST+hook.length-1).toString(16)} != ${PREV.toString(16)})`); process.exit(1); }
if (HOOK_DST+hook.length > 0x38){ console.log("ОТКАЗ: хук залезает на вектор 0x0038"); process.exit(1); }

// ---------- КОПИР + УСТАНОВЩИК (ассемблируются под BLOB_ORG) ----------
const COPIER_LEN = 0x1B, INSTALLER_LEN = 0x0E;
const INSTALLER = BLOB_ORG + COPIER_LEN;
const HOOK_SRC  = INSTALLER + INSTALLER_LEN;
const copier = [
  0x21,HOOK_SRC&255,HOOK_SRC>>8,          // ld hl,HOOK_SRC
  0x11,HOOK_DST&255,HOOK_DST>>8,          // ld de,HOOK_DST
  0x01,hook.length&255,hook.length>>8,    // ld bc,len
  0xed,0xb0,                              // ldir
  0x31,0x00,0x01,                         // ld sp,0x0100      ; как делал 0x6000
  0x21,DEPACK_SRC&255,DEPACK_SRC>>8,      // ld hl,0x607B
  0x11,DEPACK_DST&255,DEPACK_DST>>8,      // ld de,0x0100
  0x01,INSTALLER&255,INSTALLER>>8,        // ld bc,INSTALLER
  0xc5,                                   // push bc           ; ret распаковщика -> сюда
  0xc3,DEPACK&255,DEPACK>>8,              // jp 0x600D
];
const installer = [
  0x3e,0xcd,                              // ld a,0xCD         ; opcode call nn
  0x32,ISR_SLOT&255,ISR_SLOT>>8,          // ld (0x01FF),a
  0x21,HOOK_DST&255,HOOK_DST>>8,          // ld hl,HOOK_DST
  0x22,(ISR_SLOT+1)&255,(ISR_SLOT+1)>>8,  // ld (0x0200),hl
  0xc3,GAME_ENTRY&255,GAME_ENTRY>>8,      // jp 0x0100
];
if (copier.length!==COPIER_LEN||installer.length!==INSTALLER_LEN){
  console.log(`ОТКАЗ: длины блоков разошлись: копир ${copier.length}/${COPIER_LEN}, установщик ${installer.length}/${INSTALLER_LEN}`);
  process.exit(1);
}
const blob = Uint8Array.from([...copier,...installer,...hook]);

// ---------- сборка файла ----------
const out = new Uint8Array(img.length + blob.length);
out.set(img,0); out.set(blob, img.length);
const newBC = 0x3934 + blob.length;
out[0x0b] = newBC & 255; out[0x0c] = newBC >> 8;      // ld bc,newBC
out[0x10] = BLOB_ORG & 255; out[0x11] = BLOB_ORG >> 8; // jp BLOB_ORG
// сверка адресной арифметики
if (0x112 + newBC - 1 !== 0x100 + out.length - 1){ console.log("ОТКАЗ: LDIR не покрывает файл ровно"); process.exit(1); }
if (0x6000 + newBC - 1 !== BLOB_ORG + blob.length - 1){ console.log("ОТКАЗ: блоб приезжает не на BLOB_ORG"); process.exit(1); }

fs.writeFileSync(DST, Buffer.from(out));
const md5 = require("crypto").createHash("md5").update(Buffer.from(out)).digest("hex");
console.log(`ИСХОДНИК ${SRC} (${img.length} Б)`);
console.log(`РЕЗУЛЬТАТ ${DST} (${out.length} Б), md5 ${md5}`);
console.log(`  блоб ${blob.length} Б -> 0x${BLOB_ORG.toString(16)}: копир 0x${BLOB_ORG.toString(16)}, установщик 0x${INSTALLER.toString(16)}, образ хука 0x${HOOK_SRC.toString(16)}`);
console.log(`  хук ${hook.length} Б -> 0x${HOOK_DST.toString(16)}..0x${(HOOK_DST+hook.length-1).toString(16)}, PREV 0x${PREV.toString(16)}`);
console.log(`  ISR 0x${ISR_SLOT.toString(16)}: 32 a5 10 -> cd ${(HOOK_DST&255).toString(16).padStart(2,"0")} ${(HOOK_DST>>8).toString(16).padStart(2,"0")}`);
console.log(`  скролл 0x${SCROLL_IMM.toString(16)}: 0x2F (низ) <-> 0x0F (центр)`);
console.log(`  правки в файле: +0x0b/0x0c BC=0x${newBC.toString(16)}, +0x10/0x11 jp 0x${BLOB_ORG.toString(16)}, хвост +0x${img.length.toString(16)}`);
