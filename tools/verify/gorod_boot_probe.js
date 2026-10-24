// Проба: заводится ли ROM Городецкого на стенде «Вектор+Z80».
// Печатает по кадрам: PC, число записей в фреймбуфер (0x8000..0xFFFF), непустые байты экрана.
// ПРОВАЛ ПОКРЫТИЯ, если за все кадры в fb не записано ничего.
"use strict";
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[2] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const NF = +(process.argv[3]||300);
const E = make(ROM);
let fbw=0, anyw=0;
E.trace.onWrite = (a)=>{ anyw++; if(a>=0x8000) fbw++; };
let total=0;
for (let f=0; f<NF; f++){
  fbw=0;
  E.v06c.oneInterrupt(true);
  total += fbw;
  if (f<8 || f%25===0 || f===NF-1){
    let nz=0; for(let a=0x8000;a<=0xffff;a++) if(E.rd(a)) nz++;
    console.log(`кадр ${f}: PC=${E.cpu.pc.toString(16).padStart(4,"0")} iff=${E.cpu.iff?1:0} fb-записей=${fbw} непустых-байт-экрана=${nz}`);
  }
}
console.log(`ИТОГО за ${NF} кадров: записей в fb = ${total}, всех записей = ${anyw}`);
if (total===0){ console.log("ПРОВАЛ ПОКРЫТИЯ: ни одной записи в фреймбуфер за прогон"); process.exit(1); }
E.png("/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod_boot.png");
console.log("кадр сохранён: gorod_boot.png");
