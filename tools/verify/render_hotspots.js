// render_hotspots.js — куда уходят такты ВНУТРИ прохода vec_nat_sprites.
// PC-гистограмма, сгруппированная по ближайшей метке из .sym. Отвечает на вопрос:
// блит это (restore/save/draw) или логика выбора слотов (change detect, propagation).
// Использование: node tools/verify/render_hotspots.js <rom> <sym> [frames=3000]
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2],sym=process.argv[3],MAXF=+(process.argv[4]||3000);
const L={},arr=[];
for(const line of fs.readFileSync(sym,"latin1").split("\n")){const m=line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m){L[m[1]]=parseInt(m[2],16);arr.push([parseInt(m[2],16),m[1]]);}}
arr.sort((a,b)=>a[0]-b[0]);
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const NS=L["vec_nat_sprites"],GS=L["GameStatus"];
function labelOf(pc){ let lo=0,hi=arr.length-1,best="?";
  while(lo<=hi){const m=(lo+hi)>>1; if(arr[m][0]<=pc){best=arr[m][1];lo=m+1;} else hi=m-1;} return best; }
let f=0,inPass=false,retAddr=-1;
const hist={}; let total=0;
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===NS&&!inPass){inPass=true;retAddr=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);return false;}
  if(inPass){
    if(pc===retAddr){inPass=false;return false;}
    if(memory.read(GS,false)===5){ const l=labelOf(pc); hist[l]=(hist[l]||0)+1; total++; }
  }
  return false;
};
while(f<MAXF){v06c.oneInterrupt(true);f++;}
const top=Object.entries(hist).sort((a,b)=>b[1]-a[1]).slice(0,18);
console.log("инструкций внутри прохода (GS=5):",total);
for(const [l,n] of top) console.log(`  ${(100*n/total).toFixed(1).padStart(5)}%  ${l}`);
