// topjump_shot.js — СНИМОК ПРЫЖКА НА ВЕРХНЕЙ СТРОКЕ + ЗАМЕР «ВИДЕН ЛИ ГЕРОЙ НАД ПОЛЕМ».
//
// ЗАЧЕМ. Жалоба владельца: «под HUD невидимая область — герой запрыгивает под неё и его
// спрайт скрывается». Клип сдвинут на 8 строк (vclp, vec_sprout.asm), и теперь габарит
// живёт в зазоре fb 7..0. Проверять это глазами на живой игре долго, поэтому здесь:
//   1) стенд сажает героя на верхнюю площадку пирамиды 1 и заставляет прыгать;
//   2) считается, СКОЛЬКО кадров прыжка имеют байты спрайта ВЫШЕ верха поля (lo 7..0)
//      и до какой строки спрайт доходит (максимум lo0 из записи вывода);
//   3) снимается кадр в самой верхней точке (idealBmp — без разрывов луча).
//
// Запуск: node tools/verify/topjump_shot.js <файл.png> [rom] [sym] [кадров=900]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
let OUT=null,ROM=null,SYM=null,NF=null;
for(const x of process.argv.slice(2)){
  if(/\.sym$/i.test(x))SYM=x; else if(/\.rom$/i.test(x))ROM=x;
  else if(/\.png$/i.test(x))OUT=x; else if(/^\d+$/.test(x))NF=+x;}
ROM=ROM||T+"/../../build/kvalley_8c.rom";
SYM=SYM||T+"/../../build/kvalley_8c.sym";
NF=NF||900;
const E=make(ROM,SYM);
const {L,rd,v06c,memory}=E;
const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
const runf=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
runf(700);
for(let i=0;i<30;i++){E.key(32,1);runf(3);E.key(32,0);runf(3);}
for(let i=0;i<800&&rd(L.GameStatus)!==5;i++)v06c.oneInterrupt(true);
if(rd(L.GameStatus)!==5){console.log("ПРОВАЛ: до геймплея не дошли");process.exit(1);}
wr(L.ProtaY,8);
runf(10);

const zoneBytes=()=>{let n=0;
  for(let p=0x8000;p<0xE000;p+=0x2000)for(let c=0;c<32;c++)for(let lo=0;lo<=7;lo++)
    if(rd(p+c*256+lo))n++;
  return n;};
let held=new Set(), tick=0, prevT=0, live=0, jumpFrames=0, seen=0, maxLo=0, best=-1, bestPng=null;
const ATTR=L.sprAttrib;
for(let f=0;f<NF;f++){
  const want=new Set(); if(tick%20<3)want.add(32);
  want.add((tick%120)<60?39:37);
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  v06c.oneInterrupt(true);
  const t=rd(L.timer); if(t!==prevT){prevT=t;tick++;}
  if(rd(L.GameStatus)!==5)continue;
  live++;
  const y=rd(ATTR+16);
  if(y>=0xF0){jumpFrames++;
    const lo0=rd(0xE000+4*256+2);       // слот героя: шапка +2 = lo0
    if(lo0>maxLo)maxLo=lo0;
    const z=zoneBytes();
    if(z)seen++;
    if(z>best){best=z;bestPng=E.idealBmp();}}
}
for(const c of held)E.key(c,0);
console.log(`ROM=${ROM.split("/").pop()}  верхняя площадка пирамиды 1, прыжки`);
console.log(`кадров геймплея ${live}; кадров с Y героя за нулём (спрайт выше поля) ${jumpFrames}`);
console.log(`ИЗ НИХ спрайт РЕАЛЬНО ВИДЕН в зоне lo 7..0: ${seen} = ${jumpFrames?(100*seen/jumpFrames).toFixed(1):0}%`);
console.log(`максимальный lo0 габарита: ${maxLo} (клип пускает до 248; 240 = старый клип по верху поля)`);
console.log(`максимум байт спрайта в зоне за кадр: ${best}`);
if(OUT&&bestPng){E.pngFrom(bestPng,OUT);console.log(`снимок верхней точки: ${OUT}`);}
