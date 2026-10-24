// ТОЧНЫЙ РАЗБОР ПАЧКИ ВЫВОДА ПО ТАКТАМ ИНСТРУКЦИЙ.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СТЕНД, КОГДА ЕСТЬ our_pack_cost.js. У того разбор считает такты как
// разность растровых координат между двумя вызовами check_breakpoint и выбрасывает всё,
// что вышло <=0 или >=4000 (пересечение границы кадра, дребезг фазы filler'а). Замер
// 2026-08-26: сумма ВСЕХ 113 меток там = 16425 т/пачку при средней длительности пачки
// 34980 т, то есть разбор видит 47% пачки, а верхние 12 строк, по которым сделан вывод
// «в топе пачки нет ни одной метки fixup/подготовки», — это 12313 т, ровно 35% пачки.
// Вывод «чего в пачке нет» по разбору, который теряет половину, недействителен.
//
// ЗДЕСЬ такты берутся из cpu.vcycles — ровно то, что эмулятор начисляет самой машине,
// без растровой арифметики. Сумма по меткам РАВНА времени ЦП внутри пачки по построению,
// и стенд это печатает: ПОКРЫТИЕ обязано быть 100.0%. Если нет — врёт стенд.
"use strict";
const {make}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {L,rd,v06c,cpu,cyc,FRAME,memory,keyboard}=E;
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
// Метки-адреса кода; equ-константы (<0x100) и данные (>=0x8000) в карту не берём.
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x8000).sort((a,b)=>a[1]-b[1]);
const addrs=syms.map(x=>x[1]);
const near=pc=>{let l=0,h=addrs.length-1,r=0;while(l<=h){const m=(l+h)>>1;if(addrs[m]<=pc){r=m;l=m+1}else h=m-1}return syms[r][0];};
const cost={}; let packs=0, totCyc=0, prevPc=null, inPack=false;
const cur=[];                       // такты текущей пачки, чтобы дать медиану/p90
v06c.check_breakpoint=function(){
  // cpu.vcycles — цена ПРЕДЫДУЩЕЙ инструкции (tv.js начисляет её после instruction()).
  if(inPack&&prevPc!==null){const c=cpu.vcycles|0;const k=near(prevPc);
    cost[k]=(cost[k]||0)+c; totCyc+=c; cur[cur.length-1]+=c;}
  const pc=cpu.pc;
  if(pc===L.vec_spr_out){inPack=true;packs++;cur.push(0);}
  else if(inPack&&pc===L.vso_fix+3){inPack=false;}
  prevPc=pc;
  return false;
};
for(let i=0;i<600;i++){v06c.oneInterrupt(true);if(i%60===0)place();}
v06c.check_breakpoint=()=>false;
const q=(a,x)=>a.length?a.slice().sort((u,v)=>u-v)[Math.min(a.length-1,Math.floor(a.length*x))]:0;
if(!packs){console.log("ГЕЙТ ПРОВАЛЕН: пачек не собрано.");process.exit(2);}
const sum=Object.values(cost).reduce((a,b)=>a+b,0);
// Вход в vec_spr_out бывает ХОЛОСТЫМ (рисовать нечего): такие «пачки» стоят ~40 тактов
// и тянут среднее вниз. Считаем отдельно РАБОЧИЕ — те, что стоили больше 1000 тактов.
const work=cur.filter(x=>x>1000), mw=work.reduce((a,b)=>a+b,0);
console.log(`входов в vec_spr_out ${packs}, из них РАБОЧИХ (>1000 т) ${work.length}`);
console.log(`ТАКТОВ ЦП В РАБОЧЕЙ ПАЧКЕ: среднее ${Math.round(mw/(work.length||1))}, медиана ${q(work,.5)}, p90 ${q(work,.9)}`);
console.log(`ТАКТОВ ЦП НА ВХОД (все входы): ${Math.round(totCyc/packs)}`);
console.log(`ПОКРЫТИЕ: сумма по ${Object.keys(cost).length} меткам = ${sum} = ${(100*sum/totCyc).toFixed(1)}% тактов пачки`);
console.log("--- статьи пачки (тактов на РАБОЧУЮ пачку, доля) ---");
let acc=0;
Object.entries(cost).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{
  const s=v/(work.length||1); if(s<40)return; acc+=v;
  console.log(`  ${String(Math.round(s)).padStart(6)}  ${(100*v/totCyc).toFixed(1).padStart(5)}%  ${k}`);});
console.log(`  ${String(Math.round((totCyc-acc)/(work.length||1))).padStart(6)}  ${(100*(totCyc-acc)/totCyc).toFixed(1).padStart(5)}%  (остальные метки, каждая <15 т/пачку)`);
