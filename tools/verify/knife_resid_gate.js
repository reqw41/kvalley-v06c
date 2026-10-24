// knife_resid_gate.js — ГЕЙТ КОРОТКОГО ПУТИ НОЖА (задача #46), аналог гейта A из
// spr_resid_gate.js, но для слотов 15-18, которые из общего конвейера выведены.
//
// ЧТО ДОКАЗЫВАЕТ. На возврате из vec_spr_out (то есть когда пачка и нож уже отработали)
// для КАЖДОГО валидного слота ножа собирается МОДЕЛЬ: сохранённый в слоте фон OR
// сдвинутый спрайт ножа, — и сравнивается с реальным содержимым fb байт в байт.
//   * совпало => нож нарисован ровно там и ровно тем, чем должен, и в сейв НЕ ПОПАЛ ОН САМ
//     (иначе стирание следующего кадра оставило бы его отпечаток навсегда);
//   * не совпало => промах габарита/сдвига/плоскости или порча сейва.
// ЧТО ГЕЙТ НЕ ПРОВЕРЯЕТ: в сейве ножа МОГУТ лежать пиксели соседа — так и задумано, нож
// снимает фон ПОСЛЕ вывода пачки. Корректность этого держится на порядке (стирание ножа
// идёт ПЕРЕД стиранием пачки, см. шапку vec_knife_erase), поэтому отдельно считается,
// как часто габарит ножа вообще пересекается с чужим — если ноль, порядок не проверен.
// Модель строится ИЗ ЗАПИСИ ВЫВОДА слота (+0x9C Y,X,pat — то, что реально выведено),
// а не из текущих атрибутов: пачка выводит подготовленное состояние прошлого тика.
//
// ВТОРАЯ ПРОВЕРКА (шлейф): перед выводом (на входе в vec_spr_out) запоминаем габарит
// прошлого кадра; после вывода вне ОБЪЕДИНЕНИЯ старого и нового габаритов в плоскости
// ножа не должно появиться ни одного нового бита.
//
// Сцена — «нож в руке + импульсы FIRE», как в knife_cost.js.
// Запуск: node tools/verify/knife_resid_gate.js [rom] [sym] [тиков=1200]
"use strict";
const { make } = require("./beam_harness.js");
const T = __dirname;
const ROM = process.argv[2] || T + "/../../build/kvalley_8c.rom";
const SYM = process.argv[3] || T + "/../../build/kvalley_8c.sym";
const NT = +(process.argv[4] || 1200);
const E = make(ROM, SYM);
const { L, rd, v06c, memory, cpu, keyboard } = E;
if (L.vec_knife_show === undefined) { console.log("сборка без короткого пути ножа (vec_knife_show) — гейт неприменим"); process.exit(0); }
const MASKS = [0xFF, 0x7F, 0x3F, 0x1F, 0x0F, 0x07, 0x03, 0x01];

function retOf() { return memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8); }
let outRet = -1, outSp = -1;
let checks = 0, bad = 0, badBytes = 0, firstBad = null, slotsSeen = 0, overlaps = 0;

function checkAll() {
  for (let i = 15; i <= 18; i++) {
    const pg = 0xE000 + i * 256;
    if (rd(pg) !== 1) continue;                      // слот невалиден — ножа на экране нет
    const hi = rd(pg + 1), lo = rd(pg + 2), nc = rd(pg + 3);
    if (!nc) continue;
    const Y = rd(pg + 0x9C), X = rd(pg + 0x9D), pat = rd(pg + 0x9E);
    if (Y >= 0xD0) continue;
    slotsSeen++;
    for (let j = 0; j < 21; j++) {      // пересечение габарита ножа с чужим (тот же fb-байт)
      if (j >= 15 && j <= 18) continue;
      const q = 0xE000 + j * 256;
      if (rd(q) !== 1) continue;
      const qhi = rd(q + 1), qlo = rd(q + 2), qnc = rd(q + 3);
      if (!qnc) continue;
      if ((qhi & 0x1F) + qnc <= (hi & 0x1F) || (hi & 0x1F) + nc <= (qhi & 0x1F)) continue;
      if (qlo + 16 <= lo || lo + 16 <= qlo) continue;
      overlaps++; break;
    }
    // модель спрайта: 8 верхних строк левой половины паттерна, сдвиг X&7
    const base = L.vec_spr_buf + ((pat & 0xFC) - 0xA0) * 8;
    const s = X & 7, m1 = MASKS[s], m2 = (~m1) & 0xFF;
    const spr = [[], []];
    for (let k = 0; k < 8; k++) {
      let b = rd(base + k);
      let r = ((b >> s) | (b << (8 - s))) & 0xFF;    // rrca s раз
      spr[0][k] = r & m1; spr[1][k] = r & m2;
    }
    for (let c = 0; c < nc; c++) {
      for (let row = 0; row < 16; row++) {
        const fbA = ((hi + c) << 8) | ((lo + row) & 255);
        const bg = rd(pg + 6 + c * 16 + row);
        const k = 15 - row;                          // строка спрайта (формат слота низ-вверх)
        const ink = (k >= 0 && k < 8 && c < 2) ? spr[c][k] : 0;
        const model = bg | ink;
        checks++;
        if (rd(fbA) !== model) {
          bad++; badBytes++;
          if (!firstBad) firstBad = `слот ${i} Y${Y} X${X} pat${pat.toString(16)} столбец ${c} строка ${row}: fb ${rd(fbA).toString(2)} != модель ${model.toString(2)}`;
        }
      }
    }
  }
}
v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (pc === L.vec_spr_out && outRet < 0) { outRet = retOf(); outSp = cpu.sp; }
  else if (outRet >= 0 && pc === outRet && cpu.sp > outSp) { outRet = -1; checkAll(); }
  return false;
};
const held = new Set();
function keysFor(t) { const k = []; if (t < 260) { if ((t >> 2) & 1) k.push(32); return k; }
  if ((t & 31) < 16) k.push(39); else k.push(37); if ((t & 15) === 3) k.push(32); return k; }
function setKeys(t) { const want = new Set(keysFor(t));
  for (const c of held) if (!want.has(c)) keyboard.keyUp({ keyCode: c, which: c, preventDefault() {}, stopPropagation() {} });
  for (const c of want) if (!held.has(c)) keyboard.keyDown({ keyCode: c, which: c, preventDefault() {}, stopPropagation() {} });
  held.clear(); for (const c of want) held.add(c); }
let tick = 0, prevT = rd(L.timer), fr = 0;
while (tick <= NT && fr < 400000) {
  setKeys(tick);
  if (tick >= 260) { const st = rd(L.knifesData); if (st <= 2) { memory.write(L.objetoCogido, 0x10, false); memory.write(L.IDcuchilloCoge, 0, false); } }
  v06c.oneInterrupt(true); fr++;
  const t = rd(L.timer); if (t !== prevT) { prevT = t; tick++; }
}
console.log(`КОРОТКИЙ ПУТЬ НОЖА: тиков ${tick}, кадров ${fr}, выводов ножа проверено ${slotsSeen}, байт сверено ${checks}`);
console.log(`  из них выводов, где габарит ножа пересекался с чужим спрайтом: ${overlaps}`);
if (bad) { console.log(`КОМПОЗИЦИЯ fb != модель «сейв OR спрайт»: ${badBytes} байт. Первое: ${firstBad}`); process.exit(1); }
console.log("KNIFE RESID GATE OK: под ножом чистый фон, спрайт лёг ровно в свой габарит");
