// Срез рабочей пачки по сцене: лестница / пересечение с мумией / верх поля.
// Стимул тот же, что у pack_prof: бог-режим, две мумии у героя, ходьба вправо.
// Запуск: node tools/verify/pack_scene_slice.js [rom] [sym]
"use strict";
const {make}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {L,rd,v06c,cpu,memory,keyboard}=E;
const wr=(a,v)=>memory.write(a&0xffff,v&255,false);
function tick(){const t0=rd(L.timer);do v06c.oneInterrupt(true);while(rd(L.timer)===t0);}
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
let f=0;while(f<1500&&rd(L.GameStatus)!==5){v06c.oneInterrupt(true);f++;}
for(let i=0;i<40;i++)tick();
wr(L.vec_god,1);
const MD=L.momiaDat, STEP=(L.momiaDat2!==undefined)?(L.momiaDat2-L.momiaDat):16;
function place(){const hY=rd(L.ProtaY),hX=rd(L.ProtaX),room=rd(L.ProtaRoom);
  for(let m=0;m<2;m++){const p=MD+m*STEP;wr(p+0,0);wr(p+3,hY);wr(p+5,(hX+(m?14:-14))&255);wr(p+6,room);}
  wr(L.enemyAttrib,hY);wr(L.enemyAttrib+1,(hX+14)&255);wr(L.enemyAttrib+2,hY);wr(L.enemyAttrib+3,(hX-14)&255);}
place();for(let i=0;i<10;i++)tick();
keyboard.keyDown({keyCode:39,which:39,preventDefault(){},stopPropagation(){}});

function rec(idx){
  const P=0xE000+idx*256, pd=rd(P+0x96);
  if(pd!==1&&pd!==3)return null;
  const nc=rd(P+0x99); if(!nc)return null;
  const c0=rd(P+0x97)&0x1F, lo=rd(P+0x98);
  return {c0,c1:c0+nc,lo,hi:(lo+15)&255};
}
function ovl(a,b){
  if(!a||!b)return false;
  if(a.c1<=b.c0||b.c1<=a.c0)return false;
  const a1=(a.lo+16)&0x1ff, b1=(b.lo+16)&0x1ff;
  // без заворота страницы: lo..lo+15
  const A0=a.lo, A1=a.lo+16, B0=b.lo, B1=b.lo+16;
  return A0<B1 && B0<A1;
}
function mumOvl(){
  const p=rec(4)||rec(5); if(!p)return false;
  for(let i=6;i<=13;i++) if(ovl(p, rec(i))) return true;
  return false;
}

const buckets={all:[], lad:[], mum:[], top:[], ladmum:[], topmm:[], all3:[]};
let inPack=false, packCyc=0, writes=0, uniq=null, prevPc=null;
const origW=memory.write.bind(memory);
memory.write=function(a,v,fl){
  if(inPack&&a>=0x8000&&a<0xE000&&(a&0xFF)>=0x30){writes++; uniq[a]=(uniq[a]||0)+1;}
  return origW(a,v,fl);
};
v06c.check_breakpoint=function(){
  if(inPack&&prevPc!==null) packCyc+=cpu.vcycles|0;
  const pc=cpu.pc;
  if(pc===L.vec_spr_out){
    inPack=true; packCyc=0; writes=0; uniq={};
  } else if(inPack&&pc===L.vso_fix+3){
    inPack=false;
    if(packCyc>1000){
      const ladder=!!rd(L.vop_i1);
      const mum=mumOvl();
      const lo=rd(0xE000+4*256+0x98);
      const top=lo>=200;
      const row={cyc:packCyc, w:writes, u:Object.keys(uniq).length, ladder, mum, top, lo};
      buckets.all.push(row);
      if(ladder) buckets.lad.push(row);
      if(mum) buckets.mum.push(row);
      if(top) buckets.top.push(row);
      if(ladder&&mum) buckets.ladmum.push(row);
      if(top&&mum) buckets.topmm.push(row);
      if(ladder&&mum&&top) buckets.all3.push(row);
    }
  }
  prevPc=pc;
  return false;
};
for(let i=0;i<600;i++){v06c.oneInterrupt(true);if(i%60===0)place();}
v06c.check_breakpoint=()=>false; memory.write=origW;

function stat(name, a){
  if(!a.length){ console.log(`  ${name}: 0 пачек`); return; }
  const n=a.length, c=a.reduce((s,r)=>s+r.cyc,0), w=a.reduce((s,r)=>s+r.w,0), u=a.reduce((s,r)=>s+r.u,0);
  const cs=a.map(r=>r.cyc).sort((x,y)=>x-y);
  const q=p=>cs[Math.min(cs.length-1, Math.floor(cs.length*p))];
  console.log(`  ${name}: ${n} пачек (${(100*n/buckets.all.length).toFixed(1)}%)  `+
    `медиана ${q(.5)} p90 ${q(.9)}  кратность ${(w/Math.max(1,u)).toFixed(2)}  записей/пачку ${Math.round(w/n)}`);
}

console.log(`ROM=${(process.argv[2]||"build/kvalley_8c.rom").split("/").pop()} рабочих пачек ${buckets.all.length}`);
stat("все", buckets.all);
stat("лестница vop_i1", buckets.lad);
stat("пересечение с мумией", buckets.mum);
stat("верх lo0>=200", buckets.top);
stat("лестница И мумия", buckets.ladmum);
stat("верх И мумия", buckets.topmm);
stat("все три", buckets.all3);
if(!buckets.all.length){ console.log("ГЕЙТ ПРОВАЛЕН: рабочих пачек нет"); process.exit(2); }
if(!buckets.mum.length){ console.log("СРЕЗ: пересечений с мумией не поймано — стимул не той сцены"); process.exit(2); }
console.log("СРЕЗ ОК");
