// Карта занятости ОЗУ у чужого порта: что пишет распаковщик, что пишет/исполняет игра,
// куда лезет стек. Цель — найти дыру под резидентный хук.
// Печатает крупные СВОБОДНЫЕ интервалы в 0x0000..0x7FFF (экран 0x8000+ не рассматриваем).
"use strict";
const fs = require("fs");
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[2] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const FRAMES = +(process.argv[3]||1500);
const E = make(ROM);
const wr = new Uint8Array(0x10000), ex = new Uint8Array(0x10000), rdm = new Uint8Array(0x10000);
E.trace.onWrite = (a)=>{ wr[a]=1; };
// чтения тоже важны (константы/таблицы в дыре быть не должно)
const memory = E.memory, origRead = memory.read.bind(memory);
let minSP = 0xffff;

// фаза 1: распаковка — до входа в игру
let n=0;
for(; n<3000000; n++){
  const pc=E.cpu.pc; ex[pc]=1;
  E.cpu.instruction();
  if (pc>=0x6000 && pc<0x60a0 && E.cpu.pc>=0x100 && E.cpu.pc<0x300 && E.cpu.pc!==0x100+0) {}
  if (n>20000 && E.cpu.pc===0x0100){ break; }
}
console.log(`распаковка: ${n} инструкций, вход в игру PC=0x${E.cpu.pc.toString(16)}`);
const unpackEnd = (()=>{ let last=0; for(let a=0x100;a<0x8000;a++) if(wr[a]) last=a; return last; })();
console.log(`последний записанный адрес ниже 0x8000 к моменту старта игры: 0x${unpackEnd.toString(16)}`);
const wrUnpack = wr.slice();

// фаза 2: игра
for(let f=0; f<FRAMES; f++){
  // считаем инструкции через oneInterrupt, но нужен PC-трейс -> ручной шаг по кадру
  const target = E.v06c.instr_time;
  E.v06c.oneInterrupt(true);
  const sp = E.cpu.sp; if (sp<minSP && sp>0x100) minSP=sp;
}
// повторный проход с пошаговым трейсом (дорого) — только 200 кадров
for(let f=0; f<200; f++){
  let t=0;
  while(t<E.FRAME){ const pc=E.cpu.pc; ex[pc]=1; const sp=E.cpu.sp; if(sp<minSP) minSP=sp; t+=E.cpu.instruction(); }
  E.v06c.irq=true; E.v06c.checkInterrupt();
}
console.log(`минимальный SP за прогон: 0x${minSP.toString(16)}`);
const used = new Uint8Array(0x8000);
for(let a=0;a<0x8000;a++) used[a] = (wr[a]||ex[a])?1:0;
let runs=[], s=-1;
for(let a=0;a<0x8000;a++){
  if(!used[a]){ if(s<0) s=a; }
  else { if(s>=0 && a-s>=16) runs.push([s,a-1]); s=-1; }
}
if(s>=0) runs.push([s,0x7fff]);
console.log("СВОБОДНЫЕ интервалы (не писались и не исполнялись) >=16 байт в 0x0000..0x7FFF:");
for(const [a,b] of runs) console.log(`  0x${a.toString(16).padStart(4,"0")}..0x${b.toString(16).padStart(4,"0")}  (${b-a+1} байт)`);
