// snd_note_parity.js — НОТА-В-НОТУ ПАРИТЕТ ПЛЕЕРА для правок музыкального драйвера.
// snd_tempo меряет только ЧАСТОТУ тиков; правка, перепутавшая ноту/громкость/длительность,
// прошла бы его. Здесь в обеих сборках изолированно (без игры и прерываний) прогоняется
// КАЖДЫЙ РЕАЛЬНЫЙ вызов setMusic из исходника (18 значений, с их битами конфигурации):
// чистая инициализация каналов, SetMusic_(id), затем 1500 вызовов updateSound. Поток пар
// (регистр:данные) на входе WRTPSG сравнивается попарно.
//
// ДВЕ ОГОВОРКИ (обе — предсуществующее поведение, зависящее от раскладки ROM):
//  * маскируются ДАННЫЕ записей частоты (R0-R5) канала, чья громкость (R8+ch, нижние
//    5 бит) равна 0 в ОБЕИХ сборках на момент записи — класс «нота-пауза #C читает
//    частоту за концом freqNotas» (там лежит низкий байт адреса SFX_Dummy);
//  * id подавать ТОЛЬКО как их подаёт игра. «Голые» id мелодий без бита 7 переключают
//    парсер в режим пар «команда+частота», нечётные данные съедают терминатор 0xFF, и
//    указатель уходит в память за треком — содержимое там зависит от раскладки, «паритет»
//    таких прогонов не значит ничего (см. сессию 2026-08-04, ложные срабатывания на
//    id 11-16 при сравнении сборок разного размера);
//  * КВИРК РЕСТАРТА ПАТТЕРНА (id 0x87 SFX_Momia — единственный трек с 0xFE-циклом):
//    на пути setMusPattern -> contProcessSnd -> processSndData тест «шум канала 3»
//    `and 1<<6` видит в A НЕ MUSIC_ID, а СТАРШИЙ БАЙТ АДРЕСА ПАТТЕРНА (так делал и
//    транслированный оригинал — A там всегда был мусором этого же происхождения).
//    Если между сборками SFX_Momia пересекает границу 0x4000 (бит 6 старшего байта
//    меняется), id 0x87 расходится на одну R7-пару на каждый рестарт цикла — это
//    предсуществующая чувствительность к раскладке, НЕ поломка плеера. Проверить:
//    grep SFX_Momia в обоих .sym; если (addr>>8)&0x40 совпадает — расхождение id 0x87
//    настоящее.
//
// Запуск: node tools/verify/snd_note_parity.js <до.rom> <после.rom> [тиков=1500]
//         (рядом с каждым .rom обязан лежать одноимённый .sym)
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
function mk(rom) {
  const g = {}; g.window = g;
  const fcx = () => ({ createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), drawImage: () => {}, fillRect: () => {}, save: () => {}, restore: () => {}, scale: () => {}, setTransform: () => {} });
  const fc = () => ({ width: 0, height: 0, style: {}, getContext: fcx });
  g.document = { createElement: fc, getElementById: fc };
  g.requestAnimationFrame = () => 0; g.setTimeout = () => 0; g.print = () => 0;
  g.console = { log() {}, debug() {}, warn() {}, error() {}, info() {} };
  const ctx = vm.createContext(g);
  for (const f of ["i8080-js/i8080_trace.js", "i8080-js/i8080_disasm.js", "i8080-js/i8080.js", "src/fili.js", "src/ay.js", "src/fd1793.js", "src/fddimage.js", "src/i8253.js", "src/io.js", "src/keyboard.js", "src/memory.js", "src/sound.js", "src/tv.js"])
    vm.runInContext(fs.readFileSync(base + "/" + f, "utf8"), ctx, { filename: f });
  const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), t8253 = new ctx.I8253(), ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(), io = new ctx.IO(keyboard, t8253, memory, ay, floppy);
  const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
  const v = new ctx.Vector06c(cpu, memory, io, ay, tape);
  v.bmp = new Uint32Array(576 * 288); v.displayFrame = () => {}; v.check_breakpoint = () => false; v.dbg = null;
  memory.init_from_array(new Uint8Array(fs.readFileSync(rom)).subarray(0, 0x10000), 0x100);
  memory.detach_boot && memory.detach_boot();
  const L = {};
  for (const l of fs.readFileSync(rom.replace(/\.rom$/, ".sym"), "latin1").split("\n")) {
    const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16); }
  return { cpu, memory, L };
}
function callSub(M, addr, a) {
  const { cpu, memory } = M;
  const SENT = 0x0002;
  cpu.sp = 0x7F00; cpu.iff = false;
  memory.write(0x7EFE, SENT & 0xFF, false); memory.write(0x7EFF, SENT >> 8, false);
  cpu.sp = 0x7EFE;
  cpu.pc = addr;
  if (a !== undefined) cpu.regs[7] = a & 0xFF;
  let n = 0;
  while (cpu.pc !== SENT && n++ < 2000000) cpu.instruction();
  if (cpu.pc !== SENT) throw new Error("подпрограмма не вернулась");
}
function runId(M, id, ticks) {
  const { memory, L, cpu } = M;
  // чистый старт: каналы, флаг и ячейки звука падения
  for (let i = 0; i < 0x2A; i++) memory.write(L.MusicChanData + i, 0, false);
  for (let a = L.flagSetCaeSnd; a <= L.caidaSndDat; a++) memory.write(a, 0, false);
  const log = [];
  M.log = log;
  callSub(M, L.SetMusic_, id);
  for (let t = 0; t < ticks; t++) callSub(M, L.updateSound);
  return log;
}
function hook(M) {
  const { cpu } = M;
  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    if (cpu.pc === M.L.WRTPSG && M.log) M.log.push(((cpu.regs[7] & 0xFF) << 8) | (cpu.regs[3] & 0xFF));
    oI();
  };
}
const A = mk(process.argv[2]), B = mk(process.argv[3]);
hook(A); hook(B);
const TICKS = +(process.argv[4] || 1500);
let totPairs = 0, totMasked = 0, badIds = [];
for (const id of [0x8B,0x9A,0x20,0x97,0x1D,3,2,1,6,8,4,9,0x94,0x8D,0x8F,0x8A,0x87,0x91]) {
  const a = runId(A, id, TICKS), b = runId(B, id, TICKS);
  totPairs += a.length;
  let why = "";
  if (a.length !== b.length) why = `число пар ${a.length} != ${b.length}`;
  const rfA = new Uint8Array(16), rfB = new Uint8Array(16);
  if (!why) for (let i = 0; i < a.length; i++) {
    const ra = (a[i] >> 8) & 0x0F, rb = (b[i] >> 8) & 0x0F;
    if (ra !== rb) { why = `пара [${i}]: регистр ${ra.toString(16)} != ${rb.toString(16)}`; break; }
    if ((a[i] & 0xFF) !== (b[i] & 0xFF)) {
      const ch = ra >> 1;
      const silent = ra <= 5 && (rfA[8 + ch] & 0x1F) === 0 && (rfB[8 + ch] & 0x1F) === 0;
      if (silent) totMasked++;
      else { why = `пара [${i}]: R${ra.toString(16)} данные ${(a[i] & 0xFF).toString(16)} != ${(b[i] & 0xFF).toString(16)}`; break; }
    }
    rfA[ra] = a[i] & 0xFF; rfB[rb] = b[i] & 0xFF;
  }
  if (why) { badIds.push(id); console.log(`id ${id}: ${why}`); }
}
console.log(`мелодий/эффектов: 18 (реальные вызовы setMusic), тиков плеера на каждую: ${TICKS}, пар всего: ${totPairs}, замаскированных «частот паузы»: ${totMasked}`);
if (badIds.length) { console.log(`ВЕРДИКТ: РАСХОЖДЕНИЕ в id: ${badIds.join(",")}`); process.exit(1); }
console.log("ВЕРДИКТ: плеер нота-в-ноту идентичен на всех реальных мелодиях/эффектах игры — OK");
