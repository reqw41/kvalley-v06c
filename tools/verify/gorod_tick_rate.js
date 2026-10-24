// Темп и загрузка кадра у порта Городецкого (King's Valley, И.Городецкий 2008, Z80).
// (1) скорость героя: удерживаем «вправо» и считаем кадры на 1 пиксель X в НЕПРЕРЫВНОЙ ходьбе;
// (2) логика каждый кадр или через раз: сколько прерываний принято и сколько раз запущены
//     стирание (PC 0x0212) и отрисовка (PC 0x02a8) спрайтов на кадр;
// (3) сколько тактов от IRQ занимает весь кадровый обработчик: у него ВСЯ игра сидит в ISR,
//     а фон = «ei; jr $» по адресу 0x409a, поэтому холостой цикл считается точно.
// Запуск: node tools/verify/gorod_tick_rate.js [кадров удержания=800]
"use strict";
const {make} = require("./gorod_z80_harness.js");
const ROM = "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const HOLD = +(process.argv[2]||800);
const E = make(ROM);
E.run(1000);
const press=()=>{E.key(32,1);E.run(10);E.key(32,0);E.run(60);};
press(); press(); E.run(400);                 // заставка -> «PUSH SPACE» -> игра, дать герою встать
const HX=0x3b11;                              // X героя в теневой таблице спрайтов (найден перебором ОЗУ
                                              // по монотонному росту при удержании «вправо»; дубль в 0x13a7)
const IDLE=0x409a;                            // «jr $» — холостой цикл главной программы
const ISR =0x0038;                            // вход в прерывание

let idleCnt=0, idleCyc=0, isrEnter=0, isrEntries=0, firstIdleCyc=-1, erase=[], draw=0;
const oldInstr=E.cpu.instruction.bind(E.cpu);
E.cpu.instruction=function(){
  const p=E.cpu.pc;
  if(p===IDLE){ idleCnt++; const v=oldInstr(); idleCyc+=v; if(firstIdleCyc<0) firstIdleCyc=E.cyc(); return v; }
  if(p===ISR) isrEntries++;
  if(p===0x0212) erase.push(E.cyc());
  if(p===0x02a8) draw++;
  return oldInstr();
};

E.key(39,1);
const xs=[], stat=[];
for(let f=0;f<HOLD;f++){
  idleCnt=0; idleCyc=0; firstIdleCyc=-1; erase=[]; draw=0; isrEntries=0;
  E.v06c.oneInterrupt(true);
  xs.push(E.rd(HX));
  stat.push({idleCnt,idleCyc,firstIdleCyc,er:erase.length,er0:erase[0],draw,isr:isrEntries});
}
E.key(39,0);

// ---------- (1) скорость ----------
const ch=[]; let last=xs[0], run=0;
for(let i=1;i<xs.length;i++){ run++; if(xs[i]!==last){ ch.push({i,gap:run,d:((xs[i]-last+128)&255)-128}); last=xs[i]; run=0; } }
if(ch.length<10){ console.log(`ПРОВАЛ ПОКРЫТИЯ: X сменился ${ch.length} раз за ${HOLD} кадров — герой не пошёл`); process.exit(1); }
// непрерывная ходьба = цепочка смен с разрывом <= 8 кадров; берём самую длинную
let best=null, curS=0;
for(let i=1;i<ch.length;i++){
  if(ch[i].gap<=8){ if(curS===0) curS=i-1; }
  else { if(curS!==0 && (!best || (i-1-curS)>(best[1]-best[0]))) best=[curS,i-1]; curS=0; }
}
if(curS!==0 && (!best || (ch.length-1-curS)>(best[1]-best[0]))) best=[curS,ch.length-1];
if(!best){ console.log("ПРОВАЛ ПОКРЫТИЯ: не нашлось отрезка непрерывной ходьбы"); process.exit(1); }
const seg=ch.slice(best[0],best[1]+1);
const frames=seg[seg.length-1].i-seg[0].i, px=seg.slice(1).reduce((s,c)=>s+Math.abs(c.d),0);
const gaps=seg.slice(1).map(c=>c.gap);
const mean=gaps.reduce((a,b)=>a+b,0)/gaps.length;
const sd=Math.sqrt(gaps.reduce((a,b)=>a+(b-mean)*(b-mean),0)/gaps.length);
const gh={}; for(const g of gaps) gh[g]=(gh[g]||0)+1;
console.log(`(1) СКОРОСТЬ: непрерывная ходьба ${frames} кадров, ${px} px => ${(px/frames).toFixed(3)} px/кадр,`);
console.log(`    ${(frames/px).toFixed(2)} кадра на 1 px; интервалы между сменами X: ${Object.entries(gh).map(([k,v])=>`${k}к x${v}`).join(", ")}`);
console.log(`    среднее ${mean.toFixed(2)} кадра/смену, разброс ${(100*sd/mean).toFixed(0)}%`);
console.log(`    (за все ${HOLD} кадров удержания: смен ${ch.length}, суммарно ${ch.reduce((s,c)=>s+Math.abs(c.d),0)} px)`);

// ---------- (2) логика каждый кадр? ----------
const hIsr={},hEr={},hDr={};
for(const s of stat){ hIsr[s.isr]=(hIsr[s.isr]||0)+1; hEr[s.er]=(hEr[s.er]||0)+1; hDr[s.draw]=(hDr[s.draw]||0)+1; }
console.log(`(2) прерываний на кадр: ${Object.entries(hIsr).map(([k,v])=>`${k} -> ${v} кадров`).join(", ")}`);
console.log(`    стираний спрайтов на кадр: ${Object.entries(hEr).map(([k,v])=>`${k} -> ${v}`).join(", ")}; ` +
            `отрисовок: ${Object.entries(hDr).map(([k,v])=>`${k} -> ${v}`).join(", ")}`);
const er0=stat.filter(s=>s.er0!==undefined).map(s=>s.er0).sort((a,b)=>a-b);
console.log(`    старт стирания спрайтов, такт от IRQ: мин ${er0[0]}, медиана ${er0[er0.length>>1]}, макс ${er0[er0.length-1]}`);

// ---------- (3) длительность обработчика ----------
const busy=stat.map(s=>59904-s.idleCyc).sort((a,b)=>a-b);
const fi=stat.map(s=>s.firstIdleCyc).filter(x=>x>=0).sort((a,b)=>a-b);
console.log(`(3) холостой цикл 0x409a: медиана ${stat.map(s=>s.idleCnt).sort((a,b)=>a-b)[HOLD>>1]} проходов/кадр`);
console.log(`    ОБРАБОТЧИК занимает (59904 - холостое): медиана ${busy[busy.length>>1]}, макс ${busy[busy.length-1]} тактов ` +
            `(${(100*busy[busy.length>>1]/59904).toFixed(0)}% кадра)`);
console.log(`    первый заход в холостой цикл: медиана ${fi[fi.length>>1]}, макс ${fi[fi.length-1]} тактов от IRQ`);
console.log(`    ВНИМАНИЕ: модель тактов Z80 на Векторе приблизительная (см. шапку gorod_z80_harness.js).`);
