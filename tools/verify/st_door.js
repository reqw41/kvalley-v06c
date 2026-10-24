// st_door.js - стенд задачи stair-gem: ВХОД (герой выходит из ворот, створки закрываются) и ВЫХОД (герой заходит в ворота, створки
// открываются/закрываются) на уровне лучевых кадров. Тот же принцип, что st_stand/hf_stand: bmp эмулятора на каждом кадре против
// «устоявшихся» fb на концах пачек вывода (vec_spr_out) и на конце починки vso_fix (+3 после call vec_spr_out).
'use strict';
const {make}=require('./beam_harness.js');
const FR=59904;
// kind: 'entry' (новая партия, пирамида 1) | 'death' (после смерти: рестарт уровня) | 'exit' (штатный chkSalePiram по двери-выходу)
function runDoor(rom,sym,kind,opts){
  opts=opts||{};
  const E=make(rom,sym);const {L,rd,memory,v06c,key,cpu,run}=E;
  const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
  const frames=[],meta=[],states=[];let f=0,live=false,evs=[];
  const OUT=L.vec_spr_out;let outRet=-1,outSp=-1;
  const retOf=()=>memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
  const names=opts.names||['vec_spr_out','vso_fastall','vpr_fs2','vbw_wait','vso_fix'];const nm=new Map(names.map(n=>[L[n],n]));
  v06c.check_breakpoint=function(){const pc=cpu.pc;
    if(live){const n=nm.get(pc);if(n)evs.push([f*FR+E.cyc(),n]);}
    if(pc===OUT&&outRet<0){outSp=cpu.sp;outRet=retOf();}
    else if(outRet>=0&&pc===outRet&&cpu.sp>outSp){outRet=-1;if(live)states.push({t:f*FR+E.cyc(),ideal:E.idealBmp(),f});}
    return false;};
  const step=()=>{v06c.oneInterrupt(true);if(live){frames.push({f,bmp:Uint32Array.from(v06c.bmp)});
      meta.push({f,gs:rd(L.GameStatus),en:rd(L.statusEntrada),x:rd(L.ProtaX),y:rd(L.ProtaY),st:rd(L.protaStatus),room:rd(L.ProtaRoom)});
      if(rd(L.vso_fixflag||0)){}}f++;};
  run(400+(opts.pre||0));
  let n=0;
  if(kind==='exit'){
    for(let blk=0;blk<60&&!(rd(L.GameStatus)===5);blk++){key(32,1);run(8);key(32,0);run(5);}
    run(60);wr(L.vec_god,1);
    const pira0=rd(L.piramideActual);let door=-1,dd=null;
    for(let d=0;d<4;d++){const b=[];for(let i=0;i<7;i++)b.push(rd(L.pyramidDoors+d*7+i));if(b[0]!==0xff&&b[5]!==0&&b[5]!==pira0&&door<0){door=d;dd=b;}}
    wr(L.pyramidDoors+door*7+4,0x40);wr(L.flagStageClear,1);wr(L.protaStatus,0);wr(L.ProtaRoom,dd[3]);wr(L.ProtaY,dd[0]);wr(L.ProtaXdecimal,0);wr(L.ProtaX,dd[2]);
    live=true;states.push({t:-1,ideal:E.idealBmp(),f:-1});
    for(let i=0;i<opts.frames&&i<2000;i++)step();
  } else {
    // вход: пробел из меню; запись с первого кадра GS>=4
    for(let blk=0;blk<60&&rd(L.GameStatus)<4;blk++){key(32,1);run(8);key(32,0);run(5);}
    live=true;states.push({t:-1,ideal:E.idealBmp(),f:-1});
    for(let i=0;i<opts.frames;i++){step();}
  }
  return {frames,meta,states,evs,E};
}
module.exports={runDoor,FR};
