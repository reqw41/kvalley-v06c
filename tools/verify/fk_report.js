// [flicker-kv2] Свод мерцания и темпа по прогонам fk_flick.sh: одна метрика — доля кадров с браком
// (пиксель луча не совпал ни с одним устоявшимся fb), по сценам. node tools/verify/fk_report.js <dir1> [dir2 ...]
// Сцены: верх поля (rh_eval, весь экран), бег (gt_eval, весь экран), лестница (st_eval stairs+pass, окно героя),
// верх лестницы (st_eval2 top), нож (st_eval2 knife), гем/ворота/контроль (st_eval), рядом с мумией = срез мумий
// «рядом» в rh/gt и m1/m2 в st_eval2. Ворота (THR) — порог доли кадров для итоговой метрики.
'use strict';
const fs = require('fs'), path = require('path');
const THR = +(process.env.THR || 5);
function load(d) {
  const J = f => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { return null; } };
  const R = {}; const add = (k, fr, bf, bp) => { const e = R[k] = R[k] || { frames: 0, bad: 0, px: 0 }; e.frames += fr; e.bad += bf; e.px += bp; };
  const rh = J('rh.json') || []; for (const q of rh) { add('верх поля', q.frames, q.bad_frames, q.bad_px); if (q.mum === '14/40') add('рядом с мумией', q.frames, q.bad_frames, q.bad_px); }
  const gt = J('gt.json'); if (gt) for (const [k, q] of Object.entries(gt.acc)) { if (/^hy\d+$/.test(k)) add('бег по этажу', q.frames, q.bad_frames, q.bad_px); if (k === 'mum14/40') add('рядом с мумией', q.frames, q.bad_frames, q.bad_px); }
  for (const f of ['st1.json', 'st2.json']) { const j = J(f); if (!j) continue; for (const [t, v] of Object.entries(j.scenes)) {
    const c = t.split(/[_\/]/)[0]; const fr = v.frames, bf = v.bad_frames ?? v.hero_bad_frames ?? 0, bp = v.bad_px ?? v.hero_bad_px ?? 0;
    const k = c === 'up' || c === 'down' || c === 'run' || c === 'pass' ? 'лестница' : c.startsWith('gem') ? 'гем' : c === 'door' ? 'ворота' : 'контроль';
    add(k, fr, bf, bp); if (/\/m1/.test(t)) add('рядом с мумией', fr, bf, bp); } }
  for (let i = 0; i < 16; i++) { const j = J(`e2_${i}.json`); if (!j) continue; for (const [t, v] of Object.entries(j.scenes)) {
    const k = v.cls === 'top' ? 'верх лестницы' : v.cls === 'knife' ? 'нож' : 'контроль'; add(k, v.frames, v.bad_frames, v.bad_px);
    if (/\/m[12]\//.test(t)) add('рядом с мумией', v.frames, v.bad_frames, v.bad_px); } }
  let meas = null; try { meas = JSON.parse(fs.readFileSync(path.join(d, 'meas.out'), 'utf8')); } catch (e) { }
  return { R, meas };
}
const dirs = process.argv.slice(2); const all = dirs.map(load);
const keys = ['верх поля', 'бег по этажу', 'лестница', 'верх лестницы', 'нож', 'гем', 'ворота', 'рядом с мумией', 'контроль'];
const pct = e => e && e.frames ? (100 * e.bad / e.frames).toFixed(2) + '%' : '—';
console.log('| сцена | ' + dirs.map(d => path.basename(d) + ': кадров с браком / пикс').join(' | ') + ' |');
console.log('|---|' + dirs.map(() => '---').join('|') + '|');
for (const k of keys) console.log(`| ${k} | ` + all.map(a => { const e = a.R[k]; return e ? `${pct(e)} (${e.bad}/${e.frames}) / ${e.px}` : '—'; }).join(' | ') + ' |');
const tot = a => { let f = 0, b = 0, p = 0; for (const k of keys) { if (k === 'рядом с мумией') continue; const e = a.R[k]; if (e) { f += e.frames; b += e.bad; p += e.px; } } return { frames: f, bad: b, px: p }; };
console.log(`| **всего** (без двойного счёта мумий) | ` + all.map(a => { const t = tot(a); return `**${pct(t)}** (${t.bad}/${t.frames}) / ${t.px}`; }).join(' | ') + ' |');
console.log(`\nВорота мерцания (порог ${THR}% кадров): ` + all.map((a, i) => `${path.basename(dirs[i])} ${parseFloat(pct(tot(a))) <= THR ? 'ЗЕЛЁНЫЕ' : 'КРАСНЫЕ'}`).join(', '));
console.log('\n| сценарий | ' + dirs.map(d => path.basename(d) + ': кадров/шаг, доля 2-кадровых, пачка т/шаг').join(' | ') + ' |');
console.log('|---|' + dirs.map(() => '---').join('|') + '|');
for (const s of ['demo', 'stress', 'tour1', 'tour2', 'tour3']) console.log(`| ${s} | ` + all.map(a => { const m = a.meas && a.meas[s]; return m ? `${m.frames_per_step} / ${(100 * m.share_2f).toFixed(1)}% / ${m.pack_per_tick}` : '—'; }).join(' | ') + ' |');
