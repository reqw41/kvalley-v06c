// spr_same_footprint.js — применимость СЛИТОГО пути «фон-из-слота OR спрайт одной записью».
// Слитый путь возможен, когда фон под объектом УЖЕ лежит в его слоте, то есть когда
// габарит (hi0, lo0, ncols, hi0b, hi0c) НЕ ИЗМЕНИЛСЯ с прошлого кадра и слот валиден:
// тогда ни стирать, ни сохранять фон не нужно — достаточно один раз записать композит.
// Считает на входе в пачку (до прохода стирания): доля таких объектов, доля пачек, где
// ТАКИЕ ВСЕ, а также сколько объектов в пачке пересекаются по вертикали (кандидаты в
// группу, которую надо композитить вместе).
// Запуск: node tools/verify/spr_same_footprint.js <rom> <sym> [тиков=2600]
"use strict";
const {make}=require("./beam_harness.js");
const ROM=process.argv[2],SYM=process.argv[3],NT=+(process.argv[4]||2600);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu}=E;
// БЫЛО зашито 0x6C03 (эра 0x6C00) — теперь адрес переменной timer берём из .sym по имени.
if(!L.timer){console.log("нет символа timer в .sym");process.exit(2);}
const TIMER=L.timer,OUT=L.vec_spr_out;
let nObj=0,nSame=0,nBatch=0,nAllSame=0,nDirty=0;
const bySlot={},reason={};
let pairs=0,batchesWithPair=0,nFast=0,nShift=0,nPair=0,nObjOk=0;
v06c.check_breakpoint=function(){
  if(cpu.pc!==OUT)return false;
  if(rd(L.GameStatus)!==5)return false;
  const n=rd(L.vsp_n);if(!n)return false;
  nBatch++;
  if(rd(L.vsp_fast))nFast++;   // ГРУНТ-ПРАВДА: решение vsp_fastmark на эту пачку
  let all=true,allNew=true;const los=[],geo=[];
  for(let k=0;k<n;k++){
    const idx=rd(L.vsp_list+k),pg=0xE000+idx*256;
    const pend=rd(pg+0x96);
    if(pend!==1){all=false;allNew=false;reason.hidden=(reason.hidden||0)+1;continue;}
    nObj++;
    los.push([rd(pg+0x98),rd(pg+2),rd(pg)]);
    const valid=rd(pg)===1;
    const same=valid&&rd(pg+1)===rd(pg+0x97)&&rd(pg+2)===rd(pg+0x98)&&
               rd(pg+3)===rd(pg+0x99)&&rd(pg+4)===rd(pg+0x9A)&&rd(pg+5)===rd(pg+0x9B);
    // ЗАДАЧА#37 ШАГ 4: слитая запись умеет СДВИГ ПО ВЕРТИКАЛИ (vsm_shift) — lo0 может
    // отличаться на |d| <= 15. Остальное (плоскость, столбец, ширина) обязано совпасть.
    const d=rd(pg+0x98)-rd(pg+2);
    // ШАГ C (2026-08-03): плоскостей может быть НЕСКОЛЬКО. Условие годности — сейв
    // покрывает РОВНО те плоскости, в которые пишем (+4 == +0x9F, +5 == +0x9B), и
    // выключен непрозрачный герой (его гашение силуэтом СОСЕДА умеет только vec_spr_show).
    const okNew=valid&&rd(pg+1)===rd(pg+0x97)&&rd(pg+3)===rd(pg+0x99)&&
               rd(pg+4)===rd(pg+0x9F)&&rd(pg+5)===rd(pg+0x9B)&&!rd(L.vop_i1)&&Math.abs(d)<16;
    if(okNew){nObjOk++;if(d)nShift++;}else allNew=false;
    if(rd(L.vfl_dirty+idx))nDirty++;
    if(same){nSame++;bySlot[idx]=bySlot[idx]||[0,0];bySlot[idx][0]++;}
    else{all=false;bySlot[idx]=bySlot[idx]||[0,0];bySlot[idx][1]++;}
    if(!okNew){
      if(!valid)reason.invalid=(reason.invalid||0)+1;
      else if(rd(pg+1)!==rd(pg+0x97))reason.hi0=(reason.hi0||0)+1;
      else if(rd(pg+3)!==rd(pg+0x99))reason.ncols=(reason.ncols||0)+1;
      else if(Math.abs(d)>=16)reason.far=(reason.far||0)+1;
      else if(rd(L.vop_i1))reason.vop=(reason.vop||0)+1;
      else reason.planes=(reason.planes||0)+1;}
  }
  if(all)nAllSame++;
  if(allNew&&!rd(L.vsp_fast))nPair++;   // все годны по одиночке, срезала попарная проверка
  let p=0;
  for(let i=0;i<los.length;i++)for(let j=i+1;j<los.length;j++){
    const ai=Math.min(los[i][0],los[i][1]),bi=Math.max(los[i][0],los[i][1]);
    const aj=Math.min(los[j][0],los[j][1]),bj=Math.max(los[j][0],los[j][1]);
    if(ai-15<=bj&&aj-15<=bi)p++;
  }
  pairs+=p;if(p)batchesWithPair++;
  return false;};
function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);}
  else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);}
  else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);}
  else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);}
  else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);}
  return k;}
let held=new Set(),tick=0,prevT=0,nf=0;
while(tick<=NT&&nf<400000){
  const want=new Set(keysFor(tick));
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  v06c.oneInterrupt(true);nf++;
  const t=rd(TIMER);if(t!==prevT){prevT=t;tick++;}
}
console.log(`ROM=${ROM.split("/").pop()} пачек ${nBatch}, объектов ${nObj}`);
console.log(`ГАБАРИТ НЕ ИЗМЕНИЛСЯ ВОВСЕ: ${nSame} / ${nObj} = ${(100*nSame/nObj).toFixed(1)}%`);
console.log(`ПАЧЕК, ГДЕ ВСЕ ОБЪЕКТЫ ТАКИЕ: ${nAllSame} / ${nBatch} = ${(100*nAllSame/nBatch).toFixed(1)}%`);
console.log(`ГОДЕН СЛИТОЙ ЗАПИСИ (совпал или УЕХАЛ ПО ВЕРТИКАЛИ, шаг 4): ${nObjOk} / ${nObj} = ${(100*nObjOk/nObj).toFixed(1)}% (из них со сдвигом ${nShift})`);
console.log(`ПАЧЕК ВЫВЕДЕНО СЛИТОЙ ЗАПИСЬЮ (vsp_fast): ${nFast} / ${nBatch} = ${(100*nFast/nBatch).toFixed(1)}%`);
console.log(`   из отвергнутых: ${nPair} пачек срезала ПОПАРНАЯ проверка (по одиночке годны все)`);
console.log(`почему объект НЕ годен: ${JSON.stringify(reason)}`);
console.log(`фон протух (vfl_dirty взведён): ${nDirty} объектов`);
console.log(`ПЕРЕСЕЧЕНИЯ по вертикали (старый∪новый габарит): ${pairs} пар, в ${batchesWithPair} пачках (${(100*batchesWithPair/nBatch).toFixed(1)}%)`);
console.log(`по слотам (совпал/не совпал): ${Object.keys(bySlot).map(Number).sort((a,b)=>a-b).map(i=>`${i}:${bySlot[i][0]}/${bySlot[i][1]}`).join(" ")}`);
