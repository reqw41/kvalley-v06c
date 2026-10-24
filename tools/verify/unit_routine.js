// Юнит-сравнение одной рутины на двух таргетах: вызов с заданными регистрами,
// исполнение до возврата (ret-ловушка), сравнение выходных регистров.
"use strict";
const fs = require("fs");
const MsxHeadless = require("./msx_headless.js");
const base = "/Users/boris/Projects/vector06js";

function makeVector(romPath) {
  global.window = global;
  global.document = { createElement: () => fc(), getElementById: () => fc() };
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  global.requestAnimationFrame=()=>0; global.setTimeout=()=>0; global.print=()=>0; global.console.debug=()=>{};
  const files=["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"];
  const vm=require("vm"); const ctx=vm.createContext(global);
  for(const f of files) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  const {Memory,IO,AY,I8253,Keyboard,I8080,Floppy}=ctx;
  const memory=new Memory(),keyboard=new Keyboard(),timer=new I8253(),ay=new AY();
  const floppy=new(Floppy().FD1793)(); const io=new IO(keyboard,timer,memory,ay,floppy);
  io.Palette=new Array(16).fill(0);
  const cpu=new I8080(memory,io);
  const img=new Uint8Array(fs.readFileSync(romPath));
  memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
  return { cpu, memory };
}
function readSym(p){const m={};for(const l of fs.readFileSync(p,"latin1").split("\n")){const g=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(g)m[g[1]]=parseInt(g[2],16);}return m;}

const [romM,symM,romV,symV,routine]=process.argv.slice(2);
const sm=readSym(symM), sv=readSym(symV);
const msx=MsxHeadless(new Uint8Array(fs.readFileSync(romM)));
const vec=makeVector(romV);
const TRAP=0xBF00;
msx.mem[TRAP]=0x76; // hlt-ловушка не нужна: следим pc

// вызов на MSX (Z80): выставить регистры через setState-подобный путь
function callMsx(addr, regs) {
  const st=msx.cpu.getState();
  st.a=regs.a??0; st.b=regs.b??0; st.c=regs.c??0; st.d=regs.d??0; st.e=regs.e??0;
  st.h=regs.h??0; st.l=regs.l??0; st.sp=0xBF80; st.pc=addr; st.halted=false;
  st.iff1=0; st.iff2=0;
  st.flags.C=regs.cy??0;
  msx.cpu.setState(st);
  // ret-ловушка на стек
  msx.mem[0xBF80]=TRAP&0xFF; msx.mem[0xBF81]=TRAP>>8;
  for(let g=0; g<10000; g++){ msx.cpu.instruction(); if(msx.cpu.pc===TRAP){ const o=msx.cpu.getState(); return {h:o.h,l:o.l,a:o.a,cy:o.flags.C?1:0}; } }
  return null;
}
// вызов на Vector (i8080): regs = [b,c,d,e,h,l,m,a]
function callVec(addr, regs) {
  const c=vec.cpu;
  c.regs[0]=regs.b??0; c.regs[1]=regs.c??0; c.regs[2]=regs.d??0; c.regs[3]=regs.e??0;
  c.regs[4]=regs.h??0; c.regs[5]=regs.l??0; c.regs[7]=regs.a??0;
  c.sp=0xBF80; c.pc=addr; c.iff=false;
  c.cf=!!(regs.cy??0);
  vec.memory.bytes[vec.memory.tobank(0xBF80)]=TRAP&0xFF;
  vec.memory.bytes[vec.memory.tobank(0xBF81)]=TRAP>>8;
  for(let g=0; g<20000; g++){ c.instruction(); if(c.pc===TRAP) return {h:c.regs[4],l:c.regs[5],a:c.regs[7],cy:c.cf?1:0}; }
  return null;
}

const am=sm[routine], av=sv[routine];
if(!am||!av){ console.log("нет символа",routine); process.exit(1); }
let diffs=0, shown=0, tested=0;
for(let de=0; de<0x10000; de++){
  const regs={d:de>>8, e:de&0xFF, a:0x55, cy:0};
  const rm=callMsx(am,regs), rv=callVec(av,regs);
  tested++;
  if(!rm||!rv){ console.log("не вернулась на DE="+de.toString(16)); break; }
  if(rm.h!==rv.h||rm.l!==rv.l){
    diffs++;
    if(shown<8){ shown++;
      console.log(`DE=${de.toString(16)} (Y=${de>>8},X=${de&255}): msx HL=${((rm.h<<8)|rm.l).toString(16)} vec HL=${((rv.h<<8)|rv.l).toString(16)}`); }
  }
}
console.log(`${routine}: проверено ${tested}, расхождений ${diffs}`);
