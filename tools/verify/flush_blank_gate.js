// flush_blank_gate.js — ГЕЙТ «СМЕНА ПРЕДМЕТА В РУКАХ НЕ ГАСИТ ЭКРАН».
//
// ДЕФЕКТ. cogeObjeto/quitaObjeto (подбор, сброс, конец броска ножа) звали vec_spr_flush:
// тот снимает с экрана ВСЕ спрайты и инвалидирует ВСЕ слоты. Конвейер возвращает картинку
// только через две пачки (стирание в тике N — уже после пачки кадра N; подготовка тиком
// N+1; вывод пачкой кадра N+2), поэтому КАЖДЫЙ подбор/сброс давал моргание всей сцены.
//
// ЧТО МЕРИМ. Два независимых числа на каждом тике:
//   (а) ПИКСЕЛИ СПРАЙТОВ НА ЭКРАНЕ — fb в детерминированной точке кадра (граница
//       растрового кадра, куда останавливается oneInterrupt) против ЧИСТОЙ КОМНАТЫ.
//       Чистая комната = плоскости в ноль + vec_nat_room из карты. ВАЖНО: перед этим
//       поднимается vsp_rdy, иначе хвост блита клетки (vfr_gate) дорисует спрайты
//       ПРЯМО В ЭТАЛОН по их записям вывода, и эталон сойдётся с fb при любом дефекте.
//   (б) ПИШЕТ ЛИ ПАЧКА ПАРУ ГЕРОЯ и СТИРАЕТ ЛИ ЕЁ (брейкпойнты vso_merge1/vec_spr_show/
//       vmxp/vec_su_restore по слотам 4-5) — чтобы отличить «лаг конвейера» от «стёрли и
//       не нарисовали».
//
// ДЕКЛАРАЦИЯ ПОКРЫТИЯ: в сцене обязаны произойти и бросок ножа, и хотя бы одна смена
// предмета в руках (вход в cogeObjeto), иначе гейт падает с кодом 2 — «ноль морганий»
// без единого подбора ничего не значит.
//
// КРИТЕРИЙ: после смены предмета пиксели спрайтов не должны проваливаться в ноль.
// Порог — 20 пикселей: столько остаётся от неподвижных объектов сцены; полное гашение
// даёт ровно 0.
//
// ЧИСЛА (пирамида 1, сцена «нож в руки -> импульсы кнопки A -> бросок + прыжки», 80 тиков):
//   62476a3 (флеш в cogeObjeto) . на тике смены предмета 0 пикселей, 2 кадра пустого
//                                 экрана, стирание пары есть, вывода нет;
//   с vec_spr_regen ............. минимум по сцене 88 пикселей, стирания пары на тике
//                                 смены нет вовсе, вывод восстанавливается через 1 кадр
//                                 (обычный лаг конвейера, тот же, что при любом шаге).
//
// Запуск: node tools/verify/flush_blank_gate.js   (ROM/SYM — через env ROM/SYM)
"use strict";
const { make, toGame } = require("/Users/boris/projects/kvalley-v06c/tools/verify/beam_harness.js");
const R = "/Users/boris/projects/kvalley-v06c";
const E = make(process.env.ROM || R + "/build/kvalley_8c.rom", process.env.SYM || R + "/build/kvalley_8c.sym");
const { L, rd, v06c, memory, keyboard, cpu } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
const KD = L.knifesData;
let tick = 0;
const held = new Set();
function keys(list) { const want = new Set(list || []);
  for (const c of held) if (!want.has(c)) keyboard.keyUp({ keyCode: c, which: c, preventDefault() { }, stopPropagation() { } });
  for (const c of want) if (!held.has(c)) keyboard.keyDown({ keyCode: c, which: c, preventDefault() { }, stopPropagation() { } });
  held.clear(); for (const c of want) held.add(c); }
const IDX = () => rd(L.vec_nsp_idx);
let drew = 0, coge = 0, restored = 0, armed = false;
v06c.check_breakpoint = function () { if (!armed) return false; const pc = cpu.pc;
  if (pc === L.cogeObjeto) coge = 1;
  else if (pc === L.vso_merge1 || pc === L.vec_spr_show) { if (IDX() === 4 || IDX() === 5) drew = 1; }
  else if (pc === L.vmxp) drew = 1;
  else if (pc === L.vec_su_restore) { if (IDX() === 4 || IDX() === 5) restored = 1; }
  return false; };
function step(list) { keys(list); drew = coge = restored = 0; armed = true;
  const t0 = rd(L.timer); do { v06c.oneInterrupt(true); } while (rd(L.timer) === t0); armed = false; tick++; }
function snap() { return { m: memory.bytes.slice(), sp: cpu.sp, pc: cpu.pc, iff: cpu.iff, ip: cpu.iff_pending,
  sf: cpu.sf, pf: cpu.pf, hf: cpu.hf, zf: cpu.zf, cf: cpu.cf, regs: cpu.regs.slice(),
  ms: memory.mode_stack, mm: memory.mode_map, pm: memory.page_map, ps: memory.page_stack, cw: memory.cw }; }
function rest(s) { memory.bytes.set(s.m); cpu.sp = s.sp; cpu.pc = s.pc; cpu.iff = s.iff; cpu.iff_pending = s.ip;
  cpu.sf = s.sf; cpu.pf = s.pf; cpu.hf = s.hf; cpu.zf = s.zf; cpu.cf = s.cf;
  for (let i = 0; i < 8; i++) cpu.regs[i] = s.regs[i];
  memory.mode_stack = s.ms; memory.mode_map = s.mm; memory.page_map = s.pm; memory.page_stack = s.ps; memory.cw = s.cw; }
function grab() { const b = Buffer.alloc(0x6000); for (let i = 0; i < 0x6000; i++) b[i] = rd(0x8000 + i); return b; }
const POP = new Uint8Array(256); for (let i = 0; i < 256; i++) { let c = 0, v = i; while (v) { c += v & 1; v >>= 1; } POP[i] = c; }
// ЧИСТАЯ КОМНАТА: плоскости в ноль, vsp_rdy=1 (иначе хвост блита клетки дорисует спрайты
// в эталон), vec_nat_room из карты. Машина откатывается из снимка.
function sprPix() {
  const bp = v06c.check_breakpoint; v06c.check_breakpoint = () => false;
  const s = snap(); const TEST = grab();
  for (let a = 0x8000; a < 0xE000; a++) wr(a, 0);
  wr(L.vsp_rdy, 1);
  cpu.sp = (cpu.sp - 2) & 0xffff; wr(cpu.sp, 0); wr(cpu.sp + 1, 0); cpu.pc = L.vec_nat_room;
  for (let i = 0; i < 40000000 && cpu.pc !== 0; i++) cpu.instruction();
  const ok = cpu.pc === 0; const REF = grab(); rest(s); v06c.check_breakpoint = bp;
  if (!ok) throw new Error("vec_nat_room не вернулся");
  let n = 0;
  for (let pl = 0; pl < 3; pl++) for (let col = 0; col < 32; col++) for (let lo = 72; lo <= 247; lo++) {
    const i = pl * 0x2000 + col * 256 + lo; n += POP[TEST[i] ^ REF[i]]; }
  return n;
}
let guard = 0;
while (rd(L.piramideActual) !== 1 && guard++ < 20) { const c0 = rd(L.piramideActual);
  wr(L.piramideDest, c0 + 1); wr(L.subStatus, 0); wr(L.GameStatus, 8);
  let m = 0; while (m < 6000 && rd(L.piramideActual) === c0) { v06c.oneInterrupt(true); m++; } }
let k = 0; while (k < 6000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); k++; }
for (let i = 0; i < 40; i++) step([]);
console.log(`пирамида ${rd(L.piramideActual)} герой X${rd(L.ProtaX)} Y${rd(L.ProtaY)}; спрайтов на экране в покое: ${sprPix()} пикс`);
for (let i = 0; i < 20; i++) { wr(L.objetoCogido, 0x10); wr(L.IDcuchilloCoge, 0); step([]); }
const rows = []; let thrown = 0;
for (let i = 0; i < 80; i++) { step((i & 3) < 2 ? [32] : []);
  if (rd(KD) === 5) thrown = 1;
  rows.push({ t: tick, c: coge, d: drew, r: restored, px: sprPix() }); }
let minPx = 1e9, minTick = -1, cogeN = 0;
for (const r of rows) { if (r.c) cogeN++; if (r.px < minPx) { minPx = r.px; minTick = r.t; } }
for (const r of rows) if (r.c) {
  const j = rows.indexOf(r);
  const w = rows.slice(Math.max(0, j - 1), j + 4);
  console.log(`смена предмета на тике ${r.t}: ` + w.map(x => `t${x.t}${x.c ? "*" : ""} пикс=${x.px}${x.r ? " СТЁРТА" : ""}${x.d ? " вывод" : ""}`).join(" | "));
}
console.log(`смен предмета ${cogeN}, минимум спрайтовых пикселей за сцену ${minPx} (тик ${minTick})`);
if (!thrown) { console.log("ПРОВАЛ ПОКРЫТИЯ: броска ножа не было"); process.exit(2); }
if (!cogeN) { console.log("ПРОВАЛ ПОКРЫТИЯ: смены предмета в руках не было"); process.exit(2); }
if (minPx < 20) { console.log("ГЕЙТ ПАДАЕТ: экран гаснет — спрайтовых пикселей меньше 20"); process.exit(1); }
console.log("FLUSH BLANK GATE OK: смена предмета экран не гасит");
