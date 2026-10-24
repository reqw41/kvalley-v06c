// door_beam.js — ЦЕНА И СВОЕВРЕМЕННОСТЬ ПАЧКИ В КАДРАХ СО СТВОРКАМИ ВОРОТ.
//
// ЗАЧЕМ. beam_late считает только кадры геймплея (GameStatus=5), а ворота живут на входе
// в пирамиду (GameStatus=4, спуск героя по лестнице) и на выходе из неё. Мумии в эти
// моменты спрятаны (quitaMomias), поэтому кадр там ЛЕГЧЕ обычного — и мерить его надо
// ОТДЕЛЬНО: средние цифры геймплея про эти кадры ничего не говорят.
//
// ЧТО СЧИТАЕТ на кадрах, где хотя бы один слот 0-3 (створка) реально выводится:
//   * окно пачки vec_spr_out: такты входа и возврата от прерывания (p50/p90/max);
//   * состав пачки (объектов всего, из них створок);
//   * «ЗАКОНЧЕН ПОЗЖЕ ЛУЧА» на объект: последний байт лёг в fb после прохода луча над
//     ВЕРХНЕЙ строкой объекта (Ytop = 255-(lo0+15)); модель луча — как в beam_late;
//   * сколько кадров пачка не уложилась в кадр (59904 такта).
//
// Запуск: node tools/verify/door_beam.js [rom] [sym] [кадров]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const pos=process.argv.slice(2).filter(a=>/\.(rom|sym)$/.test(a));
const ROM=pos[0]||T+"/../../build/kvalley_8c.rom";
const SYM=pos[1]||ROM.replace(/\.rom$/,".sym");
const NF=+(process.argv.find(a=>/^\d+$/.test(a))||1000);
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu,run}=E;
const FR=59904;
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));
let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
const retOf=()=>memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);

let t0=0, packSP=-1, packRet=-1, packT0=0, showIdx=-1, showSP=-1, showRet=-1, showLo=0;
let cur=null; const done=[]; let packAbs=0, packCyc=0, packCnt=0;
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===L.vec_isr){ if(cur&&cur.door)done.push(cur); cur={n:0,door:0,t0:-1,t1:-1,objs:[]}; t0=TT; }
  if(!cur) return false;
  if(pc===L.vec_spr_out&&packSP<0){packSP=cpu.sp;packRet=retOf();packT0=TT-t0;packAbs=TT;cur.n=rd(L.vsp_n);}
  else if(packSP>=0&&pc===packRet&&cpu.sp>packSP){cur.t0=packT0;cur.t1=TT-t0;
    cur.cyc=(cur.cyc||0)+(TT-packAbs); packSP=-1;}
  if(pc===L.vec_spr_show&&showSP<0){
    showIdx=rd(L.vec_nsp_idx);showSP=cpu.sp;showRet=retOf();showLo=rd(0xE000+showIdx*256+0x98);
  } else if(showSP>=0&&pc===showRet&&cpu.sp>showSP){
    const ytop=255-((showLo+15)&255), beam=BEAM0+192*ytop, fin=TT-t0;
    cur.objs.push({idx:showIdx,late:fin>beam,dt:fin-beam});
    if(showIdx<4)cur.door++;
    showSP=-1;
  }
  return false;
};
run(NF);
if(cur&&cur.door)done.push(cur);
if(!done.length){console.log("кадров со створками не поймано");process.exit(1);}
const pct=(a,p)=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*p))];};
const t1=done.map(f=>f.t1).filter(x=>x>0);
const n =done.map(f=>f.n);
let objs=0, late=0, byslot={};
for(const f of done)for(const o of f.objs){objs++;if(o.late)late++;
  const k=o.idx<4?"створки 0-3":(o.idx<6?"герой 4-5":"прочее");
  byslot[k]=byslot[k]||{n:0,l:0}; byslot[k].n++; if(o.late)byslot[k].l++;}
console.log(`ROM: ${ROM}`);
console.log(`кадров со створками: ${done.length}`);
console.log(`объектов в пачке: p50 ${pct(n,0.5)}  max ${Math.max(...n)}`);
console.log(`конец пачки от IRQ: p50 ${pct(t1,0.5)}  p90 ${pct(t1,0.9)}  max ${Math.max(...t1)} тактов`
  +`  (кадр = ${FR})`);
console.log(`пачка НЕ уложилась в кадр: ${t1.filter(x=>x>FR).length} из ${t1.length}`);
console.log(`«позже луча»: ${late} из ${objs} объектов (${(100*late/objs).toFixed(1)}%)`);
for(const k of Object.keys(byslot))
  console.log(`   ${k}: ${byslot[k].l} из ${byslot[k].n} (${(100*byslot[k].l/byslot[k].n).toFixed(1)}%)`);
const cy=done.map(f=>f.cyc||0).filter(x=>x>0);
console.log(`ЧИСТАЯ РАБОТА ПАЧКИ в кадрах со створками: сумма ${cy.reduce((a,b)=>a+b,0)} тактов за ${cy.length} пачек, p50 ${pct(cy,0.5)}, max ${Math.max(...cy)}`);
if(process.argv.includes("-v"))for(const f of done) console.log(`   кадр: n=${f.n} t0=${f.t0} t1=${f.t1} `+f.objs.map(o=>`${o.idx}${o.late?"L":""}`).join(" "));
