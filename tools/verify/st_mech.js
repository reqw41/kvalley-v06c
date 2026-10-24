// st_mech.js - замеры механизма для REPORT stair-gem. usage: node st_mech.js <rom> <sym> out.json
//  (1) вход, кадры шагов героя 210/214/218: перед пачкой — слоты 6..13 (pending, шапка valid, габарит), vpr_mix/vpr_sl; окно «стёрт->показан»
//      по записям в плоскости против прохода луча по строкам героя;
//  (2) вход, кадр 293: блиты клеток закрывающихся ворот поверх героя и починка vfr_gate (такты), проход луча.
'use strict';
const {make}=require('./beam_harness.js');const fs=require('fs');
const [rom,sym,out]=process.argv.slice(2);
function boot(){const E=make(rom,sym);const {L,rd,key,run}=E;run(400);for(let blk=0;blk<60&&rd(L.GameStatus)<4;blk++){key(32,1);run(8);key(32,0);run(5);}return E;}
const res={frames:{}};
// ---- (1) ----
for(const F of [210,214,218]){
  const E=boot();const {L,rd,memory,v06c,cpu}=E;let f=0,live=false,lastPc=0;const J=[];const slots=[];let ctl=null;
  const ow=memory.write.bind(memory);memory.write=function(a,v,s){const aa=a&0xffff;if(live&&f===F&&aa>=0x8000&&aa<0xE000)J.push([E.cyc(),lastPc,aa]);return ow(a,v,s);};
  v06c.check_breakpoint=function(){lastPc=cpu.pc;if(live&&f===F&&cpu.pc===L.vec_spr_out&&!ctl){
    for(let sl=0;sl<14;sl++){const pg=0xE000+sl*256;slots.push({sl,pend:rd(pg+0x96),hdr_valid:rd(pg),hi0:rd(pg+0x97)&31,lo0:rd(pg+0x98),nc:rd(pg+0x99)});}
    ctl={vsp_n:rd(L.vsp_n),vpr_mix:rd(L.vpr_mix),vpr_sl:rd(L.vpr_sl),vsp_fast:rd(L.vsp_fast),vpr_at:rd(L.vpr_at),t:E.cyc()};}
    return false;};
  live=true;for(;f<=F;f++)v06c.oneInterrupt(true);
  const labs=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0xE000).sort((a,b)=>a[1]-b[1]);
  const lab=pc=>{let lo=0,hi=labs.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(labs[m][1]<=pc)lo=m;else hi=m-1;}return labs[lo][0];};
  const G={};for(const [c,pc,a] of J){const l=lab(pc);if(/^vbt|^vfn/.test(l))continue;const g=G[l]=G[l]||{n:0,t0:1e9,t1:0,lo0:255,lo1:0};g.n++;g.t0=Math.min(g.t0,c);g.t1=Math.max(g.t1,c);g.lo0=Math.min(g.lo0,a&255);g.lo1=Math.max(g.lo1,a&255);}
  const VS=L.vec_vscroll;const tb=lo=>(40+((VS-lo)&255))*192-44;
  const hero=G.vsu_srow||G.vsa_row||null;
  res.frames['entry_'+F]={ctl,slots_6_13:slots.filter(s=>s.sl>=6),groups:G,beam:hero?[Math.min(tb(hero.lo0),tb(hero.lo1)),Math.max(tb(hero.lo0),tb(hero.lo1))]:null,
    hero_erased_to_shown:G.vsu_srow&&G.vop_row?[G.vsu_srow.t0,G.vop_row.t1]:null};
}
// ---- (2) кадр 293 ----
{const F=293;const E=boot();const {L,rd,memory,v06c,cpu}=E;let f=0,live=false,lastPc=0;const J=[],ev=[];
  const ow=memory.write.bind(memory);memory.write=function(a,v,s){const aa=a&0xffff;if(live&&f===F&&aa>=0x8000&&aa<0xE000)J.push([E.cyc(),lastPc,aa]);return ow(a,v,s);};
  v06c.check_breakpoint=function(){lastPc=cpu.pc;if(live&&f===F&&cpu.pc===L.vfr_gate)ev.push([E.cyc(),rd(L.vfr_need),rd(L.vsp_rdy),rd(L.vbw_busy)]);return false;};
  live=true;for(;f<=F;f++)v06c.oneInterrupt(true);
  const labs=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0xE000).sort((a,b)=>a[1]-b[1]);
  const lab=pc=>{let lo=0,hi=labs.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(labs[m][1]<=pc)lo=m;else hi=m-1;}return labs[lo][0];};
  const T={};for(const [c,pc,a] of J){const l=lab(pc),col=(a>>8)&31;const k=(/^vbt/.test(l)?'tile':/^vs[ab]_|^vsc|^vop/.test(l)?'hero':'other')+':col'+col;const g=T[k]=T[k]||{n:0,t0:1e9,t1:0,lo0:255,lo1:0};g.n++;g.t0=Math.min(g.t0,c);g.t1=Math.max(g.t1,c);g.lo0=Math.min(g.lo0,a&255);g.lo1=Math.max(g.lo1,a&255);}
  const VS=L.vec_vscroll;const tb=lo=>(40+((VS-lo)&255))*192-44;
  res.close_293={groups:T,gate_calls:ev.map(e=>({t:e[0],need:e[1],rdy:e[2],busy:e[3]})),beam_lo168_183:[tb(183),tb(168)]};}
res.vs=null;fs.writeFileSync(out,JSON.stringify(res,null,1));
console.log(JSON.stringify(res.frames.entry_214.ctl),JSON.stringify(res.frames.entry_214.hero_erased_to_shown),JSON.stringify(res.frames.entry_214.beam));
