// Probe: boot ROM, hold space, log GameStatus/flagPiramideMap over time.
// Usage: node map_probe.js <rom> [sym]  (sym по умолчанию = <rom>.sym)
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2];
// АДРЕСА ПЕРЕЕЗЖАЛИ (0x6B00 -> 0x6C00 -> 0x7092): читаем их из .sym по имени, а не зашитыми числами.
const symPath=process.argv[3]||rom.replace(/\.rom$/i,".sym");
const S={};for(const l of fs.readFileSync(symPath,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)S[m[1]]=parseInt(m[2],16);}
function need(name){if(!(name in S)){console.error(`нет символа "${name}" в ${symPath}`);process.exit(2);}return S[name];}
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const GS=need("GameStatus"),SUB=need("subStatus"),FPM=need("flagPiramideMap"),VIVO=need("flagVivo");
const rd=a=>memory.read(a);
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
console.log("after boot 400:",rd(GS),rd(SUB),"fpm",rd(FPM));
for(let blk=0;blk<40;blk++){
  for(let f=0;f<25;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);}
  keyboard.keyUp({keyCode:32,preventDefault(){}});
  for(let f=0;f<5;f++)v06c.oneInterrupt(true);
  console.log("blk",blk,"GS",rd(GS),"SUB",rd(SUB),"fpm",rd(FPM),"vivo",rd(VIVO));
}
