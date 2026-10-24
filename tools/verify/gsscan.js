// gsscan.js — headless GS(GameStatus, адрес из .sym) transition scan для KV Вектор-06Ц ROM.
// Проверяет достижимость GS5 и что демо не обрывается. Usage: node gsscan.js <rom> [frames=1400] [sym]
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2], frames=+(process.argv[3]||1400);
// Адрес GameStatus берём из .sym по имени (база переменных переезжала 0x6B00->0x6C00->0x7092,
// раньше тут было зашито число 0x6B00 — при переезде базы это указывало уже на КОД, не на переменную).
const symPath=process.argv[4]||rom.replace(/\.rom$/,".sym");
const L={};
for(const l of fs.readFileSync(symPath,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
if(L.GameStatus===undefined){console.error("GameStatus не найден в "+symPath);process.exit(2);}
const GS_ADDR=L.GameStatus;
const W=576,H=288;
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,Math.min(img.length,0x10000)),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xf000;cpu.iff=false;
let prev=-1,maxGS=-1;const trans=[];
for(let f=0;f<frames;f++){
  try{v06c.oneInterrupt(true);}catch(e){console.error("frame",f,"err",e.message);break;}
  const gs=memory.read(GS_ADDR)&0xFF;
  if(gs>maxGS)maxGS=gs;
  if(gs!==prev){trans.push(gs+"@"+f);prev=gs;}
}
console.log("GS transitions:",trans.join(" -> "));
console.log("maxGS:",maxGS,"GS5reached:",maxGS>=5?"YES":"NO");
