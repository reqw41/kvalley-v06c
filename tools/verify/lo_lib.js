// lo_lib.js — общий стенд задачи logic-opt: прогон сценария по ИГРОВЫМ ТИКАМ, снимок
// игрового состояния после каждого тика логики, профиль логики по адресам.
//
// Почему не Z80-гейт: msx/kvalley_src.asm в этой ветке нет, а игровой файл давно правится
// вручную, поэтому эталон — СБОРКА 23ffb6f против правленой сборки, при ОДНОМ вводе.
// Ввод — функция НОМЕРА ТИКА (не кадра): медленная и быстрая сборки получают одни и те же
// нажатия на одних и тех же тиках. Вводим в vec_kb8 на входе в chkControls (чтение клавиш
// игрой), поэтому от железа сканирования клавиш результат не зависит.
//
// Игровое состояние (снимок): GameStatus..varsEnd без звука (MusicChanData..caidaSndDat+1),
// без scratch эмуляции (dummy_10+0..+19: z80_ix/iy/alt, il_tmp, il_a, il_outstub)
// и без таймера кадров waitCounter; плюс вся MapaRAM. Всё берётся по именам из .sym.
"use strict";
const fs = require("fs");
const { make, toGame } = require("./beam_harness.js");

const KEY = { SPACE: 1, LEFT: 16, UP: 32, DOWN: 64, RIGHT: 128 }; // биты ряда 8 MSX (active-high)

function stateRanges(L) {
  const r = [];
  const add = (a, b) => { if (b > a) r.push([a, b]); };
  // GameStatus .. MusicChanData (не включая), потом после звука до dummy_10, после scratch до varsEnd
  add(L.GameStatus, L.MusicChanData);
  add(L.KeyTrigger2, L.dummy_10);                 // после звука падения (dummy_3/caidaSndDat/dummy)
  add(L.dummy_10 + 20, L.varsEnd);                // за scratch эмуляции (+0..+19)
  add(L.MapaRAM, L.MapaRAM + 2208);
  return r;
}
function nameOfAddr(L, a) {
  let best = null;
  for (const [k, v] of Object.entries(L)) {
    if (v <= a && v >= 0x7605 && (best === null || v > L[best])) { if (!/^(vec_|v[a-z]{2}_|il_|z80_)/.test(k)) best = k; }
  }
  return best ? `${best}+${a - L[best]}` : "0x" + a.toString(16);
}

// scen: { name, boot:'game'|'demo', ticks, keys(t,api)->bitmask, pre(t,api) (на входе в тик), settle }
// opts: { snap:true, profile:false }
function runScenario(rom, sym, scen, opts = {}) {
  const E = make(rom, sym);
  const { L, rd, cpu, memory, v06c } = E;
  const wr = (a, v) => memory.write(a & 0xffff, v & 0xff, false);
  const rd16 = a => rd(a) | (rd(a + 1) << 8);
  const wr16 = (a, v) => { wr(a, v); wr(a + 1, v >> 8); };
  const ranges = stateRanges(L);
  const api = { E, L, rd, wr, rd16, wr16, KEY, tick: 0, gtick: 0, rng: null };

  // --- загрузка до геймплея ---
  let framesTotal = 0;
  const oneInt = v06c.oneInterrupt.bind(v06c);
  v06c.oneInterrupt = function (...a) { framesTotal++; return oneInt(...a); };
  if (scen.boot === "game") {
    const gs = toGame(E);
    if (gs !== 5) throw new Error("нет геймплея, GS=" + gs);
  } else if (scen.boot === "demo") {
    for (let i = 0; i < 6000 && !(rd(L.GameStatus) === 5 && !(rd(L.controlPlayer) & 64)); i++) E.run(1);
    if (!(rd(L.GameStatus) === 5 && !(rd(L.controlPlayer) & 64))) throw new Error("демо не началось");
  } else throw new Error("boot?");

  // --- профиль / снимки ---
  const pcCyc = opts.profile ? new Float64Array(65536) : null;
  const pcCalls = opts.profile ? new Float64Array(65536) : null;
  const ISR = L.vec_isr, NAT = L.vec_nat_sprites, CC = L.chkControls, TM2 = L.tickMain2;
  let inStep = false, stepSp = 0, inIsr = false, isrSp = 0, inNat = false, natSp = 0, natRet = -1;
  let TT = 0, t0 = 0, isrT = 0, natT = 0, isr0 = 0, nat0 = 0, pure = 0, stepFrame0 = 0;
  let startedPrev = false;
  const steps = [], snaps = [];
  let tick = -1, wasGs5 = false, active = true;
  const retOf = () => memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8);
  const cur = { keys: 0 };

  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    const pc = cpu.pc;
    const sp0 = cpu.sp;
    oI();
    const c = cpu.vcycles | 0;
    TT += c;
    if (pcCalls && inStep && wasGs5 && !inIsr && !inNat && ((sp0 - cpu.sp) & 0xffff) === 2) {
      const op = memory.read(pc, false);
      if (op === 0xCD || (op & 0xC7) === 0xC4) pcCalls[pc]++;
    }
    if (inStep) {
      if (!inIsr && !inNat) {
        pure += c;
        if (pcCyc && wasGs5) pcCyc[pc] += c;
      }
    }
  };
  v06c.check_breakpoint = function () {
    const pc = cpu.pc;
    if (inStep) {
      if (!inIsr && pc === ISR) { inIsr = true; isrSp = cpu.sp; isr0 = TT; }
      else if (inIsr && cpu.sp > isrSp) { inIsr = false; isrT += TT - isr0; }
      if (!inNat && !inIsr && pc === NAT) { inNat = true; natSp = cpu.sp; natRet = retOf(); nat0 = TT; }
      else if (inNat && pc === natRet && cpu.sp > natSp) { inNat = false; natT += TT - nat0; }
    }
    if (pc === CC && !inStep && rd(L.tickInProgress) & 1) {
      // начало тика логики (tickMain: inc (hl) уже сделан)
      inStep = true; stepSp = cpu.sp; t0 = TT; isrT = 0; natT = 0; pure = 0; inIsr = false; inNat = false;
      tick++; api.tick = tick; stepFrame0 = framesTotal;
      const gs = rd(L.GameStatus);
      if (gs === 5) {
        if (!wasGs5) { if (scen.normTimer !== false) wr(L.timer, 0); }
        wasGs5 = true;
        if (scen.pre) scen.pre(api.gtick, api);
        cur.keys = scen.keys ? scen.keys(api.gtick, api) : 0;
      } else { wasGs5 = false; cur.keys = 0; }
    }
    if (pc === CC) { wr(L.vec_kb8, (~cur.keys) & 0xff); }
    if (pc === TM2 && inStep && cpu.sp === stepSp + 2) {
      inStep = false;
      const T = TT - t0;
      const gs = rd(L.GameStatus);
      const row = { tick, gs, T, pure, isr: isrT, nat: natT, f0: stepFrame0, f1: framesTotal };
      steps.push(row);
      if (wasGs5 && row.gs !== undefined) {
        // снимок после тика, только если тик исполнялся в геймплее
        if (opts.snap !== false) {
          const parts = [];
          for (const [a, b] of ranges) { const buf = Buffer.alloc(b - a); for (let i = a; i < b; i++) buf[i - a] = rd(i); parts.push(buf); }
          const snap = Buffer.concat(parts);
          // Указатели на таблицу прыжка (valoresSalto) зависят от размера кода — сравниваем
          // их СМЕЩЕНИЕМ от метки таблицы (герой timerPergam2/dummy_11, мумии ACTOR_JMP_P).
          // flagStageClear: единственный читатель — tickGame, который по нему перезапускает МУЗЫКУ,
          // когда та доиграла; сбрасывается во времени кадров, а не тиков — из сравнения исключён.
          { let off = 0; for (const [a, b] of ranges) { if (L.flagStageClear >= a && L.flagStageClear < b) { snap[off + L.flagStageClear - a] = 0; break; } off += b - a; } }
          const ptrs = [L.timerPergam2];
          for (let m = 0; m < 4; m++) ptrs.push(L.momiaDat + m * 22 + 12);
          for (const pa of ptrs) {
            let off = 0, hit = -1;
            for (const [a, b] of ranges) { if (pa >= a && pa + 1 < b) { hit = off + (pa - a); break; } off += b - a; }
            if (hit < 0) continue;
            const v = (snap[hit] | (snap[hit + 1] << 8)) - L.valoresSalto;
            const raw = snap[hit] | (snap[hit + 1] << 8);
            if (v >= -3 && v <= 16) { snap[hit] = v & 255; snap[hit + 1] = 0xAA; }
            else if ((raw & 255) === 0 && (raw >> 8) === (L.valoresSalto >> 8)) { snap[hit] = 0; snap[hit + 1] = 0xAC; }   // обнулённый младший байт указателя   // указатель внутрь таблицы -> смещение
          }
          if (L.DemoKeyData !== undefined) {   // указатель на запись демо — относительно метки данных
            let off = 0, hit = -1; const pa = L.keyPressDemo;
            for (const [a, b] of ranges) { if (pa >= a && pa + 1 < b) { hit = off + (pa - a); break; } off += b - a; }
            if (hit >= 0) { const v = (snap[hit] | (snap[hit + 1] << 8)) - L.DemoKeyData; if (v >= 0 && v < 1024) { snap[hit] = v & 255; snap[hit + 1] = 0xAB; } }
          }
          snaps.push(snap);
        }
        row.g = api.gtick; api.gtick++;
        if (scen.post) scen.post(row.g, api);
      }
    }
    return false;
  };

  // --- прогон ---
  const maxFrames = (scen.ticks + 50) * 8 + 2000;
  let guard = 0;
  while (api.gtick < scen.ticks && guard++ < maxFrames) E.run(1);
  if (api.gtick < scen.ticks) throw new Error("сценарий не добрал тиков: " + api.gtick + "/" + scen.ticks);
  return { steps, snaps, ranges, L, pcCyc, pcCalls, api, framesTotal };
}

function diffSnaps(A, B, ranges, L) {
  const n = Math.min(A.snaps.length, B.snaps.length);
  for (let i = 0; i < n; i++) {
    if (!A.snaps[i].equals(B.snaps[i])) {
      const out = []; let off = 0;
      for (const [a, b] of ranges) {
        for (let k = 0; k < b - a; k++) if (A.snaps[i][off + k] !== B.snaps[i][off + k]) out.push(`${nameOfAddr(L, a + k)}: ${A.snaps[i][off + k]}->${B.snaps[i][off + k]}`);
        off += b - a;
      }
      return { tick: i, diffs: out.slice(0, 12), count: out.length };
    }
  }
  if (A.snaps.length !== B.snaps.length) return { tick: n, diffs: ["длины снимков различаются"], count: 1 };
  return null;
}

module.exports = { KEY, runScenario, diffSnaps, stateRanges, nameOfAddr, make, toGame };
