// Измеряет стоимость vec_nat_room (блит статичного фона) в тактах и распределение
// тайлов (репетативность) — для Фазы 1 POP-плана. Bracket'инг по SP как в frame_budget_cats.
// Использ.: node tools/verify/room_blit_cost.js <rom> <sym>
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function readSym(p){const s={};for(const l of fs.readFileSync(p,"latin1").split("\n")){const g=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(g)s[g[1]]=parseInt(g[2],16);}return s;}
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(process.argv[2]));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const S=readSym(process.argv[3]);
const rd=a=>memory.bytes[memory.tobank(a)];
const NR=S.vec_nat_room, BT=S.vec_blit_tile, PB=S.vec_popbg||-1;
let nrActive=false,nrSP=0,nrCyc=0,nrTiles=0,nrCalls=[];
let btActive=false,btSP=0,btCyc=0,btCount=0,btTotal=0;
let pbActive=false,pbSP=0,pbCyc=0,pbCount=0,pbTotal=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc&0xffff, sp=cpu.sp&0xffff;
  if(nrActive && sp>nrSP){ nrCalls.push({cyc:nrCyc,tiles:nrTiles}); nrActive=false; }
  if(btActive && sp>btSP){ btActive=false; btTotal+=btCyc; btCount++; }
  if(pbActive && sp>pbSP){ pbActive=false; pbTotal+=pbCyc; pbCount++; }
  if(pc===NR && !nrActive){ nrActive=true; nrSP=sp; nrCyc=0; nrTiles=0; }
  if(pc===BT){ if(nrActive) nrTiles++; if(!btActive){ btActive=true; btSP=sp; btCyc=0; } }
  if(pc===PB){ if(nrActive) nrTiles++; if(!pbActive){ pbActive=true; pbSP=sp; pbCyc=0; } }
  oI();
  const vc=cpu.vcycles|0;
  if(nrActive) nrCyc+=vc;
  if(btActive) btCyc+=vc;
  if(pbActive) pbCyc+=vc;
};
for(let f=0;f<900;f++)v06c.oneInterrupt(true);
for(let f=0;f<400;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);}
keyboard.keyUp({keyCode:32,preventDefault(){}});
for(let f=0;f<200;f++)v06c.oneInterrupt(true);
console.log("vec_nat_room вызовов:",nrCalls.length);
nrCalls.forEach((c,i)=>console.log(`  #${i}: ${c.cyc} тактов, ${c.tiles} тайлов, ${(c.cyc/(c.tiles||1)).toFixed(1)} т/тайл`));
console.log("vec_blit_tile всего:",btCount,"вызовов, средн",(btTotal/(btCount||1)).toFixed(1),"т/вызов (полный блит тайла)");
if(PB>=0)console.log("vec_popbg   всего:",pbCount,"вызовов, средн",(pbTotal/(pbCount||1)).toFixed(1),"т/вызов (POP-блит кэш-тайла)");
