// geo_why.js — ЧТО ИМЕННО отвергает vfm_geo (задача #53, покинутые столбцы).
// fast_why показывает лишь «ret c из прохода 1» одной строкой; здесь тот же прогон
// разложен по КОНКРЕТНОМУ `jp ... vfg_bad`: адрес предыдущей команды однозначно
// указывает на проваленное условие (плоскость / dc / вложенность / |d|>=16).
// Запуск: node tools/debug/geo_why.js [rom] [sym] [кадров=3000]
"use strict";
const {make}=require("../verify/beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||3000);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu}=E;
const lst=(()=>{const fs=require("fs");const f=T+"/../../build/kvalley_8c.lst";const map={};
  if(!fs.existsSync(f))return map;
  for(const line of fs.readFileSync(f,"latin1").split("\n")){
    const m=line.match(/^\s*\d+\+?\s+([0-9A-Fa-f]{4})\s+[0-9A-Fa-f]{2}/);
    if(m){const a=parseInt(m[1],16);if(!(a in map))map[a]=line.replace(/\s+$/,"");}}
  return map;})();
const why={};let prev=-1,geo=0,ok=0;
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(rd(L.GameStatus)===5){
    if(pc===L.vfm_geo)geo++;
    if(pc===L.vfg_bad){const k=`0x${prev.toString(16)}`;
      (why[k]=why[k]||{n:0,src:lst[prev]||"(нет)"}).n++;}
  }
  prev=pc;return false;};
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);
                      E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
for(let f=0;f<NF;f++){const ph=f%200;
  if(ph<100){E.key(39,1);E.key(37,0);}else{E.key(39,0);E.key(37,1);}
  v06c.oneInterrupt(true);}
let bad=0;for(const k in why)bad+=why[k].n;
console.log(`vfm_geo вызван ${geo} раз, отвергнуто ${bad} (${(100*bad/geo).toFixed(1)}%)`);
for(const [a,v] of Object.entries(why).sort((x,y)=>y[1].n-x[1].n))
  console.log(`   ${String(v.n).padStart(5)}  ${a}  ${v.src.trim().slice(0,95)}`);
