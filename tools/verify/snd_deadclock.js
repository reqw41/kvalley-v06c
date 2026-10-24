// СТРАХОВКА ОТ ТИШИНЫ: имитируем железо, где чтение счётчика ВИ53 не работает
// (порт 0x09 всегда отдаёт одно и то же). Музыка ОБЯЗАНА заиграть по старой схеме.
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console={log(){},debug(){},warn(){},error(){},info(){}};
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;
const img=new Uint8Array(fs.readFileSync(process.argv[2]));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const L={};for(const l of fs.readFileSync(process.argv[3],"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
const rd=a=>memory.read(a,false);
// железо-имитация: чтение канала 2 ВИ53 всегда отдаёт 0xFF (как «нет ответа шины»)
const origIn=io.input.bind(io);
io.input=function(port){ const p=port&0xFF; if(p===0x09) return 0xFF; return origIn(port); };
g.event=null;
const ev=c=>({which:c,keyCode:c,preventDefault(){},stopPropagation(){}});
const key=(c,d)=>d?keyboard.keyDown(ev(c)):keyboard.keyUp(ev(c));
const run=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
const press=(c,f=6)=>{key(c,1);run(f);key(c,0);run(4);};
let ticks=0;
v06c.check_breakpoint=function(){ if(cpu.pc===L.updateSound) ticks++; return false; };
run(400);
console.log(`после бута: vtm_have=${rd(L.vtm_have)} (0 = проверка на буте отбросила мёртвые часы)`);
// Сборка только 3 МГц: делитель коопа не зависит от ВИ53.
console.log(`vsnd_cdiv=${rd(L.vsnd_cdiv)} (ждём 3)`);
press(32); run(200); press(32); run(300);
for(let i=0;i<12 && rd(L.GameStatus)!==5;i++){ press(32); run(150); }
ticks=0; run(400);
console.log(`геймплей 400 кадров: тиков музыки ${ticks} = ${(ticks/400).toFixed(3)}/кадр, vtm_have=${rd(L.vtm_have)}`);
console.log(ticks>300 ? "РЕЗУЛЬТАТ: ОК — музыка играет и без часов" : "РЕЗУЛЬТАТ: ПРОВАЛ — тишина");
process.exit(ticks>300?0:1);
