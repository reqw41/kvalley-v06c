// Проба: считает записи в shadow-диапазоны soft-VDP за игровые кадры.
// pat_shadow 0xC900-0xD0FF (2K), col_shadow 0xD400-0xDEFF (2816B).
// Печатает записей/кадр во время геймплея (движение влево).
// Использование: node shadow_write_probe.js <rom> [holdSpace=500] [moveFrames=60] [warmup=400]
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2];
const holdSpace=+(process.argv[3]||500), moveFrames=+(process.argv[4]||60), warmup=+(process.argv[5]||400);
const mode=process.argv[6]||"left";   // left|idle
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;

let active=false;
let patW=0,colW=0;               // всего записей
// пер-тайл гистограмма (tile = (addr>>3)&0xFF внутри 2K compressed)
const patTile={},colTile={};
const origWrite=memory.write.bind(memory);
memory.write=function(addr,w8,stackrq){
  origWrite(addr,w8,stackrq);
  if(!active)return;
  const a=addr&0xffff;
  if(a>=0xC900&&a<0xD100){patW++;const t=((a-0xC900)>>3)&0xFF;patTile[t]=(patTile[t]||0)+1;}
  else if(a>=0xD400&&a<0xDC00){colW++;const t=((a-0xD400)>>3)&0xFF;colTile[t]=(colTile[t]||0)+1;} // col_shadow 2K only
};

// no-key warmup: демо-FSM сам доходит до геймплея (~f700), drawBrilloGemas активен
for(let f=0;f<warmup+holdSpace;f++)v06c.oneInterrupt(true);
active=true;
for(let f=0;f<moveFrames;f++){
  if(mode==="left"){keyboard.keyDown({keyCode:37,preventDefault(){}});v06c.oneInterrupt(true);keyboard.keyUp({keyCode:37,preventDefault(){}});}
  else {v06c.oneInterrupt(true);}   // idle
}
active=false;

console.log(`ROM=${rom}  frames=${moveFrames}`);
console.log(`col_shadow writes: ${colW} total  = ${(colW/moveFrames).toFixed(1)}/кадр`);
console.log(`pat_shadow writes: ${patW} total  = ${(patW/moveFrames).toFixed(1)}/кадр`);
const gems=[0x51,0x52,0x53,0x5c];
function dump(name,h){
  const ents=Object.entries(h).map(([t,c])=>[+t,c]).sort((a,b)=>b[1]-a[1]);
  let gemSum=0;for(const g of gems)gemSum+=h[g]||0;
  console.log(`  ${name} top tiles (tile#=hex): `+ents.slice(0,12).map(([t,c])=>`${t.toString(16)}:${c}`).join(" "));
  console.log(`  ${name} GEM tiles(51,52,53,5c) writes=${gemSum} (${(gemSum/moveFrames).toFixed(1)}/кадр)`);
}
dump("col",colTile);
dump("pat",patTile);
