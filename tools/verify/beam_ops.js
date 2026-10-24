// Цена трёх проходов по фреймбуферу на объект (restore / save / draw) и смещение
// объекта за кадр (нужно, чтобы окно стирания брало запас на движение).
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||6000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;
const REST=L.vec_su_restore,SAVE=L.vec_su_save,SHOW=L.vec_spr_show,OUT=L.vec_spr_out;
let TT=0;const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
const C={R:{pc:REST,ret:-1,sp:-1},S:{pc:SAVE,ret:-1,sp:-1},D:{pc:SHOW,ret:-1,sp:-1}};
const acc={R:{},S:{},D:{}};
const oldlo=new Int16Array(32).fill(-1);
const mov=[],movBy={};
let curKey=null;
v06c.check_breakpoint=function(){const pc=cpu.pc;
  for(const k in C){const b=C[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();b.t0=TT;
      const i=rd(L.vec_nsp_idx),pg=0xE000+i*256;
      // ключ = (число плоскостей, ncols); у restore геометрия из шапки слота, у save/draw из записи
      const h=(k==="R")?[rd(pg+1),rd(pg+3),rd(pg+4),rd(pg+5)]:[rd(pg+0x97),rd(pg+0x99),rd(pg+0x9A),rd(pg+0x9B)];
      const np=1+(h[2]?1:0)+(h[3]?1:0);
      b.key=`пл=${np} стлб=${h[1]}`;
      if(k==="D"){const nl=rd(pg+2); if(oldlo[i]>=0){const d=Math.abs(nl-oldlo[i]);mov.push(d);movBy[i]=movBy[i]||[];movBy[i].push(d);} oldlo[i]=nl;}
    }
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){b.ret=-1;
      const d=TT-b.t0;(acc[k][b.key]=acc[k][b.key]||[]).push(d);}}
  return false;};
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  v06c.oneInterrupt(true);
}
if(held>0)E.key(held,0);
const avg=a=>Math.round(a.reduce((x,y)=>x+y,0)/a.length);
console.log("ЦЕНА ПРОХОДА ПО ФРЕЙМБУФЕРУ (тактов), по геометрии объекта");
console.log("геометрия            restore(запись)   save(чтение fb)   draw(OR чтение+запись)  сумма  байт fb");
const keys=new Set([...Object.keys(acc.R),...Object.keys(acc.S),...Object.keys(acc.D)]);
for(const k of [...keys].sort()){
  const r=acc.R[k],s=acc.S[k],d=acc.D[k];
  if(!s||!d)continue;
  const m=k.match(/пл=(\d+) стлб=(\d+)/); const nb=m?(+m[1])*(+m[2])*16:0;
  console.log(`${k.padEnd(18)} ${String(r?avg(r):0).padStart(12)}(${String(r?r.length:0).padStart(5)}) ${String(avg(s)).padStart(12)}(${String(s.length).padStart(5)}) ${String(avg(d)).padStart(14)}(${String(d.length).padStart(5)}) ${String((r?avg(r):0)+avg(s)+avg(d)).padStart(7)} ${String(nb).padStart(6)}`);
}
function q(a,p){a=a.slice().sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor(a.length*p))];}
console.log(`\nСМЕЩЕНИЕ lo0 объекта за кадр (пикселей): n=${mov.length} p50=${q(mov,.5)} p90=${q(mov,.9)} p99=${q(mov,.99)} max=${Math.max(...mov)}`);
for(const i of Object.keys(movBy).map(Number).sort((a,b)=>a-b)){const a=movBy[i];
  console.log(`  слот ${String(i).padStart(2)}: n=${String(a.length).padStart(5)} p50=${q(a,.5)} p90=${q(a,.9)} p99=${q(a,.99)} max=${Math.max(...a)}`);}
