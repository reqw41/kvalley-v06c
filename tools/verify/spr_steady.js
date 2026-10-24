// Стационарный геймплей: только ходьба вправо/влево в стартовой комнате, БЕЗ лестниц/подбора.
// Сколько InviertePatron/flipSprites/loadAnimation/loadGameGfx? Проверка per-frame soft-VDP.
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const mem=new ctx.Memory(),kb=new ctx.Keyboard(),tmr=new ctx.I8253(),ay=new ctx.AY(),fl=new(ctx.Floppy().FD1793)(),io=new ctx.IO(kb,tmr,mem,ay,fl);
const cpu=new ctx.I8080(mem,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,mem,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const rom=process.argv[2];
const img=new Uint8Array(fs.readFileSync(rom));mem.init_from_array(img.subarray(0,0x10000),0x100);mem.detach_boot&&mem.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const rd=a=>mem.bytes[mem.tobank(a)];
// Адреса рутин/переменных берём из .sym по имени (раньше были зашиты числа INVP/FLIP/LOADANIM/LG —
// это адреса КОДА, они тоже сместились вместе с переездом базы переменных 0x6B00->0x6C00->0x7092).
const symPath=process.argv[3]||rom.replace(/\.rom$/,".sym");
const L={};
for(const l of fs.readFileSync(symPath,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
for(const name of ["InviertePatron","flipSprites","loadAnimation","loadGameGfx","GameStatus"]){
  if(L[name]===undefined){console.error(name+" не найден в "+symPath);process.exit(2);}
}
const INVP=L.InviertePatron, FLIP=L.flipSprites, LOADANIM=L.loadAnimation, LG=L.loadGameGfx, GS_ADDR=L.GameStatus;
let track=false, invp=0, flip=0, la=0, lg=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){const pc=cpu.pc&0xffff;
  if(track){ if(pc===INVP)invp++; else if(pc===FLIP)flip++; else if(pc===LOADANIM)la++; else if(pc===LG)lg++; }
  return oI();};
for(let f=0;f<600;f++)v06c.oneInterrupt(true);
for(let f=0;f<1500;f++){kb.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);if(rd(GS_ADDR)===5)break;}
kb.keyUp({keyCode:32,preventDefault(){}});
for(let f=0;f<120;f++)v06c.oneInterrupt(true);
track=true;
// ТОЛЬКО повороты вправо-влево (без лестниц, без подбора)
for(let rep=0;rep<20;rep++){
  for(let f=0;f<10;f++){kb.keyDown({keyCode:39,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:39,preventDefault(){}});}
  for(let f=0;f<10;f++){kb.keyDown({keyCode:37,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:37,preventDefault(){}});}
}
console.log("СТАЦИОНАР (400 кадров ходьбы вправо/влево, без лестниц/подбора):");
console.log("  InviertePatron:",invp," flipSprites:",flip," loadAnimation:",la," loadGameGfx:",lg);
