// shift_shape.js — ФОРМА СДВИГА ГАБАРИТА: как часто переезд по столбцам/смена ширины.
// На каждом входе vsm_ph3 читает vsm_dc/vsm_d/vsm_no/vsb_nc и считает такты фаз 1 и 3.
"use strict";
const {make}=require("../verify/beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const TICKS=+(process.argv[4]||1200);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu}=E;
const hist=new Map();let n=0;
let gs=0;
// плоский профиль по группам меток фаз
const marks=[];for(const k in L){const a=L[k];if(a>=0x0100&&a<0x7600)marks.push([a,k]);}
marks.sort((x,y)=>x[0]-y[0]);
const MAP=new Uint16Array(0x8000);
{let j=0;for(let a=0;a<0x8000;a++){while(j+1<marks.length&&marks[j+1][0]<=a)j++;MAP[a]=j;}}
const G={p1:0,p2:0,p3:0,book:0,other:0};
const NAME={};for(let i=0;i<marks.length;i++)NAME[i]=marks[i][1];
const grp=n=>{
  if(/^vsm_p1/.test(n))return /r$/.test(n)?"p1":"book";
  if(/^vsm_p2/.test(n))return "p2";
  if(/^vsm_p3/.test(n))return /r$/.test(n)?"p3":"book";
  if(/^vsm_(next|ph|phc|ph1|ph3|dir|neg|shift)/.test(n))return "book";
  return null;};
let bursts=0,inOut=false,oret=-1,osp=0;
const OUT=L.vec_spr_out;const memory=E.memory;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  if(inOut){const g=grp(NAME[MAP[cpu.pc&0x7fff]]);oI();if(g)G[g]+=cpu.vcycles|0;}
  else oI();};
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(gs!==5)return false;
  if(pc===OUT&&!inOut){osp=cpu.sp;oret=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);inOut=true;}
  else if(inOut&&pc===oret&&cpu.sp>osp){inOut=false;bursts++;}
  if(pc===L.vsm_ph3){
    const dc=(rd(L.vsm_dc)<<24>>24),d=(rd(L.vsm_d)<<24>>24),no=rd(L.vsm_no),nc=rd(L.vsb_nc);
    const k=`dc=${dc} dn=${nc-no} |d|=${Math.abs(d)} nc=${nc}`;
    hist.set(k,(hist.get(k)||0)+1);n++;}
  return false;};
function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);}else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);}else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);}else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);}else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);}return k;}
{let heldS=new Set(),tick=0,prevT=0,nf=0;
 while(tick<=TICKS&&nf<400000){
   const want=new Set(keysFor(tick));
   for(const c of heldS)if(!want.has(c))E.key(c,0);
   for(const c of want)if(!heldS.has(c))E.key(c,1);
   heldS=want;gs=rd(L.GameStatus);v06c.oneInterrupt(true);nf++;
   const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;}}}
console.log(`вызовов vsm_ph3 (плоскость-объект со сдвигом): ${n}, пачек ${bursts}`);
const rows=[...hist.entries()].sort((a,b)=>b[1]-a[1]);
for(const [k,v] of rows.slice(0,20))console.log(`  ${k.padEnd(34)} ${v}  (${(100*v/n).toFixed(1)}%)`);
console.log(`ТАКТЫ в пачке: копирование фазы1 ${G.p1} (${(G.p1/bursts).toFixed(0)}/пачку), фазы3 ${G.p3} (${(G.p3/bursts).toFixed(0)}), фаза2 ${G.p2} (${(G.p2/bursts).toFixed(0)}), БУХГАЛТЕРИЯ фаз ${G.book} (${(G.book/bursts).toFixed(0)})`);
