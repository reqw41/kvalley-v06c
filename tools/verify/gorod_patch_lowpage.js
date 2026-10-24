// Детализация нижней страницы 0x0000..0x00FF у чужого порта + точный конец вывода
// распаковщика + все источники записи в порт 0x03 за длинный прогон.
"use strict";
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[2] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const FRAMES = +(process.argv[3]||2000);
const E = make(ROM);
const lowW = new Map(), lowX = new Uint8Array(256);
let depackMax = 0, depackMin = 0xffff, phase = 1;
E.trace.onWrite = (a,v)=>{
  if (phase===1 && a>=0x100 && a<0x6000){ if(a>depackMax) depackMax=a; if(a<depackMin) depackMin=a; }
  if (a<0x100){ const pc=E.cpu.pc; const k=a; const s=lowW.get(k)||new Set(); s.add(pc); lowW.set(k,s); }
};
// фаза 1: до входа в игру (PC==0x100 после распаковки)
let n=0;
for(; n<3000000; n++){ const pc=E.cpu.pc; if(pc<0x100) lowX[pc]=1; E.cpu.instruction(); if(n>20000 && E.cpu.pc===0x0100) break; }
console.log(`распаковка: вывод в 0x${depackMin.toString(16)}..0x${depackMax.toString(16)} (ниже 0x6000), инструкций ${n}`);
phase = 2;
// фаза 2: игра, с трассировкой PC в нижней странице + учёт out(3)
const out3 = new Map();
const origOut = E.io.output.bind(E.io);
E.io.output = function(p,v){ if(p===3){ const pc=(E.cpu.pc-2)&0xffff; const k=`${pc.toString(16)}|${v.toString(16)}`; out3.set(k,(out3.get(k)||0)+1);} return origOut(p,v); };
for(let f=0; f<FRAMES; f++){
  let t=0;
  while(t<E.FRAME){ const pc=E.cpu.pc; if(pc<0x100) lowX[pc]=1; t+=E.cpu.instruction(); }
  E.v06c.irq=true; E.v06c.checkInterrupt();
}
console.log(`--- нижняя страница: записи (адрес <- PC-источники) ---`);
for(const a of [...lowW.keys()].sort((x,y)=>x-y))
  console.log(`  0x${a.toString(16).padStart(2,"0")}  <- PC ${[...lowW.get(a)].map(p=>"0x"+p.toString(16)).join(",")}`);
console.log(`--- нижняя страница: исполнявшиеся адреса ---`);
let s=-1,segs=[];
for(let a=0;a<=256;a++){ const on=a<256&&lowX[a]; if(on&&s<0)s=a; if(!on&&s>=0){segs.push(`0x${s.toString(16)}..0x${(a-1).toString(16)}`);s=-1;} }
console.log("  "+(segs.join(", ")||"нет"));
console.log(`--- все записи в порт 0x03 за ${FRAMES} кадров игры ---`);
for(const [k,c] of [...out3.entries()].sort((a,b)=>b[1]-a[1])){ const [pc,v]=k.split("|"); console.log(`  PC~0x${pc}: val=0x${v} ×${c}`); }
