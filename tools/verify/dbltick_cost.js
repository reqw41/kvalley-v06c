#!/usr/bin/env node
// Цена логики на шаг (первый/второй исходный тик отдельно), интервалы стартов, аппаратные кадры,
// скорости ходьбы/лестницы/прыжка. Сцены и вводы — из perf_baseline_1205.js (те же, что в
// sched_nested_speed.js / sched_nested_measure.js), крючок цены вставлен по образцу sched_nested_speed.js.
// Использование: node dbltick_cost.js <режим=имя:rom:sym> ... [--scenes repro,natural,walk,climb,jump2mum] [--out файл.json]
// Определения (все такты — инструкции на внешнем уровне ISR, вложенные ISR не входят):
//   step_total  — от записи tickInProgress=1 до tickInProgress=0 (chkControls + все runGame + vec_dt_*);
//   tick[i]     — от входа в runGame до возврата из него, i-й вызов в шаге (включает подготовку спрайтов);
//   prep        — внутри runGame: от входа в vec_nat_sprites до возврата;
//   interval    — от старта шага до старта следующего, такты по часам кадра (frames*59904+фаза).
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), { createRequire } = require("module");
const H = require("./beam_harness");
const FR = 59904;
const args = process.argv.slice(2);
const modes = [];
let scenes = ["repro", "natural", "walk", "jump2mum"], OUT = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--scenes") scenes = args[++i].split(",");
  else if (args[i] === "--out") OUT = args[++i];
  else { const [n, r, s] = args[i].split(":"); modes.push({ name: n, rom: r, sym: s }); }
}
const TICKS = { repro: 120, natural: 2600, walk: 500, climb: 1800, jump2mum: 240 };
const q = a => { const b = a.slice().sort((x, y) => x - y), n = b.length; return { n, mean: n ? b.reduce((s, x) => s + x, 0) / n : null, median: n ? b[Math.floor(n * .5)] : null, p90: n ? b[Math.min(n - 1, Math.floor(n * .9))] : null, min: n ? b[0] : null, max: n ? b[n - 1] : null }; };
const file = path.join(__dirname, "perf_baseline_1205.js");
const program = fs.readFileSync(file, "utf8").split("// --- main ----------------------------------------------------------------")[0]
  .replace('const { make, toGame } = require("./beam_harness.js");', "const { make, toGame } = __harness;")
  .replace("  let TT = 0;", "  __arm(E);\n  let TT = 0;")
  // Проверка покрытия профиля пачек на глубине 1 неприменима к длинным шагам: все рабочие пачки
  // идут во вложенных ISR (глубина 2), профиль внешних пачек пуст. Профиль здесь не используется.
  .replace("if (profileCoveragePct < 99.0 && workPacks > 0)", "if (false)");
const out = { method: "see header", modes: {} };
for (const mode of modes) {
  out.modes[mode.name] = {};
  for (const scene of scenes) {
    const n = TICKS[scene];
    console.log("run", mode.name, scene, n);
    let E, armed = false, frames = 0;
    const rows = [];           // шаги
    let step = null;
    const harness = {
      toGame: H.toGame,
      make() {
        E = H.make(mode.rom, mode.sym);
        const { L, rd, cpu, v06c } = E;
        const orig = v06c.oneInterrupt.bind(v06c);
        v06c.oneInterrupt = (...a) => { const z = orig(...a); if (armed) frames++; return z; };
        const now = () => frames * FR + E.cyc();
        const snap = () => ({ x: rd(L.ProtaRoom) * 256 + rd(L.ProtaX), frac: rd(L.ProtaXdecimal), y: rd(L.ProtaY), st: rd(L.protaStatus), gs: rd(L.GameStatus), keys: rd(L.KeyHold), room: rd(L.ProtaRoom), mom: Array.from({ length: 88 }, (_, i) => rd(L.momiaDat + i)).join(","), sc: [L.score_0000xx, L.score_0000xx + 1, L.score_xx0000, L.score_xx0000 + 1, L.Vidas, L.gemasCogidas].map(rd).join(",") });
        const TIP = L.tickInProgress, RG = L.runGame, NS = L.vec_nat_sprites;
        const nested = [];   // стек вложенных ISR (RST7 по адресу 0x38): их такты в цену логики не входят
        let rg = null, pp = null;
        const retAt = sp => rd(sp) | (rd((sp + 1) & 65535) << 8);
        const instr = cpu.instruction.bind(cpu);
        cpu.instruction = function () {
          if (!armed) return instr();
          const pc = cpu.pc, tip0 = rd(TIP);
          if (pc === 0x38 && tip0 === 1 && step && !step.done) nested.push({ ret: retAt(cpu.sp), sp: (cpu.sp + 2) & 65535 });
          const counted = tip0 === 1 && step && !step.done && nested.length === 0;
          if (counted) {
            if (pc === RG) rg = { sp: cpu.sp, ret: retAt(cpu.sp), c: 0 };
            if (pc === NS && rg) pp = { sp: cpu.sp, ret: retAt(cpu.sp) };
          }
          instr();
          const c = cpu.vcycles | 0, tip1 = rd(TIP);
          if (tip0 === 0 && tip1 === 1) {       // старт шага: tickMain сделал inc (tickInProgress)
            if (step && step.done) { step.interval = now() - step.t0; rows.push(step); }
            step = { t0: now() - c, gs: rd(L.GameStatus), before: snap(), total: c, ticks: [], prep: 0, done: false };
            rg = null; pp = null; nested.length = 0;
            return;
          }
          if (counted) {
            step.total += c;
            if (rg) rg.c += c;
            if (pp) step.prep += c;
            if (rg && cpu.sp === ((rg.sp + 2) & 65535) && cpu.pc === rg.ret) { step.ticks.push(rg.c); rg = null; pp = null; }
            else if (pp && cpu.sp === ((pp.sp + 2) & 65535) && cpu.pc === pp.ret) pp = null;
          }
          if (nested.length) { const t = nested[nested.length - 1]; if (cpu.pc === t.ret && cpu.sp === t.sp) nested.pop(); }
          if (tip0 === 1 && tip1 === 0 && step && !step.done) { step.after = snap(); step.done = true; step.t1 = now(); }
        };
        return E;
      },
    };
    // Старт шага обнаруживается на следующей инструкции после записи tip=1; погрешность одна инструкция (<=24 такта).
    const ctx = { require: createRequire(file), __dirname, console, process: { argv: ["node", "dbltick_cost"], exitCode: 0 }, Buffer, __harness: harness, __arm() { armed = true; frames = 0; } };
    vm.createContext(ctx);
    vm.runInContext(program + "\nthis.__run=runScene;", ctx, { filename: "dbltick-driver.js" });
    const sr = ctx.__run(scene, n, { repro: scene === "repro" });
    if (step && step.done && !rows.includes(step)) { step.interval = 0; }
    const all = rows.filter(r => r.done);
    const gp = all.filter(r => r.gs === 5);
    const res = { scene, steps_total: all.length, steps_gs5: gp.length, counters: sr.counters, hw_frames_total: frames };
    res.step_total = q(gp.map(r => r.total));
    res.tick_count_hist = gp.reduce((h, r) => (h[r.ticks.length] = (h[r.ticks.length] || 0) + 1, h), {});
    res.tick1 = q(gp.filter(r => r.ticks.length >= 1).map(r => r.ticks[0]));
    res.tick2 = q(gp.filter(r => r.ticks.length >= 2).map(r => r.ticks[1]));
    res.prep = q(gp.map(r => r.prep));
    res.step_total_double = q(gp.filter(r => r.ticks.length >= 2).map(r => r.total));
    res.step_total_single = q(gp.filter(r => r.ticks.length === 1).map(r => r.total));
    // интервалы в кадрах (округление вниз по границам кадров) и по тактам
    const ints = gp.filter(r => r.interval > 0 && r.interval < 8 * FR);
    res.interval_cycles = q(ints.map(r => r.interval));
    res.interval_frames_hist = ints.reduce((h, r) => { const k = Math.round(r.interval / FR); h[k] = (h[k] || 0) + 1; return h; }, {});
    res.hw_frames_gs5 = sr.counters && sr.counters.hardware_frames_gameplay;
    res.intermediate_color = sr.intermediate_color ? { bad_pixels: sr.intermediate_color.bad_pixels, bad_frames: sr.intermediate_color.bad_frames, frames_gameplay: sr.intermediate_color.frames_gameplay, band_Y48_63: sr.intermediate_color.pixel_band_Y_48_63 } : null;
    res.packs = sr.packs ? { work: sr.packs.work, empty_or_short: sr.packs.empty_or_short, duration: sr.packs.duration, start_phase_cyc: sr.packs.start_phase_cyc } : null;
    res.perf_keys = Object.keys(sr);
    // скорости
    const kind = { walk: "walk", climb: "ladder", natural: "ladder", jump2mum: "jump" }[scene];   // лестница: сцена climb не покрывает состояние 3 (ни на одной сборке), берём 'natural' 
    if (kind) {
      const good = rows.filter(r => r.done && r.before.gs === 5 && r.after.gs === 5 && r.interval > 0 && r.interval < 8 * FR).filter(r => {
        const dx = r.after.x - r.before.x, dy = r.after.y - r.before.y;
        if (kind === "walk") return r.before.st === 0 && r.after.st === 0 && Math.abs(dx) <= 3 && (r.before.keys & 12) && (dx !== 0 || r.before.frac !== r.after.frac);
        if (kind === "ladder") return r.before.st === 3 && r.after.st === 3 && Math.abs(dy) <= 2;
        return r.before.st === 1 && r.after.st === 1 && Math.abs(dx) <= 3 && (r.before.keys & 12);
      });
      const px = good.reduce((s, r) => s + Math.abs(kind === "ladder" ? r.after.y - r.before.y : r.after.x - r.before.x), 0);
      const cy = good.reduce((s, r) => s + r.interval, 0);
      res.speed = { kind, samples: good.length, pixels: px, cycles: cy, px_per_s: cy ? px * FR * 50 / cy : null, coverage: good.length > 0 && px > 0, step_total: q(good.map(r => r.total)), step_total_all: good.map(r => r.total) };
    }
    // сырьё для проверки: первые 5 шагов
    res.sample_steps = gp.slice(0, 3);
    res.series = rows.filter(r => r.done).map(r => ({ gs: r.gs, tot: r.total, b: r.before, a: r.after }));
    out.modes[mode.name][scene] = res;
    console.log("  steps", all.length, "gs5", gp.length, "step_total", JSON.stringify(res.step_total), "ticks", JSON.stringify(res.tick_count_hist), res.speed ? ("speed " + res.speed.px_per_s) : "");
  }
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
