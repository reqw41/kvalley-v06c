// vopeff_why.js — ИЗ-ЗА ЧЕГО ИМЕННО vop_eff валит всю пачку на обычный путь.
//
// ЗАЧЕМ. mummy_merge_why показал: 65-72% отказов слитой записи дают не мумии, а ГЕРОЙ —
// выход vsp_fastmark на `ret nz` после vop_eff. У vop_eff три причины, и они РАЗНЫЕ по
// лечению, поэтому считать их надо врозь:
//   (1) vop_i1 != 0 — герой непрозрачен СЕЙЧАС (под силуэтом кожи чужой фон);
//   (2) hi0c шапки слота одежды (vsp_dpg+5) != 0 — последний сейв снят при непрозрачности;
//   (3) ZFLAG слота 4 или 5 = 0 — блок фона пары непуст (тайлы двери легли поверх героя).
// Стенд ловит КАЖДЫЙ вызов vop_eff в тике и раскладывает по этим трём битам, отдельно —
// сколько раз при этом на экране были мумии (иначе лечить нечего).
//
// Запуск: node tools/verify/vopeff_why.js [rom] [sym] [--ticks N] [--scene god|nogod]
//   god   — бог-режим (герой проходит СКВОЗЬ мумий: габариты пересекаются постоянно);
//   nogod — без бога, честная прогулка: герой мумий избегает, пересечений почти нет.
"use strict";
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NTICKS = 600, SCENE = "god";
for (let i = 0; i < args.length; i++) { const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a; else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--ticks") NTICKS = +args[++i]; else if (a === "--scene") SCENE = args[++i]; }
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory, keyboard } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
for (const s of ["vop_eff", "vop_i1", "vsp_dpg", "vec_spr_save", "vsp_n", "timer"])
  if (L[s] === undefined) { console.error("нет символа " + s); process.exit(2); }

if (toGame(E) !== 5) { console.error("НЕ ВОШЛИ В ИГРУ"); process.exit(2); }
function tick() { const t0 = rd(L.timer); let n = 0;
  do { v06c.oneInterrupt(true); if (++n > 16) { console.error("СТЕНД ВСТАЛ"); process.exit(3); } }
  while (rd(L.timer) === t0); }
for (let i = 0; i < 40; i++) tick();
if (SCENE === "god") wr(L.vec_god, 1);

const Z4 = L.vec_spr_save + 0x4D1, Z5 = L.vec_spr_save + 0x5D1;
let calls = 0, nz = 0;
const c1 = { n: 0 }, c2 = { n: 0 }, c3 = { n: 0 };
let onlyI1 = 0, withMum = 0, nzWithMum = 0;
// мумии на экране: слот 6..13 с валидной шапкой
function mumOnScreen() { for (let i = 6; i <= 13; i++) if (rd(0xE000 + i * 256)) return true; return false; }
v06c.check_breakpoint = function () {
  if (cpu.pc !== L.vop_eff) return false;
  calls++;
  const i1 = rd(L.vop_i1);
  const dpg = rd(L.vsp_dpg), hi0c = dpg ? rd((dpg << 8) | 5) : 0;
  const z = rd(Z4) & rd(Z5);          // 1 = оба блока пусты
  const bad = (i1 !== 0) || (hi0c !== 0) || (z === 0);
  const mum = mumOnScreen();
  if (mum) withMum++;
  if (bad) { nz++; if (mum) nzWithMum++;
    if (i1) c1.n++;
    if (hi0c) c2.n++;
    if (!z) c3.n++;
    if (i1 && !hi0c && z) onlyI1++; }
  return false;
};
let steps = 0, holdR = true;
keyboard.keyDown({ keyCode: 39, which: 39, preventDefault() {}, stopPropagation() {} });
while (steps < NTICKS) {
  if (steps % 120 === 0) {            // разворот, чтобы ходить туда-сюда по комнате
    holdR = !holdR;
    E.key(39, holdR ? 1 : 0); E.key(37, holdR ? 0 : 1);
  }
  tick(); steps++;
}
v06c.check_breakpoint = () => false;
if (!calls) { console.log("ГЕЙТ ПРОВАЛЕН: vop_eff ни разу не вызван — выборка пуста"); process.exit(2); }
console.log(`ROM=${path.basename(ROM)} сцена=${SCENE} тиков=${NTICKS}`);
console.log(`ВЫЗОВОВ vop_eff: ${calls}, из них «паре только старый путь»: ${nz} = ${(100 * nz / calls).toFixed(1)}%`);
console.log(`   мумии на экране: в ${withMum} вызовах (${(100 * withMum / calls).toFixed(1)}%); отказов при живых мумиях ${nzWithMum}`);
console.log("--- какая из трёх причин взведена (доли от ОТКАЗОВ, причины могут совпадать) ---");
console.log(`   (1) vop_i1 «герой непрозрачен»          ${String(c1.n).padStart(5)}  ${(100 * c1.n / (nz || 1)).toFixed(1)}%`);
console.log(`   (2) hi0c шапки одежды «грязный сейв»    ${String(c2.n).padStart(5)}  ${(100 * c2.n / (nz || 1)).toFixed(1)}%`);
console.log(`   (3) ZFLAG пары «блок фона непуст»       ${String(c3.n).padStart(5)}  ${(100 * c3.n / (nz || 1)).toFixed(1)}%`);
console.log(`   только (1), без (2) и (3):             ${String(onlyI1).padStart(5)}  ${(100 * onlyI1 / (nz || 1)).toFixed(1)}%`);
