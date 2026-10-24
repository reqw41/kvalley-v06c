// Считает ВЫЗОВЫ путей записи цвета/паттерна soft-VDP (ДО dedup) с разбивкой
// гем-тайл (0x51,0x52,0x53,0x5c) / не-гем. Меряет реальную CPU-нагрузку, которую
// создаёт мерцание сокровищ (игра шлёт записи, dedup их гасит, но обработка стоит).
// Использование: node gem_writepath_probe.js <rom> <sym> [holdSpace=500] [frames=60] [mode=idle]
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2],sym=process.argv[3];
const holdSpace=+(process.argv[4]||500), frames=+(process.argv[5]||60);
const mode=process.argv[6]||"idle";
const L={};for(const line of fs.readFileSync(sym,"utf8").split("\n")){const m=line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const gems=new Set([0x51,0x52,0x53,0x5c]);
const P={WRTVRM:L.WRTVRM,vec_fill_col:L.vec_fill_col,vw_wcol:L.vw_wcol,vw_colw:L.vw_colw};
const cnt={};for(const k in P)cnt[k]={gem:0,other:0};
const hist={vec_fill_col:{},vw_wcol:{},vw_colw:{},WRTVRM:{}};
let active=false;
const rd=a=>memory.read(a,false);
const H8=()=>cpu.regs[4],Lr=()=>cpu.regs[5],A8=()=>cpu.regs[7];
function ptrTile(){const p=(rd(L.vec_vdp_ptr)|(rd(L.vec_vdp_ptr+1)<<8))&0x3FFF;return (p>>3)&0xFF;}
const origInstr=cpu.instruction.bind(cpu);
cpu.instruction=function(){const pc=cpu.pc;origInstr();if(!active)return;
  if(pc===P.WRTVRM){const h=H8();if((h&0x3F)<0x18){const t=(((h<<8)|Lr())>>3)&0xFF;cnt.WRTVRM[gems.has(t)?"gem":"other"]++;hist.WRTVRM[t]=(hist.WRTVRM[t]||0)+1;}}
  else if(pc===P.vec_fill_col){const t=ptrTile();cnt.vec_fill_col[gems.has(t)?"gem":"other"]++;hist.vec_fill_col[t]=(hist.vec_fill_col[t]||0)+1;}
  else if(pc===P.vw_wcol){const t=(((H8()<<8)|Lr())>>3)&0xFF;cnt.vw_wcol[gems.has(t)?"gem":"other"]++;hist.vw_wcol[t]=(hist.vw_wcol[t]||0)+1;}
  else if(pc===P.vw_colw){const t=(((H8()<<8)|Lr())>>3)&0xFF;cnt.vw_colw[gems.has(t)?"gem":"other"]++;hist.vw_colw[t]=(hist.vw_colw[t]||0)+1;}
};
// holdSpace = frames of no-key warmup to let the demo FSM reach gameplay (~700+)
for(let f=0;f<holdSpace;f++)v06c.oneInterrupt(true);
active=true;
for(let f=0;f<frames;f++){if(mode==="left"){keyboard.keyDown({keyCode:37,preventDefault(){}});v06c.oneInterrupt(true);keyboard.keyUp({keyCode:37,preventDefault(){}});}else v06c.oneInterrupt(true);}
active=false;
console.log(`ROM=${rom} frames=${frames} mode=${mode}`);
for(const k in P){const c=cnt[k];console.log(`  ${k.padEnd(14)} gem=${c.gem} (${(c.gem/frames).toFixed(1)}/f)  other=${c.other} (${(c.other/frames).toFixed(1)}/f)`);}
for(const k of["vec_fill_col","vw_wcol"]){const e=Object.entries(hist[k]).map(([t,c])=>[+t,c]).sort((a,b)=>b[1]-a[1]);console.log(`  ${k} tiles(hex:cnt): `+e.slice(0,16).map(([t,c])=>`${t.toString(16)}:${c}`).join(" "));}
