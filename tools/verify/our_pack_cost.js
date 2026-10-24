// Наша пачка вывода в тех же координатах, что у Городецкого: такты ОТ ПРЕРЫВАНИЯ до старта
// и конца пачки.
//
// [2026-08-25] ШЕСТАЯ ОШИБКА ИНСТРУМЕНТА, а не кода. Здесь стояла ЗАШИТАЯ константа
// «ЛУЧ НА ВЕРХ ПОЛЯ: такт 19924», и по ней считалась доля пачек, успевающих до луча.
// Числа 19924 не бывает ни в одной сборке: vec_boot.asm:119 задаёт формулу
// BEAM0 = 13780 + 192*((vec_vscroll-0x1F)&255), а vec_vscroll равен 0x2F в игре (BEAM0 =
// 16852) и 0x27 на стартовых экранах (15316). 19924 соответствовало бы vscroll=0x3F.
// Соседние стенды (beam_ab.js:39, beam_budget.js:28) всё это время считали правильно —
// врал только этот файл, и врал В СТОРОНУ ОПТИМИЗМА: засчитывал успевшими пачки, которые
// луч уже застал. На сборке b1b3729 он печатал 93% там, где на самом деле 48%.
// Все выводы вида «до луча успевает N% пачек», снятые этим стендом до 2026-08-25,
// завышены примерно вдвое и подлежат перепроверке.
const {make}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {L,rd,v06c,cpu,cyc,FRAME,memory,keyboard}=E;
const wr=(a,v)=>memory.write(a&0xffff,v&255,false);
function tick(){const t0=rd(L.timer);do v06c.oneInterrupt(true);while(rd(L.timer)===t0);}
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
let f=0;while(f<1500&&rd(L.GameStatus)!==5){v06c.oneInterrupt(true);f++;}
for(let i=0;i<40;i++)tick();
wr(L.vec_god,1);
const MD=L.momiaDat, STEP=(L.momiaDat2!==undefined)?(L.momiaDat2-L.momiaDat):16;
function place(){const hY=rd(L.ProtaY),hX=rd(L.ProtaX),room=rd(L.ProtaRoom);
  for(let m=0;m<2;m++){const p=MD+m*STEP;wr(p+0,0);wr(p+3,hY);wr(p+5,(hX+(m?14:-14))&255);wr(p+6,room);}
  wr(L.enemyAttrib,hY);wr(L.enemyAttrib+1,(hX+14)&255);wr(L.enemyAttrib+2,hY);wr(L.enemyAttrib+3,(hX-14)&255);}
place();for(let i=0;i<10;i++)tick();
keyboard.keyDown({keyCode:39,which:39,preventDefault(){},stopPropagation(){}});
// IRQ = момент, когда PC входит в обработчик; считаем такты от него
let irqCyc=null, inPack=false, firstW=null, lastW=null;
const packs=[]; let frames=0;
const now=()=>frames*FRAME+cyc();
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x8000).sort((a,b)=>a[1]-b[1]);
const addrs=syms.map(x=>x[1]);
const near=pc=>{let l=0,h=addrs.length-1,r=0;while(l<=h){const m=(l+h)>>1;if(addrs[m]<=pc){r=m;l=m+1}else h=m-1}return syms[r][0];};
const cost={}; let prevC=0, packTicks=0;
const origW=memory.write.bind(memory);
memory.write=function(a,v,f){
// [2026-08-20 «ЧЕТЫРЕ ПЛОСКОСТИ»] МЛАДШИЕ 48 БАЙТ КАЖДОЙ СТРАНИЦЫ-СТОЛБЦА (fb 0..47) —
// НЕ КАРТИНКА, А ДАННЫЕ: там живут переменные рендера и вывода (опись в vec_boot.asm).
// Их надо исключать из счёта записей в видеопамять, иначе пачка «удлиняется» на ровном
// месте: замер давал 37484 вместо 35892 просто потому, что vso_i/vsp_n/vsrt_* переехали.
  if(inPack&&a>=0x8000&&a<0xE000&&(a&0xFF)>=0x30){const t=now();if(firstW===null)firstW=t;lastW=t;}
  return origW(a,v,f);
};
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===L.vec_isr){ irqCyc=now(); inPack=false; firstW=null; lastW=null; }
  if(pc===L.vec_spr_out&&irqCyc!==null){inPack=true;prevC=now();packTicks++;}
  if(inPack&&pc===L.vso_fix+3){                    // вернулись из пачки — это её конец
    if(firstW!==null){let s2=firstW-irqCyc,e2=lastW-irqCyc;
      if(s2<0)s2+=FRAME;if(e2<0)e2+=FRAME;if(e2<FRAME*3)packs.push([s2,e2]);}
    inPack=false; firstW=null; lastW=null;
  }
  if(inPack){const t=now();let d=t-prevC;if(d<0)d+=FRAME;if(d>0&&d<4000){const k=near(pc);cost[k]=(cost[k]||0)+d;}prevC=t;}
  return false;
};
for(let i=0;i<600;i++){v06c.oneInterrupt(true);frames++;if(i%60===0)place();}
v06c.check_breakpoint=()=>false;memory.write=origW;
const q=(a,x)=>a.length?a.slice().sort((u,v)=>u-v)[Math.min(a.length-1,Math.floor(a.length*x))]:0;
const st=packs.map(p=>p[0]), en=packs.map(p=>p[1]), du=packs.map(p=>p[1]-p[0]);
console.log(`пачек ${packs.length}`);
console.log(`  старт пачки от прерывания: медиана ${q(st,.5)}, p90 ${q(st,.9)}`);
console.log(`  конец пачки:               медиана ${q(en,.5)}, p90 ${q(en,.9)}`);
console.log(`  длительность пачки:        медиана ${q(du,.5)}, p90 ${q(du,.9)}`);
console.log("  --- из чего состоит пачка (тактов на пачку) ---");
Object.entries(cost).sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([k,v])=>console.log(`     ${String(Math.round(v/packTicks)).padStart(6)}  ${k}`));
// Такт луча — ИЗ .sym, как в beam_ab.js и beam_budget.js. Зашивать его константой нельзя:
// vec_vscroll менялся дважды за август (0x1F -> 0x27 -> 0x2F), и каждый сдвиг картинки
// двигает момент прихода луча на верх поля на 192 такта за строку.
const VS=(L.vec_vscroll===undefined)?0x1F:L.vec_vscroll;
const BEAM0=13780+192*(((VS-0x1F)&255));
if(!en.length){ console.log("ГЕЙТ ПРОВАЛЕН: пачек не собрано — прогон не дошёл до вывода спрайтов."); process.exit(2); }
console.log(`  ЛУЧ НА ВЕРХ ПОЛЯ: такт ${BEAM0} (vec_vscroll=0x${VS.toString(16).toUpperCase()}). `
          + `Успеваем ДО ЛУЧА: ${(100*en.filter(x=>x<BEAM0).length/en.length).toFixed(0)}% пачек`);
