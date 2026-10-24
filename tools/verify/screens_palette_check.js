// screens_palette_check.js — контрольные снимки ключевых экранов (задача #31).
//
// Прогоняет партию по фиксированному сценарию и на каждом опорном экране снимает:
//   * палитру (16 слотов),
//   * гистограмму индексов палитры по видимым плоскостям p0/p1/p2 (idx=(p0<<3)|(p1<<2)|(p2<<1)),
//   * PNG кадра.
// Печатает всё в машинно-сравнимом виде — так два ROM (до/после правки) сверяются построчно.
//
// Экраны: логотип Konami, титул/меню, карта долины на старте партии, геймплей пирамиды 1,
//         карта долины после прохождения пирамиды 1, геймплей пирамиды 2.
//
// Запуск: node tools/verify/screens_palette_check.js [rom] [каталог для PNG]
"use strict";
const fs = require("fs"), vm = require("vm"), zlib = require("zlib");
const base = "/Users/boris/Projects/vector06js";
const rom = process.argv[2] || "build/kvalley_8c.rom";
const outdir = process.argv[3] || null;

const g = {}; g.window = g;
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.document={createElement:()=>fc(),getElementById:()=>fc(),all:undefined};
g.requestAnimationFrame=()=>0; g.setTimeout=()=>0; g.print=()=>0; g.console=console;
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
  vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"), ctx, {filename:f});
const memory=new ctx.Memory(), keyboard=new ctx.Keyboard(), timer=new ctx.I8253(), ay=new ctx.AY();
const floppy=new(ctx.Floppy().FD1793)(), io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io), tape={advance:()=>{},sample:0,reset:()=>{}};
const v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;
v06c.bmp=new Uint32Array(W*H); v06c.displayFrame=()=>{}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
// soundnik.soundStep НЕ глушим — он тактует ВИ53 (часы музыки).
const img=new Uint8Array(fs.readFileSync(rom));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();

const symfile = rom.replace(/\.rom$/, ".sym");
const L={};
for(const l of fs.readFileSync(symfile,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16); }
const rd=a=>memory.read(a&0xffff);
const run=n=>{for(let i=0;i<n;i++) v06c.oneInterrupt(true);};
const key=(code,down)=>{const e={keyCode:code,which:code,preventDefault(){},stopPropagation(){}};
  if(down) keyboard.keyDown(e); else keyboard.keyUp(e);};

const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
function png(out){ const bmp=v06c.bmp, rgb=Buffer.alloc(W*H*3);
  for(let i=0;i<W*H;i++){const c=bmp[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
  const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
  fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
}
const hex=c=>((c>>>0)&0xFFFFFF).toString(16).padStart(6,"0");
function shot(name){
  const cnt=new Array(16).fill(0);
  for(let i=0;i<8192;i++){
    const b0=rd(0x8000+i), b1=rd(0xA000+i), b2=rd(0xC000+i);
    for(let b=7;b>=0;b--) cnt[(((b0>>b)&1)<<3)|(((b1>>b)&1)<<2)|(((b2>>b)&1)<<1)]++;
  }
  const pal=[0,2,4,6,8,10,12,14].map(k=>hex(io.Palette[k])).join(" ");
  const hst=[0,2,4,6,8,10,12,14].map(k=>String(cnt[k]).padStart(6)).join(" ");
  console.log(`${name.padEnd(22)} GS=${rd(L.GameStatus)} fpm=${String(rd(L.flagPiramideMap)).padStart(2)} pyr=${rd(L.piramideActual)}`);
  console.log(`  палитра idx 0,2,4,6,8,10,12,14: ${pal}`);
  console.log(`  пикселей на слот              : ${hst}`);
  if(outdir) png(`${outdir}/${name}.png`);
}
if(outdir) fs.mkdirSync(outdir,{recursive:true});
// ОТСТОЙ ПО ИГРОВЫМ ТИКАМ, А НЕ ПО КАДРАМ. Всё, что мигает (искры сокровищ, маркер на карте),
// живёт по счётчику `timer`, который крутит ISR. Если сборка стала быстрее и перестала терять
// прерывания, то «через N кадров» две сборки окажутся на РАЗНЫХ тиках — снимки разойдутся
// при полностью одинаковом рендере. Поэтому ждём ровно N ИГРОВЫХ ТИКОВ.
const runTicks=n=>{ let last=rd(L.timer),c=0,guard=0;
  while(c<n && guard++<n*8){ run(1); const t=rd(L.timer); if(t!==last){last=t;c++;} } };

// 1. логотип Konami
run(300); shot("1_konami");
// 2. титул/меню
for(let i=0;i<400 && rd(L.GameStatus)!==1; i++) run(1);
run(40); shot("2_menu_title");
// 3. карта долины на старте партии + 4. геймплей пирамиды 1
let seenMap=false, ok=false;
for(let blk=0; blk<60 && !ok; blk++){
  for(let f=0; f<25; f++){ key(32,true); run(1);
    if(!seenMap && rd(L.GameStatus)===4 && !(rd(L.flagPiramideMap)&1) && rd(L.subStatus)===1){
      runTicks(80); seenMap=true; key(32,false); shot("3_map_start"); key(32,true); }
    if(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1)){ok=true;break;} }
  key(32,false); run(5);
}
runTicks(60); shot("4_game_pyr1");
// 4a-4d. ЧЕТЫРЕ ПОДРЯД КАДРА геймплея — ловят все фазы мерцания искр сокровищ
// (vec_brillo_cols, фаза (timer>>1)&3) и цвет гемов/кирпичей на одном экране.
for(let k=1;k<=4;k++){ runTicks(2); shot(`4${"abcd"[k-1]}_game_pyr1_искры${k}`); }
// 5. карта долины после прохождения пирамиды 1
key(78,true); run(3); key(78,false);
for(let f=0; f<600 && !(rd(L.GameStatus)===5 && !(rd(L.flagPiramideMap)&1)); f++) run(1);
runTicks(60); shot("5_map_after_clear");
// 6. геймплей пирамиды 2 (профиль цвета stage_b)
for(let f=0; f<900 && !(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1)); f++) run(1);
runTicks(60); shot("6_game_pyr2");
// 7-9. кирпичи ДРУГИХ ТОНОВ: схема оттенка = ((piramideActual-1)>>2)&3, то есть меняется
// на пирамидах 5 (схема 1) и 9 (схема 2). Раньше её задавала таблица ColoresPiedra.
function nextPyr(target){
  for(let tries=0; tries<12 && rd(L.piramideActual)<target; tries++){
    key(78,true); run(3); key(78,false);
    for(let f=0; f<900 && !(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1) &&
        rd(L.piramideActual)>=target); f++) run(1);
  }
  runTicks(60);
}
nextPyr(5); shot("7_game_pyr5_кирпичи_схема1");
nextPyr(9); shot("8_game_pyr9_кирпичи_схема2");
nextPyr(13); shot("9_game_pyr13_кирпичи_схема3");
// Пирамида 15 — ХВОСТ ЧЕТВЁРТОЙ СХЕМЫ (13-15). Добавлена 2026-07-31 вместе с починкой её
// цвета: снимок с 13-й показывает только начало диапазона, а жалоба владельца («13-15
// должны быть зелёные») касалась всех трёх, и последняя пирамида — единственная, за
// которой сразу идёт концовка, то есть по ней же видно, что патч финала не подтёк назад.
nextPyr(15); shot("10_game_pyr15_кирпичи_схема3");
