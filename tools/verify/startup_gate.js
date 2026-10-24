// startup_gate.js — ИГРА ОБЯЗАНА ДОЙТИ ДО ГЕЙМПЛЕЯ.
//
// ПОВОД (2026-08-05). За один день ТРИ правки подряд в узле «тик / фаза P / ISR» сломали
// старт: игра переставала доходить до партии, GameStatus застревал на 4. Все три раза это
// ловилось ВРУЧНУЮ и по случайности — прочие гейты (hero_atomic, door_*, atomic_gate,
// spr_colwrap) на такой сборке просто не находят своей сцены и молчат или падают по
// покрытию, не называя причины. Один из откатов случился уже ПОСЛЕ заливки на железо.
//
// ЧТО ПРОВЕРЯЕТ (три ступени, каждая падает со своим диагнозом):
//   1) старт партии: после нажатия пробела piramideActual == 1 (без нажатия игра уходит
//      в аттракт-демо, а оно стартует на пирамиде 5 — этим уже обманывался door-гейт);
//   2) геймплей: GameStatus доходит до 5 и держится (не мелькает);
//   3) живость: за время наблюдения игрок реально двигается — координаты в sprAttrib
//      меняются. Иначе «дошли до 5» ничего не значит: герой мог зависнуть.
//
// ЧЕТВЁРТАЯ СТУПЕНЬ — ЧАСТОТА И МОДЕЛЬ ТАКТОВ (просьба владельца: «проверь, что эмулятор
// работает на 100% 3 МГц i8080, чтобы замер был верен»). Все выводы о плавности опираются
// на такты, поэтому стенд обязан сам доказывать, что считает их правильно:
//   кадр = 59904 такта (3 МГц при 50.08 Гц) — допуск 0.1%;
//   цены инструкций совпадают с моделью ШИНЫ Вектора (слот cpu_ready = 4 такта, T-состояния
//   8080 округляются вверх): MOV r,r = 8, LHLD = 20, CALL = 24.
//   NB: NOP = 4 такта, а НЕ 8 — 4 T-состояния 8080 уже кратны слоту. Ожидание «8 как у
//   MOV r,r» было моей ошибкой при первой проверке.
//
// Запуск: node tools/verify/startup_gate.js [rom] [sym]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const E=make(ROM,SYM);
const {L,rd,v06c}=E;
for(const s of ["GameStatus","piramideActual","sprAttrib"])
  if(L[s]===undefined){console.log("нет символа "+s+" в "+SYM);process.exit(2);}

// --- ступень 0: часы эмулятора. ОТДЕЛЬНЫЙ экземпляр: прогон на 300 кадров сдвигает
// игру, и основной сеанс успевает уйти в аттракт-демо (проверено — гейт сам себя ронял).
{
  const E0=make(ROM,SYM);
  const v06c=E0.v06c, cpu=E0.cpu, memory=E0.memory;
  let TT=0; const oI=cpu.instruction.bind(cpu);
  cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
  for(let i=0;i<200;i++)v06c.oneInterrupt(true);
  const a=TT; for(let i=0;i<100;i++)v06c.oneInterrupt(true);
  const perFrame=(TT-a)/100, hz=perFrame*50;
  const dev=Math.abs(perFrame-59904)/59904;
  console.log(`     кадр ${perFrame} тактов -> ${(hz/1e6).toFixed(4)} МГц (эталон 59904 / 3 МГц)`);
  if(dev>0.001){console.log(`FAIL часы: кадр ${perFrame} тактов, отклонение ${(dev*100).toFixed(2)}% > 0.1%`);
    console.log("   Замеры плавности опираются на такты — при неверных часах они бессмысленны.");
    process.exit(1);}
  const probe=(bytes,name,expect)=>{
    const at=0x100;
    for(let i=0;i<bytes.length;i++)memory.write(at+i,bytes[i],false);
    cpu.pc=at; const t0=TT; cpu.instruction(); const d=TT-t0;
    if(d!==expect){console.log(`FAIL модель тактов: ${name} = ${d}, ожидание ${expect}`);
      console.log("   Модель шины Вектора (слот cpu_ready = 4 такта) не соблюдается.");
      process.exit(1);}
    return `${name}=${d}`;};
  const r=[probe([0x78],"MOV A,B",8),probe([0x00],"NOP",4),
           probe([0x2A,0x00,0x30],"LHLD",20),probe([0xCD,0x00,0x30],"CALL",24)];
  console.log(`OK   часы и модель тактов: ${r.join(" ")}`);
}

let bad=0;
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);
                      E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}

const pira=rd(L.piramideActual);
if(pira!==1){
  console.log(`FAIL старт партии: piramideActual=${pira}, ждали 1`);
  console.log("   (без нажатия пробела игра уходит в аттракт-демо — оно стартует на пирамиде 5)");
  process.exit(1);
}
console.log(`OK   старт партии: пирамида ${pira}`);

// ждём геймплея и считаем распределение статусов
const hist={};let firstPlay=-1;
for(let f=0;f<1200;f++){
  v06c.oneInterrupt(true);
  const g=rd(L.GameStatus);
  hist[g]=(hist[g]||0)+1;
  if(g===5&&firstPlay<0)firstPlay=f;
}
const play=hist[5]||0;
console.log(`     статусы за 1200 кадров: ${JSON.stringify(hist)}`);
if(play<200){
  console.log(`FAIL геймплей: GameStatus=5 всего в ${play} кадрах из 1200 (нужно >= 200)`);
  console.log("   Игра не доходит до партии — так выглядели все три поломки 2026-08-05.");
  process.exit(1);
}
console.log(`OK   геймплей: ${play} кадров, первый на ${firstPlay}`);

// живость: герой должен двигаться под управлением
const seen=new Set();
let held=-1;
for(let f=0;f<600;f++){
  const k=(f%200)<100?39:37;
  if(held!==k){if(held>=0)E.key(held,0);E.key(k,1);held=k;}
  v06c.oneInterrupt(true);
  if(rd(L.GameStatus)===5)seen.add(`${rd(L.sprAttrib+17)},${rd(L.sprAttrib+16)}`);
}
console.log(`     различных позиций героя за 600 кадров: ${seen.size}`);
if(seen.size<5){
  console.log(`FAIL живость: герой почти не двигается (${seen.size} различных позиций, нужно >= 5)`);
  console.log("   Так выглядит «дошли до геймплея, но логика встала» — этим обманывался");
  console.log("   первый вариант hero_top_stress, где герой висел в воздухе.");
  process.exit(1);
}
console.log("OK   живость: герой двигается");
console.log("STARTUP GATE OK");
