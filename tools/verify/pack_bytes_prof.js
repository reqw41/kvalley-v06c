// СКОЛЬКО РАЗ ЗА ПАЧКУ ПЕРЕПИСЫВАЕТСЯ ОДИН И ТОТ ЖЕ БАЙТ ЭКРАНА.
//
// ЗАЧЕМ. Рецепт анти-фликера (reference_vector_flicker_recipe) требует: «каждый байт fb
// пишется РОВНО ОДИН РАЗ окончательным значением — мерцание это окно «стёрт-не-нарисован»
// и двойные записи, а не поздний вывод». Значит решающее число — не длина пачки, а
// КРАТНОСТЬ записи: сколько проходов read-modify-write видит луч на одном байте.
// Стенд считает записи в видимую память (p0/p1/p2, младшие 48 байт страницы — данные,
// см. опись в vec_boot) внутри пачки vec_spr_out, с разбивкой по метке-писателю, и
// печатает распределение «байт переписан N раз».
"use strict";
const {make}=require("./beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
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
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x8000).sort((a,b)=>a[1]-b[1]);
const addrs=syms.map(x=>x[1]);
const near=pc=>{let l=0,h=addrs.length-1,r=0;while(l<=h){const m=(l+h)>>1;if(addrs[m]<=pc){r=m;l=m+1}else h=m-1}return syms[r][0];};
let inPack=false, packs=0;
const byLabel={}; let cnt=null; const mult={}; let totalW=0, totalUniq=0;
const origW=memory.write.bind(memory);
memory.write=function(a,v,fl){
  // видимая память: p0/p1/p2 (0x8000-0xDFFF); младшие 48 байт страницы — служебные данные
  if(inPack&&a>=0x8000&&a<0xE000&&(a&0xFF)>=0x30){
    const k=near(cpu.pc); byLabel[k]=(byLabel[k]||0)+1; totalW++;
    cnt[a]=(cnt[a]||0)+1;
  }
  return origW(a,v,fl);
};
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===L.vec_spr_out){inPack=true;cnt={};}
  else if(inPack&&pc===L.vso_fix+3){
    inPack=false;
    const keys=Object.keys(cnt);
    if(keys.length>200){ packs++; totalUniq+=keys.length;
      for(const a of keys){const n=cnt[a];mult[n]=(mult[n]||0)+1;} }
  }
  return false;
};
for(let i=0;i<600;i++){v06c.oneInterrupt(true);if(i%60===0)place();}
v06c.check_breakpoint=()=>false;memory.write=origW;
if(!packs){console.log("ГЕЙТ ПРОВАЛЕН: рабочих пачек не собрано.");process.exit(2);}
const mtot=Object.values(mult).reduce((a,b)=>a+b,0);
const wsum=Object.entries(mult).reduce((s,[n,c])=>s+n*c,0);
console.log(`рабочих пачек ${packs} (>200 записей в видимую память)`);
console.log(`на пачку: записей в экран ${Math.round(totalW/packs)}, РАЗНЫХ байт ${Math.round(totalUniq/packs)}`);
console.log(`СРЕДНЯЯ КРАТНОСТЬ ЗАПИСИ: ${(wsum/mtot).toFixed(2)} раза на байт`);
console.log("  --- распределение «байт переписан N раз» ---");
Object.entries(mult).sort((a,b)=>a[0]-b[0]).forEach(([n,c])=>
  console.log(`     ${String(n).padStart(2)} раз(а): ${String(Math.round(c/packs)).padStart(5)} байт на пачку (${(100*c/mtot).toFixed(1)}%)`));
console.log("  --- кто пишет (байт на пачку) ---");
Object.entries(byLabel).sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([k,v])=>
  console.log(`     ${String(Math.round(v/packs)).padStart(5)}  ${k}`));
