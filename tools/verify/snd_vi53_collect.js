#!/usr/bin/env node
"use strict";
// snd_vi53_collect.js — приёмка задачи snd-vi53: прогоняет все проверки на ОСНОВЕ и НОВОЙ сборке и собирает results.json.
//   node tools/verify/snd_vi53_collect.js <outdir> [--steps iso,scenes,cost,mem,gates] [--random N]
// Вход: <outdir>/base/{kvalley_8c.rom,.sym,.lst, snd_ov_*.{bin,sym}} и <outdir>/new/{kvalley_8c.rom,.sym,.lst}
// Выход: <outdir>/results.json (+ сырьё в <outdir>/parts, rec, cost_base, cost_new, gates_*.txt).
// REPORT.md делает snd_vi53_report.js из results.json.
const fs = require("fs"), path = require("path"), cp = require("child_process"), crypto = require("crypto");
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "outputs/snd-vi53"));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const steps = (arg("--steps", "iso,scenes,cost,mem,gates")).split(",");
const NR = arg("--random", "1000");
const B = { rom: path.join(OUT, "base/kvalley_8c.rom"), sym: path.join(OUT, "base/kvalley_8c.sym"), lst: path.join(OUT, "base/kvalley_8c.lst") };
const N = { rom: path.join(OUT, "new/kvalley_8c.rom"), sym: path.join(OUT, "new/kvalley_8c.sym"), lst: path.join(OUT, "new/kvalley_8c.lst") };
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const RES = path.join(OUT, "results.json");
const res = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES, "utf8")) : {};
const save = () => fs.writeFileSync(RES, JSON.stringify(res, null, 1));
const run = (cmd, args, opts = {}) => {
  const r = cp.spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, ...opts });
  return r;
};
fs.mkdirSync(path.join(OUT, "parts"), { recursive: true });

res.meta = { base_commit: "e2b8f32", base_rom_sha256: sha(B.rom), new_rom_sha256: sha(N.rom), base_rom_bytes: fs.statSync(B.rom).size, new_rom_bytes: fs.statSync(N.rom).size, date: new Date().toISOString().slice(0, 10) };

// 1) дифференциальный стенд: каждый звук отдельно + случайные сценарии
if (steps.includes("iso")) {
  const r = run(process.execPath, ["tools/verify/snd_vi53_iso.js", B.rom, B.sym, N.rom, N.sym, "--random", NR, "--json", path.join(OUT, "parts/iso.json")]);
  fs.writeFileSync(path.join(OUT, "parts/iso.log"), r.stdout + r.stderr);
  const iso = JSON.parse(fs.readFileSync(path.join(OUT, "parts/iso.json"), "utf8"));
  const single = {};
  for (const [k, v] of Object.entries(iso.single)) single[k] = { ticks: v.ticks, diffs: v.diffs.length + (v.diffs.overflow || 0), first: v.diffs.slice(0, 3) };
  res.iso = { single, single_ticks: iso.single_ticks, random: { scenarios: iso.random.scenarios, ticks: iso.random.ticks, diffs: iso.random.diffs.length + iso.random.overflow, first: iso.random.diffs.slice(0, 5) } };
  save();
}

// 2) сцены в игре: запись + сравнение + повтор операций
if (steps.includes("scenes")) {
  const recdir = path.join(OUT, "rec");
  const r = run("sh", ["tools/verify/snd_vi53_scenes.sh", B.rom, B.sym, N.rom, N.sym, recdir]);
  fs.writeFileSync(path.join(OUT, "parts/scenes.log"), r.stdout + r.stderr);
  const { compare } = require("./snd_vi53_cmp.js");
  res.scenes = {};
  for (const sc of ["natural", "demo", "knife", "gem", "scroll", "death", "keys_s_p"]) {
    const a = JSON.parse(fs.readFileSync(path.join(recdir, `base_${sc}.json`), "utf8")), b = JSON.parse(fs.readFileSync(path.join(recdir, `new_${sc}.json`), "utf8"));
    const rp = JSON.parse(fs.readFileSync(path.join(recdir, `replay_${sc}.json`), "utf8"));
    const c = compare(a, b);
    const argset = (R) => [...new Set(R.ops.filter((o) => o[0] === "S").map((o) => o[1]))].sort((x, y) => x - y);
    res.scenes[sc] = {
      frames_base: a.framesAbs, frames_new: b.framesAbs, sound_ticks_base: a.ticks.length, sound_ticks_new: b.ticks.length,
      logic_ticks: Math.min(a.logic.length, b.logic.length), logic_state_diffs: c.logic.diff, logic_first_diff: c.logic.first,
      starts_base: a.starts.length, starts_new: b.starts.length, starts_same_sequence: c.starts.same_sequence,
      sched_miss: b.schedMiss, args_new: argset(b),
      replay: { A: rp.A.mismatched, B: rp.B.mismatched, C: rp.C.mismatched, D: rp.D.mismatched, ticks_new: rp.B.ticks_ref, ticks_base: rp.A.ticks_ref, first: ["A", "B", "C", "D"].flatMap((k) => rp[k].diffs.slice(0, 2).map((d) => ({ k, ...d }))) },
      epoch_compare: c.epochs,
    };
  }
  // без подгонки расписания: где и почему расходится логика игры
  const ur = run(process.execPath, ["tools/verify/snd_vi53_rec.js", N.rom, N.sym, "new", "natural", path.join(recdir, "new_natural_unpaced.json")]);
  const un = JSON.parse(fs.readFileSync(path.join(recdir, "new_natural_unpaced.json"), "utf8"));
  const ba = JSON.parse(fs.readFileSync(path.join(recdir, "base_natural.json"), "utf8"));
  const uc = compare(ba, un);
  let fields = [];
  if (uc.logic.first >= 0) { const x = ba.logic[uc.logic.first].split(","), y = un.logic[uc.logic.first].split(","); fields = x.map((v, i) => [i, v, y[i]]).filter((t) => t[1] !== t[2]).slice(0, 4); }
  res.unpaced = { frames_base: ba.framesAbs, frames_new: un.framesAbs, logic_diffs: uc.logic.diff, logic_ticks: uc.logic.n, first_diff: uc.logic.first, first_fields: fields, frames_per_logic_base: ba.framesAbs / ba.logic.length, frames_per_logic_new: un.framesAbs / un.logic.length };
  save();
}

// 3) цена звука
if (steps.includes("cost")) {
  const scenes = "stress,natural,effects_knife,effects_gem,effects_death,scroll,idle_m0,idle_m2";
  for (const [tag, P] of [["base", B], ["new", N]]) {
    const dir = path.join(OUT, `cost_${tag}`);
    if (tag === "base" && fs.existsSync(path.join(dir, "partial/vi_idle_m2.json")) && !process.argv.includes("--recost-base")) continue;
    const env = { ...process.env, SND_COST_ROMDIR: path.join(OUT, tag), SND_COST_OUT: dir, SND_COST_ROM: P.rom, SND_COST_SYM: P.sym };
    const r = run(process.execPath, ["tools/verify/snd_cost_measure.js", "--chips", "vi", "--scenes", scenes], { env });
    fs.writeFileSync(path.join(OUT, `parts/cost_${tag}.log`), r.stdout + r.stderr);
  }
  const SC = ["stress", "natural", "effects_knife", "effects_gem", "effects_death", "scroll", "idle_m0", "idle_m2"];
  res.cost = {};
  for (const sc of SC) {
    res.cost[sc] = {};
    for (const tag of ["base", "new"]) {
      const j = JSON.parse(fs.readFileSync(path.join(OUT, `cost_${tag}/partial/vi_${sc}.json`), "utf8"));
      res.cost[sc][tag] = { n_frames: j.n_frames, n_steps: j.n_steps, n_steps_gs5: j.n_steps_gs5, step: j.step, step_gs5: j.step_gs5, frame: j.frame, ticks_per_frame: j.ticks.per_frame_mean, ticks_per_step: j.ticks.per_step, closure: j.closure.sections_vs_ctx_pct, frames_per_step: j.frames_per_step };
    }
  }
  save();
}

// 4) память
if (steps.includes("mem")) {
  const symOf = (p) => { const L = {}; for (const l of fs.readFileSync(p, "latin1").split("\n")) { const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16); } return L; };
  const Lb = symOf(B.sym), Ln = symOf(N.sym);
  const endOf = (rom, L) => { const d = fs.readFileSync(rom); const lim = L.romCeil - 0x100; let e = Math.min(d.length, lim); while (e > 0 && d[e - 1] === 0) e--; return e + 0x100; };
  const gapOf = (lst) => { const lines = fs.readFileSync(lst, "latin1").split("\n"); const re = /^\s*\d+[+\s]\s*([0-9A-Fa-f]{4})\s/; let pend = null, total = 0; for (const l of lines) { const m = re.exec(l); if (!m) continue; const a = parseInt(m[1], 16); if (pend !== null) { if (a - pend > 0) total += a - pend; pend = null; } if (/\.align\b/.test(l)) pend = a; } return total; };
  const eb = endOf(B.rom, Lb), en = endOf(N.rom, Ln);
  const gb = gapOf(B.lst), gn = gapOf(N.lst);
  // состав прежнего звука (по меткам основы)
  const probe = (() => { // проба AY + выбор чипа + копирование оверлея: от конца бут-зануления нулевой страницы до записи вектора RST7
    const lines = fs.readFileSync(B.lst, "latin1").split("\n"); let a0 = null, a1 = null;
    for (let i = 0; i < lines.length; i++) {
      if (/jp\s+nz, vec_init_zp/.test(lines[i])) { const m = /^\s*\d+[+\s]\s*([0-9A-Fa-f]{4})\s+(?:[0-9A-F]{2}\s)+/.exec(lines[i]); a0 = parseInt(m[1], 16) + 3; }
      if (a0 && /0x0038\) = JP vec_isr|0x0038 = JP vec_isr/.test(lines[i])) { const m = /^\s*\d+[+\s]\s*([0-9A-Fa-f]{4})\s/.exec(lines[i + 0]); const m2 = /^\s*\d+[+\s]\s*([0-9A-Fa-f]{4})\s/.exec(lines[i]); a1 = parseInt(m2[1], 16); break; }
    }
    return a1 - a0;
  })();
  const sec = (L, a, b) => L[b] - L[a];
  const rdSize = (rom) => fs.statSync(rom).size;
  res.mem = {
    base: { end: eb, free_to_romCeil: Lb.romCeil - eb, align_gap: gb, romCeil: Lb.romCeil, image_bytes: rdSize(B.rom) },
    now: { end: en, free_to_romCeil: Ln.romCeil - en, align_gap: gn, romCeil: Ln.romCeil, image_bytes: rdSize(N.rom) },
    resident_content_base: eb - 0x100 - gb, resident_content_now: en - 0x100 - gn,
    base_parts: {
      driver_code: sec(Lb, "setMusic", "freqNotas"), freq_table: sec(Lb, "freqNotas", "MusicIndex"), music_index: sec(Lb, "MusicIndex", "SFX_Dummy"),
      note_data: sec(Lb, "SFX_Dummy", "vec_font_rom"), overlay_hole: sec(Lb, "WRTPSG", "vtm_start"),
      boot_probe_and_copy: probe, vpic_tone: 7, vec_ldir_bwd: sec(Lb, "vec_ldir_bwd", "vec_ldir_bwd") || 0,
      overlay_in_map_zone: Lb.snd_ov_vi_end - Lb.snd_ov_ay,
    },
    now_parts: {
      player_code: sec(Ln, "updateSound", "vsn_tab"), vsn_tab: sec(Ln, "vsn_tab", "vsn_div"),
      vsn_div: sec(Ln, "vsn_div", "vsn_end") - 0, streams_near_and_div: sec(Ln, "vsn_tab", "vsn_end"),
    },
    map_zone: { MapaRAMRoot: Ln.MapaRAMRoot, starter: 0x7800, free_zone_bytes: 0x7800 - Ln.MapaRAMRoot, base_overlay_bytes: Lb.snd_ov_vi_end - Lb.snd_ov_ay },
  };
  res.mem.stream_stats = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/snd_gen/snd_gen_stats.json"), "utf8"));
  save();
}

// 5) гейты
if (steps.includes("gates")) {
  res.gates = {};
  const parse = (txt) => { const o = {}; let cur = null; for (const l of txt.split("\n")) { const m = /^== (\S+)/.exec(l); if (m) { cur = m[1]; o[cur] = []; } else if (cur && l.trim()) o[cur].push(l); } return o; };
  for (const [tag, P] of [["base", B], ["new", N]]) {
    const f = path.join(OUT, `gates_${tag}.txt`);
    if (!fs.existsSync(f) || process.argv.includes("--regate")) {
      const r = run("sh", ["tools/verify/run_gates.sh"], { env: { ...process.env, GATE_ROM: P.rom, GATE_SYM: P.sym, GATE_LST: P.lst } });
      fs.writeFileSync(f, r.stdout + r.stderr);
    }
    res.gates[tag] = parse(fs.readFileSync(f, "utf8"));
  }
  save();
}
// 6) джингл: полный вывод гейта на обеих сборках + калибровка vsnd_k_cell (parts/calib.json, snd_vi53_calib.js)
if (steps.includes("jingle")) {
  res.jingle = {};
  for (const [tag, P] of [["base", B], ["new", N]]) {
    const r = run(process.execPath, ["tools/verify/jingle_tempo_gate.js", P.rom, P.sym]);
    const m = /ВИ53\s+джингл №1: (\d+) кадров, (\d+) тиков/.exec(r.stdout), a = /AY\s+джингл №1: (\d+) кадров/.exec(r.stdout);
    res.jingle[tag] = { vi_frames: m ? +m[1] : null, vi_ticks: m ? +m[2] : null, ay_frames: a ? +a[1] : null, exit: r.status, text: r.stdout.trim().split("\n").slice(-6) };
  }
  const cf = path.join(OUT, "parts/calib.json");
  if (fs.existsSync(cf)) res.calib = JSON.parse(fs.readFileSync(cf, "utf8"));
  save();
}
save();
console.log("results.json:", RES);
