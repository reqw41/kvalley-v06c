// row23_census.js — РАЗВЕДКА ПЕРЕД ПЕРЕНОСОМ НИЖНЕЙ СТРОКИ UI (симметрия кадра, 2026-08-12).
//
// ВОПРОС. Нижняя строка ©KONAMI / PYRAMID-NN живёт в РЯДУ 23 таблицы имён, то есть В ПОЛЕ
// (fb-строки 71..64 — последние восемь из 192). Прежде чем выносить её в нижнюю кайму, надо
// знать: что ещё лежит в ряду 23 во ВСЕХ сценах — только подпись или туда попадает игровой
// контент (стены лабиринта, пергамент карты долины, тексты титула/концовки/бонуса)?
//
// ЧТО МЕРЯЕТ.
//   1) КТО ПИШЕТ в fb lo 64..71 (ряд 23) — по PC, с разбивкой по сценам;
//   2) КАКИЕ СТОЛБЦЫ ненулевые в каждой сцене (сцена = GameStatus/subStatus/
//      flagPiramideMap) в четырёх рядах: 22 (дно лабиринта — контроль «поле кончается
//      там, где сказано»), 23 (спорный последний ряд поля), 26 (НОВОЕ место нижней
//      строки UI в кайме, fb 47..40) и 29 (табло в кайме, fb 23..16).
//
// ДВЕ СЕССИИ. Пергамент карты долины виден ТОЛЬКО при старте партии с титула ПРОБЕЛОМ и
// после честного прохода пирамиды; читовый переход N через него не идёт (замер: сцена
// «GS=4 sub=1 map=0» в читовом прогоне не встретилась ни разу). Поэтому:
//   сессия A — обычный старт пробелом: логотип, титул, ПЕРГАМЕНТ, геймплей;
//   сессия B — читовая (F1+F5): геймплей, переходы N, смерть D, концовка и бонус E.
//
// Запуск: node tools/verify/row23_census.js [rom] [sym]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
let ROM=null,SYM=null;
for(const x of process.argv.slice(2)){
  if(/\.sym$/i.test(x))SYM=x; else if(/\.rom$/i.test(x))ROM=x;}
ROM=ROM||T+"/../../build/kvalley_8c.rom";
SYM=SYM||T+"/../../build/kvalley_8c.sym";

//  [РАУНД 3, 2026-08-12] РЯДЫ ПЕРЕНАЦЕЛЕНЫ на текущую раскладку каймы: 22/23 — дно поля
//  и опустевший последний ряд, 24 — подпись ©KONAMI/PYRAMID-NN, 25 — метка версии
//  (титул), 30 — табло. Этой переписью проверяется главное столкновение раунда 3:
//  на переходе «титул -> партия» подпись и метка версии живут ОДНОВРЕМЕННО, и они
//  обязаны лежать в РАЗНЫХ рядах (24 и 25), иначе номер пирамиды наедет на метку.
const ROWS=[22,23,24,25,30];   // ряд -> fb lo = 255-ряд*8 .. -7
const seen=new Map();       // сцена -> {frames, c:{ряд:Set}}
const hits={};              // PC -> {n, s:Set}
let SYMS=null;

function session(tag, body){
  const E=make(ROM,SYM);
  const {L,rd,v06c,memory,cpu,key}=E;
  if(!SYMS)SYMS=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x8000).sort((x,y)=>x[1]-y[1]);
  const sceneKey=()=>`${tag} GS=${rd(L.GameStatus)} sub=${rd(L.subStatus)} map=${rd(L.flagPiramideMap)&1}`;
  let scene=tag+" боот";
  const oW=memory.write.bind(memory);
  memory.write=function(addr,w8,st){const a=addr&0xffff;
    if(a>=0x8000&&a<0xE000&&(a&255)>=64&&(a&255)<=71){
      const h=hits[cpu.pc]||(hits[cpu.pc]={n:0,s:new Set()}); h.n++; h.s.add(scene);}
    oW(addr,w8,st);};
  const observe=()=>{
    scene=sceneKey();
    let e=seen.get(scene);
    if(!e){e={frames:0,c:{}};for(const r of ROWS)e.c[r]=new Set();seen.set(scene,e);}
    e.frames++;
    for(const r of ROWS){const lo1=255-r*8, lo0=lo1-7;
      for(let p=0x8000;p<0xE000;p+=0x2000)for(let c=0;c<32;c++)
        for(let lo=lo0;lo<=lo1;lo++)if(rd(p+c*256+lo)){e.c[r].add(c);break;}}
  };
  const runf=n=>{for(let i=0;i<n;i++){scene=sceneKey();v06c.oneInterrupt(true);observe();}};
  body({L,rd,key,runf,E});
}

// ===== СЕССИЯ A: логотип -> титул -> ПЕРГАМЕНТ КАРТЫ -> геймплей (старт пробелом) =====
session("A", ({L,rd,key,runf})=>{
  runf(400);
  for(let i=0;i<400&&rd(L.GameStatus)!==1;i++)runf(1);
  runf(40);
  let ok=false;
  for(let blk=0;blk<60&&!ok;blk++){
    for(let f=0;f<25;f++){key(32,true);runf(1);
      if(rd(L.GameStatus)===5&&(rd(L.flagPiramideMap)&1)){ok=true;break;}}
    key(32,false);runf(5);
  }
  runf(200);
});

// ===== СЕССИЯ B: читовая — переходы, смерть, концовка, бонус =====
session("B", ({L,rd,key,runf})=>{
  runf(400);
  key(112,1);key(116,1);
  for(let i=0;i<40&&rd(L.GameStatus)!==5;i++)runf(16);
  key(112,0);key(116,0);runf(60);
  for(let i=0;i<200;i++){key(39,i%20<10);key(32,i%13<3);runf(1);}
  key(39,0);key(32,0);runf(20);
  for(let k=0;k<3;k++){        // переходы читом N (Stage Clear -> вход в следующую пирамиду)
    key(78,1);runf(3);key(78,0);
    for(let f=0;f<900;f++){runf(1);if(f>90&&rd(L.GameStatus)===5&&(rd(L.flagPiramideMap)&1))break;}
    runf(60);
  }
  key(68,1);runf(3);key(68,0);runf(400);        // смерть
  for(let i=0;i<900&&rd(L.GameStatus)!==5;i++)runf(1);
  runf(60);
  key(69,1);runf(3);key(69,0);runf(1500);       // концовка + бонус
});

const nameOf=pc=>{let lo=0,hi=SYMS.length-1,r="?";
  while(lo<=hi){const m=(lo+hi)>>1;if(SYMS[m][1]<=pc){r=`${SYMS[m][0]}+${pc-SYMS[m][1]}`;lo=m+1;}else hi=m-1;}
  return r;};
const rng=s=>{const a=[...s].sort((x,y)=>x-y); if(!a.length)return "—";
  const out=[];let i=0;while(i<a.length){let j=i;while(j+1<a.length&&a[j+1]===a[j]+1)j++;
    out.push(i===j?`${a[i]}`:`${a[i]}-${a[j]}`);i=j+1;}return out.join(",");};
console.log(`ROM=${ROM.split("/").pop()}`);
console.log("=== СЦЕНЫ: ненулевые СТОЛБЦЫ рядов "+ROWS.join("/")+" (22-23 поле, остальные кайма) ===");
for(const [k,v] of [...seen].sort((a,b)=>a[0]<b[0]?-1:1))
  console.log(`  ${k.padEnd(30)} кадров ${String(v.frames).padStart(5)}  `
    +ROWS.map(r=>`р${r}:[${rng(v.c[r])}]`).join("  "));
console.log("=== КТО ПИСАЛ В РЯД 23 ===");
const tot=Object.values(hits).reduce((s,h)=>s+h.n,0);
for(const [pc,h] of Object.entries(hits).sort((a,b)=>b[1].n-a[1].n).slice(0,20))
  console.log(`  0x${(+pc).toString(16).padStart(4,"0")} ${nameOf(+pc).padEnd(26)} ${String(h.n).padStart(6)} = ${(100*h.n/tot).toFixed(1)}%  сцен ${h.s.size}`);
