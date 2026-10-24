// Цена пачки вывода спрайтов у Городецкого: такты и байты на спрайт и на кадр.
// Фазы найдены по дизассемблеру распакованного ОЗУ:
//   0x0212 — вход в СТИРАНИЕ (стек-блит нулями: ld sp,экран; push de x8 на столбец, 3 столбца);
//   0x02a8 — вход в ОТРИСОВКУ (для каждого спрайта: pop hl из подготовленной картинки,
//            ld a,(de):or h:ld (de),a / inc d / ... / dec e — ПОСТРОЧНО, 2 байта в строке, 16 строк).
"use strict";
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[4] || "/tmp/gorod_kv.rom";
const NF=+(process.argv[2]||200);
const E=make(ROM);
E.run(1000);
const press=()=>{E.key(32,1);E.run(10);E.key(32,0);E.run(60);};
press(); press(); E.run(400);
E.key(39,1);

let cyc=0, tEr=-1, tDr=-1, tEnd=-1, nEr=0, nDr=0, nSprEr=0, nSprDr=0;
const old=E.cpu.instruction.bind(E.cpu);
E.cpu.instruction=function(){
  const p=E.cpu.pc;
  if(p===0x0212){ tEr=E.cyc(); }
  if(p===0x02a8){ tDr=E.cyc(); }
  if(p===0x0245) nSprEr++;                 // на спрайт: вход в стек-блит стирания
  if(p===0x0350) nSprDr++;                 // на спрайт: вход в OR-блит отрисовки
  return old();
};
E.trace.onWrite=(a,v)=>{ if(a<0x8000||a>=0xE000) return; tEnd=E.cyc();
  const pc=E.cpu.pc; if(pc>=0x0250&&pc<0x027a) nEr++; else nDr++; };

const rows=[];
for(let f=0;f<NF;f++){
  tEr=tDr=tEnd=-1; nEr=nDr=nSprEr=nSprDr=0;
  E.v06c.oneInterrupt(true);
  if(tEr>=0) rows.push({tEr,tDr,tEnd,nEr,nDr,nSprEr,nSprDr});
}
E.key(39,0);
if(!rows.length){ console.log("ПРОВАЛ ПОКРЫТИЯ: пачка вывода ни разу не запускалась"); process.exit(1); }
if(rows.every(r=>r.nEr===0)||rows.every(r=>r.nDr===0)){
  console.log("ПРОВАЛ ПОКРЫТИЯ: не разделились фазы стирания и отрисовки"); process.exit(1); }
const med=a=>{const s=a.slice().sort((x,y)=>x-y);return s[s.length>>1];};
const mx =a=>Math.max(...a);
console.log(`кадров с пачкой ${rows.length} из ${NF}`);
console.log(`старт СТИРАНИЯ: медиана ${med(rows.map(r=>r.tEr))} тактов от IRQ`);
console.log(`старт ОТРИСОВКИ: медиана ${med(rows.map(r=>r.tDr))}`);
console.log(`конец пачки (последняя запись): медиана ${med(rows.map(r=>r.tEnd))}, макс ${mx(rows.map(r=>r.tEnd))}`);
console.log(`вся пачка занимает: медиана ${med(rows.map(r=>r.tEnd-r.tEr))}, макс ${mx(rows.map(r=>r.tEnd-r.tEr))} тактов`);
console.log(`байт стирания на кадр: медиана ${med(rows.map(r=>r.nEr))}; байт отрисовки: медиана ${med(rows.map(r=>r.nDr))}`);
console.log(`спрайтов: стёрто ${med(rows.map(r=>r.nSprEr))}, нарисовано ${med(rows.map(r=>r.nSprDr))} (медианы за кадр)`);
const perEr=rows.map(r=>r.nSprEr?r.nEr/r.nSprEr:0), perDr=rows.map(r=>r.nSprDr?r.nDr/r.nSprDr:0);
console.log(`байт на спрайт: стирание ${med(perEr).toFixed(1)}, отрисовка ${med(perDr).toFixed(1)}`);
const cost=rows.map(r=>r.nSprDr?(r.tEnd-r.tEr)/(r.nSprEr+r.nSprDr):0).filter(x=>x);
console.log(`грубо тактов на один проход спрайта (стирание или отрисовка): ${med(cost).toFixed(0)}`);
