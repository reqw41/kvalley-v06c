// vecrender.js — универсальный headless-рендер любого Вектор-06Ц ROM в PNG.
// Usage: node vecrender.js <rom> <out.png> [frames=300]
const fs=require("fs"),vm=require("vm"),zlib=require("zlib");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2], out=process.argv[3]||"/tmp/vec.png", frames=+(process.argv[4]||300);
const W=576,H=288;
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,Math.min(img.length,0x10000)),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xf000;cpu.iff=false;
for(let f=0;f<frames;f++){try{v06c.oneInterrupt(true);}catch(e){console.error("frame",f,"err",e.message);break;}}
// PNG
const bmp=v06c.bmp,rgb=Buffer.alloc(W*H*3);
for(let i=0;i<W*H;i++){const c=bmp[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
function crc(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;}return ~c>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(tt));return Buffer.concat([l,tt,cc]);}
const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
console.error("rendered",rom,"->",out,"("+frames+" frames)");
