// lo_results.js — собирает outputs/logic-opt/results.json и REPORT.md (все числа в отчёт — отсюда).
// node lo_results.js   (читает дампы gate_v6 / base, профили prof_base_merged / prof_v6_merged, логи гейтов)
"use strict";
const fs = require("fs");
const D = "outputs/logic-opt/";
const NEW = process.env.NEWDIR || "v6";
function load(p) { const b = fs.readFileSync(p); const i = b.indexOf(10); return JSON.parse(b.slice(0, i).toString()); }
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const SC = ["demo", "tour1", "tour2", "tour3", "stress", "stage"];
function side(dir) {
  const per = {}, allPure = [], allT = [];
  for (const s of SC) {
    const h = load(D + dir + "/snap_" + s + ".bin");
    const fr = []; for (let i = 1; i < h.f0.length; i++) { const d = h.f0[i] - h.f0[i - 1]; if (d > 0 && d < 12) fr.push(d); }
    per[s] = { ticks: h.n, logic_mean: Math.round(mean(h.pure)), logic_p90: pct(h.pure, 0.9), logic_max: Math.max(...h.pure), step_T_mean: Math.round(mean(h.T)), frames_per_step: +mean(fr).toFixed(3), cov: h.cov };
    allPure.push(...h.pure); allT.push(...h.T);
  }
  const nat = ["demo", "tour1", "tour2", "tour3"];
  const fnat = nat.reduce((a, s) => a + per[s].frames_per_step, 0) / nat.length;
  return { per_scenario: per, all: { logic_mean: Math.round(mean(allPure)), logic_p90: pct(allPure, 0.9), logic_max: Math.max(...allPure), step_T_mean: Math.round(mean(allT)) },
    frames_natural: +fnat.toFixed(3), frames_stress: per.stress.frames_per_step };
}
function freeBytes(dir) {
  const rom = fs.readFileSync(D + dir + "/kvalley_8c.rom"); const L = {};
  for (const l of fs.readFileSync(D + dir + "/kvalley_8c.sym", "latin1").split("\n")) { const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16); }
  let end = Math.min(rom.length, L.romCeil - 0x100); while (end > 0 && rom[end - 1] === 0) end--; return L.romCeil - (end + 0x100);
}
function gateLog(f) {
  const t = fs.readFileSync(D + f, "utf8"), out = {}; let cur = null;
  for (const l of t.split("\n")) { const m = l.match(/^== (\S+)/); if (m) { cur = m[1]; out[cur] = []; } else if (cur && l.trim()) out[cur].push(l.trim()); }
  const res = {}; for (const [k, v] of Object.entries(out)) { const txt = v.join(" "); res[k] = /FAIL|❌|ПРОВАЛ|красн/i.test(txt) ? "FAIL" : /OK|ok|ЗЕЛЁН|PASS/.test(txt) ? "OK" : "?"; res[k + "_last"] = v[v.length - 1]; }
  return res;
}
const base = side("base"), nw = side("gate_" + NEW);
const cmp = {}; for (const s of SC) cmp[s] = JSON.parse(fs.readFileSync(D + "gate_" + NEW + "/cmp_" + s + ".json", "utf8"));
const pb = JSON.parse(fs.readFileSync(D + "prof_base_merged.json")), pn = JSON.parse(fs.readFileSync(D + "prof_" + NEW + "_merged.json"));
const fnTable = {}; for (const r of pb.functions) fnTable[r.fn] = { base: r.per_step, new: 0 };
for (const r of pn.functions) { fnTable[r.fn] = fnTable[r.fn] || { base: 0, new: 0 }; fnTable[r.fn].new = r.per_step; }
const fnRows = Object.entries(fnTable).map(([fn, v]) => ({ fn, base: v.base, new: v.new, delta: v.new - v.base })).sort((a, b) => a.delta - b.delta);
const unit = fs.readFileSync(D + "unit_results.jsonl", "utf8").trim().split("\n").map(l => JSON.parse(l));
const res = {
  base: { dir: "23ffb6f", free_bytes: freeBytes("base") }, new: { dir: NEW, free_bytes: freeBytes(NEW) },
  logic_cycles_per_step: { base: base.all, new: nw.all, saved_mean: base.all.logic_mean - nw.all.logic_mean },
  per_scenario: { base: base.per_scenario, new: nw.per_scenario },
  frames_per_step: { base: { natural: base.frames_natural, stress: base.frames_stress }, new: { natural: nw.frames_natural, stress: nw.frames_stress } },
  profile_categories: { base: pb.categories, new: pn.categories }, profile_pure_mean: { base: pb.pure_mean, new: pn.pure_mean },
  function_table: fnRows, call_overhead_top_base: pb.calls_top.slice(0, 12),
  behaviour_gate: cmp, unit_tests: unit,
  run_gates: { base: gateLog("gates_base.log"), new: gateLog("gates_new.log") },
};
res.bytes_cost = res.base.free_bytes - res.new.free_bytes;
fs.writeFileSync(D + "results.json", JSON.stringify(res, null, 1));
console.log(JSON.stringify({ saved: res.logic_cycles_per_step.saved_mean, bytes: res.bytes_cost, fr: res.frames_per_step }));
