// [memory-for-speed] Проверка vxo_hc (код в p3: XOR-мумия сменила столбец при той же ширине). На входе модель в JS —
// fb ^= выведенное (+0x06, по hi0/lo0 шапки) и fb ^= новое (+0xA0, по hi0/lo0 записи +0x97/+0x98), копия = новое,
// шапка hi0/lo0 = новые; на выходе сверка fb, копии и шапки. Вход с другой шириной уходит в vxo_ed — не моделируется.
// Заодно сверяет, что код в p3 совпадает с источником в образе (копия vec_init цела). node ms_vxhc.js <rom> <sym> [сценарии]
"use strict";
const BH = require("./beam_harness.js");
let N = 0, BAD = 0, ED = 0, CODE = 0, LAST = null; const ex = [];
const om = BH.make; BH.make = function (rom, sym) {
  const E = om(rom, sym); LAST = E; const { cpu, memory, L } = E; const rd = a => memory.read(a & 0xffff, false);
  let st = null; const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    if (!st && cpu.pc === L.vxo_hc) {
      const pg = cpu.regs[4] << 8, hi0 = rd(pg + 1), lo0 = rd(pg + 2), n = rd(pg + 3), hi1 = rd(pg + 0x97), lo1 = rd(pg + 0x98);
      if (rd(pg + 0x99) !== n) { ED++; st = { sp: cpu.sp, skip: true }; }
      else {
        const exp = new Map(); const g = a => exp.has(a) ? exp.get(a) : rd(a);
        for (let c = 0; c < n; c++) for (let k = 0; k < 16; k++) { const a = (((hi0 + c) & 255) << 8) | ((lo0 + k) & 255); exp.set(a, g(a) ^ rd(pg + 6 + 16 * c + k)); }
        for (let c = 0; c < n; c++) for (let k = 0; k < 16; k++) { const a = (((hi1 + c) & 255) << 8) | ((lo1 + k) & 255); exp.set(a, g(a) ^ rd(pg + 0xA0 + 16 * c + k)); }
        const cp = []; for (let i = 0; i < 16 * n; i++) cp.push(rd(pg + 0xA0 + i));
        st = { sp: cpu.sp, pg, exp, cp, hi1, lo1, n };
      }
    }
    oI();
    if (st && cpu.sp > st.sp) {
      if (!st.skip) {
        let bad = 0; for (const [a, v] of st.exp) if (rd(a) !== v) bad++;
        for (let i = 0; i < 16 * st.n; i++) if (rd(st.pg + 6 + i) !== st.cp[i]) bad++;
        if (rd(st.pg + 1) !== st.hi1 || rd(st.pg + 2) !== st.lo1) bad++;
        N++; if (bad) { BAD++; if (ex.length < 5) ex.push(`слот ${(st.pg >> 8).toString(16)}: ${bad}`); }
      }
      st = null;
    }
  };
  return E;
};
const fs = require("fs");
const { runScenario } = require("./lo_lib.js"); const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, names = "stress,tour1"] = process.argv;
// код в p3 сверяется с образом: читаем ROM-файл (база 0x100) и p3 в конце каждого сценария
const img = fs.readFileSync(rom); const S = {}; for (const l of fs.readFileSync(sym, "utf8").split("\n")) { const m = l.match(/^(\w+): equ ([0-9A-F]+)h/); if (m) S[m[1]] = parseInt(m[2], 16) & 0xffff; }
// самомодифицируемые операнды прохода (t, 1-t, dh, -dh) законно отличаются от образа
const SMC = new Set(["vxh_d1", "vxh_d2", "vxh_p1", "vxh_p2"].map(k => S[k] + 1 - S.vxha_src + S.vxh_a));
for (const n of names.split(",")) {
  runScenario(rom, sym, scenarios().find(x => x.name === n), { snap: false });
  const E = LAST, rd = a => E.memory.read(a & 0xffff, false);
  for (const [src, end, dst] of [[S.vxhb_src, S.vxhb_end, S.vxo_hc], [S.vxha_src, S.vxha_end, S.vxh_a]])
    for (let i = 0; i < end - src; i++) if (rd(dst + i) !== img[src - 0x100 + i] && !SMC.has(dst + i)) { CODE++; if (process.env.V) console.log((dst + i).toString(16), rd(dst + i).toString(16), img[src - 0x100 + i].toString(16)); }
}
console.log(`vxo_hc: вызовов с той же шириной ${N}, расхождений ${BAD}; с другой шириной (vxo_ed) ${ED}; порча кода в p3 ${CODE} Б`, ex.join("; "));
process.exit(BAD || CODE ? 1 : 0);
