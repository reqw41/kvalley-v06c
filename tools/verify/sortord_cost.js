// sortord_cost.js — ЗАДАЧА#46: цена сортировки порядка вывода (vso_sortord) и СОСТАВ
// списка вывода, отдельно на ФОРС-КАДРАХ (смена GameStatus / vfl_lastgs метит все 21
// слота, и в список вывода попадает всё подряд — включая давно скрытые объекты).
//
// ЧТО СЧИТАЕТ. Такты i8080 от входа в vso_sortord до его ret. Границы вызова ловятся по
// SP (вход = pc==vso_sortord, выход = SP поднялся выше входного), а САМИ ТАКТЫ копятся
// только по инструкциям в диапазоне [vso_setidx, vso_prev) и только пока SP не ушёл ниже
// входного на глубину вызова: сортировка зовёт vso_setidx/vso_lo (они лежат ВЫШЕ её тела
// в файле — диапазон «от vso_sortord» их бы потерял, а это ~40% тактов), а ВНУТРЬ неё
// может влезть ПРЕРЫВАНИЕ с целой пачкой вывода (тик идёт при EI). Без этих двух условий
// такты пачки приписывались бы сортировке: первый замер дал «n=4, 7060 т» при среднем
// 2591 — ровно вложенная пачка.
// Плюс на каждом вызове разбирает список vsp_list[0..vsp_n): для каждого слота берёт
// шапку (+0x00 valid) и запись вывода (+0x96 pending) и раскладывает по четырём классам:
//   вид   pending=1/3 (объект выводится),
//   скр+  pending=2 и слот ВАЛИДЕН   — его надо стереть пачкой и инвалидировать,
//   скр-  pending=2 и слот НЕВАЛИДЕН — стирать нечего, инвалидировать нечего,
//   проч  всё остальное (мусорный pending).
// Класс «скр-» и есть то, что задача#46 предлагает не класть в список вовсе.
//
// ПОКРЫТИЕ. Форс-кадр ловится по входу в петлю заливки vflf_fc. Прогон без единого
// форс-кадра НЕ ЗЕЛЁНЫЙ, а ПРОВАЛ ПОКРЫТИЯ: мерить пик было не на чем.
//
// Запуск: node tools/verify/sortord_cost.js [rom] [sym] [кадров=1500]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||1500);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu}=E;
const SORT=L.vso_sortord, FORCE=L.vflf_fc, R0=L.vso_setidx, R1=L.vso_prev;
if(!SORT||!FORCE||!R0||!R1){console.log("нет меток vso_sortord/vflf_fc/vso_setidx/vso_prev в .sym");process.exit(1);}

let calls=0,forceCalls=0,forceTick=false,nestSum=0,nestCalls=0;
let sum=0,max=0,maxN=0,maxFrame=-1;
let fSum=0,fMax=0,fMaxN=0;
const histN=new Map();            // n -> [вызовов, тактов]
let cV=0,cSp=0,cSm=0,cX=0;        // состав списка ВСЕГО
let fV=0,fSp=0,fSm=0,fX=0;        // состав списка на ФОРС-кадрах
let frameNo=0;
const samples=[];

function classify(force){
  const n=rd(L.vsp_n);
  let v=0,sp=0,sm=0,x=0;
  for(let i=0;i<n;i++){
    const idx=rd(L.vsp_list+i);
    if(idx>20){x++;continue;}
    const pg=0xE000+idx*256;
    const pend=rd(pg+0x96), valid=rd(pg+0x00);
    if(pend===1||pend===3)v++;
    else if(pend===2)(valid?sp++:sm++);
    else x++;
  }
  cV+=v;cSp+=sp;cSm+=sm;cX+=x;
  if(force){fV+=v;fSp+=sp;fSm+=sm;fX+=x;}
  return [n,v,sp,sm,x];
}

let inSort=false,entrySP=0,acc=0,curN=0,curForce=false,nested=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc; oI(); const vc=cpu.vcycles|0;
  if(pc===FORCE)forceTick=true;
  if(inSort){
    if(pc>=R0&&pc<R1&&cpu.sp>=entrySP-4)acc+=vc; else nested+=vc;
    if(cpu.sp>entrySP){                       // ret отработал — вызов закончился
      inSort=false;calls++;sum+=acc;
      const h=histN.get(curN)||[0,0];h[0]++;h[1]+=acc;histN.set(curN,h);
      if(acc>max){max=acc;maxN=curN;maxFrame=frameNo;}
      if(curForce){forceCalls++;fSum+=acc;if(acc>fMax){fMax=acc;fMaxN=curN;}}
      nestSum+=nested;if(nested)nestCalls++;
      if(curForce&&samples.length<8)samples.push(`   форс-кадр ${frameNo}: n=${curN} ${acc} т`);
    }
    return false;
  }
  if(pc===SORT){
    inSort=true;entrySP=cpu.sp;acc=vc;curForce=forceTick;forceTick=false;nested=0;
    const c=classify(curForce);curN=c[0];
  }
  return false;
};

// СТИМУЛ — тот же, что у spr_resid_gate: псевдослучайная прогулка + чит N (клавиша 78)
// раз в 350 кадров, иначе смены сцены (а с ней форс-кадра) в прогоне не будет вовсе.
let seed=987654321; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(frameNo=0;frameNo<NF;frameNo++){
  if(frameNo%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(frameNo>0&&frameNo%350===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  v06c.oneInterrupt(true);
}
if(held>0)E.key(held,0);

console.log(`ROM=${ROM.split("/").pop()} кадров=${NF} вызовов vso_sortord=${calls} (из них форс-кадров ${forceCalls})`);
console.log(`ВСЕ вызовы:  avg ${(sum/Math.max(1,calls)).toFixed(1)} т, МАКС ${max} т (n=${maxN}, кадр ${maxFrame}), сумма ${sum}`);
console.log(`ФОРС-кадры:  avg ${(fSum/Math.max(1,forceCalls)).toFixed(1)} т, МАКС ${fMax} т (n=${fMaxN})`);
console.log(`ОБЫЧНЫЕ:     avg ${((sum-fSum)/Math.max(1,calls-forceCalls)).toFixed(1)} т`);
console.log(`вложенных тактов ОТБРОШЕНО (прерывание/пачка внутри сортировки): ${nestSum} в ${nestCalls} вызовах`);
console.log(`состав списка ВСЕГО: видимых ${cV}, скрытых с ВАЛИДНЫМ слотом ${cSp}, скрытых с НЕВАЛИДНЫМ ${cSm}, прочих ${cX}`);
console.log(`состав на ФОРС-кадрах: видимых ${fV}, скрытых+валидных ${fSp}, скрытых-невалидных ${fSm}, прочих ${fX}`);
console.log("распределение n (вызовов / тактов всего / т на вызов):");
for(const n of [...histN.keys()].sort((a,b)=>a-b)){const h=histN.get(n);
  console.log(`   n=${String(n).padStart(2)}  ${String(h[0]).padStart(6)}  ${String(h[1]).padStart(9)}  ${(h[1]/h[0]).toFixed(0).padStart(7)}`);}
for(const s of samples)console.log(s);

// --- ДЕКЛАРАЦИИ ПОКРЫТИЯ ---------------------------------------------------------------
const COVER=[
  ["вызовов vso_sortord",            calls,      1],
  ["ФОРС-кадров в замере",           forceCalls, 1],
  ["вызовов с n>=8 (длинный список)",[...histN.entries()].filter(([n])=>n>=8).reduce((s,[,h])=>s+h[0],0), 0],
];
let bad=0;
console.log("--- покрытие ---");
for(const [name,got,min] of COVER){
  const ok=got>=min; if(!ok)bad++;
  console.log(`  ${ok?"ok  ":"ПУСТО"} ${name}: ${got} (минимум ${min})`);
}
console.log(bad?"ПРОВАЛ ПОКРЫТИЯ":"ПОКРЫТИЕ OK");
process.exit(bad?1:0);
