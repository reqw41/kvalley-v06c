// softvdp_pc_trap.js — трап PC остатков soft-VDP за полный прогон
// (аттракт + старт + геймплей + смерть). Считает попадания и диапазон кадров.
// Usage: node softvdp_pc_trap.js <rom> [frames=1800]
"use strict";
const fs=require("fs"),vm=require("vm");
const base="/Users/boris/Projects/vector06js";
global.window=global;
global.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
global.requestAnimationFrame=()=>0;global.setTimeout=()=>0;global.print=()=>0;
const files=["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"];
const ctx=vm.createContext(global);
for(const f of files) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const {Memory,IO,AY,I8253,Keyboard,I8080,Vector06c,Floppy}=ctx;
const memory=new Memory(),keyboard=new Keyboard(),timer=new I8253(),ay=new AY();
const floppy=new(Floppy().FD1793)();const io=new IO(keyboard,timer,memory,ay,floppy);
io.Palette=new Array(16).fill(0);
const cpu=new I8080(memory,io);const tape={advance:()=>{},sample:0,reset:()=>{}};
const v06c=new Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;
if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const rom=process.argv[2],frames=+(process.argv[3]||1800);
const img=new Uint8Array(fs.readFileSync(rom));
memory.init_from_array(img.subarray(0,Math.min(img.length,0x10000)),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xf000;cpu.iff=false;

// Trap map: address -> name. Addresses resolved from <rom>.sym (basename swap).
const symPath=rom.replace(/\.rom$/,".sym");
const symTxt=fs.readFileSync(symPath,"utf8");
function sym(name){const m=symTxt.match(new RegExp("^"+name+":\\s*equ\\s*0*([0-9A-Fa-f]+)h","m"));if(!m)return null;return parseInt(m[1],16);}
const WANT=["vec_vram_write","vec_de_slow","vec_de_slow0","VRAM_write2","DEtoVRAM_NXNY","drawLogoRow","InviertePatron","unpackGFX","drawMenuEnd","vec_blit_rect"];
const TRAPS={};
for(const nm of WANT){const a=sym(nm);if(a!=null)TRAPS[a]=nm;else console.error("SYM MISS:",nm);}
const stat={};for(const a in TRAPS)stat[TRAPS[a]]={count:0,first:-1,last:-1};
let curFrame=0;
const origInstr=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc;
  const nm=TRAPS[pc];
  if(nm){const s=stat[nm];s.count++;if(s.first<0)s.first=curFrame;s.last=curFrame;}
  return origInstr();
};

// input injection helpers via keyboard.matrix (io.js port 0x0e reads matrix[0]/matrix[7])
function clearKeys(){keyboard.matrix[0]=0;keyboard.matrix[7]=0;}
function setSpace(on){if(on)keyboard.matrix[7]|=0x80;else keyboard.matrix[7]&=~0x80;}
function setRight(on){if(on)keyboard.matrix[0]|=0x40;else keyboard.matrix[0]&=~0x40;}
function setLeft(on){if(on)keyboard.matrix[0]|=0x10;else keyboard.matrix[0]&=~0x10;}
function setUp(on){if(on)keyboard.matrix[0]|=0x20;else keyboard.matrix[0]&=~0x20;}
function setDown(on){if(on)keyboard.matrix[0]|=0x80;else keyboard.matrix[0]&=~0x80;}
clearKeys();

for(let f=0;f<frames;f++){
  curFrame=f;
  // scripted input: let attract run 0..650, then press space to start,
  // then wander to trigger gameplay + eventually death.
  if(f>=650 && f<665){setSpace(true);}
  else if(f===665){setSpace(false);}
  else if(f>=680 && f<900){ // move right/left to walk around
    setRight((f%40)<20); setLeft((f%40)>=20);
  } else if(f>=900 && f<1200){ // climb / move to encounter mummies (death)
    setUp((f%30)<15); setRight((f%20)<10);
  } else if(f>=1200){ clearKeys(); // let death/transition play out; press space to restart
    if(f>=1250 && f<1260) setSpace(true); else setSpace(false);
  }
  try{v06c.oneInterrupt(true);}catch(e){console.error("frame",f,"err",e.message);break;}
}
console.log("ROM:",rom,"frames:",frames);
console.log("addr    name              count   firstFrame  lastFrame");
for(const a in TRAPS){const nm=TRAPS[a];const s=stat[nm];
  console.log("0x"+(+a).toString(16).padStart(4,"0")+"  "+nm.padEnd(16)+"  "+String(s.count).padStart(6)+"   "+String(s.first).padStart(9)+"  "+String(s.last).padStart(9));
}
