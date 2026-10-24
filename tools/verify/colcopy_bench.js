// МИКРОБЕНЧМАРК ПЕРЕНОСА СТОЛБЦА ПРИ СКРОЛЛЕ (vec_scroll_shift, 176 Б на столбец).
// Отвечает на вопрос «нельзя ли копировать пачками через регистровые пары (pop x N,
// затем push x N), как советуют для Z80/8080?». Считает РЕАЛЬНЫЕ такты Вектора
// (headless vector06js: каждый машинный цикл добит до 4 тактов, push=16, pop=12)
// и ПРОВЕРЯЕТ КАЖДЫЙ вариант на правильность копии.
//
// Варианты:
//   A — как сейчас в vec_scroll_shift: pop de + ld (hl),e/inc l + ld (hl),d/inc l
//   B — пачки 8 Б: ld sp,src / pop bc,de,hl,af / ld sp,dst+8 / push af,hl,de,bc
//   C — цена патча 44 иммедиатов (hi-байт адреса) под B: раз на столбец-плоскость
//   E — пачки 6 Б (BC/DE/HL, БЕЗ AF) + хвост 2 Б — единственный КОРРЕКТНЫЙ пачечный
//   F — цена патча 58 иммедиатов под E
// Вывод и разбор — в шапке src/v06c/vec_scroll.asm.
//
// Запуск: node tools/verify/colcopy_bench.js
"use strict";
const fs = require("fs"), vm = require("vm"), { execFileSync } = require("child_process");
const base = "/Users/boris/Projects/vector06js";
const SRC = 0x9400, DST = 0x9000;        // приёмник = источник - 0x400 (сдвиг на 4 столбца)
const LO0 = 72, N = 176;                 // игровое поле столбца: fb-строки lo 72..247

// ---------- генерация исходника ----------
const L = [], w = s => L.push(s);
w("\torg 0x100"); w("start:"); w("\tdi"); w("\tld sp,0x7000"); w("a_start:");
w(`\tld hl,0x${(SRC + LO0).toString(16)}`); w("\tld sp,hl");
w(`\tld hl,0x${(DST + LO0).toString(16)}`); w("\tld b,11"); w("ca_row:");
for (let i = 0; i < 8; i++) { w("\tpop de"); w("\tld (hl),e"); w("\tinc l"); w("\tld (hl),d"); w("\tinc l"); }
w("\tdec b"); w("\tjp nz,ca_row"); w("\tld sp,0x7000"); w("a_end:");
for (let k = 0; k < N / 8; k++) {
  const lo = LO0 + 8 * k;
  w(`bp${k}:\tld sp,0x${(SRC + lo).toString(16)}`);
  w("\tpop bc"); w("\tpop de"); w("\tpop hl"); w("\tpop af");
  w(`bq${k}:\tld sp,0x${(DST + lo + 8).toString(16)}`);
  w("\tpush af"); w("\tpush hl"); w("\tpush de"); w("\tpush bc");
}
w("\tld sp,0x7000"); w("b_end:");
w(`\tld a,0x${(SRC >> 8).toString(16)}`);
for (let k = 0; k < N / 8; k++) w(`\tld (bp${k}+2),a`);
w(`\tld a,0x${(DST >> 8).toString(16)}`);
for (let k = 0; k < N / 8; k++) w(`\tld (bq${k}+2),a`);
w("c_end:");
const nb = Math.floor(N / 6);
for (let k = 0; k < nb; k++) {
  const lo = LO0 + 6 * k;
  w(`ep${k}:\tld sp,0x${(SRC + lo).toString(16)}`);
  w("\tpop bc"); w("\tpop de"); w("\tpop hl");
  w(`eq${k}:\tld sp,0x${(DST + lo + 6).toString(16)}`);
  w("\tpush hl"); w("\tpush de"); w("\tpush bc");
}
const tail = LO0 + 6 * nb;
w(`\tld sp,0x${(SRC + tail).toString(16)}`); w("\tpop de");
w(`\tld hl,0x${(DST + tail).toString(16)}`); w("\tld (hl),e"); w("\tinc l"); w("\tld (hl),d");
w("\tld sp,0x7000"); w("e_end:");
w(`\tld a,0x${(SRC >> 8).toString(16)}`);
for (let k = 0; k < nb; k++) w(`\tld (ep${k}+2),a`);
w(`\tld a,0x${(DST >> 8).toString(16)}`);
for (let k = 0; k < nb; k++) w(`\tld (eq${k}+2),a`);
w("f_end:"); w("hang:\tjp hang");

const A_ASM = __dirname + "/colcopy_bench.asm";
fs.writeFileSync(A_ASM, L.join("\n") + "\n");
execFileSync(__dirname + "/../bin/sjasm", ["-s", A_ASM, A_ASM.replace(/asm$/, "rom"),
  A_ASM.replace(/asm$/, "lst"), A_ASM.replace(/asm$/, "sym")]);

// ---------- прогон ----------
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
for (let i = 0; i < 256; i++) memory.write(SRC + i, (i * 7) & 255, false);
cpu.pc = 0x100; cpu.sp = 0x7000; cpu.iff = false;

const marks = [["A  текущая (pop + ld (hl),r + inc l)", S.a_end],
               ["B  пачки 8 Б (BC/DE/HL/AF)", S.b_end],
               ["C  патч 44 иммедиатов под B", S.c_end],
               ["E  пачки 6 Б (BC/DE/HL) + хвост", S.e_end],
               ["F  патч 58 иммедиатов под E", S.f_end]];
let cyc = 0, idx = 0, steps = 0; const res = [];
while (steps < 200000) {
  const pc = cpu.pc;
  if (idx < marks.length && pc === marks[idx][1]) {
    let bad = 0;
    for (let i = LO0; i < LO0 + N; i++) if (memory.read(DST + i, false) !== memory.read(SRC + i, false)) bad++;
    res.push([marks[idx][0], cyc, bad]); cyc = 0; idx++;
    for (let i = 0; i < 256; i++) memory.write(DST + i, 0xAA, false);   // затираем приёмник
  }
  if (pc === S.hang) break;
  cpu.instruction(); cyc += cpu.vcycles; steps++;
}
for (const [n, c, bad] of res)
  console.log(`${n.padEnd(38)} ${String(c).padStart(5)} т = ${(c / N).toFixed(2)} т/байт` +
              (n.startsWith("C") || n.startsWith("F") ? "" : `   копия: ${bad ? "БИТАЯ, неверных байт " + bad : "точная"}`));
const [A, B, C, E, F] = res.map(r => r[1]);
console.log(`\nB+C (пачки 8 Б целиком): ${B + C} т = ${((B + C) / N).toFixed(2)} т/байт (${(100 * (B + C) / A - 100).toFixed(1)}% к A) — НО КОПИЯ БИТАЯ (push af)`);
console.log(`E+F (пачки 6 Б целиком): ${E + F} т = ${((E + F) / N).toFixed(2)} т/байт (${(100 * (E + F) / A - 100).toFixed(1)}% к A) — единственный корректный пачечный вариант`);
