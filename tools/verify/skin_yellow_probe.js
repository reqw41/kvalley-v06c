// skin_yellow_probe.js — диагностика жёлтой кожи героя на уровне 2 после карты.
// Читает: байт диспетчера vec_brillo_pal (0x3A=база / 0xC3=патч jp vbp_map),
// colorPiramidMap, flagPiramideMap, GameStatus, io.Palette[1] (кожа idx1).
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const rom=process.argv[2]||"/tmp/kvC.rom";
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
const rd=a=>memory.read(a&0xffff);
// Адреса берём из .sym по имени (раньше были зашиты числа BRILLO/CPM/FPM/GS/SUB — база переменных
// переезжала 0x6B00->0x6C00->0x7092, по старым адресам сейчас лежит код. BRILLO — адрес рутины
// vec_brillo_pal, тоже сместился вместе с кодом; CPM — colorPiramidMap (проверено по .sym точное имя)).
const symPath=process.argv[3]||rom.replace(/\.rom$/,".sym");
const L={};
for(const l of fs.readFileSync(symPath,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
for(const name of ["vec_brillo_pal","colorPiramidMap","flagPiramideMap","GameStatus","subStatus"]){
  if(L[name]===undefined){console.error(name+" не найден в "+symPath);process.exit(2);}
}
const BRILLO=L.vec_brillo_pal, CPM=L.colorPiramidMap, FPM=L.flagPiramideMap, GS=L.GameStatus, SUB=L.subStatus;
const wr=(a,v)=>memory.write(a&0xffff,v);
function run(n){for(let i=0;i<n;i++)v06c.oneInterrupt(true);}
function snap(t){const d=rd(BRILLO);console.log(`${t.padEnd(22)} disp=0x${d.toString(16)}(${d===0x3a?'база':d===0xc3?'ПАТЧ':'?'}) GS=${rd(GS)} fpm=${rd(FPM)} cpm=${rd(CPM)} idx1кожа=0x${(io.Palette[1]>>>0).toString(16).slice(-4)} idx2одежда=0x${(io.Palette[2]>>>0).toString(16).slice(-4)}`);}

// boot -> menu -> реальный геймплей (персистентный SPACE до GS=5 & fpm нечёт)
run(400);
let reached=false;
for(let blk=0;blk<50 && !reached;blk++){
  for(let f=0;f<25;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});run(1);if(rd(GS)===5&&(rd(FPM)&1)){reached=true;break;}}
  keyboard.keyUp({keyCode:32,preventDefault(){}});run(5);
}
snap("уровень1 геймплей");
// natural stageClear -> карта -> уровень2
wr(GS,8); wr(SUB,0); run(1); snap("poke GS=8");
let onmap=false, prevd=-1, prev1=-1, prev2=-1;
for(let f=0;f<650;f++){ run(1);
  const d=rd(BRILLO), p1=io.Palette[1]>>>0, p2=io.Palette[2]>>>0;
  if(d!==prevd||p1!==prev1||p2!==prev2){ snap(`f${f}`); prevd=d;prev1=p1;prev2=p2; }
  if(rd(FPM)===2)onmap=true; if(onmap&&rd(FPM)!==2&&rd(GS)===5&&d===0x3a)break;
}
run(150); snap("уровень2 (после карты)");
run(120); snap("уровень2 +120");
const c=io.Palette[1]>>>0, yellow=((c>>13)&7)>=3 && ((c>>5)&7)<3; // G высокий, B низкий => жёлтый
console.log(`\nВЕРДИКТ: idx1(кожа) ур.2 = 0x${c.toString(16)} => ${yellow?'ЖЁЛТАЯ ✗ (баг воспроизведён)':'красная ✓'}; диспетчер=${rd(BRILLO)===0xc3?'ПАТЧ остался ✗':'база ✓'}; попали на карту(fpm=2)=${onmap}`);
