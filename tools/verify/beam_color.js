// beam_color.js — МЕЖПЛОСКОСТНОЙ ТРАНЗИЕНТ: какой ЦВЕТ луч показал на самом деле.
//
// ЗАЧЕМ ЕЩЁ ОДНА МЕТРИКА (наблюдение с железа, 2026-08-02: «у героя лицо подмаргивает
// бело-красным, всё в верхней строке»). Прежние метрики смотрят на БАЙТЫ:
//   beam_late — луч между стиранием и выводом («дырка», объекта нет вовсе);
//   beam_tear — окно строки fb, то есть смесь старого и нового ВНУТРИ одной плоскости.
// Обе слепы к дефекту, который живёт МЕЖДУ ПЛОСКОСТЯМИ: каждый байт записан один раз и
// правильным значением, но цвет пикселя на Векторе — это КОМБИНАЦИЯ битов p0/p1/p2, и
// пока записана одна плоскость, а вторая нет, луч показывает цвет, которого нет ни в
// старом кадре, ни в новом (белый вместо красного). Байтовые метрики при этом молчат.
//
// ЧТО СЧИТАЕТ. Для каждого пикселя игрового поля, чьи байты трогали в этом кадре:
//   ЦВЕТ ПОКАЗАННЫЙ = биты трёх плоскостей на момент прохода луча над этим пикселем;
//   ЦВЕТ СТАРЫЙ     = состояние на входе в кадр (его показывал прошлый кадр целиком);
//   ЦВЕТ НОВЫЙ      = состояние на конец кадра.
// Пиксель считается МЕЖПЛОСКОСТНЫМ ТРАНЗИЕНТОМ, если показанный цвет НЕ РАВЕН НИ старому,
// НИ новому — то есть луч показал комбинацию, которой в игре не было вовсе.
// Отдельно считается ОКНО МЕЖДУ ПЛОСКОСТЯМИ: такты от первой записи в пиксель до
// последней (когда в кадре его трогают в двух и более плоскостях) и как часто в это окно
// попадает луч.
// Модель луча та же, что в beam_tear/beam_late, плюс ход луча ВНУТРИ строки:
//   T(байт) = irq + 13780 + 192*Y + 6*столбец,  Y = 255 - lo(адрес), столбец = (адрес>>8)&31.
//
// Запуск: node tools/verify/beam_color.js <rom> <sym> [тиков=2600]
// Клавиши подаются ПО ИГРОВЫМ ТИКАМ (как beam_ab.js), поэтому сборки сравнимы напрямую.
"use strict";
const {make}=require("./beam_harness.js");
const ROM=process.argv[2],SYM=process.argv[3],NT=+(process.argv[4]||2600);
if(!ROM||!SYM){console.log("usage: node beam_color.js <rom> <sym> [тиков]");process.exit(2);}
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
if(!L.timer){console.log("нет символа timer в .sym");process.exit(2);}
const TIMER=L.timer,ISR=L.vec_isr;
// ЗАДАЧА#43: верх поля приходит НЕ на фиксированном такте — его сдвигает аппаратный
// вертикальный скролл. Берём vec_vscroll из .sym: каждая лишняя статичная строка
// сверху = +192 такта до прихода луча (0x1F = поле по центру, 0x3F = прижато к низу).
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));

const FB0=0x8000,PLN=0x2000,NPL=3;            // p0/p1/p2; хвост 0xE000+ — слоты, не экран
let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
const cur=new Uint8Array(PLN*NPL), shown=new Uint8Array(PLN*NPL), old=new Uint8Array(PLN*NPL);
const firstT=new Float64Array(PLN), lastT=new Float64Array(PLN), pmask=new Uint8Array(PLN);
const dirty=new Int32Array(PLN); let nDirty=0;
let irq=-1,live=false;
const beamT=(k)=>irq+BEAM0+192*(255-(k&255))+6*((k>>8)&31);
const oW=memory.write.bind(memory);
memory.write=function(addr,w8,stackrq){
  oW(addr,w8,stackrq);
  const a=addr&0xffff;
  if(a<FB0||a>=0xE000)return;
  const idx=a-FB0,k=idx&0x1FFF,pl=idx>>13;
  cur[idx]=w8&0xff;
  if(!live)return;
  if(TT<=beamT(k))shown[idx]=w8&0xff;         // луч ещё не дошёл — увидит новое значение
  if(!pmask[k]){dirty[nDirty++]=k;firstT[k]=TT;}
  lastT[k]=TT;pmask[k]|=1<<pl;
};
const zones=[[0,48],[48,64],[64,96],[96,192]];
const zoneOf=Y=>{for(let i=0;i<zones.length;i++)if(Y>=zones[i][0]&&Y<zones[i][1])return i;return -1;};
let frames=0,badPix=0,lagPix=0,newPix=0;
const zBad=zones.map(()=>0), slotBad={};
let winN=0,winSum=0,winMax=0,winHit=0;const wins=[];
const zWinN=zones.map(()=>0),zWinHit=zones.map(()=>0),zWinSum=zones.map(()=>0);
// какой слот накрывает этот байт (по ЗАПИСИ ВЫВОДА: hi0/lo0/ncols + вторая плоскость)
function slotOf(k){
  const pgc=0xE0+((k>>8)&31);                  // страница fb плоскости не нужна: сверяем столбец
  const col=(k>>8)&31, lo=k&255;
  for(let idx=0;idx<21;idx++){
    const pg=0xE000+idx*256;
    if(rd(pg+0x96)!==1)continue;
    const nc=rd(pg+0x99);if(!nc)continue;
    const c0=rd(pg+0x97)&31,l0=rd(pg+0x98);
    if(col<c0||col>=c0+nc)continue;
    const d=(lo-l0)&255;if(d<16)return idx;
  }
  return -1;
}
function closeFrame(){
  if(!live){nDirty=0;pmask.fill(0);old.set(cur);return;}
  frames++;
  for(let i=0;i<nDirty;i++){
    const k=dirty[i];
    const Y=255-(k&255);
    const m=pmask[k];pmask[k]=0;
    if(Y<0||Y>=192)continue;
    if(m&(m-1)){                               // тронуто >= 2 плоскостей: окно между ними
      const w=lastT[k]-firstT[k];
      winN++;winSum+=w;if(w>winMax)winMax=w;wins.push(w);
      const tb=beamT(k),z2=zoneOf(Y);
      const hit=(firstT[k]<tb&&tb<lastT[k]);if(hit)winHit++;
      if(z2>=0){zWinN[z2]++;zWinSum[z2]+=w;if(hit)zWinHit[z2]++;}
    }
    const o0=old[k],o1=old[k+PLN],o2=old[k+2*PLN];
    const n0=cur[k],n1=cur[k+PLN],n2=cur[k+2*PLN];
    const s0=shown[k],s1=shown[k+PLN],s2=shown[k+2*PLN];
    for(let b=0;b<8;b++){
      const bit=1<<b;
      const co=((o0&bit)?1:0)|((o1&bit)?2:0)|((o2&bit)?4:0);
      const cn=((n0&bit)?1:0)|((n1&bit)?2:0)|((n2&bit)?4:0);
      const cs=((s0&bit)?1:0)|((s1&bit)?2:0)|((s2&bit)?4:0);
      if(cn!==co)newPix++;
      if(cs===co&&cs!==cn){lagPix++;continue;}  // просто опоздал: показан старый цвет
      if(cs!==co&&cs!==cn){                     // цвет, которого не было НИ ДО, НИ ПОСЛЕ
        badPix++;
        const z=zoneOf(Y);if(z>=0)zBad[z]++;
        const sl=slotOf(k);slotBad[sl]=(slotBad[sl]||0)+1;
      }
    }
  }
  nDirty=0;
  old.set(cur);shown.set(cur);
}
v06c.check_breakpoint=function(){
  if(cpu.pc===ISR&&rd(L.vec_isr_depth)===0){
    closeFrame();
    irq=TT;live=(rd(L.GameStatus)===5);
  }
  return false;};
for(let i=0;i<PLN*NPL;i++){const a=FB0+i;cur[i]=rd(a);}
old.set(cur);shown.set(cur);
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
  const t=rd(TIMER);if(t!==prevT){prevT=t;tick++;}
}
const pct=(a,b)=>b?(100*a/b).toFixed(2)+"%":"—";
wins.sort((a,b)=>a-b);
const q=p=>wins.length?Math.round(wins[Math.min(wins.length-1,Math.floor(wins.length*p))]):0;
console.log(`ROM=${ROM.split("/").pop()} тиков ${NT}, кадров геймплея ${frames}`);
console.log(`МЕЖПЛОСКОСТНОЙ ТРАНЗИЕНТ (луч показал цвет, которого нет ни до, ни после):`);
console.log(`   ${badPix} пикс  (на кадр ${(badPix/Math.max(1,frames)).toFixed(2)}), при ${newPix} изменившихся пикс = ${pct(badPix,newPix)}`);
for(let i=0;i<zones.length;i++)console.log(`   Ytop ${String(zones[i][0]).padStart(3)}..${String(zones[i][1]-1).padStart(3)}: ${zBad[i]} пикс`);
const ks=Object.keys(slotBad).map(Number).sort((a,b)=>slotBad[b]-slotBad[a]);
console.log(`   по слотам: ${ks.map(i=>`${i<0?"вне слотов":"слот "+i}:${slotBad[i]}`).join("  ")||"—"}`);
console.log(`ПОКАЗАН СТАРЫЙ ЦВЕТ (лаг на кадр, не смесь): ${lagPix} пикс`);
console.log(`ОКНО МЕЖДУ ПЛОСКОСТЯМИ (пиксель тронут в 2+ плоскостях за кадр): ${winN} пикс-кадров`);
console.log(`   такты: avg ${winN?Math.round(winSum/winN):0} p50 ${q(0.5)} p90 ${q(0.9)} max ${Math.round(winMax)}`);
console.log(`   луч прошёл ВНУТРИ окна: ${winHit} = ${pct(winHit,winN)}`);
for(let i=0;i<zones.length;i++)
  console.log(`   Ytop ${String(zones[i][0]).padStart(3)}..${String(zones[i][1]-1).padStart(3)}: ${zWinN[i]} пикс-кадров, окно avg ${zWinN[i]?Math.round(zWinSum[i]/zWinN[i]):0}, луч внутри ${zWinHit[i]} = ${pct(zWinHit[i],zWinN[i])}`);
