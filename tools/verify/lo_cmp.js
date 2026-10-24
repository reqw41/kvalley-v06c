// lo_cmp.js — сравнить два дампа lo_snap по тикам. Выход 0 = расхождений нет.
// node lo_cmp.js <base.bin> <new.bin> <sym>
"use strict";
const fs = require("fs");
const { nameOfAddr } = require("./lo_lib.js");
function load(p) { const b = fs.readFileSync(p); const i = b.indexOf(10); const h = JSON.parse(b.slice(0, i).toString()); return { h, body: b.slice(i + 1) }; }
const [pa, pb, sym] = process.argv.slice(2);
const A = load(pa), B = load(pb);
const L = {}; for (const l of fs.readFileSync(sym, "latin1").split("\n")) { const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16); }
const n = Math.min(A.h.n, B.h.n), sz = A.h.size;
let bad = null;
for (let i = 0; i < n && !bad; i++) {
  const x = A.body.subarray(i * sz, (i + 1) * sz), y = B.body.subarray(i * sz, (i + 1) * sz);
  if (!x.equals(y)) {
    const out = []; let off = 0;
    for (const [a, b] of A.h.ranges) { for (let k = 0; k < b - a; k++) if (x[off + k] !== y[off + k]) out.push(`${nameOfAddr(L, a + k)}: ${x[off + k]}->${y[off + k]}`); off += b - a; }
    bad = { tick: i, count: out.length, diffs: out.slice(0, 10) };
  }
}
const res = { scen: A.h.scen, ticks_a: A.h.n, ticks_b: B.h.n, size: sz, equal: !bad && A.h.n === B.h.n, first_diff: bad };
console.log(JSON.stringify(res));
process.exit(res.equal ? 0 : 1);
