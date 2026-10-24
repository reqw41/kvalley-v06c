// attrib_writers_census.js — ЗАДАЧА#47: КТО пишет таблицу атрибутов спрайтов
// (sprAttrib..sprAttrib+83 = 0xFD9B..0xFDEE, 21 слот x 4Б) во время игры.
// Динамическая перепись: хук на запись памяти, копим уникальные PC -> метка .sym.
// Сценарий: геймплей с движением, прыжками, ножом; плюс смерть от таймера не ждём.
// Запуск: node tools/verify/attrib_writers_census.js <rom> <sym> [кадров=3000]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||3000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu,key,memory}=E;
const LO=L.sprAttrib, HI=L.sprAttrib+84; // 21 слот
// метки по адресу
const labels=Object.entries(L).map(([n,a])=>[a,n]).filter(([a])=>a<0x10000).sort((x,y)=>x[0]-y[0]);
function lbl(pc){let lo=0,hi=labels.length-1,r=0;
  while(lo<=hi){const m=(lo+hi)>>1;if(labels[m][0]<=pc){r=m;lo=m+1;}else hi=m-1;}
  return labels[r][1]+"+0x"+(pc-labels[r][0]).toString(16);}
const hits=new Map(); // pc -> {count, sameval}
const oW=memory.write.bind(memory);
memory.write=function(addr,val){
  const a=addr&0xffff;
  if(a>=LO&&a<HI){
    const old=memory.bytes[memory.tobank(a)];
    const pc=cpu.instr_pc!==undefined?cpu.instr_pc:cpu.pc; // pc уже за инструкцией
    let h=hits.get(pc); if(!h){h={n:0,chg:0};hits.set(pc,h);}
    h.n++; if(old!==val)h.chg++;
  }
  oW(addr,val);
};
// геймплей: движение, прыжки, вверх/вниз (лестницы), бросок ножа (Z? пробел?)
const seq=[[39,40],[39,40],[38,20],[37,40],[37,40],[32,6],[40,20],[39,30],[38,10],[32,6]];
let f=0;
outer: for(let pass=0;pass<NF/200;pass++){
  for(const [k,n] of seq){
    for(let i=0;i<n;i++){key(k,1);v06c.oneInterrupt(true);key(k,0);if(++f>=NF)break outer;}
  }
}
console.log(`кадров=${f}, уникальных PC-писателей: ${hits.size}`);
const arr=[...hits.entries()].sort((a,b)=>b[1].n-a[1].n);
for(const [pc,h] of arr)
  console.log(`  pc=${pc.toString(16).padStart(4,"0")}  ${lbl(pc).padEnd(32)} записей=${h.n}  реально_меняли=${h.chg}`);
