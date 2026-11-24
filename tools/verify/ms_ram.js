// [memory-for-speed] Карта ОЗУ: на каждый байт 0x0000..0xFFFF — чтения, НЕНУЛЕВЫЕ записи, исполнение по сценариям lo_scen.
// Свободным считается байт, который ни разу не читался, не исполнялся и в который писали только нули (очистки).
// node tools/verify/ms_ram.js <rom> <sym> <out.json> [сценарии=demo,stress,tour1,tour2,tour3,stage]
// Печать: свободные участки >= MIN байт (по умолчанию 16) вне видимых плоскостей 0x8000..0xDFFF.
"use strict";
const fs = require("fs");
const BH = require("./beam_harness.js");
const R = new Uint32Array(65536), W = new Uint32Array(65536), X = new Uint32Array(65536); let LL = null;
const om = BH.make; BH.make = function (rom, sym) {
  const E = om(rom, sym); const { cpu, memory } = E; LL = E.L;
  const ow = memory.write.bind(memory), orr = memory.read.bind(memory);
  memory.write = function (a, v, s) { if (v & 255) W[a & 0xffff]++; return ow(a, v, s); };
  memory.read = function (a, s) { R[a & 0xffff]++; return orr(a, s); };
  const oI = cpu.instruction.bind(cpu); cpu.instruction = function () { X[cpu.pc]++; oI(); };
  return E;
};
const { runScenario } = require("./lo_lib.js"); const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, out, names = "demo,stress,tour1,tour2,tour3,stage"] = process.argv;
for (const n of names.split(",")) { try { runScenario(rom, sym, scenarios().find(x => x.name === n), { snap: false }); } catch (e) { console.error(n, e.message); } }
const MIN = +(process.env.MIN || 16); const free = [];
let s = -1; for (let a = 0; a <= 0x10000; a++) { const f = a < 0x10000 && !R[a] && !W[a] && !X[a] && !(a >= 0x8000 && a < 0xE000); if (f && s < 0) s = a; if (!f && s >= 0) { if (a - s >= MIN) free.push([s, a - s]); s = -1; } }
fs.writeFileSync(out, JSON.stringify({ rom, names, free, R: Array.from(R), W: Array.from(W), X: Array.from(X) }));
let tot = 0; for (const [a, n] of free) { tot += n; console.log(a.toString(16).padStart(4, "0"), String(n).padStart(5)); }
console.log("свободно участками >=", MIN, ":", tot, "Б в", free.length, "участках");
