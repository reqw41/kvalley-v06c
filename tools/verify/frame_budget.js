// Замер бюджета кадра (idle-метод): доля не-halt циклов = «работа».
// Метод: за каждый кадр суммируем vcycles всех инструкций (total) и отдельно
// vcycles, когда исполняемый opcode == 0x76 (halt = истинный простой). Работа =
// (total-idle)/total. Если работа→100%, ISR обрубает рендер посреди кадра.
// Использование: node tools/verify/frame_budget.js <rom> [holdSpace=400] [moveFrames=200] [warmup=400]
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2]||"/tmp/kvr3.rom";
const holdSpace=+(process.argv[3]||400), moveFrames=+(process.argv[4]||200), warmup=+(process.argv[5]||400);
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;

// --- инструментация: перехват instruction() для учёта idle-циклов ---
let frameTotal=0, frameIdle=0;
const origInstr=cpu.instruction.bind(cpu);
cpu.instruction=function(){origInstr();const vc=cpu.vcycles|0;frameTotal+=vc;if(cpu.last_opcode===0x76)frameIdle+=vc;};

function stat(a){const n=a.length,mean=a.reduce((s,x)=>s+x,0)/n;const sd=Math.sqrt(a.reduce((s,x)=>s+(x-mean)*(x-mean),0)/n);const mx=Math.max(...a),mn=Math.min(...a);return{mean,sd,mx,mn,n};}
const samples=[];
function measure(label,frames,keyDown){
  const w=[];
  for(let f=0;f<frames;f++){
    frameTotal=0;frameIdle=0;
    if(keyDown!==null)keyboard.keyDown({keyCode:keyDown,preventDefault(){}});
    v06c.oneInterrupt(true);
    if(keyDown!==null)keyboard.keyUp({keyCode:keyDown,preventDefault(){}});
    const work=frameTotal>0?(frameTotal-frameIdle)/frameTotal:0;
    w.push(work*100);
    samples.push({label,work:work*100,total:frameTotal,idle:frameIdle});
  }
  const s=stat(w);
  console.log(`${label.padEnd(14)} work%  avg=${s.mean.toFixed(1)}  peak=${s.mx.toFixed(1)}  min=${s.mn.toFixed(1)}  sd=${s.sd.toFixed(1)}  (n=${s.n})`);
  return s;
}
// warmup (заставка/меню) без замера
for(let f=0;f<warmup;f++)v06c.oneInterrupt(true);
// старт игры: держим пробел
for(let f=0;f<holdSpace;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);}
keyboard.keyUp({keyCode:32,preventDefault(){}});
for(let f=0;f<30;f++)v06c.oneInterrupt(true);
console.log(`ROM=${rom}`);
measure("idle(stand)",120,null);
measure("move(left)",moveFrames,37);
console.log("--- peak кадр (макс work%) ---");
const worst=samples.reduce((a,b)=>b.work>a.work?b:a);
console.log(`  ${worst.label}: work=${worst.work.toFixed(1)}%  total=${worst.total}cy  idle=${worst.idle}cy  (бюджет кадра ~59904cy)`);
