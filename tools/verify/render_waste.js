// render_waste.js — сколько работы прохода рендера уходит на НЕПОДВИЖНЫЕ объекты.
// Идея из БК-порта King's Valley: «неподвижное не трогаем». Меряем за каждый проход
// vec_nat_sprites: сколько слотов реально перерисовано (restore/save/draw), у скольких
// из них координаты (Y,X в sprAttrib) не изменились с прошлого прохода, и сколько тактов
// стоит эта впустую сделанная работа.
// Использование: node tools/verify/render_waste.js <rom> <sym> [frames=4000]
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2],sym=process.argv[3],MAXF=+(process.argv[4]||4000);
if(!rom||!sym){console.log("usage: node render_waste.js <rom> <sym> [frames]");process.exit(2);}
const L={};for(const line of fs.readFileSync(sym,"latin1").split("\n")){const m=line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;

const NS=L["vec_nat_sprites"],REST=L["vec_su_restore"],SAVE=L["vec_su_save"],NSX=L["vec_nsx"];
// БЫЛО: fallback 0x6D36 (это sentidoProta, а НЕ sprAttrib!) и 0x6C00 (эра 0x6C00 GameStatus).
// Оба зашитых числа убраны — берём строго по имени из .sym, без подмены не тем адресом.
const SPR=L["sprAttrib"], GS=L["GameStatus"];
if(!NS||!REST||!SAVE||!SPR||!GS){console.log("нет символов");process.exit(2);}
// vec_nsx (старый блиттер) в текущем .sym отсутствует — счётчик draw/vec_nsx будет 0,
// это не адресный баг, а следствие переписанного спрайт-блиттера (см. отчёт).
const rd=a=>memory.read(a,false);

// 21 слот x 4 байта атрибутов (Y,X,pattern,color) — снимок для детекта «не двигался»
const SLOTS=21;
function snapshot(){ const s=[]; for(let i=0;i<SLOTS;i++){ const b=SPR+i*4; s.push((rd(b)<<8)|rd(b+1)); } return s; }

let f=0, inPass=false, retAddr=-1, passStartB=0;
let prev=null;
const passes=[];
let cur=null;

v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===NS && !inPass){
    inPass=true; retAddr=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8); passStartB=v06c.between;
    cur={rest:0,save:0,draw:0,gs:rd(GS),snap:snapshot()};
    return false;
  }
  if(inPass){
    if(pc===retAddr){
      inPass=false;
      cur.ticks = v06c.between>=passStartB ? v06c.between-passStartB : null;
      if(prev){
        let moved=0; for(let i=0;i<SLOTS;i++) if(cur.snap[i]!==prev[i]) moved++;
        cur.moved=moved;
      }
      prev=cur.snap;
      passes.push(cur); cur=null;
      return false;
    }
    if(pc===REST)cur.rest++; else if(pc===SAVE)cur.save++; else if(pc===NSX)cur.draw++;
  }
  return false;
};
while(f<MAXF){ v06c.oneInterrupt(true); f++; }

const play=passes.filter(p=>p.gs===5 && p.ticks!==null && p.moved!==undefined);
const st=a=>{ const s=[...a].sort((x,y)=>x-y); if(!s.length)return"нет";
  const sum=s.reduce((x,y)=>x+y,0);
  return `n=${s.length} сред=${(sum/s.length).toFixed(1)} med=${s[s.length>>1]} p90=${s[Math.floor(s.length*0.9)]} max=${s[s.length-1]}`; };
console.log("проходов в игре (GS=5):", play.length);
console.log("вызовов restore за проход:", st(play.map(p=>p.rest)));
console.log("вызовов save за проход:   ", st(play.map(p=>p.save)));
console.log("вызовов draw(vec_nsx):    ", st(play.map(p=>p.draw)));
console.log("СЛОТОВ РЕАЛЬНО СДВИНУЛОСЬ:", st(play.map(p=>p.moved)));
console.log("тактов на проход:         ", st(play.map(p=>p.ticks)));
const tot=play.reduce((a,p)=>a+p.rest,0), mov=play.reduce((a,p)=>a+p.moved,0);
console.log(`\nИТОГО: перерисовано слотов ${tot}, из них реально двигались ${mov} (${(100*mov/Math.max(tot,1)).toFixed(1)}%)`);
console.log(`=> впустую ~${(100*(1-mov/Math.max(tot,1))).toFixed(1)}% работы прохода`);
