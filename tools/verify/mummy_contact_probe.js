//  СТЕНД: «зелёные точки» после перепрыгивания мумии в ВЕРХНЕМ ряду.
//
//  Сценарий владельца (железо, ветка M): идём навстречу мумии по верхней строке и
//  перепрыгиваем её, задевая краешком, — остаются зелёные точки.
//
//  КАК МЕРЯЕТСЯ. Живая метрика без парковки: пиксель есть на экране, его нет в чистой
//  перерисовке комнаты из карты И он не накрыт НИ ОДНИМ действующим габаритом. Маска
//  строится по ОБЪЕДИНЕНИЮ старого габарита (шапка слота) и нового (запись вывода) плюс
//  столбец с каждой стороны: слитая запись пишет шире записи вывода, и маска по одному
//  габариту считала бы законную дорисовку следом. Метрика проверена отдельно: 0 на
//  штатной сборке, 576 Б при отключённом стирании, точный счёт впрыснутого следа (1->1).
//
//  МУМИЯ ВЕДЁТСЯ РУКАМИ: штатный updateMomiaAtr заглушается, координата пишется стендом,
//  иначе встреча не воспроизводится детерминированно.
//
//  ЗАПУСК: node tools/verify/mummy_contact_probe.js [rom] [sym]
//    MUM=6|7   какую мумию вести (по умолчанию 6)
//    HY=<n>    строка встречи (по умолчанию 8 — верхний ряд)
//    JP=<n>    фаза прыжка 0..8 (по умолчанию 4; гейт в run_gates — MUM=7 JP=8)
//
//  ГЕЙТ (run_gates.sh): MUM=7 JP=8 — единственная фаза, где до фикса стабильно
//  оставались 4 Б следа. Пустая выборка (герой и мумия не сошлись) = ПРОВАЛ.
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
function snap() {
  return { m: memory.bytes.slice(), sp: cpu.sp, pc: cpu.pc, regs: cpu.regs.slice(),
           iff: cpu.iff, ip: cpu.iff_pending, sf: cpu.sf, pf: cpu.pf, hf: cpu.hf,
           zf: cpu.zf, cf: cpu.cf };
}
function rest(s) {
  memory.bytes.set(s.m); cpu.sp = s.sp; cpu.pc = s.pc; cpu.iff = s.iff;
  cpu.iff_pending = s.ip; cpu.sf = s.sf; cpu.pf = s.pf; cpu.hf = s.hf;
  cpu.zf = s.zf; cpu.cf = s.cf;
  for (let i = 0; i < s.regs.length; i++) cpu.regs[i] = s.regs[i];
}
function grab() {
  const b = new Uint8Array(0x6000);
  for (let a = 0x8000; a < 0xE000; a++) b[a - 0x8000] = rd(a);
  return b;
}

function liveResidue() {
  const s = snap();
  const cov = new Uint8Array(0x6000);
  const paint = (hi, lo, nc) => {
    if (!hi || !nc) return;
    for (let c = -1; c <= nc; c++) {
      const h = hi + c; if (h < 0x80 || h >= 0xE0) continue;
      for (let r = 0; r < 16; r++) cov[((h << 8) | ((lo + r) & 0xFF)) - 0x8000] = 1;
    }
  };
  for (let idx = 0; idx < 21; idx++) {
    const P = 0xE000 + idx * 256;
    if (rd(P)) { const lo = rd(P + 2), nc = rd(P + 3);
      paint(rd(P + 1), lo, nc); paint(rd(P + 4), lo, nc); paint(rd(P + 5), lo, nc); }
    const pd = rd(P + 0x96);
    if (pd === 1 || pd === 3) { const lo = rd(P + 0x98), nc = rd(P + 0x99);
      paint(rd(P + 0x97), lo, nc); paint(rd(P + 0x9A), lo, nc); paint(rd(P + 0x9B), lo, nc); }
  }
  const LIVE = grab();
  for (let a = 0x8000; a < 0xE000; a++) wr(a, 0);
  cpu.sp = (cpu.sp - 2) & 0xffff; wr(cpu.sp, 0); wr(cpu.sp + 1, 0); cpu.pc = L.vec_nat_room;
  for (let i = 0; i < 40000000 && cpu.pc !== 0; i++) cpu.instruction();
  const REF = grab(); rest(s);
  let n = 0; const list = [];
  for (let pl = 0; pl < 3; pl++) for (let col = 0; col < 32; col++) for (let lo = 64; lo <= 255; lo++) {
    const i = pl * 0x2000 + col * 256 + lo;
    if (cov[i]) continue;
    if (LIVE[i] && !REF[i]) { n++; if (list.length < 8)
      list.push(`p${pl} X=${col * 8} стр=${lo} экран=${LIVE[i].toString(2).padStart(8, "0")}`); }
  }
  return { n, list };
}

if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
for (let i = 0; i < 30; i++) tick([]);
if (L.vec_god) wr(L.vec_god, 1);

const MUM = +(process.env.MUM || 6);
const HY = +(process.env.HY || 8);
const MA = L.sprAttrib + 4 * MUM;

wr(L.updateMomiaAtr, 0x0C9);          // мумию ведём сами, иначе встреча не повторяется
wr(L.ProtaY, HY); wr(L.ProtaX, 210); wr(L.protaStatus, 0);
wr(MA, HY - 1); wr(MA + 1, 150);      // мумия на той же строке, слева от героя
for (let i = 0; i < 6; i++) tick([]);

console.log(`мумия ${MUM} (цвет ${rd(MA + 3)}, образ ${rd(MA + 2)}) ведётся навстречу герою по строке Y=${HY}`);

let peak = 0, peakT = -1, peakList = null, met = -1;
for (let t = 0; t < 90; t++) {
  const mx = rd(MA + 1);
  if (mx < 240) wr(MA + 1, mx + 1);   // мумия идёт вправо, навстречу
  wr(MA, HY - 1);                     // держим её в верхнем ряду
  const keys = [37];                  // герой идёт влево
  if (t % 9 === (+(process.env.JP || 4))) keys.push(32);   // фаза прыжка — разворачивается ключом JP
  tick(keys);
  if (met < 0 && Math.abs(rd(L.ProtaX) - rd(MA + 1)) <= 8) met = t;
  //  Мерим РЕДКО и только после расхождения: liveResidue делает полную перерисовку
  //  комнаты, и вызов на каждом тике превращал прогон в минуты (поймано на первом же
  //  подробном запуске — стенд «завис», хотя просто считал).
  if (met >= 0 && t > met + 12 && (t - met) % 6 === 0) {
    const r = liveResidue();
    if (r.n > peak) { peak = r.n; peakT = t; peakList = r.list; }
  }
}

if (met < 0) {
  console.log("СЦЕНА НЕ ВОСПРОИЗВЕЛАСЬ: герой и мумия не сошлись — мерить нечего");
  process.exit(1);
}
console.log(`встретились на тике ${met}; живой след после расхождения: пик ${peak} Б @ t=${peakT}`);
(peakList || []).forEach(x => console.log("   " + x));
if (peak) { console.log("ВЕРДИКТ: ПРОВАЛ — после контакта с мумией остаётся след"); process.exit(1); }
console.log("ВЕРДИКТ: OK — следа после контакта нет");
