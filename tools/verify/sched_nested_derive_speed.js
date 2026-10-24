#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');const OUT=path.resolve(__dirname,'../../outputs/stage-sched-nested');
function summarize(rows){const cycles=rows.reduce((s,r)=>s+r.interval_cycles,0),pixels=rows.reduce((s,r)=>s+r.distance,0);return {samples:rows.length,pixels,cycles,seconds:cycles/(59904*50),px_per_second:cycles?pixels*59904*50/cycles:null,coverage:rows.length>0&&pixels>0,rows};}
function derive(){const r=JSON.parse(fs.readFileSync(path.join(OUT,'speed.json'))),m=JSON.parse(fs.readFileSync(path.join(OUT,'matched.json')));const out={method:'Integer coordinate displacement divided by elapsed video time (50 Hz): sum eligible next-start intervals, not CPU execution time. Walk: unblocked walk scene; jump: horizontal displacement, jump2mum; ladder: vertical displacement of actively moving status=3 steps in matched natural run. Status transitions/teleports excluded; same tick IDs used for ladder.',runs:{}};
 const bases=m.runs.natural.baseline,news=m.runs.natural.new_rom;
 const ladder=[];
 for(let i=1;i<bases.extra.states.length;i++){const a=bases.extra.states[i-1],b=bases.extra.states[i];if(a.hero.status===3&&b.hero.status===3&&a.game_status===5&&b.game_status===5&&a.hero.room===b.hero.room&&Math.abs(b.hero.y-a.hero.y)===1&&Math.abs(b.hero.x-a.hero.x)===1)ladder.push(i+1);}
 for(const mode of ['baseline','new_rom']){
  const v=r.runs[mode];out.runs[mode]={};
  for(const kind of ['walk','jump']){const rows=v[kind].all_rows.filter(x=>x.before.gs===5&&x.after.gs===5&&x.interval_cycles>0&&x.interval_cycles<8*59904).filter(x=>kind==='walk'?x.before.status===0&&x.after.status===0&&Math.abs(x.after.x-x.before.x)<=2&&(x.before.keys&12)&&(x.after.x!==x.before.x||x.before.fraction!==x.after.fraction):x.before.status===1&&x.after.status===1&&Math.abs(x.after.x-x.before.x)<=2&&(x.before.keys&12)).map(x=>({...x,distance:Math.abs(x.after.x-x.before.x)}));out.runs[mode][kind]={scene:v[kind].scene,...summarize(rows)};}
  const run=m.runs.natural[mode];const rows=ladder.map(t=>{const a=run.extra.states[t-2],b=run.extra.states[t-1],s=run.measured.steps[t-1];return {tick:t,before:a.hero,after:b.hero,distance:Math.abs(b.hero.y-a.hero.y),interval_cycles:s.interval_cycles};});out.runs[mode].ladder={scene:'natural2600 matched, active ladder steps',...summarize(rows)};
 }
 out.failed_initial_climb_probe={baseline_samples:r.runs.baseline.ladder.samples,new_samples:r.runs.new_rom.ladder.samples,coverage:false,reason:'climb keys did not produce status=3; no ladder speed claimed from this scene'};
 out.comparison=Object.fromEntries(['walk','ladder','jump'].map(k=>{const a=out.runs.baseline[k],b=out.runs.new_rom[k];return [k,{baseline:a.px_per_second,new_rom:b.px_per_second,change_pct:a.px_per_second?100*(b.px_per_second/a.px_per_second-1):null,coverage:a.coverage&&b.coverage,baseline_samples:a.samples,new_samples:b.samples}]}));
 fs.writeFileSync(path.join(OUT,'speeds_final.json'),JSON.stringify(out,null,2)+'\n');return out;
}
module.exports={derive};if(require.main===module)console.log(derive().comparison);
