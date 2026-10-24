const fs=require("fs"),vm=require("vm");const base="/Users/boris/projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
// ЗАДАЧА#37: ROM/символы берутся из build/ этого репозитория (был задеплоенный kv8c.rom
// из соседнего проекта — чужой, посторонней сборки), окно карты и GameStatus — из .sym.
// Раньше здесь были зашиты 0x7413..0x7D94 (карта) и 0x6C00 (GameStatus): после уплотнения
// нижней ОЗУ окно указывало мимо карты, а по 0x6C00 лежит КОД — счётчик всегда был 0.
// Запуск: node tools/debug/unpack_watch.js <PC_LO_hex> <PC_HI_hex> [rom]
const REPO=__dirname+"/../..";
const rom=process.argv[4]||REPO+"/build/kvalley_8c.rom";
const L={};
for(const l of fs.readFileSync(rom.replace(/\.rom$/,".sym"),"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16); }
for(const n of ["GameStatus","MapaRAMRoot","vec_ovpad"])
  if(L[n]===undefined){ console.log("нет символа "+n+" в .sym"); process.exit(2); }
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const LO=parseInt(process.argv[2],16), HI=parseInt(process.argv[3],16);
const MAP_LO=L.MapaRAMRoot, MAP_HI=L.vec_ovpad;
let log=[],cnt=0;
const ow=memory.write.bind(memory);
memory.write=function(a,w,s){ if(cpu.pc>=LO&&cpu.pc<HI&&a>=MAP_LO&&a<MAP_HI){cnt++;log.push([a,w]);} return ow(a,w,s); };
const K=(c,d)=>keyboard[d?"keyDown":"keyUp"]({keyCode:c,preventDefault(){}});
let f=0;while(f<3000&&memory.read(L.GameStatus,false)!==1){v06c.oneInterrupt(true);f++;}
K(32,1);for(let i=0;i<200;i++)v06c.oneInterrupt(true);K(32,0);
for(let i=0;i<400;i++)v06c.oneInterrupt(true);
console.log("map-записей:",cnt);
if(!cnt){ console.log("в окне PC 0x"+LO.toString(16)+"..0x"+HI.toString(16)+" записей в карту нет"); process.exit(0); }
const stream=log.map(x=>x[1]===0x12?1:0);
fs.writeFileSync("/tmp/unpack_stream.json",JSON.stringify({stream,addr0:log[0][0]}));
console.log("поток сохранён (/tmp/unpack_stream.json), первый адрес 0x"+log[0][0].toString(16));
