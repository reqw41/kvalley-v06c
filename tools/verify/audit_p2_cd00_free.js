"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
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
// БЫЛО зашито 0x6B00 (GameStatus) и 0x6C44 (objetoCogido), эра 0x6B00/0x6C00 — по этим
// адресам сейчас лежит КОД игры. Читаем .sym по имени (путь по умолчанию — рядом с rom).
// LO/HI НЕ трогаем: это фиксированный старый (уже мёртвый) диапазон VRAM p2, а не адрес
// переменной — аудит специально проверяет именно этот исторический адрес.
const SYMPATH=process.argv[3]||process.argv[2].replace(/\.rom$/,".sym");
const L={};for(const l of fs.readFileSync(SYMPATH,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
if(!L.GameStatus||!L.objetoCogido){console.log("нет символов GameStatus/objetoCogido в .sym");process.exit(2);}
const LO=0xCD00,HI=0xD000; // freed p2 spr-buf old region [LO,HI) after move to low-RAM
let track=false, wr=0, rd=0, wrEx=new Set(), rdEx=new Set();
// FIX: i8080 core uses memory.read/memory.write (NOT .rd/.wr — the old
// audit_spr_shadow_free.js hooked nonexistent methods and was a silent no-op).
const origRead=memory.read.bind(memory), origWrite=memory.write.bind(memory);
memory.read=function(a,s){const aa=a&0xffff;if(track&&aa>=LO&&aa<HI){rd++;rdEx.add(aa);}return origRead(a,s);};
memory.write=function(a,v,s){const aa=a&0xffff;if(track&&aa>=LO&&aa<HI){wr++;wrEx.add(aa);}return origWrite(a,v,s);};
// boot + reach gameplay
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
for(let f=0;f<1200;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);if(memory.bytes[memory.tobank(L.GameStatus)]===5)break;}
keyboard.keyUp({keyCode:32,preventDefault(){}});
track=true; // теперь только ГЕЙМПЛЕЙ
for(let f=0;f<300;f++){keyboard.keyDown({keyCode:39,preventDefault(){}});v06c.oneInterrupt(true);keyboard.keyUp({keyCode:39,preventDefault(){}});}
for(let f=0;f<300;f++){keyboard.keyDown({keyCode:37,preventDefault(){}});v06c.oneInterrupt(true);keyboard.keyUp({keyCode:37,preventDefault(){}});}
memory.bytes[memory.tobank(L.objetoCogido)]=0x20;
for(let f=0;f<200;f++){keyboard.keyDown({keyCode:38,preventDefault(){}});v06c.oneInterrupt(true);keyboard.keyUp({keyCode:38,preventDefault(){}});}
console.log(`GEYMPLEY доступы к 0xCD00-0xCFFF (старый p2 spr-буфер): записей=${wr} чтений=${rd}`);
console.log(wr===0&&rd===0?"AUDIT: ✅ 0xCD00-0xCFFF ПОЛНОСТЬЮ свободен в геймплее (768Б p2 освобождено)":"AUDIT: ❌ доступы есть");
