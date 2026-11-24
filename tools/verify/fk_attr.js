// [flicker-kv2] Атрибуция брака по ПУТИ ПАЧКИ и по ОБЪЕКТУ. Сцены rh_eval (верх) и gt_eval (бег), тот же стенд hf_stand.
// Для каждого кадра с браком: пачка, внутри которой луч прошёл первую испорченную строку, и её путь:
//   fast_mxp  — слитая пачка, пара слитой записью (vmxp)       fast_fs2 — слитая пачка, пара restore->save->show (vpr_fs2)
//   slow_s2x  — обычная пачка, пара не LAST (vpr_fs2 подряд)    slow_last — пара LAST после мумий (vop_ow / vpr_so)
//   slow_nop  — обычная пачка без пары                          none — пачки в кадре не было (брак от блита клетки / вне пачки)
// Объект: испорченный пиксель в габарите героя (по записи вывода слотов 4/5, старой и новой) / мумии (слоты 6..13) / прочее.
// node tools/verify/fk_attr.js <rom> <sym> <out.json> [ticks=250]   env: SET=rh|gt|all
'use strict';
const T = __dirname + '/';
const { runScene, analyze, FR } = require(T + 'hf_stand.js'); const fs = require('fs');
const [rom, sym, out, tk] = [process.argv[2], process.argv[3], process.argv[4], +process.argv[5] || 250];
const SET = process.env.SET || 'all';
const names = ['vec_spr_out', 'vso_fastall', 'vpr_fs2', 'vmxp', 'vop_ow', 'vpr_so', 'vpr_s2x', 'vso_fix', 'vxm_all'];
const W = 576;
const scenes = [];
if (SET !== 'gt') for (const hy of [8, 16, 24]) for (const mode of ['run', 'jump']) for (const mum of [[-1, 0], [60, 100], [14, 40]]) for (const x of [40, 100, 160, 210]) scenes.push({ set: 'rh', hy, mode, mum, x });
if (SET !== 'rh') for (const hy of [72, 112]) for (const mum of [[-1, 0], [60, 100], [14, 40]]) for (const x of [60, 120, 180]) scenes.push({ set: 'gt', hy, mode: 'run', mum, x });
const acc = {}; const add = (k, o) => { const e = acc[k] = acc[k] || { frames: 0, bad_frames: 0, bad_px: 0 }; e.frames += o.frames || 0; e.bad_frames += o.bf || 0; e.bad_px += o.bp || 0; };
for (const sc of scenes) {
  const evs = []; let LL = null;
  const r = runScene(rom, sym, {
    mode: sc.mode, ticks: tk, x: sc.x, hy: sc.hy, mummy: sc.mum[0] >= 0, dx0: sc.mum[0], dx1: sc.mum[1], runw: 10,
    pcHook: (pc, f, cyc, E) => { if (!LL) { LL = E.L; LL._m = new Map(names.map(n => [E.L[n], n])); } const n = LL._m.get(pc); if (n) evs.push([f * FR + cyc, n]); }
  });
  const E = r.E; const a = analyze(r);
  // пачки: [t0, t1, set]
  const packs = []; let cur = null; for (const [t, n] of evs) { if (n === 'vec_spr_out') { cur = { t, set: new Set() }; packs.push(cur); } else if (cur) cur.set.add(n); }
  const pathOf = p => !p ? 'none' : p.set.has('vso_fastall') ? (p.set.has('vpr_fs2') ? 'fast_fs2' : 'fast_mxp') : p.set.has('vop_ow') || p.set.has('vpr_so') ? 'slow_last' : p.set.has('vpr_s2x') || p.set.has('vpr_fs2') ? 'slow_s2x' : 'slow_nop';
  for (let i = 0; i < r.frames.length; i++) {
    const A = a[i]; if (A.f < 30) continue;
    const key = `${sc.set}/${sc.mum[0] < 0 ? 'nomum' : sc.mum[0] < 20 ? 'near' : 'far'}`;
    add(key, { frames: 1 }); add('all', { frames: 1 });
    if (!A.bad.length) continue;
    // первая испорченная строка -> время луча -> пачка, начавшаяся до него
    let ymin = 1e9; for (const o of A.bad) { const y = (o / W) | 0; if (y < ymin) ymin = y; }
    const tb = A.f * FR + (40 + ymin - 16) * 192; let pk = null; for (const p of packs) if (p.t <= tb && p.t >= A.f * FR - FR) pk = p;
    const path = pathOf(pk);
    // объект: окно героя (как st_lib: X-26..X+30, строки Y+44..Y+100) против остального поля
    const m = r.meta[i]; const Y = m.y > 200 ? m.y - 256 : m.y; const hx0 = 32 + 2 * Math.max(0, m.x - 26), hx1 = 32 + 2 * Math.min(255, m.x + 30), hy0 = Math.max(16, Y + 44), hy1 = Math.min(272, Y + 100);
    let nh = 0; for (const o of A.bad) { const y = (o / W) | 0, x = o % W; if (x >= hx0 && x < hx1 && y >= hy0 && y < hy1) nh++; }
    const obj = nh === 0 ? 'other' : nh === A.bad.length ? 'hero' : 'both';
    add('obj:' + obj, { bf: 1, bp: A.bad.length }); add('obj:' + obj + ':' + path, { bf: 1, bp: A.bad.length }); add(key + ':obj:' + obj, { bf: 1, bp: A.bad.length });
    add(key, { bf: 1, bp: A.bad.length }); add('all', { bf: 1, bp: A.bad.length });
    add('path:' + path, { bf: 1, bp: A.bad.length });
    add(key + ':' + path, { bf: 1, bp: A.bad.length });
  }
  process.stderr.write(`${sc.set} hy${sc.hy} ${sc.mode} mum${sc.mum.join('/')} x${sc.x}\n`);
}
fs.writeFileSync(out, JSON.stringify(acc, null, 1));
for (const [k, v] of Object.entries(acc).sort()) console.log(k.padEnd(28), JSON.stringify(v));
