// Раскладка кадра у Городецкого: какие ЭКРАННЫЕ строки заняты непустым содержимым
// (по всем 4 планам), при текущем scroll. Нужно, чтобы посчитать значение scroll
// для центрирования поля. Плюс png-снимок.
"use strict";
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[2] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const SKIP = +(process.argv[3]||300);
const OUT  = process.argv[4] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/layout.png";
const E = make(ROM);
E.run(SKIP);
const scroll = E.io.ScrollStart();
console.log(`кадров прогрева ${SKIP}, PC=0x${E.cpu.pc.toString(16)}, scroll=0x${scroll.toString(16)} (${scroll})`);
// планы Вектора: 0x8000..0x9FFF, 0xA000..0xBFFF, 0xC000..0xDFFF, 0xE000..0xFFFF
// внутри плана адрес = 0x8000 + col*256 + lo, col 0..31, lo = байтовая строка
const occ = new Uint8Array(256);
for (let pl=0; pl<4; pl++){
  const b = 0x8000 + pl*0x2000;
  for (let col=0; col<32; col++)
    for (let lo=0; lo<256; lo++)
      if (E.rd(b + col*256 + lo)) occ[lo] = 1;
}
const rowOfLo = lo => (scroll - lo) & 255;
const rows = [];
for (let lo=0; lo<256; lo++) if (occ[lo]) rows.push(rowOfLo(lo));
rows.sort((a,b)=>a-b);
if (!rows.length){ console.log("ПРОВАЛ ПОКРЫТИЯ: экран пуст"); process.exit(1); }
console.log(`непустых байтовых строк: ${rows.length}`);
console.log(`занятые ЭКРАННЫЕ строки: ${rows[0]}..${rows[rows.length-1]} (сверху пусто ${rows[0]}, снизу пусто ${255-rows[rows.length-1]})`);
// сплошные интервалы
let s=rows[0], p=rows[0], seg=[];
for (const r of rows.slice(1)){ if (r!==p+1){ seg.push([s,p]); s=r; } p=r; }
seg.push([s,p]);
console.log(`интервалы: ${seg.map(([a,b])=>`${a}..${b}`).join(", ")}`);
E.png(OUT);
console.log(`снимок: ${OUT}`);
