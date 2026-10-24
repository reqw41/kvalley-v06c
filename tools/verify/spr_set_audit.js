// ШАГ1: замер реального spr-набора. Хук vec_nsx: собираем distinct pat&0xFC,
// classing hero(sprAttrib slot0-5) vs mummy(enemyAttrib slot6-13) по источнику HL.
// Плюс счётчик InviertePatron в геймплее.
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
const img=new Uint8Array(fs.readFileSync(process.argv[2]));mem.init_from_array(img.subarray(0,0x10000),0x100);mem.detach_boot&&mem.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const rd=a=>mem.bytes[mem.tobank(a)];
// БЫЛО зашито числами (эра 0x6B00): sprAttrib=0x6BB0, enemyAttrib=0x6BC8, а также дефолты
// VEC_NSX/INVP/LOADANIM/FLIPSPR — теперь читаем .sym по имени (путь по умолчанию выводится
// из пути к rom, либо явный argv[3]).
const SYMPATH=process.argv[3]||process.argv[2].replace(/\.rom$/,".sym");
const L={};for(const l of fs.readFileSync(SYMPATH,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
if(!L.sprAttrib||!L.enemyAttrib){console.log("нет символов sprAttrib/enemyAttrib в .sym");process.exit(2);}
const sprAttrib=L.sprAttrib, enemyAttrib=L.enemyAttrib;
// ВНИМАНИЕ: vec_nsx — точка входа СТАРОГО спрайт-блиттера. Он полностью переписан (см.
// src/v06c/vec_sprites.asm, семейства vns_*/vsu_*/vsp_*/vso_*), и в текущем .sym символа
// vec_nsx больше нет. Это протухание ПО СУЩЕСТВУ (сам хук целится не в ту функцию), а не
// адресный баг — угадывать замену не будем, честно останавливаемся (см. отчёт: кандидат
// на переписывание под новый конвейер). InviertePatron/loadAnimation/flipSprites живы.
if(!L.vec_nsx){
  console.log("нет символа vec_nsx в .sym — спрайт-блиттер переписан (vns_*/vsu_*/vsp_*/vso_*), скрипт нужно переписать под новый конвейер, а не патчить адрес");
  process.exit(2);
}
if(!L.InviertePatron||!L.loadAnimation||!L.flipSprites){console.log("нет символов InviertePatron/loadAnimation/flipSprites в .sym");process.exit(2);}
const VEC_NSX=L.vec_nsx, INVP=L.InviertePatron, LOADANIM=L.loadAnimation, FLIPSPR=L.flipSprites;
let track=false;
const patAll=new Map();
const patHero=new Set(), patMummy=new Set(), patOther=new Set();
let invp=0, loadanim=0, flipspr=0, nsxcalls=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){const pc=cpu.pc&0xffff;
  if(track){
    if(pc===VEC_NSX){
      const hl=cpu.hl()&0xffff; const Y=rd(hl);
      if(Y<0xD0){ nsxcalls++;
        const pat=rd((hl+2)&0xffff)&0xFC;
        patAll.set(pat,(patAll.get(pat)||0)+1);
        if(hl>=sprAttrib && hl<enemyAttrib) patHero.add(pat);
        else if(hl>=enemyAttrib && hl<enemyAttrib+32) patMummy.add(pat);
        else patOther.add(pat);
      }
    }
    else if(pc===INVP)invp++;
    else if(pc===LOADANIM)loadanim++;
    else if(pc===FLIPSPR)flipspr++;
  }
  return oI();};
// БЫЛО зашито 0x6B00 (эра 0x6B00, GameStatus) — теперь по имени из .sym.
if(!L.GameStatus){console.log("нет символа GameStatus в .sym");process.exit(2);}
for(let f=0;f<600;f++)v06c.oneInterrupt(true);
for(let f=0;f<1500;f++){kb.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);if(rd(L.GameStatus)===5)break;}
kb.keyUp({keyCode:32,preventDefault(){}});
for(let f=0;f<120;f++)v06c.oneInterrupt(true);
track=true;
for(let f=0;f<200;f++){kb.keyDown({keyCode:39,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:39,preventDefault(){}});}
for(let f=0;f<200;f++){kb.keyDown({keyCode:37,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:37,preventDefault(){}});}
for(let f=0;f<80;f++){kb.keyDown({keyCode:38,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:38,preventDefault(){}});}
// БЫЛО зашито 0x6C44 (эра 0x6C00, objetoCogido) — этот адрес сейчас лежит в КОДЕ игры;
// запись туда портила бы исполняемые байты. Теперь по имени из .sym.
if(!L.objetoCogido){console.log("нет символа objetoCogido в .sym");process.exit(2);}
mem.bytes[mem.tobank(L.objetoCogido)]=0x20;
for(let f=0;f<40;f++)v06c.oneInterrupt(true);
for(let f=0;f<150;f++){kb.keyDown({keyCode:39,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:39,preventDefault(){}});}
for(let f=0;f<150;f++){kb.keyDown({keyCode:37,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:37,preventDefault(){}});}
for(let f=0;f<200;f++){kb.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:32,preventDefault(){}});}
const sortNum=a=>[...a].sort((x,y)=>x-y).map(v=>"0x"+v.toString(16));
console.log("=== spr-set audit ("+nsxcalls+" видимых vec_nsx вызовов) ===");
console.log("distinct pat&0xFC:", patAll.size, sortNum(patAll.keys()));
console.log("  hero (sprAttrib):", patHero.size, sortNum(patHero));
console.log("  mummy(enemyAttrib):", patMummy.size, sortNum(patMummy));
console.log("  other(prev/erase):", patOther.size, sortNum(patOther));
console.log("частоты:", [...patAll.entries()].sort((a,b)=>a[0]-b[0]).map(([k,v])=>"0x"+k.toString(16)+":"+v).join(" "));
console.log("InviertePatron calls:", invp, " loadAnimation:", loadanim, " flipSprites:", flipspr);
