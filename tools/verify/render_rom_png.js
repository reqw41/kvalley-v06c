// Рендер ROM Вектор-06Ц (256x256, 4 плана 2+2) в PNG на заданном кадре.
// Использует ЛИНЕЙНУЮ раскладку планов (0x8000/A000/C000/E000), индекс палитры
// (pl0<<3)|(pl1<<2)|(pl2<<1)|pl3, цвет-байт Вектора R=b0-2,G=b3-5,B=b6-7.
// Применение: node render_rom_png.js <rom> <frame> <out.png>
const fs = require("fs"), zlib = require("zlib"), path = require("path");
const base = path.join(__dirname, "..", "..", "..", "vector06js");
global.window = global;
global.document = { createElement: () => fc(), getElementById: () => fc() };
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
global.requestAnimationFrame=()=>0;global.setTimeout=()=>0;global.print=()=>0;global.console.debug=()=>{};
const vm=require("vm"),ctx=vm.createContext(global);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
  vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const {Memory,IO,AY,I8253,Keyboard,I8080,Vector06c,Floppy}=ctx;
const memory=new Memory(),keyboard=new Keyboard(),timer=new I8253(),ay=new AY();
const floppy=new(Floppy().FD1793)(),io=new IO(keyboard,timer,memory,ay,floppy);io.Palette=new Array(16).fill(0);
const cpu=new I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}};
const v06c=new Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(65536);v06c.displayFrame=function(){};v06c.check_breakpoint=()=>false;v06c.dbg=null;
if(v06c.soundnik)v06c.soundnik.soundStep=function(){};

const [romPath,frameStr,outPath]=process.argv.slice(2);
const targetFrame=parseInt(frameStr||"0",10);
const img=new Uint8Array(fs.readFileSync(romPath));
memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
for(let i=0;i<3000000;i++){cpu.instruction();if(memory.bytes[memory.tobank(cpu.pc)]===0x76)break;}
for(let f=0;f<targetFrame;f++)v06c.oneInterrupt(true);

const rd=a=>memory.bytes[memory.tobank(a)];
// декод палитры: io.Palette[idx] = 32-битный ABGR (эмулятор конвертит байт Вектора)
function pal(idx){const v=io.Palette[idx]>>>0;
  return [v&0xff, (v>>8)&0xff, (v>>16)&0xff];}
const W=256,H=256;
const rgb=Buffer.alloc(W*H*3);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const off=(x>>3)*256+y, bit=7-(x&7);
  const p0=(rd(0x8000+off)>>bit)&1, p1=(rd(0xA000+off)>>bit)&1;
  const p2=(rd(0xC000+off)>>bit)&1, p3=(rd(0xE000+off)>>bit)&1;
  const idx=(p0<<3)|(p1<<2)|(p2<<1)|p3;
  const [r,g,b]=pal(idx);
  // Вектор: строка 0 внизу -> отразим по Y для нормального вида
  const yy=H-1-y, o=(yy*W+x)*3;
  rgb[o]=r;rgb[o+1]=g;rgb[o+2]=b;
}
// минимальный PNG (RGB, без фильтра)
function png(w,h,data){
  const raw=Buffer.alloc(h*(w*3+1));
  for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;data.copy(raw,y*(w*3+1)+1,y*w*3,(y+1)*w*3);}
  const idat=zlib.deflateSync(raw);
  function chunk(type,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);
    const t=Buffer.concat([Buffer.from(type),d]);const c=Buffer.alloc(4);
    c.writeUInt32BE(crc(t)>>>0);return Buffer.concat([l,t,c]);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);
  ihdr[8]=8;ihdr[9]=2;// 8bit RGB
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",idat),chunk("IEND",Buffer.alloc(0))]);
}
const crcTable=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(buf){let c=0xffffffff;for(let i=0;i<buf.length;i++)c=crcTable[(c^buf[i])&0xff]^(c>>>8);return c^0xffffffff;}
fs.writeFileSync(outPath,png(W,H,rgb));
// снимок фреймбуфера (для сверки static между кадрами)
let fbsum=0;for(let a=0x8000;a<0x10000;a++)fbsum=(fbsum+rd(a))>>>0;
let nz0=0,nz1=0,nz2=0,nz3=0;
for(let a=0;a<0x2000;a++){if(rd(0x8000+a))nz0++;if(rd(0xA000+a))nz1++;if(rd(0xC000+a))nz2++;if(rd(0xE000+a))nz3++;}
console.log(`кадр ${targetFrame}: PNG ${outPath}, fb_checksum=${fbsum}`);
console.log(`  ненулевых: план0=${nz0} план1=${nz1} (фон/лабиринт) | план2=${nz2} план3=${nz3} (спрайты/искры)`);
