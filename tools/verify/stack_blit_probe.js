// stack_blit_probe.js — КТО И СКОЛЬКО РАЗ ЗОВЁТ ЯДРА СТОЛБЦА (задача#53, стек-блит).
//
// ЗАДАЧА#53 (2026-08-07): ядра vsz_mcol/vsz_merge заменены стек-блитом, поэтому здесь
// считаются входы в его петлю (vpz_col = половина A столбца, vpz_bh = половина B).
// ЗАЧЕМ. burst_cost даёт ТАКТЫ по меткам, но не число вызовов и не вызывающего. Чтобы
// посчитать цену стек-блита ДО правки, нужно знать: сколько столбцов пишет пара (vpr_wr),
// сколько одиночная слитая запись (vsz_merge), сколько многоплоскостная (vsm_cw), и какой
// у них ncols. Считаем по АДРЕСУ ВОЗВРАТА в момент входа в ядро.
// Запуск: node tools/verify/stack_blit_probe.js [rom] [sym] [тиков=1200]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const TICKS=+(process.argv[4]||1200);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu,memory}=E;
const OUT=L.vec_spr_out;

const marks=[];
for(const k in L){const a=L[k];if(a>=0x0100&&a<0x7600)marks.push([a,k]);}
marks.sort((x,y)=>x[0]-y[0]);
const nameOf=a=>{let lo=0,hi=marks.length-1,r="?";
  while(lo<=hi){const m=(lo+hi)>>1;if(marks[m][0]<=a){r=marks[m][1];lo=m+1;}else hi=m-1;}return r;};

const HOT=new Uint8Array(0x10000);
let gs=0,inOut=false,oret=-1,osp=0,bursts=0;
const cnt={};       // ядро -> {вызыватель -> число}
const ncolsHist={}; // ncols на вызов vpr_wr / vsz_merge
const kern={vsb_mcol:L.vsb_mcol,vsn_col:L.vsn_col,vpz_col:L.vpz_col,vpz_bh:L.vpz_bh};
const entry={vpr_wr:L.vpr_wr,vpz_pair:L.vpz_pair,vsz_merge:L.vsz_merge,vpz_wr:L.vpz_wr,
  vsb_merge:L.vsb_merge,vsm_cw:L.vsm_cw,vsb_mrow:L.vsb_mrow,vsm_multi:L.vsm_multi};
const ecnt={};
for(const k in kern)if(kern[k]!==undefined)HOT[kern[k]]=1;
for(const k in entry)if(entry[k]!==undefined)HOT[entry[k]]=1;
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(gs!==5)return false;
  if(pc===OUT&&!inOut){osp=cpu.sp;oret=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);inOut=true;}
  else if(inOut&&pc===oret&&cpu.sp>osp){inOut=false;bursts++;}
  if(!HOT[pc&0xffff])return false;
  for(const k in kern) if(pc===kern[k]){
    // vpz_* — ГОЛОВЫ ПЕТЛИ под SP-хайджеком: вызывающего по стеку не восстановить
    // (в SP лежит буфер спрайта), поэтому у них считаем только число проходов.
    const n=k.startsWith("vpz")?"(петля)":
      nameOf((memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8))-3);
    (cnt[k]=cnt[k]||{})[n]=((cnt[k]||{})[n]||0)+1;}
  for(const k in entry) if(pc===entry[k]){
    ecnt[k]=(ecnt[k]||0)+1;
    const nc=rd(L.vsb_nc);(ncolsHist[k]=ncolsHist[k]||{})[nc]=((ncolsHist[k]||{})[nc]||0)+1;}
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
{let heldS=new Set(),tick=0,nf=0,prevT=0;
 while(tick<=TICKS&&nf<400000){
   const want=new Set(keysFor(tick));
   for(const c of heldS)if(!want.has(c))E.key(c,0);
   for(const c of want)if(!heldS.has(c))E.key(c,1);
   heldS=want;
   gs=rd(L.GameStatus);
   v06c.oneInterrupt(true);nf++;
   const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;}
 }}
console.log("пачек",bursts);
console.log("ВХОДЫ:");
for(const k in ecnt)console.log("  %s: %d, ncols %s",k,ecnt[k],JSON.stringify(ncolsHist[k]));
console.log("ЯДРА СТОЛБЦА (вызовов по вызывающему):");
for(const k in cnt){let s=0;for(const c in cnt[k])s+=cnt[k][c];
  console.log("  %s: всего %d",k,s);
  for(const c of Object.keys(cnt[k]).sort((a,b)=>cnt[k][b]-cnt[k][a]))console.log("      "+c.padEnd(14)+" "+cnt[k][c]);}
