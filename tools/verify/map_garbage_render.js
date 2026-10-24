// Repro/validate: boot into gameplay (hero+mummies drawn into sprite planes
// p2/p3), then reach the inter-level PYRAMID'S MAP screen the NATURAL way
// (poke stage-clear: GameStatus=8,subStatus=0 -> game's own FSM runs
// stageClear->showMap->setupPergamino), let tickPergamino animate a few
// frames, dump PNG. Also count sprite-plane (p2/p3) non-zero bytes =
// leftover-sprite garbage metric.
//
// ПРАВКА адресов: базовый RAM переезжал 0x6B00->0x6C00->0x7092, все адреса
// переменных теперь читаются из .sym по имени (см. need()), а не зашиты.
// ПРАВКА логики: раньше скрипт напрямую форсил GameStatus=4,subStatus=1,
// waitCounter=1 — эти "сырые" значения FSM были рассчитаны под старую
// раскладку кода и на карте на самом деле никогда не бывают (естественный
// переход даёт subStatus=0). Плюс flagPiramideMap теперь СЧЁТЧИК (bit0:
// нечёт="в пирамиде", чёт="карта"), а не флаг 0/1/2 — сравнение с "===1"
// было тоже неверным. Теперь: естественный триггер stageClear (GS=8,SUB=0)
// + ожидание чётности flagPiramideMap (карта реально открылась).
//
// Usage: node map_garbage_render.js <rom> <out.png> [sym]  (sym по умолчанию = <rom>.sym)
const fs=require("fs"),vm=require("vm"),zlib=require("zlib");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2], out=process.argv[3]||"/tmp/map.png";
const symPath=process.argv[4]||rom.replace(/\.rom$/i,".sym");
const S={};for(const l of fs.readFileSync(symPath,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)S[m[1]]=parseInt(m[2],16);}
function need(name){if(!(name in S)){console.error(`нет символа "${name}" в ${symPath}`);process.exit(2);}return S[name];}
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const GS=need("GameStatus"),SUB=need("subStatus"),FPM=need("flagPiramideMap");
const rd=a=>memory.read(a), wr=(a,v)=>memory.write(a,v);
// 1) boot
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
// 2) hold space to start game, advance to gameplay (GS=5, fpm=1)
let reached=false;
for(let blk=0;blk<40 && !reached;blk++){
  for(let f=0;f<25;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);}
  keyboard.keyUp({keyCode:32,preventDefault(){}});
  for(let f=0;f<5;f++)v06c.oneInterrupt(true);
  if(rd(GS)===5 && (rd(FPM)&1)) reached=true; // flagPiramideMap=счётчик, нечёт=геймплей/в пирамиде
}
console.log("gameplay reached:",reached,"GS",rd(GS),"fpm",rd(FPM));
// 3) move hero + wait so mummies animate & sprites blit into p2/p3
for(let f=0;f<40;f++){keyboard.keyDown({keyCode:39,preventDefault(){}});v06c.oneInterrupt(true);}
keyboard.keyUp({keyCode:39,preventDefault(){}});
for(let f=0;f<40;f++)v06c.oneInterrupt(true);
// count sprite-plane garbage BEFORE forcing map (sanity: should be >0 in gameplay)
function planeNZ(){
  // 4 planes interleaved as uint32 words at mem32[0x2000 + ((col<<8)|row)].
  // Each pixel-byte word packs plane bytes; count words where p2 or p3 byte !=0.
  // p0..p3 map to the 4 bytes of the 32-bit little-endian word (see fetchPixels
  // shiftOutPixels: bits 4/13/22/31). Byte0=p0(0x8000),1=p1(0xA000),2=p2(0xC000),3=p3(0xE000).
  const m8=new Uint8Array(memory.bytes.buffer);
  let n2=0,n3=0;
  for(let w=0x2000; w<0x4000; w++){
    const bo=w*4;
    if(m8[bo+2]) n2++;
    if(m8[bo+3]) n3++;
  }
  return {n2,n3};
}
console.log("gameplay plane nz:",planeNZ());
// 4) reach PYRAMID'S MAP the natural way: poke stage-clear (GS=8,SUB=0), let the
//    game's own FSM run stageClear->showMap->setupPergamino, then wait for
//    flagPiramideMap to go EVEN (= on the map; odd = still/again inside a pyramid).
wr(GS,8); wr(SUB,0);
let onMap=false;
for(let f=0;f<50;f++){
  v06c.oneInterrupt(true);
  if(!onMap && !(rd(FPM)&1)){onMap=true;console.log(">>> right after reaching map (GS="+rd(GS)+" fpm="+rd(FPM)+"): plane",planeNZ());}
}
console.log("reached map:",onMap);
console.log("map plane nz:",planeNZ());
// 6) dump PNG
const bmp=v06c.bmp, rgb=Buffer.alloc(W*H*3);
for(let i=0;i<W*H;i++){const c=bmp[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
console.log("map render ->",out);
