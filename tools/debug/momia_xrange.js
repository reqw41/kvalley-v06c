// momia_xrange.js — ЗАДАЧА #44: диапазон X мумий и распределение (X+c)&7.
//
// ЗАЧЕМ. Подготовка мумии берёт X+c (компенсация прижатого влево арта). Байт X при этом
// обязан не переполниться: X>=253 дало бы обёртку и прыжок фигуры к левому краю экрана.
// Заодно печатается распределение (X+c)&7 — от него зависит, сколько выводов уложится в
// ОДИН байтовый столбец, если силуэт сузить (шаг 2).
//
// Запуск: node tools/debug/momia_xrange.js <rom> <sym> [c=3] [кадров на пирамиду] [пирамид]
"use strict";
const {make,toGame}=require("../verify/beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const C=+(process.argv[4]||3), PF=+(process.argv[5]||900), NP=+(process.argv[6]||8);
const {L,rd,v06c}=E;
const isMomia=p=>(p>=0x28&&p<0x34)||(p>=0x88&&p<0x94);
let maxX=-1,minX=999,n=0;const hist=new Array(8).fill(0);
let seed=2024;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const KS=[37,39,38,40];let held=-1;
function step(){v06c.oneInterrupt(true);
  if(rd(L.GameStatus)!==5)return;
  for(let i=6;i<14;i++){
    if(rd(L.sprAttrib+i*4)>=0xD0)continue;
    if(!isMomia(rd(L.sprAttrib+i*4+2)))continue;
    const x=rd(L.sprAttrib+i*4+1);
    if(x>maxX)maxX=x; if(x<minX)minX=x; hist[(x+C)&7]++; n++;
  }}
for(let p=0;p<NP;p++){
  if(p>0){E.key(78,1);step();E.key(78,0);
    for(let i=0;i<3000&&rd(L.GameStatus)!==5;i++)step();
    for(let i=0;i<40;i++)step();}
  for(let f=0;f<PF;f++){
    if(f%17===0){const k=KS[(rnd()*4)|0];if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
    step();
    if(rd(L.GameStatus)!==5)for(let i=0;i<3000&&rd(L.GameStatus)!==5;i++)step();}
  if(held>0){E.key(held,0);held=-1;}}
const tot=hist.reduce((a,b)=>a+b,0)||1;
console.log(`мумий-кадров ${n}: X от ${minX} до ${maxX} (переполнение X+${C} при X>=${256-C})`);
console.log(`(X+${C})&7: `+hist.map((v,i)=>`${i}:${(100*v/tot).toFixed(1)}%`).join(" "));
