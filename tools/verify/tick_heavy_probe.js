// От чего тик становится длинным: связываем длительность тика с тем, что в этот момент
// выводится — число объектов в пачке, многоплоскостные, непрозрачное перекрытие, скролл.
const {make}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {L,rd,v06c,cpu,cyc,FRAME}=E;
function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);}
  else if(t<1300){k.push(t&8?39:37);}
  else if(t<1600){k.push(t&8?38:39);}
  else {k.push(t&8?37:39);}
  return k;}
let held=new Set(),tick=0,frames=0,prev=0,inTick=false,acc=0;
const rows=[];
let curN=0,curMulti=0,curOpaque=0,curScroll=0;
const now=()=>frames*FRAME+cyc();
v06c.check_breakpoint=function(){
  const t=now();
  if(inTick){let d=t-prev;if(d<0)d+=FRAME;if(d>0&&d<4000)acc+=d;}
  prev=t;
  if(cpu.pc===L.vec_spr_out){
    curN=rd(L.vsp_n); curMulti=0;
    for(let s=0;s<21;s++){const p=0xE000+s*0x100;
      if(rd(p+0x96)===1&&(rd(p+0x9A)||rd(p+0x9B)))curMulti++;}
    curOpaque=rd(L.vop_i1)?1:0;
    curScroll=rd(L.flagScrolling!==undefined?L.flagScrolling:L.GameStatus)?1:0;
  }
  if(cpu.pc===L.runGame&&!inTick){inTick=true;acc=0;}
  else if(cpu.pc===L.tickMain2&&inTick){inTick=false;
    if(acc>0)rows.push({d:acc,n:curN,m:curMulti,o:curOpaque});}
  return false;
};
let prevTimer=rd(L.timer);
while(tick<=900&&frames<40000){
  const want=new Set(keysFor(tick));
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  v06c.oneInterrupt(true);frames++;
  const tm=rd(L.timer); if(tm!==prevTimer){tick++;prevTimer=tm;}
}
v06c.check_breakpoint=()=>false;
const q=(a,x)=>a.length?a.slice().sort((u,v)=>u-v)[Math.min(a.length-1,Math.floor(a.length*x))]:0;
const all=rows.map(r=>r.d);
console.log(`тиков ${rows.length}: p50 ${q(all,.5)} p90 ${q(all,.9)} max ${q(all,1)} (кадр ${FRAME}, бюджет 30 Гц = ${Math.round(FRAME*50/30)})`);
const byN={};
for(const r of rows)(byN[r.n]=byN[r.n]||[]).push(r.d);
console.log("по числу объектов в пачке:");
for(const n of Object.keys(byN).sort((a,b)=>a-b)){const a=byN[n];
  if(a.length<5)continue;
  console.log(`   объектов ${n}: тиков ${String(a.length).padStart(4)}  p50 ${String(q(a,.5)).padStart(6)}  p90 ${String(q(a,.9)).padStart(6)}`);}
const mm={};
for(const r of rows)(mm[r.m]=mm[r.m]||[]).push(r.d);
console.log("по числу многоплоскостных объектов:");
for(const n of Object.keys(mm).sort((a,b)=>a-b)){const a=mm[n];if(a.length<5)continue;
  console.log(`   многоплоскостных ${n}: тиков ${String(a.length).padStart(4)}  p50 ${String(q(a,.5)).padStart(6)}  p90 ${String(q(a,.9)).padStart(6)}`);}
const op={0:[],1:[]};
for(const r of rows)op[r.o].push(r.d);
console.log(`непрозрачное перекрытие героя: нет — p50 ${q(op[0],.5)} (${op[0].length}), есть — p50 ${q(op[1],.5)} (${op[1].length})`);
