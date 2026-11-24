// [flicker-kv2] Снимки худших кадров: сцена стенда hf_stand (верх/бег), кадр луча с наибольшим браком; рядом —
// тот же кадр с подсвеченными испорченными пикселями (пурпур). node tools/verify/fk_shots.js <rom> <sym> <outdir> <тег>
// Сцены — по одной на класс: верх без мумий, верх с мумиями далеко, верх рядом с мумией, бег рядом с мумией.
'use strict';
const T = __dirname + '/'; const { runScene, analyze } = require(T + 'hf_stand.js'); const fs = require('fs');
const [rom, sym, out, tag] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const SC = [['top_nomum', { hy: 16, x: 40, mode: 'run', mum: [-1, 0] }], ['top_far', { hy: 8, x: 100, mode: 'run', mum: [60, 100] }],
  ['top_near', { hy: 16, x: 100, mode: 'jump', mum: [14, 40] }], ['run_near', { hy: 72, x: 120, mode: 'run', mum: [14, 40] }]];
const res = {};
for (const [name, o] of SC) {
  const r = runScene(rom, sym, { mode: o.mode, ticks: 250, x: o.x, hy: o.hy, mummy: o.mum[0] >= 0, dx0: o.mum[0], dx1: o.mum[1], runw: 10 });
  const a = analyze(r); let bi = -1, bn = 0, tot = 0, nf = 0;
  for (let i = 0; i < a.length; i++) { if (a[i].f < 30) continue; nf++; if (a[i].bad.length) tot++; if (a[i].bad.length > bn) { bn = a[i].bad.length; bi = i; } }
  res[name] = { frames: nf, bad_frames: tot, worst_px: bn, worst_f: bi >= 0 ? a[bi].f : null };
  if (bi < 0) continue;
  const bmp = r.frames[bi].bmp; r.E.pngFrom(bmp, `${out}/${tag}_${name}.png`);
  const hl = Uint32Array.from(bmp); for (const p of a[bi].bad) hl[p] = 0xffff00ff >>> 0; r.E.pngFrom(hl, `${out}/${tag}_${name}_bad.png`);
}
fs.writeFileSync(`${out}/${tag}_shots.json`, JSON.stringify(res, null, 1)); console.log(tag, JSON.stringify(res));
