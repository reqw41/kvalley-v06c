// [memory-for-speed] Проверка предсдвига мумий: на КАЖДОМ выходе из vsp_patx (мумия) буфер слота +0xA0..+0xCF
// сверяется с независимой моделью: строка кадра (L[r]<<8|R[r]) сдвигается на vsp_sh в 24 бита; столбец c, строка r
// лежит в 0xA0+16c+(15-r). Кадр — vec_spr_momia (прямые 0x28-0x33) или vec_spr_buf_mir (зеркальные 0x88-0x93).
// node tools/verify/ms_pxcheck.js <rom> <sym> [сценарии=stress,tour1]   -> число проверок и расхождений (exit 1 при расхождении)
"use strict";
const BH = require("./beam_harness.js");
let N = 0, BAD = 0, ex = [], byS = {};
const om = BH.make; BH.make = function (rom, sym) {
  const E = om(rom, sym); const { cpu, memory, L } = E; let st = null; const rd = a => memory.read(a & 0xffff, false);
  const oI = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    const pc = cpu.pc;
    if (!st && pc === L.vsp_patx) {
      const p = rd((rd(L.vec_nsp_ptr) | (rd(L.vec_nsp_ptr + 1) << 8)) + 2);
      const dir = p >= 0x28 && p < 0x34, mir = p >= 0x88 && p < 0x94;
      if (dir || mir) st = { sp: cpu.sp, p, sh: rd(L.vsp_sh), pg: 0xE0 + rd(L.vec_nsp_idx) };
    }
    oI();
    if (st && cpu.sp > st.sp) {
      const base = st.p < 0x80 ? L.vec_spr_momia - 0x140 + (st.p & 0xFC) * 8 : L.vec_spr_buf_mir + ((st.p - 0x60) & 0xFC) * 8;
      let bad = 0;
      for (let r = 0; r < 16; r++) {
        const v = ((rd(base + r) << 8) | rd(base + 16 + r)) << (8 - st.sh);
        for (let c = 0; c < 3; c++) { const exp = (v >> (16 - 8 * c)) & 255, got = rd(st.pg * 256 + 0xA0 + 16 * c + 15 - r); if (exp !== got) bad++; }
      }
      N++; byS[st.sh] = (byS[st.sh] || 0) + 1; if (bad) { BAD++; if (ex.length < 5) ex.push(`pat ${st.p.toString(16)} sh ${st.sh}: ${bad} Б`); }
      st = null;
    }
  };
  return E;
};
const { runScenario } = require("./lo_lib.js"); const { scenarios } = require("./lo_scen.js");
const [, , rom, sym, names = "stress,tour1"] = process.argv;
for (const n of names.split(",")) runScenario(rom, sym, scenarios().find(x => x.name === n), { snap: false });
console.log(`проверок ${N} (по сдвигам ${JSON.stringify(byS)}), расхождений ${BAD}`, ex.join("; "));
process.exit(BAD ? 1 : 0);
