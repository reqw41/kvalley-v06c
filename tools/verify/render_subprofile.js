// Суб-профиль RENDER: раскладка тактов updateSprites по MIRROR/ERASE/DISPATCH/BLIT-SETUP/BLIT-ROT
// на busy-кадрах (герой+мумии влево). Использ: node render_subprofile.js <rom> <sym>
"use strict";
const fs=require("fs"),vm=require("vm");const EMU="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(EMU+"/"+f,"utf8"),ctx,{filename:f});
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(process.argv[2]));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const rd=a=>memory.bytes[memory.tobank(a&0xffff)];const BUDGET=59904;
// БЫЛО зашито 0x6bc8 (эра 0x6B00/0x6C00) — теперь по имени из .sym.
const L={};for(const l of fs.readFileSync(process.argv[3]||"build/kvalley_8c.sym","latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
if(!L.enemyAttrib){console.log("нет символа enemyAttrib в .sym");process.exit(2);}
const ENEMY=L.enemyAttrib;
// ВНИМАНИЕ: границы бакетов MIRROR/ERASE/DISPATCH/BLIT-SETUP/BLIT-ROT — это ЗАШИТЫЕ диапазоны
// PC старого спрайт-блиттера (vec_nsx-семейство). Блиттер полностью переписан (см.
// src/v06c/vec_sprites.asm, vns_*/vsu_*/vsp_*/vso_*), и по этим адресам сейчас другой код —
// разбивка по категориям ниже НЕ СООТВЕТСТВУЕТ действительности. Это не адресный баг
// переменной, а протухшая по существу карта кода; см. отчёт (кандидат на переписывание).
function bucket(pc){ if(pc>=0x5989&&pc<0x599C)return"MIRROR"; if(pc>=0x599C&&pc<0x5D5A)return"ERASE";
  if(pc>=0x5D5A&&pc<0x5E23)return"DISPATCH"; if(pc>=0x5E23&&pc<0x60C2)return"BLIT-SETUP";
  if(pc>=0x60C2&&pc<0x6598)return"BLIT-ROT"; return null; }
const CATS=["MIRROR","ERASE","DISPATCH","BLIT-SETUP","BLIT-ROT"];
let cat={},rec=false; function reset(){cat={};for(const c of CATS)cat[c]=0;cat.RENDER_OTHER=0;cat.NONREND=0;}
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){const pc=cpu.pc&0xffff;oI();if(rec){const vc=cpu.vcycles|0;if(cpu.last_opcode===0x76)return;const b=bucket(pc);if(b)cat[b]+=vc;else cat.NONREND+=vc;}};
function key(dn,c){const e={keyCode:c,preventDefault(){}};dn?keyboard.keyDown(e):keyboard.keyUp(e);}
function mummies(){let n=0;for(let i=0;i<4;i++)if(rd(ENEMY+i*4)!==0xE0)n++;return n;}
function frame(dn){reset();rec=true;if(dn!==undefined)key(true,dn);v06c.oneInterrupt(true);if(dn!==undefined)key(false,dn);rec=false;
  const rend=CATS.reduce((a,c)=>a+cat[c],0);return{cat:{...cat},rend,mum:mummies()};}
for(let f=0;f<420;f++)v06c.oneInterrupt(true);
for(let f=0;f<900;f++){key(true,32);v06c.oneInterrupt(true);key(false,32);}
for(let f=0;f<400;f++){key(true,37);v06c.oneInterrupt(true);key(false,37);}
const seq=[37,37,39,39];const busy=[];
for(let f=0;f<400;f++){const r=frame(seq[f%4]);if(r.mum>=2)busy.push(r);}
const peak=busy.reduce((a,b)=>b.rend>a.rend?b:a,busy[0]);
const avg={};for(const c of CATS)avg[c]=Math.round(busy.reduce((a,b)=>a+b.cat[c],0)/busy.length);
console.log(`busy-кадров: ${busy.length}`);
console.log(`\nПИКОВЫЙ RENDER-кадр (мумий=${peak.mum}): RENDER=${peak.rend} тактов (${(100*peak.rend/BUDGET).toFixed(1)}%)`);
for(const c of CATS)console.log(`  ${c.padEnd(11)}: ${String(peak.cat[c]).padStart(6)} (${(100*peak.cat[c]/BUDGET).toFixed(1)}%)`);
console.log(`\nСРЕДНИЙ busy: RENDER=${CATS.reduce((a,c)=>a+avg[c],0)}`);
for(const c of CATS)console.log(`  ${c.padEnd(11)}: ${String(avg[c]).padStart(6)} (${(100*avg[c]/BUDGET).toFixed(1)}%)`);
