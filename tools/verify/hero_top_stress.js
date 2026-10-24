// hero_top_stress.js — СТЕНД «ВСЕ НАВЕРХУ» (предложение владельца, 2026-08-05).
//
// ЗАЧЕМ. hero_jitter гоняет игру клавишами и меряет то, что получится: где окажется
// герой — как повезёт (гистограмма Ytop разбегалась от 48 до 152). А дефект максимален
// в ВЕРХНЕЙ строке: луч приходит туда РАНЬШЕ всего (T = BEAM0 + 192*Y), значит у пачки
// меньше всего времени успеть, и именно там владелец видит мерцание.
// Владелец предложил: «перемести героя и мумий на верхнюю строку первого уровня и
// заставь двигаться — вот там фликеринг покажет себя». Это и делает стенд.
//
// КАК. Пирамида 1, верхняя строка лабиринта. Каждый игровой тик Y героя и Y мумий
// возвращаются на выбранную строку (X не трогаем — по нему они и бегают), поэтому вся
// компания остаётся наверху, а логика продолжает работать штатно.
//
// ЧТО СЧИТАЕТ (то же, что hero_jitter, но на худшей сцене):
//   позиции логики против позиций, реально показанных ПОД ЛУЧОМ;
//   кадры, где пачка вывода не отработала, с разбивкой по причине;
//   отдельно — та же статистика для МУМИЙ (их на верхней строке тоже видно).
//
// Запуск: node tools/verify/hero_top_stress.js [rom] [sym] [тиков=1500] [--row N]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NT=+(process.argv[4]||1500);
const ri=process.argv.indexOf("--row");
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
for(const s of ["vec_isr_nested","vec_spr_out","vec_spr_show","vso_merge1","vec_nsp_idx",
                "sprAttrib","enemyAttrib","GameStatus","timer","ProtaY","ProtaX","piramideActual"])
  if(L[s]===undefined){console.log("нет символа "+s+" в .sym");process.exit(2);}
const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));
const FB0=0x8000;
const OUT=L.vec_spr_out,SHOW=L.vec_spr_show,MERGE=L.vso_merge1;
const ATTR=L.sprAttrib;
const VPR_PA=0x29,VPR_PB=0x2B;

//  --turbo K: ЧТО БЫЛО БЫ, БУДЬ ПРОЦЕССОР В K РАЗ БЫСТРЕЕ (диагностика, не сборка).
//  Видео-часть эмулятора считает время кадра по cpu.vcycles, поэтому уменьшение vcycles
//  ровно в K раз = процессор успевает в K раз больше работы за тот же кадр (так ядро
//  MiSTer и делает turbo: снимает wait-состояния). Наши метрики при этом остаются в
//  ИСХОДНЫХ тактах (TT копит полное значение), то есть модель луча 13780+192*Y и кадр
//  59904 не сдвигаются. Нужно, чтобы отличить «упираемся в бюджет кадра» от «упираемся
//  в порядок операций»: если при K=2 непоказанные позиции не исчезают, дело не в тактах.
const tI=process.argv.indexOf("--turbo");
const TURBO=tI>0?+process.argv[tI+1]:1;
let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=TURBO>1
  ?function(){oI();const v=cpu.vcycles|0;TT+=v;cpu.vcycles=Math.max(1,Math.round(v/TURBO));}
  :function(){oI();TT+=cpu.vcycles|0;};

let curSlot=-1,inPack=false,outRet=-1,outSp=-1;
const wrote={},tLast={};
const oW=memory.write.bind(memory);
memory.write=function(addr,w8,stackrq){
  oW(addr,w8,stackrq);
  const a=addr&0xffff;
  if(a<FB0||a>=0xE000)return;
  if(!inPack||curSlot<0)return;
  wrote[curSlot]=(wrote[curSlot]||0)+1;tLast[curSlot]=TT;
};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
// ЗАДАЧА#53 (2026-08-07): пара героя пишется СТЕК-БЛИТОМ (vpz_col/vpz_bh в
// vec_sprout.asm), а не через vpr_ka/vpr_kb. Слот берём из САМОМОДИФИЦИРУЕМОГО
// операнда `ld h,страница_слота` — он верен и для пары, и для одиночного объекта.
const KA=L.vpr_ka,KB=L.vpr_kb,WA=L.vop_wa,WB=L.vop_wb;
const PZA=L.vpz_pa, PZB=L.vpz_pb;
let nested=false,packPos=null,tPack=-1;
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===L.vec_isr_nested)nested=true;
  if(pc===OUT&&outRet<0){outSp=cpu.sp;outRet=retOf();inPack=true;
    if(tPack<0){tPack=TT;packPos=`${rd(ATTR+17)},${rd(ATTR+16)}`;}}
  else if(outRet>=0&&pc===outRet&&cpu.sp>outSp){outRet=-1;inPack=false;curSlot=-1;}
  if(inPack){
    if(pc===SHOW||pc===MERGE)curSlot=rd(L.vec_nsp_idx);
    else if(pc===KA||pc===WA)curSlot=(rd(VPR_PA)-0xE0)&255;
    else if(pc===KB||pc===WB)curSlot=(rd(VPR_PB)-0xE0)&255;
    else if(pc===PZA)curSlot=(rd(PZA+1)-0xE0)&255;
    else if(pc===PZB)curSlot=(rd(PZB+1)-0xE0)&255;
  }
  return false;};

// --- старт настоящей партии на пирамиде 1 ---
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);
                      E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
if(rd(L.piramideActual)!==1){
  console.log(`ПРОВАЛ ПОКРЫТИЯ: piramideActual=${rd(L.piramideActual)}, ждали 1.`);
  console.log("  (без нажатия игра уходит в аттракт-демо, а демо стартует на пирамиде 5)");
  process.exit(1);
}
for(let i=0;i<800&&rd(L.GameStatus)!==5;i++)v06c.oneInterrupt(true);
if(rd(L.GameStatus)!==5){console.log("ПРОВАЛ ПОКРЫТИЯ: до геймплея не дошли");process.exit(1);}

// Верхняя ПЛОЩАДКА пирамиды 1. Ставим героя и мумий туда ОДИН РАЗ и больше не трогаем:
// насильная запись Y каждый тик подвешивает героя в воздухе, и логика перестаёт его
// двигать (замер: 2 смены позиции за 1571 кадр). Здесь же начинается ряд ворот, то есть
// это самая верхняя строка, по которой герой реально бегает.
const ROW=ri>0?+process.argv[ri+1]:72;
wr(L.ProtaY,ROW);
for(let m=0;m<8;m++){const y=rd(L.enemyAttrib+m*4);if(y<0xD0)wr(L.enemyAttrib+m*4,ROW);}

const logic=[],vis=[];let prevVis=null;
let frames=0,packFrames=0,noPack=0,noPackNested=0,lateFrames=0;
let mumWrote=0,mumFrames=0;
let held=new Set(),tick=0,prevT=0,nf=0;
const TIMER=L.timer;
while(tick<=NT&&nf<200000){
  // мумий подтягиваем наверх, если логика увела их вниз — герой бежит сам
  if(tick%64===0)for(let m=0;m<8;m++){const y=rd(L.enemyAttrib+m*4);
    if(y<0xD0&&y>ROW+8)wr(L.enemyAttrib+m*4,ROW);}
  const want=new Set([ (tick%200)<100 ? 39 : 37 ]);
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  const frameIrq=TT;
  for(const k in wrote)delete wrote[k];
  tPack=-1;packPos=null;nested=false;
  const live=(rd(L.GameStatus)===5);
  v06c.oneInterrupt(true);
  if(live){
    frames++;
    const y=rd(ATTR+16),x=rd(ATTR+17);
    const lp=`${x},${y}`;
    const tb=frameIrq+BEAM0+192*(y&255);
    const drew=(wrote[4]>0&&wrote[5]>0);
    if(drew)packFrames++;else{noPack++;if(nested)noPackNested++;}
    const late=drew&&Math.max(tLast[4]||0,tLast[5]||0)>tb;
    if(late)lateFrames++;
    const vp=(drew&&!late&&packPos)?packPos:prevVis;
    logic.push(lp);vis.push(vp);prevVis=vp;
    let mw=0;for(let s=6;s<14;s++)if(wrote[s])mw++;
    if(mw){mumWrote+=mw;mumFrames++;}
  }
  nf++;
  const t=rd(TIMER);if(t!==prevT){prevT=t;tick++;}
}
// --- сопоставление позиций наибольшей общей подпоследовательностью (см. hero_jitter) ---
function events(seq){const e=[];let last=null;
  for(let f=0;f<seq.length;f++){const v=seq[f];if(v===null)continue;
    if(last===null){last=v;continue;} if(v!==last){e.push({f,pos:v});last=v;}}
  return e;}
function lcs(a,b){const n=a.length,m=b.length;
  if(!n||!m)return [];
  const dp=new Uint16Array((n+1)*(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
    dp[i*(m+1)+j]=a[i].pos===b[j].pos?dp[(i+1)*(m+1)+j+1]+1
      :Math.max(dp[(i+1)*(m+1)+j],dp[i*(m+1)+j+1]);
  const p=[];let i=0,j=0;
  while(i<n&&j<m){if(a[i].pos===b[j].pos){p.push([i,j]);i++;j++;}
    else if(dp[(i+1)*(m+1)+j]>=dp[i*(m+1)+j+1])i++;else j++;}
  return p;}
const evL=events(logic),evV=events(vis),pairs=lcs(evL,evV);
const lat=[];for(const [i,j] of pairs){const d=evV[j].f-evL[i].f;if(d>=0&&d<=40)lat.push(d);}
const mean=lat.length?lat.reduce((a,b)=>a+b,0)/lat.length:0;
const sd=lat.length?Math.sqrt(lat.reduce((a,b)=>a+(b-mean)*(b-mean),0)/lat.length):0;
const pct=(a,b)=>b?(100*a/b).toFixed(2)+"%":"—";
console.log(`ROM=${ROM.split("/").pop()}  СТЕНД «ВСЕ НА ВЕРХНЕЙ СТРОКЕ» (Y=${ROW}), пирамида 1`);
console.log(`   луч над этой строкой приходит на такте ${BEAM0+192*ROW} из ${59904} кадра`);
console.log(`экранных кадров геймплея ${frames}`);
console.log(`   пара героя писала байты:            ${packFrames} = ${pct(packFrames,frames)}`);
console.log(`   БЕЗ вывода героя:                   ${noPack} = ${pct(noPack,frames)}, из них вложенное прерывание ${noPackNested}`);
console.log(`   вывод завершён ПОЗЖЕ луча:          ${lateFrames} = ${pct(lateFrames,packFrames)}`);
console.log(`   кадров с выводом мумий:             ${mumFrames} (объекто-выводов ${mumWrote})`);
console.log(`ПОЗИЦИИ: логика сменила ${evL.length}, экран показал ${evV.length}`);
console.log(`   НЕ ПОКАЗАНЫ ВОВСЕ: ${evL.length-pairs.length} = ${pct(evL.length-pairs.length,evL.length)}`);
console.log(`   задержка avg ${mean.toFixed(2)} кадра, sd ${sd.toFixed(2)}`);
//  РОВНОСТЬ ХОДА — прямая метрика дёрганья (2026-08-05). Задержка выше отвечает на
//  вопрос «насколько картинка отстаёт», а глаз видит ДРУГОЕ: одинаковы ли промежутки
//  между сменами позиции на экране. Ровный бег = все интервалы равны; рывок = один
//  интервал вдвое длиннее соседнего. Считаем интервалы в КАДРАХ ЭКРАНА между соседними
//  сменами показанной позиции и их разброс (sd/avg — коэффициент вариации: он
//  сопоставим между сборками с разной скоростью логики, в отличие от голого sd).
//  ДВА РЯДА, а не один. Герой ходит с ДРОБНОЙ скоростью (ProtaXdecimal), поэтому даже
//  при идеальном выводе позиция логики меняется не каждый тик — интервалы 1 и 3 кадра
//  чередуются ПО ПРИРОДЕ ИГРЫ. Мерить один ряд экрана значит считать эту норму дефектом.
//  Сравниваем разброс интервалов ЛОГИКИ и ЭКРАНА: вывод виноват ровно в их РАЗНИЦЕ.
const stat=ev=>{const g=[];for(let k=1;k<ev.length;k++)g.push(ev[k].f-ev[k-1].f);
  if(!g.length)return null;
  const m=g.reduce((a,b)=>a+b,0)/g.length;
  const d=Math.sqrt(g.reduce((a,b)=>a+(b-m)*(b-m),0)/g.length);
  const h={};for(const x of g)h[x]=(h[x]||0)+1;
  return {m,d,cv:100*d/m,top:Object.entries(h).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,c])=>`${k}к x${c}`).join(", ")};};
const sL=stat(evL),sV=stat(evV);
if(sL&&sV){
  console.log(`РОВНОСТЬ: логика  интервал ${sL.m.toFixed(2)} кадра, разброс ${sL.cv.toFixed(0)}%  (${sL.top})`);
  console.log(`          экран   интервал ${sV.m.toFixed(2)} кадра, разброс ${sV.cv.toFixed(0)}%  (${sV.top})`);
  console.log(`          ЛИШНЯЯ НЕРОВНОСТЬ ВЫВОДА: ${(sV.cv-sL.cv).toFixed(0)} п.п.`);
}
const gaps=[];for(let k=1;k<evV.length;k++)gaps.push(evV[k].f-evV[k-1].f);
if(gaps.length){
  const gm=gaps.reduce((a,b)=>a+b,0)/gaps.length;
  const gsd=Math.sqrt(gaps.reduce((a,b)=>a+(b-gm)*(b-gm),0)/gaps.length);
  const hist={};for(const g of gaps)hist[g]=(hist[g]||0)+1;
  const top=Object.entries(hist).sort((a,b)=>b[1]-a[1]).slice(0,5)
    .map(([g,c])=>`${g}к x${c}`).join(", ");

}
if(frames<200){console.log("ПРОВАЛ ПОКРЫТИЯ: геймплейных кадров меньше 200 — сцена не отработала");process.exit(1);}
