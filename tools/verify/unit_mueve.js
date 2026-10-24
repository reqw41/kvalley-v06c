"use strict";
const fs = require("fs");
const MsxHeadless = require("/Users/boris/Projects/kvalley-v06c/tools/verify/msx_headless.js");
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
const sm=readSym("/tmp/kvm.sym"), sv=readSym("/tmp/kvv.sym");
const msx=MsxHeadless(new Uint8Array(fs.readFileSync("/tmp/kvm.rom")));
const vec=makeVector("/tmp/kvv.rom");
const TRAP=0xC300, AREA=0xC400, SZ=0x80;
function vw(a,v){vec.memory.bytes[vec.memory.tobank(a)]=v;}
function vr(a){return vec.memory.bytes[vec.memory.tobank(a)];}
// простой LCG для воспроизводимой "случайности"
let seed=12345; function rnd(){ seed=(Math.imul(seed,1103515245)+12345)>>>0; return (seed>>16)&0xFF; }
let diffs=0;
for(let iter=0; iter<400; iter++){
  const bytes=[]; for(let i=0;i<SZ;i++)bytes.push(rnd());
  // указатель в структуре: (HL) -> AREA+0x40 (середина, чтобы ix±5 в области)
  bytes[0x20]= (AREA+0x40)&0xFF; bytes[0x21]=(AREA+0x40)>>8;
  const de=(rnd()<<8)|rnd(), a0=rnd(), cy=iter&1;
  // MSX
  for(let i=0;i<SZ;i++)msx.mem[AREA+i]=bytes[i];
  {
    const st=msx.cpu.getState();
    st.a=a0; st.d=de>>8; st.e=de&255; st.h=(AREA+0x20)>>8; st.l=(AREA+0x20)&255;
    st.b=rnd()&0xFF; st.c=rnd()&0xFF;
    seed=iter*7+1; st.b=rnd(); st.c=rnd();          // ресид для идентичности
    st.sp=0xC380; st.pc=sm.mueveElemento; st.halted=false; st.iff1=0; st.iff2=0; st.flags.C=cy;
    msx.cpu.setState(st);
    msx.mem[0xC380]=TRAP&255; msx.mem[0xC381]=TRAP>>8;
    let ok=false;
    for(let g=0;g<20000;g++){ msx.cpu.instruction(); if(msx.cpu.pc===TRAP){ok=true;break;} }
    if(!ok){ console.log("msx не вернулась iter",iter); break; }
  }
  // VEC
  for(let i=0;i<SZ;i++)vw(AREA+i,bytes[i]);
  {
    const c=vec.cpu;
    seed=iter*7+1;
    c.regs[7]=a0; c.regs[2]=de>>8; c.regs[3]=de&255; c.regs[4]=(AREA+0x20)>>8; c.regs[5]=(AREA+0x20)&255;
    c.regs[0]=rnd(); c.regs[1]=rnd();
    c.sp=0xC380; c.pc=sv.mueveElemento; c.iff=false; c.cf=!!cy;
    vw(0xC380,TRAP&255); vw(0xC381,TRAP>>8);
    let ok=false;
    for(let g=0;g<40000;g++){ c.instruction(); if(c.pc===TRAP){ok=true;break;} }
    if(!ok){ console.log("vec не вернулась iter",iter); break; }
  }
  // сравнить область
  const bad=[];
  for(let i=0;i<SZ;i++) if(msx.mem[AREA+i]!==vr(AREA+i)) bad.push(i);
  if(bad.length){ diffs++;
    if(diffs<=5) console.log("iter",iter,"diff @",bad.map(x=>"+0x"+x.toString(16)+"(m"+msx.mem[AREA+x].toString(16)+"/v"+vr(AREA+x).toString(16)+")").join(" "));
  }
}
console.log("mueveElemento: 400 кейсов, расхождений:",diffs);
