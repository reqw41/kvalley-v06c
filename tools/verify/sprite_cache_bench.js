// пункт 1 верификация: замер vnc_rot / суммы спрайтовых бакетов / runGame calls/кадр /
// рантайм (non-halt cy/кадр) / долгая стабильность (GS, SP, p3-ink min/max).
// Использование: node sprite_cache_bench.js <rom> <sym> [warmup=400] [holdSpace=400] [moveFrames=200]
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2], sym=process.argv[3];
const warmup=+(process.argv[4]||400), holdSpace=+(process.argv[5]||400), moveFrames=+(process.argv[6]||200);
const labels=[];
for(const line of fs.readFileSync(sym,"utf8").split("\n")){
  const m=line.match(/^(\S+):\s+equ\s+0?([0-9A-Fa-f]+)h?/);
  if(m){const a=parseInt(m[2],16);if(a>=0&&a<0x10000)labels.push([a,m[1]]);}
}
labels.sort((a,b)=>a[0]-b[0]);
const addrs=labels.map(l=>l[0]);
function findLabel(pc){let lo=0,hi=addrs.length-1,r=0;while(lo<=hi){const mid=(lo+hi)>>1;if(addrs[mid]<=pc){r=mid;lo=mid+1;}else hi=mid-1;}return labels[r][1];}
const runGameAddr=labels.find(l=>l[1]==="runGame")[0];
// GameStatus берём из .sym по имени (раньше было зашито число 0x6b00 — база переменных
// переезжала 0x6B00->0x6C00->0x7092, по старому адресу сейчас лежит код).
const gsLabel=labels.find(l=>l[1]==="GameStatus");
if(!gsLabel){console.error("GameStatus не найден в "+sym);process.exit(2);}
const GS_ADDR=gsLabel[0];
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;

const bucket=new Map();let active=false,total=0,idle=0,runGameCalls=0;
const origInstr=cpu.instruction.bind(cpu);
cpu.instruction=function(){const pc=cpu.pc;origInstr();if(!active)return;const vc=cpu.vcycles|0;total+=vc;if(cpu.last_opcode===0x76)idle+=vc;if(pc===runGameAddr)runGameCalls++;const lbl=findLabel(pc);bucket.set(lbl,(bucket.get(lbl)||0)+vc);};

for(let f=0;f<warmup;f++)v06c.oneInterrupt(true);
for(let f=0;f<holdSpace;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);}
keyboard.keyUp({keyCode:32,preventDefault(){}});
for(let f=0;f<30;f++)v06c.oneInterrupt(true);
const gs=memory.read(GS_ADDR);
// --- профиль на движении влево ---
active=true;
for(let f=0;f<moveFrames;f++){keyboard.keyDown({keyCode:37,preventDefault(){}});v06c.oneInterrupt(true);keyboard.keyUp({keyCode:37,preventDefault(){}});}
active=false;
const runtime=(total-idle)/moveFrames;
let sprSum=0,rotCy=0;for(const [lbl,cy] of bucket){if(lbl.startsWith("vnc_")||lbl.startsWith("vns_")||lbl.startsWith("vec_nsx")||lbl.startsWith("vec_nat_spr"))sprSum+=cy;if(lbl==="vnc_rot")rotCy+=cy;}
console.log(`ROM=${rom}  GS(ingame)=${gs}`);
console.log(`  vnc_rot        = ${(rotCy/moveFrames).toFixed(0)} cy/кадр (${(rotCy/total*100).toFixed(2)}% total)`);
console.log(`  спрайты(vnc/vns/nsx) = ${(sprSum/moveFrames).toFixed(0)} cy/кадр (${(sprSum/total*100).toFixed(2)}% total)`);
console.log(`  рантайм(non-halt) = ${runtime.toFixed(0)} cy/кадр`);
console.log(`  runGame/кадр    = ${(runGameCalls/moveFrames).toFixed(3)}`);

// --- долгий прогон: движение+копка 3000 кадров, GS/SP/p3-ink ---
function p3ink(){let n=0;const b=memory.bytes;if(!b)return -1;for(let a=0xE000;a<0x10000;a++){let v=b[a];while(v){n+=v&1;v>>=1;}}return n;}
let spMin=0xffff,spMax=0,gsBad=0;const inkSamples=[];
for(let f=0;f<3000;f++){
  const kc = (f%40<20)?37:(f%40<30?39:0); // влево/вправо
  const dig = (f%40>=30); // копка (Z=90)
  if(kc)keyboard.keyDown({keyCode:kc,preventDefault(){}});
  if(dig)keyboard.keyDown({keyCode:90,preventDefault(){}});
  v06c.oneInterrupt(true);
  if(kc)keyboard.keyUp({keyCode:kc,preventDefault(){}});
  if(dig)keyboard.keyUp({keyCode:90,preventDefault(){}});
  const sp=cpu.sp;if(sp<spMin)spMin=sp;if(sp>spMax)spMax=sp;
  if(memory.read(GS_ADDR)!==5)gsBad++;
  if(f>=2960)inkSamples.push(p3ink());
}
console.log(`--- long-run 3000 кадров (move+dig) ---`);
console.log(`  финал GS=${memory.read(GS_ADDR)}  SP=0x${cpu.sp.toString(16)}  SP-range=0x${spMin.toString(16)}..0x${spMax.toString(16)}  GS!=5 кадров=${gsBad}`);

// --- p3-ink стабильность стоя 30 кадров ---
const inkStand=[];for(let f=0;f<30;f++){v06c.oneInterrupt(true);inkStand.push(p3ink());}
const mn=Math.min(...inkStand),mx=Math.max(...inkStand);
console.log(`--- p3-ink стоя 30 кадров ---`);
console.log(`  min=${mn}  max=${mx}  разброс=${mx-mn}`);
