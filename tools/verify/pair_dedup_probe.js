// КУДА ДЕДУП СЛИВАЕТ ОБЩУЮ ПЛОСКОСТЬ ПАРЫ (жалоба «герой становится ГОЛЫМ, проходя
// сквозь комок возрождения зелёной мумии»).
//
// ГИПОТЕЗА. vsd_dropb (vec_sprout.asm) отдаёт нашу вторую плоскость СОСЕДУ и перестаёт
// её выводить сам. Сосед берётся из vsp_dpg — «предыдущий подготовленный в этом тике»,
// КТО УГОДНО. Гейт `cp 6 / jp nc, vsd_set` ограничивает только НАС (слоты 0-5), а на
// соседа ограничения нет: если перед героем подготовилась мумия с тем же lo0 и её hi0
// совпал с нашей hi0b, одежда героя уедет в буфер МУМИИ. Мумия выведет её только там,
// где рисует сама, — остальная одежда пропадёт.
//
// Стенд считает пары (мы -> сосед) на входе в vsd_dropb. Строка «4 или 5 -> сосед >= 6»
// и есть дефект. Гейт падает на пустой выборке.
"use strict";
const {make}=require("./beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
const {L,rd,v06c,cpu,memory,keyboard}=E;
for(const n of ["vsd_dropb","vsp_dpg","vec_nsp_idx"])
  if(L[n]===undefined){console.log(`ГЕЙТ ПРОВАЛЕН: нет метки ${n}`);process.exit(2);}
const wr=(a,v)=>memory.write(a&0xffff,v&255,false);
function tick(){const t0=rd(L.timer);do v06c.oneInterrupt(true);while(rd(L.timer)===t0);}
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
let f=0;while(f<1500&&rd(L.GameStatus)!==5){v06c.oneInterrupt(true);f++;}
for(let i=0;i<40;i++)tick();
wr(L.vec_god,1);
const MD=L.momiaDat, STEP=(L.momiaDat2!==undefined)?(L.momiaDat2-L.momiaDat):16;
// СЦЕНА ЖАЛОБЫ: мумии ВПРИТИРКУ к герою, вплоть до полного наложения (dx=0).
const DX=[0,2,-2,6,-6,14,-14];
let phase=0;
function place(){const hY=rd(L.ProtaY),hX=rd(L.ProtaX),room=rd(L.ProtaRoom);
  for(let m=0;m<2;m++){const p=MD+m*STEP,dx=DX[(phase+m)%DX.length];
    wr(p+0,0);wr(p+3,hY);wr(p+5,(hX+dx)&255);wr(p+6,room);}
  wr(L.enemyAttrib,hY);wr(L.enemyAttrib+1,(hX+DX[phase%DX.length])&255);
  wr(L.enemyAttrib+2,hY);wr(L.enemyAttrib+3,(hX+DX[(phase+1)%DX.length])&255);
  phase++;}
place();for(let i=0;i<10;i++)tick();
keyboard.keyDown({keyCode:39,which:39,preventDefault(){},stopPropagation(){}});
const pairs={}; let total=0, bad=0;
v06c.check_breakpoint=function(){
  if(cpu.pc!==L.vsd_dropb)return false;
  const us=rd(L.vec_nsp_idx), pg=rd(L.vsp_dpg), nb=pg?pg-0xE0:-1;
  const k=`${us} -> ${nb}`; pairs[k]=(pairs[k]||0)+1; total++;
  if(us<6&&nb>=6)bad++;
  return false;
};
for(let i=0;i<900;i++){v06c.oneInterrupt(true);if(i%20===0)place();}
v06c.check_breakpoint=()=>false;
if(!total){console.log("ГЕЙТ ПРОВАЛЕН: vsd_dropb не сработал НИ РАЗУ — сцена дедуп не задевает.");process.exit(2);}
console.log(`срабатываний дедупа (vsd_dropb): ${total}`);
console.log("  --- кто -> кому отдал плоскость (слот -> слот) ---");
Object.entries(pairs).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{
  const [u,n]=k.split(" -> ").map(Number);
  console.log(`     ${String(v).padStart(5)}  ${k}${(u<6&&n>=6)?"   <== ДЕФЕКТ: плоскость пары уехала в МУМИЮ":""}`);});
console.log(`ОТДАНО НЕ ПАРТНЁРУ, А СЛОТУ >= 6: ${bad} = ${(100*bad/total).toFixed(1)}%`);
process.exit(bad?1:0);
