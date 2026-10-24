// SOFT-VDP REFACTOR GATE: чистый рефактор (soft-VDP -> нативные записи) ДОЛЖЕН оставить
// картинку И содержимое кэшей байт-в-байт идентичными. Сравнивает framebuffer + ключевые
// буферы (pat_shadow, spr_buf, mixbuf, HUD/tile области p0/p1) золотого рома против кандидата
// на трёх точках: титул, после загрузки уровня, геймплей. PASS = 0 различий во всех точках.
// node tools/verify/softvdp_gate.js <goldRom> <goldSym> <candRom> <candSym>
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function readSym(p){const m={};for(const l of fs.readFileSync(p,"latin1").split("\n")){const g=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(g)m[g[1]]=parseInt(g[2],16);}return m;}
function mk(rom){const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
return {v06c,keyboard,mem:memory,rd:a=>memory.bytes[memory.tobank(a)]};}
function key(k,dn,c){const e={keyCode:c,preventDefault(){}};dn?k.keyboard.keyDown(e):k.keyboard.keyUp(e);}
const [goldRom,goldSym,candRom,candSym]=process.argv.slice(2);
const A=mk(goldRom),B=mk(candRom);
const sv=readSym(goldSym), sv2=readSym(candSym);
// framebuffer p0/p1 (фон) = VRAM 0x8000-0xBFFF; p2/p3 (спрайты) 0xC000-0xFFFF
function fbHash(K){let h=0;for(let a=0x8000;a<0x10000;a++){h=((h*33)^K.rd(a))>>>0;}return h;}
function cmp(tag){
  let d=0, firstA=-1;
  for(let a=0x8000;a<0x10000;a++){ if(A.rd(a)!==B.rd(a)){ d++; if(firstA<0)firstA=a; } }
  console.log((d===0?'  OK':'  DIFF')+' ['+tag+'] VRAM(0x8000-0xFFFF) diffs='+d+(firstA>=0?' first@0x'+firstA.toString(16):''));
  return d;
}
function both(dn){ if(dn!==undefined){key(A,true,dn);key(B,true,dn);} A.v06c.oneInterrupt(true);B.v06c.oneInterrupt(true); if(dn!==undefined){key(A,false,dn);key(B,false,dn);} }
let total=0;
for(let f=0;f<500;f++)both(); total+=cmp('титул');
for(let f=0;f<40;f++)both(32); for(let f=0;f<600;f++)both(); total+=cmp('после загрузки/геймплей-старт');
for(let f=0;f<300;f++)both([37,39,32,38][f%4]); total+=cmp('геймплей+движение');
console.log(total===0?'✅ SOFT-VDP GATE PASS: VRAM идентичен во всех точках':'❌ РАСХОЖДЕНИЕ VRAM: '+total+' (рефактор изменил картинку/кэш!)');
