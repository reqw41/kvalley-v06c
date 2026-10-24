#!/usr/bin/env node
// top_overlap_resid.js — остаток после КАСАНИЯ (зона vclp и обычные ряды).
//
// Три семейства (prompt engine-cleanup задача 0):
//   A) legacy — герой перепрыгивает мумию (jump+pair+negY, mumPass);
//   B) parallel — движение в одну сторону, прыжок героя вплотную сбоку;
//   C) mumJump — МУМИЯ прыгает через стоящего/идущего героя (обратное направление).
// Типы дефекта: hole (TEST=0,REF≠0) и orphan/сирота (TEST≠0,REF=0).
// Пустая выборка любого семейства → FAIL. Пик hole или orphan > 0 → FAIL.
//
// Запуск: node tools/verify/top_overlap_resid.js [rom] [sym] [тиков=1500] [--row N]
"use strict";
const fs = require("fs");
const path = require("path");
const { make, toGame } = require("./beam_harness.js");
const T = __dirname, REPO = path.join(T, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NT = 1500, ROW = 8;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--row") ROW = +args[++i];
  else if (/^\d+$/.test(a)) NT = +a;
}
const E = make(ROM, SYM);
const { L, rd, v06c, memory, keyboard, cpu } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
for (const s of ["setAttribProta", "updateMomiaAtr", "vec_nat_room", "sprAttrib",
                 "enemyAttrib", "ProtaY", "ProtaX", "protaStatus", "GameStatus",
                 "piramideActual", "timer", "momiaDat", "ProtaRoom", "valoresSalto"]) {
  if (L[s] == null) { console.log("нет символа", s); process.exit(2); }
}
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
const MD = L.momiaDat;
const OUTDIR = path.join(REPO, "docs/top_overlap_resid");
const LEG_END = Math.floor(NT / 3);
const PAR_END = Math.floor((2 * NT) / 3);
const PAR_SEG = 80;
const PAR_JUMPS = [5, 8, 12, 16];
const PAR_DIST = [0, 8, 16];
const MJ_ROWS = ROW === 8 ? [8, 72] : [ROW];

function tick(keys) {
  for (const c of keys || []) {
    const e = { keyCode: c, which: c, preventDefault() {}, stopPropagation() {} };
    keyboard.keyDown(e);
  }
  const t0 = rd(L.timer);
  do v06c.oneInterrupt(true); while (rd(L.timer) === t0);
  for (const c of keys || []) {
    const e = { keyCode: c, which: c, preventDefault() {}, stopPropagation() {} };
    keyboard.keyUp(e);
  }
}
function snap() {
  return {
    m: memory.bytes.slice(), sp: cpu.sp, pc: cpu.pc, iff: cpu.iff, ip: cpu.iff_pending,
    sf: cpu.sf, pf: cpu.pf, hf: cpu.hf, zf: cpu.zf, cf: cpu.cf, regs: cpu.regs.slice(),
    ms: memory.mode_stack, mm: memory.mode_map, pm: memory.page_map, ps: memory.page_stack, cw: memory.cw,
  };
}
function rest(s) {
  memory.bytes.set(s.m); cpu.sp = s.sp; cpu.pc = s.pc; cpu.iff = s.iff; cpu.iff_pending = s.ip;
  cpu.sf = s.sf; cpu.pf = s.pf; cpu.hf = s.hf; cpu.zf = s.zf; cpu.cf = s.cf;
  for (let i = 0; i < 8; i++) cpu.regs[i] = s.regs[i];
  memory.mode_stack = s.ms; memory.mode_map = s.mm; memory.page_map = s.pm;
  memory.page_stack = s.ps; memory.cw = s.cw;
}
function grab() {
  const b = Buffer.alloc(0x6000);
  for (let i = 0; i < 0x6000; i++) b[i] = rd(0x8000 + i);
  return b;
}
function park() {
  for (let sl = 0; sl < 21; sl++) wr(L.sprAttrib + 4 * sl, 0xE0);
  const t0 = rd(L.timer);
  do v06c.oneInterrupt(true); while (rd(L.timer) === t0);
}
// inject() — необязательная подсадка МЕТКИ В ЭКРАН ровно перед снимком TEST. Через неё
// работает проверка чувствительности (см. ниже, «ПОЧЕМУ ПОДСАДКА ЗДЕСЬ, А НЕ ДО ПАРКОВКИ»).
function residue(inject) {
  const s = snap();
  wr(L.setAttribProta, 0x0C9);
  wr(L.updateMomiaAtr, 0x0C9);
  for (let n = 0; n < 12; n++) park();
  if (inject) inject();
  const TEST = grab();
  for (let a = 0x8000; a < 0xE000; a++) wr(a, 0);
  cpu.sp = (cpu.sp - 2) & 0xffff;
  wr(cpu.sp, 0); wr(cpu.sp + 1, 0);
  cpu.pc = L.vec_nat_room;
  for (let i = 0; i < 40000000 && cpu.pc !== 0; i++) cpu.instruction();
  const ok = cpu.pc === 0;
  const REF = grab();
  rest(s);
  if (!ok) throw new Error("vec_nat_room");
  let d = 0, clipZone = 0, orphan = 0, hole = 0, clipOrphan = 0;
  const list = [];
  let minY = 999, maxY = -999;
  for (let pl = 0; pl < 3; pl++) {
    for (let col = 0; col < 32; col++) {
      for (let lo = 72; lo <= 255; lo++) {
        const i = pl * 0x2000 + col * 256 + lo;
        const tv = TEST[i], rv = REF[i];
        if (tv === rv) continue;
        d++;
        const Y = 255 - lo;
        if (Y < minY) minY = Y;
        if (Y > maxY) maxY = Y;
        if (lo >= 240) clipZone++;
        if (tv !== 0 && rv === 0) { orphan++; if (lo >= 240) clipOrphan++; }
        else if (tv === 0 && rv !== 0) hole++;
        if (list.length < 8) list.push(`p${pl} X=${col * 8} Y=${Y} lo=${lo} T=${tv} R=${rv}`);
      }
    }
  }
  return { d, orphan, hole, clipOrphan, list, minY, maxY, clipZone, TEST, REF };
}
function residueDelta(baseHoles) {
  const r = residue();
  if (!baseHoles) return r;
  let d = 0, clipZone = 0, orphan = 0, hole = 0, clipOrphan = 0;
  const list = [];
  let minY = 999, maxY = -999;
  for (let pl = 0; pl < 3; pl++) {
    for (let col = 0; col < 32; col++) {
      for (let lo = 72; lo <= 255; lo++) {
        const i = pl * 0x2000 + col * 256 + lo;
        if (baseHoles.has(i)) continue;
        const tv = r.TEST[i], rv = r.REF[i];
        if (tv === rv) continue;
        d++;
        const Y = 255 - lo;
        if (Y < minY) minY = Y;
        if (Y > maxY) maxY = Y;
        if (lo >= 240) clipZone++;
        if (tv !== 0 && rv === 0) { orphan++; if (lo >= 240) clipOrphan++; }
        else if (tv === 0 && rv !== 0) hole++;
        if (list.length < 8) list.push(`p${pl} X=${col * 8} Y=${Y} lo=${lo} T=${tv} R=${rv}`);
      }
    }
  }
  return { ...r, d, orphan, hole, clipOrphan, list, minY, maxY, clipZone };
}
function holeSet(r) {
  const s = new Set();
  for (let pl = 0; pl < 3; pl++)
    for (let col = 0; col < 32; col++)
      for (let lo = 72; lo <= 255; lo++) {
        const i = pl * 0x2000 + col * 256 + lo;
        if (r.TEST[i] !== r.REF[i]) s.add(i);
      }
  return s;
}
function savePeakArtifacts(tag, peak) {
  if (!peak.d || !peak.TEST) return;
  fs.mkdirSync(OUTDIR, { recursive: true });
  const diff = Buffer.alloc(0x6000);
  for (let i = 0; i < 0x6000; i++) diff[i] = peak.TEST[i] ^ peak.REF[i];
  const base = `${tag}_t${peak.t}`;
  fs.writeFileSync(path.join(OUTDIR, `peak_diff_${base}.bin`), diff);
  v06c.oneInterrupt(true);
  E.pngFrom(E.idealBmp(), path.join(OUTDIR, `peak_${base}.png`));
  console.log(`  артефакты: peak_${base}.png, peak_diff_${base}.bin`);
}
function yS(v) { return v >= 0xf0 ? v - 256 : v; }
function pairN() {
  let n = 0;
  for (const sl of [0, 1, 2, 3, 4, 5, 6, 7]) if (rd(0xe000 + sl * 256 + 0xd2)) n++;
  return n;
}
function forceMumJump(dir) {
  wr(MD + 0, 1);
  wr(MD + 1, (rd(MD + 1) & ~0x10) | (dir & 0x0c));
  wr(MD + 2, dir === 8 ? 2 : 1);
  wr(MD + 0x0b, 2);
  const vs = L.valoresSalto;
  wr(MD + 0x0c, vs & 255);
  wr(MD + 0x0d, (vs >> 8) & 255);
  wr(MD + 0x0e, 0);
}
function placeActors(row, hx, mx) {
  wr(L.ProtaY, row); wr(L.ProtaX, hx); wr(L.protaStatus, 0);
  wr(MD + 0, 0); wr(MD + 0x14, 1);
  wr(MD + 3, row); wr(MD + 5, mx); wr(MD + 6, rd(L.ProtaRoom));
  wr(L.enemyAttrib, row); wr(L.enemyAttrib + 1, mx);
}

{
  let g = 0;
  while (rd(L.piramideActual) !== 1 && g++ < 20) {
    const cur = rd(L.piramideActual);
    wr(L.piramideDest, cur + 1); wr(L.subStatus, 0); wr(L.GameStatus, 8);
    let m = 0;
    while (m < 6000 && rd(L.piramideActual) === cur) { v06c.oneInterrupt(true); m++; }
  }
  let k = 0;
  while (k < 8000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); k++; }
}
for (let i = 0; i < 40; i++) tick([]);

placeActors(ROW, 100, 100);
for (let i = 0; i < 20; i++) tick([]);

console.log(`ROM=${path.basename(ROM)} ROW=${ROW} pyr=${rd(L.piramideActual)} NT=${NT}`);

// ПОЧЕМУ ПОДСАДКА ПЕРЕД СНИМКОМ TEST, А НЕ ДО ПАРКОВКИ [ПОЧИНКА 2026-09-11].
//   Метка ставилась ДО residue(), то есть до двенадцати тиков парковки. К 2026-09 гейт
//   стал ВСЕГДА выходить с «инструмент слеп» (подсажено 5, видит 0) — и это была не
//   поломка сравнения, а ПЕРЕКРАСКА метки: атрибуция писателя по PC даёт 0x4B37 =
//   vbt8_cp, тайловый блиттер лабиринта (анимация ворот пирамиды 1 доходит до столбца
//   16 на шестом тике парковки и кладёт туда законный фон). Метку стирало ЗАКОННОЕ
//   действие игры, а гейт трактовал это как слепоту сравнения и не мерил НИЧЕГО.
//   Инструмент, который проверяется, — это пара «снимок TEST + эталон vec_nat_room +
//   классификация», а парковка относится к СЦЕНЕ. Поэтому метка ставится ровно там, где
//   её видит инструмент: между последним тиком парковки и grab().
//   НЕГАТИВНЫЙ КОНТРОЛЬ НЕ ПОТЕРЯН: следом идёт прогон residue() БЕЗ подсадки, и он
//   обязан дать d=0 (иначе «контроль не ноль» и тоже выход 3).
{
  const probe = residue(() => { for (let lo = 200; lo < 205; lo++) wr(0x0A000 + 16 * 256 + lo, 0x5A); }).d;
  console.log(`чувствительность: подсажено 5, видит ${probe}`);
  if (probe < 5) { console.log("ГЕЙТ ПАДАЕТ: инструмент слеп"); process.exit(3); }
}
{
  const ctl = residue();
  console.log(`контроль до сцены: d=${ctl.d} orphan=${ctl.orphan} hole=${ctl.hole}`);
  if (ctl.d) { console.log("ГЕЙТ ПАДАЕТ: контроль не ноль", ctl.list); process.exit(3); }
}

let jumps = 0, jumpPair = 0, jumpPairNeg = 0, mumPass = 0;
let parRuns = 0, parContacts = 0, parJumps = 0;
let mjJumps = 0, mjContacts = 0, mjSamples = 0;
let peakLegacy = { d: 0, orphan: 0, hole: 0 };
let peakParallel = { d: 0, orphan: 0, hole: 0 };
let peakMumJump = { d: 0, orphan: 0, hole: 0 };
let peak = { d: 0, orphan: 0, hole: 0 };
let samples = 0;
let inJump = false, sawPair = false, sawNeg = false;
let standingPairTicks = 0;
let parBaseHoles = null;
let inMumJump = false, mjRowIdx = 0, mjPhase = 0;

for (let t = 0; t < NT; t++) {
  const family = t < LEG_END ? "legacy" : (t < PAR_END ? "parallel" : "mumJump");
  const relPar = family === "parallel" ? (t - LEG_END) % PAR_SEG : 0;
  const dir = (Math.floor((t - LEG_END) / 160) % 2 === 0) ? 39 : 37;
  const dist = PAR_DIST[(Math.floor((t - LEG_END) / PAR_SEG)) % 3];

  if (family !== "mumJump") {
    if (rd(L.enemyAttrib) < 0xd0 && Math.abs(yS(rd(L.enemyAttrib)) - ROW) > 16) {
      wr(L.enemyAttrib, ROW); wr(MD + 3, ROW);
    }
    if (yS(rd(L.ProtaY)) > ROW + 40) wr(L.ProtaY, ROW);
  }

  let keys = [];
  if (family === "parallel") {
    if (relPar === 0) parRuns++;
    if (t === LEG_END) parBaseHoles = holeSet(residue());
    const hx = rd(L.ProtaX);
    const mx = dir === 39 ? (hx + dist) & 255 : (hx - dist) & 255;
    wr(L.enemyAttrib + 1, mx); wr(MD + 5, mx);
    keys = PAR_JUMPS.includes(relPar) ? [dir, 32] : [dir];
  } else if (family === "legacy") {
    if (rd(L.enemyAttrib) < 0xd0) {
      wr(L.enemyAttrib + 1, rd(L.ProtaX)); wr(MD + 5, rd(L.ProtaX));
    }
    if (t < (LEG_END >> 1)) {
      keys = t % 24 < 3 ? [32] : (t % 100 < 50 ? [39] : [37]);
    } else {
      const hx = rd(L.ProtaX);
      const off = ((t >> 2) % 40) - 20;
      wr(L.enemyAttrib + 1, (hx + off) & 255); wr(MD + 5, (hx + off) & 255);
      keys = t % 48 < 2 ? [32] : [];
    }
  } else {
    // mumJump: герой стоит/идёт, мумия форс-прыгает через него
    const mjLen = Math.max(1, NT - PAR_END);
    const seg = Math.floor(mjLen / MJ_ROWS.length) || 1;
    const local = t - PAR_END;
    const ri = Math.min(MJ_ROWS.length - 1, Math.floor(local / seg));
    const row = MJ_ROWS[ri];
    const phase = local % 100;
    if (ri !== mjRowIdx || phase === 0) {
      mjRowIdx = ri;
      placeActors(row, 100, 92);
      for (let i = 0; i < 5; i++) tick([]);
    }
    wr(L.protaStatus, 0);
    if (yS(rd(L.ProtaY)) > row + 40) wr(L.ProtaY, row);
    const hx = rd(L.ProtaX);
    if (rd(MD) !== 1) {
      const fromRight = (Math.floor(local / 100) % 2) === 0;
      const mx = fromRight ? (hx + 12) & 255 : (hx - 12) & 255;
      wr(L.enemyAttrib + 1, mx); wr(MD + 5, mx);
      wr(MD + 1, fromRight ? 4 : 8);
      wr(MD + 2, fromRight ? 1 : 2);
      if (phase === 20) forceMumJump(fromRight ? 4 : 8);
    }
    const walk = (Math.floor(local / 200) % 2) === 1;
    keys = walk ? (local % 100 < 50 ? [39] : [37]) : [];
  }

  tick(keys);
  const st = rd(L.protaStatus);
  const mst = rd(MD);
  const py = yS(rd(L.ProtaY));
  const my = yS(rd(L.enemyAttrib));
  const pf = pairN();
  const hx = rd(L.ProtaX), mx = rd(L.enemyAttrib + 1);
  const adjacent = Math.abs(hx - mx) <= 16;
  const rowNow = family === "mumJump" ? MJ_ROWS[mjRowIdx] : ROW;

  if (family === "legacy" && st !== 1 && pf && Math.abs(py - ROW) <= 8) {
    standingPairTicks++;
    if (standingPairTicks === 5) {
      mumPass++;
      samples++;
      const r = residue();
      const pk = { t, py, kind: "mumPass", family: "legacy", ...r };
      if (r.d > peakLegacy.d) peakLegacy = pk;
      if (r.d > peak.d) peak = pk;
    }
  } else if (family === "legacy" && (st === 1 || !pf)) {
    standingPairTicks = 0;
  }

  if (family !== "mumJump" && st === 1) {
    inJump = true;
    if (pf) sawPair = true;
    if (py < 0) sawNeg = true;
  }
  if (family !== "mumJump" && inJump && st !== 1) {
    jumps++;
    if (family === "parallel") parJumps++;
    if (sawPair) {
      jumpPair++;
      if (sawNeg) jumpPairNeg++;
      if (family === "parallel" && adjacent && Math.abs(py - ROW) <= 24) {
        parContacts++;
        samples++;
        const r = residueDelta(parBaseHoles);
        const pk = { t, py, kind: "parallel", dist: Math.abs(hx - mx), family: "parallel", ...r };
        if (r.d > peakParallel.d) peakParallel = pk;
        if (r.d > peak.d) peak = pk;
      } else if (family === "legacy") {
        samples++;
        const r = residue();
        const pk = { t, py, kind: "jumpPair", sawNeg, family: "legacy", ...r };
        if (r.d > peakLegacy.d) peakLegacy = pk;
        if (r.d > peak.d) peak = pk;
      }
    }
    inJump = false; sawPair = false; sawNeg = false;
  }

  if (family === "mumJump") {
    if (mst === 1) {
      if (!inMumJump) { inMumJump = true; mjJumps++; }
      // как mumjump_probe: контакт по X или пара слотов — без узкого фильтра my
      // (сирота на p0 бывает в середине дуги, my далеко от row)
      const mjHit = Math.abs(hx - mx) <= 24 || pf > 0;
      if (mjHit) {
        mjContacts++;
        mjSamples++;
        samples++;
        const r = residue();
        const pk = { t, py, my, kind: "mumJump", row: rowNow, family: "mumJump", ...r };
        const better = (r.orphan > (peakMumJump.orphan || 0)) ||
          (r.orphan === (peakMumJump.orphan || 0) && (r.clipOrphan || 0) > (peakMumJump.clipOrphan || 0)) ||
          (r.orphan === (peakMumJump.orphan || 0) && (r.clipOrphan || 0) === (peakMumJump.clipOrphan || 0) &&
            r.d > peakMumJump.d);
        if (better) peakMumJump = pk;
        if (r.orphan > (peak.orphan || 0) || r.d > peak.d) peak = pk;
      }
    } else if (inMumJump) {
      // посадка: ещё один замер, если был контакт
      if (mjContacts > 0) {
        mjSamples++;
        samples++;
        const r = residue();
        const pk = { t, py, my, kind: "mumJumpLand", row: rowNow, family: "mumJump", ...r };
        if (r.orphan > (peakMumJump.orphan || 0) ||
            (r.orphan === (peakMumJump.orphan || 0) && r.d > peakMumJump.d)) {
          peakMumJump = pk;
        }
        if (r.orphan > (peak.orphan || 0) || r.d > peak.d) peak = pk;
      }
      inMumJump = false;
    }
  }
}

const legacyJumpPair = jumpPair - parContacts;
console.log(`ПОКРЫТИЕ legacy: прыжков ${jumps - parJumps}, jumpPair ${legacyJumpPair}, ` +
  `jumpPair+negY ${jumpPairNeg}, mumPass ${mumPass}`);
console.log(`ПОКРЫТИЕ parallel: прогонов ${parRuns}, прыжков ${parJumps}, ` +
  `контактов «в одну сторону» ${parContacts}`);
console.log(`ПОКРЫТИЕ mumJump: прыжков мумии ${mjJumps}, контактов ${mjContacts}, замеров ${mjSamples}`);
console.log(`ОСТАТОК legacy: пик d=${peakLegacy.d} orphan=${peakLegacy.orphan || 0} hole=${peakLegacy.hole || 0}` +
  (peakLegacy.t != null ? ` @ t=${peakLegacy.t} (${peakLegacy.kind})` : ""));
console.log(`ОСТАТОК parallel: пик d=${peakParallel.d} orphan=${peakParallel.orphan || 0} hole=${peakParallel.hole || 0}` +
  (peakParallel.t != null ? ` @ t=${peakParallel.t}` : ""));
console.log(`ОСТАТОК mumJump: пик d=${peakMumJump.d} orphan=${peakMumJump.orphan || 0} hole=${peakMumJump.hole || 0}` +
  ` clipOrphan=${peakMumJump.clipOrphan || 0}` +
  (peakMumJump.t != null ? ` @ t=${peakMumJump.t} row=${peakMumJump.row} my=${peakMumJump.my}` : ""));
console.log(`ОСТАТОК общий: d=${peak.d} orphan=${peak.orphan || 0} hole=${peak.hole || 0}`);
if (peak.list) for (const x of peak.list) console.log("  ", x);

const legacyCov = (legacyJumpPair >= 1 || mumPass >= 1) && jumpPairNeg >= 1;
const parCov = parRuns >= 3 && parContacts >= 2;
const mjCov = mjJumps >= 2 && mjSamples >= 3;
if (!legacyCov || !parCov || !mjCov) {
  console.log(`ГЕЙТ ПАДАЕТ: слабая выборка (legacy=${legacyCov} parallel=${parCov} mumJump=${mjCov})`);
  process.exit(2);
}

if (peakLegacy.d > 0) savePeakArtifacts("legacy_kvalley_8c", peakLegacy);
if (peakParallel.d > 0) savePeakArtifacts("parallel_kvalley_8c", peakParallel);
if ((peakMumJump.orphan || 0) > 0 || peakMumJump.d > 0) {
  savePeakArtifacts("mumjump_kvalley_8c", peakMumJump);
}

// RED: любой остаток или сирота mumJump (даже если d считался иначе)
if (peak.d > 0 || (peak.orphan || 0) > 0 || (peakMumJump.orphan || 0) > 0) {
  console.log(`ГЕЙТ ПАДАЕТ: остаток d=${peak.d} orphan=${peak.orphan || 0} hole=${peak.hole || 0}` +
    ` (legacy=${peakLegacy.d} parallel=${peakParallel.d}` +
    ` mumJump.orphan=${peakMumJump.orphan || 0} mumJump.clipOrphan=${peakMumJump.clipOrphan || 0})`);
  process.exit(1);
}
console.log("ГЕЙТ OK: legacy/parallel/mumJump покрыты, остатка нет");
process.exit(0);
