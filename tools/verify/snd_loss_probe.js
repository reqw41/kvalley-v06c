// ПРОБА ПОТЕРЬ ТИКОВ МУЗЫКИ. Сцена — демо (GS=5 без игрока, трое движущихся): по кадрам
// считаем входы ISR (vec_isr), пропуски (vec_isr_skip, depth>=3), вызовы updateSound и на
// КАЖДОМ vtm_delta сверяем возвращённую дельту DE с истинным временем между опросами
// (такты/2 = отсчёты ВИ53). Расхождение ~60000 = потерянный период часов (2 кадра музыки).
// Запуск: node tools/verify/snd_loss_probe.js [rom] [sym] [кадров]
"use strict";
const {make}=require(require("path").resolve(__dirname,"beam_harness.js"));
const ROM=process.argv[2]||"build/kvalley_8c.rom", SYM=process.argv[3]||"build/kvalley_8c.sym", N=+(process.argv[4]||3000);
const E=make(ROM,SYM); const {L,rd,v06c,cpu,memory,cyc,FRAME}=E;
const A_HW=L.vst_hw, A_FRM=L.vst_frame, A_COOP=L.vsnd_tick_coop, A_TICK=L.vsnd_tick;
const A_SADD=L.vsnd_sample+12; let ovf=0, ovfList=[];
const A_ISR=L.vec_isr, A_SKIP=L.vec_isr_skip, A_US=L.updateSound, A_DELTA=L.vtm_delta, A_SAMPLE=L.vsnd_sample;
let frame=0, cur=null, retAddr=-1, lastPoll=-1, pollFrom=-1;
const rows=[]; let lossEv=[]; let hist={};
const now=()=>frame*FRAME+cyc();
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(!cur) return false;
  if(pc===A_SADD){ if(cpu.cf){ ovf++; ovfList.push(frame); cur.ovf=(cur.ovf||0)+1; } }
  else if(pc===A_ISR) cur.isr++;
  else if(pc===A_SKIP) cur.skip++;
  else if(pc===A_US) cur.us++;
  else if(pc===A_HW) cur.hw++;
  else if(pc===A_FRM) cur.frm++;
  else if(pc===A_COOP) cur.coop++;
  else if(pc===A_TICK) cur.tk++;
  else if(pc===A_DELTA){ retAddr=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8); pollFrom=now(); }
  else if(pc===retAddr){ retAddr=-1;
    const de=(cpu.regs[2]<<8)|cpu.regs[3]; const t=now();
    if(lastPoll>=0){ const trueCnt=((t-lastPoll)/2)|0; const diff=trueCnt-de;
      cur.polls++; cur.dsum+=diff; if(Math.abs(diff)>2000){ cur.loss+=diff; lossEv.push({frame,trueCnt,de,diff,gap:(t-lastPoll)/FRAME}); } }
    lastPoll=t; }
  return false;
};
// до демо
for(let f=0;f<9000 && rd(L.GameStatus)!==5;f++) v06c.oneInterrupt(true);
if(rd(L.GameStatus)!==5){ console.log("демо не началось"); process.exit(1); }
for(let f=0;f<N;f++){
  cur={isr:0,skip:0,us:0,polls:0,loss:0,hw:0,frm:0,coop:0,tk:0,dsum:0};
  v06c.oneInterrupt(true); frame++;
  if(rd(L.GameStatus)!==5) break;
  rows.push(cur);
}
const F=rows.length, us=rows.reduce((s,r)=>s+r.us,0), skips=rows.reduce((s,r)=>s+r.skip,0);
const noTick=rows.filter(r=>r.us===0).length, two=rows.filter(r=>r.us>=2).length;
// серии пропусков
let runs={}, run=0; for(const r of rows){ if(r.skip){run++;} else { if(run){runs[run]=(runs[run]||0)+1;} run=0; } } if(run) runs[run]=(runs[run]||0)+1;
console.log(`кадров ${F}, updateSound ${us} (${(us/F).toFixed(4)}/кадр, потеряно ${F-us}), без тика ${noTick} (${(100*noTick/F).toFixed(1)}%), с двумя+ ${two} (${(100*two/F).toFixed(1)}%)`);
console.log(`пропусков ISR (depth>=3): ${skips}; серии подряд: ${JSON.stringify(runs)}`);
console.log(`расхождений дельты часов с истинным временем (>2000 отсчётов): ${lossEv.length}, суммарно ${lossEv.reduce((s,e)=>s+e.diff,0)} отсчётов = ${(lossEv.reduce((s,e)=>s+e.diff,0)/29952).toFixed(2)} кадра музыки`);
for(const e of lossEv.slice(0,12)) console.log(`  кадр ${e.frame}: истинно ${e.trueCnt} (${e.gap.toFixed(2)} кадра), часы дали ${e.de}, разница ${e.diff}`);
// потери в кадрах со skip и без
const inSkip=lossEv.filter(e=>rows[e.frame-1]&&(rows[e.frame-1].skip||(rows[e.frame-2]&&rows[e.frame-2].skip))).length;
console.log(`из них рядом с пропуском ISR: ${inSkip}`);
const sum=(k)=>rows.reduce((s,r)=>s+r[k],0);
console.log(`сумма ВСЕХ расхождений дельты: ${sum('dsum')} отсчётов = ${(sum('dsum')/29952).toFixed(2)} кадра; опросов ${sum('polls')}`);
console.log(`входов vst_hw ${sum('hw')}, vst_frame ${sum('frm')}, vsnd_tick ${sum('tk')}, coop ${sum('coop')}; кадров без входа ISR: ${rows.filter(r=>r.isr===0).length}, с 2+ входами: ${rows.filter(r=>r.isr>=2).length}`);
console.log(`ПЕРЕНОСОВ на add hl,de в vsnd_sample: ${ovf} = ${(ovf*65536/29952).toFixed(1)} кадра музыки; кадры: ${ovfList.slice(0,20).join(',')}`);
console.log(`vtm_acc в конце: ${rd(L.vtm_acc)|(rd(L.vtm_acc+1)<<8)} отсчётов, vtm_have=${rd(L.vtm_have)}, vtm_dead=${rd(L.vtm_dead)}`);
// кадры без тика: сколько в них было входов ISR и vst_hw
const nt=rows.filter(r=>r.us===0); const h={}; for(const r of nt){const k=`isr${r.isr}/hw${r.hw}`; h[k]=(h[k]||0)+1;} console.log('кадры без тика по (входы ISR / vst_hw):',JSON.stringify(h));
