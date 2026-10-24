// stack_blit_zero_gate.js — ЧЕСТНОСТЬ ГЛАВНОГО ИНВАРИАНТА СТЕК-БЛИТА (задача#53).
//
// УТВЕРЖДЕНИЕ ПРАВКИ: стек-блит (vpz_wr/vpz_col/vpz_bh, vec_sprout.asm) кладёт в fb ОДИН
// ЛИШЬ СПРАЙТ, без чтения слота, и годен ТОЛЬКО когда фон под габаритом нулевой
// («фон OR спрайт» = спрайт). Гейт стоит на входе в vpz_wr и проверяет ровно это:
// БЛОК ФОНА В СЛОТЕ (+6, 16*ncols байт) обязан быть нулевым — у обеих половин пары.
// Ненулевой байт означает, что стек-блит затрёт чужие пиксели (HUD, лабиринт), а
// последующий restore вернёт вместо них содержимое слота => мусор на экране.
//
// ПОЧЕМУ НЕ «БАЙТ FB ДО ЗАПИСИ РАВЕН НУЛЮ» (первая, НЕВЕРНАЯ редакция гейта): слитая
// запись кладёт композит «фон слота OR спрайт» ЗА ОДИН ПРОХОД, отдельного стирания
// перед ней нет, поэтому байт fb до записи — это ПРОШЛЫЙ КАДР и он законно ненулевой.
// Та редакция краснела на 52.9% записей исправного кода.
//
// ЗАМЕР 2026-08-07 (ROM d7d25aeb): прогулка по пирамидам, 927 кадров, 19136 байт записи
// стек-блитом — НОЛЬ нарушений. На верхней площадке пирамиды 1 стек-блит почти не
// работает (3 входа в vpz_wr на 879 кадров): фон там ненулевой (текст HUD в p0/p1 и
// кирпичи пола), гейт vpz_ok честно уводит пару на запасной путь vpr_wr/vsb_mcol.
//
// Запуск: node tools/verify/stack_blit_zero_gate.js [rom] [sym] [тиков] [--top] [--row N]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
let ROM=null,SYM=null,NT=null;
for(const a of process.argv.slice(2)){
  if(/^--/.test(a))continue;
  if(/\.sym$/i.test(a)){SYM=a;continue;}
  if(/\.rom$/i.test(a)){ROM=a;continue;}
  if(/^\d+$/.test(a)){NT=+a;continue;}}
ROM=ROM||T+"/../../build/kvalley_8c.rom";
SYM=SYM||T+"/../../build/kvalley_8c.sym";
NT=NT===null?600:NT;
const TOP=process.argv.indexOf("--top")>0;   // стенд «прыжки на верхней площадке»
const ROW=(()=>{const i=process.argv.indexOf("--row");return i>0?+process.argv[i+1]:8;})();

const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
//  ГРАНИЦЫ ЯДЕР ЗАМЕЩАЮЩЕЙ ЗАПИСИ — только для печати в шапке отчёта (сам инвариант
//  проверяется на входе в vpz_wr). До стек-блита то же делало ядро vsz_mcol задачи#49.
const RANGES=[];
if(L.vpz_col!==undefined&&L.vpz_ce!==undefined)RANGES.push(["стек-блит vpz_*",L.vpz_col,L.vpz_ce]);
if(L.vsz_mcol!==undefined)RANGES.push(["vsz_mcol (задача#49)",L.vsz_mcol,L.vsz_merge!==undefined?L.vsz_merge:L.vsz_mcol+80]);
if(!RANGES.length){console.log("нет ни vpz_col, ни vsz_mcol — нечего проверять");process.exit(2);}
const inCore=pc=>{for(const r of RANGES)if(pc>=r[1]&&pc<r[2])return r[0];return null;};

let writes=0, bad=0, blocks=0, badBlocks=0;
const badBy={}, badAddr={};
//  ИНВАРИАНТ ПРОВЕРЯЕТСЯ НА БЛОКЕ ФОНА В СЛОТЕ, А НЕ НА FB. Слитая запись кладёт в fb
//  композит «фон слота OR спрайт» ЗА ОДИН ПРОХОД, поэтому байт fb ДО записи — это кадр
//  ПРОШЛОГО кадра, и он законно ненулевой. Стек-блит пишет ОДИН ЛИШЬ СПРАЙТ, значит
//  обязан быть нулевым БЛОК ФОНА В СЛОТЕ (+6, 16*ncols байт) — тот самый, который путь
//  vpr_wr/vsb_mcol сюда бы подмешал через OR.
const ENTRY=L.vpz_wr, JB=L.vpz_jb, PA=L.vpz_pa, PB=L.vpz_pb, NC=L.vsb_nc, BH=L.vpz_bh;
function checkBlock(page,tag){
  const nc=rd(NC); if(!nc)return;
  blocks++;
  let nz=0, first=-1;
  for(let i=0;i<16*nc;i++){const b=rd(page*256+6+i); if(b){nz++;if(first<0)first=i;}}
  writes+=16*nc;
  if(nz){bad+=nz;badBlocks++;
    const lo0=rd(page*256+2);
    const k=tag+" lo0="+lo0;badBy[k]=(badBy[k]||0)+1;
    badAddr[page]=(badAddr[page]||0)+1;}
}
v06c.check_breakpoint=function(){
  if(cpu.pc===ENTRY){
    const pa=rd(PA+1);
    const pair=(rd(JB+1)|(rd(JB+2)<<8))===BH;
    checkBlock(pa,"A"+(pair?" (пара)":" (одиночка)"));
    if(pair)checkBlock(rd(PB+1),"B (пара)");
  }
  return false;};
const runf=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
let ymin=999,ymax=-999,inHud=0,outs=0;
if(TOP){
  runf(700);
  for(let i=0;i<30;i++){E.key(32,1);runf(3);E.key(32,0);runf(3);}
  if(rd(L.piramideActual)!==1){console.log(`ПРОВАЛ ПОКРЫТИЯ: piramideActual=${rd(L.piramideActual)}`);process.exit(1);}
  for(let i=0;i<800&&rd(L.GameStatus)!==5;i++)v06c.oneInterrupt(true);
  if(rd(L.GameStatus)!==5){console.log("ПРОВАЛ ПОКРЫТИЯ: до геймплея не дошли");process.exit(1);}
  wr(L.ProtaY,ROW); runf(10);
}else{
  if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
}
const TIMER=L.timer, ATTR=L.sprAttrib;
let held=new Set(), tick=0, prevT=0, nf=0, framesLive=0;
while(tick<=NT&&nf<300000){
  if(TOP){const y=rd(L.enemyAttrib);
    if(y<0xD0){wr(L.enemyAttrib,ROW);wr(L.enemyAttrib+1,(rd(L.ProtaX)+6)&255);}}
  const want=new Set();
  if(TOP){ if(tick%20<3)want.add(32); want.add((tick%120)<60?39:37); }
  else { if(tick%350===0&&tick)want.add(78);
    else if((tick%140)<20)want.add(38); else if((tick%140)<40)want.add(40);
    else want.add((tick%80)<40?39:37);
    if(tick%17<3)want.add(32); }
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  v06c.oneInterrupt(true); nf++;
  if(rd(L.GameStatus)===5){framesLive++;
    const yv=rd(ATTR+16); const y=yv>=0xF0?yv-256:yv;
    if(y<200){if(y<ymin)ymin=y;if(y>ymax)ymax=y;}
    for(let s=0;s<24;s++){const pg=0xE000+s*256;
      if(!rd(pg)||!rd(pg+3))continue; outs++;
      if(rd(pg+2)>=233)inHud++;}}
  const t=rd(TIMER); if(t!==prevT){prevT=t;tick++;}
}
for(const c of held)E.key(c,0);

console.log(`ROM=${ROM.split("/").pop()}  сцена=${TOP?"прыжки на верхней площадке (Y="+ROW+"), мумия в точке героя":"прогулка по пирамидам"}`);
console.log(`ЯДРА ЗАМЕЩАЮЩЕЙ ЗАПИСИ: ${RANGES.map(r=>`${r[0]} [0x${r[1].toString(16)}..0x${r[2].toString(16)})`).join(", ")}`);
console.log(`ПОКРЫТИЕ: кадров ${framesLive}, Y героя ${ymin}..${ymax}, выводов ${outs} (габарит в HUD ${inHud}), записей ядром ${writes}`);
if(framesLive<200||writes<1000){console.log("ПРОВАЛ ПОКРЫТИЯ: сцена не набрала записей");process.exit(1);}
if(TOP&&inHud<50){console.log("ПРОВАЛ ПОКРЫТИЯ: габарит в HUD не заезжал");process.exit(1);}
console.log(`ЗАПИСЕЙ ЗАМЕЩЕНИЕМ ПОВЕРХ НЕНУЛЕВОГО ФОНА: ${bad} из ${writes} = ${(100*bad/writes).toFixed(3)}%`);
const bl=Object.entries(badBy).sort((a,b)=>b[1]-a[1]).slice(0,12);
for(const [k,n] of bl)console.log(`   ${k.padEnd(30)} ${n}`);
const ba=Object.entries(badAddr).sort((a,b)=>b[1]-a[1]).slice(0,8);
for(const [a,n] of ba)console.log(`   адрес 0x${(+a).toString(16)} (пл ${((+a>>13)&3)} стб ${(+a>>8)&31} lo ${+a&255}) ${n}`);
console.log(bad===0?"STACK BLIT ZERO GATE OK":"STACK BLIT ZERO GATE ПРОВАЛЕН");
process.exit(bad===0?0:1);
