// beam_ops2.js — профиль ПАЧКИ ВЫВОДА по меткам (какая процедура сколько тактов).
// Считает такты только внутри vec_spr_out (по флагу «мы в пачке»), группируя по
// ближайшей метке <= pc. Отдельно — только по «длинным» кадрам (пачка >= 25000 тактов).
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||4000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;
// таблица меток, отсортированная
// ЗАДАЧА#37: граница кода — из .sym (GameStatus = первая игровая переменная), а не
// зашитые 0x7000: код рос, база переменных переезжала (0x6B00 -> 0x6C00 -> 0x7092), и с
// константой 0x7000 метки выше неё выпадали из профиля молча.
const CODE_END=L.romCeil||L.GameStatus;
if(!CODE_END){console.log("в .sym нет romCeil/GameStatus — границу кода взять неоткуда");process.exit(2);}
const labs=Object.keys(L).map(k=>[k,L[k]]).filter(a=>a[1]>=0&&a[1]<CODE_END).sort((a,b)=>a[1]-b[1]);
const at=new Array(CODE_END).fill(null);
for(let i=0;i<labs.length;i++){const e=(i+1<labs.length?labs[i+1][1]:CODE_END);
  for(let p=labs[i][1];p<e;p++)at[p]=labs[i][0];}
const OUT=L.vec_spr_out;
let TT=0,inb=false,bsp=-1,bret=-1,bs=0;
const acc={},accL={};let nb=0,nl=0,curAcc=null;
const oI=cpu.instruction.bind(cpu);
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
const bat=[];
cpu.instruction=function(){const pc=cpu.pc;const c0=TT;oI();const d=cpu.vcycles|0;TT+=d;
  if(inb){const k=at[pc]||("?"+pc.toString(16));acc[k]=(acc[k]||0)+d;if(curAcc)curAcc[k]=(curAcc[k]||0)+d;}};
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===OUT&&!inb){inb=true;bsp=cpu.sp;bret=retOf();bs=TT;curAcc={};}
  else if(inb&&pc===bret&&cpu.sp>bsp){inb=false;bat.push({d:TT-bs,a:curAcc});curAcc=null;}
  return false;};
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  v06c.oneInterrupt(true);
}
function rep(name,sel){
  const g=bat.filter(sel);if(!g.length)return;
  const a={};let tot=0;
  for(const b of g){for(const k in b.a){a[k]=(a[k]||0)+b.a[k];tot+=b.a[k];}}
  console.log(`\n=== ${name}: пачек ${g.length}, средняя ${(tot/g.length).toFixed(0)} тактов ===`);
  Object.keys(a).map(k=>[k,a[k]/g.length]).sort((x,y)=>y[1]-x[1]).slice(0,22)
    .forEach(r=>console.log(`   ${r[1].toFixed(0).padStart(7)}  ${r[0]}`));
}
rep("ВСЕ ПАЧКИ",()=>true);
rep("ДЛИННЫЕ (>=25000)",b=>b.d>=25000);
