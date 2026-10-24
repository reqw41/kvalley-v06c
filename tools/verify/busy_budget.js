// РЕАЛЬНЫЙ busy-бюджет: сценарий где герой движется + мумии гонятся (не idle-стойка).
// Per-frame work% (idle=halt 0x76) + число активных спрайтов + детект скролла. Разбор рутин
// НА ПИКОВЫХ busy-кадрах (>=2 мумии, без скролла). node busy_budget.js <rom> <sym>
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function readSym(p){const a=[];for(const l of fs.readFileSync(p,"latin1").split("\n")){const g=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(g)a.push([parseInt(g[2],16),g[1]]);}a.sort((x,y)=>x[0]-y[0]);return a;}
// канонический парсер .sym по имени (переезд базы переменных 0x6B00->0x6C00->0x7092)
function readL(p){const L={};for(const l of fs.readFileSync(p,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}return L;}
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
const sym=readSym(process.argv[3]);
function symOf(pc){let lo=0,hi=sym.length-1,r=sym[0];while(lo<=hi){const m=(lo+hi)>>1;if(sym[m][0]<=pc){r=sym[m];lo=m+1;}else hi=m-1;}return r[1];}
const rd=a=>memory.bytes[memory.tobank(a)];
// БЫЛО зашито 0x6bc8/0x6c3a (эра 0x6B00/0x6C00) — теперь по именам из .sym.
const L=readL(process.argv[3]);
if(!L.enemyAttrib||!L.ProtaRoom){console.log("нет символов enemyAttrib/ProtaRoom в .sym");process.exit(2);}
const ENEMY=L.enemyAttrib, PROTAROOM=L.ProtaRoom, BUDGET=59904;
let frameTotal=0,frameIdle=0; const hist={}; let recording=false;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){ const pc=cpu.pc&0xffff; oI(); const vc=cpu.vcycles|0; frameTotal+=vc; if(cpu.last_opcode===0x76)frameIdle+=vc; if(recording&&cpu.last_opcode!==0x76)hist[pc]=(hist[pc]||0)+vc; };
function key(dn,c){const e={keyCode:c,preventDefault(){}};dn?keyboard.keyDown(e):keyboard.keyUp(e);}
function mummies(){let n=0;for(let i=0;i<4;i++)if(rd(ENEMY+i*4)!==0xE0)n++;return n;}
function frame(dn){ frameTotal=0;frameIdle=0; if(dn!==undefined)key(true,dn); v06c.oneInterrupt(true); if(dn!==undefined)key(false,dn); return {work:100*(frameTotal-frameIdle)/BUDGET, mum:mummies(), room:rd(PROTAROOM)}; }
// 1) в геймплей + сбор мумий: гоняем влево/вправо чтобы мумии сбежались
for(let f=0;f<420;f++)frame();
for(let f=0;f<900;f++)frame(32);       // space (старт)
key(false,32);
for(let f=0;f<400;f++)frame(37);        // влево (привлечь мумий)
// 2) busy-фаза: осцилляция (герой движется, мумии гонятся, минимум скролла)
const seq=[37,37,39,39]; let prevRoom=rd(PROTAROOM); const busy=[];
for(let f=0;f<400;f++){ const r=frame(seq[f%seq.length]); const scroll=(r.room!==prevRoom); prevRoom=r.room; busy.push({...r,scroll,f}); }
// статистика busy-кадров (>=2 мумии, без скролла)
const real=busy.filter(x=>x.mum>=2 && !x.scroll);
const allBusy=busy.filter(x=>x.mum>=1);
function stat(arr,key){const v=arr.map(x=>x[key]).sort((a,b)=>a-b);const avg=v.reduce((a,b)=>a+b,0)/v.length;return{avg,p50:v[v.length>>1],p90:v[Math.floor(v.length*0.9)],mx:v[v.length-1],n:v.length};}
console.log("=== busy-кадры (герой движется, мумии активны) ===");
console.log("активных мумий макс:", Math.max(...busy.map(x=>x.mum)), "| кадров с >=2 мумий (без скролла):", real.length);
if(real.length){const s=stat(real,"work");console.log(`work% (>=2 мумии, без скролла): avg=${s.avg.toFixed(1)} p50=${s.p50.toFixed(1)} p90=${s.p90.toFixed(1)} PEAK=${s.mx.toFixed(1)} (n=${s.n})`);}
const sAll=stat(allBusy,"work");console.log(`work% (все busy >=1 мумия): avg=${sAll.avg.toFixed(1)} p90=${sAll.p90.toFixed(1)} PEAK=${sAll.mx.toFixed(1)}`);
console.log(`скролл-кадров в busy-фазе: ${busy.filter(x=>x.scroll).length} (исключены)`);
// 3) разбор рутин на пиковом busy-кадре: перезапустим и запишем hist на самом тяжёлом non-scroll кадре
const peakF = real.length? real.reduce((a,b)=>b.work>a.work?b:a).f : busy.reduce((a,b)=>b.work>a.work?b:a).f;
console.log("\n=== разбор рутин на ПИКОВОМ busy-кадре (work-циклы, top-15) ===");
// (hist накопим прогоном ещё раз до peakF+1)
