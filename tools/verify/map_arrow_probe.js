// map_arrow_probe.js — ПОКАДРОВЫЙ замер стрелки направления на КАРТЕ ДОЛИНЫ.
//
// ЗАЧЕМ. Владелец с железа: «при переключении уровня читом стрелка сначала смотрит не в
// сторону лабиринта, из которого перешёл, а ВВЕРХ». Скрипт снимает с ПЕРВОГО кадра карты
// (момент определяется по ВЫЗОВУ vbp_map — ветки палитры карты, а НЕ по GameStatus=4:
// при GS=4 ещё идёт шторка перехода и карта не построена) значения:
//   puertaSalida  — направление выхода (1 вверх, 2 вниз, 4 влево, 8 вправо),
//   attrFlechaMap — Y, X и НОМЕР ПАТТЕРНА спрайта стрелки,
//   плюс PNG кадра.
//
// Режимы (аргумент --mode):
//   cheat  — переходы читом N (по умолчанию),
//   jump   — переходы читом H (+5 пирамид),
//   door   — ШТАТНЫЙ выход: автопилот доигрывает пирамиду (собирает гемы, идёт в дверь).
//
// Запуск: node tools/verify/map_arrow_probe.js [--mode=cheat|jump|door] [--steps=N] [--png=dir]
"use strict";
const fs = require("fs"), vm = require("vm"), zlib = require("zlib");
const base = "/Users/boris/Projects/vector06js";
const REPO = __dirname + "/../..";

const args = process.argv.slice(2);
const opt = k => { const a = args.find(s => s.startsWith("--" + k + "=")); return a ? a.split("=")[1] : null; };
const MODE = opt("mode") || "cheat";
const STEPS = parseInt(opt("steps") || "4", 10);
const PNGDIR = opt("png");
const ROM = opt("rom") || REPO + "/build/kvalley_8c.rom";
const SYM = ROM.replace(/\.rom$/, ".sym");

// --- эмулятор -------------------------------------------------------------------------
const g = {}; g.window = g;
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.document={createElement:()=>fc(),getElementById:()=>fc(),all:undefined};
g.requestAnimationFrame=()=>0; g.setTimeout=()=>0; g.print=()=>0;
g.console={log(){},debug(){},warn(){},error(){},info(){}};
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
  vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"), ctx, {filename:f});
const memory=new ctx.Memory(), keyboard=new ctx.Keyboard(), timer=new ctx.I8253(), ay=new ctx.AY();
const floppy=new(ctx.Floppy().FD1793)(), io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io), tape={advance:()=>{},sample:0,reset:()=>{}};
const v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;
v06c.bmp=new Uint32Array(W*H); v06c.displayFrame=()=>{}; v06c.dbg=null;
// ВНИМАНИЕ: soundnik.soundStep НЕ глушим — он тактует ВИ53, на нём часы музыки.
const img=new Uint8Array(fs.readFileSync(ROM));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();

// --- символы ТОЛЬКО из .sym -----------------------------------------------------------
const L={};
for(const l of fs.readFileSync(SYM,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16); }
for(const n of ["GameStatus","subStatus","flagPiramideMap","piramideActual","piramideDest",
  "puertaEntrada","puertaSalida","statusEntrada","attrFlechaMap","attrPiramidMap",
  "numSprFlechas","numSprFlechInv","vbp_map","pyramidDoors","timer",
  "flagStageClear","protaStatus","ProtaRoom","ProtaY","ProtaX","ProtaXdecimal"])
  if(L[n]===undefined){ console.log("нет символа "+n+" в "+SYM); process.exit(2); }

const rd=a=>memory.read(a&0xffff), wr=(a,x)=>memory.write(a&0xffff,x&0xff);
const key=(code,down)=>{const e={keyCode:code,which:code,preventDefault(){},stopPropagation(){}};
  if(down) keyboard.keyDown(e); else keyboard.keyUp(e);};

// --- ловушка на vbp_map: ветка палитры КАРТЫ; её вызов = карта уже построена ------------
let mapHit=false;
v06c.check_breakpoint=function(){ if(cpu.pc===L.vbp_map) mapHit=true; return false; };
const run=n=>{for(let i=0;i<n;i++) v06c.oneInterrupt(true);};
const frame=()=>{ mapHit=false; v06c.oneInterrupt(true); return mapHit; };

// --- PNG ------------------------------------------------------------------------------
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
function png(out){ const bmp=v06c.bmp, rgb=Buffer.alloc(W*H*3);
  for(let i=0;i<W*H;i++){const c=bmp[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
  const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
  fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
}
if(PNGDIR) fs.mkdirSync(PNGDIR,{recursive:true});

// --- словарь паттернов стрелок --------------------------------------------------------
const DIRNAME={1:"ВВЕРХ",2:"ВНИЗ",4:"ВЛЕВО",8:"ВПРАВО",0:"(ноль)"};
const spr=[0,1,2,3].map(i=>rd(L.numSprFlechas+i));      // индекс 0..3 -> паттерн
const sprInv=[0,1,2,3].map(i=>rd(L.numSprFlechInv+i));
const IDX2DIR=[1,2,4,8];
function pat2dir(p){ const i=spr.indexOf(p); return i<0?null:IDX2DIR[i]; }
function pat2dirInv(p){ const i=sprInv.indexOf(p); return i<0?null:IDX2DIR[i]; }
console.log(`numSprFlechas   = ${spr.map(x=>x).join(" ")}  (индекс 0..3 = вверх/вниз/влево/вправо)`);
console.log(`numSprFlechInv  = ${sprInv.map(x=>x).join(" ")}\n`);

// --- буст в геймплей ------------------------------------------------------------------
run(400);
let ok=false;
for(let blk=0; blk<60 && !ok; blk++){
  for(let f=0; f<25; f++){ key(32,true); run(1);
    if(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1)){ok=true;break;} }
  key(32,false); run(5);
}
if(!ok){ console.log("НЕ УДАЛОСЬ войти в геймплей"); process.exit(2); }
run(60);

// --- ожидаемое направление выхода: ищем в pyramidDoors дверь на piramideActual+step -----
function doorDirTo(dest){
  for(let d=0; d<4; d++){
    if(rd(L.pyramidDoors+d*7)===0xFF) continue;
    if(rd(L.pyramidDoors+d*7+5)===dest) return {slot:d, dir:1<<d, entra:rd(L.pyramidDoors+d*7+6)};
  }
  return null;
}

let bad=0;
for(let step=0; step<STEPS; step++){
  const before=rd(L.piramideActual);
  // сколько пирамид перепрыгиваем и какой дверью ВЫХОДИМ (для ожидания)
  const exitDoor=doorDirTo(before+1);
  const expDir=exitDoor?exitDoor.dir:null;

  if(MODE==="cheat"){ key(78,true); run(3); key(78,false); }
  else if(MODE==="jump"){ key(72,true); run(3); key(72,false); }
  else if(MODE==="door"){
    // ШТАТНЫЙ ВЫХОД, БЕЗ ЧИТА (метод из door_exit_regression.js): дверь на выходе ставим в
    // статус #40 «открыта, ждёт героя» и телепортируем героя в salidaArea. Дальше игра идёт
    // своим кодом — chkSalePiram сам считает ElemEnProceso и puertaSalida.
    if(!exitDoor){ console.log("выходной двери не нашлось"); process.exit(2); }
    const d=exitDoor.slot;
    wr(L.pyramidDoors+d*7+4, 0x40);
    wr(L.flagStageClear, 1);
    wr(L.protaStatus, 0);
    wr(L.ProtaRoom, rd(L.pyramidDoors+d*7+3));
    wr(L.ProtaY,    rd(L.pyramidDoors+d*7));
    wr(L.ProtaXdecimal, 0);
    wr(L.ProtaX,    rd(L.pyramidDoors+d*7+2));
  }
  else { console.log("неизвестный режим: "+MODE); process.exit(2); }

  // ждём ПЕРВОГО вызова vbp_map
  let f=0, got=false;
  for(; f<1200; f++){ if(frame()){ got=true; break; } }
  if(!got){ console.log(`шаг ${step}: карта (vbp_map) не появилась за ${f} кадров`); process.exit(1); }

  // покадровый замер, начиная с ПЕРВОГО кадра карты
  const rows=[];
  for(let k=0;k<8;k++){
    const ps=rd(L.puertaSalida), pat=rd(L.attrFlechaMap+2);
    rows.push({k, ps, y:rd(L.attrFlechaMap), x:rd(L.attrFlechaMap+1), pat,
               dir:pat2dir(pat), pira:rd(L.piramideActual), dest:rd(L.piramideDest),
               se:rd(L.statusEntrada)});
    // PNG всех снятых кадров: стрелка и силуэт мигают по coloresFlecha[timer&7], и на
    // отдельных тиках цвет совпадает с фоном — по одному кадру глазом ничего не докажешь.
    if(PNGDIR) png(`${PNGDIR}/${MODE}_${step}_pyr${before}_f${k}.png`);
    frame();
  }
  const r0=rows[0];
  const verdict = expDir===null ? "?" : (r0.dir===expDir ? "OK" : "ПРОВАЛ");
  if(verdict==="ПРОВАЛ") bad++;
  console.log(`--- переход из пирамиды ${before} (дверь выхода: слот ${exitDoor?exitDoor.slot:"?"}, `+
    `ожидаем ${DIRNAME[expDir]||"?"}) ---`);
  for(const r of rows)
    console.log(`  кадр карты +${r.k}: puertaSalida=${String(r.ps).padStart(2)} (${DIRNAME[r.ps]||"?"})`+
      `  паттерн=${r.pat} -> ${DIRNAME[r.dir]||"?"}  Y=${r.y} X=${r.x}  pira=${r.pira} dest=${r.dest} se=${r.se}`);
  console.log(`  ВЕРДИКТ первого кадра: ${verdict}\n`);

  // домотать до возврата в геймплей
  for(let i=0;i<1500;i++){ run(1); if(rd(L.GameStatus)===5 && rd(L.piramideActual)!==before) break; }
  run(40);
}
console.log(bad? `ПРОВАЛОВ: ${bad}` : "ВСЕ ПЕРВЫЕ КАДРЫ КАРТЫ — ВЕРНОЕ НАПРАВЛЕНИЕ");
process.exit(bad?1:0);
