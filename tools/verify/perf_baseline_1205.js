#!/usr/bin/env node
// perf_baseline_1205.js — эталон производительности/мерцания сборки 2709-1205-M.
//
// Исправления измерителя (после baseline-review):
//  1) pin только на границе завершённого тика (после сброса tickInProgress → tickMain2);
//  2) SAT мумий: (Y,X,Spr,Col)×4; вторая мумия на enemyAttrib+4/+5;
//  3) состояние пачки не сбрасывается в closeFrame; герой — только слоты 4/5 / vop_ow;
//  4) раздельные счётчики кадров/тиков/GameStatus;
//  5) профиль: vtm_afterdraw ≠ vtm_zclip; call/ret vs участок кода; фильтр рабочих пачек;
//  6) строгий repro + negative-control.
//
// Запуск:
//   node tools/verify/perf_baseline_1205.js <rom> <sym> --scene <name> [--ticks N] [--out DIR]
//   node … --repro [--out DIR]
//   node … --repro --negative-control   # 0, если намеренное расхождение обнаружено
"use strict";
const fs = require("fs");
const path = require("path");
const { make, toGame } = require("./beam_harness.js");

const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let SCENE = "load";
let NTICKS = null;
let OUTDIR = null;
let JSONOUT = null;
let REPRO = false;
let NEGATIVE = false;
let ALL = false;

const DEFAULT_TICKS = {
  natural: 2600,
  walk: 500,
  climb: 1800,
  jump2mum: 240,
  load: 500,
  repro: 120,
};

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--scene") SCENE = args[++i];
  else if (a === "--ticks") NTICKS = +args[++i];
  else if (a === "--out") OUTDIR = args[++i];
  else if (a === "--json") JSONOUT = args[++i];
  else if (a === "--repro") REPRO = true;
  else if (a === "--negative-control") NEGATIVE = true;
  else if (a === "--all") ALL = true;
  else if (/^\d+$/.test(a)) NTICKS = +a;
}

function quantiles(arr) {
  if (!arr.length) return { n: 0, avg: 0, median: 0, p90: 0, max: 0, min: 0, sum: 0 };
  const b = arr.slice().sort((x, y) => x - y);
  const q = (p) => b[Math.min(b.length - 1, Math.floor(b.length * p))];
  const sum = b.reduce((s, v) => s + v, 0);
  return {
    n: b.length,
    avg: Math.round(sum / b.length),
    median: q(0.5),
    p90: q(0.9),
    max: b[b.length - 1],
    min: b[0],
    sum,
  };
}

function codeSyms(L) {
  return Object.entries(L)
    .filter(([, v]) => v >= 0x100 && v < 0x8000)
    .sort((a, b) => a[1] - b[1]);
}

function nearestFactory(syms) {
  const addrs = syms.map((x) => x[1]);
  return (pc) => {
    let lo = 0,
      hi = addrs.length - 1,
      r = 0;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (addrs[m] <= pc) {
        r = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return syms[r][0];
  };
}

function fail(msg, code = 2) {
  console.error("FAIL:", msg);
  process.exitCode = code;
  throw new Error(msg);
}

function runScene(sceneName, ticks, opts = {}) {
  const E = make(ROM, SYM);
  const { L, rd, v06c, memory, cpu, cyc, FRAME } = E;
  let hostWrites = 0;
  const rawWr = (a, v) => {
    const allowed = [L.vec_god, L.ProtaY, L.ProtaX, L.protaStatus].includes(a) ||
      (a >= L.momiaDat && a < L.momiaDat + 88) ||
      (a >= L.sprAttrib && a < L.sprAttrib + 84);
    if (!allowed) fail(`запрещённая запись стенда по адресу ${a.toString(16)}`);
    if (rd(L.tickInProgress) !== 0) fail("запись стенда внутри активного тика");
    hostWrites++;
    memory.write(a & 0xffff, v & 255, false);
  };

  const need = [
    "GameStatus",
    "timer",
    "tickInProgress",
    "tickMain2",
    "runGame",
    "vec_isr",
    "vec_isr_depth",
    "vec_spr_out",
    "vso_fix",
    "vec_su_restore",
    "vec_spr_show",
    "vso_merge1",
    "vsp_rdy",
    "vsp_n",
    "ProtaY",
    "ProtaX",
    "ProtaRoom",
    "momiaDat",
    "sprAttrib",
    "enemyAttrib",
    "vec_god",
    "vop_ow",
    "vtm_afterdraw",
    "vtm_zclip",
    "updateMomiaAtr",
  ];
  for (const s of need) if (L[s] === undefined) fail("нет символа " + s);

  const VS = L.vec_vscroll === undefined ? 0x1f : L.vec_vscroll;
  const BEAM0 = 13780 + 192 * (((VS - 0x1f) & 255));
  const BEAM_Y = (Y) => BEAM0 + 192 * Y;
  const MOMIA_STEP = 22;
  const TIP = L.tickInProgress;
  const TM2 = L.tickMain2;
  // xor a / ld (tickInProgress),a непосредственно перед tickMain2 (проверено по ROM)
  const TIP_CLEAR_PC = TM2 - 3; // 0x012A: ld (tickInProgress),a

  const syms = codeSyms(L);
  const near = nearestFactory(syms);
  const PZA = L.vpz_pa,
    PZB = L.vpz_pb;
  const KA = L.vpr_ka,
    KB = L.vpr_kb;
  const WA = L.vop_wa,
    WB = L.vop_wb;
  const VPR_PA = 0x29,
    VPR_PB = 0x2b;
  const SHOW = L.vec_spr_show,
    MERGE = L.vso_merge1,
    OUT = L.vec_spr_out,
    REST = L.vec_su_restore,
    FIX = L.vso_fix,
    ISR = L.vec_isr;

  // Участки кода (не «целая процедура»): явные диапазоны меток.
  const codeSpans = {
    vop_ow_span: { start: L.vop_ow, end: L.vop_ow + 0x50 }, // vop_ow..до vec_hop_ent
    vec_su_restore_span: { start: L.vec_su_restore, end: L.vec_su_save - 1 },
    vec_su_save_span: { start: L.vec_su_save, end: (L.RDVDP || L.vec_su_save + 0x9a) - 1 },
    vtm_afterdraw_span: { start: L.vtm_afterdraw, end: L.vtm_zclip - 1 }, // копирование (+adc)
    vtm_zclip_span: { start: L.vtm_zclip, end: (L.vtm_hrd || L.vtm_zclip + 0x65) - 1 },
    vpz_fast_span: { start: L.vpz_fast, end: (L.vsb_mrow || L.vpz_fast + 0x50) - 1 },
    vec_spr_show_span: { start: L.vec_spr_show, end: (L.vpz_pair || L.vec_spr_show + 0x150) - 1 },
  };
  // Уточнение концов по .sym
  if (L.vsb_mrow) codeSpans.vpz_fast_span.end = L.vsb_mrow - 1;
  if (L.vpz_pair) codeSpans.vec_spr_show_span.end = L.vpz_pair - 1;
  if (L.RDVDP) codeSpans.vec_su_save_span.end = L.RDVDP - 1;
  if (L.vtm_hrd) codeSpans.vtm_zclip_span.end = L.vtm_hrd - 1;
  // vop_ow конец — vec_hop_ent или следующая метка
  {
    const nxt = syms.find(([n, a]) => a > L.vop_ow && !/^vop_/.test(n));
    if (nxt) codeSpans.vop_ow_span.end = nxt[1] - 1;
  }

  // Процедуры для call/ret учёта (вход → возврат, включая вложенные CALL)
  const procEntries = {
    vop_ow: L.vop_ow,
    vec_su_restore: L.vec_su_restore,
    vec_su_save: L.vec_su_save,
    vtm_afterdraw: L.vtm_afterdraw,
    vtm_zclip: L.vtm_zclip,
    vpz_fast: L.vpz_fast,
    vec_spr_show: L.vec_spr_show,
    vec_nat_sprites: L.vec_nat_sprites,
  };

  if (toGame(E) !== 5) fail("нет геймплея (toGame)");
  for (let i = 0; i < 40; i++) {
    const t0 = rd(L.timer);
    do v06c.oneInterrupt(true);
    while (rd(L.timer) === t0);
  }

  const interventions = [];
  const checkpoints = [];
  let pinUnsafe = 0; // подмены при tip!=0
  let pinsDone = 0;

  // Безопасная запись: только при tickInProgress==0
  function safeWr(a, v) {
    if (rd(TIP) !== 0) pinUnsafe++;
    rawWr(a, v);
  }

  function placeTwoMummies(hY, hX, dx0, dx1, useSafe) {
    const w = useSafe ? safeWr : rawWr;
    const room = rd(L.ProtaRoom);
    const MD = L.momiaDat;
    const xs = [(hX + dx0) & 255, (hX + dx1) & 255];
    for (let m = 0; m < 2; m++) {
      const p = MD + m * MOMIA_STEP;
      w(p + 0, 0);
      w(p + 3, hY);
      w(p + 5, xs[m]);
      w(p + 6, room);
      w(p + 0x14, m ? 1 : 4);
    }
    for (let m = 2; m < 4; m++) {
      const p = MD + m * MOMIA_STEP;
      w(p + 0, 4);
      w(p + 3, 0xe0);
    }
    // SAT enemyAttrib: (Y,X,Spr,Col) на мумию; мумия1 = +4/+5/+6/+7
    const pats = [0x28, 0x28 + 0x60];
    const cols = [0x0a, 0x09];
    for (let m = 0; m < 2; m++) {
      const base = L.enemyAttrib + m * 4;
      w(base + 0, hY);
      w(base + 1, xs[m]);
      w(base + 2, pats[m]);
      w(base + 3, cols[m]);
      // слоты 6/7 в общем SAT (sprAttrib) — то, что читает вывод
      const sa = L.sprAttrib + 4 * (6 + m);
      w(sa + 0, hY);
      w(sa + 1, xs[m]);
      w(sa + 2, pats[m]);
      w(sa + 3, cols[m]);
    }
    for (let sl = 8; sl <= 13; sl++) w(L.sprAttrib + 4 * sl, 0xe0);
  }

  function snapCtrl() {
    return {
      tip: rd(TIP),
      timer: rd(L.timer),
      gs: rd(L.GameStatus),
      py: rd(L.ProtaY),
      px: rd(L.ProtaX),
      room: rd(L.ProtaRoom),
      pira: rd(L.piramideActual),
      status: rd(L.protaStatus),
      // правильные поля SAT
      m0y: rd(L.enemyAttrib + 0),
      m0x: rd(L.enemyAttrib + 1),
      m0spr: rd(L.enemyAttrib + 2),
      m0col: rd(L.enemyAttrib + 3),
      m1y: rd(L.enemyAttrib + 4),
      m1x: rd(L.enemyAttrib + 5),
      m1spr: rd(L.enemyAttrib + 6),
      m1col: rd(L.enemyAttrib + 7),
      sat6y: rd(L.sprAttrib + 4 * 6),
      sat6x: rd(L.sprAttrib + 4 * 6 + 1),
      sat7y: rd(L.sprAttrib + 4 * 7),
      sat7x: rd(L.sprAttrib + 4 * 7 + 1),
    };
  }

  let keyFn = () => [];
  let pinFn = null;
  let ramNote = "";
  let sceneKind = sceneName;
  // покрытие jump2mum
  let covJumps = 0,
    covInJump = false,
    covOverlapBoth = 0,
    covVisibleMum = 0;

  function configureScene() {
    if (sceneName === "natural") {
      // Тур с читом N: может уйти с GS=5. Метрики геймплея — только кадры GS=5.
      keyFn = (t) => {
        const k = [];
        if (t < 900) {
          if ((t >> 2) & 1) k.push(32);
        } else if (t < 1000) k.push(39);
        else if (t < 1010) k.push(78);
        else if (t < 1300) k.push(t & 8 ? 39 : 37);
        else if (t < 1310) k.push(78);
        else if (t < 1600) k.push(t & 8 ? 38 : 39);
        else if (t < 1640) k.push(78);
        else if (t < 2000) k.push(t & 8 ? 39 : 37);
        else if (t < 2060) k.push(78);
        else k.push(t & 8 ? 37 : 39);
        return k;
      };
      ramNote =
        "natural: только клавиши (вкл. чит N). Координаты не пишем. Сцена — смешанный тур; " +
        "лучевые/пачечные метрики считаются только на кадрах GameStatus=5.";
      sceneKind = "natural_mixed_tour";
    } else if (sceneName === "walk") {
      rawWr(L.vec_god, 1);
      interventions.push("vec_god=1 (до измерений, на завершённом тике)");
      keyFn = (t) => [t & 64 ? 37 : 39];
      ramNote = "walk: GOD; ходьба без poke X/Y";
    } else if (sceneName === "climb") {
      rawWr(L.vec_god, 1);
      rawWr(L.ProtaY, 40);
      rawWr(L.ProtaX, 152);
      rawWr(L.protaStatus, 0);
      placeTwoMummies(40, 152, 18, -18, false);
      interventions.push(
        "vec_god=1",
        "ProtaY=40",
        "ProtaX=152",
        "2×momiaDat + enemyAttrib/sprAttrib слоты 6/7"
      );
      keyFn = (t) => {
        const ph = t % 40;
        if (ph < 28) return [38];
        if (ph < 34) return [39];
        return [37];
      };
      pinFn = () => {
        if (rd(L.ProtaY) > 72) safeWr(L.ProtaY, 48);
        const hx = rd(L.ProtaX),
          hy = Math.min(rd(L.ProtaY), 56);
        placeTwoMummies(hy < 8 ? 40 : hy, hx, 18, -18, true);
      };
      interventions.push("pin@tickMain2: ProtaY cap + 2 мумии к герою");
      ramNote = "climb: GOD + верхняя лестница; pin на завершённом тике";
    } else if (sceneName === "jump2mum") {
      rawWr(L.vec_god, 1);
      const HY = 72,
        HX = 148;
      rawWr(L.ProtaY, HY);
      rawWr(L.ProtaX, HX);
      rawWr(L.protaStatus, 0);
      placeTwoMummies(HY, HX, 4, -4, false);
      interventions.push(
        "vec_god=1",
        `ProtaY=${HY}`,
        `ProtaX=${HX}`,
        "2 мумии: momiaDat + enemyAttrib(+0/+4) + sprAttrib 6/7"
      );
      keyFn = (t) => {
        const k = [39];
        const ph = t % 48;
        if (ph >= 8 && ph < 20) k.push(32);
        return k;
      };
      pinFn = () => {
        let hx = rd(L.ProtaX);
        let hy = rd(L.ProtaY);
        // не даём упасть с площадки / уйти далеко от рта лестницы
        if (hy > 0xe0 || hy > HY + 48 || hy < 8) {
          safeWr(L.ProtaY, HY);
          hy = HY;
        }
        if (hx < 120 || hx > 200) {
          safeWr(L.ProtaX, HX);
          hx = HX;
        }
        placeTwoMummies(HY, hx, 4, -4, true);
      };
      interventions.push("pin@tickMain2: мумии к X героя; герой удерживается у лестницы Y=72 X∈[120,200]");
      ramNote = "jump2mum: требует видимых мумий, ≥2 прыжков и пересечение обеих в воздухе";
    } else if (sceneName === "load" || sceneName === "repro") {
      rawWr(L.vec_god, 1);
      const ROW = 8;
      rawWr(L.ProtaY, ROW);
      rawWr(L.ProtaX, 120);
      rawWr(L.protaStatus, 0);
      placeTwoMummies(ROW, 120, 14, -14, false);
      interventions.push(
        "vec_god=1",
        `ProtaY=${ROW}`,
        "ProtaX=120",
        "2 мумии на ROW=8 (momiaDat+SAT)"
      );
      // чередуем направление, иначе герой упирается в край и vsp_rdy=0 навсегда
      keyFn = (t) => [t & 32 ? 37 : 39];
      pinFn = () => {
        let hx = rd(L.ProtaX);
        if (hx < 64) hx = 64;
        if (hx > 208) hx = 208;
        // negative-control: однократный сдвиг на тике 30 — прогон завершается, метрики расходятся
        if (opts.negative && completedLogicTicks === 30) hx = (hx + 1) & 255;
        safeWr(L.ProtaX, hx);
        safeWr(L.ProtaY, ROW);
        placeTwoMummies(ROW, hx, 14, -14, true);
      };
      interventions.push("pin@tickMain2: ProtaY=8, X∈[64,208], 2 мумии; клавиши ↔");
      ramNote = "load/repro: нагрузка верхнего ряда; pin на завершённом тике";
    } else fail("неизвестная сцена " + sceneName);

    checkpoints.push({ when: "after_setup", ...snapCtrl() });

  }
  // Начальная установка также ждёт завершения тика; не опираемся на timer.
  let configured = false;
  v06c.check_breakpoint = () => {
    if (!configured && cpu.pc === TM2 && rd(TIP) === 0) {
      configureScene();
      configured = true;
    }
    return false;
  };
  for (let n = 0; !configured && n < 100; n++) v06c.oneInterrupt(true);
  v06c.check_breakpoint = () => false;
  if (!configured) fail("не достигнута безопасная точка установки сцены");

  // --- измерители --------------------------------------------------------
  let TT = 0;
  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    oI();
    TT += cpu.vcycles | 0;
  };

  const FB0 = 0x8000,
    PLN = 0x2000,
    SZ = PLN * 3;
  const cur = new Uint8Array(SZ),
    shown = new Uint8Array(SZ),
    old = new Uint8Array(SZ);
  const tmask = new Uint8Array(SZ),
    touched = new Int32Array(SZ);
  let nT = 0;
  const frameHeroTops = new Set();
  const frameHeroSlots = new Set();
  let packDrawn = new Map();
  let packHoleEvents = 0, completedHoleEvents = 0, verifiedHolePairs = 0;
  const overlapExamples = [];
  let covNearStairs = 0;
  // Raster images are frame-local; erase/draw timestamps survive frame boundaries.
  for (let i = 0; i < SZ; i++) cur[i] = rd(FB0 + i);
  old.set(cur);
  shown.set(cur);

  let frameIrq = 0; // TT at start of current screen frame (depth-0 ISR or oneInterrupt)
  let frameIndex = 0;
  let live = false;
  let inPack = false,
    inErase = false,
    curSlot = -1;
  let erRet = -1,
    erSp = -1;
  let packOst = 0,
    packWork = false,
    packFast = 0,
    packOpaque = 0,
    packPath = "none";

  // PACK-LOCAL (survives closeFrame)
  let packBoxC0 = 99,
    packBoxC1 = -1,
    packBoxL0 = -1,
    packBoxL1 = -1;
  let heroEraseLast = -1,
    heroDrawDone = -1,
    heroDrawFrameIrq = -1,
    heroDrawFrameIdx = -1;
  const heroEraseBeamT = new Float64Array(SZ);
  const heroEraseT = new Float64Array(SZ),
    heroDrawT0 = new Float64Array(SZ);
  const heroEMask = new Uint8Array(SZ),
    heroDMask = new Uint8Array(SZ);

  const packDurs = [];
  const packStarts = []; // cyc at entry, WORKING only
  const heroDoneAbs = []; // TT absolute
  const heroDonePhase = []; // TT - frameIrq of the frame when hero finished
  const heroGap = [];
  const packEndsLate = { n: 0, late: 0 };
  const pathCounts = { normal: 0, merged: 0, opaque: 0, other: 0 };
  const pathHeroSamples = { normal: 0, merged: 0, opaque: 0, other: 0 };

  let hwFramesTotal = 0,
    hwFramesGameplay = 0,
    completedLogicTicks = 0;
  const gsHist = Object.create(null);
  let emptyPacks = 0,
    workPacks = 0;
  let badPix = 0,
    badFrames = 0,
    chgPix = 0;
  let topBadPix = 0,
    topBadFrames = 0,
    topFrames = 0,
    topChgPix = 0;
  let z48Frames = 0,
    z48BadFrames = 0,
    z48BadPix = 0,
    z48Chg = 0;
  let holeN = 0,
    holeSum = 0,
    holeHit = 0,
    holeMax = 0;

  // profile: only inside WORKING packs; pause when nested ISR
  const labelCost = Object.create(null);
  const spanCost = Object.create(null);
  for (const k of Object.keys(codeSpans)) spanCost[k] = 0;
  const callCost = Object.create(null); // whole procedure via call/ret
  for (const k of Object.keys(procEntries)) callCost[k] = 0;
  const callStack = []; // {name, ret, sp, startTT}
  let prevPc = null,
    inPackProf = false,
    packProfCyc = 0,
    packProfNestedSkip = 0,
    workPackProfSum = 0;
  let cycHeroShow = 0,
    cycMumShow = 0,
    cycHeroErase = 0,
    cycMumErase = 0;
  let tipSeenSet = false,
    tickJustFinished = false;
  let completedTickPendingPin = false;

  function boxAdd(hi0, lo0, nc) {
    if (!nc) return;
    const c0 = hi0 & 31;
    if (c0 < packBoxC0) packBoxC0 = c0;
    if (c0 + nc - 1 > packBoxC1) packBoxC1 = c0 + nc - 1;
    if (packBoxL0 < 0) {
      packBoxL0 = lo0;
      packBoxL1 = (lo0 + 15) & 255;
    } else {
      if (lo0 < packBoxL0) packBoxL0 = lo0;
      if (((lo0 + 15) & 255) > packBoxL1) packBoxL1 = (lo0 + 15) & 255;
    }
  }
  function inPackHeroBox(i) {
    if (packBoxC1 < 0) return false;
    const k = i & 0x1fff,
      col = (k >> 8) & 31,
      lo = k & 255;
    return col >= packBoxC0 && col <= packBoxC1 && lo >= packBoxL0 && lo <= packBoxL1;
  }
  function rdRec(idx) {
    const pg = 0xe000 + idx * 256;
    return { pend: rd(pg + 0x96), hi0: rd(pg + 0x97), lo0: rd(pg + 0x98), nc: rd(pg + 0x99) };
  }
  function rdHdr(idx) {
    const pg = 0xe000 + idx * 256;
    return { valid: rd(pg), hi0: rd(pg + 1), lo0: rd(pg + 2), nc: rd(pg + 3) };
  }
  function retOf() {
    return memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8);
  }
  function classifyPath() {
    if (rd(L.vop_i1)) return "opaque";
    if (rd(L.vsp_fast)) return "merged";
    return "normal";
  }

  const beamT = (k) => frameIrq + BEAM0 + 192 * (255 - (k & 255)) + 6 * ((k >> 8) & 31);

  const oW = memory.write.bind(memory);
  memory.write = function (addr, w8, stackrq) {
    oW(addr, w8, stackrq);
    const a = addr & 0xffff;
    if (a < FB0 || a >= 0xe000) return;
    const i = a - FB0;
    cur[i] = w8 & 0xff;
    if (!live) return;
    const k = i & 0x1fff;
    if (TT <= beamT(k)) shown[i] = w8 & 0xff;
    if (!tmask[i]) {
      tmask[i] = 1;
      touched[nT++] = i;
    }
    if (inPack && !inErase && curSlot >= 4 && curSlot <= 13) {
      const pg = 0xe000 + curSlot * 256;
      if (!packDrawn.has(curSlot)) packDrawn.set(curSlot, {
        slot: curSlot, y: rd(pg + 0x9c), x: rd(pg + 0x9d),
        status: rd(L.protaStatus), room: rd(L.ProtaRoom), pira: rd(L.piramideActual),
      });
    }
    if (inPack && (curSlot === 4 || curSlot === 5) && !frameHeroSlots.has(curSlot)) {
      frameHeroSlots.add(curSlot);
      const r = rdRec(curSlot), h = rdHdr(curSlot);
      if (r.nc) frameHeroTops.add(255 - ((r.lo0 + 15) & 255));
      if (h.valid && h.nc) frameHeroTops.add(255 - ((h.lo0 + 15) & 255));
    }
    // Герой: только писатели пары (слоты 4/5 или vop_ow), не мумии в том же bbox
    const heroWriter = curSlot === 4 || curSlot === 5;
    if (inPack && inErase && heroWriter) {
      heroEMask[i] = 1;
      heroEraseT[i] = TT;
      let scan = beamT(k);
      if (scan <= TT) scan += FRAME;
      heroEraseBeamT[i] = scan;
      heroEraseLast = TT;
    } else if (inPack && !inErase && heroWriter) {
      if (!heroDMask[i]) {
        heroDMask[i] = 1;
        heroDrawT0[i] = TT;
        if (heroEMask[i] && TT > heroEraseT[i]) {
          // One event per byteplane, independent of pack/frame completion order.
          const gap = TT - heroEraseT[i];
          holeN++;
          packHoleEvents++;
          holeSum += gap;
          holeMax = Math.max(holeMax, gap);
          if (heroEraseBeamT[i] < TT) holeHit++;
        }
      }
      heroDrawDone = TT;
      heroDrawFrameIrq = frameIrq;
      heroDrawFrameIdx = frameIndex;
    }
  };

  function closeFrame() {
    hwFramesTotal++;
    const gs = rd(L.GameStatus);
    gsHist[gs] = (gsHist[gs] || 0) + 1;
    if (!live) {
      nT = 0;
      tmask.fill(0);
      old.set(cur);
      shown.set(cur);
      frameHeroTops.clear();
      frameHeroSlots.clear();
      // НЕ трогаем pack-local hero/box
      return;
    }
    hwFramesGameplay++;
    const heroInTopBand = [...frameHeroTops].some(y => y >= 48 && y < 64);

    let bad = 0,
      chg = 0,
      bad48 = 0,
      chg48 = 0,
      any48 = false;
    const seen = new Set();
    for (let t = 0; t < nT; t++) {
      const i = touched[t];
      const k = i & 0x1fff;
      if (seen.has(k)) continue;
      seen.add(k);
      const Y = 255 - (k & 255);
      if (Y < 0 || Y >= 192) continue;
      const inTopBand = Y >= 48 && Y < 64;
      if (inTopBand) any48 = true;
      const o0 = old[k],
        o1 = old[k + PLN],
        o2 = old[k + 2 * PLN];
      const n0 = cur[k],
        n1 = cur[k + PLN],
        n2 = cur[k + 2 * PLN];
      const s0 = shown[k],
        s1 = shown[k + PLN],
        s2 = shown[k + 2 * PLN];
      for (let b = 0; b < 8; b++) {
        const bit = 1 << b;
        const co = ((o0 & bit) ? 1 : 0) | ((o1 & bit) ? 2 : 0) | ((o2 & bit) ? 4 : 0);
        const cn = ((n0 & bit) ? 1 : 0) | ((n1 & bit) ? 2 : 0) | ((n2 & bit) ? 4 : 0);
        const cs = ((s0 & bit) ? 1 : 0) | ((s1 & bit) ? 2 : 0) | ((s2 & bit) ? 4 : 0);
        if (cn !== co) {
          chg++;
          if (inTopBand) chg48++;
        }
        if (cs !== co && cs !== cn) {
          bad++;
          if (inTopBand) bad48++;
        }
      }

    }
    badPix += bad;
    chgPix += chg;
    if (bad > 0) badFrames++;
    if (any48) {
      z48Frames++;
      z48Chg += chg48;
      z48BadPix += bad48;
      if (bad48 > 0) z48BadFrames++;
    }
    if (heroInTopBand) {
      topFrames++;
      topChgPix += chg;
      topBadPix += bad;
      if (bad > 0) topBadFrames++;
    }

    for (let t = 0; t < nT; t++) tmask[touched[t]] = 0;
    nT = 0;
    old.set(cur);
    shown.set(cur);
    frameHeroTops.clear();
    frameHeroSlots.clear();
    // pack-local НЕ сбрасываем здесь
  }

  function endPack() {
    let pairs = 0;
    for (let j=0; j<SZ; j++) if (heroEMask[j] && heroDMask[j] && heroDrawT0[j] > heroEraseT[j]) pairs++;
    if (pairs !== packHoleEvents) fail(`потеря событий стирания: ${packHoleEvents} учтено, ${pairs} пар в пачке`);
    completedHoleEvents += packHoleEvents;
    verifiedHolePairs += pairs;
    const dur = TT - packOst;
    const isWork = packWork && dur > 1000;
    if (isWork) {
      workPacks++;
      packDurs.push(dur);
      packStarts.push(packStartCyc);
      workPackProfSum += packProfCyc;
      pathCounts[packPath] = (pathCounts[packPath] || 0) + 1;
      if (heroDrawDone >= 0) {
        heroDoneAbs.push(heroDrawDone);
        heroDonePhase.push(heroDrawDone - heroDrawFrameIrq);
        pathHeroSamples[packPath] = (pathHeroSamples[packPath] || 0) + 1;
      }
      if (heroEraseLast >= 0 && heroDrawDone > heroEraseLast) heroGap.push(heroDrawDone - heroEraseLast);
      if (packBoxL1 >= 0) {
        const Ytop = 255 - packBoxL1;
        packEndsLate.n++;
        // относительно кадра, в котором пачка стартовала: informational
        if (packOst + dur - packFrameIrq > BEAM_Y(Ytop)) packEndsLate.late++;
      }
    } else emptyPacks++;

    if (sceneName === "jump2mum" && isWork) {
      const m0 = packDrawn.get(6), m1 = packDrawn.get(7);
      if (m0 && m1 && m0.y < 192 && m1.y < 192) covVisibleMum++;
      for (const h of [packDrawn.get(4), packDrawn.get(5)]) {
        if (!h || !m0 || !m1 || ![1, 2].includes(h.status) || h.pira !== 1) continue;
        // Common intersection of three 16x16 sprites, from output records.
        const x0 = Math.max(h.x, m0.x, m1.x), x1 = Math.min(h.x+16, m0.x+16, m1.x+16);
        const y0 = Math.max(h.y, m0.y, m1.y), y1 = Math.min(h.y+16, m0.y+16, m1.y+16);
        if (x0 >= x1 || y0 >= y1) continue;
        covOverlapBoth++;
        const tiles = [];
        for (let y = Math.max(0, h.y-16); y <= Math.min(191,h.y+32); y += 8)
          for (let x = Math.max(0,h.x-24); x <= Math.min(255,h.x+32); x += 8) {
            const addr = L.MapaRAMRoot + (y >> 3)*96 + h.room*32 + (x >> 3);
            const tile = rd(addr);
            tiles.push({x: x>>3, y: y>>3, tile});
          }
        const stairs = tiles.some(t => [0x21,0x22,0x31,0x32].includes(t.tile));
        if (stairs) covNearStairs++;
        if (overlapExamples.length < 12) overlapExamples.push({tick: completedLogicTicks, h,m0,m1, intersection:{x0,x1,y0,y1}, stairs, tiles});
        break;
      }
    }
    // сброс pack-local
    inPack = false;
    inPackProf = false;
    curSlot = -1;
    packBoxC0 = 99;
    packBoxC1 = -1;
    packBoxL0 = packBoxL1 = -1;
    heroDrawDone = heroEraseLast = -1;
    heroDrawFrameIrq = -1;
    heroEMask.fill(0);
    heroDMask.fill(0);
    packProfCyc = 0;
  }

  let packStartCyc = 0,
    packFrameIrq = 0;

  v06c.check_breakpoint = function () {
    const pc = cpu.pc;
    const depth = rd(L.vec_isr_depth);
    const tip = rd(TIP);

    // --- граница тика ---
    if (tip === 1) tipSeenSet = true;
    if (pc === TIP_CLEAR_PC && tipSeenSet) {
      // ld (tickInProgress),a с A=0 — завершение логического тика
      tickJustFinished = true;
      tipSeenSet = false;
    }
    if (pc === TM2 && tickJustFinished) {
      tickJustFinished = false;
      completedLogicTicks++;
      completedTickPendingPin = true;
      // безопасная точка: tip уже 0
      if (pinFn) {
        if (rd(TIP) !== 0) pinUnsafe++;
        pinFn();
        pinsDone++;
      }
      if (
        completedLogicTicks === 1 ||
        completedLogicTicks === Math.floor(ticks / 2) ||
        completedLogicTicks === ticks
      ) {
        checkpoints.push({ when: "tick_" + completedLogicTicks, ...snapCtrl() });
      }
      if (sceneName === "jump2mum") {
        const airborne = [1, 2].includes(rd(L.protaStatus));
        if (airborne && !covInJump) covJumps++;
        covInJump = airborne;
      }
    }

    // --- call/ret процедуры (вход→возврат). Ложные RET отсекаем по dt < 3 кадров. ---
    for (const [name, entry] of Object.entries(procEntries)) {
      if (pc === entry) {
        // prep только пока идёт логический тик (tip=1); pack-процедуры — в рабочей пачке
        if (name === "vec_nat_sprites" && tip !== 1) continue;
        if (name !== "vec_nat_sprites" && !(inPackProf && packWork)) continue;
        callStack.push({ name, ret: retOf(), sp: cpu.sp, startTT: TT, inPack: inPackProf && packWork });
      }
    }
    if (callStack.length) {
      const top = callStack[callStack.length - 1];
      if (pc === top.ret && cpu.sp > top.sp) {
        const dt = TT - top.startTT;
        if (dt > 0 && dt < FRAME * 3) {
          if (top.name === "vec_nat_sprites" || top.inPack) callCost[top.name] += dt;
        }
        callStack.pop();
      }
    }

    // --- профиль участков внутри рабочей пачки; пауза во вложенном ISR ---
    const nested = depth > 1;
    if (inPackProf && packWork && prevPc !== null) {
      const c = cpu.vcycles | 0;
      if (nested) packProfNestedSkip += c;
      else {
        packProfCyc += c;
        const lab = near(prevPc);
        labelCost[lab] = (labelCost[lab] || 0) + c;
        for (const [name, r] of Object.entries(codeSpans)) {
          if (prevPc >= r.start && prevPc <= r.end) spanCost[name] += c;
        }
        if (inErase) {
          if (curSlot === 4 || curSlot === 5) cycHeroErase += c;
          else if (curSlot >= 6 && curSlot <= 13) cycMumErase += c;
        } else if (curSlot === 4 || curSlot === 5) cycHeroShow += c;
        else if (curSlot >= 6 && curSlot <= 13) cycMumShow += c;
      }
    }

    if (pc === REST && erRet < 0) {
      erSp = cpu.sp;
      erRet = retOf();
      inErase = true;
      if (L.vec_nsp_idx !== undefined) curSlot = rd(L.vec_nsp_idx);
    } else if (erRet >= 0 && pc === erRet && cpu.sp > erSp) {
      erRet = -1;
      inErase = false;
    }

    if (pc === ISR && depth === 0) {
      // новый экранный кадр по входу depth-0 (если дошли)
      frameIrq = TT;
    }

    if (pc === OUT && !inPack) {
      inPack = true;
      packDrawn = new Map();
      packHoleEvents = 0;
      packOst = TT;
      packStartCyc = cyc();
      packFrameIrq = frameIrq;
      packWork = rd(L.vsp_rdy) !== 0 && rd(L.vsp_n) !== 0;
      packFast = rd(L.vsp_fast);
      packOpaque = rd(L.vop_i1);
      packPath = classifyPath();
      inPackProf = true;
      packProfCyc = 0;
      heroDrawDone = heroEraseLast = -1;
      heroDrawFrameIrq = -1;
      packBoxC0 = 99;
      packBoxC1 = -1;
      packBoxL0 = packBoxL1 = -1;
      for (const r of [rdRec(4), rdRec(5)]) if (r.pend === 1) boxAdd(r.hi0, r.lo0, r.nc);
      for (const h of [rdHdr(4), rdHdr(5)]) if (h.valid) boxAdd(h.hi0, h.lo0, h.nc);
      heroEMask.fill(0);
      heroDMask.fill(0);
    } else if (inPack && pc === FIX + 3) {
      endPack();
    }

    if (inPack) {
      if (pc === SHOW || pc === MERGE) curSlot = rd(L.vec_nsp_idx);
      else if (pc === KA || (WA && pc === WA)) curSlot = (rd(VPR_PA) - 0xe0) & 255;
      else if (pc === KB || (WB && pc === WB)) curSlot = (rd(VPR_PB) - 0xe0) & 255;
      else if (PZA && pc === PZA) curSlot = (rd(PZA + 1) - 0xe0) & 255;
      else if (PZB && pc === PZB) curSlot = (rd(PZB + 1) - 0xe0) & 255;
      else if (pc === L.vop_ow) curSlot = 4;
    }

    prevPc = pc;
    return false;
  };

  // --- прогон ------------------------------------------------------------
  let held = new Set();
  let nf = 0;
  const tLimit = ticks;
  const frameCap = tLimit * 8 + 4000;
  let hitFrameCap = false;

  while (completedLogicTicks < tLimit && nf < frameCap) {
    const want = new Set(keyFn(completedLogicTicks));
    for (const c of held) if (!want.has(c)) E.key(c, 0);
    for (const c of want) if (!held.has(c)) E.key(c, 1);
    held = want;

    frameIrq = TT; // якорь экранного кадра = старт oneInterrupt
    frameIndex = nf;
    live = rd(L.GameStatus) === 5;
    v06c.oneInterrupt(true);
    closeFrame();
    nf++;
  }
  if (nf >= frameCap && completedLogicTicks < tLimit) hitFrameCap = true;
  for (const c of held) E.key(c, 0);
  v06c.check_breakpoint = () => false;

  // --- проверки покрытия / инвариантов ---
  if (pinUnsafe !== 0) fail(`подмены внутри активного тика: ${pinUnsafe} (ожидали 0)`);
  if (completedLogicTicks < tLimit)
    fail(`недобор тиков: ${completedLogicTicks}/${tLimit}` + (hitFrameCap ? " (лимит кадров)" : ""), 2);
  if (hitFrameCap) fail("достигнут лимит аппаратных кадров", 2);

  if (sceneName === "jump2mum") {
    const okVis = covVisibleMum >= 1;
    const okJump = covJumps >= 2;
    const okOv = covOverlapBoth >= 1 && covNearStairs >= 1;
    if (!okVis || !okJump || !okOv) {
      fail(
        `jump2mum покрытие: visibleMummyPacks=${covVisibleMum}, jumps=${covJumps}, overlapBoth=${covOverlapBoth} (нужно actualVisiblePacks≥1, jumps≥2, tripleOverlapNearStairs≥1)`,
        2
      );
    }
  }
  if (sceneName === "load" || sceneName === "repro") {
    if (workPacks < Math.floor(tLimit * 0.5))
      fail(`load/repro: рабочих пачек ${workPacks} < ${Math.floor(tLimit * 0.5)} (герой/мумии перестали грязниться)`, 2);
  }

  // профиль покрытие
  const durQ = quantiles(packDurs);
  const startQ = quantiles(packStarts);
  const labelSum = Object.values(labelCost).reduce((a, b) => a + b, 0);
  const profileCoveragePct = workPackProfSum ? +((100 * labelSum) / workPackProfSum).toFixed(2) : 0;

  const spanRows = Object.entries(spanCost)
    .map(([k, v]) => ({
      span: k,
      range: codeSpans[k]
        ? `0x${codeSpans[k].start.toString(16)}-0x${codeSpans[k].end.toString(16)}`
        : null,
      cycles_total: v,
      per_work_pack: workPacks ? Math.round(v / workPacks) : 0,
      pct_of_work_pack_profile: workPackProfSum ? +((100 * v) / workPackProfSum).toFixed(2) : 0,
      meaning: "code_span_not_whole_procedure",
    }))
    .sort((a, b) => b.cycles_total - a.cycles_total);

  const callRows = Object.entries(callCost)
    .map(([k, v]) => ({
      proc: k,
      entry: `0x${procEntries[k].toString(16)}`,
      cycles_total: v,
      per_work_pack:
        k === "vec_nat_sprites"
          ? null
          : workPacks
            ? Math.round(v / workPacks)
            : 0,
      per_logic_tick:
        k === "vec_nat_sprites" ? (completedLogicTicks ? Math.round(v / completedLogicTicks) : 0) : null,
      meaning:
        "call_ret_inclusive_nested; 0 значит вход чаще через JP, смотри code_span",
    }))
    .sort((a, b) => b.cycles_total - a.cycles_total);

  const labelRows = Object.entries(labelCost)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([k, v]) => ({
      label: k,
      cycles_total: v,
      per_work_pack: workPacks ? Math.round(v / workPacks) : 0,
      pct: workPackProfSum ? +((100 * v) / workPackProfSum).toFixed(2) : 0,
    }));

  const result = {
    build: "2709-1205-M",
    meter: "perf_baseline_1205/fixed",
    rom: path.basename(ROM),
    scene: sceneName,
    scene_kind: sceneKind,
    ticks_requested: tLimit,
    counters: {
      hardware_frames_total: hwFramesTotal,
      hardware_frames_gameplay: hwFramesGameplay,
      completed_logic_ticks: completedLogicTicks,
      gamestatus_frame_hist: gsHist,
      host_state_writes: hostWrites,
      executable_code_patches: 0,
      pins_at_tickMain2: pinsDone,
      pin_while_tip_nonzero: pinUnsafe,
      sync_point:
        "после ld (tickInProgress),0 → вход tickMain2 (завершённый логический тик; tip==0)",
    },
    // совместимость со старыми полями
    logic_ticks: completedLogicTicks,
    hardware_frames: hwFramesTotal,
    interventions,
    ram_note: ramNote,
    beam0: BEAM0,
    frame_cycles: FRAME,
    packs: {
      work: workPacks,
      empty_or_short: emptyPacks,
      duration: durQ,
      start_phase_cyc: startQ,
      start_vs_beam: {
        beam0: BEAM0,
        started_after_beam0: packStarts.filter((v) => v > BEAM0).length,
        started_after_beam0_pct: packStarts.length
          ? +((100 * packStarts.filter((v) => v > BEAM0).length) / packStarts.length).toFixed(2)
          : 0,
        note: "только рабочие пачки (тот же фильтр, что duration/profile)",
      },
      whole_pack_after_hero_beam: packEndsLate,
      path_counts: pathCounts,
      path_hero_draw_samples: pathHeroSamples,
    },
    hero: {
      draw_done_absolute: quantiles(heroDoneAbs),
      draw_done_phase_in_frame: quantiles(heroDonePhase),
      erase_to_redraw_window: quantiles(heroGap),
      hole_byteplanes: {
        n: holeN,
        completed_pack_events: completedHoleEvents,
        independently_verified_pack_pairs: verifiedHolePairs,
        definition: "one erase-to-first-draw event per byteplane; next raster scan after erase, including cross-frame intervals",
        avg: holeN ? Math.round(holeSum / holeN) : 0,
        max: Math.round(holeMax),
        beam_inside: holeHit,
        beam_inside_pct: holeN ? +((100 * holeHit) / holeN).toFixed(2) : 0,
      },
      attribution:
        "конец вывода героя — только записи слотов 4/5 или vop_ow; мумии в том же bbox исключены",
    },
    intermediate_color: {
      definition: "цвет, которого нет ни в начале, ни в конце экранного кадра",
      frames_total: hwFramesTotal,
      frames_gameplay: hwFramesGameplay,
      bad_frames: badFrames,
      bad_pixels: badPix,
      changed_pixels: chgPix,
      hero_ytop_48_63: {
        frames: topFrames,
        bad_frames: topBadFrames,
        bad_pixels: topBadPix,
        changed_pixels: topChgPix,
      },
      pixel_band_Y_48_63: {
        frames_with_writes: z48Frames,
        bad_frames: z48BadFrames,
        bad_pixels: z48BadPix,
        changed_pixels: z48Chg,
      },
    },
    profile: {
      attribution: {
        label: "ближайшая метка снизу, только рабочие пачки, без вложенного ISR",
        code_span: "PC в диапазоне меток; это НЕ время всей процедуры",
        procedure_call_ret: "от входа до возврата, включая вложенные CALL",
        nested_irq:
          "при vec_isr_depth>1 такты не входят в профиль пачки (учтены в nested_skipped_cycles)",
      },
      coverage_pct_labels_vs_work_pack: profileCoveragePct,
      work_pack_profile_cycles: workPackProfSum,
      nested_skipped_cycles: packProfNestedSkip,
      code_spans: spanRows,
      procedures_call_ret: callRows,
      top_labels: labelRows,
      by_slot_role_inside_work_packs: {
        hero_show: { total: cycHeroShow, per_work_pack: workPacks ? Math.round(cycHeroShow / workPacks) : 0 },
        mummy_show: { total: cycMumShow, per_work_pack: workPacks ? Math.round(cycMumShow / workPacks) : 0 },
        hero_erase: { total: cycHeroErase, per_work_pack: workPacks ? Math.round(cycHeroErase / workPacks) : 0 },
        mummy_erase: { total: cycMumErase, per_work_pack: workPacks ? Math.round(cycMumErase / workPacks) : 0 },
      },
    },
    coverage:
      sceneName === "jump2mum"
        ? {
            jumps: covJumps,
            visible_mummy_packs: covVisibleMum,
            overlap_near_stairs: covNearStairs,
            examples: overlapExamples,
            geometry: "output records +0x9c/+0x9d; slots with actual framebuffer writes; common 16x16 intersection",
            overlap_both_during_jump: covOverlapBoth,
          }
        : undefined,
    checkpoints,
    hit_frame_cap: hitFrameCap,
    repro: !!opts.repro,
    negative: !!opts.negative,
  };

  if (profileCoveragePct < 99.0 && workPacks > 0)
    fail(`покрытие профиля меток ${profileCoveragePct}% < 99%`, 2);

  return result;
}

function printSummary(r) {
  const p = r.packs.duration;
  const ic = r.intermediate_color;
  const c = r.counters;
  console.log(
    `\n=== ${r.scene} (${r.scene_kind}) | logic_ticks ${c.completed_logic_ticks}/${r.ticks_requested} | hw_total ${c.hardware_frames_total} hw_gs5 ${c.hardware_frames_gameplay} ===`
  );
  console.log(`sync: ${c.sync_point}; pins=${c.pins_at_tickMain2}; tip≠0 pins=${c.pin_while_tip_nonzero}`);
  console.log(`GS hist: ${JSON.stringify(c.gamestatus_frame_hist)}`);
  console.log(`RAM: ${r.ram_note}`);
  if (r.interventions.length) console.log(`вмешательства: ${r.interventions.join("; ")}`);
  console.log(
    `пачки рабочие ${r.packs.work}; длительность avg ${p.avg} med ${p.median} p90 ${p.p90} max ${p.max}`
  );
  console.log(
    `старт (рабочие) med ${r.packs.start_phase_cyc.median}; пути ${JSON.stringify(r.packs.path_counts)}`
  );
  console.log(
    `герой: abs med ${r.hero.draw_done_absolute.median} phase med ${r.hero.draw_done_phase_in_frame.median} (n=${r.hero.draw_done_phase_in_frame.n}); gap med ${r.hero.erase_to_redraw_window.median}`
  );
  console.log(
    `промежуточный цвет: ${ic.bad_pixels} пикс / ${ic.bad_frames} кадров (из ${ic.frames_gameplay} gs5); Y48..63: ${ic.pixel_band_Y_48_63.bad_pixels}/${ic.pixel_band_Y_48_63.bad_frames}`
  );
  console.log(
    `профиль: покрытие меток ${r.profile.coverage_pct_labels_vs_work_pack}%; nested_skip ${r.profile.nested_skipped_cycles}`
  );
  console.log("code spans (т/раб.пачку):");
  for (const row of r.profile.code_spans.slice(0, 8))
    console.log(`  ${String(row.per_work_pack).padStart(6)}  ${row.pct_of_work_pack_profile}%  ${row.span}`);
  console.log("call/ret procedures:");
  for (const row of r.profile.procedures_call_ret.slice(0, 8)) {
    const v =
      row.per_logic_tick != null
        ? `${row.per_logic_tick}/тик`
        : String(row.per_work_pack ?? 0);
    console.log(`  ${String(v).padStart(10)}  ${row.proc}`);
  }
  if (r.coverage) console.log("coverage:", r.coverage);
}

function writeOutputs(results, outDir) {
  if (!outDir) return;
  fs.mkdirSync(path.join(outDir, "json"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "scripts"), { recursive: true });
  fs.copyFileSync(__filename, path.join(outDir, "scripts", "perf_baseline_1205.js"));
  const allPath = path.join(outDir, "json", "baseline_all.json");
  fs.writeFileSync(
    allPath,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        rom_sha256: "01619ec36abc7d572f03f1fa93322ccc7861843eae845d92d6751b64faf2a4a7",
        meter: "fixed",
        results,
      },
      null,
      2
    )
  );
  for (const r of results) {
    if (!r.packs) continue;
    fs.writeFileSync(path.join(outDir, "json", `scene_${r.scene}.json`), JSON.stringify(r, null, 2));
    const lines = [
      `scene=${r.scene} kind=${r.scene_kind}`,
      `logic_ticks=${r.counters.completed_logic_ticks} hw_total=${r.counters.hardware_frames_total} hw_gs5=${r.counters.hardware_frames_gameplay}`,
      `gs_hist=${JSON.stringify(r.counters.gamestatus_frame_hist)}`,
      `pin_unsafe=${r.counters.pin_while_tip_nonzero}`,
      `packs_work=${r.packs.work} dur_med=${r.packs.duration.median} p90=${r.packs.duration.p90}`,
      `paths=${JSON.stringify(r.packs.path_counts)}`,
      `hero_phase_med=${r.hero.draw_done_phase_in_frame.median} n=${r.hero.draw_done_phase_in_frame.n}`,
      `bad_pix=${r.intermediate_color.bad_pixels} y48=${r.intermediate_color.pixel_band_Y_48_63.bad_pixels}`,
      `profile_coverage=${r.profile.coverage_pct_labels_vs_work_pack}%`,
      "--- code spans ---",
      ...r.profile.code_spans.map((x) => `${x.per_work_pack}\t${x.span}`),
      "--- call/ret ---",
      ...r.profile.procedures_call_ret.map((x) => `${x.per_work_pack}\t${x.proc}`),
    ];
    fs.writeFileSync(path.join(outDir, "logs", `scene_${r.scene}.log`), lines.join("\n") + "\n");
  }
  console.log(`wrote ${allPath}`);
}

function compareRepro(a, b) {
  const diffs = [];
  const keys = [
    ["counters.completed_logic_ticks", a.counters.completed_logic_ticks, b.counters.completed_logic_ticks],
    ["counters.hardware_frames_total", a.counters.hardware_frames_total, b.counters.hardware_frames_total],
    ["counters.hardware_frames_gameplay", a.counters.hardware_frames_gameplay, b.counters.hardware_frames_gameplay],
    ["packs.duration.median", a.packs.duration.median, b.packs.duration.median],
    ["packs.duration.avg", a.packs.duration.avg, b.packs.duration.avg],
    ["packs.work", a.packs.work, b.packs.work],
    ["intermediate_color.bad_pixels", a.intermediate_color.bad_pixels, b.intermediate_color.bad_pixels],
    ["intermediate_color.bad_frames", a.intermediate_color.bad_frames, b.intermediate_color.bad_frames],
    ["hero.draw_done_phase_in_frame.median", a.hero.draw_done_phase_in_frame.median, b.hero.draw_done_phase_in_frame.median],
    ["hero.erase_to_redraw_window.median", a.hero.erase_to_redraw_window.median, b.hero.erase_to_redraw_window.median],
    ["counters.pin_while_tip_nonzero", a.counters.pin_while_tip_nonzero, b.counters.pin_while_tip_nonzero],
  ];
  for (const [n, x, y] of keys) if (x !== y) diffs.push(`${n}: ${x} !== ${y}`);
  if (a.checkpoints.length !== b.checkpoints.length)
    diffs.push(`checkpoints.length: ${a.checkpoints.length} !== ${b.checkpoints.length}`);
  else {
    for (let i = 0; i < a.checkpoints.length; i++) {
      const sa = JSON.stringify(a.checkpoints[i]);
      const sb = JSON.stringify(b.checkpoints[i]);
      if (sa !== sb) diffs.push(`checkpoint[${i}] (${a.checkpoints[i].when}) mismatch`);
    }
  }
  for (const section of ["counters", "packs", "hero", "intermediate_color", "profile", "coverage"])
    if (JSON.stringify(a[section]) !== JSON.stringify(b[section])) diffs.push(`${section}: полный набор метрик различается`);
  return { ok: diffs.length === 0, diffs };
}

// --- main ----------------------------------------------------------------
function mainRepro() {
  const a = runScene("repro", NTICKS || DEFAULT_TICKS.repro, { repro: true, negative: NEGATIVE });
  printSummary(a);
  const b = runScene("repro", NTICKS || DEFAULT_TICKS.repro, { repro: true, negative: false });
  printSummary(b);
  const cmp = compareRepro(a, b);
  const out = {
    scene: "repro_compare",
    negative_control: NEGATIVE,
    match: cmp.ok,
    diffs: cmp.diffs,
    a_summary: {
      ticks: a.counters.completed_logic_ticks,
      hw: a.counters.hardware_frames_total,
      bad: a.intermediate_color.bad_pixels,
      med: a.packs.duration.median,
    },
    b_summary: {
      ticks: b.counters.completed_logic_ticks,
      hw: b.counters.hardware_frames_total,
      bad: b.intermediate_color.bad_pixels,
      med: b.packs.duration.median,
    },
  };
  console.log("\nREPRO:", JSON.stringify(out, null, 2));
  if (OUTDIR) {
    writeOutputs([a, b], OUTDIR);
    fs.writeFileSync(path.join(OUTDIR, "json", "repro_compare.json"), JSON.stringify(out, null, 2));
  }
  if (NEGATIVE) {
    if (cmp.ok) {
      console.error("FAIL: negative-control не поймал расхождение");
      process.exit(1);
    }
    console.log("PASS negative-control: расхождение поймано");
    process.exit(0);
  }
  if (!cmp.ok) {
    console.error("FAIL repro:", cmp.diffs.join("; "));
    process.exit(1);
  }
  console.log("PASS repro");
  process.exit(0);
}

if (REPRO) {
  try {
    mainRepro();
  } catch (e) {
    console.error(e.message || e);
    process.exit(process.exitCode || 2);
  }
} else if (ALL) {
  const results = [];
  try {
    for (const sc of ["natural", "walk", "climb", "jump2mum", "load"]) {
      const r = runScene(sc, NTICKS || DEFAULT_TICKS[sc]);
      printSummary(r);
      results.push(r);
    }
    const r1 = runScene("repro", DEFAULT_TICKS.repro, { repro: true });
    const r2 = runScene("repro", DEFAULT_TICKS.repro, { repro: true });
    printSummary(r1);
    printSummary(r2);
    const cmp = compareRepro(r1, r2);
    results.push(r1, r2, { scene: "repro_compare", match: cmp.ok, diffs: cmp.diffs });
    if (OUTDIR) {
      writeOutputs(results.filter((x) => x.packs), OUTDIR);
      fs.writeFileSync(
        path.join(OUTDIR, "json", "repro_compare.json"),
        JSON.stringify({ match: cmp.ok, diffs: cmp.diffs }, null, 2)
      );
    }
    if (!cmp.ok) {
      console.error("FAIL repro:", cmp.diffs.join("; "));
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    console.error(e.message || e);
    process.exit(process.exitCode || 2);
  }
} else {
  try {
    const ticks = NTICKS || DEFAULT_TICKS[SCENE] || 500;
    const r = runScene(SCENE, ticks, { repro: SCENE === "repro" });
    printSummary(r);
    if (OUTDIR) writeOutputs([r], OUTDIR);
    if (JSONOUT) fs.writeFileSync(JSONOUT, JSON.stringify(r, null, 2));
  } catch (e) {
    console.error(e.message || e);
    process.exit(process.exitCode || 2);
  }
}
