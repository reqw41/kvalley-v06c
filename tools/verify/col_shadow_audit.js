// Аудит: кто читает vec_col_shadow (0xD400-0xDBFF) в рантайме сценария
// honest_diff (титул + hold + move). Хук memory.read, тэг по PC->символ.
// Использование: node col_shadow_audit.js <rom> <sym> [lo=0xD400] [hi=0xDC00] [hold] [move]
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function readSym(p){const m=[];for(const l of fs.readFileSync(p,"latin1").split("\n")){const g=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(g)m.push([g[1],parseInt(g[2],16)]);}m.sort((a,b)=>a[1]-b[1]);return m;}
function sym(map,pc){let best=null;for(const[n,a]of map){if(a<=pc)best=[n,pc-a];else break;}return best?`${best[0]}+0x${best[1].toString(16)}`:`0x${pc.toString(16)}`;}
function mk(romPath){
  const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
  const ctx=vm.createContext(g);
  for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
  const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
  v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
  const img=new Uint8Array(fs.readFileSync(romPath));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
  cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
  return {v06c,memory,cpu,keyboard};
}
const lo=parseInt(process.argv[4]||"0xD400"),hi=parseInt(process.argv[5]||"0xDC00");
const hold=+(process.argv[6]||900),move=+(process.argv[7]||60);
const map=readSym(process.argv[3]);
const M=mk(process.argv[2]);
const tally={};let total=0;
const origRead=M.memory.read.bind(M.memory);
M.memory.read=function(addr,stackrq){
  const a=addr&0xffff;
  if(a>=lo&&a<hi){const pc=M.cpu.pc&0xffff;const k=sym(map,pc);tally[k]=(tally[k]||0)+1;total++;}
  return origRead(addr,stackrq);
};
for(let f=0;f<400;f++)M.v06c.oneInterrupt(true);
for(let f=0;f<hold;f++){M.keyboard.keyDown({keyCode:32,preventDefault(){}});M.v06c.oneInterrupt(true);}
M.keyboard.keyUp({keyCode:32,preventDefault(){}});
for(let f=0;f<move;f++){M.keyboard.keyDown({keyCode:37,preventDefault(){}});M.v06c.oneInterrupt(true);}
console.log(`Чтений [0x${lo.toString(16)},0x${hi.toString(16)}) за ${400+hold+move} кадров: ${total}`);
for(const[k,v]of Object.entries(tally).sort((a,b)=>b[1]-a[1]))console.log(`  ${v}\t${k}`);
