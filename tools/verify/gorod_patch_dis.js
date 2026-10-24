// Дамп куска ОЗУ у Городецкого + сверка с байтами файла ROM (загружается по 0x100):
// нужно понять, какие адреса ISR лежат в ФАЙЛЕ статически (их можно патчить), а какие
// появляются только после распаковщика.
"use strict";
const fs = require("fs");
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[2] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const A0 = parseInt(process.argv[3]||"0x1df",16), LEN = +(process.argv[4]||80);
const SKIP = +(process.argv[5]||200);
const img = new Uint8Array(fs.readFileSync(ROM));
const E = make(ROM); E.run(SKIP);
let same=0, diff=0;
for(let i=0;i<LEN;i+=16){
  const a=A0+i;
  const ram=[], rom=[];
  for(let j=0;j<16&&i+j<LEN;j++){
    const aa=a+j, r=E.rd(aa);
    ram.push(r.toString(16).padStart(2,"0"));
    const off=aa-0x100;
    const f=(off>=0&&off<img.length)?img[off]:null;
    rom.push(f===null?"--":f.toString(16).padStart(2,"0"));
    if(f!==null){ if(f===r) same++; else diff++; }
  }
  console.log(`${a.toString(16).padStart(4,"0")}  ОЗУ ${ram.join(" ")}`);
  console.log(`      ФАЙЛ ${rom.join(" ")}`);
}
console.log(`совпало ${same}, разошлось ${diff} (файл грузится по 0x100, offset = addr-0x100)`);
