// gfx_dump.js — дамп РЕАЛЬНЫХ декомпрессированных тайлов+спрайтов из работающей игры.
// Доходит до геймплея, дампит pat_maze_cell (тайлы 8x8 1bpp) и vec_spr_buf (спрайты 16x16),
// рендерит лист-PNG для опознания + пишет bitmaps в JSON.
const fs=require("fs"),vm=require("vm"),zlib=require("zlib");const base="/Users/boris/Projects/vector06js";
const rom=process.argv[2]||"/tmp/kv8c.rom";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const W=576,H=288;
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const rd=a=>memory.read(a&0xffff);
// Адреса берём из .sym по имени (раньше были зашиты числа GS=0x6B00/FPM=0x6B51 — база переменных
// переезжала 0x6B00->0x6C00->0x7092; PAT=0x6898/SPR=0x6598 — низкоRAM-адреса тайл/спрайт-кэша,
// которые в текущей архитектуре тоже переехали в work-RAM: pat_maze_cell/vec_spr_buf, см. .sym).
const symPath=process.argv[3]||rom.replace(/\.rom$/,".sym");
const L={};
for(const l of fs.readFileSync(symPath,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
for(const name of ["GameStatus","flagPiramideMap","pat_maze_cell","vec_spr_buf"]){
  if(L[name]===undefined){console.error(name+" не найден в "+symPath);process.exit(2);}
}
const GS=L.GameStatus,FPM=L.flagPiramideMap, PAT=L.pat_maze_cell, SPR=L.vec_spr_buf;
function run(n){for(let i=0;i<n;i++)v06c.oneInterrupt(true);}
// boot -> реальный геймплей
run(400);
let reached=false;
for(let blk=0;blk<60 && !reached;blk++){
  for(let f=0;f<25;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});run(1);if(rd(GS)===5&&(rd(FPM)&1)){reached=true;break;}}
  keyboard.keyUp({keyCode:32,preventDefault(){}});run(5);
}
// походить чтобы прогрузить спрайты
for(let f=0;f<30;f++){keyboard.keyDown({keyCode:39,preventDefault(){}});run(1);}keyboard.keyUp({keyCode:39,preventDefault(){}});run(10);
console.error("reached gameplay:",reached,"GS",rd(GS));

// --- дамп тайлов: pat_maze_cell + (T-0x40)*8, 8 байт/тайл, тайлы 0x40..0x8b ---
const tiles={};
for(let t=0x40;t<=0x8b;t++){const off=(t-0x40)*8;const rows=[];for(let r=0;r<8;r++)rows.push(rd(PAT+off+r));tiles[t.toString(16)]=rows;}
// --- дамп спрайтов: vec_spr_buf. Дампим 0x400 байт (hero/momia + область sprites2 нож/дверь) ---
// ПРИМЕЧАНИЕ: авторитетные bitmaps ножа/двери/кирки берутся из tools/verify/gfx_decode_rom.js
// (декодирует RLE-блоки GFX_* прямо из ROM: door=pat E0/E4, knife=pat F0-FC, mummy=28-30).
const spr=[];
for(let b=0;b<0x400;b++)spr.push(rd(SPR+b));

fs.writeFileSync("/tmp/kv_gfx.json",JSON.stringify({tiles,spr},null,0));
console.error("dumped",Object.keys(tiles).length,"tiles,",spr.length,"spr bytes -> /tmp/kv_gfx.json");

// --- лист-PNG: тайлы (8x8) слева, спрайты (16x16) справа, scale 4 ---
const SC=4, cols=16;
const nTile=Object.keys(tiles).length, nSpr=Math.floor(spr.length/32);
const rowsT=Math.ceil(nTile/cols);
const SW=cols*8*SC+40+8*16*SC, SH=Math.max(rowsT*8*SC, Math.ceil(nSpr/4)*16*SC)+20;
const px=new Uint8Array(SW*SH*3); // black
function setpx(x,y,v){if(x<0||y<0||x>=SW||y>=SH)return;const i=(y*SW+x)*3;px[i]=px[i+1]=px[i+2]=v;}
function drawTile(rows,ox,oy){for(let r=0;r<8;r++)for(let c=0;c<8;c++){const on=(rows[r]>>(7-c))&1;if(on)for(let dy=0;dy<SC;dy++)for(let dx=0;dx<SC;dx++)setpx(ox+c*SC+dx,oy+r*SC+dy,255);}}
// тайлы
let i=0;for(const k of Object.keys(tiles)){const ox=(i%cols)*8*SC, oy=(Math.floor(i/cols))*8*SC; drawTile(tiles[k],ox,oy); i++;}
// спрайты: MSX 16x16 = 4 квадранта 8x8 (0-7 TL,8-15 BL,16-23 TR,24-31 BR)
function drawSpr(s0,ox,oy){for(let q=0;q<4;q++){const qx=(q>>1)*8, qy=(q&1)*8;for(let r=0;r<8;r++){const byte=spr[s0+q*8+r];for(let c=0;c<8;c++){const on=(byte>>(7-c))&1;if(on)for(let dy=0;dy<SC;dy++)for(let dx=0;dx<SC;dx++)setpx(ox+(qx+c)*SC+dx,oy+(qy+r)*SC+dy,200);}}}}
const sprOX=cols*8*SC+40;
for(let s=0;s<nSpr;s++){const ox=sprOX+(s%4)*16*SC, oy=Math.floor(s/4)*16*SC; drawSpr(s*32,ox,oy);}
// PNG
function crc(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;}return ~c>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt));return Buffer.concat([l,tt,c]);}
const raw=Buffer.alloc(SH*(SW*3+1));for(let y=0;y<SH;y++){raw[y*(SW*3+1)]=0;Buffer.from(px.buffer,y*SW*3,SW*3).copy(raw,y*(SW*3+1)+1);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(SW);ihdr.writeUInt32BE(SH,4);ihdr[8]=8;ihdr[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
fs.writeFileSync("/tmp/kv_gfx_sheet.png",png);
console.error("sheet -> /tmp/kv_gfx_sheet.png ("+SW+"x"+SH+"), tiles слева / спрайты справа");
