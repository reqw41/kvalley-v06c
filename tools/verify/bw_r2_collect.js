#!/usr/bin/env node
'use strict';
// Раунд 2: сводка по трассам (мерцание по окнам и по настоящим кадрам, зоны, шаги, тики звука, потерянные IRQ).
// Использование: node bw_r2_collect.js <out.json> <метка=каталог> ...  (первая метка — основа; в каталоге нужны costs.json и др.)
const fs=require('fs'),zlib=require('zlib'),path=require('path');
const F=59904,VS=0x2F;
const out=process.argv[2],dirs=process.argv.slice(3).map(a=>{const i=a.indexOf('=');return {label:a.slice(0,i),dir:a.slice(i+1)};});
const api=require('./bw_lib.js')(dirs[0].dir);
const zoneOf=y=>{const r=y-16;if(r<0||r>255)return 'out';if(r<48)return 'hud';if(r>=240)return 'bottom';const lo=(VS-r)&255;return (lo>=192&&lo<=207)?'field_y48_63':'field';};
function one(D,sc){
  const f=path.join(D,sc+'.trace.json.gz');if(!fs.existsSync(f))return null;
  const d=JSON.parse(zlib.gunzipSync(fs.readFileSync(f)));
  let obj=0,up=0;for(const p of d.packs.filter(p=>p.gs===5&&p.end<=d.drainTime)){const m=api.metrics(d,p,new Map(p.events.map(e=>[e.id,e.start])));obj+=m.objects.length;up+=m.upper.length;}
  const zones={hud:0,field:0,bottom:0,field_y48_63:0,out:0};let gl=0;
  if(d.glitch){d.glitch.rows.forEach((v,y)=>{if(v){zones[zoneOf(y)]+=v;gl+=v;}});}
  const steps=d.steps.filter(s=>s.gs===5),hist={};steps.forEach(s=>hist[s.frames]=(hist[s.frames]||0)+1);
  const cyc=d.steps.reduce((a,s)=>a+s.cycles,0)/F;
  const t=(d.snd_times||[]).filter(x=>x>0),iv=[];for(let i=1;i<t.length;i++)iv.push((t[i]-t[i-1])/F);
  const m=iv.length?iv.reduce((a,b)=>a+b,0)/iv.length:0,sd=iv.length?Math.sqrt(iv.reduce((a,b)=>a+(b-m)**2,0)/iv.length):0;
  const bw=d.packs.flatMap(p=>p.bw||[]);
  const hwerr=[],sferr=[];for(const it of bw)for(const [tau,cyc2] of it.taus||[]){let e=tau-(cyc2/2)%29952;if(e>14976)e-=29952;if(e<-14976)e+=29952;((it.ok&&it.have)?hwerr:sferr).push(e);}
  const pk=d.packs.filter(p=>p.gs===5&&p.end<=d.drainTime).map(p=>p.end-p.start).sort((a,b)=>a-b);
  return {ticks:d.ticks,packs:pk.length,windows_objects:obj,windows_upper:up,glitch_px:gl,glitch_zones:zones,glitch_frames:d.glitch?d.glitch.frames:null,
    steps:steps.length,step_hist:hist,step_frames_mean:steps.reduce((a,s)=>a+s.frames,0)/(steps.length||1),
    pack_mean:pk.reduce((a,b)=>a+b,0)/(pk.length||1),pack_p90:pk[Math.floor(pk.length*.9)]||0,
    wait_per_pack:bw.reduce((a,i)=>a+(i.out!==undefined?i.out-i.in:0),0)/Math.max(1,d.packs.length),
    snd:{n:t.length,mean:m,sd,max:iv.length?Math.max(...iv):0,out_0p5_1p5:iv.filter(x=>x<0.5||x>1.5).length,gap2:iv.filter(x=>x>1.75&&x<2.6).length,short:iv.filter(x=>x<0.25).length},
    lost_irq_pct:100*(cyc-(d.isr_entries||0))/cyc,isr_entries:d.isr_entries,snd_ticks:d.snd_ticks,
    di_max:bw.reduce((a,i)=>Math.max(a,i.dimax||0),0),hw_err:hwerr.length?{n:hwerr.length,min:Math.min(...hwerr),max:Math.max(...hwerr),mean:hwerr.reduce((a,b)=>a+b,0)/hwerr.length}:null,
    soft_err:sferr.length?{n:sferr.length,min:Math.min(...sferr),max:Math.max(...sferr),mean:sferr.reduce((a,b)=>a+b,0)/sferr.length}:null,
    bw_calls:bw.length,bw_soft:bw.filter(i=>!(i.ok&&i.have)).length};
}
const scenes=new Set();for(const {dir} of dirs)for(const f of fs.readdirSync(dir))if(f.endsWith('.trace.json.gz'))scenes.add(f.replace('.trace.json.gz',''));
const res={};for(const {label,dir} of dirs){res[label]={};for(const sc of [...scenes].sort()){const r=one(dir,sc);if(r)res[label][sc]=r;}}
fs.writeFileSync(out,JSON.stringify(res,null,1));console.log('scenes',[...scenes].length,Object.fromEntries(Object.entries(res).map(([k,v])=>[k,Object.keys(v).length])));
