//  ГЕЙТ: правка комнаты под спрайтом в ЗОНЕ ЗАВОРОТА не должна пропадать.
//
//  ЧТО ДОКАЗЫВАЕТ. vec_su_fixup решает, задел ли блит клетки чей-то слот, и если задел —
//  подновляет фон в слоте и метит спрайт к перерисовке. Верх столбца слота считался как
//  lo_b+15 ВОСЬМИБИТНЫМ сложением: при lo_b>=241 сумма заворачивается в 0..14, тест
//  отвечает «пересечения нет» и слот выбрасывается целиком. Последствие видно игроку:
//  всё, что изменилось в комнате под спрайтом (выкопанный блок, взятый камень), при уходе
//  спрайта ВОЗВРАЩАЕТСЯ — слот восстанавливает протухший фон. lo_b>=241 — это герой,
//  частично ушедший ВЫШЕ поля (lo0 = 239-Y), то есть верхний ряд.
//
//  КАК ПРОВЕРЯЕТСЯ, БЕЗ ЭТАЛОНА И БЕЗ ЗНАНИЯ КАРТЫ. Блитим клетку, пока герой на ней
//  стоит; уводим героя; снимаем клетку (A); блитим ТУ ЖЕ клетку тем же тайлом ещё раз и
//  снимаем снова (B). Повторный блит идемпотентен, поэтому A != B означает ровно одно:
//  первый блит был молча отменён. Сравнение самодостаточно — не зависит ни от карты, ни
//  от перерисовки комнаты, ни от фазы.
//
//  ГЕЙТ ОБЯЗАН ПАДАТЬ НА ПУСТОЙ ВЫБОРКЕ: если состояние заворота за отведённые тики не
//  наступило, это НЕ «ОК», а отказ — проверять было нечего.
//
//  ЗАПУСК: node tools/verify/fixup_wrap_gate.js [rom] [sym]
"use strict";
const { make, toGame } = require("./beam_harness.js");
const ROM = process.argv[2] || "build/kvalley_8c.rom";
const SYM = process.argv[3] || "build/kvalley_8c.sym";
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);

function tick(keys) {
  const held = new Set(keys);
  for (const c of [37, 39, 32]) held.has(c) ? E.key(c, 1) : E.key(c, 0);
  const t0 = rd(L.timer);
  do v06c.oneInterrupt(true); while (rd(L.timer) === t0);
}

//  Блит клетки штатным путём игры: B=ряд, C=столбец, (vw_byte)=тайл, под DI и с
//  vec_isr_depth!=0 — ровно так его зовёт dt_vec_draw (см. kvalley_game.asm).
function blitCell(row, col, tile) {
  //  Вызов из стенда ЗАХВАТЫВАЕТ процессор, поэтому контекст игры сохраняем и возвращаем:
  //  память после блита обязана остаться изменённой, а регистры и PC — прежними, иначе
  //  следующий tick() уходит в никуда (поймано на первом же прогоне: стенд вис).
  const ctx = { pc: cpu.pc, sp: cpu.sp, regs: cpu.regs.slice(), iff: cpu.iff,
                ip: cpu.iff_pending, sf: cpu.sf, pf: cpu.pf, hf: cpu.hf, zf: cpu.zf, cf: cpu.cf };
  wr(L.vw_byte, tile);
  const depth = rd(L.vec_isr_depth);
  wr(L.vec_isr_depth, 1);
  cpu.iff = 0;
  cpu.regs[0] = row;            // B
  cpu.regs[1] = col;            // C
  const RET = 0x0000;
  cpu.sp = (cpu.sp - 2) & 0xffff;
  wr(cpu.sp, RET & 255); wr(cpu.sp + 1, RET >> 8);
  cpu.pc = L.vec_blit_tile;
  for (let i = 0; i < 5000000 && cpu.pc !== RET; i++) cpu.instruction();
  const ok = cpu.pc === RET;
  wr(L.vec_isr_depth, depth);
  cpu.pc = ctx.pc; cpu.sp = ctx.sp; for(let i=0;i<ctx.regs.length;i++) cpu.regs[i]=ctx.regs[i]; cpu.iff = ctx.iff;
  cpu.iff_pending = ctx.ip; cpu.sf = ctx.sf; cpu.pf = ctx.pf; cpu.hf = ctx.hf;
  cpu.zf = ctx.zf; cpu.cf = ctx.cf;
  return ok;
}

//  Снять клетку (8 строк x 1 столбец) во всех трёх видимых плоскостях.
function grabCell(row, col) {
  const out = [];
  const lo = 255 - row * 8;                     // верх клетки, ряды растут вниз
  for (const plane of [0x80, 0xA0, 0xC0])
    for (let r = 0; r < 8; r++) out.push(rd(((plane + col) << 8) | ((lo - r) & 0xFF)));
  return out;
}

if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
for (let i = 0; i < 30; i++) tick([]);
if (L.vec_god) wr(L.vec_god, 1);

//  Зона заворота возникает не статичной посадкой, а ПО ХОДУ ПРЫЖКА в верхнем ряду, когда
//  половина спрайта уходит выше поля. Поэтому состояние не «ставим», а ЖДЁМ.
wr(L.ProtaY, 8); wr(L.ProtaX, 232); wr(L.protaStatus, 0);
for (let i = 0; i < 12; i++) tick([]);

const TILE = 0x40;                              // тайл кирпича — заведомо непустой
let wrapT = -1, COL = 0;
const ROW = 0;
for (let t = 0; t < 140 && wrapT < 0; t++) {
  const keys = [37];                            // идём влево
  if (t % 14 === 7) keys.push(32);              // и прыгаем
  tick(keys);
  for (const idx of [4, 5]) {
    const P = 0xE000 + idx * 256;
    if (rd(P) && rd(P + 2) >= 241) { wrapT = t; COL = rd(L.ProtaX) >> 3; }
  }
}
if (wrapT < 0) {
  console.log("СЦЕНА НЕ ВОСПРОИЗВЕЛАСЬ: за 140 тиков слоты героя ни разу не попали в зону заворота");
  process.exit(1);
}
const HY = rd(L.ProtaY), HX = rd(L.ProtaX);
console.log(`зона заворота поймана на тике ${wrapT}: герой Y=${HY} X=${HX}, клетка ряд=${ROW} стлб=${COL}`);

if (!blitCell(ROW, COL, TILE)) { console.log("блит клетки не вернулся"); process.exit(1); }
for (let i = 0; i < 3; i++) tick([]);           // дать движку кадр-другой на реакцию

for (let i = 0; i < 12; i++) tick([37]);        // увести героя влево, клетка освобождается
for (let i = 0; i < 4; i++) tick([]);

const A = grabCell(ROW, COL);                   // что осталось на экране
if (!blitCell(ROW, COL, TILE)) { console.log("повторный блит не вернулся"); process.exit(1); }
const B = grabCell(ROW, COL);                   // что там ДОЛЖНО быть

let diff = 0;
for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) diff++;

console.log(`расхождение «осталось на экране» против «должно быть»: ${diff} Б из ${A.length}`);
if (diff) {
  console.log("ВЕРДИКТ: ПРОВАЛ — правка комнаты под спрайтом в зоне заворота ОТМЕНЯЕТСЯ");
  for (let i = 0; i < A.length; i++)
    if (A[i] !== B[i])
      console.log(`   p${(i / 8) | 0} строка ${i % 8}: на экране ${A[i].toString(2).padStart(8, "0")}` +
                  ` вместо ${B[i].toString(2).padStart(8, "0")}`);
  process.exit(1);
}
console.log("ВЕРДИКТ: OK — правка комнаты пережила уход спрайта");
