// itmgate_ext_census.js — СТОИТ ЛИ РАСШИРЯТЬ itmGate НА chkTocaMomia / chkCogeKnife (2026-08-04).
// Меряет по ИГРОВЫМ ТИКАМ (GS=5):
//   * такты внутри chkTocaMomia и chkCogeKnife (вход -> возврат по адресу возврата);
//   * долю тиков, где гейт МОГ БЫ сработать:
//       мумии: ключ героя (ProtaY..ProtaRoom + protaStatus) И весь momiaDat (84 Б)
//              не изменились с прошлого тика;
//       нож:   ключ героя (ProtaY..ProtaRoom) не изменился И статусы ножей
//              (knifesData, шаг 17, байт +0) не менялись;
//   * такты этих же процедур В ТИКАХ, ГДЕ ГЕЙТ БЫ СРАБОТАЛ (это и есть верхняя граница
//     экономии: гейт снимает только их, а в остальных тиках добавляет свою цену).
// Запуск: node tools/verify/itmgate_ext_census.js [rom] [sym] [кадров=8000]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom",
      SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||8000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu,memory}=E;
let TT=0;const oI=cpu.instruction.bind(cpu);cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
const MOM=L.chkTocaMomia,KNF=L.chkCogeKnife,TICK=L.H_TIMI;
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
const B={mom:{pc:MOM},knf:{pc:KNF}};for(const k in B){B[k].ret=-1;B[k].sp=-1;B[k].t0=0;}
// счётчики текущего тика
let cur=null;const ticks=[];
function heroKey(){return [rd(L.ProtaY),rd(L.ProtaY+1),rd(L.ProtaY+2),rd(L.ProtaY+3)].join(",");}
function momKey(){let s=rd(L.protaStatus)+"|";const n=rd(L.numMomias);
  for(let i=0;i<84;i++)s+=rd(L.momiaDat+i)+","; return n+"|"+s;}
function knfKey(){let s="";const n=rd(L.numKnifes);
  for(let i=0;i<4;i++)s+=rd(L.knifesData+i*17)+","; return n+"|"+s;}
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===TICK){
    if(cur)ticks.push(cur);
    cur=(rd(L.GameStatus)===5)?{mom:0,knf:0,hk:heroKey(),mk:momKey(),kk:knfKey()}:null;}
  if(!cur)return false;
  for(const k in B){const b=B[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();b.t0=TT;}
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){cur[k]+=TT-b.t0;b.ret=-1;}}
  return false;};
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  v06c.oneInterrupt(true);
}
if(held>0)E.key(held,0);
if(cur)ticks.push(cur);
// сравнение ключей С ПРОШЛЫМ тиком
let n=0,momT=0,knfT=0,momGate=0,knfGate=0,momGateT=0,knfGateT=0;
let ph=null,pm=null,pk=null;
for(const t of ticks){
  n++;momT+=t.mom;knfT+=t.knf;
  const hSame=ph!==null&&t.hk===ph,mSame=pm!==null&&t.mk===pm,kSame=pk!==null&&t.kk===pk;
  if(hSame&&mSame){momGate++;momGateT+=t.mom;}
  if(hSame&&kSame){knfGate++;knfGateT+=t.knf;}
  ph=t.hk;pm=t.mk;pk=t.kk;
}
const f1=x=>(x/Math.max(1,n)).toFixed(1),pc=x=>(100*x/Math.max(1,n)).toFixed(1);
console.log(`игровых тиков ${n}`);
console.log(`chkTocaMomia: тактов/тик ${f1(momT)}; гейт сработал бы в ${pc(momGate)}% тиков, снимая ${f1(momGateT)} т/тик`);
console.log(`chkCogeKnife: тактов/тик ${f1(knfT)}; гейт сработал бы в ${pc(knfGate)}% тиков, снимая ${f1(knfGateT)} т/тик`);
