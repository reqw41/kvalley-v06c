// render_span.js — сколько тактов длится проход vec_nat_sprites и в какой фазе кадра он
// стартует. Нужен, чтобы понять, почему I1 (рендер в начале ISR) не убрал разрывы:
// либо проход длиннее кадра, либо он стартует не в начале кадра.
// Использование: node tools/verify/render_span.js <rom> <sym> [frames=3000]
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2],sym=process.argv[3],MAXF=+(process.argv[4]||3000);
const L={};for(const line of fs.readFileSync(sym,"latin1").split("\n")){const m=line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;

const NS=L["vec_nat_sprites"];
if(!NS){console.log("нет символа vec_nat_sprites");process.exit(2);}
// v06c.between = такты CPU от начала текущего кадра (обнуляется в конце oneInterrupt)
let inRender=false, retAddr=-1, startF=0, startB=0;
const spans=[], phases=[], crossed=[];
let f=0;
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===NS && !inRender){ inRender=true; retAddr=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8); startF=f; startB=v06c.between; phases.push(startB); }
  else if(inRender && pc===retAddr){
    inRender=false;
    const df=f-startF;
    spans.push(df===0 ? v06c.between-startB : null);
    crossed.push(df);
  }
  return false;
};
while(f<MAXF){ v06c.oneInterrupt(true); f++; }
const st=a=>{ const s=a.filter(x=>x!==null&&x!==undefined).sort((x,y)=>x-y);
  if(!s.length) return "нет данных";
  return `n=${s.length} min=${s[0]} med=${s[s.length>>1]} p90=${s[Math.floor(s.length*0.9)]} max=${s[s.length-1]}`; };
console.log("кадров:", MAXF);
console.log("длительность прохода (только уложившиеся в кадр), тактов:", st(spans));
console.log("фаза старта прохода от начала кадра, тактов:", st(phases));
console.log("всего проходов:", crossed.length, " перетекли через границу кадра:", crossed.filter(x=>x>0).length);
console.log("макс. тактов в кадре (ориентир длины кадра):", Math.max(...phases));
