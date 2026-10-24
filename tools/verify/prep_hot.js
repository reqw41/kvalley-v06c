// prep_hot.js — КУДА УХОДИТ ПОДГОТОВКА СПРАЙТОВ (задача #53).
// Замер prep_clean: подготовка ОДНОГО объекта стоит ~17 тыс. тактов при кадре 59904,
// хотя её результат — 48 байт сдвинутого спрайта. Здесь разбор этих тактов по меткам
// .sym: гистограмма циклов внутри vec_nat_sprites, вложенные прерывания ВЫЧТЕНЫ
// (иначе в профиль попадут звук и пачка вывода соседнего кадра).
// Запуск: node tools/verify/prep_hot.js [rom] [sym] [кадров=2500]
"use strict";
const fs=require("fs");
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||2500);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu}=E;

// таблица (адрес, метка), отсортированная — бакет = ближайшая метка <= PC
const labs=[];
for(const line of fs.readFileSync(SYM,"latin1").split("\n")){
  const m=line.match(/^([0-9A-Fa-f]{4,8})\s+(\S+)/)||line.match(/^(\S+):?\s+equ\s+\$?([0-9A-Fa-f]+)/i);
  if(!m)continue;
  let a,n;
  if(/^[0-9A-Fa-f]{4,8}$/.test(m[1])){a=parseInt(m[1],16);n=m[2];}else{n=m[1];a=parseInt(m[2],16);}
  if(a>=0x0100&&a<0x8000)labs.push([a,n]);
}
labs.sort((x,y)=>x[0]-y[0]);
const addrs=labs.map(x=>x[0]);
function bucket(pc){let lo=0,hi=addrs.length-1,r=-1;
  while(lo<=hi){const m=(lo+hi)>>1;if(addrs[m]<=pc){r=m;lo=m+1;}else hi=m-1;}
  return r<0?"<?>":labs[r][1];}

const NAT=L.vec_nat_sprites,PREP=L.vec_spr_prep,ISR=L.vec_isr;
if(NAT===undefined||PREP===undefined){console.log("нет vec_nat_sprites/vec_spr_prep в .sym");process.exit(2);}
let TT=0;
const hist={};let inPrep=false,natT=0,natIsr=0,isrSp=-1,isrT0=0,nObj=0;
let pRet=-1,pSp=-1,samples=0,objTotal=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc;
  oI();
  const c=cpu.vcycles|0;TT+=c;
  if(inPrep&&isrSp<0){const b=bucket(pc);hist[b]=(hist[b]||0)+c;}
};
const retOf=()=>E.memory.read(cpu.sp,false)|(E.memory.read(cpu.sp+1,false)<<8);
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&inPrep&&isrSp<0){isrSp=cpu.sp;isrT0=TT;}
  else if(isrSp>=0&&cpu.sp>isrSp){natIsr+=TT-isrT0;isrSp=-1;}
  if(pc===NAT&&pRet<0){pSp=cpu.sp;pRet=retOf();inPrep=true;natT=TT;natIsr=0;nObj=0;}
  else if(pRet>=0&&pc===pRet&&cpu.sp>pSp){pRet=-1;inPrep=false;
    if(rd(L.GameStatus)===5){samples++;objTotal+=nObj;}}
  if(inPrep&&pc===PREP)nObj++;
  return false;};

for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);
                      E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
for(let f=0;f<NF;f++){const ph=f%200;
  if(ph<100){E.key(39,1);E.key(37,0);}else{E.key(39,0);E.key(37,1);}
  v06c.oneInterrupt(true);}

const rows=Object.entries(hist).sort((a,b)=>b[1]-a[1]);
const total=rows.reduce((s,r)=>s+r[1],0);
console.log(`подготовок ${samples}, объектов ${objTotal} (${(objTotal/samples).toFixed(2)} на тик)`);
console.log(`ВСЕГО тактов подготовки ${total} = ${Math.round(total/samples)} на тик, ${Math.round(total/(objTotal||1))} на объект\n`);
// Сводка по СЕМЕЙСТВАМ меток (префикс до первого подчёркивания): внутри подготовки
// каждая процедура держит десяток локальных меток, и построчный список их размазывает.
const fam={};
for(const [n,c] of rows){const k=(n.match(/^([a-z0-9]+)_/)||[null,n])[1];fam[k]=(fam[k]||0)+c;}
console.log("семейство                   тактов    доля   на объект   на тик");
for(const [n,c] of Object.entries(fam).sort((a,b)=>b[1]-a[1]).slice(0,14))
  console.log(`  ${n.padEnd(24)} ${String(c).padStart(9)} ${(100*c/total).toFixed(1).padStart(6)}% ${String(Math.round(c/(objTotal||1))).padStart(8)} ${String(Math.round(c/samples)).padStart(8)}`);
console.log("");
console.log("метка                       тактов    доля   на объект");
for(const [n,c] of rows.slice(0,28))
  console.log(`  ${n.padEnd(24)} ${String(c).padStart(9)} ${(100*c/total).toFixed(1).padStart(6)}% ${String(Math.round(c/(objTotal||1))).padStart(8)}`);
