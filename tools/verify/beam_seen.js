// beam_seen.js — ЧТО ВИДИТ ЛУЧ НА ВЕРХНЕЙ СТРОКЕ (задача #53).
//
// ЗАЧЕМ. hero_top_stress считает «показанные позиции» по тому, какая позиция стояла в
// sprAttrib на старте пачки, и сопоставляет последовательности через LCS. Это годится
// для ПЛАВНОСТИ, но не отвечает на вопрос владельца «мигает или нет»: мигание — это
// кадр, в котором луч прошёл над героем, а героя в фреймбуфере В ЭТОТ МОМЕНТ не было.
// Здесь меряется ровно это: в такте T(Y)=BEAM0+192*Y от прерывания снимается ГАБАРИТ
// героя во фреймбуфере и считается, сколько байт силуэта в нём стоит.
//
// КАК СЧИТАЕТСЯ СИЛУЭТ. Эталон — не картинка, а сам объект: берём габарит из записи
// вывода слота (hi0/lo0/ncols) и считаем ненулевые байты в плоскостях пары (p1 кожа,
// p2 одежда). Кадр объявляется ПРОВАЛОМ, если покрытие упало ниже половины медианы по
// прогону: полная пропажа (стёрт и не выведен) и «половина фигуры» видны одинаково.
//
// СЦЕНА — та же, что в hero_top_stress (предложение владельца): герой и мумии на
// верхней строке пирамиды 1, где луч приходит раньше всего.
// Запуск: node tools/verify/beam_seen.js [rom] [sym] [тиков=1500] [--row N] [--turbo K]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NT=+(process.argv[4]||1500);
const ri=process.argv.indexOf("--row");
const ti=process.argv.indexOf("--turbo");
const TURBO=ti>0?+process.argv[ti+1]:1;
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
for(const s of ["sprAttrib","GameStatus","timer","ProtaY","enemyAttrib","piramideActual"])
  if(L[s]===undefined){console.log("нет символа "+s+" в .sym");process.exit(2);}
const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));
const ATTR=L.sprAttrib;

let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=TURBO>1
  ?function(){oI();const v=cpu.vcycles|0;TT+=v;cpu.vcycles=Math.max(1,Math.round(v/TURBO));}
  :function(){oI();TT+=cpu.vcycles|0;};

// снимок габарита в заданный такт: ставим цель, ловим первый переход через неё
let target=-1,shot=null;
//  «Спрайт стоит на экране» = fb в габарите ОТЛИЧАЕТСЯ от сохранённого под ним фона.
//  Считать просто ненулевые байты fb нельзя: под героем кирпичи и лестница, они дают
//  ненулевые байты и при полностью стёртой фигуре. Эталон берём из ШАПКИ слота
//  (valid, hi0, lo0, ncols, hi0b, hi0c) и блока фона за ней (+0x06, столбцы по 16 байт,
//  плоскость за плоскостью) — это ровно то, что restore вернёт на место спрайта.
function grab(){
  let bytes=0,total=0;
  for(const slot of [4,5]){
    const pg=0xE000+slot*256;
    if(memory.read(pg+0x00,false)!==1)continue;	// слот невалиден — сравнивать не с чем
    const hi0=memory.read(pg+0x01,false),lo0=memory.read(pg+0x02,false),nc=memory.read(pg+0x03,false);
    const planes=[hi0,memory.read(pg+0x04,false),memory.read(pg+0x05,false)].filter(p=>p);
    let off=0x06;
    for(const base of planes)for(let c=0;c<nc;c++)for(let r=0;r<16;r++){
      const a=((base+c)<<8)|((lo0+r)&255);
      const bg=memory.read(pg+off,false);off++;
      if(a<0x8000||a>=0xE000)continue;
      total++;
      if(memory.read(a,false)!==bg)bytes++;
    }
  }
  return {bytes,total};
}
v06c.check_breakpoint=function(){
  if(target>=0&&TT>=target){shot=grab();target=-1;}
  return false;};

for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);
                      E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
if(rd(L.piramideActual)!==1){console.log(`ПРОВАЛ ПОКРЫТИЯ: piramideActual=${rd(L.piramideActual)}, ждали 1`);process.exit(1);}
for(let i=0;i<800&&rd(L.GameStatus)!==5;i++)v06c.oneInterrupt(true);
if(rd(L.GameStatus)!==5){console.log("ПРОВАЛ ПОКРЫТИЯ: до геймплея не дошли");process.exit(1);}

const ROW=ri>0?+process.argv[ri+1]:72;
wr(L.ProtaY,ROW);
for(let m=0;m<8;m++){const y=rd(L.enemyAttrib+m*4);if(y<0xD0)wr(L.enemyAttrib+m*4,ROW);}

const seen=[];let held=new Set(),tick=0,prevT=0,nf=0,frames=0;
const TIMER=L.timer;
while(tick<=NT&&nf<200000){
  if(tick%64===0)for(let m=0;m<8;m++){const y=rd(L.enemyAttrib+m*4);
    if(y<0xD0&&y>ROW+8)wr(L.enemyAttrib+m*4,ROW);}
  const want=new Set([ (tick%200)<100 ? 39 : 37 ]);
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  const live=(rd(L.GameStatus)===5);
  const y=rd(ATTR+16);
  shot=null;target=live?TT+BEAM0+192*(y&255):-1;
  v06c.oneInterrupt(true);
  if(live&&shot){frames++;seen.push(shot.bytes);}
  nf++;
  const t=rd(TIMER);if(t!==prevT){prevT=t;tick++;}
}
if(frames<50){console.log(`ПРОВАЛ ПОКРЫТИЯ: снимков всего ${frames}`);process.exit(1);}
const sorted=seen.slice().sort((a,b)=>a-b);
const med=sorted[sorted.length>>1];
const half=seen.filter(v=>v<med/2).length;
const zero=seen.filter(v=>v===0).length;
const q=(p)=>sorted[Math.floor(sorted.length*p)];
console.log(`ROM=${ROM.split("/").pop()}  ЧТО ВИДИТ ЛУЧ над строкой ${ROW}${TURBO>1?`  [turbo x${TURBO}]`:""}`);
console.log(`   луч приходит на такте ${BEAM0+192*ROW} из 59904; снимков ${frames}`);
console.log(`   байт силуэта под лучом: медиана ${med}, p10 ${q(0.1)}, p50 ${q(0.5)}, p90 ${q(0.9)}`);
console.log(`   ПРОВАЛЫ (< половины медианы): ${half} = ${(100*half/frames).toFixed(2)}%`);
console.log(`   ПОЛНАЯ ПРОПАЖА (0 байт):      ${zero} = ${(100*zero/frames).toFixed(2)}%`);
