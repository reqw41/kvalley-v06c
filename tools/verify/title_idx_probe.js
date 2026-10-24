// title_idx_probe.js — гистограмма палитр-idx в области логотипа KING'S VALLEY на титре.
// Строит idx=(p0<<3)|(p1<<2)|(p2<<1)|p3 по framebuffer-плоскостям, считает распределение
// по строкам (для оценки вертикального градиента) и общий гистограмм idx.
// Usage: node title_idx_probe.js <rom> [frame=140]
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2], FR=+(process.argv[3]||140);
// Адрес GameStatus берём из .sym по имени (база переменных переезжала 0x6B00->0x6C00->0x7092,
// раньше тут было зашито число 0x6B00 — сейчас по этому адресу лежит код, а не переменная).
const symPath=process.argv[4]||rom.replace(/\.rom$/,".sym");
const L={};
for(const l of fs.readFileSync(symPath,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
if(L.GameStatus===undefined){console.error("GameStatus не найден в "+symPath);process.exit(2);}
const GS_ADDR=L.GameStatus;
const W=576,H=288;
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
for(let f=0;f<FR;f++)v06c.oneInterrupt(true);
const GS=memory.read(GS_ADDR);
// Плоскости: p0 hi 0x80, p1 0xA0, p2 0xC0, p3 0xE0. Адрес: hi=plane_hi + col; low=255-row? В KV low=E=255-row*8..
// Проще: читаем через display-bmp idx? Нет — нам нужен palette-idx. Считаем из плоскостей RAM.
// Vector fb: байт (hi,lo) -> hi=0x80|(col? ) ... используем прямой скан RAM по 4 планам одинаковой геометрии.
// col 0..47 (X/12? нет: 256px/8=32 байта? Вектор 256 wide -> но экран 512? Здесь 576. Используем 32 байта/строку по 0x20 hi-step? )
// Надёжнее: собрать palette-idx покадрово из v06c.bmp сравнением с io.Palette.
const pal=io.Palette||io.palette||[];
function nearestIdx(c){ // c=0xRRGGBB from bmp -> find palette slot
  let bi=-1,bd=1e9; const r=c&255,gg=(c>>8)&255,b=(c>>16)&255;
  for(let i=0;i<16;i++){const p=pal[i]>>>0;const pr=p&255,pg=(p>>8)&255,pb=(p>>16)&255;const d=(r-pr)**2+(gg-pg)**2+(b-pb)**2;if(d<bd){bd=d;bi=i;}}
  return bi;
}
// область логотипа примерно y 40..100, x 150..430 (из рендера)
const rows={};const hist={};
for(let y=30;y<115;y++){for(let x=140;x<440;x++){const c=v06c.bmp[y*W+x]>>>0;if((c&0xffffff)===0)continue;const idx=nearestIdx(c);hist[idx]=(hist[idx]||0)+1;(rows[y]=rows[y]||{})[idx]=(rows[y][idx]||0)+1;}}
console.log("GS=",GS,"frame=",FR);
console.log("Palette (idx: RGB hex):");
for(let i=0;i<16;i++){const p=pal[i]>>>0;console.log("  idx",i,":",("00000"+((p&0xffffff)>>>0).toString(16)).slice(-6));}
console.log("\nГистограмма idx (непустые пиксели логотипа):");
Object.keys(hist).sort((a,b)=>hist[b]-hist[a]).forEach(k=>console.log("  idx",k,":",hist[k]));
console.log("\nДоминантный idx по строкам (вертикальный градиент):");
for(let y=30;y<115;y++){const r=rows[y];if(!r)continue;const dom=Object.keys(r).sort((a,b)=>r[b]-r[a])[0];const tot=Object.values(r).reduce((a,b)=>a+b,0);if(tot>4)console.log("  y",y,"dom idx",dom,"("+tot+"px)");}
