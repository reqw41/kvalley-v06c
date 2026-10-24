// MIXBUF TRAP (soft-VDP Стадия 4 root-cause): перехватывает ВСЕ записи в диапазон vec_mixbuf
// [0x7E85,0x7EFD) на gold и cand, логирует PC-писателя (resolve по .sym к ближайшей метке <=PC).
// Цель: доказать, КТО пишет цвет в mixbuf в gold и что в cand (reroute UnpackPatterns) эти
// записи ОТСУТСТВУЮТ (цвета уходят в pat-кэш через vec_pat_wr). node mixbuf_trap.js gRom gSym cRom cSym
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function readSym(p){const arr=[];for(const l of fs.readFileSync(p,"latin1").split("\n")){const g=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(g)arr.push([g[1],parseInt(g[2],16)]);}arr.sort((a,b)=>a[1]-b[1]);return arr;}
function symOf(arr,pc){let lo=0,hi=arr.length-1,best=null;while(lo<=hi){const m=(lo+hi)>>1;if(arr[m][1]<=pc){best=arr[m];lo=m+1;}else hi=m-1;}return best?best[0]+"+0x"+(pc-best[1]).toString(16):"?"+pc.toString(16);}
const MIX=0x7E85, MIXEND=0x7EFD;
function mk(rom,sym){const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
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
// счётчик записей в mixbuf по PC-символу (только не-стековые записи)
const hits=new Map(); const symarr=sym;
const origWrite=memory.write.bind(memory);
memory.write=function(addr,w8,stackrq){const a=addr&0xffff;if(a>=MIX&&a<MIXEND&&!stackrq){const s=symOf(symarr,cpu.pc&0xffff);const e=hits.get(s)||{n:0,addrs:new Set()};e.n++;e.addrs.add(a);hits.set(s,e);}return origWrite(addr,w8,stackrq);};
return {v06c,keyboard,hits,rd:a=>memory.bytes[memory.tobank(a)]};}
function key(k,dn,c){const e={keyCode:c,preventDefault(){}};dn?k.keyboard.keyDown(e):k.keyboard.keyUp(e);}
const [gRom,gSym,cRom,cSym]=process.argv.slice(2);
const A=mk(gRom,readSym(gSym)),B=mk(cRom,readSym(cSym));
function run(m,frames,dn){for(let f=0;f<frames;f++){if(dn!==undefined){key(m,true,dn);}m.v06c.oneInterrupt(true);if(dn!==undefined){key(m,false,dn);}}}
// прогон до конца загрузки титула (как фаза "титул" cache-гейта)
run(A,500);run(B,500);
function dump(tag,hits){console.log("=== "+tag+" mixbuf-писатели (PC-символ -> кол-во записей) ===");
  const rows=[...hits.entries()].sort((a,b)=>b[1].n-a[1].n);
  if(!rows.length){console.log("  (НЕТ записей в mixbuf!)");}
  for(const [s,e] of rows)console.log("  "+s+"  writes="+e.n+"  distinct_addrs="+e.addrs.size);
  return new Set(hits.keys());}
const gk=dump("GOLD",A.hits),ck=dump("CAND",B.hits);
console.log("\n=== РАСХОЖДЕНИЕ ===");
const goldOnly=[...gk].filter(s=>!ck.has(s));
const candOnly=[...ck].filter(s=>!gk.has(s));
console.log("Писатели ТОЛЬКО в GOLD (пропали в cand):", goldOnly.length?goldOnly.join(", "):"нет");
console.log("Писатели ТОЛЬКО в CAND (новые):", candOnly.length?candOnly.join(", "):"нет");
let gtot=0,ctot=0;for(const e of A.hits.values())gtot+=e.n;for(const e of B.hits.values())ctot+=e.n;
console.log("Всего записей в mixbuf: gold="+gtot+"  cand="+ctot+"  (дельта="+(gtot-ctot)+")");
