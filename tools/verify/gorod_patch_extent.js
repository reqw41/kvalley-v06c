// Вертикальные границы КАРТИНКИ у Городецкого по отрисованному кадру (v06c.bmp):
// для каждой строки bmp — сколько пикселей отличается от цвета бордюра. Даёт понять,
// где реально начинается и кончается активная область 256 строк и картинка внутри неё.
"use strict";
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[2] || "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const SKIP = +(process.argv[3]||1200);
const E = make(ROM);
E.run(SKIP);
const {W,H} = E;
const bmp = E.v06c.bmp;
const border = bmp[0]>>>0;
const rowsInfo = [];
for (let y=0;y<H;y++){
  let n=0; for(let x=0;x<W;x++) if((bmp[y*W+x]>>>0)!==border) n++;
  rowsInfo.push(n);
}
const first = rowsInfo.findIndex(n=>n>0);
let last = H-1; while(last>=0 && rowsInfo[last]===0) last--;
console.log(`SKIP=${SKIP} scroll=0x${E.io.ScrollStart().toString(16)} бордюр=0x${border.toString(16)}`);
console.log(`строки bmp с содержимым: ${first}..${last}`);
console.log("профиль (строка bmp: непусто-пикселей), только ненулевые серии:");
let run=null;
for(let y=0;y<H;y++){
  const on = rowsInfo[y]>0;
  if(on && !run) run={a:y};
  if(!on && run){ console.log(`  ${run.a}..${y-1}`); run=null; }
}
if(run) console.log(`  ${run.a}..${H-1}`);
