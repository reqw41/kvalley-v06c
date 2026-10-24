// beam_top.js — ДИАГНОСТИКА верхней зоны фликера (задача #37).
// Расширение beam_late.js: тот же прогон и та же модель луча T(Y)=BEAM0+192*Y, но
// транзиент разбирается ПО СЛОТАМ и ПО ПЛОСКОСТЯМ, плюс разбор длинных пачек
// (p90 конца пачки против p50: сколько объектов, какие, сколько плоскостей).
// Запуск: node tools/verify/beam_top.js [rom] [sym] [кадров]
//         node tools/verify/beam_top.js [rom] [sym] --ticks N   ← для A/B (как beam_ab)
//
// ===== АУДИТ МЕТРИК 2026-08-09 (правки + инструкция другому агенту) ==================
// ПОЧЕМУ ПРАВИЛИ. До правки инструмент НЕ видел слитый путь (vso_merge1 / vpr_wr) —
// большинство пачек текущей ROM шли мимо SHOW, и транзиент/разбор слотов врали
// «улучшением» (merge невидим = дыр как будто нет). Плюс SHOW брал lo0 из шапки
// save-under (+2), а рисует vec_spr_show из записи вывода (+0x98).
// ЧТО СДЕЛАНО:
//   1) хуки merge + pairw как в beam_late/beam_ab (отложенная пара → t1=конец vpr_wr);
//   2) геометрия вывода из pg+0x98/+0x99; плоскости из +0x9F/+0x9B (копии ДЛЯ ВЫВОДА,
//      не +0x9A — её дедуп обнуляет; не шапка +4/+5);
//   3) merge-объекты с te=-1 (дыры нет по построению) — в «транзиент по слотам» не
//      попадают, но учитываются в разборе пачек / слотах;
//   4) режим --ticks (как beam_late) для сопоставимого A/B.
// ОТКАТ ЦЕЛИКОМ: git show HEAD:tools/verify/beam_top.js (или коммит до этой правки).
//   Точечный откат геометрии: в show/merge вернуть pg+2/+3 и hib/hic из +4/+5, убрать
//   MERGE/PAIRW из B и ветки pairw/merge.
// ПРОВЕРКА КОРРЕКТНОСТИ (другому агенту):
//   1) --ticks 2600: число draws с te<0 (merge) должно быть >0 и близко к доле слитых
//      пачек beam_ab / spr_same_footprint (ожидание ~50–70% объектов без дыры).
//   2) Транзиент Ytop 0..63 на --ticks должен быть того же порядка, что у
//      `beam_late.js --ticks 2600` (сумма zpx), а не «ноль при живом фликере».
//   3) Без merge-хуков (временный откат) транзиент и nobj в ДЛИННЫХ пачках резко
//      падают — это и есть доказательство, что правка закрыла слепоту.
//   4) Дефолт без --ticks по-прежнему frame-keyed — НЕ сравнивать с beam_ab.
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||8000);
const E=make(ROM,SYM);
const TICKARG=process.argv.indexOf("--ticks");
if(TICKARG<0&&toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;
const FR=59904;
// База луча зависит от аппаратного вертикального скролла и НЕ является константой:
// 0x1F (поле по центру) -> 13780, 0x3F (поле прижато вниз) -> 19924. Здесь стояло
// зашитое 13780 — на дефолтной сборке совпадало, но соврало бы при смене дефолта.
if(L.vec_vscroll===undefined)throw new Error("beam_top: в .sym нет vec_vscroll — базу луча брать неоткуда");
const BEAM0=13780+192*(((L.vec_vscroll-0x1F)&255));
const ISR=L.vec_isr,OUT=L.vec_spr_out,TICK=L.H_TIMI,SHOW=L.vec_spr_show,REST=L.vec_su_restore,SAVE=L.vec_su_save;
const MERGE=L.vso_merge1,PAIRW=L.vpr_wr;
if(MERGE===undefined||PAIRW===undefined)
  throw new Error("beam_top: в .sym нет vso_merge1/vpr_wr — слитый путь не инструментировать");
let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
let cur=null;const frames=[];let pend=[];
const B={out:{pc:OUT},tick:{pc:TICK},show:{pc:SHOW},merge:{pc:MERGE},pairw:{pc:PAIRW},save:{pc:SAVE},rest:{pc:REST}};
for(const k in B){B[k].ret=-1;B[k].sp=-1;}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0){
    if(cur)frames.push(cur);
    cur={irq:TT,outS:-1,outE:-1,tickE:-1,er:{},draws:[],saves:[],rests:[],gs:rd(L.GameStatus)};}
  if(!cur)return false;
  for(const k in B){const b=B[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();
      if(k==="out")cur.outS=TT;
      if(k==="save"){const i=rd(L.vec_nsp_idx);b.d={i,t0:TT};}
      if(k==="rest"){const i=rd(L.vec_nsp_idx);b.d={i,t0:TT};}
      // 2026-08-09: запись вывода +0x98/+0x99; плоскости вывода +0x9F/+0x9B.
      // Откат геометрии SHOW: lo0=rd(pg+2), nc=rd(pg+3), hib=rd(pg+4), hic=rd(pg+5).
      if(k==="show"){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256;
        b.d={i,t0:TT,lo0:rd(pg+0x98),nc:rd(pg+0x99),hib:rd(pg+0x9F),hic:rd(pg+0x9B),
             te:cur.er[i]!==undefined?cur.er[i]:-1,path:"show"};}
      if(k==="merge"){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256;
        b.d={i,t0:TT,lo0:rd(pg+0x98),nc:rd(pg+0x99),hib:rd(pg+0x9F),hic:rd(pg+0x9B),
             te:-1,path:"merge"};}}
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){b.ret=-1;
      if(k==="out")cur.outE=TT;
      else if(k==="tick")cur.tickE=TT;
      else if(k==="save"){b.d.t1=TT;cur.saves.push(b.d);}
      else if(k==="rest"){b.d.t1=TT;cur.rests.push(b.d);}
      else if(k==="pairw"){for(const d of pend){d.t1=TT;cur.draws.push(d);}pend=[];}
      else if(k==="merge"&&PAIRW&&rd(L.vpr_def))pend.push(b.d);
      else if(k==="show"||k==="merge"){b.d.t1=TT;cur.draws.push(b.d);}}}
  if(pc===REST){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256; if(rd(pg))cur.er[i]=TT;}
  return false;};

// РЕЖИМ ИГРОВЫХ ТИКОВ (--ticks N) — та же раскладка, что beam_late/beam_ab.
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
const TICKS=TICKARG>0?+(process.argv[TICKARG+1]||2600):0;
if(TICKS){
  let heldS=new Set(),tick=0,prevT=0,nf=0;
  while(tick<=TICKS&&nf<400000){
    const want=new Set(keysFor(tick));
    for(const c of heldS)if(!want.has(c))E.key(c,0);
    for(const c of want)if(!heldS.has(c))E.key(c,1);
    heldS=want;
    if(cur)cur.gs=rd(L.GameStatus);
    v06c.oneInterrupt(true);nf++;
    const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;}
  }
  for(const c of heldS)E.key(c,0);
} else {
  let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  let held=-1;
  for(let f=0;f<NF;f++){
    if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
      if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
    if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
    if(cur)cur.gs=rd(L.GameStatus);
    v06c.oneInterrupt(true);
  }
  if(held>0)E.key(held,0);
}
if(cur)frames.push(cur);

const cat=i=>i<4?"ворота":i<6?"герой":i<14?"мумии":i<19?"нож":"карта";
const zones=[[0,48],[48,64],[64,96],[96,192]];
const zn=z=>`${z[0]}..${z[1]-1}`;
// --- 1. транзиент по (зона, слот) ---
const acc={};let tornPx=0,nMerge=0,nShow=0;
const addr=(z,key,px)=>{const k=z+"|"+key;acc[k]=(acc[k]||0)+px;};
const outEs=[];const fdet=[];
for(const fr of frames){
  if(fr.gs!==5)continue;
  if(fr.outS>=0&&fr.outE>=0&&fr.draws.length){outEs.push(fr.outE-fr.irq);fdet.push(fr);}
  for(const d of fr.draws){
    if(!d.nc)continue;
    if(d.path==="merge")nMerge++; else nShow++;
    const Ytop=255-(d.lo0+15); if(Ytop<0||Ytop>190)continue;
    if(d.te<0)continue; // слитая запись: дыры нет
    let px=0;
    for(let k=0;k<16;k++){const Y=Ytop+k;const bt=fr.irq+BEAM0+192*Y;
      if(bt>d.te&&bt<d.t1)px+=d.nc*8;}
    if(!px)continue;tornPx+=px;
    let z=-1;for(let i=0;i<zones.length;i++)if(Ytop>=zones[i][0]&&Ytop<zones[i][1])z=i;
    const np=1+(d.hib?1:0)+(d.hic?1:0);
    addr(z,`слот${d.i}(${cat(d.i)}) nc=${d.nc} pl=${np}`,px);
  }
}
console.log(`ROM=${ROM.split("/").pop()} кадров с пачкой ${fdet.length}, транзиент всего ${tornPx} пикс`+
  (TICKS?` (--ticks ${TICKS})`:` (frame-keyed, ${NF} кадров)`));
console.log(`покрытие путей: show=${nShow} merge=${nMerge}`+
  (nMerge+nShow?` (merge ${(100*nMerge/(nMerge+nShow)).toFixed(1)}%)`:"")+
  `  ← если merge=0 на живой ROM, хуки сломаны / символы не те`);
console.log(`\n=== ТРАНЗИЕНТ ПО ЗОНАМ И СЛОТАМ ===`);
for(let z=0;z<zones.length;z++){
  const rows=Object.keys(acc).filter(k=>+k.split("|")[0]===z).map(k=>[k.split("|")[1],acc[k]]).sort((a,b)=>b[1]-a[1]);
  const s=rows.reduce((s,r)=>s+r[1],0);
  console.log(`Ytop ${zn(zones[z]).padStart(7)}: ${s} пикс`);
  for(const r of rows.slice(0,8))console.log(`      ${String(r[1]).padStart(6)}  ${r[0]}`);
}
// --- 2. разбор пачек: короткие (p50) против длинных (p90+) ---
const so=outEs.slice().sort((a,b)=>a-b);
const p50=so[so.length>>1],p90=so[(so.length*0.9)|0];
console.log(`\n=== ПАЧКИ: конец p50=${p50} p90=${p90} ===`);
function grp(name,sel){
  const g=fdet.filter(sel);if(!g.length){console.log(`${name}: пусто`);return;}
  let nobj=0,npl=0,ncols=0,nsave=0,tsave=0,tdraw=0,tall=0,trest=0,nrest=0,win=0,nwin=0,nm=0;
  const bysl={};
  for(const fr of g){
    nobj+=fr.draws.length;
    for(const d of fr.draws){const np=1+(d.hib?1:0)+(d.hic?1:0);npl+=np;ncols+=d.nc*np;
      bysl[d.i]=(bysl[d.i]||0)+1;tdraw+=d.t1-d.t0;
      if(d.path==="merge")nm++;
      if(fr.er[d.i]!==undefined){win+=d.t1-fr.er[d.i];nwin++;}}
    nsave+=fr.saves.length;for(const s of fr.saves)tsave+=s.t1-s.t0;
    nrest+=fr.rests.length;for(const s of fr.rests)trest+=s.t1-s.t0;
    tall+=(fr.outE-fr.outS);
  }
  const n=g.length;
  console.log(`${name}: кадров ${n} | объектов/кадр ${(nobj/n).toFixed(2)} плоскостей/кадр ${(npl/n).toFixed(2)} столбцов·пл ${(ncols/n).toFixed(1)} merge-объ ${(nm/n).toFixed(2)}`);
  console.log(`      тактов/кадр: restore ${(trest/n).toFixed(0)} (${(nrest/n).toFixed(2)} шт) сейв ${(tsave/n).toFixed(0)} (${(nsave/n).toFixed(2)} шт) вывод ${(tdraw/n).toFixed(0)} | ПАЧКА ${(tall/n).toFixed(0)} прочее ${((tall-trest-tsave-tdraw)/n).toFixed(0)}`);
  console.log(`      окно «разобран» (стирание->конец вывода) ${(win/Math.max(1,nwin)).toFixed(0)} тактов на объект`);
  const sl=Object.keys(bysl).map(Number).sort((a,b)=>a-b).map(i=>`${i}:${(bysl[i]/n).toFixed(2)}`);
  console.log(`      слоты (шт/кадр): ${sl.join(" ")}`);
}
grp("КОРОТКИЕ (конец < p50)",fr=>fr.outE-fr.irq<p50);
grp("ДЛИННЫЕ  (конец >= p90)",fr=>fr.outE-fr.irq>=p90);
grp("ВСЕ",()=>true);
// --- 3. старт пачки: чем определяется ---
const st=a=>{a=a.slice().sort((x,y)=>x-y);return `avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(0)} p50 ${a[a.length>>1]} p90 ${a[(a.length*0.9)|0]} max ${a[a.length-1]}`;};
console.log(`\nстарт пачки: ${st(fdet.map(f=>f.outS-f.irq))}`);
console.log(`длительность пачки: ${st(fdet.map(f=>f.outE-f.outS))}`);
