// st_door_timeline.js - окно «герой стёрт -> показан» в кадре входа/выхода ворот против прохода луча по строкам героя.
// usage: node st_door_timeline.js <rom> <sym> entry|exit <frame> out.json
'use strict';
const {make}=require('./beam_harness.js');const fs=require('fs');
const [rom,sym,kind,F,out]=[process.argv[2],process.argv[3],process.argv[4],+process.argv[5],process.argv[6]];
const E=make(rom,sym);const {L,rd,memory,v06c,key,cpu,run}=E;const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
run(400);
let f=0,live=false,lastPc=0;const J=[];const ow=memory.write.bind(memory);
memory.write=function(a,v,s){const aa=a&0xffff;if(live&&f===F&&aa>=0x8000&&aa<0xE000)J.push([E.cyc(),lastPc,aa]);return ow(a,v,s);};
v06c.check_breakpoint=function(){lastPc=cpu.pc;return false;};
if(kind==='exit'){for(let blk=0;blk<60&&rd(L.GameStatus)!==5;blk++){key(32,1);run(8);key(32,0);run(5);}
  run(60);wr(L.vec_god,1);const pira0=rd(L.piramideActual);let dd=null,door=-1;
  for(let d=0;d<4;d++){const b=[];for(let i=0;i<7;i++)b.push(rd(L.pyramidDoors+d*7+i));if(b[0]!==0xff&&b[5]!==0&&b[5]!==pira0&&door<0){door=d;dd=b;}}
  wr(L.pyramidDoors+door*7+4,0x40);wr(L.flagStageClear,1);wr(L.protaStatus,0);wr(L.ProtaRoom,dd[3]);wr(L.ProtaY,dd[0]);wr(L.ProtaXdecimal,0);wr(L.ProtaX,dd[2]);
}else for(let blk=0;blk<60&&rd(L.GameStatus)<4;blk++){key(32,1);run(8);key(32,0);run(5);}
live=true;for(let i=0;i<=F;i++){v06c.oneInterrupt(true);f++;}
const labs=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0xE000).sort((a,b)=>a[1]-b[1]);
const lab=pc=>{let lo=0,hi=labs.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(labs[m][1]<=pc)lo=m;else hi=m-1;}return labs[lo][0];};
const G={};for(const [c,pc,a] of J){const l=lab(pc);if(/^vbt|^vfn/.test(l))continue;const g=G[l]=G[l]||{n:0,t0:1e9,t1:0,lo0:255,lo1:0,c0:99,c1:0};g.n++;g.t0=Math.min(g.t0,c);g.t1=Math.max(g.t1,c);g.lo0=Math.min(g.lo0,a&255);g.lo1=Math.max(g.lo1,a&255);g.c0=Math.min(g.c0,(a>>8)&31);g.c1=Math.max(g.c1,(a>>8)&31);}
const VS=L.vec_vscroll;const tb=lo=>(40+((VS-lo)&255))*192-44;
fs.writeFileSync(out,JSON.stringify({kind,frame:F,groups:G,vs:VS,beam:l=>0},null,1));
for(const k in G)console.log(k.padEnd(12),JSON.stringify(G[k]));
const s=G.vsu_srow;if(s){const a=tb(s.lo1),b=tb(s.lo0);console.log('beam over hero rows (lo',s.lo0,'..',s.lo1,'):',Math.min(a,b),Math.max(a,b));}
