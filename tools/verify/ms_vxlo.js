// [memory-for-speed] Проверка vxo_lo (XOR-мумия, сдвиг габарита только по строкам): на входе модель в JS —
// fb ^= выведенное (+0x06, по старому lo0) и fb ^= новое (+0xA0, по новому lo0), копия выведенного = новое, шапка lo0 = новый;
// на выходе (возврат из vxo_lo) сверка fb по объединению габаритов, копии +0x06 и шапки. node ms_vxlo.js <rom> <sym> [сценарии]
"use strict";
const BH = require("./beam_harness.js");
let N = 0, BAD = 0; const ex = [];
const om = BH.make; BH.make = function (rom, sym) {
  const E = om(rom, sym); const { cpu, memory, L } = E; const rd = a => memory.read(a & 0xffff, false);
  let st = null; const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    if (!st && cpu.pc === L.vxo_lo) {
      const pg = cpu.regs[4] << 8, hi = rd(pg + 1), lo0 = rd(pg + 2), n = rd(pg + 3), lo1 = rd(pg + 0x98);
      const exp = new Map(); const g = a => exp.has(a) ? exp.get(a) : rd(a);
      for (let c = 0; c < n; c++) for (let k = 0; k < 16; k++) { const a = ((hi + c) << 8) | ((lo0 + k) & 255); exp.set(a, g(a) ^ rd(pg + 6 + 16 * c + k)); }
      for (let c = 0; c < n; c++) for (let k = 0; k < 16; k++) { const a = ((hi + c) << 8) | ((lo1 + k) & 255); exp.set(a, g(a) ^ rd(pg + 0xA0 + 16 * c + k)); }
      const cp = []; for (let i = 0; i < 16 * n; i++) cp.push(rd(pg + 0xA0 + i));
      st = { sp: cpu.sp, pg, exp, cp, lo1, n };
    }
    oI();
    if (st && cpu.sp > st.sp) {
      let bad = 0; for (const [a, v] of st.exp) if (rd(a) !== v) bad++;
      for (let i = 0; i < 16 * st.n; i++) if (rd(st.pg + 6 + i) !== st.cp[i]) bad++;
      if (rd(st.pg + 2) !== st.lo1) bad++;
      N++; if (bad) { BAD++; if (ex.length < 5) ex.push(`слот ${(st.pg >> 8).toString(16)}: ${bad}`); }
      st = null;
    }
  };
  return E;
};
const { runScenario } = require("./lo_lib.js"); const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, names = "stress,tour1"] = process.argv;
for (const n of names.split(",")) runScenario(rom, sym, scenarios().find(x => x.name === n), { snap: false });
console.log(`vxo_lo: вызовов ${N}, расхождений ${BAD}`, ex.join("; "));
process.exit(BAD ? 1 : 0);
