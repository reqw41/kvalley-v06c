// jump_top_beam.js — «ГЕРОЙ ПРОПАДАЕТ ПРИ ПРЫЖКЕ В ВЕРХНЕЙ СТРОКЕ» (жалоба с железа, 2026-08-06).
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ beam_late / hero_top_stress — ДВЕ ВЕЩИ.
//
// 1) ЧАСЫ ЛУЧА НАСТОЯЩИЕ. Те инструменты привязывают модель к ВХОДУ В ISR (irq = такт,
//    когда PC попал на vec_isr) и считают луч как irq+13780+192*Y. Это верно, только если
//    ISR стартует ровно в момент запроса прерывания. Прерывание на Векторе ЗАЩЁЛКИВАЕТСЯ
//    (filler.irq взводится на raster_line=0/pixel=176 и ждёт, пока у CPU поднимется iff),
//    поэтому под DI вход в ISR уезжает вперёд, и модель перестаёт видеть своё опоздание.
//    Здесь луч берётся из САМОГО ЭМУЛЯТОРА: cyc() = такты от точки запроса IRQ, а луч над
//    игровой строкой Y приходит на такте 13780+192*Y от той же точки (см. beamOfLo).
//
// 2) ПРОВЕРЯЕТСЯ НЕ МОДЕЛЬ, А БАЙТЫ ЭКРАНА. Автомат «стёрли -> вывели» знает только про
//    vec_su_restore и слепнет к любому ДРУГОМУ затирателю (блит клетки лабиринта из
//    игрового тика, композит створки, HUD). Здесь запоминается, ЧТО именно записал вывод
//    героя в каждый байт fb, и в момент прохода луча над строкой эти байты ЧИТАЮТСЯ ИЗ
//    ПАМЯТИ и сравниваются. Байты, где спрайт ничего не добавил к фону, отбрасываются.
//    Итог: «сколько байт героя реально было на экране, когда луч шёл над его строками».
//
// ДЕКЛАРАЦИЯ ПОКРЫТИЯ: прыжки обязаны РЕАЛЬНО происходить (Y героя ходит вниз-вверх),
// иначе замер не о том — exit 1.
//
// Запуск: node tools/verify/jump_top_beam.js [rom] [sym] [тиков=1200]
//         [--row N] [--nojump] [--png ПРЕФИКС]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
// --- разбор аргументов ПО ВИДУ, а не по позиции (грабли cheat_next_pyramid.js) ---
let ROM=null,SYM=null,NT=null;
for(const a of process.argv.slice(2)){
  if(/^--/.test(a))continue;
  if(/\.sym$/i.test(a)){SYM=a;continue;}
  if(/\.rom$/i.test(a)){ROM=a;continue;}
  if(/^\d+$/.test(a)){NT=+a;continue;}}
ROM=ROM||T+"/../../build/kvalley_8c.rom";
SYM=SYM||T+"/../../build/kvalley_8c.sym";
NT=NT===null?1200:NT;
const argn=(k,d)=>{const i=process.argv.indexOf(k);return i>0?+process.argv[i+1]:d;};
const args=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
const ROW=argn("--row",72);
const XPOS=argn("--x",-1);   // где стоять: на верхней строке лабиринта пол есть при X=64..176
const NOJUMP=process.argv.indexOf("--nojump")>0;
const MUM=process.argv.indexOf("--mummies")>0;   // мумий держать на той же строке
//  --roam: НАСТОЯЩАЯ ИГРА вместо стенда — герой ходит сам по всем этажам, чит N раз в
//  350 тиков переводит на следующую пирамиду, прыжок жмётся постоянно. Стенд «стой на
//  верхней площадке пирамиды 1» показывает короткие пачки (герой один); в живой игре в
//  пачке ещё мумии, ворота, нож и карта, и именно там пара выпадает из «первой».
const ROAM=process.argv.indexOf("--roam")>0;
//  --onmum: ХУДШИЙ СЛУЧАЙ ИЗ РЕАЛЬНОЙ ИГРЫ. На верхней строке прыгают ИМЕННО ЧЕРЕЗ МУМИЮ,
//  и тогда габарит пары накрывает её — vmx_check отвергает перестановку «пара первой»
//  (это и есть путь ОБЩИЙ ПОРЯДОК). Держим мумию 0 в точке героя принудительно.
const ONMUM=process.argv.indexOf("--onmum")>0;
const PNG=args("--png",null);
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu,cyc}=E;
for(const s of ["vec_su_restore","vec_spr_show","vso_merge1","vec_nsp_idx","vec_spr_out",
                "vsp_rdy","vec_isr_depth","sprAttrib","GameStatus","timer","ProtaY",
                "piramideActual","vpr_ka","vpr_kb"])
  if(L[s]===undefined){console.log("нет символа "+s+" в .sym");process.exit(2);}
const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
const FRAME=59904;
// ===== АУДИТ МЕТРИК 2026-08-09 ========================================================
// ЧТО ПОЧИНЕНО: BEAM игнорировал vec_vscroll (зашито 13780). При 0x1F совпадает с
// дефолтом; при L-скролле / 0x3F порог луча врал на 192*(vscroll-0x1F) тактов.
// ОТКАТ: `const BEAM=Y=>13780+192*Y;`
// ПРОВЕРКА: на дефолтной ROM (vec_vscroll=0x1F) цифры покрытия байт героя не должны
// заметно сдвинуться vs до правки; при экспериментальном vscroll≠0x1F — обязаны.
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));
const BEAM=Y=>BEAM0+192*Y;
const REST=L.vec_su_restore, SHOW=L.vec_spr_show, MERGE=L.vso_merge1, OUT=L.vec_spr_out;
const KA=L.vpr_ka, KB=L.vpr_kb, WA=L.vop_wa, WB=L.vop_wb;
// ЗАДАЧА#53 (2026-08-07): пара героя пишется СТЕК-БЛИТОМ (vpz_col/vpz_bh в
// vec_sprout.asm), а не через vpr_ka/vpr_kb. Слот берём из САМОМОДИФИЦИРУЕМОГО
// операнда `ld h,страница_слота` — он верен и для пары, и для одиночного объекта.
const PZA=L.vpz_pa, PZB=L.vpz_pb;
const VPR_PA=0x29, VPR_PB=0x2B;
const HERO=new Set([4,5]);

// ===== то, что вывод героя записал в fb — ЖИВАЯ КАРТИНА, а не снимок на конец пачки =====
//  Байт попадает в карту в тот же миг, когда его записал вывод героя, и уходит из неё,
//  когда его затёрло СТИРАНИЕ героя. Снимок «на конец пачки» врал бы: луч над героем
//  приходит на такте 21..27 тыс., а пачка кончается p50 на 18.8 тыс. / p90 на 30.5 тыс.,
//  то есть в каждом пятом кадре луч идёт ПОСРЕДИ пачки — и сравнивать надо с тем, что
//  выведено К ЭТОМУ МОМЕНТУ, а не с прошлым кадром.
const rowMap=[];             // строка -> Map(addr -> байт, записанный выводом героя)
for(let i=0;i<192;i++)rowMap[i]=new Map();
const rowOf=a=>(255-(a&255))&255;
let curSlot=-1, phase=0;     // phase: 1=стирание, 2=вывод
let restRet=-1,restSp=-1, showRet=-1,showSp=-1, outRet=-1,outSp=-1, inPack=false;
//  КТО ПОСЛЕДНИЙ ПИСАЛ В БАЙТ. Ради этого замер и затевался: «стёр героя» умеет не только
//  vec_su_restore, но и любой блит фона из игрового тика. PC писателя разводит эти случаи.
const lastPC=new Uint16Array(0x6000);
const callers={};        // цепочка возвратов того, кто затёр байт героя ЧУЖИМ писателем
const oW=memory.write.bind(memory);
memory.write=function(addr,w8,st){
  const a=addr&0xffff;
  if(a>=0x8000&&a<0xE000){
    lastPC[a-0x8000]=cpu.pc;
    if(!(phase&&HERO.has(curSlot))){
      const row=rowOf(a);
      if(row<192&&rowMap[row].has(a)&&rowMap[row].get(a)!==(w8&255)){
        const st4=[];for(let k=0;k<8;k++){const s=cpu.sp+2*k;
          st4.push(memory.read(s,false)|(memory.read(s+1,false)<<8));}
        const key=st4.filter(v=>v>=0x100&&v<0x8000).slice(0,4).join(",");
        callers[key]=(callers[key]||0)+1;
      }
    }
  }
  if(phase&&HERO.has(curSlot)&&a>=0x8000&&a<0xE000){
    const row=rowOf(a);
    if(row<192){
      if(phase===1)rowMap[row].delete(a);          // стирание героя: байта героя больше нет
      else{const before=rd(a);
        if((w8&255)!==before)rowMap[row].set(a,w8&255);  // спрайт реально отличается от фона
        else rowMap[row].delete(a);}
    }
  }
  oW(addr,w8,st);
};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}

// ===== часы луча и снятие состояния экрана =====
let bf=0, prevC=1e9, nextRow=192;
let sPresent=0,sAbsent=0;
let frameRec=null; const recs=[];
//  ПРОПОЛКА КАРТЫ ПО ШАПКЕ СЛОТА (иначе метрика врёт). Слитая запись покрывает
//  ОБЪЕДИНЕНИЕ старого и нового габарита и пишет в «хвост» (строки, которые герой
//  покинул) чистый фон. Без прополки такой байт остаётся в карте как «байт героя» и
//  дальше вечно не совпадает с fb, когда лабиринт легально перерисует там клетку —
//  ложные «луч не увидел героя» с адресом писателя vbt8_*. Оставляем в карте ровно то,
//  что накрывает шапка слота: lo0..lo0+15 по строкам, hi0..hi0+ncols-1 по столбцам.
function prune(){
  const keepRow=new Uint8Array(256), keepCol=new Uint8Array(32); let any=false;
  for(const s of [4,5]){const pg=0xE000+s*256;
    if(!rd(pg))continue;
    const hi0=rd(pg+1),lo0=rd(pg+2),nc=rd(pg+3); if(!nc)continue;
    any=true;
    for(let k=0;k<16;k++)keepRow[(lo0+k)&255]=1;
    for(let k=0;k<nc;k++)keepCol[(hi0+k)&0x1F]=1;}
  if(!any)return;
  for(let row=0;row<192;row++){const m=rowMap[row];if(!m.size)continue;
    for(const a of m.keys())if(!keepRow[a&255]||!keepCol[(a>>8)&0x1F])m.delete(a);}
}
const killer={};
function sampleRow(row){
  const m=rowMap[row]; if(!m.size)return;
  for(const [a,v] of m){ if(rd(a)===v)sPresent++;
    else{sAbsent++;const k=lastPC[a-0x8000];killer[k]=(killer[k]||0)+1;} }
}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  const c=cyc();
  if(c<prevC-2000){bf++;nextRow=0;}
  prevC=c;
  while(nextRow<192&&c>=BEAM(nextRow)){sampleRow(nextRow);nextRow++;}
  if(pc===OUT&&outRet<0){outSp=cpu.sp;outRet=retOf();inPack=true;
    if(frameRec){frameRec.packS=c;frameRec.rdy=rd(L.vsp_rdy);frameRec.depth=rd(L.vec_isr_depth);
      frameRec.fast=rd(L.vsp_fast);frameRec.mix=rd(L.vpr_mix);frameRec.sl=rd(L.vpr_sl);
      frameRec.at=rd(L.vpr_at);}}
  else if(outRet>=0&&pc===outRet&&cpu.sp>outSp){outRet=-1;inPack=false;phase=0;curSlot=-1;
    prune();
    if(frameRec)frameRec.packE=c;}
  if(pc===REST&&restRet<0){restSp=cpu.sp;restRet=retOf();curSlot=rd(L.vec_nsp_idx);phase=1;
    if(frameRec&&HERO.has(curSlot)&&frameRec.tErase<0)frameRec.tErase=c;}
  else if(restRet>=0&&pc===restRet&&cpu.sp>restSp){restRet=-1;phase=0;}
  if((pc===SHOW||pc===MERGE)&&showRet<0){showSp=cpu.sp;showRet=retOf();curSlot=rd(L.vec_nsp_idx);phase=2;
    if(frameRec&&HERO.has(curSlot)&&frameRec.tShow<0)frameRec.tShow=c;}
  else if(showRet>=0&&pc===showRet&&cpu.sp>showSp){showRet=-1;phase=0;}
  if(inPack&&showRet<0&&restRet<0){
    if(pc===KA||pc===WA){curSlot=(rd(VPR_PA)-0xE0)&255;phase=2;}
    else if(pc===KB||pc===WB){curSlot=(rd(VPR_PB)-0xE0)&255;phase=2;}
    else if(pc===PZA){curSlot=(rd(PZA+1)-0xE0)&255;phase=2;}
    else if(pc===PZB){curSlot=(rd(PZB+1)-0xE0)&255;phase=2;}
  }
  return false;};

// ===== старт настоящей партии на пирамиде 1 =====
const runf=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
runf(700);
for(let i=0;i<30;i++){E.key(32,1);runf(3);E.key(32,0);runf(3);}
if(rd(L.piramideActual)!==1){console.log(`ПРОВАЛ ПОКРЫТИЯ: piramideActual=${rd(L.piramideActual)}, ждали 1`);process.exit(1);}
for(let i=0;i<800&&rd(L.GameStatus)!==5;i++)v06c.oneInterrupt(true);
if(rd(L.GameStatus)!==5){console.log("ПРОВАЛ ПОКРЫТИЯ: до геймплея не дошли");process.exit(1);}
if(!ROAM){if(XPOS>=0)wr(L.ProtaX,XPOS);wr(L.ProtaY,ROW);}
if(MUM)for(let m=0;m<8;m++){const y=rd(L.enemyAttrib+m*4);if(y<0xD0)wr(L.enemyAttrib+m*4,ROW);}
runf(8);

// ===== прогон =====
const ATTR=L.sprAttrib, TIMER=L.timer;
let held=new Set(), tick=0, prevT=0, nf=0;
const ys=[];
while(tick<=NT&&nf<200000){
  // МУМИИ НА ТОЙ ЖЕ СТРОКЕ (стенд hero_top_stress): в настоящей игре на верхней строке
  // прыгают ИМЕННО ЧЕРЕЗ МУМИЮ, и в этот момент габарит героя её накрывает.
  if(ONMUM){const y=rd(L.enemyAttrib);
    if(y<0xD0){wr(L.enemyAttrib,ROW);wr(L.enemyAttrib+1,rd(L.ProtaX));}}
  if(MUM&&tick%64===0)for(let m=0;m<8;m++){const y=rd(L.enemyAttrib+m*4);
    if(y<0xD0&&y>ROW+8)wr(L.enemyAttrib+m*4,ROW);}
  const ph=tick%24;
  const want=new Set();
  if(!NOJUMP&&ph<3)want.add(32);
  if(ROAM){
    if(tick%350===0&&tick)want.add(78);            // чит N: следующая пирамида
    else if((tick%140)<20)want.add(38);            // вверх по лестнице
    else if((tick%140)<40)want.add(40);            // вниз
    else want.add((tick%80)<40?39:37);
  } else want.add((tick%200)<100?39:37);
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  const live=(rd(L.GameStatus)===5);
  sPresent=0;sAbsent=0;
  //  Y СО ЗНАКОМ: 0xF0..0xFF — это -16..-1 (спрайт частично выше поля), а не «скрыт».
//  Без этого прыжок с ВЕРХНЕЙ строки читается как «герой улетел за 200» и выпадает и из
//  декларации покрытия, и из статистики — ровно та слепота, из-за которой дефект жил.
frameRec={packS:-1,packE:-1,rdy:-1,depth:-1,tErase:-1,tShow:-1,y:(v=>v>=0xF0?v-256:v)(rd(ATTR+16)),live,nf,
            fast:-1,mix:-1,sl:-1,at:-1,yprev:recs.length?recs[recs.length-1].y:-1};
  v06c.oneInterrupt(true);
  frameRec.present=sPresent;frameRec.absent=sAbsent;
  {let n=0;for(let i=0;i<192;i++)n+=rowMap[i].size;frameRec.bytes=n;}
  frameRec.pat=rd(ATTR+18);frameRec.pat2=rd(ATTR+22);
  frameRec.hidden=(rd(0xE000+4*256+0x96)===2||rd(0xE000+5*256+0x96)===2);
  frameRec.p4=rd(0xE000+4*256+3);frameRec.p5=rd(0xE000+5*256+3);
  recs.push(frameRec);
  if(live)ys.push(frameRec.y);
  nf++;
  const t=rd(TIMER); if(t!==prevT){prevT=t;tick++;}
}
for(const c of held)E.key(c,0);

// ===== ДЕКЛАРАЦИЯ ПОКРЫТИЯ =====
if(ys.length<200){console.log(`ПРОВАЛ ПОКРЫТИЯ: геймплейных кадров ${ys.length} < 200`);process.exit(1);}
//  ПРЫЖОК = БЫСТРЫЙ ПОДЪЁМ С ВОЗВРАТОМ. Просто «Y уменьшился» не годится: по лестнице
//  герой тоже идёт вверх. Считаем эпизоды, где Y упал не меньше чем на 10 за <=16 кадров
//  и в течение 40 кадров вернулся к исходному (+-2). Мёртвого героя (Y>=200) отбрасываем.
const yl=ys.filter(y=>y<200);   // 0xD0..0xEF (=208..239) — парковка, не координата
let jumps=0;
for(let i=0;i<ys.length;i++){
  if(ys[i]>=200)continue;
  let j=i;while(j+1<ys.length&&ys[j+1]<=ys[j]&&ys[j+1]<200&&j-i<16)j++;
  if(ys[i]-ys[j]>=10){
    for(let k=j;k<Math.min(ys.length,j+40);k++)if(Math.abs(ys[k]-ys[i])<=2){jumps++;i=k;break;}
  }
}
const ymin=Math.min(...yl),ymax=Math.max(...yl);
console.log(`ROM=${ROM.split("/").pop()}  прыжки на строке Y=${ROW}, пирамида 1`);
console.log(`ПОКРЫТИЕ: кадров геймплея ${ys.length}, Y героя ${ymin}..${ymax} (размах ${ymax-ymin}), прыжков ${jumps}`);
if(!NOJUMP&&(jumps<10||ymax-ymin<10)){console.log("ПРОВАЛ ПОКРЫТИЯ: прыжков нет");process.exit(1);}

// ===== ОТЧЁТ =====
const live=recs.filter(r=>r.live&&r.y<200&&(r.present+r.absent)>0);
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
let blank=0,part=0,ok=0;const blankRecs=[];
for(const r of live){const tot=r.present+r.absent;
  if(r.present===0){blank++;blankRecs.push(r);}
  else if(r.present<tot*0.75)part++;else ok++;}
//  ГЛАВНОЕ ЧИСЛО ЖАЛОБЫ: кадры, где героя на экране НЕТ ВООБЩЕ — либо пачка пометила его
//  скрытым (pending=2), либо в fb не осталось ни одного его байта. Это не «мерцание под
//  лучом», это отсутствие фигуры.
const alive=recs.filter(r=>r.live&&r.y<200);
const gone=alive.filter(r=>r.hidden||(r.present+r.absent)===0);
console.log(`ГЕРОЯ НЕТ НА ЭКРАНЕ ВОВСЕ: ${gone.length} из ${alive.length} кадров = ${pct(gone.length,alive.length)}`
  +`  (помечен скрытым pending=2: ${alive.filter(r=>r.hidden).length})`);
console.log(`ЛУЧ ВИДИТ ГЕРОЯ (байты его спрайта в fb в момент прохода луча над строкой):`);
console.log(`   целиком (>=75% байт)  ${ok} = ${pct(ok,live.length)}`);
console.log(`   частично              ${part} = ${pct(part,live.length)}`);
console.log(`   НЕ ВИДИТ ВОВСЕ        ${blank} = ${pct(blank,live.length)}`);
let cNoPack=0,cNotRdy=0,cEraseNoShow=0,cLate=0,cOther=0;
for(const r of blankRecs){
  if(r.packS<0)cNoPack++;else if(r.rdy===0)cNotRdy++;
  else if(r.tErase>=0&&r.tShow<0)cEraseNoShow++;
  else if(r.tShow>=0)cLate++;else cOther++;}
console.log(`ПРИЧИНЫ ПРОПАЖИ (${blank}): пачка не звалась ${cNoPack}, vsp_rdy=0 ${cNotRdy}, `
  +`стёрли и не вывели ${cEraseNoShow}, вывели ПОЗЖЕ луча ${cLate}, прочее ${cOther}`);
const st=a=>{if(!a.length)return"—";a=a.slice().sort((x,y)=>x-y);
  return `avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(0)} p50 ${a[a.length>>1]} p90 ${a[(a.length*0.9)|0]} max ${a[a.length-1]}`;};
console.log(`ФАЗА (такты от ЗАПРОСА IRQ, кадр ${FRAME}):`);
console.log(`   старт пачки ${st(live.filter(r=>r.packS>=0&&r.rdy!==0).map(r=>r.packS))}`);
console.log(`   конец пачки ${st(live.filter(r=>r.packE>=0&&r.rdy!==0).map(r=>r.packE))}`);
console.log(`   show героя  ${st(live.filter(r=>r.tShow>=0).map(r=>r.tShow))}`);
console.log(`   луч над Y=${ROW}: ${BEAM(ROW)}; над Y=${ROW-18}: ${BEAM(ROW-18)}`);
const ran=live.filter(r=>r.packS>=0&&r.rdy!==0).length;
const skip=live.filter(r=>r.packS>=0&&r.rdy===0).length;
console.log(`ПАЧКА: отработала ${ran} = ${pct(ran,live.length)}, вышла по vsp_rdy=0 ${skip} = ${pct(skip,live.length)}`);
// путь пары в пачке (гипотеза «б»): слитая целиком / микс / vpr_sout / общий порядок
const paths={};let lostByPath={};
for(const r of live){ if(r.packS<0||r.rdy===0)continue;
  const p=r.fast?"пачка ЦЕЛИКОМ слитая":(r.mix!==0xFE?(r.sl?"МИКС (пара слитой записью)":"vpr_sout (пара первой, обычным)"):"ОБЩИЙ ПОРЯДОК (пара НЕ первая)");
  paths[p]=(paths[p]||0)+1;
  const o=lostByPath[p]||(lostByPath[p]={p:0,a:0,blank:0,part:0,n:0});
  o.p+=r.present;o.a+=r.absent;o.n++;
  const tt=r.present+r.absent;
  if(r.present===0)o.blank++;else if(r.present<tt*0.75)o.part++;}
console.log(`ПУТЬ ПАРЫ ГЕРОЯ В ПАЧКЕ:`);
for(const [k,v] of Object.entries(paths).sort((a,b)=>b[1]-a[1])){const o=lostByPath[k];
  console.log(`   ${k.padEnd(36)} ${String(v).padStart(4)} пачек, байт НЕ было ${pct(o.a,o.p+o.a).padStart(6)}, `
    +`кадров БЕЗ героя ${o.blank} = ${pct(o.blank,o.n).padStart(6)}, частично ${o.part}`);}
// КТО СТЁР байты героя, которых луч не увидел (PC -> ближайшая метка .sym)
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x8000).sort((a,b)=>a[1]-b[1]);
const nameOf=pc=>{let lo=0,hi=syms.length-1,r="?";
  while(lo<=hi){const m=(lo+hi)>>1;if(syms[m][1]<=pc){r=`${syms[m][0]}+${pc-syms[m][1]}`;lo=m+1;}else hi=m-1;}
  return r;};
const kt=Object.entries(killer).sort((a,b)=>b[1]-a[1]).slice(0,8);
const ktot=Object.values(killer).reduce((a,b)=>a+b,0);
console.log(`КТО ЗАТЁР БАЙТ ГЕРОЯ, которого луч не увидел (${ktot} байто-проб):`);
for(const [pc,n] of kt)console.log(`   0x${(+pc).toString(16)} ${nameOf(+pc).padEnd(28)} ${n} = ${pct(n,ktot)}`);
const ctop=Object.entries(callers).sort((a,b)=>b[1]-a[1]).slice(0,6);
const ctot=Object.values(callers).reduce((a,b)=>a+b,0);
console.log(`ЧУЖИЕ ЗАПИСИ ПОВЕРХ ЖИВОГО БАЙТА ГЕРОЯ: ${ctot}; цепочка возвратов:`);
for(const [k,n] of ctop)console.log(`   ${n} x  ${k.split(",").map(v=>nameOf(+v)).join(" <- ")}`);
const byY={};for(const r of blankRecs)byY[r.y]=(byY[r.y]||0)+1;
const tY=Object.entries(byY).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([y,c])=>`Y=${y}:${c}`).join(" ");
if(tY)console.log(`ПРОПАЖИ ПО Y героя: ${tY}`);
// доля потерянных байт по Y
const agg={};
for(const r of live){const o=agg[r.y]||(agg[r.y]={p:0,a:0,n:0,b:0});o.p+=r.present;o.a+=r.absent;o.n++;o.b+=r.bytes;}
console.log(`ПОТЕРЯ БАЙТ ПО Y (доля байт героя, которых под лучом НЕ было):`);
for(const y of Object.keys(agg).sort((a,b)=>a-b)){const o=agg[y];
  console.log(`   Y=${String(y).padStart(3)}  кадров ${String(o.n).padStart(4)}  нет ${pct(o.a,o.p+o.a)}  байт спрайта в fb avg ${(o.b/o.n).toFixed(1)}`);}
// СКОЛЬКО БАЙТ СПРАЙТА ГЕРОЯ ВООБЩЕ ЕСТЬ — по паттерну (пустой паттерн = «пропал» без луча)
const byPat={};
for(const r of live){const o=byPat[r.pat]||(byPat[r.pat]={n:0,b:0,ys:new Set()});o.n++;o.b+=r.bytes;o.ys.add(r.y);}
console.log(`БАЙТЫ СПРАЙТА ПО ПАТТЕРНУ (sprAttrib+18):`);
for(const k of Object.keys(byPat).sort((a,b)=>a-b)){const o=byPat[k];
  console.log(`   pat=${String(k).padStart(3)}  кадров ${String(o.n).padStart(4)}  байт avg ${(o.b/o.n).toFixed(1)}  Y ${Math.min(...o.ys)}..${Math.max(...o.ys)}`);}
