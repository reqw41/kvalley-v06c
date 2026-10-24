// Сцена жалобы с железа: герой становится ГОЛЫМ, проходя сквозь мумию
// (комок возрождения / любое перекрытие). Трехплоскостная схема гасит
// чужие плоскости силуэтом мумии ПОСЛЕ вывода пары героя; vtm_hrd
// перерисовывает пару только если в ЭТОМ тике готовили непрозрачного
// героя (vop_i1). Бюджет подготовки = 2 слота = как раз пара: тик, где
// готовится только мумия, оставляет vop_i1=0 и дыру.
//
// Метрика: биты силуэта одежды (слот 4, буфер +0xA0) обязаны присутствовать
// в плоскости записи одежды (hi0 слота 4). Нет бита = «голый».
// Сцена: герой СТОИТ, мумию кладём ему на координату (только мумия dirty).
//
// Запуск: node tools/verify/hero_overlap_gate.js [rom] [sym]
// Негатив: BREAK=1 — не класть мумию, одежда обязана быть цела (контроль метрики).
"use strict";
const {make, toGame} = require("./beam_harness.js");
const ROM = process.argv[2] || "build/kvalley_8c.rom";
const SYM = process.argv[3] || "build/kvalley_8c.sym";
const BREAK = process.env.BREAK === "1";
const E = make(ROM, SYM);
const {L, rd, v06c, memory} = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);

function tick(keys) {
  const held = new Set(keys || []);
  for (const c of [37, 39, 32]) held.has(c) ? E.key(c, 1) : E.key(c, 0);
  const t0 = rd(L.timer);
  do v06c.oneInterrupt(true); while (rd(L.timer) === t0);
}

if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
for (let i = 0; i < 40; i++) tick([]);
if (L.vec_god) wr(L.vec_god, 1);
if (L.updateMomiaAtr) wr(L.updateMomiaAtr, 0x0C9);

wr(L.protaStatus, 0);
for (let i = 0; i < 8; i++) tick([]);  // пара героя готова, он стоит

// Координаты берём из УЖЕ выведенного спрайта одежды: ProtaY и sprAttrib
// мумии в разных системах, прошлое совмещение по Y=80 дало lo0 120 vs 159.
const HA = L.sprAttrib + 4 * 4;
const hY = rd(HA), hX = rd(HA + 1);
const SLOT = +(process.env.SLOT || 7);   // слот 7 = p1, гасит p2 = одежду («голый»)
const MA = L.sprAttrib + 4 * SLOT;
if (!BREAK) {
  wr(MA, hY); wr(MA + 1, hX);
  wr(MA + 2, +(process.env.PAT || 0x28));
  wr(MA + 3, rd(HA + 3));
}
// прячем прочих мумий, чтобы не путали метрику
for (let s = 6; s <= 13; s++) {
  if (s === SLOT && !BREAK) continue;
  wr(L.sprAttrib + 4 * s, 0xE0);
}
for (let i = 0; i < 12; i++) tick([]);  // только эта мумия dirty

function missingClothes() {
  const P = 0xE000 + 4 * 256;
  if (rd(P + 0x96) === 2) return {skip: true, miss: 0, have: 0};
  const hi0 = rd(P + 0x97), lo0 = rd(P + 0x98), nc = rd(P + 0x99);
  if (!nc || !hi0) return {skip: true, miss: 0, have: 0};
  let miss = 0, have = 0;
  for (let c = 0; c < nc; c++) {
    const page = (hi0 + c) & 0xff;
    if (page < 0x80 || page >= 0xE0) continue;
    for (let r = 0; r < 16; r++) {
      const sil = rd(P + 0xA0 + c * 16 + r);
      if (!sil) continue;
      const fb = rd((page << 8) | ((lo0 + r) & 0xff));
      have += 1;
      if ((sil & fb) !== sil) miss += 1;
    }
  }
  return {skip: false, miss, have, hi0, lo0, nc, pending: rd(P + 0x96)};
}

const r = missingClothes();
const mumP = 0xE000 + SLOT * 256;
console.log(`герой слот4 pending=${rd(0xE400+0x96)} hi0=${rd(0xE400+0x97).toString(16)} lo0=${rd(0xE400+0x98)} nc=${rd(0xE400+0x99)} spr=${rd(HA)},${rd(HA+1)}`);
console.log(`мумия слот${SLOT} pending=${rd(mumP+0x96)} hi0=${rd(mumP+0x97).toString(16)} lo0=${rd(mumP+0x98)} nc=${rd(mumP+0x99)} pat=${rd(MA+2)} y=${rd(MA)} x=${rd(MA+1)}`);
console.log(`vop_i1=${L.vop_i1 !== undefined ? rd(L.vop_i1) : "нет"} GameStatus=${rd(L.GameStatus)}`);
if (r.skip) {
  console.log("СЦЕНА НЕ ВОСПРОИЗВЕЛАСЬ: слот одежды скрыт или пуст");
  process.exit(1);
}
console.log(`одежда: ${r.have} байт силуэта, дыр ${r.miss}`);
if (BREAK) {
  if (r.miss) { console.log("ВЕРДИКТ: ПРОВАЛ КОНТРОЛЯ — без мумии одежда уже дырявая"); process.exit(1); }
  console.log("ВЕРДИКТ: OK контроль — без мумии одежда цела");
  process.exit(0);
}
if (r.miss) {
  console.log("ВЕРДИКТ: ПРОВАЛ — силуэт одежды выбит из своей плоскости (голый герой)");
  process.exit(1);
}
console.log("ВЕРДИКТ: OK — одежда на месте");
process.exit(0);
