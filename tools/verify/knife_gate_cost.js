// knife_gate_cost.js — ЦЕНА ГЕЙТА «ЭТО НОЖ?» В ГОРЯЧЕМ ПУТИ.
// Гейт стоит в подготовке (vns_draw, сразу за сборкой указателя cur) и исполняется для
// КАЖДОГО подготавливаемого объекта, а не только для ножа. Считаем: сколько раз он
// выполнен на кадр, сколько из них ушло в короткий путь (нож), сколько — мимо (чужие
// объекты), и во сколько тактов это обходится.
// Запуск: node tools/verify/knife_gate_cost.js [rom] [sym] [тиков=2600]
"use strict";
const { make } = require("./beam_harness.js");
const T = __dirname;
const ROM = process.argv[2] || T + "/../../build/kvalley_8c.rom";
const SYM = process.argv[3] || T + "/../../build/kvalley_8c.sym";
const NT = +(process.argv[4] || 2600);
const E = make(ROM, SYM);
const { L, rd, v06c, memory, cpu, keyboard } = E;
function wr(a, v) { memory.write(a & 0xffff, v & 255, false); }
const GATE = L.vkn_gate, PB = L.vns_pbcol;
if (GATE === undefined || PB === undefined) { console.log("нет vkn_gate/vns_pbcol"); process.exit(2); }
// такты гейта (i8080): lda 13 + sui 7 + cpi 7 + jnc 10 = 37 для ЧУЖОГО объекта;
// у слотов 15..18 дальше idx-проверка цвета: inx*3 21 + mov a,m 7 + ani 7 + jz 10 = +45.
let nAll = 0, nKnife = 0, frames = 0, TT = 0;
const oI = cpu.instruction.bind(cpu);
cpu.instruction = function () { oI(); TT += cpu.vcycles | 0; };
let inGate = false, t0 = 0, gateT = 0, gateTknife = 0;
v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (pc === GATE) { nAll++; inGate = true; t0 = TT; }
  else if (inGate && pc === PB) { inGate = false; gateT += TT - t0; }
  return false;
};
const held = new Set();
function keysFor(t) {
  const k = [];
  if (t < 260) { if ((t >> 2) & 1) k.push(32); return k; }
  if ((t & 31) < 16) k.push(39); else k.push(37);
  if ((t & 15) === 3) k.push(32);
  if ((t & 63) < 10) k.push(38);
  if ((t & 63) >= 32 && (t & 63) < 42) k.push(40);
  return k;
}
function setKeys(t) {
  const want = new Set(keysFor(t));
  for (const c of held) if (!want.has(c)) keyboard.keyUp({ keyCode: c, which: c, preventDefault() { }, stopPropagation() { } });
  for (const c of want) if (!held.has(c)) keyboard.keyDown({ keyCode: c, which: c, preventDefault() { }, stopPropagation() { } });
  held.clear(); for (const c of want) held.add(c);
}
function forceKnife() { const st = rd(L.knifesData); if (st <= 2) { wr(L.objetoCogido, 0x10); wr(L.IDcuchilloCoge, 0); } }
let tick = 0, prevT = rd(L.timer), fr = 0;
while (tick <= NT && fr < 400000) {
  setKeys(tick);
  if (tick >= 260) forceKnife();
  v06c.oneInterrupt(true); fr++;
  if (rd(L.GameStatus) === 5) frames++;
  const t = rd(L.timer); if (t !== prevT) { prevT = t; tick++; }
}
nKnife = nAll - 0; // считаем ниже по разнице проходов
console.log("ROM: " + ROM);
console.log(`кадров геймплея ${frames}, кадров всего ${fr}, тиков ${tick}`);
console.log(`подготовок объектов (входов в vns_draw): ${nAll} = ${(nAll / fr).toFixed(3)} на кадр`);
console.log(`тактов в гейте до vns_pbcol (ЧУЖИЕ объекты, т.е. трата впустую): ${gateT} = ${(gateT / fr).toFixed(1)} на кадр`);
console.log(`  (заходов, дошедших до vns_pbcol: считается по замеру выше)`);
