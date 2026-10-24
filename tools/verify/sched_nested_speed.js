#!/usr/bin/env node
'use strict';
// Integer coordinate displacement per elapsed 50 Hz video time; no speed constants used.
const fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'outputs/stage-sched-nested'),H=require('./beam_harness');
const file=path.join(__dirname,'perf_baseline_1205.js');
const program=fs.readFileSync(file,'utf8').split('// --- main ----------------------------------------------------------------')[0]
 .replace('const { make, toGame } = require("./beam_harness.js");','const { make, toGame } = __harness;')
 .replace('  let TT = 0;','  __arm(E);\n  let TT = 0;');
const results={method:'sum integer coordinate displacement over eligible consecutive logical-step start intervals; video time=frames*59904+beam phase, 50 Hz; endpoints sampled before scene pin; blocked walking excluded by unchanged integer AND fractional X; jump horizontal speed, ladder vertical speed',runs:{}};
for(const mode of ['baseline','new_rom']){
 const folder=mode==='baseline'?path.join(OUT,'base'):OUT;
 results.runs[mode]={};
 for(const [scene,n,kind] of [['walk',500,'walk'],['climb',1800,'ladder'],['jump2mum',240,'jump']]){
  console.log('speed',mode,scene,n);
  let E,armed=false,frames=0,step=null,rows=[];
  const harness={toGame:H.toGame,make(){E=H.make(path.join(folder,'kvalley_8c.rom'),path.join(folder,'kvalley_8c.sym'));const {L,rd,cpu,v06c}=E;
   const snap=()=>({x:rd(L.ProtaRoom)*256+rd(L.ProtaX),fraction:rd(L.ProtaXdecimal),y:rd(L.ProtaY),status:rd(L.protaStatus),gs:rd(L.GameStatus),keys:rd(L.KeyHold)});
   const now=()=>frames*59904+E.cyc();const originalFrame=v06c.oneInterrupt.bind(v06c);v06c.oneInterrupt=(...args)=>{const z=originalFrame(...args);if(armed)frames++;return z;};
   const instruction=cpu.instruction.bind(cpu);cpu.instruction=function(){const pc=cpu.pc;
    if(armed&&pc===L.runGame&&rd(L.tickInProgress)===1){if(step&&step.after){step.interval_cycles=now()-step.start_time;rows.push(step);}step={tick:rows.length+1,start_time:now(),before:snap()};}
    instruction();
    if(armed&&pc===L.tickMain2-3&&step&&!step.after&&rd(L.tickInProgress)===0)step.after=snap();
   };return E;}};
  const context={require:createRequire(file),__dirname,console,process:{argv:['node','speed'],exitCode:0},Buffer,__harness:harness,__arm(){armed=true;frames=0;}};
  vm.createContext(context);vm.runInContext(program+'\nthis.__run=runScene;',context,{filename:'sched-speed-driver.js'});
  const sceneResult=context.__run(scene,n,{repro:false});
  const good=rows.filter(r=>r.before.gs===5&&r.after.gs===5&&r.interval_cycles>0&&r.interval_cycles<8*59904).filter(r=>{
   const dx=r.after.x-r.before.x,dy=r.after.y-r.before.y;
   if(kind==='walk')return r.before.status===0&&r.after.status===0&&Math.abs(dx)<=2&&(r.before.keys&12)&&((dx!==0)||(r.before.fraction!==r.after.fraction));
   if(kind==='ladder')return r.before.status===3&&r.after.status===3&&Math.abs(dy)<=1;
   return r.before.status===1&&r.after.status===1&&Math.abs(dx)<=2&&(r.before.keys&12);
  });
  const pixels=good.reduce((s,r)=>s+Math.abs(kind==='ladder'?r.after.y-r.before.y:r.after.x-r.before.x),0),cycles=good.reduce((s,r)=>s+r.interval_cycles,0);
  results.runs[mode][kind]={scene,logical_ticks:n,samples:good.length,pixels,cycles,seconds:cycles/(59904*50),px_per_second:cycles?pixels*59904*50/cycles:null,coverage:good.length>0&&pixels>0,rows:good,all_rows:rows,scene_counters:sceneResult.counters,interventions:sceneResult.interventions};
  console.log(kind,results.runs[mode][kind].px_per_second,good.length);
 }
}
results.comparison=Object.fromEntries(['walk','ladder','jump'].map(k=>{const a=results.runs.baseline[k],b=results.runs.new_rom[k];return [k,{baseline:a.px_per_second,new_rom:b.px_per_second,change_pct:a.px_per_second?100*(b.px_per_second/a.px_per_second-1):null,coverage:a.coverage&&b.coverage}]}));
fs.writeFileSync(path.join(OUT,'speed.json'),JSON.stringify(results,null,2)+'\n');
