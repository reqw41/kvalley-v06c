#!/usr/bin/env node
"use strict";
// snd_cost_measure.js — части А и Б: цена звука по участкам для AY и ВИ53 в сценах.
// Запуск: node tools/verify/snd_cost_measure.js [--chips ay,vi] [--scenes stress,natural,...]
// Пишет outputs/sound-cost/partial/<chip>_<scene>.json (сводка; сырьё по кадрам не хранится).
const fs = require("fs"), path = require("path"), vm = require("vm");
const lib = require("./snd_cost_lib.js");
const { CATS, CI, NSND, q } = lib;

const PART = path.join(lib.OUT, "partial");
fs.mkdirSync(PART, { recursive: true });

// ---- сводка трекера ----------------------------------------------------------------------
const SECS = {
  s1_clock: ["clk_entry", "clk_gate", "clk_delta", "clk_lease"],
  s2_driver: ["drv_parse", "drv_env", "drv_fx", "drv_other", "drv_start"],
  s3_overlay: ["ov_shadow", "ov_modechk"],
  s4_output: ["out_ay", "out_route", "out_vich", "out_ay2vi", "out_svc"],
};
const sumCats = (cat, names) => names.reduce((s, n) => s + cat[CI[n]], 0);
const soundTotal = (cat) => { let s = 0; for (let i = 0; i < NSND; i++) s += cat[i]; return s; };

function statBlock(rows, getCat) {
  // rows: массив {cat: Float64Array}
  const out = { n: rows.length, cats: {}, sections: {}, total: null };
  for (const c of CATS.slice(0, NSND)) out.cats[c] = q(rows.map((r) => getCat(r)[CI[c]]));
  for (const [k, names] of Object.entries(SECS)) out.sections[k] = q(rows.map((r) => sumCats(getCat(r), names)));
  out.total = q(rows.map((r) => soundTotal(getCat(r))));
  out.ext_overlay = q(rows.map((r) => getCat(r)[CI.ext_overlay]));
  return out;
}

function summarize(T, label) {
  const frames = T.frames;
  const steps = T.steps.slice(0, -1); // последний шаг не закончен
  const gsFrames = frames.filter((f) => f.gs === 5);
  const gsSteps = steps.filter((s) => s.gs === 5);
  const res = { label, chip: T.chip, n_frames: frames.length, n_steps: steps.length, n_frames_gs5: gsFrames.length, n_steps_gs5: gsSteps.length };
  res.gs_hist_frames = frames.reduce((h, f) => ((h[f.gs] = (h[f.gs] || 0) + 1), h), {});
  res.gs_hist_steps = steps.reduce((h, s) => ((h[s.gs] = (h[s.gs] || 0) + 1), h), {});
  res.frame = statBlock(frames, (f) => f.cat);
  res.frame_gs5 = statBlock(gsFrames, (f) => f.cat);
  res.step = statBlock(steps, (s) => s.cat);
  res.step_gs5 = statBlock(gsSteps, (s) => s.cat);
  // кадров на шаг (интервал в кадрах между стартами шагов)
  const stepFrames = {};
  for (const f of frames) stepFrames[f.step] = (stepFrames[f.step] || 0) + 1;
  res.frames_per_step = q(steps.map((s, i) => stepFrames[i + 1] || 0));
  // глубина ISR: доля звука
  const depTot = [0, 0, 0];
  for (const f of frames) for (let d = 0; d < 3; d++) for (let c = 0; c < NSND; c++) depTot[d] += f.dep[d * CATS.length + c];
  const allSound = depTot[0] + depTot[1] + depTot[2];
  res.depth_share = { main_depth0: depTot[0] / frames.length, outer_isr: depTot[1] / frames.length, nested_isr: depTot[2] / frames.length, total_per_frame: allSound / frames.length };
  res.depth_frame_q = {
    outer: q(frames.map((f) => { let s = 0; for (let c = 0; c < NSND; c++) s += f.dep[1 * CATS.length + c]; return s; })),
    nested: q(frames.map((f) => { let s = 0; for (let c = 0; c < NSND; c++) s += f.dep[2 * CATS.length + c]; return s; })),
    main: q(frames.map((f) => { let s = 0; for (let c = 0; c < NSND; c++) s += f.dep[c]; return s; })),
  };
  // музыкальные тики
  const tk = frames.map((f) => f.ticks);
  res.ticks = {
    per_frame_mean: tk.reduce((a, b) => a + b, 0) / frames.length,
    hist: tk.reduce((h, t) => ((h[t] = (h[t] || 0) + 1), h), {}),
    zero_frac: tk.filter((t) => t === 0).length / frames.length,
    double_frac: tk.filter((t) => t >= 2).length / frames.length,
    by_depth: [0, 1, 2].map((d) => frames.reduce((s, f) => s + f.ticks_by_depth[d], 0)),
    by_entry: frames.reduce((h, f) => { for (const [k, v] of Object.entries(f.tick_entry)) h[k] = (h[k] || 0) + v; return h; }, {}),
    gs5: (() => { const t = gsFrames.map((f) => f.ticks); return { n: t.length, per_frame_mean: t.reduce((a, b) => a + b, 0) / Math.max(1, t.length), zero_frac: t.filter((x) => x === 0).length / Math.max(1, t.length), double_frac: t.filter((x) => x >= 2).length / Math.max(1, t.length) }; })(),
    per_step: q(steps.map((s) => s.ticks)),
  };
  // стоимость тика (кадры с ровно одним тиком): сколько звука в таком кадре, и без тика
  res.cost_by_tickcount = {};
  for (const k of [0, 1, 2]) {
    const sel = frames.filter((f) => (k === 2 ? f.ticks >= 2 : f.ticks === k));
    res.cost_by_tickcount[k] = { n: sel.length, total: q(sel.map((f) => soundTotal(f.cat))) };
  }
  // по фазам игры (GameStatus в начале кадра)
  res.by_gs = {};
  for (const g of Object.keys(res.gs_hist_frames)) {
    const fs_ = frames.filter((f) => String(f.gs) === g);
    const t = fs_.map((f) => f.ticks);
    res.by_gs[g] = { n: fs_.length, sections: Object.fromEntries(Object.entries(SECS).map(([k, names]) => [k, q(fs_.map((f) => sumCats(f.cat, names)))])), total: q(fs_.map((f) => soundTotal(f.cat))), ticks_mean: t.reduce((a, b) => a + b, 0) / fs_.length, zero_frac: t.filter((x) => x === 0).length / fs_.length, double_frac: t.filter((x) => x >= 2).length / fs_.length };
  }
  // по звукам на каналах (кадр попадает в группу каждого звучащего id)
  res.by_sound_id = {};
  const idSet = new Set(); for (const f of frames) for (const i of f.ids) if (i) idSet.add(i);
  for (const id of idSet) {
    const fs_ = frames.filter((f) => f.ids.includes(id));
    res.by_sound_id[id] = { n: fs_.length, total: q(fs_.map((f) => soundTotal(f.cat))), drv: q(fs_.map((f) => sumCats(f.cat, SECS.s2_driver))), out: q(fs_.map((f) => sumCats(f.cat, SECS.s4_output))) };
  }
  // кто исполняет тик: эксклюзивно по глубине (уже в depth_share); драйвер по виду канала
  res.driver_by_kind = { music: 0, sfx: 0, none: 0 };
  for (const f of frames) { res.driver_by_kind.music += f.kind_cyc[0]; res.driver_by_kind.sfx += f.kind_cyc[1]; res.driver_by_kind.none += f.kind_cyc[2]; }
  for (const k of Object.keys(res.driver_by_kind)) res.driver_by_kind[k] /= frames.length;
  // замыкание
  const sumSound = frames.reduce((s, f) => s + soundTotal(f.cat), 0);
  const ctx = frames.reduce((s, f) => s + f.ctx_cyc + f.entry_cyc, 0);
  const helper = frames.reduce((s, f) => s + f.helper_cyc, 0);
  const pcr = frames.reduce((s, f) => s + f.pcrange_cyc, 0);
  const ext = frames.reduce((s, f) => s + f.cat[CI.ext_overlay], 0);
  const frameSum = frames.reduce((s, f) => s + f.total, 0);
  const stepSum = steps.reduce((s, st) => s + soundTotal(st.cat), 0);
  // сумма звука по шагам vs по кадрам на общем окне (кадры внутри полных шагов)
  const innerFrames = frames.filter((f) => f.step >= 1 && f.step <= steps.length);
  const innerSound = innerFrames.reduce((s, f) => s + soundTotal(f.cat), 0);
  res.closure = {
    sections_sum_cycles: sumSound,
    ctx_independent_cycles: ctx,
    sections_vs_ctx_pct: ctx ? (100 * (sumSound - ctx)) / ctx : 0,
    pcrange_cycles: pcr, helper_cycles_in_ctx_outside_ranges: helper, ext_overlay_cycles: ext,
    entry_glue_cycles: frames.reduce((s, f) => s + f.entry_cyc, 0),
    ctx_only_cycles: frames.reduce((s, f) => s + f.ctx_cyc, 0),
    pcrange_check_cycles: pcr - ext + helper,
    pcrange_vs_ctx_pct: frames.reduce((s, f) => s + f.ctx_cyc, 0) ? (100 * ((pcr - ext + helper) - frames.reduce((s, f) => s + f.ctx_cyc, 0))) / frames.reduce((s, f) => s + f.ctx_cyc, 0) : 0,
    frame_cycles_sum: frameSum, frame_expected: frames.length * 59904,
    frame_rel_err_pct: (100 * (frameSum - frames.length * 59904)) / (frames.length * 59904),
    frame_total_min: Math.min(...frames.map((f) => f.total)), frame_total_max: Math.max(...frames.map((f) => f.total)),
    steps_sound_cycles: stepSum, inner_frames_sound_cycles: innerSound,
    steps_vs_frames_pct: innerSound ? (100 * (stepSum - innerSound)) / innerSound : 0,
    orphan_pcs: T.orphan,
  };
  // часть Б — средние на кадр + q
  const bBlock = (frames) => {
    const F = (g) => q(frames.map(g));
    const B = {
    wr_calls: F((f) => f.wr), wr_cyc: F((f) => f.wr_cyc),
    wr_same: F((f) => f.wr_same), wr_same_cyc: F((f) => f.wr_same_cyc),
    wr_ext: F((f) => f.wr_ext), wr_ext_cyc: F((f) => f.wr_ext_cyc),
    wr_by_reg: Array.from({ length: 16 }, (_, r) => frames.reduce((s, f) => s + f.wr_reg[r], 0) / frames.length),
    wr_same_by_reg: Array.from({ length: 16 }, (_, r) => frames.reduce((s, f) => s + f.wr_same_reg[r], 0) / frames.length),
    wr_cyc_by_reg: Array.from({ length: 16 }, (_, r) => frames.reduce((s, f) => s + f.wr_cyc_reg[r], 0) / frames.length),
    wr_same_cyc_by_reg: Array.from({ length: 16 }, (_, r) => frames.reduce((s, f) => s + f.wr_same_cyc_reg[r], 0) / frames.length),
    modechk_cyc: F((f) => f.cat[CI.ov_modechk]),
    env_driver_cyc: F((f) => f.cat[CI.drv_env]),
    ay_ports_per_frame: F((f) => f.ay_ports), vi_ports_per_frame: F((f) => f.vi_ports),
  };
  if (T.chip === 1) {
    Object.assign(B, {
      vich_calls: F((f) => f.vich), vich_cyc: F((f) => f.vich_cyc),
      vich_same: F((f) => f.vich_same), vich_same_cyc: F((f) => f.vich_same_cyc),
      vol_calls: F((f) => f.vol_calls), vol_cyc: F((f) => f.vol_cyc),
      vol_useful: F((f) => f.vol_useful), vol_useful_cyc: F((f) => f.vol_useful_cyc),
      vol_useless: F((f) => f.vol_useless), vol_useless_cyc: F((f) => f.vol_useless_cyc),
      per_calls: F((f) => f.per_calls), per_cyc: F((f) => f.per_cyc),
      mix_calls: F((f) => f.mix_calls), mix_cyc: F((f) => f.mix_cyc),
      noeff: F((f) => f.noeff), noeff_cyc: F((f) => f.noeff_cyc), pair_eff_cyc: F((f) => f.pair_eff_cyc), waste_cyc: F((f) => f.noeff_cyc + f.pair_eff_cyc),
      pair: F((f) => f.pair), pair_cyc: F((f) => f.pair_cyc), pair_vich_cyc: F((f) => f.pair_vich_cyc),
    });
  }
    return B;
  };
  const B = bBlock(frames);
  B.gs5 = bBlock(gsFrames);
  // те же величины на шаг (накопление в момент закрытия вызова, шаг — по tickInProgress)
  const SQ = (k) => q(steps.map((x) => x.b[k]));
  B.step = { wr_same_cyc: SQ("wr_same_cyc"), wr_calls: SQ("wr_calls"), wr_cyc: SQ("wr_cyc"), modechk_cyc: q(steps.map((x) => x.cat[CI.ov_modechk])), env_driver_cyc: q(steps.map((x) => x.cat[CI.drv_env])) };
  if (T.chip === 1) Object.assign(B.step, { vich_same_cyc: SQ("vich_same_cyc"), vol_useless_cyc: SQ("vol_useless_cyc"), noeff_cyc: SQ("noeff_cyc"), pair_eff_cyc: SQ("pair_eff_cyc"), waste_cyc: q(steps.map((x) => x.b.noeff_cyc + x.b.pair_eff_cyc)), pair_cyc: SQ("pair_cyc"), vich_calls: SQ("vich_calls"), pair: SQ("pair") });
  res.partB = B;
  res.sound_starts = T.soundStarts.reduce((h, s) => { const k = s.id & 0x3F; h[k] = (h[k] || 0) + 1; return h; }, {});
  res.sound_starts_raw = T.soundStarts.slice(0, 200).map((s) => ({ frame: s.frame, id: s.id & 0x3F, flags: s.id & 0xC0, depth: s.depth }));
  res.chip_regs = null;
  return res;
}

// ---- сцены перф-драйвера (stress=repro, natural) ---------------------------------------------
function runDriver(chip, scene, ticks, opts = {}) {
  const src = fs.readFileSync(path.join(__dirname, "perf_baseline_1205.js"), "utf8")
    .split("// --- main ----------------------------------------------------------------")[0]
    .replace('const { make, toGame } = require("./beam_harness.js");', "const { make, toGame } = __harness;")
    .replace("  let TT = 0;", "  __trace.arm();\n  let TT = 0;");
  let T = null, E0 = null;
  const wrapped = {
    make() { const E = lib.makeEmu(chip); E0 = E; T = lib.createTracker(E, chip); if (opts.capture) T.capturePorts = true; return E; },
    toGame: lib.harness.toGame,
  };
  const context = { require, __dirname, console, process: { argv: ["node", "snd_cost"], exitCode: 0, exit(c) { throw new Error("exit " + c); } }, Buffer, __harness: wrapped, __trace: { arm() { T.arm(); } } };
  vm.createContext(context);
  vm.runInContext(src + "\nthis.__runScene=runScene;", context, { filename: "perf_baseline_1205.in-memory.js" });
  const driverScene = scene === "stress" ? "repro" : scene;
  context.__runScene(driverScene, ticks, { repro: driverScene === "repro" });
  T.disarm();
  return { T, E: E0 };
}

// ---- собственные сцены -----------------------------------------------------------------------
const scenesCustom = require("./snd_cost_scenes.js");

function main() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const chips = get("--chips", "ay,vi").split(",");
  const scenes = get("--scenes", "stress,natural").split(",");
  for (const cn of chips) {
    const chip = cn === "ay" ? 0 : 1;
    for (const sc of scenes) {
      const t0 = Date.now();
      let T, E;
      if (sc === "stress") ({ T, E } = runDriver(chip, "stress", 120));
      else if (sc === "natural") ({ T, E } = runDriver(chip, "natural", 2600));
      else if (scenesCustom[sc]) ({ T, E } = scenesCustom[sc](chip));
      else throw new Error("неизвестная сцена " + sc);
      const res = summarize(T, `${cn}/${sc}`);
      res.chip_check = E.L.vec_snd_chip === undefined ? { vec_snd_mode: E.rd(E.L.vec_snd_mode) } : { vec_snd_chip: E.rd(E.L.vec_snd_chip), vec_snd_mode: E.rd(E.L.vec_snd_mode), wrtpsg_bytes: [0, 1, 2, 3, 4, 5].map((i) => E.rd(E.L.WRTPSG + i)) };
      res.wall_seconds = (Date.now() - t0) / 1000;
      fs.writeFileSync(path.join(PART, `${cn}_${sc}.json`), JSON.stringify(res));
      console.log(`${cn}/${sc}: frames=${res.n_frames} steps=${res.n_steps} sound/frame mean=${res.frame.total.mean.toFixed(0)} p90=${res.frame.total.p90} ticks/frame=${res.ticks.per_frame_mean.toFixed(3)} closure=${res.closure.sections_vs_ctx_pct.toFixed(4)}% chip=${res.chip_check.vec_snd_chip} (${res.wall_seconds}s)`);
    }
  }
}
if (require.main === module) main();
module.exports = { summarize, runDriver };
