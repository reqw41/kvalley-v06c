'use strict';
const { runScene, FR } = require(__dirname + '/hf_stand.js');
const [rom, sym] = [process.argv[2], process.argv[3]];
const st = {}; const sp = [];
for (const hy of [8, 16]) for (const mum of [[60, 100], [14, 40]]) for (const x of [40, 100, 160, 210]) {
  let cur = null, L = null, VS = 0; let prevEnd=null;
  runScene(rom, sym, { mode: 'run', ticks: 250, x, hy, mummy: true, dx0: mum[0], dx1: mum[1], runw: 10,
    pcHook: (pc, f, cyc, E) => {
      if (!L) { L = E.L; VS = L.vec_vscroll; }
      if (pc === L.vxm_all) {sp.push(cyc);prevEnd=cyc;}
      if (pc === L.vxm_one) { const h = E.cpu.regs[4]; const rd = a => E.rd((h << 8) | a); const los = []; if (rd(0)) los.push(rd(2)); if (rd(0x96) !== 2) los.push(rd(0x98)); cur = { idx: h - 0xE0, t0: cyc, los }; }
      else if (pc === L.vso_prev && cur) {
        let hit = 0; for (const lo of cur.los) { const top = Math.min(255, lo + 15); const r0 = (VS - top) & 255, r1 = (VS - lo) & 255; if (r1 < r0) continue; const b0 = (40 + r0) * 192 - 44, b1 = (40 + r1) * 192 - 44; if (cur.t0 <= b1 && b0 <= cyc) hit = 1; }
        const k = (cur.idx < 6 ? 'hero' : 'mum'); const s = st[k] || (st[k] = { n: 0, hit: 0, t: 0 }); s.n++; s.hit += hit; s.t += cur.t0; s.d=(s.d||0)+(cyc-cur.t0); s.idx=s.idx||{}; s.idx[cur.idx]=(s.idx[cur.idx]||0)+1; s.hi=s.hi||{}; if(hit){s.hi[cur.idx]=(s.hi[cur.idx]||0)+1; s.hd=(s.hd||0)+(cyc-cur.t0);} if(prevEnd!==null&&cur.t0>prevEnd){s.gap=(s.gap||0)+(cur.t0-prevEnd);} prevEnd=cyc; cur = null; }
    } });
}
for (const [k, s] of Object.entries(st)) console.log(k, 'n', s.n, 'hit', s.hit, (100 * s.hit / s.n).toFixed(1) + '%', 'avg t0', (s.t / s.n) | 0, 'dur', (s.d/s.n)|0, 'gap', ((s.gap||0)/s.n)|0, JSON.stringify(s.idx), JSON.stringify(s.hi), "hitdur", ((s.hd||0)/Math.max(1,s.hit))|0);
sp.sort((a, b) => a - b); const q = p => sp[Math.floor(p * (sp.length - 1))]; console.log('vxm_all p10/50/90', q(.1), q(.5), q(.9));
