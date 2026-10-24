// Профиль ТОЛЬКО игровой логики: классифицирует функции игра/рантайм, выводит
// игровые подблоки с тактами/кадр. Рантайм (vec_*/rot*/рендер/звук) исключён.
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2],sym=process.argv[3];
const labels=[];
for(const line of fs.readFileSync(sym,"utf8").split("\n")){const m=line.match(/^(\S+):\s+equ\s+0?([0-9A-Fa-f]+)h?/);if(m){const a=parseInt(m[2],16);if(a>=0&&a<0x10000)labels.push([a,m[1]]);}}
labels.sort((a,b)=>a[0]-b[0]);
const addrs=labels.map(l=>l[0]);
function findLabel(pc){let lo=0,hi=addrs.length-1,r=0;while(lo<=hi){const mid=(lo+hi)>>1;if(addrs[mid]<=pc){r=mid;lo=mid+1;}else hi=mid-1;}return labels[r][1];}
// рантайм-метки (наш soft-VDP/рендер/звук/палитра) — по префиксу имени
const RT=/^(vec_|rot\d|vns|vfc|vtd|vcp|vxq|vbt|vmu|vre|vrs|vrd|vw_|WRTVRM|RDVRM|WRTVDP|WRTPSG|RDPSG|SETWR|SETRD|setVDPWrite|setFillVRAM|DEtoVRAM|fillVRAM|H_TIMI|dummyLoop|updateSound|vspt|fv[ABC]|fv_|vff|vdcp|vde|il_)/;
const isRT=lbl=>RT.test(lbl);
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const bucket=new Map();let active=false,total=0,gameTot=0,rtTot=0;
const orig=cpu.instruction.bind(cpu);
cpu.instruction=function(){const pc=cpu.pc;orig();if(!active)return;const vc=cpu.vcycles|0;const lbl=findLabel(pc);bucket.set(lbl,(bucket.get(lbl)||0)+vc);total+=vc;if(isRT(lbl))rtTot+=vc;else gameTot+=vc;};
const hold=+(process.argv[4]||900),move=+(process.argv[5]||200),warmup=+(process.argv[6]||400);
for(let f=0;f<warmup;f++)v06c.oneInterrupt(true);
for(let f=0;f<hold;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);}
keyboard.keyUp({keyCode:32,preventDefault(){}});
for(let f=0;f<30;f++)v06c.oneInterrupt(true);
active=true;
for(let f=0;f<move;f++){keyboard.keyDown({keyCode:37,preventDefault(){}});v06c.oneInterrupt(true);}
active=false;
const arr=[...bucket.entries()].filter(([l])=>!isRT(l)).sort((a,b)=>b[1]-a[1]);
console.log(`total=${(total/move).toFixed(0)}cy/кадр | ИГРА=${(gameTot/move).toFixed(0)}cy (${(gameTot/total*100).toFixed(0)}%) | РАНТАЙМ=${(rtTot/move).toFixed(0)}cy (${(rtTot/total*100).toFixed(0)}%)`);
console.log("--- ИГРОВЫЕ подблоки (cy/кадр) ---");
for(const [lbl,cy] of arr.slice(0,28)){
  console.log(`  ${(cy/move).toFixed(0).padStart(5)}cy  ${(cy/total*100).toFixed(1).padStart(4)}%  ${lbl}`);
}
