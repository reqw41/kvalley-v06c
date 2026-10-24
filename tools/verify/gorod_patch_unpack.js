// Разбор распаковщика чужого ROM: где он лежит, куда пишет, где отдаёт управление игре.
// Печатает: диапазон PC распаковщика, последние N инструкций перед уходом из него,
// карту записей (какие страницы ОЗУ он трогает), и сравнение «файл vs ОЗУ» для головы файла.
"use strict";
const fs = require("fs");
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[2] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const MAXI = +(process.argv[3]||20000000);
const img = new Uint8Array(fs.readFileSync(ROM));
const FILE_END = 0x100 + img.length;
const E = make(ROM);

// карта записей за всё время распаковки
const written = new Uint8Array(0x10000);
E.trace.onWrite = (a)=>{ written[a]=1; };

// исполняем по одной инструкции, следя за PC
const ring = new Array(64).fill(0); let rp=0;
let i=0, leftAt=-1, leftTo=-1;
const pcHist = new Uint8Array(0x10000);
for(; i<MAXI; i++){
  const pc = E.cpu.pc;
  if (pc < 0x10000) pcHist[pc]=1;
  ring[rp++ & 63] = pc;
  E.cpu.instruction();
  const npc = E.cpu.pc;
  // уход из области файла-распаковщика (0x100..0x400) в игру
  if (pc>=0x100 && pc<0x400 && (npc<0x100 || npc>=0x400)){ leftAt=pc; leftTo=npc; break; }
}
console.log(`инструкций до выхода: ${i}`);
if(leftAt<0){ console.log("ПРОВАЛ ПОКРЫТИЯ: не поймали передачу управления"); process.exit(1); }
console.log(`ушёл из 0x${leftAt.toString(16)} на 0x${leftTo.toString(16)}`);
console.log("последние 32 PC перед уходом:");
const tail=[]; for(let k=Math.max(0,rp-32);k<rp;k++) tail.push(ring[k&63].toString(16));
console.log("  "+tail.join(" "));
const hx=a=>[...Array(16)].map((_,j)=>E.rd(a+j).toString(16).padStart(2,"0")).join(" ");
for(let a=(leftAt&~15)-32; a<=leftAt+16; a+=16) console.log(`ОЗУ ${a.toString(16).padStart(4,"0")}: ${hx(a)}`);
console.log(`--- файл: ${img.length} байт, грузится 0x100..0x${(FILE_END-1).toString(16)} ---`);
const fh=o=>[...Array(16)].map((_,j)=>(img[o+j]!==undefined?img[o+j]:0).toString(16).padStart(2,"0")).join(" ");
for(let o=0;o<0x60;o+=16) console.log(`ФАЙЛ +${o.toString(16).padStart(4,"0")} (адр ${(0x100+o).toString(16)}): ${fh(o)}`);
console.log(`ФАЙЛ хвост +${(img.length-16).toString(16)}: ${fh(img.length-16)}`);
// карта записей по страницам
let s=""; for(let p=0;p<256;p++){ s += written.subarray(p*256,p*256+256).includes(1)?"#":"."; if(p%64===63){console.log(`стр ${((p-63)*256).toString(16).padStart(4,"0")}: ${s}`); s="";} }
// исполнявшиеся страницы
s=""; for(let p=0;p<256;p++){ s += pcHist.subarray(p*256,p*256+256).includes(1)?"X":"."; if(p%64===63){console.log(`exec ${((p-63)*256).toString(16).padStart(4,"0")}: ${s}`); s="";} }
