// ЦЕНА ГРУППЫ МЕТОК НА ОДИН ВЫЗОВ ПРОЦЕДУРЫ.
//
// ЗАЧЕМ. Разница профилей между двумя сборками — НЕ цена правки: правка меняет
// траекторию партии, и вместе с ней меняются все остальные статьи (ловушка #2 и #7
// в reference_kv_measurement_traps). Здесь знаменатель — ЧИСЛО ВХОДОВ в саму
// процедуру, поэтому «тактов на вызов» сравнимо между сборками напрямую.
// Такты берутся из cpu.vcycles (то, что эмулятор начисляет машине), а не из растровых
// координат: сумма по построению равна времени ЦП, стенд печатает покрытие.
// Вызов: node label_cost.js <rom> <sym> <метка-входа> <префикс> [<префикс>...]
"use strict";
const {make}=require("./beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
const ENTRY=process.argv[4], PFX=process.argv.slice(5);
const {L,rd,v06c,cpu,memory,keyboard}=E;
if(L[ENTRY]===undefined){console.log(`ГЕЙТ ПРОВАЛЕН: метки ${ENTRY} нет в .sym`);process.exit(2);}
const wr=(a,v)=>memory.write(a&0xffff,v&255,false);
function tick(){const t0=rd(L.timer);do v06c.oneInterrupt(true);while(rd(L.timer)===t0);}
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
let f=0;while(f<1500&&rd(L.GameStatus)!==5){v06c.oneInterrupt(true);f++;}
for(let i=0;i<40;i++)tick();
wr(L.vec_god,1);
const MD=L.momiaDat, STEP=(L.momiaDat2!==undefined)?(L.momiaDat2-L.momiaDat):16;
function place(){const hY=rd(L.ProtaY),hX=rd(L.ProtaX),room=rd(L.ProtaRoom);
  for(let m=0;m<2;m++){const p=MD+m*STEP;wr(p+0,0);wr(p+3,hY);wr(p+5,(hX+(m?14:-14))&255);wr(p+6,room);}
  wr(L.enemyAttrib,hY);wr(L.enemyAttrib+1,(hX+14)&255);wr(L.enemyAttrib+2,hY);wr(L.enemyAttrib+3,(hX-14)&255);}
place();for(let i=0;i<10;i++)tick();
keyboard.keyDown({keyCode:39,which:39,preventDefault(){},stopPropagation(){}});
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x8000).sort((a,b)=>a[1]-b[1]);
const addrs=syms.map(x=>x[1]);
const near=pc=>{let l=0,h=addrs.length-1,r=0;while(l<=h){const m=(l+h)>>1;if(addrs[m]<=pc){r=m;l=m+1}else h=m-1}return syms[r][0];};
const hit=k=>PFX.some(p=>k.startsWith(p));
let entries=0, grp=0, all=0, prevPc=null;
const per={};
v06c.check_breakpoint=function(){
  if(prevPc!==null){const c=cpu.vcycles|0; all+=c; const k=near(prevPc);
    if(hit(k)){grp+=c; per[k]=(per[k]||0)+c;}}
  if(cpu.pc===L[ENTRY])entries++;
  prevPc=cpu.pc; return false;
};
for(let i=0;i<600;i++){v06c.oneInterrupt(true);if(i%60===0)place();}
v06c.check_breakpoint=()=>false;
if(!entries){console.log(`ГЕЙТ ПРОВАЛЕН: в ${ENTRY} не вошли НИ РАЗУ — мерить нечего.`);process.exit(2);}
console.log(`вход в ${ENTRY}: ${entries} раз за прогон; такты ЦП всего ${all}`);
console.log(`ГРУППА [${PFX.join(" ")}]: ${grp} тактов = ${(grp/entries).toFixed(1)} НА ВЫЗОВ (${(100*grp/all).toFixed(2)}% всех тактов)`);
Object.entries(per).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`   ${(v/entries).toFixed(1).padStart(8)}  ${k}`));
