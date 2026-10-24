// st_stand.js - стенд задачи stair-gem: сценарий героя ЗАДАЁТСЯ скриптом (лестница, переход лестница<->площадка, бег мимо основания/верха
// лестницы, подбор гема), а не прижимается к точке, как hf_stand. На каждом кадре снимается bmp эмулятора (то, что видит луч), на концах
// пачек vec_spr_out - «устоявшийся» fb (idealBmp). Метрики - как у hf/rh: пиксель луча, которого нет ни в одном устоявшемся fb вокруг кадра.
// opts: script(E,wr,tick)->массив кодов клавиш (вызывается раз за игровой тик, ДО ввода; сам ставит героя/мумий), ticks, pcHook, mummy(dx).
'use strict';
const {make,toGame}=require('./beam_harness.js');
const FR=59904;
function runScript(rom,sym,opts){
  const E=make(rom,sym);const {L,rd,memory,v06c,key,cpu}=E;
  toGame(E);
  const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
  if(opts.pyr>1){const {rd:r2,run,key:k2}=E;while(rd(L.piramideActual)<opts.pyr){const before=rd(L.piramideActual);k2(78,true);run(3);k2(78,false);for(let f=0;f<4000&&!(rd(L.GameStatus)===5&&rd(L.piramideActual)!==before);f++)v06c.oneInterrupt(true);}run(30);}
  wr(L.vec_god,1);wr(L.ProtaRoom,0);wr(L.protaStatus,0);
  const frames=[],meta=[],states=[],journal=[];let f=0,lastPc=0;
  if(opts.journal){const [j0,j1]=opts.journal;const oW=memory.write.bind(memory);
    memory.write=function(a,v,sp){const aa=a&0xffff;if(live&&f>=j0&&f<=j1&&aa>=0x8000&&aa<0xE000)journal.push([f,E.cyc(),lastPc,aa,v&255]);return oW(a,v,sp);};}
  const OUT=L.vec_spr_out;let outRet=-1,outSp=-1;
  const retOf=()=>memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
  let live=false;
  v06c.check_breakpoint=function(){const pc=cpu.pc;lastPc=pc;if(opts.pcHook&&live)opts.pcHook(pc,f,E.cyc(),E);
    if(pc===OUT&&outRet<0){outSp=cpu.sp;outRet=retOf();}
    else if(outRet>=0&&pc===outRet&&cpu.sp>outSp){outRet=-1;if(live)states.push({t:f*FR+E.cyc(),ideal:E.idealBmp(),f});}
    return false;};
  for(let i=0;i<(opts.pre||0);i++)v06c.oneInterrupt(true);
  let held=new Set(),tick=0,prevT=rd(L.timer),nf=0,want=new Set(opts.script(E,wr,0)||[]);
  live=true;states.push({t:-1,ideal:E.idealBmp(),f:-1});
  const NT=opts.ticks;
  while(tick<NT&&nf<NT*8){
    for(const c of held)if(!want.has(c))key(c,0);
    for(const c of want)if(!held.has(c))key(c,1);
    held=want;
    live=rd(L.GameStatus)===5;
    v06c.oneInterrupt(true);
    if(live){frames.push({f,bmp:Uint32Array.from(v06c.bmp)});
      meta.push({f,tick,h:[0,1].map(i=>{const pg=0xE400+i*256;return [rd(pg+0x96),rd(pg+0x97)&31,rd(pg+0x98),rd(pg+0x99)];}),vs:L.vec_vscroll,y:rd(L.ProtaY),x:rd(L.ProtaX),st:rd(L.protaStatus),room:rd(L.ProtaRoom),gem:[0,1,2,3].map(g=>rd(L.datosGemas+9*g+1))});}
    f++;nf++;
    const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;want=new Set(opts.script(E,wr,tick)||[]);}
  }
  return {frames,meta,states,journal,E};
}
module.exports={runScript,FR};
