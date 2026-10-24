// logic_hot.js — ПРОФИЛЬ ИГРОВОЙ ЛОГИКИ (задача #53).
// Тик H_TIMI = логика игры + подготовка спрайтов (vec_nat_sprites). Подготовку уже
// разобрал prep_hot; здесь — ВСЁ ОСТАЛЬНОЕ, то есть сам tickMain: движение героя, ИИ
// мумий, ножи, HUD, звук. Замер: логика ~26.6 тыс. тактов на тик при кадре 59904, и её
// ещё ни разу не оптимизировали, поэтому это единственный неразобранный крупный кусок.
// Такты внутри vec_nat_sprites и внутри вложенных прерываний ВЫЧТЕНЫ.
// Запуск: node tools/verify/logic_hot.js [rom] [sym] [кадров=2500]
"use strict";
const fs=require("fs");
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||2500);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu,memory}=E;
const labs=[];
for(const line of fs.readFileSync(SYM,"latin1").split("\n")){
  const m=line.match(/^(\S+):?\s+equ\s+0*([0-9A-Fa-f]+)h/i);
  if(!m)continue;
  const a=parseInt(m[2],16);
  if(a>=0x0100&&a<0x8000)labs.push([a,m[1]]);
}
labs.sort((x,y)=>x[0]-y[0]);
const addrs=labs.map(x=>x[0]);
function bucket(pc){let lo=0,hi=addrs.length-1,r=-1;
  while(lo<=hi){const m=(lo+hi)>>1;if(addrs[m]<=pc){r=m;lo=m+1;}else hi=m-1;}
  return r<0?"<?>":labs[r][1];}
const TIMI=L.H_TIMI,NAT=L.vec_nat_sprites,ISR=L.vec_isr;
if(TIMI===undefined||NAT===undefined){console.log("нет H_TIMI/vec_nat_sprites в .sym");process.exit(2);}
let TT=0;
const hist={};
let inTick=false,inNat=false,inIsr=false,live=false;
let tRet=-1,tSp=-1,nRet=-1,nSp=-1,isrSp=-1;
let ticks=0,tickT=0,tick0=0,natT=0,isrT=0,nat0=0,isr0=0;
const lens=[];
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc;
  oI();
  const c=cpu.vcycles|0;TT+=c;
  // ТОЛЬКО ГЕЙМПЛЕЙ. Без этого гейта в профиль попадали кадры постройки сцены и шторки
  // (vfx_loop, hsClrSU, drawCortinilla2) — они длиннее обычного тика и давали статьи по
  // 15 тыс. тактов «на тик», больше самого тика.
  if(inTick&&live&&!inNat&&!inIsr){const b=bucket(pc);hist[b]=(hist[b]||0)+c;}
};
const retOf=()=>memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(inTick&&pc===ISR&&!inIsr){inIsr=true;isrSp=cpu.sp;isr0=TT;}
  else if(inIsr&&cpu.sp>isrSp){inIsr=false;isrT+=TT-isr0;}
  if(inTick&&pc===NAT&&nRet<0){nSp=cpu.sp;nRet=retOf();inNat=true;nat0=TT;}
  else if(nRet>=0&&pc===nRet&&cpu.sp>nSp){nRet=-1;inNat=false;natT+=TT-nat0;}
  if(pc===TIMI&&tRet<0){tSp=cpu.sp;tRet=retOf();inTick=true;live=(rd(L.GameStatus)===5);tick0=TT;natT=0;isrT=0;}
  else if(tRet>=0&&pc===tRet&&cpu.sp>tSp){tRet=-1;inTick=false;
    if(rd(L.GameStatus)===5){ticks++;const pure=TT-tick0-natT-isrT;tickT+=pure;lens.push(pure);}}
  return false;};
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);
                      E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
for(let f=0;f<NF;f++){const ph=f%200;
  if(ph<100){E.key(39,1);E.key(37,0);}else{E.key(39,0);E.key(37,1);}
  v06c.oneInterrupt(true);}
if(!ticks){console.log("ПРОВАЛ ПОКРЫТИЯ: тик ни разу не отработал в геймплее");process.exit(1);}
lens.sort((a,b)=>a-b);
console.log(`ROM=${ROM.split("/").pop()}  тиков геймплея ${ticks}`);
console.log(`ЛОГИКА БЕЗ ПОДГОТОВКИ: avg ${Math.round(tickT/ticks)} тактов, p50 ${lens[lens.length>>1]}, p90 ${lens[Math.floor(lens.length*0.9)]}, max ${lens[lens.length-1]} (кадр 59904)\n`);
const rows=Object.entries(hist).sort((a,b)=>b[1]-a[1]);
const total=rows.reduce((s,r)=>s+r[1],0);
console.log("метка                        тактов    доля   на тик");
for(const [n,c] of rows.slice(0,24))
  console.log(`  ${n.padEnd(25)} ${String(c).padStart(9)} ${(100*c/total).toFixed(1).padStart(6)}% ${String(Math.round(c/ticks)).padStart(7)}`);
