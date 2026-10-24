// level_color_probe.js — Часть 1: idx8 (кирпичи) меняется по пирамиде в геймплее.
// Поукивает piramideActual на 1/5/9/13 при fpm=1 (геймплей) и читает io.Palette[8].
// Ожидание: 0x77 золото / 0xD2 синий / 0x56 красн / 0x1C зелён (schemes 0..3).
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const rom=process.argv[2]||"/tmp/kvF.rom";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const W=576,H=288;
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const rd=a=>memory.read(a&0xffff);const wr=(a,v)=>memory.write(a&0xffff,v);
// Адреса берём из .sym по имени (раньше были зашиты числа PIRA=0x6B54/FPM=0x6B51/GS=0x6B00 —
// база переменных переезжала 0x6B00->0x6C00->0x7092, по старым адресам сейчас лежит код).
const symPath=process.argv[3]||rom.replace(/\.rom$/,".sym");
const L={};
for(const l of fs.readFileSync(symPath,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
for(const name of ["piramideActual","flagPiramideMap","GameStatus"]){
  if(L[name]===undefined){console.error(name+" не найден в "+symPath);process.exit(2);}
}
const PIRA=L.piramideActual, FPM=L.flagPiramideMap, GS=L.GameStatus;
function run(n){for(let i=0;i<n;i++)v06c.oneInterrupt(true);}
// boot -> реальный геймплей (персистентный SPACE до GS=5 & fpm нечёт)
run(400);
let reached=false;
for(let blk=0;blk<50 && !reached;blk++){
  for(let f=0;f<25;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});run(1);if(rd(GS)===5&&(rd(FPM)&1)){reached=true;break;}}
  keyboard.keyUp({keyCode:32,preventDefault(){}});run(5);
}
console.log(`геймплей достигнут=${reached} GS=${rd(GS)} fpm=${rd(FPM)} pira=${rd(PIRA)}`);
const exp={1:0x77,5:0xd2,9:0x56,13:0x1c};
const names={0x77:"золото",0xd2:"синий",0x56:"красный",0x1c:"зелёный"};
// ARGB -> raw Vector-байт %BBGGGRRR (обратно к io.commit_palette)
const raw=argb=>(((argb>>>22)&3)<<6)|(((argb>>>13)&7)<<3)|((argb>>>5)&7);
let allok=true;
for(const p of [1,5,9,13]){
  wr(PIRA,p); run(3); // дать VBlank применить палитру
  const idx8=raw(io.Palette[8]>>>0);
  const want=exp[p]; const ok=idx8===want;
  if(!ok)allok=false;
  console.log(`пирамида=${String(p).padStart(2)} fpm=${rd(FPM)} idx8=0x${idx8.toString(16).padStart(2,'0')} (${names[idx8]||'?'}) ожид=0x${want.toString(16).padStart(2,'0')} (${names[want]}) ${ok?'✓':'✗'}`);
}
console.log(`\nВЕРДИКТ Часть1: ${allok?'ВСЕ 4 схемы верны ✓':'РАСХОЖДЕНИЕ ✗'}`);
process.exit(allok?0:1);
