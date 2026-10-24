// СКВОЗНАЯ ЦЕНА ИГРОВОГО ТИКА В ТАКТАХ. Аналог addrcost.js, но в тактах, а не командах:
// на i8080 команда стоит от 4 до 18 тактов, и «команд на тик» может двигаться против тактов.
// Метрика по замыслу устойчивее доли «не влезло в кадр»: та меняется от траектории партии,
// эта делит суммарные такты внутри tickInProgress на число тиков.
// ОГОВОРКА: сцена всё равно своя у каждой сборки, поэтому это не приговор, а показание.
"use strict";
const {make,toGame}=require("./beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
const {cpu,run,rd,L,key,memory}=E;
const FRAME=59904;
const TIP=L.tickInProgress;
let inStep=false,cur=0,ticks=0,sum=0,arr=[];
const owr=memory.write.bind(memory);
memory.write=function(a,v,s){ if((a&0xffff)===TIP){
    if((v&255)&1){inStep=true;cur=0;ticks++;}
    else if(inStep){inStep=false;sum+=cur;arr.push(cur);} }
  return owr(a,v,s); };
const orig=cpu.instruction.bind(cpu);
cpu.instruction=function(){ const t=orig(); if(inStep) cur+=t; return t; };
const gs=toGame(E);
if(gs!==5){ console.log("ПРОВАЛ ПРОГОНА: GameStatus="+gs+" — до геймплея не дошли, числа НЕДЕЙСТВИТЕЛЬНЫ"); process.exit(2); }
run(120);
for(const d of [39,37,39,38,32]){ key(d,1); run(300); key(d,0); run(50); }
if(!arr.length){ console.log("ПРОВАЛ: выборка пуста"); process.exit(2); }
arr.sort((a,b)=>a-b);
const q=p=>arr[Math.min(arr.length-1,Math.floor(arr.length*p))];
console.log(`тиков ${arr.length}: СРЕДНЕЕ ${Math.round(sum/arr.length)} тактов/тик = ${(100*sum/arr.length/FRAME).toFixed(1)}% кадра`);
console.log(`  p50 ${q(.5)}  p90 ${q(.9)}  p99 ${q(.99)}  max ${arr[arr.length-1]}`);
const over=n=>arr.filter(x=>x>n*FRAME).length;
const pc=n=>`${over(n)}/${arr.length} = ${(100*over(n)/arr.length).toFixed(2)}%`;
console.log(`  не влезает в 1 кадр (50 Гц): ${pc(1)}`);
console.log(`  не влезает в 2 кадра (25 Гц, ${2*FRAME} т): ${pc(2)}`);
console.log(`  не влезает в 3 кадра: ${pc(3)}   в 4 кадра: ${pc(4)}`);
console.log(`  [доли между сборками НЕСРАВНИМЫ по траектории; сравнивать можно ХАРАКТЕР хвоста]`);
// Хвост поимённо: что именно не влезло в 2 кадра — это и есть ответ на вопрос
// «а если целиться в 25 Гц». Печатаем сами длины, чтобы отличить единичный
// выброс (заливка экрана под шторкой) от систематического превышения.
const tail=arr.filter(x=>x>2*FRAME);
if(tail.length) console.log(`  длины тиков, не влезших в 2 кадра (тактов): ${tail.map(x=>x+" ("+(x/FRAME).toFixed(1)+" кадра)").join(", ")}`);
