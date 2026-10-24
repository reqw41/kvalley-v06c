// pack_write_bench.js — ЦЕНА ОДНОГО БАЙТА fb У ПЯТИ СПОСОБОВ ЗАПИСИ (задача#53, работа 1).
//
// ЗАЧЕМ. Владелец предложил КОМПИЛИРОВАННЫЙ БЛИТТЕР пары героя: подготовка эмитит код
// вывода, пачка делает CALL. Прежде чем писать прототип, нужна арифметика НА РЕАЛЬНЫХ
// ТАКТАХ ВЕКТОРА, а не на книжных тактах i8080: на Векторе КАЖДЫЙ машинный цикл добит
// до 4 тактов (T4=4, T43=8, T433=12, T533=16), поэтому `inc e` стоит не 5, а 8, и
// аналитика по книжке занижает реальность на треть (то же наблюдение — в разборе демо
// Metal Gear: 24.5 т/байт замера против 18.7 аналитики).
//
// ЧТО МЕРЯЕТСЯ (48 байт = 3 столбца по 16 строк, адреса как в игре: fb = 0xA000+,
// буфер спрайта в слоте = 0xE0A0, блок фона = 0xE006):
//   A  vsz_mcol как сейчас: ld a,(de)/ld (bc),a/inc e/inc c   (нулевой фон)
//   B  vsb_mcol как сейчас: + or (hl)/inc l                    (ненулевой фон)
//   C  СТЕК-БЛИТ буфера в fb: ld sp,буфер / pop de / ld (hl),e/inc l/ld (hl),d/inc l
//   D  КОМПИЛИРОВАННЫЙ (MVI M): ld hl,столбец / 16x [ld (hl),d8 + inc l]
//   E  КОМПИЛИРОВАННЫЙ (PUSH): ld sp,столбец+16 / 8x [ld de,imm16 + push de]
//   F  ЭМИТ кода варианта D (по 3 Б кода на байт вывода)
//   G  ЭМИТ кода варианта E (по 5 Б кода на 2 байта вывода)
// Каждый вариант ПРОВЕРЯЕТСЯ на правильность: fb обязан совпасть с буфером спрайта.
//
// ===== РЕЗУЛЬТАТ ЗАМЕРА (2026-08-07, 48 байт) И ВЫВОД ==============================
//   A  vsz_mcol (как сейчас)              1800 т = 37.5 т/байт
//   B  vsb_mcol (как сейчас)              2564 т = 53.4 т/байт
//   C  стек-блит буфера                   1140 т = 23.8 т/байт   (-37% к A), эмита НЕТ
//   D  компилированный MVI M               972 т = 20.3 т/байт + 92.7 т/байт эмита
//   E  компилированный ld de,imm16 + push  720 т = 15.0 т/байт + 62.7 т/байт эмита
// ОБМЕН «такт тика за снятый такт пачки»: MVI M — 5.4 : 1, PUSH — 2.8 : 1,
// стек-блит — 0 : 1.
//
// СКОЛЬКО ЭТО СТОИТ В ЖИВОЙ ИГРЕ (1200 тиков, 1346 пачек): ядро столбца зовётся
// 3347 раз = 2.49 столбца (~40 байт) на пачку, из них ПАРА ГЕРОЯ — 54% (1.34 столбца,
// ~21 байт на пачку). Значит вся запись пары стоит 800-1130 тактов на пачку.
//   компилированный PUSH для пары:  -500..800 т на пачку, но +1340 т на ТИК (эмит),
//                                   плюс 130-260 Б ОЗУ под эмитированный код и
//                                   80-120 Б кода эмиттера;
//   стек-блит того же буфера:       -290..630 т на пачку, эмита нет, ОЗУ не нужно,
//                                   40-60 Б кода.
// ВЫВОД: КОМПИЛИРОВАННЫЙ БЛИТТЕР ПОКА НЕ ОКУПАЕТСЯ. Он выигрывает у стек-блита всего
// ~9 тактов на байт (15.0 против 23.8), и за эти 9 берёт 62.7 такта тика на байт.
// Правильный ПЕРВЫЙ шаг — стек-блит буфера (он же снимает вопрос «куда класть код»),
// а компилированный вариант имеет смысл, только если тик окажется дешевле пачки в
// 3+ раза и найдётся ОЗУ под код. Тик к тому же уже длиннее кадра в половине случаев.
//
// Запуск: node tools/verify/pack_write_bench.js
"use strict";
const fs = require("fs"), vm = require("vm"), { execFileSync } = require("child_process");
const base = "/Users/boris/Projects/vector06js";
const FB = 0xA000, LO0 = 0x60, NC = 3, SPR = 0xE0A0, BG = 0xE006, CODE = 0xC800;
const N = NC * 16;
const L = [], w = s => L.push(s);
const hx = v => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

w("\torg 0x100"); w("start:"); w("\tdi"); w("\tld sp,0x7000");
// ---- A: текущее ядро нулевого фона (vsz_mcol + vsz_merge), 3 столбца
w("a_start:");
w(`\tld de,${hx(SPR)}`); w(`\tld b,${hx(FB >> 8)}`); w("\tld a,3"); w("\tld (nc_a),a");
w("aloop:"); w(`\tld c,${LO0}`);
for (let i = 0; i < 16; i++) { w("\tld a,(de)"); w("\tld (bc),a"); w("\tinc e"); w("\tinc c"); }
w("\tinc b"); w("\tld a,(nc_a)"); w("\tdec a"); w("\tld (nc_a),a"); w("\tjp nz,aloop");
w("a_end:");
// ---- B: ядро с чтением фона (vsb_mcol)
w("b_start:");
w(`\tld de,${hx(SPR)}`); w(`\tld hl,${hx(BG)}`); w(`\tld b,${hx(FB >> 8)}`); w("\tld a,3"); w("\tld (nc_a),a");
w("bloop:"); w(`\tld c,${LO0}`);
for (let i = 0; i < 16; i++) { w("\tld a,(de)"); w("\tor (hl)"); w("\tld (bc),a"); w("\tinc l"); w("\tinc e"); w("\tinc c"); }
w("\tinc b"); w("\tld a,(nc_a)"); w("\tdec a"); w("\tld (nc_a),a"); w("\tjp nz,bloop");
w("b_end:");
// ---- C: стек-блит буфера в fb (по столбцам, прогон 16 Б)
w("c_start:");
for (let c = 0; c < NC; c++) {
  w(`\tld sp,${hx(SPR + 16 * c)}`); w(`\tld hl,${hx(FB + 0x100 * c + LO0)}`);
  for (let i = 0; i < 8; i++) { w("\tpop de"); w("\tld (hl),e"); w("\tinc l"); w("\tld (hl),d"); w("\tinc l"); }
}
w("\tld sp,0x7000"); w("c_end:");
// ---- D: компилированный код MVI M (эмулируем ГОТОВЫЙ код прямо здесь)
w("d_start:");
for (let c = 0; c < NC; c++) {
  w(`\tld hl,${hx(FB + 0x100 * c + LO0)}`);
  for (let i = 0; i < 16; i++) { w("\tld (hl),0"); if (i < 15) w("\tinc l"); }
}
w("d_end:");
// ---- E: компилированный код PUSH
w("e_start:");
for (let c = 0; c < NC; c++) {
  w(`\tld sp,${hx(FB + 0x100 * c + LO0 + 16)}`);
  for (let i = 0; i < 8; i++) { w("\tld de,0"); w("\tpush de"); }
}
w("\tld sp,0x7000"); w("e_end:");
// ---- F: эмит кода варианта D: на каждый байт 0x36,d8,0x2C
w("f_start:");
w(`\tld hl,${hx(CODE)}`); w(`\tld de,${hx(SPR)}`); w(`\tld b,${N}`);
w("floop:");
w("\tld (hl),0x36"); w("\tinc hl"); w("\tld a,(de)"); w("\tld (hl),a"); w("\tinc hl");
w("\tinc de"); w("\tld (hl),0x2C"); w("\tinc hl"); w("\tdec b"); w("\tjp nz,floop");
w("f_end:");
// ---- G: эмит кода варианта E: на каждые 2 байта 0x11,lo,hi,0xD5
w("g_start:");
w(`\tld hl,${hx(CODE)}`); w(`\tld de,${hx(SPR)}`); w(`\tld b,${N / 2}`);
w("gloop:");
w("\tld (hl),0x11"); w("\tinc hl"); w("\tld a,(de)"); w("\tld (hl),a"); w("\tinc hl"); w("\tinc de");
w("\tld a,(de)"); w("\tld (hl),a"); w("\tinc hl"); w("\tinc de"); w("\tld (hl),0x0D5"); w("\tinc hl");
w("\tdec b"); w("\tjp nz,gloop");
w("g_end:");
w("hang:\tjp hang");
w("nc_a:\tdb 0");

const A_ASM = __dirname + "/pack_write_bench.asm";
fs.writeFileSync(A_ASM, L.join("\n") + "\n");
execFileSync(__dirname + "/../bin/sjasm", ["-s", A_ASM, A_ASM.replace(/asm$/, "rom"),
  A_ASM.replace(/asm$/, "lst"), A_ASM.replace(/asm$/, "sym")]);

const g = {}; g.window = g;
const stub = () => ({ width: 0, height: 0, style: {}, getContext: () => ({}) });
g.document = { createElement: stub, getElementById: stub };
g.requestAnimationFrame = () => 0; g.setTimeout = () => 0; g.print = () => 0;
g.console = { log() {}, debug() {}, warn() {}, error() {}, info() {} };
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js", "i8080-js/i8080_disasm.js", "i8080-js/i8080.js",
  "src/fili.js", "src/ay.js", "src/fd1793.js", "src/fddimage.js", "src/i8253.js",
  "src/io.js", "src/keyboard.js", "src/memory.js", "src/sound.js", "src/tv.js"])
  vm.runInContext(fs.readFileSync(base + "/" + f, "utf8"), ctx, { filename: f });
const S = {};
for (const line of fs.readFileSync(A_ASM.replace(/asm$/, "sym"), "latin1").split("\n")) {
  const m = line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) S[m[1]] = parseInt(m[2], 16);
}
const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), timer = new ctx.I8253(),
  ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(), io = new ctx.IO(keyboard, timer, memory, ay, floppy);
const cpu = new ctx.I8080(memory, io);
memory.init_from_array(new Uint8Array(fs.readFileSync(A_ASM.replace(/asm$/, "rom"))), 0x100);
memory.detach_boot && memory.detach_boot();
const spr = [];
for (let i = 0; i < N; i++) { spr[i] = (i * 37 + 11) & 255; memory.write(SPR + i, spr[i], false); }
for (let i = 0; i < N; i++) memory.write(BG + i, 0, false);
cpu.pc = 0x100; cpu.sp = 0x7000; cpu.iff = false;

// В вариантах D/E иммедиаты — нули (готовый код в игре нёс бы байты спрайта); чтобы
// проверка корректности была осмысленной, ПАТЧИМ их байтами спрайта прямо в образе.
{
  let p = S.d_start, k = 0;
  while (p < S.d_end) { const op = memory.read(p, false);
    if (op === 0x36) { memory.write(p + 1, spr[k++], false); p += 2; }
    else if (op === 0x2C) p += 1; else p += 3; }
  // PUSH пишет ВНИЗ: i-й push столбца кладёт E по адресу col+14-2i, D по col+15-2i,
  // поэтому эмиттер обязан выдавать пары В ОБРАТНОМ ПОРЯДКЕ — так и патчим.
  p = S.e_start; let col = -1, i8 = 0;
  while (p < S.e_end) { const op = memory.read(p, false);
    if (op === 0x11) { const o = col * 16 + 14 - 2 * i8;
      memory.write(p + 1, spr[o], false); memory.write(p + 2, spr[o + 1], false); i8++; p += 3; }
    else if (op === 0xD5) p += 1; else { col++; i8 = 0; p += 3; } }
}

const marks = [["A  vsz_mcol (нулевой фон, как сейчас)", S.a_end, 1],
               ["B  vsb_mcol (фон OR спрайт, как сейчас)", S.b_end, 1],
               ["C  стек-блит буфера -> fb (прогон 16 Б)", S.c_end, 1],
               ["D  компилированный MVI M,d8 + inc l", S.d_end, 1],
               ["E  компилированный ld de,imm16 + push de", S.e_end, 2],
               ["F  ЭМИТ кода варианта D (3 Б кода на байт)", S.f_end, 0],
               ["G  ЭМИТ кода варианта E (5 Б кода на 2 байта)", S.g_end, 0]];
function clearFb() { for (let c = 0; c < NC; c++) for (let i = 0; i < 16; i++) memory.write(FB + 0x100 * c + LO0 + i, 0xAA, false); }
function checkFb(mode) {
  if (!mode) return -1;
  let bad = 0;
  for (let c = 0; c < NC; c++) for (let i = 0; i < 16; i++) {
    // при записи через push порядок внутри пары обратный — но адреса те же
    if (memory.read(FB + 0x100 * c + LO0 + i, false) !== spr[c * 16 + i]) bad++;
  }
  return bad;
}
clearFb();
let cyc = 0, idx = 0, steps = 0; const res = [];
while (steps < 2000000) {
  const pc = cpu.pc;
  if (idx < marks.length && pc === marks[idx][1]) {
    res.push([marks[idx][0], cyc, checkFb(marks[idx][2])]); cyc = 0; idx++; clearFb();
  }
  if (pc === S.hang) break;
  cpu.instruction(); cyc += cpu.vcycles; steps++;
}
console.log(`ЦЕНА 48 БАЙТ fb (3 столбца по 16 строк), РЕАЛЬНЫЕ такты Вектора (машинный цикл = 4 такта)\n`);
for (const [n, c, bad] of res)
  console.log(`${n.padEnd(44)} ${String(c).padStart(5)} т = ${(c / N).toFixed(1).padStart(5)} т/байт` +
    (bad < 0 ? "" : bad ? `   ЗАПИСЬ БИТАЯ (${bad} байт)` : "   запись точная"));
const m = Object.fromEntries(res.map((r, i) => [["A","B","C","D","E","F","G"][i], r[1]]));
console.log(`\nСВОДКА НА БАЙТ ВЫВОДА:`);
console.log(`  сейчас (нулевой фон)          ${(m.A / N).toFixed(1)} т`);
console.log(`  стек-блит буфера               ${(m.C / N).toFixed(1)} т  (${(100 * m.C / m.A - 100).toFixed(0)}% к текущему), эмита НЕТ`);
console.log(`  компилированный MVI M          ${(m.D / N).toFixed(1)} т в пачке + ${(m.F / N).toFixed(1)} т эмита в тике`);
console.log(`  компилированный PUSH           ${(m.E / N).toFixed(1)} т в пачке + ${(m.G / N).toFixed(1)} т эмита в тике`);
console.log(`\nОБМЕН «такт тика за такт пачки» (сколько тактов тика платим за один снятый такт пачки):`);
console.log(`  MVI M:  ${(m.F / (m.A - m.D)).toFixed(1)} : 1`);
console.log(`  PUSH:   ${(m.G / (m.A - m.E)).toFixed(1)} : 1`);
console.log(`  стек-блит: 0 : 1 (эмита нет)`);
