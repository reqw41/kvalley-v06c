// hero_atomic.js — АТОМАРНОСТЬ ПАРЫ ГЕРОЯ и что луч показал в его габарите.
//
// ПОВОД (жалоба с железа 2026-08-04): «герой всё ещё сильно мерцает вверху за счёт
// перерисовки. Может, проблема в том, что отрисовка каждой из плоскостей героя разделена
// по кадрам?» Герой — ДВА объекта в одной точке: слот 4 пишет p2 (одежда), слот 5 — p1
// (кожа); цвет пикселя = комбинация плоскостей, поэтому «выведен только один из пары» =
// целый кадр неправильного цвета. Прецедент есть: створка ворот (слоты 2 и 3) рвалась
// между кадрами (см. шапку vso_static в vec_sprout.asm).
//
// ВЕРДИКТ ЗАМЕРА (сборка 739941c, 1457 и 2470 экранных кадров геймплея, две траектории):
//   ПО КАДРАМ ПАРА НЕ РВЁТСЯ НИ РАЗУ. «Только слот 4» = 0, «только слот 5» = 0 из 892 и
//   1601 пачки. Иначе и быть не может: пачка — ОДИН вызов vec_spr_out из ISR глубины 1,
//   а вложенные прерывания (тик длиннее кадра в 28.6% случаев) уходят в vec_isr_nested и
//   спрайтов не выводят. Разорваться между кадрами пачка не может; створка рвалась не
//   внутри пачки, а между двумя ПОДГОТОВКАМИ.
//   ЧТО НА САМОМ ДЕЛЕ ДАЁТ МЕРЦАНИЕ: ДЫРА СТИРАНИЯ на ОБЫЧНОМ пути пачки. Там вывод —
//   это restore фона + OR спрайта, и между ними лежит фронт сейвов и вывод соседей:
//   окно avg 12021 тактов (max 26728 = 139 строк луча), луч попадает ВНУТРЬ него в 11.5%
//   байт-плоскостей героя. У слитой записи (76% пачек) дыры нет ПО ПОСТРОЕНИЮ (0 случаев).
//   Обычный путь берут 94 пачки с парой из 451 (21%), и они дают 588 из 661 «невозможных»
//   пикселей героя (89%). Верхняя зона хуже: Ytop 48..63 — 3.00% дефектных кадров против
//   1.61% на Ytop 64..95, ровно как говорит владелец («вверху»).
//   Второй по величине источник — межплоскостной разъезд на ТОМ ЖЕ обычном пути:
//   чередование пары по столбцам (задача#38, vpr_wr) живёт ТОЛЬКО в слитой записи, потому
//   что vpr_scan выходит при vsp_fast=0.
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ beam_color/beam_late (и почему они этого не показывали):
//   1) beam_color и beam_late закрывают «кадр» ПО ВХОДУ В ISR ГЛУБИНЫ 0. Пока тик длиннее
//      кадра (28.6% кадров), несколько ЭКРАННЫХ кадров сливаются в один замеряемый. Здесь
//      кадр закрывается ПО КАЖДОМУ ЭКРАННОМУ КАДРУ (по вызову oneInterrupt), и луч
//      считается от НЕГО;
//   2) beam_color меряет «окно между плоскостями» одним куском, не разделяя фазы. На
//      обычном пути в это окно попадает ЗАПИСЬ СТИРАНИЯ, и дыра стирания маскируется под
//      межплоскостной разъезд (12007 тактов «между плоскостями» — это на самом деле
//      restore->draw). Здесь фазы разделены: eT — стирание, dT — вывод;
//   3) разрыв «плоскость A в кадре N, плоскость B в кадре N+1» не виден ни одной из
//      прежних метрик вовсе; здесь он считается явно, покадровой ведомостью пары.
//   Сверка ЛУЧЕВАЯ, а не по снимку конца кадра: для каждого байта запоминается значение
//   на момент прохода луча над ним (T = irq + BEAM0 + 192*Y + 6*столбец), и оно
//   сравнивается со состоянием НА ВХОДЕ в кадр и НА КОНЕЦ кадра.
//
// ЧТО СЧИТАЕТ:
//   A. АТОМАРНОСТЬ ПАРЫ — покадрово: что подготовлено (vso_ord) и что реально написало
//      байты в fb. Кадры «ровно один из пары» — тот самый дефект из гипотезы.
//   B. ЦЕЛОСТНОСТЬ ПАЧКИ — объекты списка, не написавшие ни байта.
//   C. ЧТО ПОКАЗАЛ ЛУЧ В ГАБАРИТЕ ГЕРОЯ: пиксели «цвет, которого нет ни до, ни после»,
//      «показан старый» (лаг на кадр), межплоскостное окно и ДЫРА СТИРАНИЯ по отдельности,
//      всё с разрезом слитый/обычный путь, плюс длины серий подряд дефектных кадров.
//   D. РАЗБИВКА ПО Ytop героя (0..47 — табло, 48..95 — верхние строки лабиринта).
//
// ЗАКРЫТО (ЗАДАЧА#50, 2026-08-04). Две поправки к вердикту выше:
//   1) атрибуция «дедуплённая пара не проходит vfm_zok» была ЛОЖНОЙ — fastmark_why читал
//      регистр как поле (cpu.c вместо cpu.c()) и валил все отказы на слот 4; на деле
//      отказы hi0b/hi0c сидят на МУМИЯХ (их набор гасимых плоскостей переключался между
//      тиками), а пара героя проходит vfm_zok штатно;
//   2) атрибуция дыр по классам пачек: ВСЕ попадания луча в дыру стирания героя дали
//      пачки, уведённые на обычный путь ДВИЖУЩЕЙСЯ мумией (отказ там законен — мумии
//      нужен новый сейв), где сама пара для слитой записи ГОДНА.
// ЛЕЧЕНИЕ (vec_sprout.asm): стики-гашение vsq_sticky (набор гасимых плоскостей не
// отпускается, пока столбец тот же), МИКС-ПАЧКА (годная пара выводится слитой записью
// с чередованием внутри обычной пачки, без стирания и сейва — дыры нет по построению;
// решает vmx_check в тике), пара — ПЕРВОЙ в пачке (наименьшее окно под лучом), стирание
// обычного пути — по обратному порядку луча. Гейт ниже прошёл: дыра 11.51->1.33%, окно
// 0.46%, невозможные кадры 0.12%, Ytop 48..95 — 0 дефектных кадров.
// Запуск: node tools/verify/hero_atomic.js [rom] [sym] [тиков=2600] [--climb] [--gate]
//   --climb — траектория «лезем вверх по лестницам»; --gate — пороги и код возврата.
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NT=+(process.argv[4]||2600);
const CLIMB=process.argv.indexOf("--climb")>0;
const GATE=process.argv.indexOf("--gate")>0;
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
for(const s of ["vec_isr","vec_spr_out","vec_spr_show","vso_merge1","vpr_wr","vpr_ka","vpr_kb","vsp_n","vso_ord","vec_nsp_idx","GameStatus","vec_isr_depth"])
  if(L[s]===undefined){console.log("нет символа "+s+" в .sym");process.exit(2);}
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));
const FB0=0x8000,PLN=0x2000,SZ=PLN*3;
const ISR=L.vec_isr,OUT=L.vec_spr_out,SHOW=L.vec_spr_show,MERGE=L.vso_merge1,
      PAIRW=L.vpr_wr,KA=L.vpr_ka,KB=L.vpr_kb;
// ЗАДАЧА#53 (2026-08-07): пара героя пишется СТЕК-БЛИТОМ (vpz_col/vpz_bh в
// vec_sprout.asm), а не через vpr_ka/vpr_kb. Слот берём из САМОМОДИФИЦИРУЕМОГО
// операнда `ld h,страница_слота` — он верен и для пары, и для одиночного объекта.
const PZA=L.vpz_pa, PZB=L.vpz_pb;
const VPR_PA=0x29,VPR_PB=0x2B,VPR_AT=0xFA,VSP_FAST=0x76;

let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};

const cur=new Uint8Array(SZ),shown=new Uint8Array(SZ),old=new Uint8Array(SZ);
const wt0=new Float64Array(SZ),wt1=new Float64Array(SZ);
// ФАЗЫ ЗАПИСИ. На ОБЫЧНОМ пути байт трогают ДВАЖДЫ: проход стирания (vec_su_restore
// возвращает фон во ВСЕ плоскости объекта) и потом вывод. Если мерить «окно между
// плоскостями» одним куском, оно у обычного пути = длина всей пачки, и межплоскостной
// разъезд в нём не виден вовсе. Поэтому времена копим ОТДЕЛЬНО: eT — стирание, dT — вывод.
const eT=new Float64Array(SZ),dT0=new Float64Array(SZ),dT1=new Float64Array(SZ);
const emask=new Uint8Array(SZ),dmask=new Uint8Array(SZ);
const tmask=new Uint8Array(SZ);const touched=new Int32Array(SZ);let nT=0;
for(let i=0;i<SZ;i++)cur[i]=rd(FB0+i);
old.set(cur);shown.set(cur);

let frameIrq=0,live=false,curSlot=-1,inPack=false;
let packS=-1,packE=-1,packPlanned=[],packFast=0,packAt=255,packOpaque=0;
// годится ли пара для ЧЕРЕДОВАНИЯ на обычном пути: оба объекта одноплоскостные
// (hi0b=hi0c=0), оба pending=1, непрозрачный режим выключен, и они СОСЕДИ в порядке вывода
let simpleOK=0,simpleNo=0;const simpleWhy={};
const slotW=new Int32Array(21);        // сколько байт fb написал слот в этом кадре
const slotT0=new Float64Array(21),slotT1=new Float64Array(21);
let outsideHero=0;                      // записи в габарит героя ВНЕ пачки (блиты фона)
let heroRec=[null,null],heroHdr=[null,null];

const beamT=(k)=>frameIrq+BEAM0+192*(255-(k&255))+6*((k>>8)&31);
const oW=memory.write.bind(memory);
memory.write=function(addr,w8,stackrq){
  oW(addr,w8,stackrq);
  const a=addr&0xffff;
  if(a<FB0||a>=0xE000)return;
  const i=a-FB0;cur[i]=w8&0xff;
  if(!live)return;
  const k=i&0x1FFF;
  if(TT<=beamT(k))shown[i]=w8&0xff;
  if(!tmask[i]){tmask[i]=1;touched[nT++]=i;wt0[i]=TT;}
  wt1[i]=TT;
  if(inErase){emask[i]=1;eT[i]=TT;}
  else{if(!dmask[i]){dmask[i]=1;dT0[i]=TT;}dT1[i]=TT;}
  if(!inErase&&curSlot>=0&&curSlot<21){if(!slotW[curSlot])slotT0[curSlot]=TT;slotW[curSlot]++;slotT1[curSlot]=TT;}
  if(!inPack&&inHeroBox(i))outsideHero++;
};

// --- габарит героя: объединение ЗАПИСИ ВЫВОДА (куда выводим сейчас) и ШАПКИ СЛОТА
// (где герой нарисован сейчас). Столбцы/строки в координатах fb: col=(k>>8)&31, lo=k&255.
let boxC0=99,boxC1=-1,boxL0=-1,boxL1=-1;   // lo0..lo0+15
function boxAdd(hi0,lo0,nc){
  if(!nc)return;const c0=hi0&31;
  if(c0<boxC0)boxC0=c0;if(c0+nc-1>boxC1)boxC1=c0+nc-1;
  const l0=lo0,l1=(lo0+15)&255;
  if(boxL0<0){boxL0=l0;boxL1=l1;}else{if(l0<boxL0)boxL0=l0;if(l1>boxL1)boxL1=l1;}
}
function inHeroBox(i){
  if(boxC1<0)return false;
  const k=i&0x1FFF,col=(k>>8)&31,lo=k&255;
  return col>=boxC0&&col<=boxC1&&lo>=boxL0&&lo<=boxL1;
}
function rdRec(idx){const pg=0xE000+idx*256;
  return {pend:rd(pg+0x96),hi0:rd(pg+0x97),lo0:rd(pg+0x98),nc:rd(pg+0x99),
          hib:rd(pg+0x9F),hic:rd(pg+0x9B)};}
function rdHdr(idx){const pg=0xE000+idx*256;
  return {valid:rd(pg),hi0:rd(pg+1),lo0:rd(pg+2),nc:rd(pg+3),hib:rd(pg+4),hic:rd(pg+5)};}

function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
let outRet=-1,outSp=-1,inErase=false,erRet=-1,erSp=-1;
const REST=L.vec_su_restore,WA=L.vop_wa,WB=L.vop_wb,VP=L.vor_pair;
let depth0Entries=0;
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===REST&&erRet<0){erSp=cpu.sp;erRet=retOf();inErase=true;}
  else if(erRet>=0&&pc===erRet&&cpu.sp>erSp){erRet=-1;inErase=false;}
  if(pc===ISR&&rd(L.vec_isr_depth)===0)depth0Entries++;
  if(pc===OUT&&outRet<0){
    outSp=cpu.sp;outRet=retOf();inPack=true;packS=TT;
    packFast=rd(VSP_FAST);packAt=rd(VPR_AT);packOpaque=rd(0x7D);
    const n=rd(L.vsp_n);packPlanned=[];for(let j=0;j<n&&j<21;j++)packPlanned.push(rd(L.vso_ord+j));
    heroRec=[rdRec(4),rdRec(5)];heroHdr=[rdHdr(4),rdHdr(5)];
    boxC0=99;boxC1=-1;boxL0=-1;boxL1=-1;
    for(const r of heroRec)if(r.pend===1)boxAdd(r.hi0,r.lo0,r.nc);
    for(const h of heroHdr)if(h.valid)boxAdd(h.hi0,h.lo0,h.nc);
  }else if(outRet>=0&&pc===outRet&&cpu.sp>outSp){outRet=-1;inPack=false;packE=TT;curSlot=-1;}
  if(inPack){
    if(pc===SHOW||pc===MERGE)curSlot=rd(L.vec_nsp_idx);
    else if(pc===KA||pc===WA)curSlot=(rd(VPR_PA)-0xE0)&255;
    else if(pc===KB||pc===WB)curSlot=(rd(VPR_PB)-0xE0)&255;
    else if(pc===PZA)curSlot=(rd(PZA+1)-0xE0)&255;
    else if(pc===PZB)curSlot=(rd(PZB+1)-0xE0)&255;
  }
  return false;};

// ---------------- статистика ----------------
const zones=[[0,48],[48,64],[64,96],[96,192]];
const zoneOf=Y=>{for(let i=0;i<zones.length;i++)if(Y>=zones[i][0]&&Y<zones[i][1])return i;return -1;};
let frames=0,packs=0;
let pairBoth=0,pairOnly4=0,pairOnly5=0,pairNone=0;
let planBoth=0,planOnly4=0,planOnly5=0;
let planNotWrote=0;                       // объект в списке, но не написал ни байта
const splitEx=[];                          // примеры разрыва пары
let torn=0;const tornEx=[];                // пачка: список != реально написавшие
let noPack=0;                              // экранных кадров без пачки
let badPixT=0,lagPixT=0,chgPixT=0;
const zBad=zones.map(()=>0),zFrames=zones.map(()=>0),zBadFr=zones.map(()=>0);
let badFrames=0,lagFrames=0;
const runs={};let run=0;
const ytopHist={};
let winN=0,winHit=0,winSum=0;              // окно между p1 и p2 одного байта
// то же, но с разрезом ПО ПУТИ ПАЧКИ: слитая запись (vsp_fast=1, там работает чередование
// пары vpr_wr) против обычного пути (чередования НЕТ — vpr_scan выходит при vsp_fast=0).
const wN=[0,0],wHit=[0,0],wSum=[0,0],wMax=[0,0];
const fPacks=[0,0],fBadFr=[0,0],fBadPx=[0,0];
const holeN=[0,0],holeHit=[0,0],holeSum=[0,0],holeMax=[0,0];
let gapN=0,gapSum=0,gapMax=0,gapDisj=0;    // разъезд потоков записи слота 4 и слота 5
const gapByPath=[[],[]];
let lateN=0,lateHero=0;                    // пачка кончилась позже луча над Ytop героя

function closeFrame(){
  if(!live){nT=0;for(let i=0;i<SZ;i++)tmask[i]=0;old.set(cur);shown.set(cur);
    slotW.fill(0);packS=packE=-1;packPlanned=[];return;}
  frames++;
  const wrote=[];for(let s=0;s<21;s++)if(slotW[s])wrote.push(s);
  const havePack=packS>=0;
  if(havePack)packs++;else noPack++;
  const w4=slotW[4]>0,w5=slotW[5]>0;
  if(havePack){
    if(w4&&w5)pairBoth++;
    else if(w4)   {pairOnly4++;if(splitEx.length<12)splitEx.push({f:frames,kind:"только 4 (одежда p2)",plan:packPlanned.slice(),wrote:wrote.slice(),fast:packFast,at:packAt});}
    else if(w5)   {pairOnly5++;if(splitEx.length<12)splitEx.push({f:frames,kind:"только 5 (кожа p1)",plan:packPlanned.slice(),wrote:wrote.slice(),fast:packFast,at:packAt});}
    else pairNone++;
    const p4=packPlanned.includes(4),p5=packPlanned.includes(5);
    if(p4&&p5)planBoth++;else if(p4)planOnly4++;else if(p5)planOnly5++;
    for(const s of packPlanned)if(!slotW[s])planNotWrote++;
    const missing=packPlanned.filter(s=>!slotW[s]);
    if(missing.length){torn++;if(tornEx.length<12)tornEx.push({f:frames,plan:packPlanned.slice(),wrote:wrote.slice(),miss:missing});}
  }
  // --- что показал луч в габарите героя
  let Ytop=-1;
  if(boxL1>=0){Ytop=255-boxL1;ytopHist[Ytop>>3]=(ytopHist[Ytop>>3]||0)+1;}
  const z=Ytop>=0?zoneOf(Ytop):-1;
  if(z>=0)zFrames[z]++;
  let bad=0,lag=0,chg=0;
  // считаем по байтам габарита (k = позиция внутри плоскости), собирая все три плоскости
  const seen=new Set();
  for(let t=0;t<nT;t++){
    const i=touched[t];const k=i&0x1FFF;
    if(!inHeroBox(i))continue;
    if(seen.has(k))continue;seen.add(k);
    const Y=255-(k&255);if(Y<0||Y>=192)continue;
    const tb=beamT(k),fp=packFast?1:0;
    // (1) МЕЖПЛОСКОСТНОЕ ОКНО — только по записям ВЫВОДА (стирание сюда не входит)
    let f=Infinity,l=-Infinity,np=0;
    for(let p=0;p<3;p++){const j=k+p*PLN;if(!dmask[j])continue;np++;
      if(dT0[j]<f)f=dT0[j];if(dT1[j]>l)l=dT1[j];}
    if(np>=2){const hit=(f<tb&&tb<l);
      winN++;winSum+=(l-f);if(hit)winHit++;
      wN[fp]++;wSum[fp]+=(l-f);if(l-f>wMax[fp])wMax[fp]=l-f;if(hit)wHit[fp]++;}
    // (2) ДЫРА СТИРАНИЯ — от возврата фона до вывода, в ОДНОЙ и той же плоскости
    for(let p=0;p<3;p++){const j=k+p*PLN;
      if(!emask[j]||!dmask[j])continue;
      const w=dT1[j]-eT[j];if(w<=0)continue;
      holeN[fp]++;holeSum[fp]+=w;if(w>holeMax[fp])holeMax[fp]=w;
      if(eT[j]<tb&&tb<dT0[j])holeHit[fp]++;}
    const o0=old[k],o1=old[k+PLN],o2=old[k+2*PLN];
    const n0=cur[k],n1=cur[k+PLN],n2=cur[k+2*PLN];
    const s0=shown[k],s1=shown[k+PLN],s2=shown[k+2*PLN];
    for(let b=0;b<8;b++){const bit=1<<b;
      const co=((o0&bit)?1:0)|((o1&bit)?2:0)|((o2&bit)?4:0);
      const cn=((n0&bit)?1:0)|((n1&bit)?2:0)|((n2&bit)?4:0);
      const cs=((s0&bit)?1:0)|((s1&bit)?2:0)|((s2&bit)?4:0);
      if(cn!==co)chg++;
      if(cs===co&&cs!==cn){lag++;continue;}
      if(cs!==co&&cs!==cn){bad++;if(z>=0)zBad[z]++;}
    }
  }
  if(havePack&&w4&&w5){
    const fp=packFast?1:0;fPacks[fp]++;if(bad>0){fBadFr[fp]++;fBadPx[fp]+=bad;}
    if(!fp){   // ОБЫЧНЫЙ путь: можно ли здесь чередовать пару так же, как vpr_wr?
      const why=[];
      const i4=packPlanned.indexOf(4),i5=packPlanned.indexOf(5);
      if(Math.abs(i4-i5)!==1)why.push("не соседи в порядке вывода");
      if(packOpaque)why.push("vop_i1 (непрозрачный герой)");
      for(const [n,r] of [["4",heroRec[0]],["5",heroRec[1]]]){
        if(r.pend!==1)why.push(`слот ${n}: pending=${r.pend}`);
        if(r.hib)why.push(`слот ${n}: hi0b!=0`);
        if(r.hic)why.push(`слот ${n}: hi0c!=0`);}
      if(heroRec[0].lo0!==heroRec[1].lo0)why.push("lo0 разные");
      if(heroRec[0].nc!==heroRec[1].nc)why.push("ncols разные");
      if(!why.length)simpleOK++;else{simpleNo++;for(const w of why)simpleWhy[w]=(simpleWhy[w]||0)+1;}
    }
    // разъезд потоков записи двух объектов пары: положительный = интервалы НЕ пересекаются
    const g=Math.max(slotT0[4],slotT0[5])-Math.min(slotT1[4],slotT1[5]);
    gapN++;gapSum+=g;if(g>gapMax)gapMax=g;if(g>0)gapDisj++;gapByPath[fp].push(g);
    if(Ytop>=0){const tb=frameIrq+BEAM0+192*Ytop;lateN++;
      if(Math.max(slotT1[4],slotT1[5])>tb)lateHero++;}
  }
  badPixT+=bad;lagPixT+=lag;chgPixT+=chg;
  if(bad>0){badFrames++;run++;if(z>=0)zBadFr[z]++;}
  else{if(run){runs[run]=(runs[run]||0)+1;run=0;}}
  if(bad===0&&lag>0)lagFrames++;
  // сброс кадра
  for(let t=0;t<nT;t++){const i=touched[t];tmask[i]=0;emask[i]=0;dmask[i]=0;
    wt0[i]=0;wt1[i]=0;eT[i]=0;dT0[i]=0;dT1[i]=0;}
  nT=0;
  old.set(cur);shown.set(cur);
  slotW.fill(0);packS=packE=-1;packPlanned=[];
}

// ---------------- прогон ----------------
function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);}else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);}else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);}else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);}else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);}return k;}
// --climb: после старта держим «вверх» большую часть времени — герой лезет по лестницам
// в ВЕРХНИЕ строки лабиринта, где владелец и видит дефект.
function keysClimb(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else{const ph=t%40;if(ph<24)k.push(38);else if(ph<32)k.push(39);else k.push(37);}
  return k;}
const KF=CLIMB?keysClimb:keysFor;
let held=new Set(),tick=0,prevT=0,nf=0;
const TIMER=L.timer;
while(tick<=NT&&nf<400000){
  const want=new Set(KF(tick));
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  frameIrq=TT;live=(rd(L.GameStatus)===5);
  v06c.oneInterrupt(true);
  closeFrame();
  nf++;
  const t=rd(TIMER);if(t!==prevT){prevT=t;tick++;}
}
const pct=(a,b)=>b?(100*a/b).toFixed(2)+"%":"—";
console.log(`ROM=${ROM.split("/").pop()} ${CLIMB?"[--climb] ":""}тиков ${NT}, ЭКРАННЫХ кадров геймплея ${frames} (пачек ${packs}, кадров без пачки ${noPack} = ${pct(noPack,frames)})`);
console.log(`A. АТОМАРНОСТЬ ПАРЫ ГЕРОЯ (слот 4 = одежда p2, слот 5 = кожа p1):`);
console.log(`   оба написали fb      ${pairBoth}`);
console.log(`   ТОЛЬКО слот 4        ${pairOnly4}   <-- герой без кожи целый кадр`);
console.log(`   ТОЛЬКО слот 5        ${pairOnly5}   <-- герой без одежды целый кадр`);
console.log(`   ни один (герой стоит)${pairNone}`);
console.log(`   доля «ровно один из пары» от пачек: ${pct(pairOnly4+pairOnly5,packs)}`);
console.log(`   в СПИСКЕ вывода: оба ${planBoth}, только 4 ${planOnly4}, только 5 ${planOnly5}`);
console.log(`B. ЦЕЛОСТНОСТЬ ПАЧКИ: пачек, где кто-то из списка не написал ни байта: ${torn} = ${pct(torn,packs)} (объекто-случаев ${planNotWrote})`);
if(splitEx.length){console.log(`   примеры разрыва пары:`);
  for(const e of splitEx)console.log(`     кадр ${e.f}: ${e.kind} список=[${e.plan}] написали=[${e.wrote}] fast=${e.fast} pair@=${e.at}`);}
if(tornEx.length){console.log(`   примеры «в списке, но без записи»:`);
  for(const e of tornEx)console.log(`     кадр ${e.f}: список=[${e.plan}] написали=[${e.wrote}] пропущены=[${e.miss}]`);}
console.log(`C. ЧТО ЛУЧ ПОКАЗАЛ В ГАБАРИТЕ ГЕРОЯ:`);
console.log(`   «цвета не было ни до, ни после»: ${badPixT} пикс в ${badFrames} кадрах (${pct(badFrames,frames)}), при ${chgPixT} изменившихся`);
console.log(`   «показан старый» (лаг на кадр):  ${lagPixT} пикс, кадров только с лагом ${lagFrames}`);
console.log(`   окно между плоскостями байта: ${winN} байт-кадров, avg ${winN?Math.round(winSum/winN):0} тактов, луч ВНУТРИ ${winHit} = ${pct(winHit,winN)}`);
console.log(`   записи в габарит героя ВНЕ пачки (блиты фона): ${outsideHero} байт`);
const nm=["ОБЫЧНЫЙ путь (чередования пары НЕТ)","СЛИТАЯ запись (чередование vpr_wr)"];
for(let fp=0;fp<2;fp++){
  const q=gapByPath[fp].slice().sort((a,b)=>a-b);
  const qq=p=>q.length?Math.round(q[Math.min(q.length-1,Math.floor(q.length*p))]):0;
  console.log(`   ${nm[fp]}: пачек с парой ${fPacks[fp]}, дефектных кадров ${fBadFr[fp]} = ${pct(fBadFr[fp],fPacks[fp])}, пикс ${fBadPx[fp]}`);
  console.log(`      окно между плоскостями байта: ${wN[fp]} байт-кадров, avg ${wN[fp]?Math.round(wSum[fp]/wN[fp]):0}, max ${Math.round(wMax[fp])}, луч ВНУТРИ ${wHit[fp]} = ${pct(wHit[fp],wN[fp])}`);
  console.log(`      разъезд потоков слот4/слот5: p50 ${qq(0.5)} p90 ${qq(0.9)} max ${q.length?Math.round(q[q.length-1]):0} тактов`);
  console.log(`      ДЫРА СТИРАНИЯ (фон вернули -> вывели): ${holeN[fp]} байт-плоскостей, avg ${holeN[fp]?Math.round(holeSum[fp]/holeN[fp]):0}, max ${Math.round(holeMax[fp])}, луч ВНУТРИ ${holeHit[fp]} = ${pct(holeHit[fp],holeN[fp])}`);
}
console.log(`   ПАРА дописана ПОЗЖЕ луча над Ytop героя: ${lateHero} / ${lateN} = ${pct(lateHero,lateN)}`);
console.log(`   интервалы записи пары РАЗЪЕХАЛИСЬ (не пересекаются): ${gapDisj} / ${gapN} = ${pct(gapDisj,gapN)}`);
console.log(`   ПАРА НА ОБЫЧНОМ ПУТИ ПРИГОДНА К ЧЕРЕДОВАНИЮ: ${simpleOK} / ${simpleOK+simpleNo} = ${pct(simpleOK,simpleOK+simpleNo)}`);
for(const k of Object.keys(simpleWhy).sort((a,b)=>simpleWhy[b]-simpleWhy[a]))
  console.log(`      мешает «${k}»: ${simpleWhy[k]}`);
const rk=Object.keys(runs).map(Number).sort((a,b)=>a-b);
console.log(`   серии подряд дефектных кадров: ${rk.map(n=>`${n}кадр x${runs[n]}`).join("  ")||"—"}`);
console.log(`D. ПО ЗОНАМ Ytop героя:`);
for(let i=0;i<zones.length;i++)
  console.log(`   Ytop ${String(zones[i][0]).padStart(3)}..${String(zones[i][1]-1).padStart(3)}: кадров ${zFrames[i]}, дефектных ${zBadFr[i]} = ${pct(zBadFr[i],zFrames[i])}, пикс ${zBad[i]}`);
const yk=Object.keys(ytopHist).map(Number).sort((a,b)=>a-b);
console.log(`   гистограмма Ytop героя: ${yk.map(b=>`${b*8}:${ytopHist[b]}`).join(" ")}`);
if(GATE){
// ГЕЙТ. Пороги поставлены НИЖЕ измеренного на сборке 0f30c67, чтобы он ПАДАЛ на ней —
// иначе это был бы пятый зелёный гейт поверх живого дефекта. Что меряем и что было:
//   (1) дыра стирания у героя на обычном пути, луч ВНУТРИ: было 11.49% (порог 3%);
//   (2) межплоскостное окно на обычном пути, луч ВНУТРИ: было 10.37% (порог 2%);
//   (3) кадров с «цветом, которого не было ни до, ни после» в габарите героя: было 2.13%
//       (порог 1%) — интегральный итог, чтобы правка не перекладывала дефект с места на место.
// ПАРА ПО КАДРАМ (гипотеза владельца) уже зелёная и обязана такой остаться: 0 случаев.
  const holeHitPct=holeN[0]?100*holeHit[0]/holeN[0]:0;
  const winHitPct=wN[0]?100*wHit[0]/wN[0]:0;
  const badFrPct=frames?100*badFrames/frames:0;
  const chk=[["дыра стирания, луч внутри",holeHitPct,3],
             ["межплоскостное окно (обычный путь), луч внутри",winHitPct,2],
             ["кадров с невозможным цветом у героя",badFrPct,1],
             ["пар, разъехавшихся ПО КАДРАМ",pairOnly4+pairOnly5,0]];
  let bad=0;
  console.log("--- ГЕЙТ ---");
  for(const [n,v,lim] of chk){const ok=v<=lim;if(!ok)bad++;
    console.log(`   ${ok?"OK  ":"FAIL"} ${n}: ${typeof v==="number"&&lim>0?v.toFixed(2)+"%":v} (порог ${lim>0?lim+"%":lim})`);}
  console.log(bad?`HERO_ATOMIC FAIL (${bad})`:"HERO_ATOMIC OK");
  process.exit(bad?1:0);
}
