// ЮНИТ-ТЕСТ КОПИИ БУФЕРА В MASK (vtm_afterdraw): доказать, что POP-копия пишет РОВНО ТЕ
// ЖЕ байты, что прежняя петля `ld a,(de)`, и не трогает ничего сверх.
// Процедура зовётся НАПРЯМУЮ шагами ЦП на подготовленной памяти — фаза партии ни при чём.
// Печатает СЛЕПОК изменённых ячеек: слепки двух сборок сравниваются `diff`, поэтому
// эквивалентность доказывается побайтно, а не «оба зелёные».
"use strict";
const {make}=require("./beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
const {L,v06c,cpu,memory}=E;
const SENT=0x0080;
const wr=(a,v)=>{memory.bytes[memory.tobank(a&0xFFFF)]=v&0xFF;};
const rd=a=>memory.bytes[memory.tobank(a&0xFFFF)];
let cases=0;
for(const idx of [6,9,20]){
  for(let a=0x8000;a<=0xFFFF;a++)wr(a,0xFF);
  const slot=0xE0+idx;
  wr(L.vec_nsp_idx,idx); wr(L.GameStatus,5);
  wr(slot*256+0x99,3);                       // ncols != 0, иначе ранний ret
  for(let i=0;i<0x30;i++)wr(slot*256+0xA0+i,(idx*7+i*13)&0xFF);   // буфер спрайта
  wr(slot*256+0x97,0x8A); wr(slot*256+0x9F,0xAB); wr(slot*256+0x9B,0xCC);
  const SP=0x7F00; wr(SP,SENT&0xFF); wr(SP+1,SENT>>8);
  cpu.sp=SP; cpu.pc=L.vtm_afterdraw; cpu.iff=false;
  let n=0; while(cpu.pc!==SENT){cpu.instruction();if(++n>200000)throw new Error("не вернулось");}
  const changed=[];
  for(let a=0x8000;a<=0xFFFF;a++)if(rd(a)!==0xFF)changed.push(`${a.toString(16)}=${rd(a).toString(16)}`);
  console.log(`idx=${idx} SP${cpu.sp===SP+2?"OK":"СЛОМАН"} изменено ${changed.length}: ${changed.join(" ")}`);
  cases++;
}
if(!cases){console.log("ГЕЙТ ПРОВАЛЕН: не проверено ни одного случая.");process.exit(2);}
