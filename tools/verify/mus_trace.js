// Трасса причин потери/сдвига тика музыки по кадрам (дополнение к mus_jitter.js).
// node mus_trace.js <tools/verify> <rom> <sym> <сценарии...>
// Для каждого растрового кадра: число вызовов updateSound, был ли запрос IRQ принят сразу
// (pc==0x38 на первой проверке после импульса), если нет — где (PC предыдущей инструкции, depth ISR),
// сколько тактов длится текущее окно DI и где оно началось. Затем классификация кадров 0 и 2+ тиков.
const TV = process.argv[2];
const BH = require(TV + "/beam_harness.js");
const make0 = BH.make;
let G = null; // состояние текущего прогона
BH.make = function (...a) {
  const E = make0(...a);
  const { v06c, cpu, L, rd } = E;
  const US = L.updateSound;
  const g = G = { L, frames: [], cur: null, T: 0, prevPc: 0, prevIff: false, diStartPc: 0, diStartT: 0, pulseSeen: false };
  const newFrame = () => ({ ticks: [], served: null, lostPc: -1, lostDepth: -1, diAge: 0, diPc: 0, T0: g.T, depthAtIrq: rd(L.vec_isr_depth) });
  g.newFrame = newFrame;
  let cb = v06c.check_breakpoint;
  Object.defineProperty(v06c, "check_breakpoint", {
    get() {
      return function () {
        const f = g.cur;
        if (f) {
          g.T += cpu.vcycles || 0;
          if (cpu.pc === 0x38) g.isrT = g.T;
          if (cpu.pc === US) { f.ticks.push(g.T - f.T0); (f.src = f.src || []).push(g.prevPc); (f.ret2 = f.ret2 || []).push(rd(cpu.sp) | (rd(cpu.sp + 1) << 8)); }
          const fl = v06c.filler;
          if (!g.pulseSeen && fl && fl.raster_line === 0 && fl.raster_pixel >= 176) {
            g.pulseSeen = true;
            f.T0 = g.T; // привязка: импульс IRQ
            f.pulseT = g.T; f.have = rd(L.vtm_have);
            f.served = (cpu.pc === 0x38 || cpu.pc === 0x39 || cpu.pc === 0x3a);
            if (!f.served) {
              f.lostPc = g.prevPc; f.lostDepth = rd(L.vec_isr_depth); f.diAge = g.T - g.diStartT; f.diPc = g.diStartPc; f.iff = cpu.iff;
              f.sinceIsr = g.T - (g.isrT || 0); f.ret = rd(cpu.sp) | (rd(cpu.sp + 1) << 8);
            }
          }
          if (!g.prevIff && cpu.iff && f.pulseT && f.endP === undefined && f.served === false) f.endP = g.T - f.pulseT;
          if (!g.prevIff && cpu.iff && g.diStartT) { const w = g.T - g.diStartT; const b = g.diStartPc; (g.win = g.win || []).push([b, w, g.T]); }
          if (g.prevIff && !cpu.iff) { g.diStartT = g.T; g.diStartPc = g.prevPc; }
          g.prevIff = cpu.iff;
          g.prevPc = cpu.pc;
        }
        return cb.apply(this, arguments);
      };
    },
    set(f) { cb = f; }, configurable: true,
  });
  const oi = v06c.oneInterrupt.bind(v06c);
  Object.defineProperty(v06c, "oneInterrupt", {
    get() {
      return function (...b) {
        g.cur = newFrame(); g.pulseSeen = false;
        const r = oi(...b);
        // времена тиков считаем от импульса
        g.cur.ticks = g.cur.ticks.map(t => t - (g.cur.pulseT - g.cur.T0));
        g.frames.push(g.cur);
        return r;
      };
    },
    set(f) { }, configurable: true,
  });
  return E;
};
BH.toGame = function (E) {
  const { run, key, rd, L } = E; run(400); key(112, 1); key(114, 1);
  for (let i = 0; i < 640 && rd(L.GameStatus) !== 5; i++) run(1); key(112, 0); key(114, 0);
  for (let i = 0; i < 4000 && rd(L.GameStatus) !== 5; i++) run(1); return rd(L.GameStatus);
};
const { runScenario } = require(TV + "/lo_lib.js");
const { scenarios } = require(TV + "/lo_scen.js");
const [, , , rom, sym, ...names] = process.argv;
function nameOf(L, a) {
  let best = null;
  for (const [k, v] of Object.entries(L)) if (!/^[A-Z0-9_]+$/.test(k) && v <= a && v >= 0x100 && v < 0x7600 && (best === null || v > L[best])) best = k;
  return best ? `${best}+${a - L[best]}` : "0x" + a.toString(16);
}
const bucket = (L, a) => nameOf(L, a).replace(/\+\d+$/, "");
for (const n of names) {
  const s = scenarios().find(x => x.name === n);
  G = null;
  runScenario(rom, sym, s, { snap: false });
  const { L } = G;
  const win = {};
  let totT = 0; for (const [b, w, t] of G.win || []) { if (w > 100000) continue; const k = bucket(L, b); const e = win[k] || (win[k] = { n: 0, sum: 0, max: 0 }); e.n++; e.sum += w; e.max = Math.max(e.max, w); }
  const tot = G.T;
  const winTop = Object.entries(win).sort((a, b) => b[1].sum - a[1].sum).slice(0, 14).map(([k, e]) => [k, e.n, Math.round(e.sum / e.n), e.max, +(100 * e.sum / tot).toFixed(2)]);
  console.log("DI windows (<100k): [start, n, mean, max, %time]", JSON.stringify(winTop));
  const F = G.frames.slice(600);
  const N = F.length;
  const out = { scen: n, frames: N, zero: 0, multi: 0, z_lost: 0, z_served: 0, m_after_zero: 0, m_other: 0, lost_total: 0, tickphase: [], lostByProc: {}, lostByDiPc: {}, lostByDepth: {}, lostDiAge: [], zServedInfo: {}, mOther: {}, tickSrc: {}, retSrc: {}, retSrcMulti: {}, pairs: {}, sinceIsr: [], tickSrcLostFrames: {}, lostByDiClass: {}, zeroEnd: {}, haveStat: {}, zeroByDi: {}, zeroByDepth: {}, multiByCause: {} };
  for (let i = 0; i < N; i++) {
    const f = F[i], nt = f.ticks.length;
    if (f.served === false) {
      out.lost_total++;
      const p = bucket(L, f.lostPc); out.lostByProc[p] = (out.lostByProc[p] || 0) + 1;
      const d = bucket(L, f.diPc); out.lostByDiPc[d] = (out.lostByDiPc[d] || 0) + 1;
      { const k = bucket(L, f.diPc) + " -> " + bucket(L, f.lostPc) + " d" + f.lostDepth; out.pairs[k] = (out.pairs[k] || 0) + 1; out.sinceIsr.push(f.sinceIsr); }
      out.lostByDepth[f.lostDepth] = (out.lostByDepth[f.lostDepth] || 0) + 1;
      out.lostDiAge.push(f.diAge);
    }
    { const k = (nt === 0 ? "zero" : nt >= 2 ? "multi" : "one") + " have=" + f.have; out.haveStat[k] = (out.haveStat[k] || 0) + 1; }
    if (nt === 0) {
      out.zero++;
      if (f.served === false) { const kd = bucket(L, f.diPc) + (f.diAge > 59904 ? " [DI>кадра]" : " [DI<кадра]"); out.zeroByDi[kd] = (out.zeroByDi[kd] || 0) + 1; out.zeroByDepth[f.lostDepth] = (out.zeroByDepth[f.lostDepth] || 0) + 1; }
      if (f.served === false) { const k = bucket(L, f.diPc) + " end=" + (f.endP === undefined ? "none" : (f.endP < 1500 ? "<1.5k" : f.endP < 3000 ? "<3k" : f.endP < 10000 ? "<10k" : "≥10k")); out.zeroEnd[k] = (out.zeroEnd[k] || 0) + 1; }
      if (f.served === false) out.z_lost++; else { out.z_served++; const k = "depthAtIrq=" + f.depthAtIrq; out.zServedInfo[k] = (out.zServedInfo[k] || 0) + 1; }
    } else if (nt >= 2) {
      out.multi++;
      const prevZero = i > 0 && F[i - 1].ticks.length === 0;
      if (prevZero) out.m_after_zero++; else { out.m_other++; const k = "served=" + f.served + " ticks@" + f.ticks.map(t => Math.round(t / 1000) + "k").join(","); out.mOther[k] = (out.mOther[k] || 0) + 1; }
    }
    for (const t of f.ticks) out.tickphase.push(t);
    if (f.ret2) for (const a of f.ret2) { const b = bucket(L, a); out.retSrc[b] = (out.retSrc[b] || 0) + 1; if (nt >= 2) out.retSrcMulti[b] = (out.retSrcMulti[b] || 0) + 1; }
    if (f.src) for (const a of f.src) { const b = bucket(L, a); out.tickSrc[b] = (out.tickSrc[b] || 0) + 1; if (f.served === false) out.tickSrcLostFrames[b] = (out.tickSrcLostFrames[b] || 0) + 1; }
    if (f.served === false) { const k = bucket(L, f.diPc) + (f.diAge > 59904 ? " [DI>кадра]" : " [DI<кадра]") + " ticks=" + nt; out.lostByDiClass[k] = (out.lostByDiClass[k] || 0) + 1; }
  }
  if (process.env.DUMP) {
    let shown = 0;
    for (let i = 3; i < N && shown < +process.env.DUMP; i++) {
      if (F[i].ticks.length >= 2 && F[i - 1].ticks.length > 0 && (!process.env.HAVE || F[i].have == +process.env.HAVE)) {
        shown++;
        const fmt = j => "[" + j + "] " + "h" + F[j].have + (F[j].served === false ? " LOST@" + bucket(L, F[j].lostPc) + " end=" + F[j].endP : " ok") + " ticks=" + F[j].ticks.map((t, k) => Math.round(t / 100) / 10 + "k:" + bucket(L, F[j].ret2[k])).join(",");
        console.log([i - 2, i - 1, i, i + 1].map(fmt).join("\n") + "\n--");
      }
    }
  }
  const q = (a, p) => { a = a.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
  out.tickphase_p10_p50_p90_max = [q(out.tickphase, .1), q(out.tickphase, .5), q(out.tickphase, .9), q(out.tickphase, 1)];
  delete out.tickphase;
  out.lostDiAge_p10_p50_p90_max = [q(out.lostDiAge, .1), q(out.lostDiAge, .5), q(out.lostDiAge, .9), q(out.lostDiAge, 1)];
  delete out.lostDiAge;
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 14);
  out.lostByProc = top(out.lostByProc); out.lostByDiPc = top(out.lostByDiPc); out.zeroEnd = top(out.zeroEnd); out.zeroByDi = Object.entries(out.zeroByDi).sort((a, b) => b[1] - a[1]); out.haveStat = Object.entries(out.haveStat); out.pairs = top(out.pairs); out.sinceIsr = [q(out.sinceIsr,.1),q(out.sinceIsr,.5),q(out.sinceIsr,.9)]; out.mOther = top(out.mOther); out.tickSrc = top(out.tickSrc); out.retSrc = top(out.retSrc); out.retSrcMulti = top(out.retSrcMulti); out.tickSrcLostFrames = top(out.tickSrcLostFrames); out.lostByDiClass = top(out.lostByDiClass);
  console.log(JSON.stringify(out));
}
