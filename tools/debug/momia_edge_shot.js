// momia_edge_shot.js — снимок «мумия у правого края экрана».
//
// Ставит мумии принудительный X (по умолчанию 253 — первое значение, при котором
// компенсация прижатого арта X+3 переполняет байт) и печатает, В КАКИХ СТОЛБЦАХ fb
// оказался её силуэт, плюс кладёт PNG идеального кадра.
// «До» правки силуэт уезжает в столбцы 0-1 (левый край), «после» его нет вовсе —
// ровно как на MSX, где TMS9918 показывает при X=253 первые 3 столбца КЛЕТКИ, а они
// у мумии пусты (momia_push_left прижал силуэт влево на 3).
//
// Запуск: node tools/debug/momia_edge_shot.js <rom> <sym> <png> [X] [тиков]
"use strict";
const {make,toGame}=require("../verify/beam_harness.js");
const ROM=process.argv[2], SYM=process.argv[3], PNG=process.argv[4];
const FX=+(process.argv[5]||253), NT=+(process.argv[6]||120);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu,memory,pngFrom,idealBmp}=E;
const step=()=>v06c.oneInterrupt(true);
let forced=0, lo=-1;
v06c.check_breakpoint=function(){
  if(cpu.pc!==L.vec_nat_sprites)return false;
  for(let idx=6;idx<14;idx++){
    const p=L.sprAttrib+idx*4, pat=rd(p+2);
    if(rd(p)<0xD0&&((pat>=0x28&&pat<0x34)||(pat>=0x88&&pat<0x94))){
      memory.write(p+1,FX&0xff);forced++;lo=239-rd(p);}
  }
  return false;
};
let seed=20260804; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NT;f++){
  if(f%9===0){const ks=[37,39,39,38,40];const k=ks[(rnd()*5)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  step();
}
if(held>0)E.key(held,0);
for(let f=0;f<3;f++)step();
console.log(`ROM=${ROM.split("/").pop()}  подстановок X=${FX}: ${forced}, низ габарита lo0=${lo}`);
if(lo<0){console.log("мумий не нашлось");process.exit(1);}
// силуэт мумии — плоскость p2 (idx2), 16 строк от lo0 вверх
const cols=[];
for(let c=0;c<32;c++){
  let bits=0;
  for(let r=0;r<16;r++)bits|=rd(0xC000+c*256+((lo+r)&0xff));
  if(bits)cols.push(c);
}
console.log("столбцы p2 с чернилами в строках мумии: "+cols.join(","));
for(const c of [0,1,2,29,30,31]){
  let s="";
  for(let r=15;r>=0;r--){const b=rd(0xC000+c*256+((lo+r)&0xff));
    s+=("00000000"+b.toString(2)).slice(-8).replace(/0/g,".").replace(/1/g,"#")+"|";}
  console.log(`  столбец ${String(c).padStart(2)}: ${s}`);
}
pngFrom(idealBmp(),PNG);
console.log("кадр: "+PNG);
