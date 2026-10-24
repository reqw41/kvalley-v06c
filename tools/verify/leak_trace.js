// leak_trace.js — ловит записи блиттера (rot-петли) ВНЕ плоскостей 0x8000-0xFFFF
// во время живого геймплея. Если блиттер пишет в game-RAM (<0x8000) — это порча
// состояния, а не просто визуальный wrap. Печатает адреса/PC/кадры.
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const ROM=process.argv[2],SYM=process.argv[3];
const symtxt=fs.readFileSync(SYM,"utf8");
function sym(n){const m=symtxt.match(new RegExp("^"+n+":\\s*equ\\s*0*([0-9A-Fa-f]+)h","m"));return m?parseInt(m[1],16):null;}
const rot0=sym("rot0_loop"),rot7=sym("rot7_loop"),vns=sym("vec_nat_sprites"),vspr=sym("vec_spr_buf");
const blitLo=rot0, blitHi=vspr; // блиттер-код лежит в [rot0..vec_spr_buf)
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(ROM));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
console.log(`blit-код PC-диапазон [0x${blitLo.toString(16)}..0x${blitHi.toString(16)}), vns=0x${vns.toString(16)}`);
// хук записи
const origWr=memory.wr8?memory.wr8.bind(memory):null;
const hits={};let curPC=0;
const wname="write";
// vector06js memory: обычно write через memory.write(addr,val). Найдём метод.
const wm = memory.write?"write":(memory.wr8?"wr8":null);
const orig = memory[wm].bind(memory);
memory[wm]=function(addr,val){
  if(curPC>=blitLo&&curPC<blitHi&&addr<0x8000&&addr>=0x100){
    const k=addr.toString(16); hits[k]=(hits[k]||0)+1;
  }
  return orig(addr,val);
};
let frame=0;
function step(){ curPC=cpu.pc; cpu.instruction(); }
// заменить oneInterrupt пошагово нельзя легко; вместо этого хукаем cpu.instruction через curPC
const origInstr=cpu.instruction.bind(cpu);
cpu.instruction=function(){ curPC=cpu.pc; return origInstr(); };
for(let f=0;f<1400;f++){
  const press=(f>=520&&f<=560);
  if(press)keyboard.keyDown({keyCode:32,preventDefault(){}});else keyboard.keyUp({keyCode:32,preventDefault(){}});
  v06c.oneInterrupt(true); frame=f;
  if(f>1150&&memory.bytes[memory.tobank(sym("GameStatus"))]===5)break;
}
// доп. движение чтобы мумии дошли до края
for(let f=0;f<900;f++){ keyboard.keyDown({keyCode:32,preventDefault(){}}); v06c.oneInterrupt(true); }
keyboard.keyUp({keyCode:32,preventDefault(){}});
for(let f=0;f<400;f++){ keyboard.keyDown({keyCode:37,preventDefault(){}}); v06c.oneInterrupt(true); }
const ks=Object.keys(hits);
if(ks.length===0)console.log("НЕТ записей блиттера в <0x8000 — утечка чисто VRAM");
else{console.log("ЗАПИСИ БЛИТТЕРА в game-RAM (<0x8000):");for(const k of ks.sort())console.log(`  0x${k}: ${hits[k]}x`);}
