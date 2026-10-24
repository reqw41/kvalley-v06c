// beam_budget.js — РАЗВЕДКА ЦЕНЫ ОБЪЕКТА для бюджетного решателя вывода (задача #46).
// Что меряет (те же кадры/ввод, что beam_late.js — сравнимо один-в-один):
//   1) ЦЕНА объекта в тактах по фазам (restore/save/show и слитый merge) в разрезе
//      «ncols x число плоскостей x путь» -> отсюда берётся КОЭФФИЦИЕНТ модели цены;
//   2) СТАРТ ПАЧКИ от прерывания (outS) -> отсюда берётся константа K дедлайна:
//      объект успевает, если накопленная цена (в строках луча) <= Ytop + K, где
//      K = (BEAM0 - outS)/192;
//   3) «позже луча» в разбивке по зонам Ytop и ПО ПУТИ (слитый/старый).
// БАЗА ЛУЧА берётся из .sym (vec_vscroll), а НЕ константой.
// [ЗАДАЧА#56, 2026-08-10] РЕЖИМ `low` СНЯТ: клавиши L (переключатель ЦЕНТР<->НИЗ) больше
// нет — положение экрана снова ОДНО, vec_vscroll=0x27 (табло в кайме, картинка
// перецентрована). Аргумент `low` теперь молча игнорируется.
// Запуск: node tools/verify/beam_budget.js [rom] [sym] [кадров]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||8000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;
const VS=L.vec_vscroll===undefined?0x1F:L.vec_vscroll;
const BEAM0=13780+192*((VS-0x1F)&255);
const ISR=L.vec_isr,OUT=L.vec_spr_out,SHOW=L.vec_spr_show,REST=L.vec_su_restore,
      SAVE=L.vec_su_save,MERGE=L.vso_merge1,PAIRW=L.vpr_wr;
let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
let cur=null;const frames=[];let pend=[];
const B={out:{pc:OUT},show:{pc:SHOW},merge:{pc:MERGE},pairw:{pc:PAIRW},rest:{pc:REST},save:{pc:SAVE}};
for(const k in B){B[k].ret=-1;B[k].sp=-1;}
function rec(i){const pg=0xE000+i*256;return{i,
  hval:rd(pg),hhi:rd(pg+1),hlo:rd(pg+2),hnc:rd(pg+3),hb:rd(pg+4)?1:0,hc:rd(pg+5)?1:0,
  hi0:rd(pg+0x97),lo0:rd(pg+0x98),nc:rd(pg+0x99),pb:rd(pg+0x9F)?1:0,pc:rd(pg+0x9B)?1:0,
  sb:rd(pg+0x9A)?1:0,pend:rd(pg+0x96)};}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0){
    if(cur)frames.push(cur);
    cur={irq:TT,outS:-1,outE:-1,fast:0,n:0,draws:[],rest:[],save:[],gs:rd(L.GameStatus)};}
  if(!cur)return false;
  for(const k in B){const b=B[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();
      if(k==="out"){cur.outS=TT;cur.fast=rd(L.vsp_fast);cur.n=rd(L.vsp_n);}
      else {b.d=rec(rd(L.vec_nsp_idx));b.d.t0=TT;}}
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){b.ret=-1;
      if(k==="out")cur.outE=TT;
      else if(k==="pairw"){for(const d of pend){d.t1=TT;d.pair=1;cur.draws.push(d);}pend=[];}
      else if(k==="merge"&&rd(L.vpr_def)){b.d.merge=1;pend.push(b.d);}
      else if(k==="show"||k==="merge"){b.d.t1=TT;b.d.merge=(k==="merge")?1:0;cur.draws.push(b.d);}
      else if(k==="rest"){b.d.t1=TT;cur.rest.push(b.d);}
      else if(k==="save"){b.d.t1=TT;cur.save.push(b.d);}}}
  return false;};
// --- ДРАЙВЕР СЦЕНЫ. По умолчанию — ввод ПО КАДРАМ (сцена beam_late.js, сравнима с ним).
// С флагом --ticks N ввод идёт ПО ИГРОВЫМ ТИКАМ по расписанию coltab_frame_parity: только
// так две сборки с РАЗНОЙ скоростью играют ОДНУ И ТУ ЖЕ партию. Для A/B правки, меняющей
// такты, годится ТОЛЬКО этот режим — иначе сравниваются разные сцены, а не сборки.
const TI=process.argv.indexOf("--ticks"), NT=TI>0?+(process.argv[TI+1]||2600):0;
function keysForTick(t){
  const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000)k.push(39);
  else if(t<1010)k.push(78);
  else if(t<1300)k.push((t&8)?39:37);
  else if(t<1310)k.push(78);
  else if(t<1600)k.push((t&8)?38:39);
  else if(t<1640)k.push(78);
  else if(t<2000)k.push((t&8)?39:37);
  else if(t<2060)k.push(78);
  else k.push((t&8)?37:39);
  return k;
}
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
if(NT){
  let tick=0,prevT=rd(L.timer),heldSet=new Set(),guard=0;
  while(tick<=NT&&guard++<400000){
    const want=new Set(keysForTick(tick));
    for(const c of heldSet)if(!want.has(c))E.key(c,0);
    for(const c of want)if(!heldSet.has(c))E.key(c,1);
    heldSet=want;
    if(cur)cur.gs=rd(L.GameStatus);
    v06c.oneInterrupt(true);
    const t=rd(L.timer); if(t!==prevT){prevT=t;tick++;}
  }
  for(const c of heldSet)E.key(c,0);
}else{
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  if(cur)cur.gs=rd(L.GameStatus);
  v06c.oneInterrupt(true);
}
if(held>0)E.key(held,0);}
if(cur)frames.push(cur);

const st=a=>{if(!a.length)return"—";a=a.slice().sort((x,y)=>x-y);
  return `n=${a.length} avg ${(a.reduce((s,v)=>s+v,0)/a.length).toFixed(1)} p50 ${a[a.length>>1]} p90 ${a[(a.length*0.9)|0]} max ${a[a.length-1]}`;};
const buck={};
function put(tag,v){(buck[tag]=buck[tag]||[]).push(v);}
let gsF=0,outSa=[],objs=0,late=0,lateF=0,fastF=0;
const Z=[[0,48],[48,64],[64,96],[96,192]];
const zt=Z.map(()=>0),zl=Z.map(()=>0),zpx=Z.map(()=>0);
let trObj=0,trPx=0;const wins=[];
for(const fr of frames){
  if(fr.gs!==5||fr.outS<0)continue;gsF++;if(fr.fast)fastF++;
  outSa.push(fr.outS-fr.irq);
  {const er={};for(const r of fr.rest)if(r.hval&&r.hnc)er[r.i]=r.t1;
   for(const d of fr.draws){if(!d.nc)continue;const Y=240-d.lo0;if(Y<0||Y>190)continue;
     const et=er[d.i];if(et===undefined)continue;
     wins.push(d.t1-et);let px=0;
     for(let k=0;k<16;k++){const bt=fr.irq+BEAM0+192*(Y+k);if(bt>et&&bt<d.t1)px+=d.nc*8;}
     if(px){trObj++;trPx+=px;const zi=Z.findIndex(z=>Y>=z[0]&&Y<z[1]);if(zi>=0)zpx[zi]+=px;}}}
  for(const d of fr.rest)if(d.hval&&d.hnc)put(`restore nc=${d.hnc} pl=${1+d.hb+d.hc}`,(d.t1-d.t0)/d.hnc/(1+d.hb+d.hc));
  for(const d of fr.save)if(d.nc&&d.pend<2)put(`save    nc=${d.nc} pl=${1+d.sb+d.pc}`,(d.t1-d.t0)/d.nc/(1+d.sb+d.pc));
  for(const d of fr.draws){
    if(!d.nc)continue;
    const pl=1+d.pb+d.pc, mg=d.merge||d.pair;
    put(`${mg?"merge  ":"show   "} nc=${d.nc} pl=${pl}${d.pair?" пара":""}`,(d.t1-d.t0)/d.nc/pl);
    const Ytop=240-d.lo0; if(Ytop<0||Ytop>190)continue;
    objs++;
    const zi=Z.findIndex(z=>Ytop>=z[0]&&Ytop<z[1]);if(zi>=0)zt[zi]++;
    if(d.t1-fr.irq>BEAM0+192*Ytop){late++;if(mg)lateF++;if(zi>=0)zl[zi]++;}
  }
}
console.log(`ROM=${ROM.split("/").pop()} vec_vscroll=0x${VS.toString(16).toUpperCase()} база луча ${BEAM0} тактов`);
console.log(`кадров геймплея ${gsF} (слитых пачек ${fastF} = ${(100*fastF/gsF).toFixed(1)}%), объектов ${objs}`);
console.log(`ПОЗЖЕ ЛУЧА: ${late} (${(100*late/objs).toFixed(2)}%), из них на слитом пути ${lateF}`);
Z.forEach((z,i)=>console.log(`   Ytop ${String(z[0]).padStart(3)}..${String(z[1]-1).padStart(3)}: позже луча ${zl[i]}/${zt[i]} = ${zt[i]?(100*zl[i]/zt[i]).toFixed(1):"—"}%, транзиент ${zpx[i]} пикс`));
console.log(`ТРАНЗИЕНТ (луч между стиранием и выводом): ${trObj} объектов, ${trPx} пикс; ОКНО «разобран» ${st(wins)}`);
console.log(`СТАРТ ПАЧКИ от IRQ: ${st(outSa)}`);
{const a=outSa.slice().sort((x,y)=>x-y);
 if(a.length)console.log(`   K = (${BEAM0} - outS)/192: по avg ${((BEAM0-a.reduce((s,v)=>s+v,0)/a.length)/192).toFixed(1)}, по p90 ${((BEAM0-a[(a.length*0.9)|0])/192).toFixed(1)}, по max ${((BEAM0-a[a.length-1])/192).toFixed(1)}`);}
console.log(`ЦЕНА НА СТОЛБЕЦ*ПЛОСКОСТЬ (такты):`);
for(const k of Object.keys(buck).sort())console.log(`   ${k}: ${st(buck[k])}`);
const dump=frames.filter(f=>f.gs===5&&f.outS>=0).map(f=>({irq:f.irq,outS:f.outS,outE:f.outE,
  fast:f.fast,n:f.n,
  rest:f.rest.map(d=>({i:d.i,nc:d.hnc,pl:1+d.hb+d.hc,val:d.hval,hlo:d.hlo,hhi:d.hhi,t0:d.t0,t1:d.t1})),
  save:f.save.map(d=>({i:d.i,nc:d.nc,pl:1+d.sb+d.pc,pend:d.pend,t0:d.t0,t1:d.t1})),
  draws:f.draws.map(d=>({i:d.i,nc:d.nc,pl:1+d.pb+d.pc,lo0:d.lo0,hi0:d.hi0,hlo:d.hlo,hhi:d.hhi,
    hnc:d.hnc,hval:d.hval,merge:(d.merge||d.pair)?1:0,pair:d.pair|0,pend:d.pend,t0:d.t0,t1:d.t1}))}));
const out=T+"/../../build/beam_frames.json";
require("fs").writeFileSync(out,JSON.stringify(dump));
console.log(`сырьё: ${out.split("/").slice(-2).join("/")} (${dump.length} кадров)`);
