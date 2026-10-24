// packcap_probe.js — СОСТАВ ПАЧКИ ВЫВОДА глазами будущего КАПА (задача#53, кап пачки).
//
// ЗАЧЕМ. burst_tail говорит «хвост набирается ЧИСЛОМ ОБЪЕКТОВ», но не говорит, ЧТО это
// за объекты и что будет, если хвост списка отложить. Здесь по каждой пачке печатается:
//   vsp_n, vsp_fast, позиция пары (vpr_mix/vpr_at);
//   по каждой позиции vso_ord: слот, lo0 ШАПКИ и lo0 ЗАПИСИ, признак «объект в этом тике
//   ПЕРЕСЧИТАН (vec_spr_prep) или положен по СТАРОЙ ЗАПИСИ (vns_wlist)»;
//   безопасна ли резка по границе K по одному лишь сравнению строк.
// И отдельно — СТАРВЕЙШН: сколько тиков подряд конкретный слот сидит на позиции >= K.
// Запуск: node tools/verify/packcap_probe.js [rom] [sym] [тиков=1200] [K=4]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const TICKS=+(process.argv[4]||1200), K=+(process.argv[5]||4);
// --allgs: считать пачки во ВСЕХ состояниях игры, а не только в геймплее (GameStatus=5).
// Нужно ровно для одного вопроса: бывает ли vsp_n > 4. Бывает — но ТОЛЬКО в анимации
// входа в ворота (GameStatus=4), где готовятся все четыре створки 0-3 плюс пара героя.
const ALLGS=process.argv.includes("--allgs");
const E=make(ROM,SYM);
const {L,rd,v06c,cpu,memory}=E;
const OUT=L.vec_spr_out, WLIST=L.vns_wlist, PREP=L.vec_spr_prep;

let gs=0, wl=new Set(), pr=new Set();
const packs=[];
// длительность пачки и посегментно: сколько тактов между сменами vso_i
let TT=0;const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
let cur=null,oret=-1,osp=0,segT=0,segI=-1;
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(!ALLGS&&gs!==5)return false;
  if(cur){
    const i=rd(L.vso_i);
    if(i!==segI){cur.seg.push([segI,TT-segT]);segT=TT;segI=i;}
    if(pc===oret&&cpu.sp>osp){cur.seg.push([segI,TT-segT]);cur.t=TT-cur.t0;packs.push(cur);cur=null;}
    return false;}
  if(pc===WLIST)wl.add(rd(L.vec_nsp_idx));
  else if(pc===PREP)pr.add(rd(L.vec_nsp_idx));
  else if(pc===OUT){
    const n=rd(L.vsp_n), rdy=rd(L.vsp_rdy);
    if(rdy===1&&n>0){
      const o=[];
      for(let i=0;i<n;i++){const idx=rd(L.vso_ord+i);const p=0xE000+idx*256;
        o.push({idx,vh:rd(p),hLo:rd(p+2),hHi:rd(p+1),hNc:rd(p+3),
                rLo:rd(p+0x98),rHi:rd(p+0x97),rNc:rd(p+0x99),pend:rd(p+0x96),hi0b:rd(p+4),hi0c:rd(p+5),rb:rd(p+0x9F),rc:rd(p+0x9B),d1:rd(p+0x0D1),
                wl:wl.has(idx),pr:pr.has(idx)});}
      cur={n,gs,fast:rd(L.vsp_fast),mix:rd(L.vpr_mix),at:rd(L.vpr_at),o,t0:TT,seg:[]};
      osp=cpu.sp;oret=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
      segT=TT;segI=rd(L.vso_i);
    }
    wl=new Set();pr=new Set();
  }
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
{let heldS=new Set(),tick=0,prevT=0,nf=0;
 while(tick<=TICKS&&nf<400000){
   const want=new Set(keysFor(tick));
   for(const c of heldS)if(!want.has(c))E.key(c,0);
   for(const c of want)if(!heldS.has(c))E.key(c,1);
   heldS=want;gs=rd(L.GameStatus);
   v06c.oneInterrupt(true);nf++;
   const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;}}
 for(const c of heldS)E.key(c,0);}

console.log(`пачек с работой ${packs.length}, кап K=${K}${ALLGS?" (ВСЕ GameStatus)":""}`);
if(ALLGS){const g={};for(const p of packs){const k=`GameStatus=${p.gs} n=${p.n}`;(g[k]=g[k]||[]).push(p.t);}
  console.log("ДЛИНА ПАЧКИ ПО СОСТОЯНИЯМ ИГРЫ:");
  for(const k of Object.keys(g).sort()){const a=g[k].sort((x,y)=>x-y);
    console.log(`  ${k.padEnd(20)} ${String(a.length).padStart(4)} пачек avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(0).padStart(6)} p90 ${String(a[(a.length*0.9)|0]).padStart(6)} max ${String(a[a.length-1]).padStart(6)}`);}}
// --- 0. ДЛИТЕЛЬНОСТЬ по (число объектов, путь)
{const g={};for(const p of packs){const k=`n=${p.n} ${p.fast?"СЛИТАЯ":"старый "}`;
   (g[k]=g[k]||[]).push(p.t);}
 console.log("ДЛИТЕЛЬНОСТЬ ПАЧКИ по (vsp_n, путь):");
 for(const k of Object.keys(g).sort()){const a=g[k].sort((x,y)=>x-y);
   console.log(`  ${k}: ${String(a.length).padStart(4)} пачек  avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(0).padStart(6)} p50 ${String(a[a.length>>1]).padStart(6)} p90 ${String(a[(a.length*0.9)|0]).padStart(6)} max ${String(a[a.length-1]).padStart(6)}`);}
 const all=packs.map(p=>p.t).sort((x,y)=>x-y);
 console.log(`  ВСЕ: avg ${(all.reduce((s,v)=>s+v,0)/all.length).toFixed(0)} p50 ${all[all.length>>1]} p90 ${all[(all.length*0.9)|0]} max ${all[all.length-1]}`);
 // из чего состоит самая длинная пачка
 const w=packs.slice().sort((a,b)=>b.t-a.t)[0];
 console.log(`  САМАЯ ДЛИННАЯ ${w.t} т: n=${w.n} fast=${w.fast} mix=${w.mix} at=${w.at} сегменты(vso_i:такты) ${w.seg.map(s=>s.join(":")).join(" ")}`);
 console.log(`     объекты: ${w.o.map(x=>`сл${x.idx}[вал${x.vh} pend${x.pend} hi ${x.hHi.toString(16)}/${x.rHi.toString(16)} lo ${x.hLo}/${x.rLo} nc ${x.hNc}/${x.rNc}${x.wl?" СТАРАЯЗАП":""}${x.pr?" ПЕРЕСЧ":""}]`).join(" ")}`);
 // p90 и выше — их состав
 const P90=all[(all.length*0.9)|0];
 const tail=packs.filter(p=>p.t>=P90);
 const hh={};for(const p of tail){const k=`n=${p.n} ${p.fast?"СЛИТАЯ":"старый"}`;hh[k]=(hh[k]||0)+1;}
 console.log(`  ХВОСТ (>= p90 ${P90}): ${tail.length} пачек: ${Object.entries(hh).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+" x"+v).join(" | ")}`);
 // цена ОДНОГО объекта: сегменты хвостовых пачек
 const segAll=[];for(const p of packs)for(const [,c] of p.seg)if(c>500)segAll.push(c);
 segAll.sort((x,y)=>x-y);
 console.log(`  СЕГМЕНТЫ (такты между сменами vso_i, >500): n=${segAll.length} avg ${(segAll.reduce((s,v)=>s+v,0)/segAll.length).toFixed(0)} p50 ${segAll[segAll.length>>1]} p90 ${segAll[(segAll.length*0.9)|0]} max ${segAll[segAll.length-1]}`);
 // --- ИМИТАЦИЯ КАПА: цена пачки без сегментов с vso_i >= K
 console.log("ИМИТАЦИЯ КАПА (цена пачки за вычетом сегментов позиций >= K; пара всегда остаётся):");
 for(const KK of [0,1,2,3,4]){
   const a=packs.map(p=>{let t=p.t;const pos=p.mix!==0xFE?p.mix:(p.at!==0xFF?p.at:-1);
     for(const [i,c] of p.seg)if(i>=KK&&i!==pos&&i!==pos+1&&i<p.n)t-=c;return t;}).sort((x,y)=>x-y);
   console.log(`   K=${KK}: avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(0).padStart(6)} p50 ${String(a[a.length>>1]).padStart(6)} p90 ${String(a[(a.length*0.9)|0]).padStart(6)} max ${String(a[a.length-1]).padStart(6)}`);}
 // --- цена сегмента против свойств объекта
 const cls={};
 for(const p of packs)for(const [i,c] of p.seg){
   if(c<500||i<0||i>=p.n)continue;const x=p.o[i];
   const pos=p.mix!==0xFE?p.mix:(p.at!==0xFF?p.at:-1);
   if(i===pos||i===pos+1)continue;
   const multi=(rdSlot(x,4)||rdSlot(x,5))?"много":"одно";
   const k=`${p.fast?"слит":"стар"} ${multi}пл nc=${x.rNc} сдвиг=${x.hLo!==x.rLo?"да":"нет"}`;
   (cls[k]=cls[k]||[]).push(c);}
 console.log("ЦЕНА ОДНОГО ОБЪЕКТА по свойствам (без пары):");
 for(const k of Object.keys(cls).sort((a,b)=>cls[b].reduce((s,v)=>s+v,0)-cls[a].reduce((s,v)=>s+v,0)).slice(0,14)){
   const a=cls[k].sort((x,y)=>x-y);
   console.log(`  ${k.padEnd(34)} n=${String(a.length).padStart(4)} avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(0).padStart(6)} p50 ${String(a[a.length>>1]).padStart(6)} max ${String(a[a.length-1]).padStart(6)} сумма ${a.reduce((s,v)=>s+v,0)}`);}}
function rdSlot(x,off){return off===4?x.hi0b:x.hi0c;}
// --- 1. состав по длине
const byN={};for(const p of packs){const b=byN[p.n]||(byN[p.n]={n:0,fast:0,wl:0,pr:0,tot:0});
  b.n++;if(p.fast)b.fast++;for(const x of p.o){b.tot++;if(x.wl)b.wl++;else if(x.pr)b.pr++;}}
console.log("ДЛИНА -> пачек / из них слитых / объектов ПЕРЕСЧИТАНО / по СТАРОЙ ЗАПИСИ / прочих:");
for(const k of Object.keys(byN).sort((a,b)=>a-b)){const b=byN[k];
  console.log(`  ${String(k).padStart(2)}: ${String(b.n).padStart(4)} пачек, слитых ${String(b.fast).padStart(4)}, объектов ${b.tot}: пересчёт ${b.pr}, старая запись ${b.wl}, прочих ${b.tot-b.pr-b.wl}`);}

// --- 2. где стоит пара
{const h={};for(const p of packs){const key=p.mix===0xFE?(p.at===0xFF?"нет пары":"at "+p.at):"mix "+p.mix;h[key]=(h[key]||0)+1;}
 console.log("ПОЗИЦИЯ ПАРЫ:",Object.entries(h).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}: ${v}`).join(" | "));}
// пара за границей капа?
{let bad=0,badN=0;for(const p of packs){if(p.n<=K)continue;badN++;
  const pos=p.mix!==0xFE?p.mix:(p.at!==0xFF?p.at:-1);
  if(pos>=0&&pos+1>=K)bad++;}
 console.log(`  пачек длиннее ${K}: ${badN}, из них ПАРА целиком/частично за границей: ${bad}`);}
// где герой (слоты 4/5) в порядке вывода
{let heroBeyond=0,heroN=0;for(const p of packs){if(p.n<=K)continue;
  const hp=p.o.map((x,i)=>[x.idx,i]).filter(([id])=>id===4||id===5).map(([,i])=>i);
  if(!hp.length)continue;heroN++;if(Math.max(...hp)>=K)heroBeyond++;}
 console.log(`  пачек длиннее ${K} с героем: ${heroN}, из них слот 4/5 за границей: ${heroBeyond}`);}

// --- 3. безопасность резки по строкам (объединение габаритов шапки и записи)
const lo=x=>[Math.min(x.hLo,x.rLo),Math.max(x.hLo,x.rLo)];   // [низ,верх] в lo0
function rowsHit(a,b){const A=lo(a),B=lo(b);return !(A[0]-15>B[1]||B[0]-15>A[1]);}
function colsHit(a,b){const c=(h,n)=>[h&0x1F,(h&0x1F)+n];
  const A1=c(a.hHi,a.hNc),A2=c(a.rHi,a.rNc),B1=c(b.hHi,b.hNc),B2=c(b.rHi,b.rNc);
  const A=[Math.min(A1[0],A2[0]),Math.max(A1[1],A2[1])],B=[Math.min(B1[0],B2[0]),Math.max(B1[1],B2[1])];
  return !(A[1]<=B[0]||B[1]<=A[0]);}
{let n=0,safeRows=0,safeFull=0,fastN=0;
 for(const p of packs){if(p.n<=K)continue;n++;if(p.fast)fastN++;
   let r=true,f=true;
   for(let i=K;i<p.n;i++)for(let j=0;j<K;j++){
     if(rowsHit(p.o[i],p.o[j])){r=false;if(colsHit(p.o[i],p.o[j]))f=false;}}
   if(r)safeRows++;if(f)safeFull++;}
 console.log(`РЕЗКА по границе ${K}: пачек ${n}; слитых (резать можно всегда) ${fastN};`);
 console.log(`   безопасна ТОЛЬКО по строкам: ${safeRows} (${(100*safeRows/n).toFixed(1)}%)`);
 console.log(`   безопасна по строкам+столбцам: ${safeFull} (${(100*safeFull/n).toFixed(1)}%)`);
 // сколько ЕДИНСТВЕННОЕ сравнение соседей (сортировка по rLo) даёт то же самое
 let one=0;for(const p of packs){if(p.n<=K)continue;
   if(p.o[K].rLo<=p.o[K-1].rLo-16)one++;}
 console.log(`   граничное сравнение lo0(ord[${K}]) <= lo0(ord[${K-1}])-16 срабатывает: ${one}`);}

// --- 4. старвейшн: имитируем кап и считаем, сколько тиков подряд слот не выводится
{const wait={},hist={};let maxw=0,worst=null;
 for(const p of packs){
   const shown=new Set(), pos=p.mix!==0xFE?p.mix:(p.at!==0xFF?p.at:-1);
   for(let i=0;i<Math.min(K,p.n);i++)shown.add(p.o[i].idx);
   if(pos>=0){shown.add(p.o[pos].idx);if(pos+1<p.n)shown.add(p.o[pos+1].idx);}
   for(const x of p.o){
     if(shown.has(x.idx)){const w=wait[x.idx]||0;hist[w]=(hist[w]||0)+1;
       if(w>maxw){maxw=w;worst=x.idx;}wait[x.idx]=0;}
     else wait[x.idx]=(wait[x.idx]||0)+1;}}
 console.log(`СТАРВЕЙШН (имитация): максимум пропущенных подряд пачек ${maxw} (слот ${worst})`);
 console.log("   пропущено подряд -> случаев: "+Object.keys(hist).sort((a,b)=>a-b).map(k=>`${k}:${hist[k]}`).join(" "));}
