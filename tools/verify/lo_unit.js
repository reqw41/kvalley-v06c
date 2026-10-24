// lo_unit.js — ЮНИТ-ДОКАЗАТЕЛЬСТВО подпрограммы: одна и та же процедура из двух ROM (эталон и
// новая) вызывается на N случайных входах, сравниваются выходные регистры и память.
// node lo_unit.js <base.rom> <base.sym> <new.rom> <new.sym> <тест> [N]
// Тесты: getMapOffset, getMapOffset00, getMomiaDat.
"use strict";
const { make } = require("./beam_harness.js");
const { mulberry32 } = require("./lo_scen.js");

const STOP = 0xFFF0;
function call(E, addr, regs) {
  const { cpu, memory, rd } = E;
  const wr = (a, v) => memory.write(a & 0xffff, v & 0xff, false);
  cpu.regs[7] = regs.a; cpu.regs[0] = regs.b; cpu.regs[1] = regs.c; cpu.regs[2] = regs.d; cpu.regs[3] = regs.e;
  cpu.regs[4] = regs.h; cpu.regs[5] = regs.l;
  cpu.sp = 0xF700; wr(0xF6FE, STOP & 255); wr(0xF6FF, STOP >> 8); cpu.sp = 0xF6FE;
  cpu.pc = addr; cpu.iff = false;
  let cyc = 0, n = 0;
  while (cpu.pc !== STOP && n++ < 5000) { cpu.instruction(); cyc += cpu.vcycles | 0; }
  if (cpu.pc !== STOP) throw new Error("зависание");
  return { a: cpu.regs[7], b: cpu.regs[0], c: cpu.regs[1], d: cpu.regs[2], e: cpu.regs[3], h: cpu.regs[4], l: cpu.regs[5], cyc, sp: cpu.sp };
}

function main() {
  const [rb, sb, rn, sn, test, nArg] = process.argv.slice(2);
  const N = +(nArg || 200000);
  const A = make(rb, sb), B = make(rn, sn);
  const rnd = mulberry32(12345);
  const R = n => Math.floor(rnd() * n);
  const wrA = (E, a, v) => E.memory.write(a, v & 255, false), wrB = wrA;
  // одинаковая «карта» и мусор в областях, куда может указать результат
  for (let a = 0x75A5; a < 0xA000; a++) { const v = R(256); wrA(A, a, v); wrB(B, a, v); }
  const addrA = { getMapOffset: A.L.getMapOffset, getMapOffset00: A.L.getMapOffset00, getMomiaDat: A.L.getMomiaDat };
  const addrB = { getMapOffset: B.L.getMapOffset, getMapOffset00: B.L.getMapOffset00, getMomiaDat: B.L.getMomiaDat };
  let bad = 0, cycA = 0, cycB = 0;
  const PTR = 0xFA00;
  for (let i = 0; i < N; i++) {
    const regs = { a: R(256), b: R(256), c: R(256), d: R(256), e: R(256), h: PTR >> 8, l: PTR & 255 };
    const y = R(256), xd = R(256), x = R(256), room = R(10) < 8 ? R(3) : R(256);
    for (const E of [A, B]) { wrA(E, PTR, y); wrA(E, PTR + 1, xd); wrA(E, PTR + 2, x); wrA(E, PTR + 3, room); }
    if (test === "getMomiaDat") { regs.a = R(4); }
    if (test === "getMapOffset00") { regs.b = R(256); regs.c = R(256); }
    const ra = call(A, addrA[test], regs), rb2 = call(B, addrB[test], regs);
    cycA += ra.cyc; cycB += rb2.cyc;
    let ok = ra.h === rb2.h && ra.l === rb2.l && ra.sp === rb2.sp;
    if (test !== "getMomiaDat") ok = ok && ra.a === rb2.a && ra.b === rb2.b && ra.c === rb2.c;
    if (test === "getMapOffset00") ok = ok && ra.d === rb2.d && ra.e === rb2.e;
    if (test === "getMomiaDat") {
      const pa = A.rd(A.L.pMomiaProceso) | (A.rd(A.L.pMomiaProceso + 1) << 8), pb = B.rd(B.L.pMomiaProceso) | (B.rd(B.L.pMomiaProceso + 1) << 8);
      const ia = A.rd(A.L.z80_ix) | (A.rd(A.L.z80_ix + 1) << 8), ib = B.rd(B.L.z80_ix) | (B.rd(B.L.z80_ix + 1) << 8);
      ok = ok && pa === pb && ia === ib && ra.c === rb2.c;
    }
    if (!ok) { if (bad++ < 5) console.log("РАСХОЖДЕНИЕ", JSON.stringify({ regs, y, x, room, ra, rb: rb2 })); }
  }
  console.log(JSON.stringify({ test, N, расхождений: bad, такты_эталон: +(cycA / N).toFixed(1), такты_новая: +(cycB / N).toFixed(1) }));
  process.exit(bad ? 1 : 0);
}
main();
