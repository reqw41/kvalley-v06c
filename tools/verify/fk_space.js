// [flicker-kv2] Опись занятости резидента (по образцу tools/mem/space.js из KV2): участки между метками .sym
// в 0x0100..romCeil, файл исходника, размер, горячее/тёплое/холодное по исполнению в сценариях lo_scen.
// node tools/verify/fk_space.js <rom> <sym> <out.json> [сценарии=demo,stress,tour1]
// Горячее — в среднем >= 1 исполнение участка на кадр сценария; тёплое — исполнялось реже;
// холодное — ни разу в выборке (НЕ доказательство мёртвого кода: старт, концовка, карта, читы…).
"use strict";
const fs = require("fs"), path = require("path");
const BH = require("./beam_harness.js");
const CNT = new Uint32Array(65536); let LL = null, FRAMES = 0;
const om = BH.make; BH.make = function (rom, sym) {
  const E = om(rom, sym); const { cpu } = E; LL = E.L;
  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () { CNT[cpu.pc]++; oI(); };
  const orun = E.run; E.run = function (n) { FRAMES += n; return orun.call(E, n); };
  return E;
};
const { runScenario } = require("./lo_lib.js"); const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, out, names = "demo,stress,tour1"] = process.argv;
for (const n of names.split(",")) { const s = scenarios().find(x => x.name === n); try { runScenario(rom, sym, s, { snap: false }); } catch (e) { console.error(n, e.message); } }
const ceil = LL.romCeil;
// файл исходника для метки
const SRC = []; const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.asm$/.test(f)) SRC.push(p); } };
walk(path.join(__dirname, "../../src"));
const where = {}; for (const f of SRC) { const t = fs.readFileSync(f, "utf8").split("\n"); for (const l of t) { const m = /^([A-Za-z_][\w.]*):/.exec(l); if (m && !(m[1] in where)) where[m[1]] = path.relative(path.join(__dirname, "../.."), f); } }
const img = fs.readFileSync(rom);
let end = Math.min(img.length + 0x100, ceil); while (end > 0x100 && img[end - 0x101] === 0) end--;
const labs = Object.entries(LL).filter(([k, v]) => v >= 0x100 && v < end && where[k]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
const uniq = []; for (const x of labs) if (!uniq.length || uniq[uniq.length - 1][1] !== x[1]) uniq.push(x);
const rows = [];
for (let i = 0; i < uniq.length; i++) {
  const [k, a] = uniq[i]; const b = i + 1 < uniq.length ? uniq[i + 1][1] : end; if (b <= a) continue;
  let ex = 0, mx = 0, cov = 0; for (let p = a; p < b; p++) { if (CNT[p]) cov++; if (CNT[p] > mx) mx = CNT[p]; }
  ex = mx; // исполнений участка ~ максимум по его инструкциям (вход/цикл)
  const perF = ex / Math.max(1, FRAMES);
  rows.push({ name: k, file: where[k], start: a, size: b - a, cov, perFrame: +perF.toFixed(3), heat: !cov ? "холодное" : perF >= 1 ? "горячее" : "тёплое" });
}
// свод по файлам
const byFile = {}; for (const r of rows) { const e = byFile[r.file] = byFile[r.file] || { size: 0, hot: 0, warm: 0, cold: 0 }; e.size += r.size; e[r.heat === "горячее" ? "hot" : r.heat === "тёплое" ? "warm" : "cold"] += r.size; }
const res = { rom, scen: names, frames: FRAMES, end, romCeil: ceil, free: ceil - end, byFile, rows };
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`код+данные 0x0100-0x${end.toString(16)} romCeil 0x${ceil.toString(16)} свободно ${ceil - end} Б; кадров ${FRAMES}`);
console.log("файл".padEnd(40), "Б".padStart(6), "горяч".padStart(6), "тёпл".padStart(6), "холод".padStart(6));
for (const [f, e] of Object.entries(byFile).sort((a, b) => b[1].size - a[1].size)) console.log(f.padEnd(40), String(e.size).padStart(6), String(e.hot).padStart(6), String(e.warm).padStart(6), String(e.cold).padStart(6));
