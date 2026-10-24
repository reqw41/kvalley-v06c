// A/B: walk hero; one run triggers a real item pickup (loadAnimation) mid-walk,
// the other doesn't. Diff the final plane-3 (sprite plane) to expose XOR residue.
// Usage: node pickup_artifact.js <rom> [objhex=20]
const fs=require("fs"),vm=require("vm"),zlib=require("zlib");
const base="/Users/boris/Projects/vector06js";
const rom=process.argv[2]||"/tmp/kvp.rom", objV=parseInt(process.argv[3]||"20",16);
const SYM={};for(const l of fs.readFileSync(process.argv[4]||"/tmp/kvp.sym","utf8").split("\n")){const m=l.match(/^(\w+):\s*equ\s*([0-9A-Fa-f]+)h/);if(m)SYM[m[1]]=parseInt(m[2],16);}
function mk(){
  const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;const ctx=vm.createContext(g);
  for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
  const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
  v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
  const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
  cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
  return {memory,keyboard,cpu,v06c,rd:a=>memory.bytes[memory.tobank(a)],wr:(a,v)=>memory.bytes[memory.tobank(a)]=v};
}
function png(v06c,outPath){const W=576,H=288,rgb=Buffer.alloc(W*H*3),bmp=v06c.bmp;
  for(let i=0;i<W*H;i++){const c=bmp[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
  const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
  function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
  function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
  const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
  fs.writeFileSync(outPath,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));}
function callSub(m,addr){const SENT=0x0038;const sp0=m.cpu.sp;
  m.cpu.sp=(m.cpu.sp-2)&0xffff;m.wr(m.cpu.sp,SENT&0xff);m.wr(m.cpu.sp+1,(SENT>>8)&0xff);
  const savePC=m.cpu.pc;m.cpu.pc=addr;const iff=m.cpu.iff;m.cpu.iff=false;
  for(let n=0;n<2000000;n++){m.cpu.instruction();if(m.cpu.pc===SENT&&m.cpu.sp>=sp0)break;}
  m.cpu.pc=savePC;m.cpu.iff=iff;}
function toGame(m){for(let f=0;f<400;f++)m.v06c.oneInterrupt(true);
  for(let f=0;f<1000 && m.rd(SYM.GameStatus)!==5;f++){m.keyboard.keyDown({keyCode:32,preventDefault(){}});m.v06c.oneInterrupt(true);}
  m.keyboard.keyUp({keyCode:32,preventDefault(){}});for(let f=0;f<60;f++)m.v06c.oneInterrupt(true);}
function walk(m,kc,n){for(let f=0;f<n;f++){m.keyboard.keyDown({keyCode:kc,preventDefault(){}});m.v06c.oneInterrupt(true);}m.keyboard.keyUp({keyCode:kc,preventDefault(){}});}
// plane-3 snapshot (sprite plane) for diff
function plane3(m){const b=Buffer.alloc(0x2000);for(let a=0;a<0x2000;a++)b[a]=m.rd(0xE000+a);return b;}

// Run A: pickup mid-walk
const A=mk();toGame(A);
walk(A,37,4);                          // walk left, hero drawn & moving
A.cpu.set_a(objV);                     // A = item to grab (pico/knife)
callSub(A,SYM.cogeObjeto);             // REAL pickup path: cogeObjeto -> (flush) -> loadAnimation
walk(A,37,1); png(A.v06c,"/tmp/art_A_step1.png"); const a1=plane3(A);
walk(A,37,1); png(A.v06c,"/tmp/art_A_step2.png"); const a2=plane3(A);
walk(A,37,16); for(let f=0;f<6;f++)A.v06c.oneInterrupt(true); png(A.v06c,"/tmp/art_A_final.png"); const af=plane3(A);

// Run B: same walk, NO pickup (control)
const B=mk();toGame(B);
walk(B,37,4);
walk(B,37,1); const b1=plane3(B);
walk(B,37,1); const b2=plane3(B);
walk(B,37,16); for(let f=0;f<6;f++)B.v06c.oneInterrupt(true); png(B.v06c,"/tmp/art_B_final.png"); const bf=plane3(B);

function diffcount(x,y){let n=0;for(let i=0;i<x.length;i++)if(x[i]!==y[i])n++;return n;}
console.log("plane3 diff A-vs-B step1:",diffcount(a1,b1),"bytes  step2:",diffcount(a2,b2),"final:",diffcount(af,bf));
// residue = plane3 bytes set in A-final but the hero has moved away.
// locate garbage columns: bytes nonzero in A-final that differ from B-final
let cols=new Set();for(let a=0;a<0x2000;a++){if(af[a]&&af[a]!==bf[a]){const col=(a>>8);const row=(a&0xff);cols.add(col+","+(row));}}
console.log("A-final: hero at ProtaX=",A.rd(SYM.ProtaY+2)," B-final ProtaX=",B.rd(SYM.ProtaY+2));
function dumpSAT(m){let s="";for(let i=0;i<14;i++){const o=SYM.sprAttrib+i*4;s+=`#${i}[Y${m.rd(o)} X${m.rd(o+1)} p${m.rd(o+2)}] `;}return s;}
console.log("A SAT:",dumpSAT(A));
console.log("B SAT:",dumpSAT(B));
// where do diffs land? report byte columns (col=byte>>8 => screen x half)
let colset={};for(let a=0;a<0x2000;a++){if((af[a]^bf[a])){const col=a>>8;colset[col]=(colset[col]||0)+1;}}
console.log("diff plane3 by column(hi):",JSON.stringify(colset));
// diff image: red where A-final bmp differs from B-final bmp
(function(){const W=576,H=288,a=A.v06c.bmp,b=B.v06c.bmp,rgb=Buffer.alloc(W*H*3);
 for(let i=0;i<W*H;i++){const c=b[i]>>>0;let r=c&255,g=(c>>8)&255,bl=(c>>16)&255;
   if((a[i]>>>0)!==(b[i]>>>0)){r=255;g=0;bl=0;} rgb[i*3]=r;rgb[i*3+1]=g;rgb[i*3+2]=bl;}
 const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
 function crc(x){let c=0xffffffff;for(let i=0;i<x.length;i++)c=crcT[(c^x[i])&0xff]^(c>>>8);return c^0xffffffff;}
 function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
 const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
 fs.writeFileSync("/tmp/art_diff.png",Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
 console.log("diff image -> /tmp/art_diff.png");})();
// sprite-plane (plane3) only, 256x256, standard mapping (like render_pickup.js)
function p3png(buf,outPath,mark){const W=256,Hh=256,rgb=Buffer.alloc(W*Hh*3);
  for(let y=0;y<Hh;y++)for(let x=0;x<W;x++){const off=(x>>3)*256+y,bit=7-(x&7);
    const v=(buf[off]>>bit)&1;const yy=Hh-1-y,o=(yy*W+x)*3;
    let r=v?255:0,g=v?255:0,b=v?255:0;
    if(mark&&mark[off]!==undefined&&((buf[off]^mark[off])>>bit&1)){r=255;g=0;b=0;}
    rgb[o]=r;rgb[o+1]=g;rgb[o+2]=b;}
  const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
  function crc(x){let c=0xffffffff;for(let i=0;i<x.length;i++)c=crcT[(c^x[i])&0xff]^(c>>>8);return c^0xffffffff;}
  function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
  const raw=Buffer.alloc(Hh*(W*3+1));for(let y=0;y<Hh;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(Hh,4);ihdr[8]=8;ihdr[9]=2;
  fs.writeFileSync(outPath,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));}
p3png(af,"/tmp/p3_A.png");
p3png(bf,"/tmp/p3_B.png");
p3png(af,"/tmp/p3_A_diff.png",bf); // red where A differs from B
console.log("plane3 pngs -> /tmp/p3_A.png /tmp/p3_B.png /tmp/p3_A_diff.png");
