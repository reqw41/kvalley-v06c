// edge_clip_visual.js — визуализация X-клипа блиттера: рисует солид-спрайт у ПРАВОГО края
// (как мумия у верх-права, уходящая вправо) через vec_nsx и дампит плоскость 3 (0xE000)
// как 256x256 PNG. БАГ: фрагмент появляется и слева (wrap). ФИКС: только у правого края.
// Использование: node tools/verify/edge_clip_visual.js <rom> <sym> <out.png>
"use strict";
const fs=require("fs"),vm=require("vm"),zlib=require("zlib");
const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const ROM=process.argv[2],SYM=process.argv[3],OUT=process.argv[4]||"/tmp/edge.png";
const symtxt=fs.readFileSync(SYM,"utf8");
function sym(n){const m=symtxt.match(new RegExp("^"+n+":\\s*equ\\s*0*([0-9A-Fa-f]+)h","m"));if(!m)throw new Error("нет "+n);return parseInt(m[1],16);}
const vec_nsx=sym("vec_nsx"),vnc_pbase=sym("vnc_pbase"),vec_spr_buf=sym("vec_spr_buf");
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(ROM));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
function rd(a){return memory.bytes[memory.tobank(a)];}
function wr(a,v){memory.bytes[memory.tobank(a)]=v&0xff;}
for(let f=0;f<400;f++)v06c.oneInterrupt(true);

const TESTPAT=0x04, off=(TESTPAT&0xFC)*8;
for(let i=0;i<32;i++)wr(vec_spr_buf+off+i,0xFF);   // солид 16x16
// очистить плоскость3
for(let a=0xE000;a<0x10000;a++)wr(a,0);
function draw(Y,X){
  const S=0x7F00; wr(S,Y);wr(S+1,X);wr(S+2,TESTPAT);wr(S+3,0); wr(vnc_pbase,0xE0);
  const SENT=0x0001; cpu.sp=(cpu.sp-2)&0xffff;
  memory.bytes[memory.tobank(cpu.sp)]=SENT&0xff; memory.bytes[memory.tobank((cpu.sp+1)&0xffff)]=(SENT>>8)&0xff;
  cpu.set_rp(4,S); cpu.pc=vec_nsx; let gd=0;
  while(cpu.pc!==SENT&&gd++<200000)cpu.instruction();
}
// мумия у верхнего-правого края, «след» из нескольких X к самому краю
draw(0x18,0xE8); draw(0x18,0xF0); draw(0x18,0xF8); draw(0x18,0xFC);

// плоскость3 -> 256x256 (bit7 = левый пиксель в байте). hi=0xE0+col(0..31), lo=255-Y.
const W=256,Hh=256, rgb=Buffer.alloc(W*Hh*3);
for(let Y=0;Y<256;Y++){
  const lo=(255-Y)&0xff;
  for(let col=0;col<32;col++){
    const byte=rd(0xE000+col*0x100+lo);
    for(let b=0;b<8;b++){
      const on=(byte>>(7-b))&1;
      const px=col*8+b, idx=(Y*W+px)*3;
      const v=on?255:0; rgb[idx]=v; rgb[idx+1]=v; rgb[idx+2]=on?60:0; // спрайт бело-красноват
    }
  }
}
// сетка правого края (столбец 248 = граница X=255): тонкая метка
for(let Y=0;Y<256;Y++){ const idx=(Y*W+255)*3; rgb[idx]=0;rgb[idx+1]=120;rgb[idx+2]=0; }
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
const raw=Buffer.alloc(Hh*(W*3+1));for(let y=0;y<Hh;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(Hh,4);ihdr[8]=8;ihdr[9]=2;
fs.writeFileSync(OUT,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
// текстовая сводка занятых столбцов у Y=0x18
const cols=[];for(let col=0;col<32;col++){let any=0;for(let r=0;r<16;r++)any|=rd(0xE000+col*0x100+((255-0x18-r)&0xff));if(any)cols.push(col);}
console.log(OUT,"-> занятые col у Y=0x18:",JSON.stringify(cols),cols.some(c=>c<=3)?"WRAP(левый край есть)":"чисто(без wrap)");
