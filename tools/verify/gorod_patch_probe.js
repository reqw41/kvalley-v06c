// Разведка под патч «клавиша L = центрирование» в ЧУЖОМ ROM (Городецкий, Z80).
// Что печатает:
//   1) все записи в порт 0x03 (HW vscroll + выбор ряда клавиатуры): PC источника, значение,
//      сколько раз; отдельно — какие значения ДЕРЖАТСЯ (последняя запись за кадр);
//   2) записи в порт 0x00 (режим 8255) и 0x02 (бордюр) — чтобы понять раскладку;
//   3) чтения порта 0x02 (клавиатура) — есть ли уже сканирование рядов;
//   4) вектор RST 38 (0x0038) и что там лежит.
"use strict";
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[2] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const SKIP = +(process.argv[3]||140), NF = +(process.argv[4]||60);
const E = make(ROM);

const outHits = new Map();      // "pc:port:val" -> count
const inHits  = new Map();      // "pc:port" -> count
const origOut = E.io.output.bind(E.io);
const origIn  = E.io.input.bind(E.io);
let watch = false;
E.io.output = function(p,v){
  if (watch){ const pc = E.cpu.pc;
    const k = `${(pc-2+0x10000&0xffff).toString(16).padStart(4,"0")}|${p.toString(16).padStart(2,"0")}|${v.toString(16).padStart(2,"0")}`;
    outHits.set(k,(outHits.get(k)||0)+1); }
  return origOut(p,v);
};
E.io.input = function(p){
  if (watch){ const pc = E.cpu.pc;
    const k = `${(pc-2+0x10000&0xffff).toString(16).padStart(4,"0")}|${p.toString(16).padStart(2,"0")}`;
    inHits.set(k,(inHits.get(k)||0)+1); }
  return origIn(p);
};

E.run(SKIP);
watch = true;
for(let f=0;f<NF;f++) E.v06c.oneInterrupt(true);
watch = false;

console.log(`=== записи в порты за ${NF} кадров (после ${SKIP} кадров прогрева) ===`);
const rows=[...outHits.entries()].map(([k,c])=>{const [pc,p,v]=k.split("|");return {pc,p,v,c};})
  .sort((a,b)=>a.p.localeCompare(b.p)||b.c-a.c);
for(const r of rows) console.log(`  out(0x${r.p}), val=0x${r.v}  из PC~0x${r.pc}  ×${r.c}  (${(r.c/NF).toFixed(2)}/кадр)`);
console.log(`=== чтения портов ===`);
for(const [k,c] of [...inHits.entries()].sort((a,b)=>b[1]-a[1])){
  const [pc,p]=k.split("|"); console.log(`  in(0x${p})  из PC~0x${pc}  ×${c} (${(c/NF).toFixed(2)}/кадр)`);
}
console.log(`=== текущий ScrollStart = 0x${E.io.ScrollStart().toString(16)} ===`);
const dis=a=>[...Array(16)].map((_,i)=>E.rd(a+i).toString(16).padStart(2,"0")).join(" ");
console.log(`байты @0x0038: ${dis(0x38)}`);
console.log(`байты @0x0000: ${dis(0x00)}`);
