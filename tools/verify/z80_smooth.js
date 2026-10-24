// z80_smooth.js — ПЛАВНОСТЬ И БЮДЖЕТ КАДРА, ЕСЛИ БЫ ПРОЦЕССОР БЫЛ Z80.
// Тот же прогон и та же метрика, что у beam_late.js («кадров, где игровой тик кончается
// позже своего кадра»), но КАЖДАЯ исполненная инструкция оценивается ДВАЖДЫ: тактами
// i8080 (как их считает vector06js = как их считает проект) и тактами Z80 по модели шины
// Вектора (см. шапку z80_gain.js: слоты = M1 + память + порты + ceil(внутренние/4),
// такт = 4 слота; из RTL MiSTer у обоих процессоров один и тот же cpu_ready).
// Замены инструкций НЕТ — это цена ТОГО ЖЕ кода на другом процессоре (нижняя граница).
// Запуск: node tools/verify/z80_smooth.js [rom] [sym] [кадров]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||4000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;
const FR=59904;

function z80info(op,taken){
  if(op===0x76)return[4,0,0];
  if(op>=0x40&&op<0x80)return((op&7)===6||(op&0x38)===0x30)?[7,1,0]:[4,0,0];
  if(op>=0x80&&op<0xC0)return((op&7)===6)?[7,1,0]:[4,0,0];
  switch(op){
    case 0x00:case 0x07:case 0x0F:case 0x17:case 0x1F:
    case 0x27:case 0x2F:case 0x37:case 0x3F:
    case 0xE9:case 0xEB:case 0xF3:case 0xFB: return[4,0,0];
    case 0x01:case 0x11:case 0x21:case 0x31: return[10,2,0];
    case 0x02:case 0x12:case 0x0A:case 0x1A: return[7,1,0];
    case 0x22:case 0x2A: return[16,4,0];
    case 0x32:case 0x3A: return[13,3,0];
    case 0x03:case 0x13:case 0x23:case 0x33:
    case 0x0B:case 0x1B:case 0x2B:case 0x3B: return[6,0,0];
    case 0x34:case 0x35: return[11,2,0];
    case 0x36: return[10,2,0];
    case 0x09:case 0x19:case 0x29:case 0x39: return[11,0,0];
    case 0xE3: return[19,4,0];
    case 0xF9: return[6,0,0];
    case 0xC9: return[10,2,0];
    case 0xCD: return[17,4,0];
    case 0xC3: return[10,2,0];
    case 0xD3:case 0xDB: return[11,1,1];
  }
  if((op&0xC7)===0x04||(op&0xC7)===0x05)return[4,0,0];
  if((op&0xC7)===0x06)return[7,1,0];
  if((op&0xC7)===0xC6)return[7,1,0];
  if((op&0xC7)===0xC7)return[11,2,0];
  if((op&0xCF)===0xC1)return[10,2,0];
  if((op&0xCF)===0xC5)return[11,2,0];
  if((op&0xC7)===0xC2)return[10,2,0];
  if((op&0xC7)===0xC4)return taken?[17,4,0]:[10,2,0];
  if((op&0xC7)===0xC0)return taken?[11,2,0]:[5,0,0];
  return null;
}
function z80clk(op,taken){const it=z80info(op,taken);if(!it)return 12;
  const[t,mem,prt]=it;const inner=t-4-3*mem-4*prt;
  return 4*(1+mem+prt+(inner>0?Math.ceil(inner/4):0));}
const ZT=new Int16Array(256), ZTt=new Int16Array(256);
for(let o=0;o<256;o++){ZT[o]=z80clk(o,false);ZTt[o]=z80clk(o,true);}
const isCond=op=>((op&0xC7)===0xC4)||((op&0xC7)===0xC0);

// idle-регион (ei/halt): его такты в «работу» кадра не входят
const labels=[];for(const k in L)if(L[k]>=0&&L[k]<0x10000)labels.push([L[k],k]);
labels.sort((a,b)=>a[0]-b[0]);
let IDLE0=L.dummyLoop,IDLE1=0x10000;
for(const [a] of labels)if(a>IDLE0){IDLE1=a;break;}

let T8=0,TZ=0,idle8=0,idleZ=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc; oI();
  const vc=cpu.vcycles|0, op=rd(pc);
  let z;
  if(isCond(op)) z=((op&0xC7)===0xC4? (vc>=16):(vc>=12))?ZTt[op]:ZT[op]; else z=ZT[op];
  T8+=vc; TZ+=z;
  if(pc>=IDLE0&&pc<IDLE1){idle8+=vc;idleZ+=z;}
};
const ISR=L.vec_isr,TICK=L.H_TIMI;
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
let cur=null;const frames=[];let tret=-1,tsp=-1;
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0){
    if(cur)frames.push(cur);
    cur={i8:T8,iz:TZ,id8:idle8,idz:idleZ,e8:-1,ez:-1,gs:rd(L.GameStatus)};}
  if(!cur)return false;
  if(pc===TICK&&tret<0){tsp=cpu.sp;tret=retOf();}
  else if(tret>=0&&pc===tret&&cpu.sp>tsp){tret=-1;cur.e8=T8;cur.ez=TZ;}
  return false;};

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
if(cur)frames.push(cur);

// --- разбор ---
const st=a=>{a=a.slice().sort((x,y)=>x-y);const q=p=>a[Math.min(a.length-1,Math.floor(a.length*p))];
  return{avg:a.reduce((s,x)=>s+x,0)/a.length,p50:q(.5),p90:q(.9),p99:q(.99),max:a[a.length-1]};};
const d8=[],dz=[],w8=[],wz=[];let n=0,late8=0,latez=0;
for(let i=0;i+1<frames.length;i++){
  const f=frames[i],g=frames[i+1];
  if(f.gs!==5)continue;
  n++;
  const fw8=(g.i8-f.i8)-(g.id8-f.id8), fwz=(g.iz-f.iz)-(g.idz-f.idz);
  w8.push(fw8);wz.push(fwz);
  if(f.e8>=0){const a=f.e8-f.i8,b=f.ez-f.iz;d8.push(a);dz.push(b);if(a>FR)late8++;if(b>FR)latez++;}
}
const W8=st(w8),WZ=st(wz),D8=st(d8),DZ=st(dz);
console.log(`ROM=${ROM}  кадров геймплея: ${n}, кадр = ${FR} тактов`);
console.log(`\n=== РАБОТА В КАДРЕ (всё, кроме ei/halt) ===`);
console.log(`  i8080: avg ${W8.avg.toFixed(0)} (${(W8.avg/FR*100).toFixed(1)}%)  p50 ${W8.p50}  p90 ${W8.p90}  p99 ${W8.p99}  max ${W8.max}`);
console.log(`  Z80  : avg ${WZ.avg.toFixed(0)} (${(WZ.avg/FR*100).toFixed(1)}%)  p50 ${WZ.p50}  p90 ${WZ.p90}  p99 ${WZ.p99}  max ${WZ.max}`);
console.log(`  выигрыш: avg ${(W8.avg-WZ.avg).toFixed(0)} т/кадр (${((W8.avg-WZ.avg)/W8.avg*100).toFixed(1)}% работы, ${((W8.avg-WZ.avg)/FR*100).toFixed(1)} п.п. кадра); p90 ${(W8.p90-WZ.p90)}; max ${(W8.max-WZ.max)}`);
console.log(`\n=== ЗАГРУЖЕННЫЕ КАДРЫ (работа i8080 > 40000 тактов) ===`);
const hi=[];for(let i=0;i<w8.length;i++)if(w8[i]>40000)hi.push(i);
if(hi.length){const a=hi.map(i=>w8[i]),b=hi.map(i=>wz[i]);
  const A=st(a),B=st(b);
  console.log(`  таких кадров: ${hi.length} (${(100*hi.length/w8.length).toFixed(1)}%)`);
  console.log(`  i8080 avg ${A.avg.toFixed(0)} (${(A.avg/FR*100).toFixed(1)}%) | Z80 avg ${B.avg.toFixed(0)} (${(B.avg/FR*100).toFixed(1)}%) | выигрыш ${(A.avg-B.avg).toFixed(0)} т (${((A.avg-B.avg)/A.avg*100).toFixed(1)}%)`);}
console.log(`\n=== ПЛАВНОСТЬ (тик кончился позже своего кадра) ===`);
console.log(`  i8080: тик avg ${D8.avg.toFixed(0)} p50 ${D8.p50} p90 ${D8.p90} p99 ${D8.p99} max ${D8.max}; ДЛИННЕЕ КАДРА ${late8}/${d8.length} = ${(100*late8/d8.length).toFixed(1)}%`);
console.log(`  Z80  : тик avg ${DZ.avg.toFixed(0)} p50 ${DZ.p50} p90 ${DZ.p90} p99 ${DZ.p99} max ${DZ.max}; ДЛИННЕЕ КАДРА ${latez}/${dz.length} = ${(100*latez/dz.length).toFixed(1)}%`);
// сколько кадров «спасает» каждый процент ускорения — чувствительность метрики
const sorted=d8.slice().sort((a,b)=>b-a);
for(const k of [0.02,0.04,0.06,0.08,0.10,0.15,0.20]){
  let c=0;for(const v of d8)if(v*(1-k)>FR)c++;
  console.log(`  гипотетически «весь тик быстрее на ${(k*100).toFixed(0)}%»: длиннее кадра ${(100*c/d8.length).toFixed(1)}%`);
}
