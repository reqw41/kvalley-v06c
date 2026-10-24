#!/usr/bin/env node
'use strict';
// Оценка по трассам beam_order_measure: мерцание (окна restore->show по растру), шаги, пачки, ожидание, фаза.
// Использование: node bw_eval.js <каталог трасс> <out.json>
const fs=require('fs'),zlib=require('zlib'),path=require('path');
const DIR=process.argv[2],OUTF=process.argv[3];
const api=require('./bw_lib.js')(DIR);
const st=a=>{const b=a.slice().sort((x,y)=>x-y),n=b.length;return {n,mean:n?b.reduce((s,x)=>s+x,0)/n:0,p90:b[Math.floor(n*.9)]||0,max:b[n-1]||0}};
const res={scenes:{},total:{}};
const tot={objects:0,upper_objects:0,frames:0,upper_frames:0,packs:0,hist:{},stepsN:0,stepSum:0,waits:[],packlen:[],err:[],items:0,planned:0,waited:0,nohave:0,noplan:0,dimax:0,softerr:[],hwerr:[]};
for(const f of fs.readdirSync(DIR).filter(f=>f.endsWith('.trace.json.gz')).sort()){
  const d=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR,f))));
  const ps=d.packs.filter(p=>p.gs===5&&p.end<=d.drainTime);
  const S={objects:0,upper_objects:0,windows:0,hits:0,frames:new Set(),uframes:new Set(),packlen:[],wait:[],err:[],items:0,planned:0,waited:0,nohave:0,depth:{},dimax:0,softerr:[],hwerr:[]};
  for(const p of ps){
    const m=api.metrics(d,p,new Map(p.events.map(e=>[e.id,e.start])));
    S.objects+=m.objects.length;S.upper_objects+=m.upper.length;S.windows+=m.windows;S.hits+=m.hits;
    m.frames.forEach(x=>S.frames.add(x));m.upper_frames.forEach(x=>S.uframes.add(x));
    S.packlen.push(p.end-p.start);
    let w=0;
    for(const it of p.bw||[]){S.items++;S.dimax=Math.max(S.dimax,it.dimax||0);const soft=!it.ok||!it.have;if(!it.ok||!it.have)S.nohave++;if(it.planned)S.planned++;if(it.out!==undefined)w+=it.out-it.in;if(it.taus.length>1)S.waited++;
      for(const [tau,cyc] of it.taus){let e=tau-(cyc/2)%29952;if(e>14976)e-=29952;if(e<-14976)e+=29952;S.err.push(e);(soft?S.softerr:S.hwerr).push(e);}}
    S.wait.push(w);
  }
  const steps=d.steps.filter(s=>s.gs===5);const hist={};steps.forEach(s=>hist[s.frames]=(hist[s.frames]||0)+1);
  const sc={ticks:d.ticks,packs:ps.length,objects:S.objects,upper_objects:S.upper_objects,windows:S.windows,hits:S.hits,frames:S.frames.size,upper_frames:S.uframes.size,
    pack_cycles:st(S.packlen),wait_per_pack:st(S.wait),steps:steps.length,step_hist:hist,step_cycles_mean:steps.reduce((s,x)=>s+x.cycles,0)/(steps.length||1),step_frames_mean:steps.reduce((s,x)=>s+x.frames,0)/(steps.length||1),
    bw:{items:S.items,planned:S.planned,waited:S.waited,nohave:S.nohave,phase_err:st(S.err.map(Math.abs)),phase_err_min:Math.min(...S.err,0),phase_err_max:Math.max(...S.err,0),dimax:S.dimax,hw_err:S.hwerr.length?{...st(S.hwerr.map(Math.abs)),min:Math.min(...S.hwerr),max:Math.max(...S.hwerr),mean_signed:S.hwerr.reduce((a,b)=>a+b,0)/S.hwerr.length}:null,soft_err:S.softerr.length?{...st(S.softerr.map(Math.abs)),min:Math.min(...S.softerr),max:Math.max(...S.softerr),mean_signed:S.softerr.reduce((a,b)=>a+b,0)/S.softerr.length}:null}};
  res.scenes[d.scene]=sc;
  tot.objects+=S.objects;tot.upper_objects+=S.upper_objects;tot.frames+=S.frames.size;tot.upper_frames+=S.uframes.size;tot.packs+=ps.length;
  for(const [k,v] of Object.entries(hist))tot.hist[k]=(tot.hist[k]||0)+v;
  tot.stepsN+=steps.length;tot.stepSum+=steps.reduce((s,x)=>s+x.frames,0);
  tot.waits.push(...S.wait);tot.packlen.push(...S.packlen);tot.err.push(...S.err);tot.dimax=Math.max(tot.dimax,S.dimax);tot.softerr.push(...S.softerr);tot.hwerr.push(...S.hwerr);tot.items+=S.items;tot.planned+=S.planned;tot.waited+=S.waited;tot.nohave+=S.nohave;
}
res.total={objects:tot.objects,upper_objects:tot.upper_objects,frames:tot.frames,upper_frames:tot.upper_frames,packs:tot.packs,step_hist:tot.hist,steps:tot.stepsN,step_frames_mean:tot.stepSum/(tot.stepsN||1),
  pack_cycles:st(tot.packlen),wait_per_pack:st(tot.waits),bw:{items:tot.items,planned:tot.planned,waited:tot.waited,nohave:tot.nohave,phase_err:st(tot.err.map(Math.abs)),phase_err_min:Math.min(...tot.err,0),phase_err_max:Math.max(...tot.err,0),dimax:tot.dimax,hw_err:{...st(tot.hwerr.map(Math.abs)),min:Math.min(...tot.hwerr),max:Math.max(...tot.hwerr),mean_signed:tot.hwerr.reduce((a,b)=>a+b,0)/tot.hwerr.length},soft_err:{...st(tot.softerr.map(Math.abs)),min:Math.min(...tot.softerr),max:Math.max(...tot.softerr),mean_signed:tot.softerr.reduce((a,b)=>a+b,0)/tot.softerr.length}}};
fs.writeFileSync(OUTF,JSON.stringify(res,null,1));
console.log(JSON.stringify(res.total));
