// knife_momia_resid.js — ГЕЙТ «НОЖ СБИЛ МУМИЮ: НА ЭКРАНЕ НЕ ОСТАЛОСЬ МУСОРА».
//
// ЖАЛОБА #1 С ЖЕЛЕЗА (MiSTer, 2026-08-06): «есть МУСОР от ножа, если он сбивает мумию;
// ситуация редкая». Была воспроизведена сценой «нож отскочил к ногам героя и подобран»
// (кусок силуэта героя навсегда) и ЗАКРЫТА коммитом 8adb48b (флеш гасит vfr_need).
//
// ЖАЛОБА #2 С ЖЕЛЕЗА (2026-08-07, ROM 5da3ed6e, УЖЕ ПОСЛЕ 8adb48b): «убил мумию,
// СПУСКАЮЩУЮСЯ ПО ЛЕСТНИЦЕ, — остались небольшие артефакты от НОЖА в виде МИГАЮЩИХ
// ТОЧЕК». Воспроизведена ЧАСТЬЮ В (ниже) и на 2026-08-07 ОТКРЫТА.
//
// КРИТЕРИЙ МУСОРА — АБСОЛЮТНЫЙ, без моделей блиттера: все спрайты прячутся (Y=0xE0 в 21
// запись атрибутов), пачка стирает их штатным restore, снимок fb, затем плоскости чистятся
// и комната рисуется ЗАНОВО ИЗ КАРТЫ (vec_nat_room). Любое расхождение в игровом поле
// (lo 72..247) = пиксели, которых в карте нет и которые никто не сотрёт (или, наоборот,
// стёртый фон, которого никто не вернёт), то есть мусор.
//
// ===== ТРИ ОШИБКИ ИЗМЕРЕНИЯ, ПОЧИНЕННЫЕ 2026-08-07 (без них стенд СЛЕП) ==============
//  (1) ПАРКОВКА НЕ ПАРКОВАЛА ГЕРОЯ: тик зовёт setAttribProta, и тот переписывает слоты
//      4/5 координатами героя ЗАНОВО. Лечение (найдено в throw_jump_resid.js): на время
//      замера setAttribProta := RET.
//  (2) ПАРКОВКА НЕ ПАРКОВАЛА МУМИЙ: ровно то же делает updateMomiaAtr (перепись
//      attrib_writers_census.js: 1352 записи за 2000 кадров). Лечение: тоже := RET.
//      Без этого ЖИВАЯ мумия засчитывается как «мусор» и стенд врёт в плюс.
//  (3) ЛЕТЯЩИЙ/ОТСКАКИВАЮЩИЙ НОЖ НЕ ЖДАЛСЯ ДО КОНЦА. Статусы ножа: 4/5 — он ТАЙЛ
//      (рисуется прямо в fb, в карте не описан), 7/8 — он СПРАЙТ (слоты 15-18) и его
//      атрибуты каждый тик переписывает updateKnifeAtt, то есть парковка ему тоже не
//      указ. Старая редакция ждала только 4..6 и вычитала живой тайл маской габарита —
//      отскок 7/8 засчитывался как мусор. Лечение: перед парковкой крутить кадры, пока
//      хоть один нож в статусах 4..8; маска габарита не нужна вовсе.
//
// ДЕКЛАРАЦИЯ ЧУВСТВИТЕЛЬНОСТИ: перед сценами в поле подсаживаются заведомые мусорные
// байты, и замер обязан их увидеть. Не увидел — инструмент слеп, гейт падает (код 3).
//
// ЧАСТИ:
//   А. 72 сцены «мумия НА ПОЛУ» (пирамиды 1,3,5,7 x статус x смещение) — сторож 8adb48b.
//   Б. Сцены «мумия НА ЛЕСТНИЦЕ»: мумию ставим СТОЯТЬ на тайл начала лестницы (0x16/0x17)
//      с управлением ВНИЗ — и за лестницу её берёт САМА ИГРА (chkBajaEscalera -> статус 3),
//      поэтому положение на лестнице не подогнано руками. Герой телепортируется на
//      площадку у лестницы и бросает нож в упор. ДЕКЛАРАЦИЯ ПОКРЫТИЯ: в каждой сцене
//      мумия обязана быть в статусе 3 (ЛЕСТНИЦЫ) в момент броска И столкновение обязано
//      произойти, иначе сцена не считается.
//   В. ДЕТЕРМИНИРОВАННЫЙ ПРОГОН ЖИВОЙ ИГРЫ (псевдоигрок по фиксированному seed): именно он
//      воспроизводит жалобу #2. Нож выдаётся ЧЕСТНО — только тот, что ЛЕЖИТ НА ПОЛУ
//      (статус 1), как и делает chkCogeKnife4; выдёргивать нож из отскока нельзя, иначе
//      стенд сам создаёт брошенный спрайт и врёт.
//   МИГАНИЕ: после сцены 60 кадров покоя, считаем байты fb, принимающие БОЛЕЕ ОДНОГО
//      значения. Пиксель, который остался в fb статично, «мигает» ещё и палитрой (idx4 —
//      слот ауры, vec_brillo_pal перекрашивает его каждый кадр), поэтому владелец видит
//      «мигающие точки» и для статичного мусора; оба критерия считаем отдельно.
//
// Запуск: node tools/verify/knife_momia_resid.js [rom] [sym] [пирамиды] [части=АБВ]
//   env: KV_PARTS=A,B,C   KV_SOAK="пир:seed,..."   KV_FRAMES=600
"use strict";
const { make, toGame } = require("./beam_harness.js");
const T = __dirname, REPO = T + "/../..";
const args = process.argv.slice(2);
let ROM = REPO + "/build/kvalley_8c.rom", SYM = REPO + "/build/kvalley_8c.sym", PYRS = [1, 3, 5, 7];
for (const a of args) {
  if (/\.rom$/i.test(a)) ROM = a; else if (/\.sym$/i.test(a)) SYM = a;
  else if (/^[\d,]+$/.test(a)) PYRS = a.split(",").map(Number);
}
const PARTS = (process.env.KV_PARTS || "A,B,C").split(",").map(s => s.trim().toUpperCase());
const SOAK = (process.env.KV_SOAK || "5:999,7:999,5:777").split(",").map(s => s.split(":").map(Number));
const FRAMES = +(process.env.KV_FRAMES || 600);
const LAD_MAX = +(process.env.KV_LAD_MAX || 12);   // сцен лестницы на пирамиду (полный перебор — 580, гейту столько не нужно)
const E = make(ROM, SYM);
const { L, rd, v06c, memory, keyboard, cpu } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
const KD = L.knifesData, MD = L.momiaDat, SENT = L.protaStatus + 2;
const K = i => ({ st: rd(KD + 17 * i), dir: rd(KD + 17 * i + 1), y: rd(KD + 17 * i + 2), x: rd(KD + 17 * i + 4), room: rd(KD + 17 * i + 5) });
let tick = 0;
const held = new Set();
function keys(list) {
  const want = new Set(list || []);
  for (const c of held) if (!want.has(c)) keyboard.keyUp({ keyCode: c, which: c, preventDefault() { }, stopPropagation() { } });
  for (const c of want) if (!held.has(c)) keyboard.keyDown({ keyCode: c, which: c, preventDefault() { }, stopPropagation() { } });
  held.clear(); for (const c of want) held.add(c);
}
function step(list) { keys(list); const t0 = rd(L.timer); do { v06c.oneInterrupt(true); } while (rd(L.timer) === t0); tick++; }
function snap() {
  return { m: memory.bytes.slice(), sp: cpu.sp, pc: cpu.pc, iff: cpu.iff, ip: cpu.iff_pending,
    sf: cpu.sf, pf: cpu.pf, hf: cpu.hf, zf: cpu.zf, cf: cpu.cf, regs: cpu.regs.slice(),
    ms: memory.mode_stack, mm: memory.mode_map, pm: memory.page_map, ps: memory.page_stack, cw: memory.cw };
}
function rest(s) {
  memory.bytes.set(s.m); cpu.sp = s.sp; cpu.pc = s.pc; cpu.iff = s.iff; cpu.iff_pending = s.ip;
  cpu.sf = s.sf; cpu.pf = s.pf; cpu.hf = s.hf; cpu.zf = s.zf; cpu.cf = s.cf;
  for (let i = 0; i < 8; i++) cpu.regs[i] = s.regs[i];
  memory.mode_stack = s.ms; memory.mode_map = s.mm; memory.page_map = s.pm; memory.page_stack = s.ps; memory.cw = s.cw;
}
function grab() { const b = Buffer.alloc(0x6000); for (let i = 0; i < 0x6000; i++) b[i] = rd(0x8000 + i); return b; }
function park() {
  for (let sl = 0; sl < 21; sl++) wr(L.sprAttrib + 4 * sl, 0xE0);
  const t0 = rd(L.timer); do { v06c.oneInterrupt(true); } while (rd(L.timer) === t0);
}
// РАЗРУШАЮЩИЙ замер: снимок машины -> заткнуть писателей атрибутов -> дать ножам долететь
// -> запарковать спрайты -> fb -> перерисовать комнату из карты -> сравнить -> откатить.
function residue() {
  const s = snap(); const bp = v06c.check_breakpoint; v06c.check_breakpoint = () => false;
  wr(L.setAttribProta, 0x0C9); wr(L.updateMomiaAtr, 0x0C9);
  let fly = 0;
  for (; fly < 600; fly++) {
    let any = 0; for (let i = 0; i < 6; i++) { const st = rd(KD + 17 * i); if (st >= 4 && st <= 8) any = 1; }
    if (!any) break; park();
  }
  for (let n = 0; n < 10; n++) park();
  const TEST = grab();
  for (let a = 0x8000; a < 0xE000; a++) wr(a, 0);
  cpu.sp = (cpu.sp - 2) & 0xffff; wr(cpu.sp, 0); wr(cpu.sp + 1, 0); cpu.pc = L.vec_nat_room;
  for (let i = 0; i < 40000000 && cpu.pc !== 0; i++) cpu.instruction();
  const ok = cpu.pc === 0; const REF = grab();
  rest(s); v06c.check_breakpoint = bp;
  if (!ok) throw new Error("vec_nat_room не вернулся");
  let d = 0; const list = [];
  for (let pl = 0; pl < 3; pl++) for (let col = 0; col < 32; col++) for (let lo = 72; lo <= 247; lo++) {
    const i = pl * 0x2000 + col * 256 + lo;
    if (TEST[i] !== REF[i]) {
      d++; if (list.length < 6) list.push(`p${pl} X=${col * 8} Y=${255 - lo} fb=${TEST[i].toString(2).padStart(8, "0")} карта=${REF[i].toString(2).padStart(8, "0")}`);
    }
  }
  return { d, list, fly };
}
// МИГАНИЕ: N кадров покоя, байты fb игрового поля, принявшие более одного значения.
//  keep() — держатель сцены: вызывается каждый кадр. Нужен потому, что мумия в лимбе
//  (momiaLimbo) через ~200 тиков ПОЯВЛЯЕТСЯ САМА, и её честное появление засчиталось бы
//  как «мигание». Убранных из сцены мумий держим в лимбе принудительно.
function blink(n, keep) {
  const s = snap(); const bp = v06c.check_breakpoint; v06c.check_breakpoint = () => false;
  const seen = new Map();
  for (let f = 0; f < n; f++) {
    if (keep) keep();
    step([]);
    for (let pl = 0; pl < 3; pl++) for (let col = 0; col < 32; col++) for (let lo = 72; lo <= 247; lo++) {
      const i = pl * 0x2000 + col * 256 + lo; const v = rd(0x8000 + i);
      let e = seen.get(i); if (!e) { e = new Set(); seen.set(i, e); } e.add(v);
    }
  }
  let b = 0; const list = [];
  for (const [i, e] of seen) if (e.size > 1) {
    b++; if (list.length < 6) { const pl = i >> 13, col = (i >> 8) & 31, lo = i & 255;
      list.push(`p${pl} X=${col * 8} Y=${255 - lo} значения ${[...e].map(x => x.toString(2).padStart(8, "0")).join("/")}`); }
  }
  rest(s); v06c.check_breakpoint = bp;
  return { b, list };
}
//  ВХОД В ПИРАМИДУ p. Идём НАПРЯМУЮ (piramideDest := p), а не «следующая, следующая»:
//  части Б и В прогоняют пирамиды не по возрастанию и могут заходить в одну и ту же
//  дважды — инкрементный вариант в этих случаях либо не доходил, либо накручивал круг.
function gotoPyr(p) {
  let g = 0;
  while (rd(L.piramideActual) !== p && g++ < 4) {
    const cur = rd(L.piramideActual);
    wr(L.piramideDest, p); wr(L.subStatus, 0); wr(L.GameStatus, 8);
    let m = 0; while (m < 20000 && rd(L.piramideActual) === cur) { v06c.oneInterrupt(true); m++; }
  }
  let k = 0; while (k < 6000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); k++; }
  return rd(L.GameStatus) === 5;
}
const map = (room, r, c) => rd(L.MapaRAMRoot + r * 96 + room * 32 + c);
let cases = 0, hits = 0, dirty = 0, worst = 0, worstTag = "", ctlBad = 0, blinkBad = 0;
const samples = [];
function verdict(tag, r, bl) {
  if (r.d) {
    dirty++;
    if (r.d > worst) { worst = r.d; worstTag = tag; samples.length = 0; samples.push(...r.list); }
    console.log(`  ${tag}: МУСОР ${r.d} байт`);
    console.log("    " + r.list.slice(0, 4).join("\n    "));
  }
  //  МИГАНИЕ — пока СПРАВОЧНЫЙ критерий, гейт по нему НЕ падает: за 60 кадров «покоя»
  //  сцена не обязана быть неподвижной (мумия выходит из лимба сама, нож догорает,
  //  анимация героя доигрывает), и отделить это от дефекта одним счётчиком нельзя.
  //  Реальные «мигающие точки» жалобы — это СТАТИЧНЫЙ мусор в fb, который перекрашивает
  //  палитра (idx4 = слот ауры, vec_brillo_pal), и его ловит абсолютный критерий выше.
  if (bl && bl.b) console.log(`  ${tag}: (справочно) мигающих байт fb ${bl.b}: ` + bl.list.slice(0, 3).join(" | "));
}
// ===== ДЕКЛАРАЦИЯ ЧУВСТВИТЕЛЬНОСТИ ==================================================
{
  const s = snap();
  for (let lo = 100; lo < 105; lo++) wr(0x0A000 + 20 * 256 + lo, 0x5A);
  const probe = residue().d; rest(s);
  console.log(`чувствительность: подсажено 5 байт, замер видит ${probe}`);
  if (probe < 5) { console.log("ГЕЙТ ПАДАЕТ: инструмент слеп — подсаженный мусор не виден"); process.exit(3); }
}
// ===== ЧАСТЬ А: МУМИЯ НА ПОЛУ (сторож 8adb48b) ======================================
if (PARTS.includes("A")) for (const P of PYRS) {
  if (!gotoPyr(P)) { console.log(`А: пирамида ${P}: не дошли до геймплея — пропуск`); continue; }
  for (let i = 0; i < 40; i++) step([]);
  const ctl = residue().d;
  if (ctl) { ctlBad++; console.log(`А: пирамида ${P}: КОНТРОЛЬ ДО СЦЕНЫ не ноль (${ctl}) — сцена недостоверна`); continue; }
  for (let i = 0; i < 20; i++) { wr(L.objetoCogido, 0x10); wr(L.IDcuchilloCoge, 0); step([]); }
  for (let i = 0; i < 40 && K(0).st !== 5; i++) { wr(L.objetoCogido, 0x10); wr(L.IDcuchilloCoge, 0); step(i % 4 < 2 ? [32] : []); }
  if (K(0).st !== 5) { console.log(`А: пирамида ${P}: нож не брошен — пропуск`); continue; }
  const BASE = snap(), kk = K(0), dir = rd(KD + 1);
  for (const MST of [0, 2, 7]) for (const DY of [-7, -3, 0]) for (const DX of [-24, -40]) {
    rest(BASE); tick = 0; cases++;
    const mumX = (kk.x + (dir === 1 ? DX : -DX)) & 255, mumY = (kk.y + DY) & 255;
    let hit = -1;
    v06c.check_breakpoint = function () { if (cpu.pc === L.chkKnifeMomia5 && hit < 0) hit = tick; return false; };
    for (let i = 0; i < 60 && hit < 0; i++) {
      wr(MD + 0, MST); wr(MD + 1, 0); wr(MD + 2, 2); wr(MD + 3, mumY); wr(MD + 4, 0);
      wr(MD + 5, mumX); wr(MD + 6, kk.room); wr(MD + 0x0B, 2); wr(MD + 0x11, 0x40);
      step([]);
    }
    v06c.check_breakpoint = () => false;
    if (hit < 0) { console.log(`  А пир${P} MST${MST} DY${DY} DX${DX}: СТОЛКНОВЕНИЯ НЕ БЫЛО`); continue; }
    hits++;
    for (let i = 0; i < 150; i++) step([]);
    verdict(`А пир${P} MST${MST} DY${DY} DX${DX}`, residue(), null);
  }
}
// ===== ЧАСТЬ Б: МУМИЯ НА ЛЕСТНИЦЕ ===================================================
let ladCases = 0, ladHits = 0, ladOnStairs = 0;
if (PARTS.includes("B")) for (const P of PYRS) {
  if (!gotoPyr(P)) { console.log(`Б: пирамида ${P}: не дошли до геймплея — пропуск`); continue; }
  for (let i = 0; i < 40; i++) step([]);
  const room = rd(L.ProtaRoom);
  // старты лестниц ВНИЗ: 0x16 = вниз-вправо, 0x17 = вниз-влево (см. chkBajaEscalera)
  const starts = [];
  for (let r = 2; r < 23; r++) for (let c = 1; c < 31; c++) { const t = map(room, r, c); if (t === 0x16 || t === 0x17) starts.push({ r, c, t }); }
  // лишние мумии — в лимб за экран, чтобы сцена была про ОДНУ мумию на лестнице
  for (let m = 1; m < 3; m++) { wr(MD + 22 * m + 0, 4); wr(MD + 22 * m + 0x11, 0xF0); wr(MD + 22 * m + 6, 7); }
  for (let i = 0; i < 20; i++) step([]);
  const BASE = snap(); let made = 0;
  outer: for (const s of starts) {
    const dir = s.t === 0x16 ? 1 : -1;
    const my0 = (s.r - 2) * 8 + 4, mx0 = (s.c - 1) * 8 + 4;   // мумия ВСТАЁТ на тайл старта
    for (let fr = s.r; fr <= s.r + 8; fr++) {
      if (fr > 22) continue;
      const HY = (fr - 2) * 8;                                 // герой стоит на ряду fr
      if (HY < my0 - 6) continue;
      const MXat = mx0 + dir * (HY - my0);                     // X мумии, когда она дойдёт до HY
      for (const side of [1, -1]) for (const D of [16, 24]) {
        if (made >= LAD_MAX) break outer;
        const HX = MXat + side * D;
        if (HX < 16 || HX > 232) continue;
        if ((map(room, fr, HX >> 3) & 0xF0) !== 0x10) continue; // под героем обязана быть площадка
        rest(BASE); tick = 0; ladCases++;
        wr(L.ProtaX, HX); wr(L.ProtaY, HY); wr(L.ProtaXdecimal, 0); wr(L.protaStatus, 0); wr(SENT, side > 0 ? 1 : 2);
        for (let i = 0; i < 25; i++) step([]);
        if (rd(L.ProtaY) !== HY || rd(L.protaStatus) !== 0) continue;  // герой не удержался — не сцена
        const ctl = residue().d;
        if (ctl) { ctlBad++; console.log(`  Б пир${P} r${s.r}c${s.c}: КОНТРОЛЬ ПОСЛЕ ТЕЛЕПОРТА не ноль (${ctl})`); continue; }
        wr(MD + 0, 0); wr(MD + 1, 2); wr(MD + 2, 2); wr(MD + 3, (s.r - 2) * 8); wr(MD + 4, 0);
        wr(MD + 5, mx0); wr(MD + 6, room); wr(MD + 0x0B, 0); wr(MD + 0x0F, 0); wr(MD + 0x11, 0x40);
        wr(MD + 0x14, 2); wr(MD + 0x15, 0);
        let g = 0; while (g++ < 260 && !(rd(MD + 0) === 3 && rd(MD + 3) >= HY - 6)) step([]);
        if (rd(MD + 0) !== 3) continue;      // за лестницу не взялась — сцена не о том
        ladOnStairs++;
        let hit = -1;
        v06c.check_breakpoint = function () { if (cpu.pc === L.chkKnifeMomia5 && hit < 0) hit = tick; return false; };
        let onStairsAtHit = 0;
        for (let i = 0; i < 40 && hit < 0; i++) {
          if (rd(MD + 0) === 3) onStairsAtHit = 1;
          wr(L.objetoCogido, 0x10); wr(L.IDcuchilloCoge, 0); step(i % 4 < 2 ? [32] : []);
        }
        v06c.check_breakpoint = () => false;
        if (hit < 0 || !onStairsAtHit) continue;
        ladHits++; made++;
        for (let i = 0; i < 150; i++) step([]);
        verdict(`Б пир${P} старт r${s.r}c${s.c} пол${fr} сторона${side} D${D}`, residue(),
          blink(60, () => { for (let m = 1; m < 3; m++) { wr(MD + 22 * m + 0, 4); wr(MD + 22 * m + 0x11, 0xF0); wr(MD + 22 * m + 6, 7); } }));
      }
    }
  }
}
// ===== ЧАСТЬ В: ДЕТЕРМИНИРОВАННЫЙ ПРОГОН ЖИВОЙ ИГРЫ =================================
//  Псевдоигрок идёт к ближайшей мумии, лезет по лестницам и бросает нож. Нож выдаётся
//  ЧЕСТНО: берётся только тот, что ЛЕЖИТ НА ПОЛУ (статус 1) и переводится в статус 2 —
//  ровно то, что делает chkCogeKnife4. Выдёргивать нож из полёта/отскока НЕЛЬЗЯ: тогда
//  его спрайт остаётся нестёртым и стенд сам создаёт «мусор».
let soakRuns = 0, soakKills = 0, soakLadderKills = 0, soakDirty = 0, soakWorst = 0, soakTag = "";
if (PARTS.includes("C")) for (const [P, SEED0] of SOAK) {
  if (!gotoPyr(P)) { console.log(`В: пирамида ${P}: не дошли до геймплея — пропуск`); continue; }
  for (let i = 0; i < 40; i++) step([]);
  soakRuns++;
  let seed = SEED0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const KEY = { L: 37, R: 39, U: 38, D: 40, A: 32 };
  let killTick = -1, killInfo = "";
  v06c.check_breakpoint = function () {
    if (cpu.pc === L.chkKnifeMomia5 && killTick < 0) {
      killTick = tick; killInfo = "";
      for (let m = 0; m < 3; m++) { const st = rd(MD + 22 * m); if (st === 3) killInfo = "НА ЛЕСТНИЦЕ"; }
    }
    return false;
  };
  for (let f = 0; f < FRAMES; f++) {
    if (rd(L.GameStatus) !== 5) {
      let k = 0; while (k < 4000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); k++; }
      if (rd(L.GameStatus) !== 5) break; for (let i = 0; i < 20; i++) step([]);
    }
    const hx = rd(L.ProtaX), hy = rd(L.ProtaY), hr = rd(L.ProtaRoom);
    let tg = null, bd = 999;
    for (let m = 0; m < rd(L.numMomias); m++) {
      const st = rd(MD + 22 * m + 0); if (st === 4 || st === 5) continue;
      if (rd(MD + 22 * m + 6) !== hr) continue;
      const d = Math.abs(rd(MD + 22 * m + 5) - hx) + Math.abs(rd(MD + 22 * m + 3) - hy);
      if (d < bd) { bd = d; tg = { y: rd(MD + 22 * m + 3), x: rd(MD + 22 * m + 5), st }; }
    }
    const ks = [];
    if (tg) {
      const dy = tg.y - hy, dx = tg.x - hx;
      if (Math.abs(dy) > 10) { ks.push(dy > 0 ? KEY.D : KEY.U); if (rnd() < 0.5) ks.push(dx > 0 ? KEY.R : KEY.L); }
      else if (Math.abs(dx) > 26) { ks.push(dx > 0 ? KEY.R : KEY.L); }
      else {
        if (rd(L.objetoCogido) !== 0x10) for (let i = 0; i < 6; i++) if (rd(KD + 17 * i) === 1) {
          wr(L.objetoCogido, 0x10); wr(L.IDcuchilloCoge, i); wr(KD + 17 * i, 2); break;
        }
        if ((f & 3) < 2) ks.push(KEY.A);
      }
    } else { ks.push(rnd() < 0.5 ? KEY.R : KEY.L); if (rnd() < 0.1) ks.push(KEY.A); }
    if (rnd() < 0.03) ks.push(rnd() < 0.5 ? KEY.U : KEY.D);
    step(ks);
    if (killTick >= 0 && tick - killTick >= 150) {
      soakKills++; if (killInfo) soakLadderKills++;
      killTick = -1;
    }
  }
  v06c.check_breakpoint = () => false;
  const r = residue(), bl = blink(60);   // мигание тут СПРАВОЧНОЕ: сцена не в покое
  const tag = `В пир${P} seed${SEED0} (убийств ${soakKills}, из них на лестнице ${soakLadderKills})`;
  console.log(`${tag}: мусор ${r.d}, мигание ${bl.b}`);
  if (r.d) {
    soakDirty++; if (r.d > soakWorst) { soakWorst = r.d; soakTag = tag; }
    console.log("    " + r.list.slice(0, 6).join("\n    "));
  }
  if (bl.b) console.log(`    (справочно) мигающих байт fb ${bl.b}: ` + bl.list.slice(0, 3).join(" | "));
}
// ===== ИТОГ ==========================================================================
console.log(`А: сцен ${cases}, столкновений ${hits}`);
console.log(`Б: сцен ${ladCases}, из них мумия ВЗЯЛАСЬ ЗА ЛЕСТНИЦУ ${ladOnStairs}, столкновений НА ЛЕСТНИЦЕ ${ladHits}`);
console.log(`В: прогонов ${soakRuns}, убийств ${soakKills}, из них на лестнице ${soakLadderKills}, грязных прогонов ${soakDirty}, худший ${soakWorst} байт ${soakTag}`);
console.log(`ВСЕГО сцен с мусором ${dirty + soakDirty}, худшая ${Math.max(worst, soakWorst)} байт ${worst >= soakWorst ? worstTag : soakTag}`);
if (samples.length) console.log("  " + samples.join("\n  "));
if (ctlBad) { console.log(`ГЕЙТ ПАДАЕТ: контроль до сцены не ноль в ${ctlBad} случаях — инструмент недостоверен`); process.exit(3); }
if (PARTS.includes("A") && hits < cases) { console.log(`ПРОВАЛ ПОКРЫТИЯ А: столкновение произошло лишь в ${hits} сценах из ${cases}`); process.exit(3); }
if (PARTS.includes("B") && ladHits === 0) { console.log("ПРОВАЛ ПОКРЫТИЯ Б: НИ ОДНОГО столкновения с мумией НА ЛЕСТНИЦЕ"); process.exit(3); }
if (PARTS.includes("C") && soakLadderKills === 0) { console.log("ПРОВАЛ ПОКРЫТИЯ В: в живом прогоне НИ РАЗУ не убита мумия на лестнице"); process.exit(3); }
if (dirty + soakDirty || blinkBad) { console.log("ГЕЙТ ПАДАЕТ: после столкновения нож/мумия оставили мусор на экране"); process.exit(1); }
console.log("KNIFE-MOMIA RESID GATE OK: мусора нет ни в одной сцене");
