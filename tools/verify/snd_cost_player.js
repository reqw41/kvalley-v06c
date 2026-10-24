#!/usr/bin/env node
"use strict";
// snd_cost_player.js — часть В: оценка цены проигрывателя готовых событий (БЕЗ реализации в игре).
// 1) такты команд i8080 на Векторе снимаются на эмуляторе (каждая команда исполняется отдельно);
// 2) процедура проигрывателя задана списком команд; цена = сумма измеренных тактов;
// 3) цена считается для: кадра без событий, кадра с одним событием, худшего кадра (по потокам
//    isolated-звуков и по обычному прогону), и по всем кадрам/шагам обычного прогона.
// Читает outputs/sound-cost/partial/stream.json и ..._natural.json; пишет partial/player.json.
const fs = require("fs"), path = require("path");
const lib = require("./snd_cost_lib.js");
const { q } = lib;

// ---- измерение команд ---------------------------------------------------------------------
// ключ: [байты, префикс (список байтов, исполняется перед измеряемой командой для установки флагов)]
const Z1 = [0xAF];                 // xra a        -> Z=1, S=0, C=0
const Z0 = [0x3E, 1, 0xB7];        // mvi a,1; ora a -> Z=0, S=0
const S1 = [0x3E, 0x80, 0xB7];     // mvi a,80h; ora a -> S=1, Z=0
const OPS = {
  "lxi h": [[0x21, 0x00, 0xD0]], "lxi d": [[0x11, 0, 0xD0]], "lxi b": [[0x01, 0, 0xD0]],
  "lhld": [[0x2A, 0x00, 0xD0]], "shld": [[0x22, 0x00, 0xD0]], "lda": [[0x3A, 0x00, 0xD0]], "sta": [[0x32, 0x00, 0xD0]],
  "dcr m": [[0x35]], "inr m": [[0x34]], "mov a,m": [[0x7E]], "mov m,a": [[0x77]], "mov r,r": [[0x78]],
  "mov l,a": [[0x6F]], "mov h,m": [[0x66]], "mvi a": [[0x3E, 0x12]], "mvi h": [[0x26, 0xD0]], "mvi m": [[0x36, 1]],
  "inx h": [[0x23]], "inx d": [[0x13]], "dcx h": [[0x2B]],
  "ora a": [[0xB7]], "ani": [[0xE6, 0x0F]], "cpi": [[0xFE, 2]], "add a": [[0x87]], "adi": [[0xC6, 1]], "xra a": [[0xAF]],
  "dcr a": [[0x3D]], "inr a": [[0x3C]],
  "out": [[0xD3, 0x15]], "in": [[0xDB, 0x15]],
  "ldax d": [[0x1A]], "stax d": [[0x12]], "xchg": [[0xEB]], "pchl": [[0xE9]],
  "push b": [[0xC5]], "pop b": [[0xC1]], "push d": [[0xD5]], "pop d": [[0xD1]],
  "jmp": [[0xC3, 0x00, 0xE0]],
  "jm taken": [[0xFA, 0x00, 0xE0], S1], "jm not taken": [[0xFA, 0x00, 0xE0], Z1],
  "jz taken": [[0xCA, 0x00, 0xE0], Z1], "jz not taken": [[0xCA, 0x00, 0xE0], Z0],
  "jnz taken": [[0xC2, 0x00, 0xE0], Z0], "jnz not taken": [[0xC2, 0x00, 0xE0], Z1],
  "rnz taken": [[0xC0], Z0], "rnz not taken": [[0xC0], Z1],
  "rz taken": [[0xC8], Z1], "rz not taken": [[0xC8], Z0],
  "call": [[0xCD, 0x00, 0xE0]], "ret": [[0xC9]],
};
function measureOps() {
  const E = lib.makeEmu(0);
  const { cpu, memory } = E;
  const out = {};
  for (const [name, [bytes, prefix]] of Object.entries(OPS)) {
    const base = 0xE100;
    const code = [...(prefix || []), ...bytes];
    code.forEach((b, i) => memory.write(base + i, b, false));
    cpu.pc = base; cpu.sp = 0xD800; cpu.iff = false;
    cpu.regs[7] = 0; cpu.regs[4] = 0xD0; cpu.regs[5] = 0; cpu.regs[2] = 0xD0; cpu.regs[3] = 0;
    if (prefix) { let pc = cpu.pc; const n = prefix === Z1 ? 1 : 2; for (let i = 0; i < n; i++) cpu.instruction(); }
    const pc0 = cpu.pc;
    cpu.instruction();
    out[name] = { cycles: cpu.vcycles | 0, bytes: bytes.length, pc_after_delta: cpu.pc - pc0 };
  }
  return out;
}

// ---- проигрыватель (списки команд) -----------------------------------------------------------
const AY = {
  idle: ["lxi h", "dcr m", "rnz taken"],
  pro: ["lxi h", "dcr m", "rnz not taken", "lhld"],
  ev: ["mov a,m", "inx h", "ora a", "jm taken", "ani", "out", "mov a,m", "inx h", "out", "jmp"],
  epi: ["mov a,m", "inx h", "ora a", "jm not taken", "sta", "shld", "ret"],
  gate: ["lda", "cpi", "jz not taken"],
  code: `tick:  lxi h,wait / dcr m / rnz            ; кадр без событий
       lhld ptr
loop:  mov a,m / inx h / ora a / jm ev      ; токен
       sta wait / shld ptr / ret            ; токен 1..127 = пауза
ev:    ani 0Fh / out 15h / mov a,m / inx h / out 14h / jmp loop   ; reg, значение`,
};
const VI = {
  idle: AY.idle,
  pro: ["lxi h", "dcr m", "rnz not taken", "lhld", "xchg"],
  disp: ["ldax d", "inx d", "ora a", "jm taken", "ani", "add a", "mov l,a", "mvi h", "mov a,m", "inx h", "mov h,m", "mov l,a", "pchl"],
  h: {
    off: ["mvi a", "out", "jmp"],
    clk: ["mvi a", "out", "mvi a", "out", "mvi a", "out", "jmp"],
    div: ["ldax d", "inx d", "out", "ldax d", "inx d", "out", "jmp"],
    start: ["mvi a", "out", "ldax d", "inx d", "out", "ldax d", "inx d", "out", "jmp"],
  },
  epi: ["ldax d", "inx d", "ora a", "jm not taken", "sta", "xchg", "shld", "ret"],
  gate: AY.gate,
  code: `tick:  lxi h,wait / dcr m / rnz            ; кадр без событий
       lhld ptr / xchg                       ; DE = указатель потока
loop:  ldax d / inx d / ora a / jm ev
       sta wait / xchg / shld ptr / ret
ev:    ani 0Fh / add a / mov l,a / mvi h,>tbl / mov a,m / inx h / mov h,m / mov l,a / pchl
hOff:  mvi a,ctrl / out 08h / jmp loop
hDiv:  ldax d / inx d / out port / ldax d / inx d / out port / jmp loop
hStart:mvi a,ctrl / out 08h / <hDiv>
hClk:  mvi a,0B4h / out 08h / mvi a,60h / out 09h / mvi a,0EAh / out 09h / jmp loop`,
};
const VKN = ["off", "clk", "div", "start"];

function sum(list, T) { return list.reduce((s, k) => { if (!T[k]) throw new Error("нет команды " + k); return s + T[k].cycles; }, 0); }

function main() {
  const T = measureOps();
  const stream = JSON.parse(fs.readFileSync(path.join(lib.OUT, "partial/stream.json")));
  const res = { instr: T, ay: {}, vi: {} };
  const c = (l) => sum(l, T);
  // ---- AY ----
  const ayEv = c(AY.ev);
  const ayFrame = (k) => (k === 0 ? c(AY.idle) : c(AY.pro) + k * ayEv + c(AY.epi));
  const ayGate = c(AY.gate);
  res.ay = {
    code: AY.code, listing: { idle: AY.idle, prologue: AY.pro, event: AY.ev, epilogue: AY.epi, mode_gate: AY.gate },
    idle_frame: ayFrame(0), event_cost: ayEv, prologue: c(AY.pro), epilogue: c(AY.epi), mode_gate: ayGate,
    one_event_frame: ayFrame(1), one_event_frame_gate: ayFrame(1) + ayGate,
  };
  // ---- ВИ53 ----
  const viDisp = c(VI.disp);
  const viH = Object.fromEntries(Object.entries(VI.h).map(([k, l]) => [k, c(l)]));
  const viEv = (kind) => viDisp + viH[VKN[kind]];
  const viFrame = (kinds) => {
    const n = kinds.reduce((a, b) => a + b, 0);
    if (!n) return c(VI.idle);
    return c(VI.pro) + kinds.reduce((s, k, i) => s + k * viEv(i), 0) + c(VI.epi);
  };
  res.vi = {
    code: VI.code, listing: { idle: VI.idle, prologue: VI.pro, dispatch: VI.disp, handlers: VI.h, epilogue: VI.epi, mode_gate: VI.gate },
    idle_frame: viFrame([0, 0, 0, 0]), dispatch: viDisp, handler: viH, event_cost: { off: viEv(0), clk: viEv(1), div: viEv(2), start: viEv(3) },
    prologue: c(VI.pro), epilogue: c(VI.epi), mode_gate: c(VI.gate),
    one_event_frame_div: viFrame([0, 0, 1, 0]), one_event_frame_start: viFrame([0, 0, 0, 1]), one_event_frame_off: viFrame([1, 0, 0, 0]),
  };
  // ---- по isolated-звукам: худший кадр каждого потока и в целом ----
  res.sounds = { ay: {}, vi: {} };
  const S = stream.sounds;
  for (const id of Object.keys(S.ay)) {
    const a = S.ay[id], v = S.vi[id];
    const aF = a.per_frame_events.map(ayFrame), vF = v.per_frame_kinds.map(viFrame);
    const rec = (x, F) => ({ name: x.name, frames: x.frames, events: x.events, player_cost: q(F), player_total: F.reduce((p, r) => p + r, 0), worst_frame: Math.max(...F), driver_cost: x.driver_tick_cycles, driver_total: x.driver_cycles_total });
    res.sounds.ay[id] = rec(a, aF); res.sounds.vi[id] = rec(v, vF);
  }
  const worstAll = (cn) => Math.max(...Object.values(res.sounds[cn]).map((r) => r.worst_frame));
  res.ay.worst_isolated_frame = worstAll("ay"); res.vi.worst_isolated_frame = worstAll("vi");
  // ---- обычный прогон: цена по кадрам и шагам ----
  res.natural = {};
  res.ay.worst_natural_frame = 0; res.vi.worst_natural_frame = 0;
  const meas = {};
  for (const cn of ["ay", "vi"]) meas[cn] = JSON.parse(fs.readFileSync(path.join(lib.OUT, `partial/${cn}_natural.json`)));
  for (const cn of ["ay", "vi"]) {
    const N = stream.natural[cn];
    const nF = N.frames;
    const costs = [];
    for (let i = 0; i < nF; i++) {
      const t = N.ticks[i];
      if (!t) { costs.push(0); continue; }
      let ev;
      if (cn === "ay") ev = ayFrame(N.cnt[i]);
      else ev = viFrame(N.kinds[i]);
      const idle = cn === "ay" ? ayFrame(0) : viFrame([0, 0, 0, 0]);
      const hasEv = (cn === "ay" ? N.cnt[i] : N.kinds[i].reduce((a, b) => a + b, 0)) > 0;
      costs.push((t - 1) * idle + (hasEv ? ev : idle));
    }
    // по шагам: step[i] = номер шага (1-based), как у трекера
    const maxStep = Math.max(...N.step);
    const stepCost = new Array(maxStep + 2).fill(0);
    for (let i = 0; i < nF; i++) stepCost[N.step[i]] += costs[i];
    res[cn].worst_natural_frame = Math.max(...costs);
    const stepsQ = q(stepCost.slice(1, maxStep)); // последний шаг не закончен
    const gs5 = costs.filter((_, i) => N.gs[i] === 5);
    res.natural[cn] = {
      frames: nF, frame_cost: q(costs), frame_cost_gs5: q(gs5), step_cost: stepsQ,
      total_cycles: costs.reduce((a, b) => a + b, 0),
      mean_events: N.per_frame.mean,
      current_s234_frame_mean: ["s2_driver", "s3_overlay", "s4_output"].reduce((s, k) => s + meas[cn].frame.sections[k].mean, 0),
      current_s234_step_mean: ["s2_driver", "s3_overlay", "s4_output"].reduce((s, k) => s + meas[cn].step.sections[k].mean, 0),
      current_s1_frame_mean: meas[cn].frame.sections.s1_clock.mean,
      current_total_frame_mean: meas[cn].frame.total.mean, current_total_step_mean: meas[cn].step.total.mean,
    };
  }
  fs.writeFileSync(path.join(lib.OUT, "partial/player.json"), JSON.stringify(res));
  console.log("AY: idle", res.ay.idle_frame, "1 событие", res.ay.one_event_frame, "событие", ayEv);
  console.log("VI: idle", res.vi.idle_frame, "div", res.vi.one_event_frame_div, "start", res.vi.one_event_frame_start, "off", res.vi.one_event_frame_off);
  for (const cn of ["ay", "vi"]) console.log(cn, "natural frame", JSON.stringify(res.natural[cn].frame_cost), "step", JSON.stringify(res.natural[cn].step_cost), "now", res.natural[cn].current_s234_frame_mean.toFixed(0));
}
if (require.main === module) main();
module.exports = { measureOps, AY, VI };
