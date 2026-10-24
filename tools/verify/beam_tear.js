// beam_tear.js — ЧТО ЛУЧ ВИДИТ НА САМОМ ДЕЛЕ (задача #37, разбор после железа).
//
// ЗАЧЕМ ЕЩЁ ОДНА МЕТРИКА. beam_late.js считает ТРАНЗИЕНТ — луч между СТИРАНИЕМ и
// ВЫВОДОМ объекта, то есть «дырку» (объекта нет вовсе). Эту дырку мы почти убрали
// (11248 -> 800 пикс), а владелец на железе мерцание всё равно видит. Значит глаз ловит
// не только дырку. Строка экрана обновляется НЕ АТОМАРНО: в одну строку fb за кадр идёт
// до 9 записей (3 столбца x 3 плоскости), плюс отдельная запись стирания в начале пачки,
// и они разнесены на тысячи тактов. Если луч прошёл МЕЖДУ первой и последней записью,
// он показал СМЕСЬ старого и нового кадра — половина спрайта в старой позиции, половина
// в новой, у героя ещё и половина плоскостей => смена цвета. Это и есть мерцание.
//
// ЧТО СЧИТАЕТ (только кадры геймплея, только игровое поле):
//   РВАНЫЕ СТРОКИ — в строку были записи И ДО прохода луча, И ПОСЛЕ. Луч показал смесь.
//   ПОЗДНИЕ СТРОКИ — все записи строки после луча (кадр показан целиком старым: лаг).
//   ОКНО СТРОКИ — такты от первой записи в строку до последней (это и надо сводить к нулю).
// Модель луча та же: T(Y) = irq + 13780 + 192*Y, строка fb с младшим байтом lo => Y=255-lo.
//
// Запуск: node tools/verify/beam_tear.js <rom> <sym> [тиков=2600]
// Клавиши подаются ПО ИГРОВЫМ ТИКАМ (как в beam_ab.js), чтобы сборки были сравнимы.
"use strict";
const {make}=require("./beam_harness.js");
const ROM=process.argv[2],SYM=process.argv[3],NT=+(process.argv[4]||2600);
if(!ROM||!SYM){console.log("usage: node beam_tear.js <rom> <sym> [тиков]");process.exit(2);}
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
// БЫЛО зашито 0x6C03 (эра 0x6C00) — теперь адрес переменной timer берём из .sym по имени.
if(!L.timer){console.log("нет символа timer в .sym");process.exit(2);}
const TIMER=L.timer;
const ISR=L.vec_isr;
// ЗАДАЧА#43: верх поля приходит НЕ на фиксированном такте — его сдвигает аппаратный
// вертикальный скролл. Берём vec_vscroll из .sym: каждая лишняя статичная строка
// сверху = +192 такта до прихода луча (0x1F = поле по центру, 0x3F = прижато к низу).
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));

let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
// --- перехват записей во ВИДИМЫЕ плоскости p0/p1/p2 (0x8000-0xDFFF) ---
const NY=192;
const first=new Float64Array(NY),last=new Float64Array(NY);
const nBefore=new Int32Array(NY),nAfter=new Int32Array(NY);
let irq=-1,live=false;
const oW=memory.write.bind(memory);
memory.write=function(addr,w8,stackrq){
  oW(addr,w8,stackrq);
  if(!live)return;
  const a=addr&0xffff;
  if(a<0x8000||a>=0xE000)return;
  const Y=255-(a&255);
  if(Y<0||Y>=NY)return;
  if(!nBefore[Y]&&!nAfter[Y])first[Y]=TT;
  last[Y]=TT;
  if(TT < irq+BEAM0+192*Y)nBefore[Y]++; else nAfter[Y]++;
};
// зоны как в beam_late
const zones=[[0,48],[48,64],[64,96],[96,192]];
let frames=0,tornRows=0,tornBytes=0,lateRows=0,lateBytes=0,winSum=0,winN=0,winMax=0;
const zTorn=zones.map(()=>0),zLate=zones.map(()=>0);
const zoneOf=Y=>{for(let i=0;i<zones.length;i++)if(Y>=zones[i][0]&&Y<zones[i][1])return i;return -1;};
function closeFrame(){
  if(!live)return;
  frames++;
  for(let Y=0;Y<NY;Y++){
    const b=nBefore[Y],a=nAfter[Y];
    if(!b&&!a)continue;
    const w=last[Y]-first[Y];
    winSum+=w;winN++;if(w>winMax)winMax=w;
    const z=zoneOf(Y);
    if(b&&a){tornRows++;tornBytes+=Math.min(b,a);if(z>=0)zTorn[z]+=Math.min(b,a)*8;}
    else if(a&&!b){lateRows++;lateBytes+=a;if(z>=0)zLate[z]+=a*8;}
  }
  nBefore.fill(0);nAfter.fill(0);
}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0){
    closeFrame();
    irq=TT;live=(rd(L.GameStatus)===5);
    nBefore.fill(0);nAfter.fill(0);}
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
let held=new Set(),tick=0,prevT=0,nf=0;
while(tick<=NT&&nf<400000){
  const want=new Set(keysFor(tick));
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  v06c.oneInterrupt(true);nf++;
  const t=rd(TIMER);if(t!==prevT){prevT=t;tick++;}
}
closeFrame();
console.log(`ROM=${ROM.split("/").pop()} тиков ${NT}, кадров на игру ${nf}, кадров геймплея ${frames}`);
console.log(`РВАНЫЕ СТРОКИ (луч показал СМЕСЬ старого и нового): ${tornRows} строк, ${tornBytes*8} пикс`);
zones.forEach((z,i)=>console.log(`   Ytop ${String(z[0]).padStart(3)}..${String(z[1]-1).padStart(3)}: ${zTorn[i]} пикс`));
console.log(`ПОЗДНИЕ СТРОКИ (все записи после луча -> кадр показан старым): ${lateRows} строк, ${lateBytes*8} пикс`);
zones.forEach((z,i)=>console.log(`   Ytop ${String(z[0]).padStart(3)}..${String(z[1]-1).padStart(3)}: ${zLate[i]} пикс`));
console.log(`ОКНО СТРОКИ (первая запись -> последняя): avg ${(winSum/Math.max(1,winN)).toFixed(0)} тактов, max ${winMax} (строка луча = 192 такта)`);
console.log(`на кадр геймплея: рваных строк ${(tornRows/Math.max(1,frames)).toFixed(2)}, поздних ${(lateRows/Math.max(1,frames)).toFixed(2)}`);
