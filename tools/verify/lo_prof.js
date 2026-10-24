// lo_prof.js — профиль ЛОГИКИ по функциям и по видам накладных расходов (задача logic-opt).
// Использование: node lo_prof.js <rom> <sym> <lst> <out.json> [сценарии через запятую]
// Логика шага = такты тика БЕЗ вложенных прерываний (vec_isr) и без vec_nat_sprites.
// Функция = ближайшая сверху метка, на которую в тексте есть call (или Rcc/Ccc), либо точка
// входа из таблицы диспетчера; накладные = классификация СТРОКИ ИСХОДНИКА по тексту.
"use strict";
const fs = require("fs");
const { runScenario } = require("./lo_lib.js");
const { scenarios } = require("./lo_scen.js");

function parseLst(lstPath) {
  const lines = fs.readFileSync(lstPath, "latin1").split("\n");
  const byAddr = new Map(); // addr -> {text, label}
  const calls = new Set();
  let lastLabel = null;
  const re = /^\d+\+*\s+([0-9A-F]{4})\s+((?:[0-9A-F]{2} ?)*)\s*(.*)$/;
  for (const ln of lines) {
    const m = ln.match(re);
    if (!m) continue;
    const addr = parseInt(m[1], 16), bytes = m[2].trim(), text = m[3];
    const lab = text.match(/^([A-Za-z_][A-Za-z_0-9.]*):/);
    if (lab && !bytes) { lastLabel = lab[1]; byAddr.set(addr, byAddr.get(addr) || { labels: [] }); (byAddr.get(addr).labels || (byAddr.get(addr).labels = [])).push(lab[1]); continue; }
    if (!bytes) continue;
    const cm = text.match(/^\s*(?:call|c[a-z]{1,2})\s+([A-Za-z_][A-Za-z_0-9.]*)\s*(?:;.*)?$/);
    const t = text.replace(/;.*/, "").trim();
    const cm2 = t.match(/^(call|cnz|cz|cnc|cc|cpo|cpe|cp|cm)\s+([A-Za-z_][A-Za-z_0-9.]*)$/);
    if (cm2) calls.add(cm2[2]);
    const prev = byAddr.get(addr) || {};
    prev.text = t; prev.bytes = bytes.split(" ").length; byAddr.set(addr, prev);
  }
  return { byAddr, calls };
}

const HELPERS = new Set(["ADD_A_HL", "ADD_A_DE", "getIndexHL_A", "jumpIndex", "JumpIndex2", "vec_ji2", "vec_ldir_fwd", "vec_ldir_bwd", "vec_ldir_fwd1", "vec_lddr"]);
function classify(t) {
  if (!t) return "other";
  if (/z80_i[xy]/.test(t)) return "ixiy";
  if (/z80_(af|bc|de|hl)_alt|\bil_tmp2?\b|\bil_a\b|il_outstub|\bexx\b|\bex\s+af/.test(t)) return "exx_scratch";
  if (/^(call|jp)\s+(ADD_A_HL|ADD_A_DE|getIndexHL_A|jumpIndex|vec_ldir\w*|vec_lddr\w*)/.test(t)) return "helper_call";
  if (/^(rra|rla|rrca|rlca|sla|sra|srl|rr|rl)\b|^add\s+a,\s*a$/.test(t)) return "shift";
  if (/^(push|pop)\b/.test(t)) return "pushpop";
  return "other";
}

function rawMode(rom, sym, scenName, out) {
  const s = scenarios().find(x => x.name === scenName);
  const R = runScenario(rom, sym, s, { snap: false, profile: true });
  const g = R.steps.filter(x => x.g !== undefined);
  const pc = {}, cl = {};
  for (let a = 0; a < 65536; a++) { if (R.pcCyc[a]) pc[a] = R.pcCyc[a]; if (R.pcCalls[a]) cl[a] = R.pcCalls[a]; }
  fs.writeFileSync(out, JSON.stringify({ scen: scenName, steps: g.length, pure: g.map(x => x.pure), T: g.map(x => x.T), f0: g.map(x => x.f0), pc, cl }));
}

function mergeMode(sym, lst, out, raws) {
  const { byAddr, calls } = parseLst(lst);
  const symTab = [];
  for (const l of fs.readFileSync(sym, "latin1").split("\n")) {
    const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);
    if (m) { const a = parseInt(m[2], 16); if (a >= 0x100 && a < 0x7600) symTab.push([a, m[1]]); }
  }
  symTab.sort((a, b) => a[0] - b[0]);
  const fnStarts = symTab.filter(([a, n]) => calls.has(n) || /^(tickGame|AI_\w+|chk\w+|runGame|gameLogic|ControlProta\w*)$/.test(n));
  const fnAddrs = fnStarts.map(x => x[0]);
  const fnOf = pc => { let lo = 0, hi = fnAddrs.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (fnAddrs[m] <= pc) { r = m; lo = m + 1; } else hi = m - 1; } return r < 0 ? "?" : fnStarts[r][1]; };
  const callAgg = {};
  const agg = { steps: 0, pure: 0, T: 0, perFn: {}, perCat: {}, perFnCat: {}, perLine: {}, perScen: {} };
  for (const f of raws) {
    const d = JSON.parse(fs.readFileSync(f));
    const sum = a => a.reduce((x, y) => x + y, 0);
    agg.perScen[d.scen] = { steps: d.steps, pure_mean: sum(d.pure) / d.steps };
    agg.steps += d.steps; agg.pure += sum(d.pure); agg.T += sum(d.T);
    for (const [pcs, c] of Object.entries(d.cl || {})) callAgg[pcs] = (callAgg[pcs] || 0) + c;
    for (const [pcs, c] of Object.entries(d.pc)) {
      const pc = +pcs, info = byAddr.get(pc) || {};
      const fn = fnOf(pc), cat = classify(info.text);
      agg.perFn[fn] = (agg.perFn[fn] || 0) + c;
      agg.perCat[cat] = (agg.perCat[cat] || 0) + c;
      const k = fn + "|" + cat; agg.perFnCat[k] = (agg.perFnCat[k] || 0) + c;
      agg.perLine[pc] = (agg.perLine[pc] || 0) + c;
    }
  }
  const N = agg.steps;
  const rows = Object.entries(agg.perFn).sort((a, b) => b[1] - a[1]).map(([fn, c]) => {
    const cats = {}; for (const [k, v] of Object.entries(agg.perFnCat)) { const [f, ct] = k.split("|"); if (f === fn) cats[ct] = Math.round(v / N); }
    return { fn, per_step: Math.round(c / N), cats };
  });
  const lines = Object.entries(agg.perLine).sort((a, b) => b[1] - a[1]).slice(0, 500).map(([pc, c]) => ({ pc: (+pc).toString(16), per_step: +(c / N).toFixed(1), fn: fnOf(+pc), text: (byAddr.get(+pc) || {}).text }));
  const calls_top = Object.entries(callAgg).sort((a, b) => b[1] - a[1]).slice(0, 150).map(([pc, c]) => ({ pc: (+pc).toString(16), per_step: +(c / N).toFixed(3), fn: fnOf(+pc), text: (byAddr.get(+pc) || {}).text }));
  const res = { calls_top, steps: N, pure_mean: agg.pure / N, T_mean: agg.T / N, per_scenario: agg.perScen, categories: Object.fromEntries(Object.entries(agg.perCat).map(([k, v]) => [k, Math.round(v / N)])), functions: rows.slice(0, 100), top_lines: lines };
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log("steps", N, "pure_mean", Math.round(res.pure_mean), "T_mean", Math.round(res.T_mean));
  console.log("categories", JSON.stringify(res.categories));
  for (const r of rows.slice(0, 45)) console.log(String(r.per_step).padStart(6), r.fn.padEnd(24), JSON.stringify(r.cats));
}
function main() {
  const a = process.argv.slice(2);
  if (a[0] === "raw") rawMode(a[1], a[2], a[3], a[4]);
  else if (a[0] === "merge") mergeMode(a[1], a[2], a[3], a.slice(4));
  else console.error("raw <rom> <sym> <scen> <out> | merge <sym> <lst> <out> <raw...>");
}
if (require.main === module) main();
module.exports = { parseLst, classify };
