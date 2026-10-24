// mummy_survey.js — раскладка ЦЕНЫ КАДРА по КАТЕГОРИЯМ ОБЪЕКТОВ (мумии / герой / прочее).
//
// Что считает (такты i8080, как beam_ops.js):
//   ТИК        — vec_nat_sprites целиком (флаги + распространение + подготовки)
//   ПОДГОТОВКА — vec_spr_prep (геометрия + сдвиг спрайта в буфер слота)
//   СДВИГ      — vsp_pat (выбор паттерна + зеркало + сборка сдвинутого спрайта) — часть подготовки
//   ПАЧКА      — vec_spr_out целиком; в разрезе vec_su_restore/vec_su_save/vec_spr_show
// Разрез по слотам: 0-3 ворота, 4-5 герой, 6-13 мумии, 15-18 нож, 19-20 карта.
// Считаются ТОЛЬКО кадры геймплея (GameStatus=5).
//
// Запуск: node tools/verify/mummy_survey.js [rom] [sym] [кадров на пирамиду] [пирамид]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const PF=+(process.argv[4]||900), NP=+(process.argv[5]||8);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;
let TT=0;const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}

const cat=i=>i<4?"ворота":i<6?"герой":i<14?"мумии":i<19?"нож":"карта";
const cats=["ворота","герой","мумии","нож","карта"];
const BP={P:L.vec_spr_prep,G:L.vsp_pat,R:L.vec_su_restore,S:L.vec_su_save,D:L.vec_spr_show,
          T:L.vec_nat_sprites,O:L.vec_spr_out};
const st={};for(const k in BP)st[k]={ret:-1,sp:-1,t0:0,idx:0};
const sum={},cnt={};for(const k in BP){sum[k]={};cnt[k]={};}
const frameSum={};for(const k in BP)frameSum[k]={};
let frames=0, live=false;
let curF=null;
const mumHist=new Array(10).fill(0), visHist=new Array(10).fill(0), heroHist=new Array(4).fill(0);
const planeHist={}, shiftHist={}, patSet={}, prepByShift={}, prepByMirror={}, shiftCost={};
let mumVisTotal=0;

function acc(k,c,d){sum[k][c]=(sum[k][c]||0)+d;cnt[k][c]=(cnt[k][c]||0)+1;
  if(curF&&live){curF[k][c]=(curF[k][c]||0)+d;}}
function flushFrame(){
  if(curF&&curF.live){
    for(const k in BP)for(const c in curF[k])frameSum[k][c]=(frameSum[k][c]||0)+curF[k][c];
    mumHist[Math.min(9,curF.nm)]++;heroHist[Math.min(3,curF.nh)]++;
    let v=0;for(let i=6;i<14;i++)if(rd(L.sprAttrib+i*4)<0xD0)v++;
    visHist[Math.min(9,v)]++;mumVisTotal+=v;frames++;
  }
  const F={live};for(const k in BP)F[k]={};F.nm=0;F.nh=0;curF=F;
}
flushFrame();

v06c.check_breakpoint=function(){const pc=cpu.pc;
  for(const k in BP){const b=st[k];
    if(pc===BP[k]&&b.ret<0){
      b.sp=cpu.sp;b.ret=retOf();b.t0=TT;b.idx=rd(L.vec_nsp_idx);
      if(k==="P"||k==="G"){
        const i=b.idx,c=cat(i);
        const y=rd(L.sprAttrib+i*4),x=rd(L.sprAttrib+i*4+1),p=rd(L.sprAttrib+i*4+2);
        b.x=x;b.pat=p;b.vis=y<0xD0;b.s=x&7;b.mir=(p>=0x60&&p<0x94)?1:0;
        if(k==="P"&&b.vis&&live){
          (shiftHist[c]=shiftHist[c]||new Array(8).fill(0))[b.s]++;
          (patSet[c]=patSet[c]||new Set()).add(p);
          if(c==="мумии")curF.nm++;if(c==="герой")curF.nh++;
        }
      }
    }
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){
      const d=TT-b.t0,i=b.idx,c=(k==="T"||k==="O")?"ВСЁ":cat(i);b.ret=-1;
      acc(k,c,d);
      if(!live)continue;
      if(k==="P"&&b.vis){
        ((prepByShift[c]=prepByShift[c]||{})[b.s]=(prepByShift[c]||{})[b.s]||[]).push(d);
        ((prepByMirror[c]=prepByMirror[c]||{})[b.mir]=(prepByMirror[c]||{})[b.mir]||[]).push(d);
        const pg=0xE000+i*256,np=1+(rd(pg+0x9A)?1:0)+(rd(pg+0x9B)?1:0),nc=rd(pg+0x99);
        planeHist[`${c} пл=${np} стлб=${nc}`]=(planeHist[`${c} пл=${np} стлб=${nc}`]||0)+1;
      }
      if(k==="G"&&b.vis){((shiftCost[c]=shiftCost[c]||{})[b.s]=(shiftCost[c]||{})[b.s]||[]).push(d);}
    }
  }
  return false;};

// ---- драйвер: по пирамидам, учитываем ТОЛЬКО кадры геймплея ----
// --- ДРАЙВЕР СЦЕНЫ ---------------------------------------------------------------
// По умолчанию — псевдослучайный ввод ПО КАДРАМ (историческая сцена этого инструмента).
// С флагом --ticks N ввод подаётся ПО ИГРОВЫМ ТИКАМ по расписанию coltab_frame_parity:
// тогда две сборки с РАЗНОЙ скоростью играют ОДНУ И ТУ ЖЕ партию, и их метрики
// сравнимы. Без этого более быстрая сборка успевает уйти в другую комнату, и разница
// в цифрах — это разница сцен, а не правки.
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
let seed=2024;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const KS=[37,39,38,40];let held=-1;
function step(){v06c.oneInterrupt(true);live=(rd(L.GameStatus)===5);flushFrame();}
if(NT){
  let tick=0,prevT=rd(L.timer),heldSet=new Set(),guard=0;
  while(tick<=NT&&guard++<400000){
    const want=new Set(keysForTick(tick));
    for(const c of heldSet)if(!want.has(c))E.key(c,0);
    for(const c of want)if(!heldSet.has(c))E.key(c,1);
    heldSet=want;
    step();
    const t=rd(L.timer); if(t!==prevT){prevT=t;tick++;}
  }
}else
for(let p=0;p<NP;p++){
  if(p>0){ // переход на следующую пирамиду
    live=false;E.key(78,1);step();E.key(78,0);
    for(let i=0;i<3000&&rd(L.GameStatus)!==5;i++)step();
    for(let i=0;i<40;i++)step();
  }
  for(let f=0;f<PF;f++){
    if(f%17===0){const k=KS[(rnd()*4)|0];if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
    step();
    if(rd(L.GameStatus)!==5){ // смерть/переход — дождаться геймплея
      for(let i=0;i<3000&&rd(L.GameStatus)!==5;i++)step();
    }
  }
  if(held>0){E.key(held,0);held=-1;}
}

console.log(`кадров ГЕЙМПЛЕЯ: ${frames};  видимых мумий в среднем ${(mumVisTotal/frames).toFixed(2)}`);
console.log("\n=== ТАКТОВ НА КАДР ГЕЙМПЛЕЯ (среднее) ===");
console.log(`  vec_nat_sprites (тик, весь)   ${((frameSum.T["ВСЁ"]||0)/frames).toFixed(0).padStart(7)}`);
console.log(`  vec_spr_out     (пачка, вся)  ${((frameSum.O["ВСЁ"]||0)/frames).toFixed(0).padStart(7)}`);
console.log("\nкатегория   подгот.  из них сдвиг  стирание  сохран.  вывод   ПАЧКА(сумма)  ИТОГО  подгот./кадр");
let tot={P:0,G:0,R:0,S:0,D:0};
for(const c of cats){
  const P=(frameSum.P[c]||0)/frames,G=(frameSum.G[c]||0)/frames,R=(frameSum.R[c]||0)/frames,
        S=(frameSum.S[c]||0)/frames,D=(frameSum.D[c]||0)/frames;
  tot.P+=P;tot.G+=G;tot.R+=R;tot.S+=S;tot.D+=D;
  console.log(`${c.padEnd(10)} ${P.toFixed(0).padStart(7)} ${G.toFixed(0).padStart(13)} ${R.toFixed(0).padStart(9)} ${S.toFixed(0).padStart(8)} ${D.toFixed(0).padStart(7)} ${(R+S+D).toFixed(0).padStart(13)} ${(P+R+S+D).toFixed(0).padStart(6)}  ${((cnt.P[c]||0)/frames).toFixed(2)}`);
}
console.log(`${"ВСЕГО".padEnd(10)} ${tot.P.toFixed(0).padStart(7)} ${tot.G.toFixed(0).padStart(13)} ${tot.R.toFixed(0).padStart(9)} ${tot.S.toFixed(0).padStart(8)} ${tot.D.toFixed(0).padStart(7)} ${(tot.R+tot.S+tot.D).toFixed(0).padStart(13)} ${(tot.P+tot.R+tot.S+tot.D).toFixed(0).padStart(6)}`);

console.log("\n=== СРЕДНЯЯ ЦЕНА ОДНОГО ВЫЗОВА (тактов) ===");
console.log("категория   подгот.  сдвиг(vsp_pat)  стирание  сохран.  вывод   n подг.");
for(const c of cats){
  const f=k=>cnt[k][c]?(sum[k][c]/cnt[k][c]).toFixed(0):"-";
  console.log(`${c.padEnd(10)} ${f("P").padStart(7)} ${f("G").padStart(15)} ${f("R").padStart(9)} ${f("S").padStart(8)} ${f("D").padStart(7)}   ${cnt.P[c]||0}`);
}

console.log("\n=== ГЕОМЕТРИЯ (плоскостей x столбцов), доля вызовов подготовки ===");
const tp=Object.values(planeHist).reduce((a,b)=>a+b,0);
for(const k of Object.keys(planeHist).sort())console.log(`  ${k.padEnd(24)} ${String(planeHist[k]).padStart(7)}  ${(100*planeHist[k]/tp).toFixed(1)}%`);

console.log("\n=== МУМИЙ ВИДИМО в кадре / ПОДГОТОВЛЕНО за кадр ===");
for(let i=0;i<10;i++)if(visHist[i]||mumHist[i])
  console.log(`  ${i}: видимо ${String(visHist[i]).padStart(6)} (${(100*visHist[i]/frames).toFixed(1)}%)   подготовлено ${String(mumHist[i]).padStart(6)} (${(100*mumHist[i]/frames).toFixed(1)}%)`);
console.log(`  среднее подготовок ${(mumHist.reduce((a,v,i)=>a+v*i,0)/frames).toFixed(2)} мумии/кадр`);
console.log("=== СПРАЙТОВ ГЕРОЯ ПОДГОТОВЛЕНО за кадр ===");
heroHist.forEach((v,i)=>{if(v)console.log(`  ${i}: ${v} (${(100*v/frames).toFixed(1)}%)`);});

console.log("\n=== СДВИГ X&7, доля ===");
for(const c of cats){const h=shiftHist[c];if(!h)continue;const n=h.reduce((a,b)=>a+b,0);
  console.log(`  ${c.padEnd(8)} n=${String(n).padStart(6)}  `+h.map((v,i)=>`${i}:${(100*v/n).toFixed(0)}%`).join(" "));}
console.log("\n=== ЦЕНА vsp_pat (сдвиг+зеркало) ПО СДВИГУ, тактов ===");
for(const c of cats){const m=shiftCost[c];if(!m)continue;const row=[];
  for(let s=0;s<8;s++){const a=m[s];row.push(a?`${s}:${Math.round(a.reduce((x,y)=>x+y,0)/a.length)}`:`${s}:-`);}
  console.log(`  ${c.padEnd(8)} ${row.join("  ")}`);}
console.log("\n=== ЦЕНА ПОДГОТОВКИ: обычный / зеркало ===");
for(const c of cats){const m=prepByMirror[c];if(!m)continue;
  const f=k=>m[k]?`${Math.round(m[k].reduce((x,y)=>x+y,0)/m[k].length)} (n=${m[k].length})`:"-";
  console.log(`  ${c.padEnd(8)} обычный ${f(0)}   зеркало ${f(1)}`);}
console.log("\n=== ПАТТЕРНЫ (уникальные) ===");
for(const c of cats){const s=patSet[c];if(!s)continue;const a=[...s].sort((x,y)=>x-y);
  console.log(`  ${c.padEnd(8)} ${a.length} шт: ${a.map(v=>"0x"+v.toString(16)).join(" ")}`);}
