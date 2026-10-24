// Тест на трейлы (XOR-симметрия кэша): двигаем героя влево-вправо, затем ОСТАНАВЛИВАЕМ
// и держим неподвижно 200 кадров. Если XOR-симметрия нарушена — erase не стирает draw
// точно -> в plane 3 копится мусор (p3-ink дрейфует вверх). Стабильный p3-ink = нет трейлов.
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2];
// Адрес GameStatus берём из .sym по имени (база переменных переезжала 0x6B00->0x6C00->0x7092,
// раньше тут было зашито число 0x6B00 — по этому адресу сейчас лежит код, а не переменная).
const symPath=process.argv[3]||rom.replace(/\.rom$/,".sym");
const L={};
for(const l of fs.readFileSync(symPath,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
if(L.GameStatus===undefined){console.error("GameStatus не найден в "+symPath);process.exit(2);}
const GS_ADDR=L.GameStatus;
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
function p3ink(){let n=0;const b=memory.bytes;for(let a=0xE000;a<0x10000;a++){let v=b[a];while(v){n+=v&1;v>>=1;}}return n;}
function key(kc,dn){if(dn)keyboard.keyDown({keyCode:kc,preventDefault(){}});else keyboard.keyUp({keyCode:kc,preventDefault(){}});}
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
for(let f=0;f<400;f++){key(32,1);v06c.oneInterrupt(true);}key(32,0);
for(let f=0;f<30;f++)v06c.oneInterrupt(true);
// фаза движения: влево-вправо 300 кадров
for(let f=0;f<300;f++){const kc=(f%60<30)?37:39;key(kc,1);v06c.oneInterrupt(true);key(kc,0);}
// фаза покоя: держим неподвижно 200 кадров, следим за дрейфом p3-ink
const samples=[];
for(let f=0;f<200;f++){v06c.oneInterrupt(true);samples.push(p3ink());}
const first50=samples.slice(0,50),last50=samples.slice(150);
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
const mn=Math.min(...samples),mx=Math.max(...samples);
console.log(`ROM=${rom}  GS=${memory.read(GS_ADDR)}`);
console.log(`  покой 200 кадров: p3-ink min=${mn} max=${mx} разброс=${mx-mn}`);
console.log(`  дрейф: avg(первые50)=${avg(first50).toFixed(0)} avg(последние50)=${avg(last50).toFixed(0)} delta=${(avg(last50)-avg(first50)).toFixed(1)}`);
console.log(`  ${(mx-mn)<400 && Math.abs(avg(last50)-avg(first50))<80 ? "OK: p3-ink стабилен, трейлов нет":"WARN: возможен дрейф/трейлы"}`);
