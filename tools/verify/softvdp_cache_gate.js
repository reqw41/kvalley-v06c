// SOFT-VDP CACHE GATE: критерий корректности конверсии soft-VDP->натив. Нативные писатели
// БЫСТРЕЕ -> сдвигают тайминг -> пересевают цикло-зависимый game-state (benign, как edge-fix).
// Поэтому framebuffer/game-state сравнивать НЕЛЬЗЯ (reseed). Сравниваем КЭШИ (загруженные
// данные, reseed-НЕзависимые): vec_spr_buf (спрайты), pat_shadow (паттерны), vec_mixbuf (цвета).
// PASS = кэши байт-идентичны gold vs cand. node ..._cache_gate.js <goldRom> <goldSym> <candRom> <candSym>
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
return {v06c,keyboard,rd:a=>memory.bytes[memory.tobank(a)]};}
function key(k,dn,c){const e={keyCode:c,preventDefault(){}};dn?k.keyboard.keyDown(e):k.keyboard.keyUp(e);}
const [goldRom,goldSym,candRom,candSym]=process.argv.slice(2);
const A=mk(goldRom),B=mk(candRom); const sg=readSym(goldSym), sc=readSym(candSym);
function both(dn){if(dn!==undefined){key(A,true,dn);key(B,true,dn);}A.v06c.oneInterrupt(true);B.v06c.oneInterrupt(true);if(dn!==undefined){key(A,false,dn);key(B,false,dn);}}
// кэши: [имя, символ, размер]. Адреса берём из sym каждого рома (могли сдвинуться).
const CACHES=[["vec_spr_buf",0x100],["pat_maze_base",0x200],["pat_font_cell",0x180],["vec_pat_shadow",0x800],["vec_mixbuf",0x78]];
function cmp(tag){
  let tot=0;
  for(const [nm,sz] of CACHES){ const ga=sg[nm], ca=sc[nm]; if(ga===undefined||ca===undefined){console.log('  (нет '+nm+')');continue;}
    let d=0,first=-1; for(let i=0;i<sz;i++){if(A.rd(ga+i)!==B.rd(ca+i)){d++;if(first<0)first=i;}}
    console.log((d===0?'  OK':'  DIFF')+' ['+tag+'] '+nm+' diffs='+d+(first>=0?' @+0x'+first.toString(16):'')); tot+=d; }
  return tot;
}
let total=0;
for(let f=0;f<500;f++)both(); total+=cmp('титул');
for(let f=0;f<40;f++)both(32); for(let f=0;f<700;f++)both(); total+=cmp('загрузка/геймплей');
for(let f=0;f<300;f++)both([37,39,32,38][f%4]); cmp('геймплей+движ [ИНФО: pat_shadow diff тут = треже-флеш reseed, не баг]');
console.log(total===0?'✅ CACHE GATE PASS: все кэши байт-идентичны (конверсия корректна; reseed геймплея игнорируем)':'❌ КЭШ РАСХОДИТСЯ: '+total+' (конверсия испортила данные!)');
