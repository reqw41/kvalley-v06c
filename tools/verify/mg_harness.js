// mg_harness.js — обвязка эмулятора vector06js для замеров демо Metal Gear
// (metalgear-v06c). Скопирована по образцу tools/verify/beam_harness.js
// (та же модель луча, тот же cyc()/run()/FRAME), но:
//  - грузит ДВА файла: metalgear.rom (в память с 0x100) и metalgear.edd
//    (квазидиск 256К, порт $10) — повторяет логику vector06js/src/main.js
//    (_eddApply): после init_from_array записать img[i] в
//    memory.bytes[memory.tobank(65536+i)] для i=0..min(len,262144).
//  - парсит СИМВОЛЫ из build/demo.lst (формат "имя = $XXXX = decimal  файл:строка"
//    в хвосте листинга zasm), а не из .sym-файла (его нет).
//  - toPlay(E) вместо toGame(E): доходит до state==ST_GAME(=1) демки MG.
"use strict";
const fs=require("fs"),vm=require("vm"),zlib=require("zlib");
const base="/Users/boris/Projects/vector06js";

function make(romPath,eddPath,lstPath){
  const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;
  g.console={log(){},debug(){},warn(){},error(){},info(){}};
  const ctx=vm.createContext(g);
  for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
    vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),
        floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
  const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},
        v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
  const W=576,H=288;
  v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;
  const img=new Uint8Array(fs.readFileSync(romPath));
  memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
  // --- квазидиск: ПОСЛЕ init_from_array (тот зануляет весь memory.bytes) ---
  let eddLoaded=0,eddBytes=0;
  if(eddPath){
    const edd=new Uint8Array(fs.readFileSync(eddPath));
    eddBytes=edd.length;
    const n=Math.min(edd.length,256*1024);
    for(let i=0;i<n;i++) memory.bytes[memory.tobank(65536+i)]=edd[i];
    eddLoaded=n;
  }
  cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
  // --- символы: хвост build/demo.lst, строки "имя = $XXXX = decimal  файл:строка" ---
  const L={};
  if(lstPath){
    const re=/^(\S+)\s+=\s+\$([0-9A-Fa-f]+)\s+=\s+\d+/;
    for(const l of fs.readFileSync(lstPath,"latin1").split("\n")){
      const m=l.match(re);if(m)L[m[1]]=parseInt(m[2],16);
    }
  }
  const rd=a=>memory.bytes[memory.tobank(a&0xffff)];
  const key=(c,d)=>{const e={which:c,keyCode:c,preventDefault(){},stopPropagation(){}};d?keyboard.keyDown(e):keyboard.keyUp(e);};
  const run=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
  const FRAME=59904;
  function cyc(){const f=v06c.filler;if(!f)return 0;
    let p=(f.raster_line*768+f.raster_pixel)-176; if(p<0)p+=312*768; return (p/4)|0;}
  const beamOfLo=lo=>{const r=(31-lo)&255;return (40+r)*192-44;};
  const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
  function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
  function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
  function pngFrom(u32,out){const rgb=Buffer.alloc(W*H*3);
    for(let i=0;i<W*H;i++){const c=u32[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
    const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
    const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
    fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));}
  function png(out){pngFrom(v06c.bmp,out);}
  return {ctx,memory,keyboard,cpu,v06c,io,L,rd,key,run,cyc,beamOfLo,png,pngFrom,FRAME,eddLoaded,eddBytes};
}

// Дойти до геймплея демки MG (state==ST_GAME==1). Заставка KONAMI+METAL GEAR
// занимает ~120-130 кадров до готовности принять "пробел" (ti_st==TI_READY),
// затем ~80 кадров мигания PLAY START (ps_cnt=0x50) до автоматического
// enter_game. Тайминги — см. src/demo.asm title_frame/pstart_frame.
function toPlay(E,maxFrames){
  maxFrames=maxFrames||900;
  const {run,key,rd,L}=E;
  if(L.state===undefined) throw new Error("mg_harness: в demo.lst нет символа state");
  const STG=L.ST_GAME!==undefined?L.ST_GAME:1;
  const TIR=L.TI_READY!==undefined?L.TI_READY:4;
  let f=0;
  // заставка KONAMI+METAL GEAR едет своим темпом (49 строк*2т + шлейф + wait)
  // до ti_st==TI_READY — на замеренном образе это ~500 кадров.
  for(;f<maxFrames && rd(L.ti_st)!==TIR;f++) run(1);
  // нажать и подержать "пробел" несколько кадров, чтобы гарантировать фронт
  // на границе ISR (ks_fire ловит edge через prev_fire)
  key(32,1);
  for(let i=0;i<4 && f<maxFrames;i++,f++) run(1);
  key(32,0);
  for(;f<maxFrames && rd(L.state)!==STG;f++) run(1);
  return {state:rd(L.state),frames:f};
}

module.exports={make,toPlay};
