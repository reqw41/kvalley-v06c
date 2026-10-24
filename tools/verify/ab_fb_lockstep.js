// ab_fb_lockstep.js — ПОКАДРОВАЯ СВЕРКА ДВУХ СБОРОК НА ОДНОМ И ТОМ ЖЕ ВВОДЕ.
//
// ЗАЧЕМ. «Мусор на HUD при перепрыгивании мумий» — жалоба ГЛАЗАМИ, и остаточная метрика
// её не поймала. Самый честный ответ на вопрос «регресс или старое» — сравнить КАРТИНКУ
// двух сборок на ОДНОМ вводе: обе играют одну игру, а fb сверяется на конце каждого кадра
// байт в байт. Расхождение = то, что правка изменила НА ЭКРАНЕ, с точным адресом и кадром.
//
// ОГОВОРКА ПО ЧЕСТНОСТИ: сборки не обязаны идти такт в такт (стек-блит быстрее), поэтому
// расхождение САМО ПО СЕБЕ ещё не дефект — оно может быть «тик успел/не успел». Поэтому
// печатается не только факт, но и АДРЕСА: если расхождения сидят в зоне HUD (lo 248..255)
// или в кайме (lo 0..31), это ровно жалоба; если размазаны по полю — это расхождение хода.
//
// Запуск: node tools/verify/ab_fb_lockstep.js romA symA romB symB [кадров] [--top] [--row N]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const a=process.argv.slice(2).filter(x=>!/^--/.test(x));
const ROMA=a[0], SYMA=a[1], ROMB=a[2], SYMB=a[3], NF=+(a[4]||900);
const TOP=process.argv.indexOf("--top")>0;
const ROW=(()=>{const i=process.argv.indexOf("--row");return i>0?+process.argv[i+1]:8;})();

function boot(E){
  const {L,rd,v06c,memory}=E;
  const wr=(x,v)=>memory.write(x&0xffff,v&0xff,false);
  const runf=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
  runf(700);
  for(let i=0;i<30;i++){E.key(32,1);runf(3);E.key(32,0);runf(3);}
  for(let i=0;i<800&&rd(L.GameStatus)!==5;i++)v06c.oneInterrupt(true);
  if(rd(L.GameStatus)!==5)throw new Error("до геймплея не дошли");
  if(TOP){wr(L.ProtaY,ROW);
    for(let m=0;m<8;m++){const y=rd(L.enemyAttrib+m*4); if(y<0xD0)wr(L.enemyAttrib+m*4,ROW);}
    runf(10);}
  return {wr,runf};
}
const EA=make(ROMA,SYMA), EB=make(ROMB,SYMB);
const bA=boot(EA), bB=boot(EB);
if(EA.rd(EA.L.piramideActual)!==1||EB.rd(EB.L.piramideActual)!==1){
  console.log("ПРОВАЛ ПОКРЫТИЯ: не пирамида 1");process.exit(1);}

const wantOf=tick=>{const w=new Set();
  if(TOP){ if(tick%20<3)w.add(32); w.add((tick%120)<60?39:37); }
  else { if(tick%17<3)w.add(32); w.add((tick%80)<40?39:37); }
  return w;};
const held={A:new Set(),B:new Set()};
function step(E,side,tick){
  const want=wantOf(tick);
  for(const c of held[side])if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held[side].has(c))E.key(c,1);
  held[side]=want;
  E.v06c.oneInterrupt(true);
}
let firstDiff=-1, diffFrames=0, totalDiff=0, firstYdiff=-1, dumped=false;
const byLo={}, byAddr={};
let tickA=0,prevA=0,tickB=0,prevB=0;
let yA=[],yB=[];
for(let f=0;f<NF;f++){
  step(EA,"A",tickA); step(EB,"B",tickB);
  {const t=EA.rd(EA.L.timer); if(t!==prevA){prevA=t;tickA++;}}
  {const t=EB.rd(EB.L.timer); if(t!==prevB){prevB=t;tickB++;}}
  if(EA.rd(EA.L.GameStatus)!==5||EB.rd(EB.L.GameStatus)!==5)continue;
  yA.push(EA.rd(EA.L.ProtaY)); yB.push(EB.rd(EB.L.ProtaY));
  if(firstYdiff<0&&yA[yA.length-1]!==yB[yB.length-1])firstYdiff=f;
  let d=0;
  for(let p=0x8000;p<0xE000;p+=0x2000)for(let c=0;c<32;c++)for(let lo=0;lo<256;lo++){
    const addr=p+c*256+lo;
    if(EA.rd(addr)!==EB.rd(addr)){d++;byLo[lo]=(byLo[lo]||0)+1;byAddr[addr]=(byAddr[addr]||0)+1;}}
  if(d){if(firstDiff<0)firstDiff=f;diffFrames++;totalDiff+=d;
    if(!dumped){dumped=true;
      EA.pngFrom(EA.idealBmp(),"/tmp/kvhud/build/ab_A.png");
      EB.pngFrom(EB.idealBmp(),"/tmp/kvhud/build/ab_B.png");
      console.log(`  первый расходящийся кадр ${f}: ${d} байт; PNG в build/ab_A.png / ab_B.png`);
      console.log(`  состояние: ProtaY A=${EA.rd(EA.L.ProtaY)} B=${EB.rd(EB.L.ProtaY)}, GS=${EA.rd(EA.L.GameStatus)}`);}}
}
console.log(`A=${ROMA.split("/").pop()} B=${ROMB.split("/").pop()}  сцена=${TOP?"верхняя площадка Y="+ROW:"прогулка"}, кадров ${NF}`);
console.log(`ХОД ИГРЫ СОВПАЛ: Y героя A ${Math.min(...yA)}..${Math.max(...yA)}, B ${Math.min(...yB)}..${Math.max(...yB)}, `
  +`расхождений Y ${yA.filter((v,i)=>v!==yB[i]).length}`);
console.log(`ПЕРВОЕ РАСХОЖДЕНИЕ Y ГЕРОЯ на кадре ${firstYdiff} (если ПОЗЖЕ первого расхождения fb — ход игры ни при чём)`);
console.log(`КАДРОВ С РАСХОЖДЕНИЕМ FB: ${diffFrames}, первое на кадре ${firstDiff}, всего байт ${totalDiff}`);
const lo=Object.entries(byLo).sort((x,y)=>y[1]-x[1]).slice(0,14);
if(lo.length)console.log("  по строкам lo: "+lo.map(([l,n])=>`${l}:${n}`).join(" "));
const ad=Object.entries(byAddr).sort((x,y)=>y[1]-x[1]).slice(0,10);
for(const [x,n] of ad)console.log(`  0x${(+x).toString(16)} (пл ${((+x>>13)&3)} стб ${(+x>>8)&31} lo ${+x&255}) ${n} кадров`);
const zone=Object.entries(byLo).filter(([l])=>+l>=248||+l<=31).reduce((s,[,n])=>s+n,0);
console.log(`РАСХОЖДЕНИЙ В ЗОНЕ HUD+КАЙМА: ${zone} из ${totalDiff}`);
