// fastmark_why.js — ПОЧЕМУ пачка уходит на ОБЫЧНЫЙ путь (vsp_fast=0).
// Считает выходы из vsp_fastmark по адресу исполненного ret, отдельно — пачки, в которых
// есть пара героя (слоты 4 и 5 в списке подготовки). Нужен, чтобы выбрать лечение
// межплоскостного окна пары: чередование vpr_wr работает ТОЛЬКО на слитом пути.
// Запуск: node tools/verify/fastmark_why.js [rom] [sym] [тиков=1200]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NT=+(process.argv[4]||1200);
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
const FM=L.vsp_fastmark;
if(FM===undefined){console.log("нет vsp_fastmark в .sym");process.exit(2);}
// Смещения точек выхода от начала vsp_fastmark (адреса плавают при правках кода).
const OFF={0x08:"vop_i1 (непрозрачный герой)",0x0D:"vsp_n=0",0x10:"vsp_n>=8",
  0x26:"слот невалиден",0x2B:"pending!=1",0x3E:"hi0b записи != шапки",
  0x46:"hi0c записи != шапки",0x52:"hi0 ИЗМЕНИЛСЯ (объект уехал по столбцам)",
  0x5B:"ncols ИЗМЕНИЛСЯ",0x6F:"|d lo0| >= 16"};
const NAMES={};for(const o in OFF)NAMES[FM+ +o]=OFF[o];
const P1LO=FM+0x18,P1HI=FM+0x70;   // диапазон прохода 1 (в C лежит позиция объекта)
let inFm=false,fmSp=0,lastPC=0;
const cnt={},cntPair={};
let calls=0,ok=0,okPair=0,callsPair=0,pairNow=false;const slotWhy={};
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===FM&&!inFm){inFm=true;fmSp=cpu.sp;calls++;
    const n=rd(L.vsp_n);let p4=false,p5=false;
    for(let j=0;j<n&&j<21;j++){const s=rd(L.vsp_list+j);if(s===4)p4=true;if(s===5)p5=true;}
    pairNow=p4&&p5;if(pairNow)callsPair++;}
  else if(inFm&&cpu.sp>fmSp){inFm=false;
    const k=lastPC;const fast=rd(0x76);
    // C = позиция в vsp_list у объекта, на котором проход отказал (только для проходa 1).
    // ВАЖНО: регистры vector06js — ФУНКЦИИ (cpu.c()), а не поля. Первая редакция читала
    // cpu.c (NaN&255=0) и приписывала ВСЕ отказы объекту №0 списка — обычно слоту 4
    // (герою), что дало ложный диагноз «дедуплённая пара не проходит vfm_zok».
    // На деле отказы по hi0b/hi0c сидят на мумиях (слоты 6/7): их набор гасимых
    // плоскостей переключался между тиками (починено стики-гашением, vsq_sticky).
    const pos=cpu.c()&255;const slot=(k>=P1LO&&k<=P1HI&&pos<21)?rd(L.vsp_list+pos):-1;
    if(!fast&&slot>=0)slotWhy[slot]=(slotWhy[slot]||0)+1;
    if(fast){ok++;if(pairNow)okPair++;}
    else{cnt[k]=(cnt[k]||0)+1;if(pairNow)cntPair[k]=(cntPair[k]||0)+1;}}
  lastPC=pc;return false;};
function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);}else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);}else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);}else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);}else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);}return k;}
let held=new Set(),tick=0,prevT=0,nf=0;
while(tick<=NT&&nf<400000){
  const want=new Set(keysFor(tick));
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;v06c.oneInterrupt(true);nf++;
  const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;}
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
console.log(`вызовов vsp_fastmark ${calls} (из них с ПАРОЙ героя ${callsPair}); слитый путь разрешён ${ok} = ${pct(ok,calls)}, с парой ${okPair} = ${pct(okPair,callsPair)}`);
console.log(`ПРИЧИНЫ ОТКАЗА (адрес ret -> счётчик; в скобках — сколько из них пачки С ПАРОЙ):`);
console.log(`НА КАКОМ СЛОТЕ отказал проход 1: ${Object.keys(slotWhy).map(Number).sort((a,b)=>slotWhy[b]-slotWhy[a]).map(s=>`слот ${s}:${slotWhy[s]}`).join("  ")}`);
for(const k of Object.keys(cnt).map(Number).sort((a,b)=>cnt[b]-cnt[a]))
  console.log(`   0x${k.toString(16).toUpperCase()} ${NAMES[k]||"(конфликт пары объектов / прочее)"}: ${cnt[k]}  (с парой ${cntPair[k]||0})`);
