// Дамп распакованного ОЗУ порта Городецкого + профиль PC (где крутится код).
// Аргументы: [skip кадров] [кадров профиля] [файл дампа]
"use strict";
const fs=require("fs");
const {make} = require("./gorod_z80_harness.js");
const ROM = "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const SKIP=+(process.argv[2]||1000), NF=+(process.argv[3]||10);
const OUT=process.argv[4]||"/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod_ram.bin";
const E=make(ROM);
E.run(SKIP);
const buf=Buffer.alloc(0x10000);
for(let a=0;a<0x10000;a++) buf[a]=E.rd(a);
fs.writeFileSync(OUT,buf);
console.log(`дамп ОЗУ (64К) после ${SKIP} кадров -> ${OUT}`);
// профиль PC по страницам 256 байт
const prof=new Map();
const oldInstr=E.cpu.instruction.bind(E.cpu);
E.cpu.instruction=function(){ const p=E.cpu.pc&0xff00; prof.set(p,(prof.get(p)||0)+1); return oldInstr(); };
E.run(NF);
const top=[...prof].sort((a,b)=>b[1]-a[1]).slice(0,16);
const tot=[...prof.values()].reduce((a,b)=>a+b,0);
console.log(`команд за ${NF} кадров: ${tot}`);
console.log("страницы PC (топ-16):", top.map(([p,n])=>`${p.toString(16).padStart(4,"0")}:${(100*n/tot).toFixed(1)}%`).join(" "));
