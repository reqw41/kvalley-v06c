// [mummy-zx] Профиль по объектам: такты подготовки (внутри vec_nat_sprites) и пачки (vso_fix) с разбивкой
// по vec_nsp_idx в момент исполнения (группы: створки 0-3, герой 4-5, враги 6-13, 14, нож 15-18, карта 19-20)
// и по меткам внутри каждой группы. node tools/verify/mz_prof_obj.js <rom> <sym> <сценарий> [тиков]
"use strict";
const BH = require("./beam_harness.js");
BH.toGame = function (E) { const { run, key, rd, L } = E; run(400); key(32, 1);
  for (let i = 0; i < 640 && rd(L.GameStatus) !== 5; i++) run(1); key(32, 0);
  for (let i = 0; i < 4000 && rd(L.GameStatus) !== 5; i++) run(1); return rd(L.GameStatus); };
const grp = i => i < 4 ? 'door' : i < 6 ? 'hero' : i < 14 ? 'enemy' : i === 14 ? 's14' : i < 19 ? 'knife' : 'map';
const H = { L: null, acc: {} };
const om = BH.make; BH.make = function (rom, sym) {
  const E = om(rom, sym); const { cpu, memory, L } = E; H.L = L;
  let inN = false, nSp = 0, nRet = -1, inP = false, pSp = 0;
  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    const pc = cpu.pc;
    if (!inP && pc === L.vso_fix) { inP = true; pSp = cpu.sp; }
    if (!inN && !inP && pc === L.vec_nat_sprites) { inN = true; nSp = cpu.sp; nRet = memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8); }
    oI(); const c = cpu.vcycles | 0;
    if (inP || inN) {
      const ph = inP ? 'pack' : 'prep'; const g = grp(memory.read(L.vec_nsp_idx, false));
      const k = ph + ':' + g; const o = H.acc[k] = H.acc[k] || { t: 0, pc: {} }; o.t += c; o.pc[pc] = (o.pc[pc] || 0) + c;
    }
    if (inP && cpu.sp > pSp) inP = false;
    else if (inN && cpu.pc === nRet && cpu.sp > nSp) inN = false;
  };
  return E;
};
const { runScenario } = require("./lo_lib.js"); const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, name, nt] = process.argv; const s = scenarios().find(x => x.name === name); if (nt) s.ticks = +nt;
const R = runScenario(rom, sym, s, { snap: false }); const g = R.steps.filter(x => x.g !== undefined).length;
const L = H.L; const labs = Object.entries(L).filter(([k, v]) => v >= 0x100 && v < 0x7800).sort((a, b) => a[1] - b[1]);
const lab = pc => { let lo = 0, hi = labs.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (labs[m][1] <= pc) { r = labs[m][0]; lo = m + 1; } else hi = m - 1; } return r; };
for (const [k, o] of Object.entries(H.acc).sort((a, b) => b[1].t - a[1].t)) {
  const by = {}; for (const [pc, c] of Object.entries(o.pc)) { const l = lab(+pc); by[l] = (by[l] || 0) + c; }
  console.log(k.padEnd(12), String(Math.round(o.t / g)).padStart(6), '  ', Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, +(process.env.TOP||10)).map(([l, v]) => l + ':' + Math.round(v / g)).join(' '));
}
