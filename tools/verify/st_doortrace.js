// st_doortrace.js - трасса записей в экранные плоскости за кадры [f0,f1] входа/выхода: фаза (метка PC), такт от IRQ, плоскость, диапазон адресов.
// usage: node st_doortrace.js <rom> <sym> entry|exit <f0> <f1> [xlo xhi (колонки)]
'use strict';
const {make}=require('./beam_harness.js');const fs=require('fs');
const [rom,sym,kind,f0,f1]=[process.argv[2],process.argv[3],process.argv[4],+process.argv[5],+process.argv[6]];
const E=make(rom,sym);const {L,rd,memory,v06c,key,cpu,run}=E;const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
const labs=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0xE000).sort((a,b)=>a[1]-b[1]);
const lab=pc=>{let lo=0,hi=labs.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(labs[m][1]<=pc)lo=m;else hi=m-1;}return labs[lo][0]+'+'+(pc-labs[lo][1]);};
run(400);
let f=0,live=false,lastPc=0;const J=[];
const ow=memory.write.bind(memory);
memory.write=function(a,v,s){const aa=a&0xffff;if(live&&f>=f0&&f<=f1&&aa>=0x8000&&aa<0xE000)J.push([f,E.cyc(),lastPc,aa,v&255]);return ow(a,v,s);};
const names=['vec_spr_out','vso_fix','vfr_gate','vbw_wait','vso_fastall','vpr_fs2'];const nm=new Map(names.map(n=>[L[n],n]));
v06c.check_breakpoint=function(){lastPc=cpu.pc;if(live&&f>=f0&&f<=f1){const n=nm.get(cpu.pc);if(n)J.push([f,E.cyc(),cpu.pc,-1,n+(n==='vfr_gate'?' busy='+rd(L.vbw_busy)+' rdy='+rd(L.vsp_rdy)+' need='+rd(L.vfr_need):'')]);}return false;};
if(kind==='gem'){
  // gem: toGame-подобный старт обязателен — берём beam_harness.toGame
  require('./beam_harness.js').toGame(E);wr(L.vec_god,1);wr(L.ProtaRoom,0);wr(L.protaStatus,0);
  const [sx,sy,kk]=[+process.argv[7],+process.argv[8],process.argv[9].split(',').map(Number)];
  wr(L.ProtaX,sx);wr(L.ProtaY,sy);for(let m=0;m<4;m++){wr(L.momiaDat+m*22,4);wr(L.momiaDat+m*22+3,224);}for(let sl=6;sl<=13;sl++)wr(L.sprAttrib+4*sl,224);
  for(const c of kk)key(c,1);
}else if(kind==='exit'){
  for(let blk=0;blk<60&&rd(L.GameStatus)!==5;blk++){key(32,1);run(8);key(32,0);run(5);}
  run(60);wr(L.vec_god,1);const pira0=rd(L.piramideActual);let dd=null,door=-1;
  for(let d=0;d<4;d++){const b=[];for(let i=0;i<7;i++)b.push(rd(L.pyramidDoors+d*7+i));if(b[0]!==0xff&&b[5]!==0&&b[5]!==pira0&&door<0){door=d;dd=b;}}
  wr(L.pyramidDoors+door*7+4,0x40);wr(L.flagStageClear,1);wr(L.protaStatus,0);wr(L.ProtaRoom,dd[3]);wr(L.ProtaY,dd[0]);wr(L.ProtaXdecimal,0);wr(L.ProtaX,dd[2]);
}else for(let blk=0;blk<60&&rd(L.GameStatus)<4;blk++){key(32,1);run(8);key(32,0);run(5);}
live=true;
for(let i=0;i<=f1;i++){v06c.oneInterrupt(true);f++;}
// сводка: серии подряд идущих записей одной метки и плоскости
const pl=a=>(a>>13)-4;let cur=null;const out=[];
for(const [ff,c,pc,a,v] of J){if(a<0){out.push(`f${ff} t${c} == ${v}`);cur=null;continue;}
  const key2=ff+'|'+lab(pc).split('+')[0]+'|'+pl(a);
  if(cur&&cur.k===key2&&c-cur.c1<400){cur.c1=c;cur.n++;cur.a0=Math.min(cur.a0,a&0x1fff);cur.a1=Math.max(cur.a1,a&0x1fff);}
  else{cur={k:key2,f:ff,c0:c,c1:c,n:1,a0:a&0x1fff,a1:a&0x1fff,l:lab(pc).split('+')[0],p:pl(a)};out.push(cur);}}
for(const o of out)console.log(typeof o==='string'?o:`f${o.f} t${o.c0}-${o.c1} ${o.l} pl${o.p} n=${o.n} col${(o.a0>>8)}-${(o.a1>>8)} lo${o.a0&255}-${o.a1&255}`);
