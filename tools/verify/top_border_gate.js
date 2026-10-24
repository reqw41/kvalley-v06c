// top_border_gate.js — «В ВЕРХНЮЮ КАЙМУ НЕ ПИШЕТ НИКТО» (ЗАДАЧА#56, 2026-08-10).
//
// СМЫСЛ ГЕЙТА ПЕРЕПИСАН. Раньше кайма (fb-строки lo 0..31) была пустой чёрной полосой, и
// критерием был «ноль ненулевых байт»: туда заворачивался хвост спрайта через `inc l`
// (255->0), и это был просто мусор над полем — открытый дефект, 40% кадров.
// ТЕПЕРЬ В КАЙМЕ ЖИВЁТ ТАБЛО: строка SCORE/HI/REST переехала в ряд 30 таблицы имён =
// fb 15..8 (см. res_ui_gfx.asm), картинка перецентрована vec_vscroll=0x27. Значит
// критерий «ноль» больше не годится — в кайме ЗАКОННО лежат буквы. Новый критерий:
//   ЛЮБОЕ ИЗМЕНЕНИЕ БАЙТА В lo 0..63 ОТНОСИТЕЛЬНО СПОКОЙНОГО КАДРА = ДЕФЕКТ.
// ЗОНА lo 0..63, А НЕ 0..31: кадр показывает СВЕРХУ fb V..0, а СНИЗУ fb 63..V+1 (V =
// vec_vscroll) — то есть ВСЯ полоса fb 63..0 видима, просто разными концами. Габарит
// спрайта может вылезти и вниз (lo0 = 239-Y, при Y=191 это 48), поэтому сторожим целиком.
// [РАУНД 3, 2026-08-12] В КАЙМЕ ТРИ ЗАКОННЫЕ ЗОНЫ:
//   lo 15..8  — ТАБЛО SCORE/HI/REST (ряд 30, как в 1.01b);
//   lo 63..56 — НИЖНЯЯ СТРОКА UI ©KONAMI/PYRAMID-NN (ряд 24, ВПЛОТНУЮ к дну поля,
//               отцентрирована по горизонтали: столбцы 6..25);
//   lo 7..0   — ЗОНА СПРАЙТОВ: верхний зазор отдан габариту (vclp пускает спрайт до fb 7).
// Зоны спрайтов касается ОТДЕЛЬНЫЙ критерий (см. ниже): менять её байты законно, но
// после ухода спрайта она обязана вернуться в НОЛЬ — иначе это протухший след.
// Остальное (lo 16..55) обязано быть НУЛЕВЫМ всегда — это пустые поля кадра.
// ДВА ЗАКОННЫХ ИСКЛЮЧЕНИЯ, КОТОРЫХ НА СТЕНДЕ НЕТ: метка режима звука (vec_snd_show,
// клавиша S) — ряд 24, столбцы 28-31, висит 2 секунды; метка версии V1-01B — ряд 25
// (lo 55..48), живёт только на титуле и стирается шторкой при старте партии.
// Он строже прежнего сразу с двух сторон: ловит и мусор в пустой части каймы (было 0 ->
// стало !=0), и затирание/подсветку самого табло (было !=0 -> стало другое). Спрайтовому
// конвейеру в этой зоне делать нечего вообще — его габарит жёстко отсечён по fb 255
// (vclp в vec_sprout.asm) сверху и упирается в дно поля снизу. ЕДИНСТВЕННОЕ ЗАКОННОЕ ИЗМЕНЕНИЕ — перерисовка самих цифр,
// когда счёт/рекорд/жизни реально изменились: стенд гоняет героя по мумиям, а
// перепрыгивание мумии начисляет очки. Эти кадры ловятся по счётчикам и не судятся
// (см. cntOf/resnap ниже) — та же поправка, что и в hud_junk_gate.
//
// ДЕКЛАРАЦИЯ ПОКРЫТИЯ (гейт обязан падать на пустой выборке):
//   1) ОБЕ полосы UI (lo 15..8 табло и lo 55..48 нижняя строка) НЕ ПУСТЫ — иначе
//      «ничего не изменилось» ничего не значит;
//   2) пустые поля кадра (lo 0..7, 16..47, 56..63) ПУСТЫ НА ЭТАЛОНЕ — иначе он уже грязен;
//   3) в прогоне были кадры с ОТРИЦАТЕЛЬНЫМ Y героя (0xF0..0xFF) — ровно та геометрия,
//      которая заводит габарит в зону спрайтов. Нет их — сцена не воспроизведена;
//   4) СПРАЙТ РЕАЛЬНО ЗАХОДИЛ В ЗОНУ lo 7..0 (кадры, где там есть ненулевые байты) —
//      иначе «следа нет» означает лишь «никто туда и не рисовал».
//
// Запуск: node tools/verify/top_border_gate.js [rom] [sym] [кадров] [--row N]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
let ROM=null,SYM=null,NF=null;
for(const x of process.argv.slice(2)){
  if(/^--/.test(x))continue;
  if(/\.sym$/i.test(x)){SYM=x;continue;}
  if(/\.rom$/i.test(x)){ROM=x;continue;}
  if(/^\d+$/.test(x)){NF=+x;continue;}}
ROM=ROM||T+"/../../build/kvalley_8c.rom";
SYM=SYM||T+"/../../build/kvalley_8c.sym";
NF=NF===null?900:NF;
const ROW=(()=>{const i=process.argv.indexOf("--row");return i>0?+process.argv[i+1]:8;})();

const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
const wr=(x,v)=>memory.write(x&0xffff,v&0xff,false);
const runf=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
runf(700);
for(let i=0;i<30;i++){E.key(32,1);runf(3);E.key(32,0);runf(3);}
for(let i=0;i<800&&rd(L.GameStatus)!==5;i++)v06c.oneInterrupt(true);
if(rd(L.GameStatus)!==5){console.log("ПРОВАЛ ПОКРЫТИЯ: до геймплея не дошли");process.exit(1);}
if(rd(L.piramideActual)!==1){console.log("ПРОВАЛ ПОКРЫТИЯ: не пирамида 1");process.exit(1);}

//  ЭТАЛОН КАЙМЫ: снят на спокойном кадре, ДО того как герой полез прыгать.
const ref=new Map();
for(let p=0x8000;p<0xE000;p+=0x2000)for(let c=0;c<32;c++)for(let lo=0;lo<64;lo++)
  ref.set(p+c*256+lo,rd(p+c*256+lo));
const nz=(a,b)=>{let n=0;for(const [ad,v] of ref){const lo=ad&255;if(lo>=a&&lo<=b&&v)n++;}return n;};
const hudBytes=nz(8,15), botBytes=nz(56,63), gapBytes=nz(0,7)+nz(16,55);
if(hudBytes===0){console.log("ПРОВАЛ ПОКРЫТИЯ: полоса табло lo 8..15 ПУСТА — сторожить нечего");process.exit(1);}
if(botBytes===0){console.log("ПРОВАЛ ПОКРЫТИЯ: нижняя строка UI lo 63..56 ПУСТА — сторожить нечего");process.exit(1);}
if(gapBytes!==0){console.log(`ПРОВАЛ ПОКРЫТИЯ: пустые поля кадра (lo 0..7, 16..55) грязны ДО сцены (${gapBytes} байт)`);process.exit(1);}

//  ГЕОМЕТРИЯ ЗОН ПО lo (раунд 2, 2026-08-12):
//    7..0   ЗОНА СПРАЙТОВ — менять законно, но ТОЛЬКО под живым габаритом;
//    15..8  ТАБЛО — менять законно ТОЛЬКО при смене счёта/рекорда/жизней;
//    63..56 НИЖНЯЯ СТРОКА UI — статична в геймплее;
//    остальное (16..55) — пустые поля кадра, ни байта.
const inSprZone=lo=>lo<=7;
//  Габариты ЖИВЫХ слотов на текущем кадре: шапка слота = valid, hi0, lo0, ncols, hi0b, hi0c.
//  Строки габарита берутся ПО МОДУЛЮ 256 — в этом вся суть правки: габарит заворачивается
//  через 255->0, и «покрытая» строка зоны спрайтов лежит именно за заворотом.
const coverSet=()=>{const cov=new Set();
  for(let s2=0;s2<24;s2++){const pg=0xE000+s2*256;
    if(!rd(pg))continue;
    const lo0=rd(pg+2), nc=rd(pg+3); if(!nc)continue;
    for(const h of [rd(pg+1),rd(pg+4),rd(pg+5)]){ if(!h)continue;
      for(let c=0;c<nc;c++)for(let k=0;k<16;k++)cov.add(((h+c)<<8)|((lo0+k)&255));}}
  return cov;};
wr(L.ProtaY,ROW);
for(let m=0;m<8;m++){const y=rd(L.enemyAttrib+m*4); if(y<0xD0)wr(L.enemyAttrib+m*4,ROW);}
runf(10);

// кто пишет в кайму
const lastPC=new Uint16Array(0x6000);
const oW=memory.write.bind(memory);
memory.write=function(addr,w8,st){const a=addr&0xffff;
  if(a>=0x8000&&a<0xE000&&(a&255)<64)lastPC[a-0x8000]=cpu.pc;
  oW(addr,w8,st);};

let held=new Set(), tick=0, prevT=0, live=0;
let dirtyFrames=0, worst=0, sum=0, negY=0, outs=0, hiLo=0;
let sprZoneFrames=0, trailFrames=0, trailBytes=0, hudTouch=0;
let prevCnt=null, redrawSkip=0, hudRedraw=0;
//  ЛЕГАЛЬНАЯ ПЕРЕРИСОВКА ТАБЛО. Стенд гоняет героя по верхней площадке, где сидят мумии;
//  перепрыгивание мумии НАЧИСЛЯЕТ ОЧКИ, и цифры счёта/рекорда блитятся заново — это
//  не мусор, а работа renderScore. Ловим по счётчикам и пережидаем 3 кадра (замер:
//  блит цифр приходит на кадр ПОЗЖЕ смены счётчика), переснимая эталон.
const cntOf=()=>[0,1,2].map(i=>rd(L.score_0000xx+i))
  .concat([0,1,2].map(i=>rd(L.record_0000xx+i))).concat([rd(L.Vidas)]).join(",");
const resnap=()=>{for(let p=0x8000;p<0xE000;p+=0x2000)for(let c=0;c<32;c++)for(let lo=0;lo<64;lo++)
  ref.set(p+c*256+lo,rd(p+c*256+lo));};
const killer={};
const ATTR=L.sprAttrib;
for(let f=0;f<NF;f++){
  const want=new Set();
  if(tick%20<3)want.add(32);
  want.add((tick%120)<60?39:37);
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  v06c.oneInterrupt(true);
  const t=rd(L.timer); if(t!==prevT){prevT=t;tick++;}
  if(rd(L.GameStatus)!==5)continue;
  const cnt=cntOf();
  if(cnt!==prevCnt){prevCnt=cnt;redrawSkip=3;}
  if(redrawSkip>0){redrawSkip--;hudRedraw++;resnap();continue;}
  live++;
  //  ПОКРЫТИЕ: Y героя ушёл за ноль => габарит ДО клипа заехал бы в кайму
  if(rd(ATTR+16)>=0xF0)negY++;
  for(let s=0;s<24;s++){const pg=0xE000+s*256;
    if(!rd(pg)||!rd(pg+3))continue; outs++; if(rd(pg+2)>248)hiLo++;}
  //  ЗОНА СПРАЙТОВ lo 7..0: ненулевой байт законен ТОЛЬКО под живым габаритом.
  const cov=coverSet(); let inzone=0, trail=0;
  for(let p=0x8000;p<0xE000;p+=0x2000)for(let c=0;c<32;c++)for(let lo=0;lo<=7;lo++){
    const a=p+c*256+lo; if(!rd(a))continue; inzone++;
    if(!cov.has(((a>>8)&255)<<8|lo)){trail++;const k=lastPC[a-0x8000];killer[k]=(killer[k]||0)+1;}}
  if(inzone)sprZoneFrames++;
  if(trail){trailFrames++;trailBytes+=trail;}
  //  Остальная кайма (lo 8..63) — побайтная сверка с эталоном, как раньше.
  let n=0;
  for(const [a,v] of ref){const lo=a&255; if(inSprZone(lo))continue;
    if(rd(a)!==v){n++;if(lo>=8&&lo<=15)hudTouch++;const k=lastPC[a-0x8000];killer[k]=(killer[k]||0)+1;}}
  if(n){dirtyFrames++;sum+=n;if(n>worst)worst=n;}
}
for(const c of held)E.key(c,0);
console.log(`ROM=${ROM.split("/").pop()}  верхняя площадка пирамиды 1 (Y=${ROW}), прыжки`);
console.log(`ПОКРЫТИЕ: геймплейных кадров ${live}, выводов ${outs}; эталон каймы — табло ${hudBytes} байт, `
  +`нижняя строка ${botBytes} байт, зазоры 0;`);
console.log(`          кадров с ОТРИЦАТЕЛЬНЫМ Y героя ${negY}; записей вывода с lo0>240 (клип не сработал) ${hiLo}`);
console.log(`          кадров с ЛЕГАЛЬНОЙ перерисовкой табло (счёт/рекорд/жизни менялись) ${hudRedraw} — не судятся`);
if(live<200){console.log("ПРОВАЛ ПОКРЫТИЯ: кадров мало");process.exit(1);}
if(negY<50){console.log("ПРОВАЛ ПОКРЫТИЯ: за ноль Y не уходил — сцена заворота не воспроизведена");process.exit(1);}
if(hiLo!==0){console.log(`ПРОВАЛ: клип не держит инвариант lo0<=248 (${hiLo} записей)`);process.exit(1);}
if(sprZoneFrames<50){console.log(`ПРОВАЛ ПОКРЫТИЯ: спрайт заходил в зону lo 7..0 лишь в ${sprZoneFrames} кадрах`);process.exit(1);}
console.log(`ЗОНА СПРАЙТОВ lo 7..0: кадров со спрайтом в зоне ${sprZoneFrames} = ${(100*sprZoneFrames/live).toFixed(1)}%; `
  +`ПРОТУХШИЙ СЛЕД (байты вне живого габарита): кадров ${trailFrames}, байт ${trailBytes}`);
console.log(`ИЗМЕНЕНИЯ КАЙМЫ lo 63..8 (табло/подпись/пустые поля): кадров ${dirtyFrames} из ${live} = `
  +`${(100*dirtyFrames/live).toFixed(1)}%, байт avg ${(sum/live).toFixed(1)}, max ${worst}; `
  +`ИЗ НИХ В ТАБЛО lo 15..8: ${hudTouch} байто-проб`);
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x8000).sort((x,y)=>x[1]-y[1]);
const nameOf=pc=>{let lo=0,hiI=syms.length-1,r="?";
  while(lo<=hiI){const m=(lo+hiI)>>1;if(syms[m][1]<=pc){r=`${syms[m][0]}+${pc-syms[m][1]}`;lo=m+1;}else hiI=m-1;}
  return r;};
const kt=Object.entries(killer).sort((x,y)=>y[1]-x[1]).slice(0,8);
const ktot=Object.values(killer).reduce((x,y)=>x+y,0);
if(ktot){console.log(`КТО НАПИСАЛ (${ktot} байто-проб):`);
  for(const [pc,n] of kt)console.log(`   0x${(+pc).toString(16)} ${nameOf(+pc).padEnd(26)} ${n} = ${(100*n/ktot).toFixed(1)}%`);}
const ok = dirtyFrames===0 && trailFrames===0 && hudTouch===0;
console.log(ok?"TOP BORDER GATE OK":"TOP BORDER GATE ПРОВАЛЕН");
process.exit(ok?0:1);
