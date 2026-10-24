// hud_junk_gate.js — «МУСОР НА HUD И ВЕРХНЕЙ СТРОКЕ ПРИ ПЕРЕПРЫГИВАНИИ МУМИЙ»
// (жалоба с железа 2026-08-07, ROM d7d25aeb, сразу после стек-блита).
//
// ГЕОМЕТРИЯ (промерена, а не угадана). Адрес fb = плоскость + столбец*256 + lo,
// lo = 240 - Y_героя ... +15 (шапка слота +0x98 = lo0). Экранная строка r=(31-lo)&255.
//   lo 248..254 = r 33..39 — ПОЛОСА HUD (счёт/жизни; лежит в p0 и p1, p2 пуст);
//   lo 255      = r 32     — первая строка над полем;
//   lo 0..31    = r 31..0  — ВЕРХНЯЯ КАЙМА (весь габарит спрайта, заехавший выше HUD,
//                            попадает СЮДА через заворот `inc l`/`inc c` в столбце).
// Пол верхней площадки пирамиды 1 — Y=8 (lo0=232, строки 232..247, HUD не задет).
// Прыжок уводит Y в 0..7 и в отрицательные (0xF0..0xFF): lo0 доходит до 248+, и часть
// спрайта ложится В HUD, а хвост заворачивается в кайму.
//
// [ЗАДАЧА#56, 2026-08-10] ЗОНА ПЕРЕОСМЫСЛЕНА. Строка табло уехала из ряда 0 в кайму
// (ряд 30 = lo 15..8), поэтому теперь в зоне наблюдения лежат ДВЕ разные вещи:
//   lo 248..255 — ВЕРХНЯЯ СТРОКА ИГРОВОГО ПОЛЯ (её фон нулевой, спрайты по ней ходят
//                 законно — их габарит маскируется ниже по шапкам слотов);
//   lo 0..31    — КАЙМА: буквы табло в lo 15..8 (ряд 30), lo 7..0 — РАБОЧАЯ ЗОНА
//                 СПРАЙТОВ (раунд 2, 2026-08-12: верхний зазор отдан габариту, vclp
//                 пускает спрайт до fb 7), lo 31..16 пусто. Сторожит top_border_gate.
//
// КРИТЕРИЙ АБСОЛЮТНЫЙ, БЕЗ ЭТАЛОНА-РЕНДЕРА. map_fidelity зону не покрывает (табло не
// рисуется из карты). Поэтому эталон снимается до сцены, а дальше любой байт зоны,
// отличающийся от эталона НА КОНЕЦ КАДРА и не накрытый габаритом живого слота, — мусор.
// [ИСПРАВЛЕНА НЕЧЕСТНОСТЬ ГЕЙТА, 2026-08-10] В шапке стояло «в стенде счёт не меняется
// (герой только прыгает), поэтому легальных отличий нет». ЭТО БЫЛО НЕВЕРНО: стенд сажает
// мумию В ТОЧКУ ГЕРОЯ, а перепрыгивание мумии НАЧИСЛЯЕТ ОЧКИ — цифры счёта и рекорда
// перерисовываются, и гейт годами считал это мусором. Замер: 405 кадров из 1375 = 29.5%,
// ровно 24 байта в столбцах 10 и 20 (средние цифры score и hi), писал их ТАЙЛОВЫЙ БЛИТ
// (vbt8_cp/vbt_row), а не пачка спрайтов. То же число на любой сборке до и после переезда
// табло. Теперь гейт СЛЕДИТ ЗА СЧЁТЧИКАМИ (score/record/Vidas): в кадре, где они
// изменились, эталон зоны переснимается, а сам кадр не судится.
//
// ЗАМЕР 2026-08-07: ОСТАТОЧНОГО мусора нет НИ В ОДНОЙ сборке (0 кадров из 879 и на
// d7d25aeb со стек-блитом, и на ab6e4569 до него) — restore чистит зону полностью.
// Видимый дефект транзиентный, его меряет top_border_gate.js.
//
// Запуск: node tools/verify/hud_junk_gate.js [rom] [sym] [тиков=600] [--nojump] [--nomum]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
let ROM=null,SYM=null,NT=null;
for(const a of process.argv.slice(2)){
  if(/^--/.test(a))continue;
  if(/\.sym$/i.test(a)){SYM=a;continue;}
  if(/\.rom$/i.test(a)){ROM=a;continue;}
  if(/^\d+$/.test(a)){NT=+a;continue;}}
ROM=ROM||T+"/../../build/kvalley_8c.rom";
SYM=SYM||T+"/../../build/kvalley_8c.sym";
NT=NT===null?600:NT;
const NOJUMP=process.argv.indexOf("--nojump")>0;
const NOMUM=process.argv.indexOf("--nomum")>0;
const ROW=(()=>{const i=process.argv.indexOf("--row");return i>0?+process.argv[i+1]:8;})();

const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
// зона наблюдения: lo 248..255 (HUD) и lo 0..31 (кайма над HUD — туда заворачивает столбец)
const inZone=lo=>(lo>=248||lo<=31);
const PL=[0x8000,0xA000,0xC000];   // p3 (0xE000+) — не экран, там слоты save-under

// ===== ловушка записей =====
const lastPC=new Uint16Array(0x6000);
let inPack=false, packWrites=0;
const zoneWriters={};      // PC -> сколько записей в зону во время пачки
const oW=memory.write.bind(memory);
memory.write=function(addr,w8,st){
  const a=addr&0xffff;
  if(a>=0x8000&&a<0xE000){
    lastPC[a-0x8000]=cpu.pc;
    if(inPack&&inZone(a&255)){packWrites++;
      zoneWriters[cpu.pc]=(zoneWriters[cpu.pc]||0)+1;}
  }
  oW(addr,w8,st);
};
const OUT=L.vec_spr_out;
let outRet=-1,outSp=-1;
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===OUT&&outRet<0){outSp=cpu.sp;outRet=retOf();inPack=true;}
  else if(outRet>=0&&pc===outRet&&cpu.sp>outSp){outRet=-1;inPack=false;}
  return false;};

// ===== старт партии на пирамиде 1 =====
const runf=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
runf(700);
for(let i=0;i<30;i++){E.key(32,1);runf(3);E.key(32,0);runf(3);}
if(rd(L.piramideActual)!==1){console.log(`ПРОВАЛ ПОКРЫТИЯ: piramideActual=${rd(L.piramideActual)}`);process.exit(1);}
for(let i=0;i<800&&rd(L.GameStatus)!==5;i++)v06c.oneInterrupt(true);
if(rd(L.GameStatus)!==5){console.log("ПРОВАЛ ПОКРЫТИЯ: до геймплея не дошли");process.exit(1);}
wr(L.ProtaY,ROW);
runf(10);

// ===== ЭТАЛОН ЗОНЫ (до сцены) =====
const ref=new Map();
const snap=()=>{const m=new Map();
  for(const p of PL)for(let c=0;c<32;c++)for(let lo=0;lo<256;lo++)if(inZone(lo)){
    const a=p+c*256+lo;m.set(a,rd(a));}
  return m;};
for(const [a,v] of snap())ref.set(a,v);

// ===== прогон =====
const ATTR=L.sprAttrib, TIMER=L.timer;
let held=new Set(), tick=0, prevT=0, nf=0, prevCnt=null, hudRedraw=0, redrawSkip=0;
let dirtyFrames=0, dirtyBytesMax=0, dirtyBytesSum=0, framesLive=0;
const dirtyBy={};          // адрес -> сколько кадров он был испорчен
const dirtyKiller={};      // кто последним писал в испорченный байт
const ys=[]; const lo0s=[];
let hudTouchFrames=0;
while(tick<=NT&&nf<200000){
  // мумия 0 — В ТОЧКУ ГЕРОЯ на той же строке: прыгаем ЧЕРЕЗ неё
  if(!NOMUM){const y=rd(L.enemyAttrib);
    if(y<0xD0){wr(L.enemyAttrib,ROW);wr(L.enemyAttrib+1,(rd(L.ProtaX)+6)&255);}}
  const ph=tick%20;
  const want=new Set();
  if(!NOJUMP&&ph<3)want.add(32);
  want.add((tick%120)<60?39:37);
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  v06c.oneInterrupt(true);
  nf++;
  if(rd(L.GameStatus)!==5)continue;
  //  ЛЕГАЛЬНАЯ ПЕРЕРИСОВКА ТАБЛО: счёт/рекорд/жизни изменились -> цифры блитятся заново.
  //  Эталон переснимаем, кадр не судим (иначе гейт ловит собственный стенд).
  const cnt=[0,1,2].map(i=>rd(L.score_0000xx+i)).concat([0,1,2].map(i=>rd(L.record_0000xx+i)))
            .concat([rd(L.Vidas)]).join(",");
  //  Блит цифр приходит НА КАДР ПОЗЖЕ смены счётчика (замер: счёт сменился в кадре 977,
  //  байты табло — в 978), поэтому пережидаем 3 кадра, а не один.
  if(cnt!==prevCnt){prevCnt=cnt;redrawSkip=3;}
  if(redrawSkip>0){redrawSkip--;hudRedraw++;for(const [a,v] of snap())ref.set(a,v);continue;}
  framesLive++;
  const yv=rd(ATTR+16); ys.push(yv>=0xF0?yv-256:yv);
  for(const s of [4,5])if(rd(0xE000+s*256))lo0s.push(rd(0xE000+s*256+2));
  //  МАСКА «ТУТ СЕЙЧАС ЗАКОННО ЛЕЖИТ СПРАЙТ». Прыгающий герой ДОЛЖЕН быть виден поверх
  //  HUD, пока он там — это не мусор. Мусор — то, что осталось ВНЕ габаритов всех живых
  //  слотов (габарит берётся из ШАПКИ: hi0/hi0b/hi0c + ncols, lo0..lo0+15).
  const cov=new Set();
  for(let s=0;s<24;s++){const pg=0xE000+s*256;
    if(!rd(pg))continue;
    const nc=rd(pg+3); if(!nc)continue;
    const lo0=rd(pg+2);
    for(const off of [1,4,5]){const h0=rd(pg+off); if(!h0)continue;
      for(let c=0;c<nc;c++)for(let k=0;k<16;k++)cov.add(((h0+c)&0xFF)*256+((lo0+k)&255));}}
  let d=0;
  for(const [a,v] of ref){
    if(cov.has(a&0xFFFF))continue;
    const cur=rd(a);
    if(cur!==v){d++;dirtyBy[a]=(dirtyBy[a]||0)+1;
      const k=lastPC[a-0x8000];dirtyKiller[k]=(dirtyKiller[k]||0)+1;}}
  if(d){dirtyFrames++;dirtyBytesSum+=d;if(d>dirtyBytesMax)dirtyBytesMax=d;}
  const t=rd(TIMER); if(t!==prevT){prevT=t;tick++;}
}
for(const c of held)E.key(c,0);

// ===== ДЕКЛАРАЦИЯ ПОКРЫТИЯ =====
if(framesLive<200){console.log(`ПРОВАЛ ПОКРЫТИЯ: геймплейных кадров ${framesLive} < 200`);process.exit(1);}
const yl=ys.filter(y=>y<200);
const ymin=Math.min(...yl),ymax=Math.max(...yl);
const hi=lo0s.filter(l=>l>=233).length;   // габарит реально заехал в HUD
console.log(`ROM=${ROM.split("/").pop()}  пирамида 1, пол Y=${ROW}, мумия ${NOMUM?"нет":"в точке героя"}`);
console.log(`ПОКРЫТИЕ: кадров ${framesLive}, Y героя ${ymin}..${ymax}, `
  +`выводов с габаритом в верхней строке поля (lo0>=233) ${hi} из ${lo0s.length}`);
console.log(`          кадров с ЛЕГАЛЬНОЙ перерисовкой табло (счёт/рекорд/жизни менялись) ${hudRedraw} — не судятся`);
if(!NOJUMP&&hi<50){console.log("ПРОВАЛ ПОКРЫТИЯ: габарит в верхнюю строку поля не заезжал");process.exit(1);}

// ===== ОТЧЁТ =====
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x8000).sort((a,b)=>a[1]-b[1]);
const nameOf=pc=>{let lo=0,hiI=syms.length-1,r="?";
  while(lo<=hiI){const m=(lo+hiI)>>1;if(syms[m][1]<=pc){r=`${syms[m][0]}+${pc-syms[m][1]}`;lo=m+1;}else hiI=m-1;}
  return r;};
console.log(`МУСОР В ЗОНЕ (lo 248..255 верх поля + lo 0..31 кайма с табло), сверка с эталоном:`);
console.log(`   кадров с мусором  ${dirtyFrames} из ${framesLive} = ${(100*dirtyFrames/framesLive).toFixed(1)}%`);
console.log(`   байт мусора       avg ${(dirtyBytesSum/framesLive).toFixed(1)}, max ${dirtyBytesMax}`);
const da=Object.entries(dirtyBy).sort((a,b)=>b[1]-a[1]);
console.log(`   разных байт       ${da.length}`);
const byLo={};for(const [a,n] of da){const lo=+a&255;byLo[lo]=(byLo[lo]||0)+n;}
const lot=Object.entries(byLo).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([l,n])=>`lo${l}:${n}`).join(" ");
if(lot)console.log(`   по строкам        ${lot}`);
for(const [a,n] of da.slice(0,8))
  console.log(`      0x${(+a).toString(16)} (пл ${((+a>>13)&3)} стб ${(+a>>8)&31} lo ${+a&255}) испорчен в ${n} кадрах`);
const kt=Object.entries(dirtyKiller).sort((a,b)=>b[1]-a[1]).slice(0,8);
const ktot=Object.values(dirtyKiller).reduce((a,b)=>a+b,0);
console.log(`КТО ПИСАЛ В ИСПОРЧЕННЫЙ БАЙТ (${ktot} проб):`);
for(const [pc,n] of kt)console.log(`   0x${(+pc).toString(16)} ${nameOf(+pc).padEnd(26)} ${n} = ${(100*n/ktot).toFixed(1)}%`);
const zt=Object.entries(zoneWriters).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log(`ЗАПИСИ ПАЧКИ В ЗОНУ (${packWrites}):`);
for(const [pc,n] of zt)console.log(`   0x${(+pc).toString(16)} ${nameOf(+pc).padEnd(26)} ${n}`);
console.log(dirtyFrames===0?"HUD JUNK GATE OK":"HUD JUNK GATE ПРОВАЛЕН");
process.exit(dirtyFrames===0?0:1);
