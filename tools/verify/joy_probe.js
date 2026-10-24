// joy_probe.js — функциональный тест джойстика Вектор-06Ц (порт 0x0E) в KV.
// Переопределяет io.input(0x0E) НАПРЯМУЮ (клавиатура idle) и проверяет, что герой
// реагирует ТОЛЬКО на джойстик: sentidoProta (1=влево,2=вправо) и ProtaX меняются.
// АДРЕСА ПЕРЕЕЗЖАЛИ (0x6B00 -> 0x6C00 -> 0x7092): читаем из .sym по имени.
// Usage: node tools/verify/joy_probe.js <rom> [sym]  (sym по умолчанию = <rom>.sym)
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const rom=process.argv[2]||"/tmp/kvJ.rom";
const symPath=process.argv[3]||rom.replace(/\.rom$/i,".sym");
const S={};for(const l of fs.readFileSync(symPath,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)S[m[1]]=parseInt(m[2],16);}
function need(name){if(!(name in S)){console.error(`нет символа "${name}" в ${symPath}`);process.exit(2);}return S[name];}
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

// --- ПЕРЕОПРЕДЕЛЕНИЕ порта 0x0E (джойстик) ---
let JOY=0xFF; // active-low, idle
const origInput=io.input.bind(io);
io.input=function(port){ if(port===0x0e) return JOY; return origInput(port); };

const rd=a=>memory.read(a&0xffff);
const R={GS:need("GameStatus"),sent:need("sentidoProta"),px:need("ProtaX"),proom:need("ProtaRoom"),ctrl:need("controlPlayer"),kh:need("KeyHold")};
const FPM=need("flagPiramideMap");
function run(n){for(let i=0;i<n;i++)v06c.oneInterrupt(true);}
function snap(t){console.log(`${t.padEnd(14)} GS=${rd(R.GS)} sentido=${rd(R.sent)} ProtaX=${rd(R.px)} room=${rd(R.proom)} ctrl=${rd(R.ctrl).toString(16)} KeyHold=${rd(R.kh).toString(16)}`);}

// boot -> title
run(180);
// СТАРТ игры через кнопку джойстика FIRE1 (bit6=0 -> 0xBF) — заодно тест кнопки
snap("boot");
JOY=0xBF; run(20); JOY=0xFF; run(4);
for(let s=0;s<12;s++){ run(60); console.log(`  t+${180+24+60*(s+1)}: GS=${rd(R.GS)} sentido=${rd(R.sent)} ProtaX=${rd(R.px)} pirMap=${rd(FPM)}`); if(rd(R.GS)===5)break; }
snap("start GS");

// Форсируем игровой режим: controlPlayer bit6=1 (игрок управляет) КАЖДЫЙ кадр,
// и держим GS=5 (демо иначе сбрасывает). Клавиатура idle — движение только от JOY.
const wr=(a,v)=>memory.write(a&0xffff,v&0xff);
function runPlay(n){for(let i=0;i<n;i++){wr(R.ctrl, rd(R.ctrl)|0x40); if(rd(R.GS)!==5)wr(R.GS,5); v06c.oneInterrupt(true);}}

// --- ТЕСТ: только джойстик, клавиатура idle ---
console.log("\n-- JOY=RIGHT (0xFE) --");
const px0=rd(R.px);
JOY=0xFE; runPlay(50); snap("after RIGHT");
const sentR=rd(R.sent), pxR=rd(R.px);

console.log("\n-- JOY=LEFT (0xFD) --");
JOY=0xFD; runPlay(50); snap("after LEFT");
const sentL=rd(R.sent), pxL=rd(R.px);

console.log("\n-- JOY=idle (0xFF) --");
JOY=0xFF; runPlay(20); snap("after idle");
console.log(`ProtaX: старт=${px0} после RIGHT=${pxR} после LEFT=${pxL}`);

console.log("\n=== ВЕРДИКТ ===");
const okR = sentR===2, okL = sentL===1;
console.log(`RIGHT: sentido=${sentR} (ожид 2) ${okR?"✓":"✗"}`);
console.log(`LEFT:  sentido=${sentL} (ожид 1) ${okL?"✓":"✗"}`);
console.log(`ProtaX RIGHT=${pxR} LEFT=${pxL} (движение: ${pxR!==pxL?"есть ✓":"нет ✗"})`);
console.log(okR&&okL ? "\nДЖОЙСТИК РАБОТАЕТ ✓ (герой реагирует только на порт 0x0E, клавиатура idle)" : "\nПРОВАЛ ✗");
