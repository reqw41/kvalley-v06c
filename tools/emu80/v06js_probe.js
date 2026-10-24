// Зеркало headless-Emu80-обвязки на vector06js (тот же beam_harness, что у всех
// лучевых инструментов). Режимы (env HL_MODE): probe | race | timing.
//   probe:  HL_HOOKS=0x38,...  HL_FRAMES — такты хуков (пост-IRQ, cyc())
//   race:   HL_POKE_LXI/HL_POKE_JMP/HL_SLED/HL_WSTA (метки), HL_D0/D1/DSTEP, HL_NOPS
//   timing: HL_HOOKS=T0,...,T7 — один проход, дельты между метками
"use strict";
const {make}=require(__dirname+"/../verify/beam_harness.js");
const ROM=process.argv[2],SYM=process.argv[3];
const mode=process.env.HL_MODE||"probe";
const E=make(ROM,SYM);
const {v06c,cpu,memory,L}=E;
const wr=(a,v)=>{memory.bytes[memory.tobank(a&0xffff)]=v;};
const sym=t=>{
  if(/^0x/i.test(t))return parseInt(t,16);
  if(L[t]===undefined){console.error("unknown symbol: "+t);process.exit(2);}
  return L[t];
};
let frame=0,hits=[];
const hookSet=new Set();
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(hookSet.has(pc))hits.push({pc,cyc:E.cyc(),frame});
  return false;
};
const step=()=>{v06c.oneInterrupt(true);frame++;};

if(mode==="probe"||mode==="timing"){
  const frames=+(process.env.HL_FRAMES||16);
  const names={};
  for(const t of (process.env.HL_HOOKS||"0x38").split(",")){const a=sym(t);hookSet.add(a);names[a]=t;}
  for(let f=0;f<frames;f++){
    hits=[];step();
    for(const h of hits)
      console.log(`HIT frame=${h.frame} addr=0x${h.pc.toString(16).toUpperCase().padStart(4,"0")} name=${names[h.pc]} cyc=${h.cyc}`);
  }
  process.exit(0);
}

if(mode==="race"){
  const dval=sym(process.env.HL_POKE_LXI),sjmp=sym(process.env.HL_POKE_JMP),
        sled=sym(process.env.HL_SLED),wsta=sym(process.env.HL_WSTA);
  const d0=+(process.env.HL_D0||0),d1=+(process.env.HL_D1||1200),ds=+(process.env.HL_DSTEP||1);
  const nops=+(process.env.HL_NOPS||0);
  const [px,py]=(process.env.HL_PIX||"32,148").split(",").map(Number); // bmp 576x288
  hookSet.add(wsta);
  for(let d=d0;d<=d1;d+=ds){
    wr(dval+1,d&0xff);wr(dval+2,(d>>8)&0xff);
    const entry=sled+nops;
    wr(sjmp+1,entry&0xff);wr(sjmp+2,(entry>>8)&0xff);
    for(let f=0;f<3;f++){hits=[];step();}
    let seen=0,wcyc=-1;
    for(let f=0;f<3;f++){
      hits=[];step();
      for(const h of hits)if(h.pc===wsta)wcyc=h.cyc;
      if((v06c.bmp[py*E.W+px]&0xffffff)!==0)seen++;
    }
    console.log(`RACE d=${d} nops=${nops} writeCyc=${wcyc} seen=${seen}/3`);
  }
  process.exit(0);
}
console.error("unknown HL_MODE="+mode);process.exit(1);
