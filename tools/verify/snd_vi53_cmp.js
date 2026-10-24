"use strict";
// snd_vi53_cmp.js — сравнение двух записей snd_vi53_rec.js (основа vs новая сборка).
//   node tools/verify/snd_vi53_cmp.js base.json new.json [out.json]
// 1) состояние игры (герой, мумии, GS, счёт) на КАЖДОМ логическом тике;
// 2) последовательность запусков звука (SetMusic_/apply/hush) — одинакова ли;
// 3) состояния каналов ВИ53 после тика звука, сравнение по ЭПОХАМ: эпоха = тики между двумя соседними
//    запусками. Внутри эпохи состояние — функция числа прошедших тиков, поэтому сравнивается общий
//    префикс; разница длин эпох (сдвиг тайминга на ±1 тик) учитывается отдельно, как причина.
const fs = require("fs");
function compare(A, B) {
  const out = { logic: {}, starts: {}, ticks: {}, epochs: {}, diffs: [] };
  out.logic.n = Math.min(A.logic.length, B.logic.length);
  out.logic.diff = 0; out.logic.first = -1;
  for (let i = 0; i < out.logic.n; i++) if (A.logic[i] !== B.logic[i]) { out.logic.diff++; if (out.logic.first < 0) out.logic.first = i; }
  const sa = A.starts.map((x) => x[1]).join(","), sb = B.starts.map((x) => x[1]).join(",");
  out.starts = { base: A.starts.length, now: B.starts.length, same_sequence: sa === sb };
  out.ticks = { base: A.ticks.length, now: B.ticks.length, frames_base: A.frames, frames_now: B.frames };
  // эпохи
  const ep = (R) => {
    const e = [];
    const st = R.starts;
    let prev = 0;
    for (let i = 0; i <= st.length; i++) {
      const t = i < st.length ? st[i][0] : R.ticks.length;
      e.push({ from: prev, to: t, ev: i === 0 ? "begin" : st[i - 1][1] });
      prev = t;
    }
    return e;
  };
  const ea = ep(A), eb = ep(B);
  let compared = 0, mism = 0, lenDiff = 0, epN = Math.min(ea.length, eb.length), epWith = 0;
  const lenDelta = {};
  for (let k = 0; k < epN; k++) {
    const x = ea[k], y = eb[k];
    const la = x.to - x.from, lb = y.to - y.from;
    if (la !== lb) { lenDiff++; const d = lb - la; lenDelta[d] = (lenDelta[d] || 0) + 1; }
    const n = Math.min(la, lb);
    if (n > 0) epWith++;
    for (let j = 0; j < n; j++) {
      compared++;
      const ka = A.ticks[x.from + j], kb = B.ticks[y.from + j];
      if (ka !== kb) {
        mism++;
        if (out.diffs.length < 30) out.diffs.push({ epoch: k, event: x.ev, tick_in_epoch: j + 1, base: ka, now: kb, base_epoch_len: la, now_epoch_len: lb });
      }
    }
  }
  out.epochs = { count: ea.length, count_now: eb.length, with_ticks: epWith, compared_ticks: compared, mismatched_ticks: mism, epochs_len_differs: lenDiff, len_delta_hist: lenDelta };
  return out;
}
if (require.main === module) {
  const [a, b, o] = process.argv.slice(2);
  const r = compare(JSON.parse(fs.readFileSync(a)), JSON.parse(fs.readFileSync(b)));
  if (o) fs.writeFileSync(o, JSON.stringify(r, null, 1));
  console.log(JSON.stringify({ logic: r.logic, starts: r.starts, ticks: r.ticks, epochs: r.epochs }, null, 1));
  for (const d of r.diffs.slice(0, 10)) console.log(JSON.stringify(d));
}
module.exports = { compare };
