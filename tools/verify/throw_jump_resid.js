// throw_jump_resid.js — ГЕЙТ ЖАЛОБЫ С ЖЕЛЕЗА (MiSTer, 2026-08-06):
// «есть глюки СТИРАНИЯ спрайтов, когда кидаешь нож и подпрыгиваешь одновременно —
//  остаётся ЧАСТЬ ГЕРОЯ».
//
// СЦЕНА. Кнопка A с ножом в руке = бросок, без предмета = прыжок (protaAnda читает
// KeyTrigger, поэтому кнопку надо ОТПУСКАТЬ). Жмём её импульсами: первый импульс бросает
// нож, конец анимации броска убирает предмет из рук (quitaObjeto -> vec_spr_flush),
// ближайший следующий импульс прыгает. ДЕКЛАРАЦИЯ ПОКРЫТИЯ: и бросок, и прыжок обязаны
// произойти, иначе стенд падает с кодом 2.
//
// КРИТЕРИЙ МУСОРА — АБСОЛЮТНЫЙ (как в knife_momia_resid.js): все спрайты паркуются
// (Y=0xE0 в 21 запись атрибутов), пачка их стирает штатным restore, снимок fb, затем
// плоскости чистятся и комната рисуется ЗАНОВО ИЗ КАРТЫ (vec_nat_room). Любое расхождение
// в игровом поле (lo 72..247) = пиксели, которых в карте нет и которые никто не сотрёт.
//
// ===== ДВЕ ОШИБКИ ИЗМЕРЕНИЯ, ИЗ-ЗА КОТОРЫХ СТЕНД ВРАЛ (найдены 2026-08-06) ===========
// Редакция стенда от 62476a3 показывала пик 53 байта и была объявлена «дефект ОТКРЫТ».
// Ни один из этих 53 байт не мусор — оба слагаемых сделал сам инструмент:
//
//  (1) ПАРКОВКА НЕ ПАРКОВАЛА ГЕРОЯ. Запись Y=0xE0 в sprAttrib идёт МЕЖДУ кадрами, а
//      игровой тик кадра зовёт AI_Prota -> setAttribProta, и тот пишет в sprAttrib слоты
//      4/5 координаты героя ЗАНОВО, из ProtaY/ProtaX. Пока герой анимирован (прыжок,
//      ходьба), парковка стирается в том же кадре и подготовка видит живого героя:
//      трасса скрытия на тике 170 — «PREP 4 curY=66, 64, 62, 60, ... 54», то есть герой
//      все 10 кадров скрытия ПРОДОЛЖАЛ ПРЫГАТЬ и был нарисован в последней позиции.
//      Эти 44 байта «мусора» = сам герой на вершине прыжка (18 пикселей выше того места,
//      где стенд его ждал — отсюда и «СТАРЫЙ габарит ВЫШЕ текущего»).
//      Почему knife_momia_resid.js этого не поймал: он меряет через 150 тиков покоя,
//      когда setAttribProta пишет в парковку те же 0xE0 (герой уже спрятан сценой).
//      ЛЕЧЕНИЕ: на время скрытия setAttribProta затыкается RET (0xC9). Машина всё равно
//      откатывается из снимка, правка живёт только внутри замера.
//
//  (2) «ЗАМОРОЗКА» ЛЕТЯЩЕГО НОЖА СТАТУСОМ 3 ЛОМАЛА ГЕРОЯ. Статусы ножа: 1 = на полу,
//      2 = взят, 4/5 = бросок/брошен, 7 = отскакивает (см. knifesData). Тройки среди них
//      нет — стенд загонял структуру в НЕСУЩЕСТВУЮЩЕЕ состояние, и игра меняла герою
//      набор спрайтов. Остаток 9 байт держался ровно в столбцах героя (13-14) в p0/p2,
//      при том что сам нож был в столбце 1. Без заморозки эти 9 байт исчезают.
//      ЛЕЧЕНИЕ: ножу дают ДОЛЕТЕТЬ. Внутри замера крутятся кадры (с уже запаркованными
//      спрайтами), пока хоть один нож в статусе 4-6; игра сама убирает его тайл. После
//      этого маска исключения НЕ НУЖНА ВОВСЕ — сравнивается всё игровое поле.
//
// ДЕКЛАРАЦИЯ ЧУВСТВИТЕЛЬНОСТИ (обязательна, иначе «ноль» ничего не значит): перед сценой
// в поле подсаживаются заведомые мусорные байты, и замер обязан их увидеть. Не увидел —
// инструмент слеп, стенд падает с кодом 3.
//
// СОСТОЯНИЕ НА 2026-08-06: пирамида 1, 120 тиков сцены, БЕЗ масок исключения —
//    62476a3 (HEAD) ........... пик 0 байт, в конце 0
//    он же без фикса 8adb48b .. пик 0 байт (то есть 53 байта старой редакции не имели
//                               отношения ни к vfr_need, ни к vec_repair вообще)
// Персистентная форма этой жалобы («остаётся кусок героя НАВСЕГДА») закрыта коммитом
// 8adb48b и сторожится knife_momia_resid.js.
//
// Запуск: node tools/verify/throw_jump_resid.js [пирамида=1]   (ROM/SYM — через env ROM/SYM)
"use strict";
const { make, toGame } = require("/Users/boris/projects/kvalley-v06c/tools/verify/beam_harness.js");
const R = "/Users/boris/projects/kvalley-v06c";
const E = make(process.env.ROM || R + "/build/kvalley_8c.rom", process.env.SYM || R + "/build/kvalley_8c.sym");
const { L, rd, v06c, memory, keyboard, cpu } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
const KD = L.knifesData;
const K = i => ({ st: rd(KD + 17 * i), y: rd(KD + 17 * i + 2), x: rd(KD + 17 * i + 4) });
let tick = 0;
const held = new Set();
function keys(list) { const want = new Set(list || []);
  for (const c of held) if (!want.has(c)) keyboard.keyUp({ keyCode: c, which: c, preventDefault() { }, stopPropagation() { } });
  for (const c of want) if (!held.has(c)) keyboard.keyDown({ keyCode: c, which: c, preventDefault() { }, stopPropagation() { } });
  held.clear(); for (const c of want) held.add(c); }
function step(list) { keys(list); const t0 = rd(L.timer); do { v06c.oneInterrupt(true); } while (rd(L.timer) === t0); tick++; }
function snap() { return { m: memory.bytes.slice(), sp: cpu.sp, pc: cpu.pc, iff: cpu.iff, ip: cpu.iff_pending,
  sf: cpu.sf, pf: cpu.pf, hf: cpu.hf, zf: cpu.zf, cf: cpu.cf, regs: cpu.regs.slice(),
  ms: memory.mode_stack, mm: memory.mode_map, pm: memory.page_map, ps: memory.page_stack, cw: memory.cw }; }
function rest(s) { memory.bytes.set(s.m); cpu.sp = s.sp; cpu.pc = s.pc; cpu.iff = s.iff; cpu.iff_pending = s.ip;
  cpu.sf = s.sf; cpu.pf = s.pf; cpu.hf = s.hf; cpu.zf = s.zf; cpu.cf = s.cf;
  for (let i = 0; i < 8; i++) cpu.regs[i] = s.regs[i];
  memory.mode_stack = s.ms; memory.mode_map = s.mm; memory.page_map = s.pm; memory.page_stack = s.ps; memory.cw = s.cw; }
function grab() { const b = Buffer.alloc(0x6000); for (let i = 0; i < 0x6000; i++) b[i] = rd(0x8000 + i); return b; }
function park() { for (let sl = 0; sl < 21; sl++) wr(L.sprAttrib + 4 * sl, 0xE0);
  const t0 = rd(L.timer); do { v06c.oneInterrupt(true); } while (rd(L.timer) === t0); }
// РАЗРУШАЮЩИЙ замер: снимок машины -> заткнуть писателя атрибутов героя -> дать ножу
// долететь -> запарковать спрайты -> fb -> перерисовать комнату из карты -> сравнить ->
// откатить машину.
function residue() {
  const s = snap();
  wr(L.setAttribProta, 0x0C9);	// RET: парковка спрайтов героя перестаёт затираться тиком
  let fly = 0;
  for (; fly < 300; fly++) { let any = 0;
    for (let i = 0; i < 6; i++) { const st = rd(KD + 17 * i); if (st >= 4 && st <= 6) any = 1; }
    if (!any) break; park(); }
  for (let n = 0; n < 10; n++) park();
  const TEST = grab();
  for (let a = 0x8000; a < 0xE000; a++) wr(a, 0);
  cpu.sp = (cpu.sp - 2) & 0xffff; wr(cpu.sp, 0); wr(cpu.sp + 1, 0); cpu.pc = L.vec_nat_room;
  for (let i = 0; i < 40000000 && cpu.pc !== 0; i++) cpu.instruction();
  const ok = cpu.pc === 0; const REF = grab(); rest(s); if (!ok) throw new Error("nat_room");
  let d = 0; const list = [];
  for (let pl = 0; pl < 3; pl++) for (let col = 0; col < 32; col++) for (let lo = 72; lo <= 247; lo++) {
    const i = pl * 0x2000 + col * 256 + lo;
    if (TEST[i] !== REF[i]) { d++; if (list.length < 6) list.push(`p${pl} X=${col * 8} Y=${255 - lo} fb=${TEST[i].toString(2).padStart(8, "0")} карта=${REF[i].toString(2).padStart(8, "0")}`); }
  }
  return { d, list, fly };
}
const PYR = +(process.argv[2] || 1);
let guard = 0;
while (rd(L.piramideActual) !== PYR && guard++ < 20) { const cur = rd(L.piramideActual);
  wr(L.piramideDest, cur + 1); wr(L.subStatus, 0); wr(L.GameStatus, 8);
  let m = 0; while (m < 6000 && rd(L.piramideActual) === cur) { v06c.oneInterrupt(true); m++; } }
let k = 0; while (k < 6000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); k++; }
for (let i = 0; i < 40; i++) step([]);
console.log(`пирамида ${rd(L.piramideActual)} комната ${rd(L.ProtaRoom)} герой X${rd(L.ProtaX)} Y${rd(L.ProtaY)}`);
const ctl = residue();
console.log(`контроль до сцены: ${ctl.d} (кадров долёта ножа ${ctl.fly})`);
// ДЕКЛАРАЦИЯ ЧУВСТВИТЕЛЬНОСТИ: подсадить мусор и потребовать, чтобы замер его увидел
{ const s = snap();
  for (let lo = 100; lo < 105; lo++) wr(0x0A000 + 20 * 256 + lo, 0x5A);
  const probe = residue().d; rest(s);
  console.log(`чувствительность: подсажено 5 байт, замер видит ${probe}`);
  if (probe < 5) { console.log("ГЕЙТ ПАДАЕТ: инструмент слеп — подсаженный мусор не виден"); process.exit(3); } }
if (ctl.d) { console.log("ГЕЙТ ПАДАЕТ: контроль до сцены не ноль — сцена недостоверна"); process.exit(3); }
let thrown = -1, jumped = -1, flushes = 0, flushTick = -99;
v06c.check_breakpoint = function () { if (cpu.pc === L.vec_spr_flush) { flushes++; flushTick = tick; } return false; };
let worst = 0, worstTick = -1, worstList = [];
for (let i = 0; i < 20; i++) { wr(L.objetoCogido, 0x10); wr(L.IDcuchilloCoge, 0); step([]); }
for (let i = 0; i < 120; i++) {
  step((i & 3) < 2 ? [32] : []);
  if (thrown < 0 && K(0).st === 5) thrown = tick;
  if (jumped < 0 && rd(L.protaStatus) === 1) jumped = tick;
  if (i > 10) { const r = residue();
    if (r.d) console.log(`  тик ${tick} флеш@${flushTick} protaStatus=${rd(L.protaStatus)} ProtaY=${rd(L.ProtaY)} нож ${JSON.stringify(K(0))} МУСОР ${r.d}: ${r.list.slice(0, 3).join(" | ")}`);
    if (r.d > worst) { worst = r.d; worstTick = tick; worstList = r.list; } }
}
console.log(`бросок на тике ${thrown}, прыжок на тике ${jumped}, флешей ${flushes}`);
const fin = residue();
console.log(`ПИК МУСОРА за сцену: ${worst} байт (тик ${worstTick}); в конце: ${fin.d} байт`);
if (worst) console.log("  ПИК: " + worstList.join("\n       "));
if (thrown < 0) { console.log("ПРОВАЛ ПОКРЫТИЯ: броска не было"); process.exit(2); }
if (jumped < 0) { console.log("ПРОВАЛ ПОКРЫТИЯ: прыжка не было"); process.exit(2); }
if (worst) { console.log("ГЕЙТ ПАДАЕТ: бросок+прыжок оставили мусор на экране"); process.exit(1); }
console.log("THROW-JUMP RESID GATE OK: мусора нет ни на одном тике сцены");
