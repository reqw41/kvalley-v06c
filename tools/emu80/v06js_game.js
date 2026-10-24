// Поведенческая сверка: vector06js гонит игру по тому же скрипту клавиш, что emu80hl
// (game-режим), и печатает per-frame CRC диапазона ОЗУ + GameStatus.
// env: HL_FRAMES, HL_KEYS (файл "frame KEY 1|0"), HL_MEMCRC=start,len, HL_PEEK=имена
"use strict";
const fs=require("fs");
const {make}=require(__dirname+"/../verify/beam_harness.js");
const ROM=process.argv[2],SYM=process.argv[3];
const E=make(ROM,SYM);
const {v06c,rd,L,key}=E;
const frames=+(process.env.HL_FRAMES||600);
const [mcS,mcL]=(process.env.HL_MEMCRC||"0x8000,0x8000").split(",").map(s=>parseInt(s,16)||parseInt(s));
const peeks=(process.env.HL_PEEK||"").split(",").filter(Boolean).map(t=>/^0x/i.test(t)?parseInt(t,16):L[t]);
// клавиши: имена emu80-скрипта -> keyCode браузера (см. beam_harness key())
const KC={SPACE:32,CR:13,LEFT:37,RIGHT:39,UP:38,DOWN:40,N:78,H:72,E:69,S:83,P:80};
const script=new Map();
if(process.env.HL_KEYS){
  for(const line of fs.readFileSync(process.env.HL_KEYS,"utf8").split("\n")){
    const m=line.trim().split(/\s+/);if(m.length!==3)continue;
    const f=+m[0],kc=KC[m[1]],dn=+m[2];
    if(kc===undefined)continue;
    if(!script.has(f))script.set(f,[]);
    script.get(f).push([kc,dn]);
  }
}
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
for(let f=0;f<frames;f++){
  for(const [kc,dn] of (script.get(f)||[]))key(kc,dn);
  v06c.oneInterrupt(true);
  let c=0xffffffff;
  for(let i=0;i<mcL;i++)c=crcT[(c^rd((mcS+i)&0xffff))&0xff]^(c>>>8);
  c=(c^0xffffffff)>>>0;
  let line=`F ${f} memcrc=${c.toString(16).toUpperCase().padStart(8,"0")}`;
  for(const a of peeks)line+=` [${a.toString(16).toUpperCase().padStart(4,"0")}]=${rd(a).toString(16).toUpperCase().padStart(2,"0")}`;
  console.log(line);
}
