// P2-ФИНАЛ АУДИТ: любой доступ (ЧТЕНИЕ+ЗАПИСЬ) к плану 2 (0xC000-0xDFFF) в ГЕЙМПЛЕЕ.
// Цель: p2 ПОЛНОСТЬЮ чист — 0 обращений (boot-clear исключён флагом track).
// Покрытие: ходьба вправо/влево (влево => зеркало-спрайты vnsx), лазанье по лестницам
// (mixed-тайлы => mixbuf), прыжки. Если хоть один буфер остался в p2 — поймаем.
// Использование: node audit_p2_final.js <rom>
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
// БЫЛО зашито 0x6B00 (GameStatus) и 0x6C44 (objetoCogido), эра 0x6B00/0x6C00 — по этим
// адресам сейчас лежит КОД игры. Читаем .sym по имени (путь по умолчанию — рядом с rom).
const SYMPATH=process.argv[3]||process.argv[2].replace(/\.rom$/,".sym");
const L={};for(const l of fs.readFileSync(SYMPATH,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
if(!L.GameStatus||!L.objetoCogido){console.log("нет символов GameStatus/objetoCogido в .sym");process.exit(2);}
let track=false;
// счётчики отдельно чтение/запись; карта адресов; топ PC
const wcnt=new Uint32Array(0x10000), rcnt=new Uint32Array(0x10000);
const pcHits={}; let totW=0,totR=0;
const owr=mem.write.bind(mem);
mem.write=function(a,v,s){const aa=a&0xffff; if(track&&aa>=0xC000&&aa<=0xDFFF){wcnt[aa]++;totW++;const pc=cpu.pc&0xffff;pcHits['W@'+pc.toString(16)]=(pcHits['W@'+pc.toString(16)]||0)+1;} return owr(a,v,s);};
const ord=mem.read.bind(mem);
mem.read=function(a,s){const aa=a&0xffff; if(track&&aa>=0xC000&&aa<=0xDFFF){rcnt[aa]++;totR++;const pc=cpu.pc&0xffff;pcHits['R@'+pc.toString(16)]=(pcHits['R@'+pc.toString(16)]||0)+1;} return ord(a,s);};
function run(){
  for(let f=0;f<600;f++)v06c.oneInterrupt(true);
  for(let f=0;f<1500;f++){kb.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);if(rd(L.GameStatus)===5)break;}
  kb.keyUp({keyCode:32,preventDefault(){}});
  for(let f=0;f<120;f++)v06c.oneInterrupt(true);
  track=true; // считать только записи/чтения В ГЕЙМПЛЕЕ (boot-clear исключён)
  for(let f=0;f<200;f++){kb.keyDown({keyCode:39,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:39,preventDefault(){}});} // вправо
  for(let f=0;f<200;f++){kb.keyDown({keyCode:37,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:37,preventDefault(){}});} // влево -> зеркало
  for(let f=0;f<120;f++){kb.keyDown({keyCode:38,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:38,preventDefault(){}});} // вверх -> лестницы
  mem.bytes[mem.tobank(L.objetoCogido)]=0x20;
  for(let f=0;f<200;f++){kb.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);kb.keyUp({keyCode:32,preventDefault(){}});} // прыжок/действие
}
run();
console.log(`p2 (0xC000-0xDFFF) в геймплее: ЗАПИСЕЙ=${totW}, ЧТЕНИЙ=${totR}`);
if(totW+totR===0){ console.log("✅ p2 ПОЛНОСТЬЮ ЧИСТ — 0 обращений."); }
else {
  // диапазоны затронутых адресов
  const touched=[]; for(let a=0xC000;a<=0xDFFF;a++) if(wcnt[a]||rcnt[a]) touched.push(a);
  const lo=touched[0], hi=touched[touched.length-1];
  console.log(`❌ p2 НЕ чист. Затронуто ${touched.length} адр., диапазон 0x${lo.toString(16)}-0x${hi.toString(16)}`);
  const top=Object.entries(pcHits).sort((a,b)=>b[1]-a[1]).slice(0,12);
  console.log("топ PC-обращений:", top.map(([k,v])=>`${k}:${v}`).join("  "));
}
