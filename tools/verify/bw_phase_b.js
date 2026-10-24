#!/usr/bin/env node
'use strict';
// Варианты (Б) и (В) оффлайн по трассам основы (без BEAMW): точность программного счёта по цене объектов
// и разброс точек пачки от кадрового прерывания. Использование: node bw_phase_b.js <каталог трасс основы> <out.json>
const fs=require('fs'),zlib=require('zlib'),path=require('path');
const DIR=process.argv[2],F=59904;
const q=(a,p)=>{const b=a.slice().sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor(b.length*p))]};
const st=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return {n:a.length,min:Math.min(...a),p10:q(a,.1),median:q(a,.5),p90:q(a,.9),max:Math.max(...a),mean:m,sd:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length)}};
const ab=a=>a.map(Math.abs);
const packs=[];
for(const f of fs.readdirSync(DIR).filter(f=>f.endsWith('.trace.json.gz'))){
  const d=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR,f))));
  for(const p of d.packs.filter(p=>p.gs===5&&p.end<=d.drainTime&&p.events.length))packs.push({d,p});
}
const key=(p,e)=>{const s=p.states.find(s=>s.idx===e.slots[0]);const nc=Math.max(s?.draw?.planes?.[0]?.ncols??0,s?.old?.planes?.[0]?.ncols??0);return e.kind+'|'+(e.slots.length>1?'pair':(e.slots[0]>=4&&e.slots[0]<=5?'hero':'oth'))+'|'+nc;};
const T={};
for(const {p} of packs){const ev=p.events.slice().sort((a,b)=>a.start-b.start);ev.forEach((e,i)=>{e.cost=(ev[i+1]?ev[i+1].start:e.end)-e.start;(T[key(p,e)]=T[key(p,e)]||[]).push(e.cost);});}
const M={};for(const k in T)M[k]=T[k].reduce((a,b)=>a+b,0)/T[k].length;
const startByDepth={};for(const {d,p} of packs)(startByDepth[p.depth]=startByDepth[p.depth]||[]).push((p.start+d.anchor)%F);
const med={};for(const k in startByDepth)med[k]=q(startByDepth[k],.5);
const Efull=[],Estart=[],Eprice=[];
for(const {d,p} of packs){let pred=0;for(const e of p.events.slice().sort((a,b)=>a.start-b.start)){
  Efull.push((e.start+d.anchor)%F-(med[p.depth]+pred));Estart.push((p.start+d.anchor)%F-med[p.depth]);Eprice.push((e.start-p.start)-pred);pred+=M[key(p,e)]||0;}}
const pointStart=packs.map(({d,p})=>(p.start+d.anchor)%F),pointFirst=packs.map(({d,p})=>(Math.min(...p.events.map(e=>e.start))+d.anchor)%F),pointEnd=packs.map(({d,p})=>(p.end+d.anchor)%F),plen=packs.map(({p})=>p.end-p.start);
const byDepth={};for(const k in startByDepth)byDepth[k]=st(startByDepth[k]);
const out={packs:packs.length,
  B_error_cycles:{full:st(Efull),abs_full:st(ab(Efull)),from_pack_start:st(Estart),abs_from_pack_start:st(ab(Estart)),from_prices:st(Eprice),abs_from_prices:st(ab(Eprice))},
  B_price_table_cycles:M,start_by_depth:byDepth,
  V_points_from_irq_cycles:{pack_start:st(pointStart),first_operation:st(pointFirst),pack_end:st(pointEnd),pack_length:st(plen)},
  V_align_to_max_cost_per_pack_cycles:{pack_end_to_max:Math.max(...pointEnd)-pointEnd.reduce((a,b)=>a+b,0)/pointEnd.length,first_op_to_max:Math.max(...pointFirst)-pointFirst.reduce((a,b)=>a+b,0)/pointFirst.length,start_to_max:Math.max(...pointStart)-pointStart.reduce((a,b)=>a+b,0)/pointStart.length}};
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));console.log(JSON.stringify(out.B_error_cycles.abs_full),JSON.stringify(out.V_align_to_max_cost_per_pack_cycles));
