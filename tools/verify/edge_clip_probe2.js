// edge_clip_probe2.js — доказательство X-клипа спрайтового блиттера (vec_nsx), версия под
// текущий одноплоскостной блиттер (vnc_pbase маршрутизирует плоскость; символы читаются из .sym).
// Прямо вызывает vec_nsx на записи [Y,X,pat] с X у правого края и в середине, ставит
// vnc_pbase=0xE0 (plane3), читает plane3 (0xE000) и печатает занятые столбцы (col 0..31).
// БАГ (до фикса): у X с right-half>255 пиксели появляются в col 0..3 (wrap слева).
// ФИКС: только правый край (col ~31), без пикселей слева.
//
// Использование: node tools/verify/edge_clip_probe2.js /tmp/kvB.rom /tmp/kvB.sym [tag]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const g = {}; g.window = g;
g.document = { createElement: () => fc(), getElementById: () => fc() };
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
  vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"), ctx, {filename:f});

const ROM = process.argv[2] || "/tmp/kvB.rom";
const SYM = process.argv[3] || "/tmp/kvB.sym";
const TAG = process.argv[4] || ROM;

// ---- символы из .sym ----
const symtxt = fs.readFileSync(SYM,"utf8");
function sym(name){
  const m = symtxt.match(new RegExp("^"+name+":\\s*equ\\s*0*([0-9A-Fa-f]+)h","m"));
  if(!m) throw new Error("нет символа "+name);
  return parseInt(m[1],16);
}
const A = { vec_nsx:sym("vec_nsx"), vnc_pbase:sym("vnc_pbase"), sprAttrib:sym("sprAttrib"), GameStatus:sym("GameStatus"), vec_spr_buf:sym("vec_spr_buf") };
// Тестовый паттерн: pat=0x04 (база 0x04<0x60 -> без зеркала; offset=base*8=0x20).
// Сажаем СОЛИД 0xFF в 32 байта (лев.16 + прав.16), чтобы блит давал заведомые пиксели
// независимо от того, дошла ли headless-игра до геймплея.
const TESTPAT = 0x04;

const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(ROM));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;

function rd(a){return memory.bytes[memory.tobank(a)];}
function wr(a,v){memory.bytes[memory.tobank(a)]=v&0xff;}

// вход в геймплей: 400 idle + удержание SPACE
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
for(let f=0;f<520;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);}
keyboard.keyUp({keyCode:32,preventDefault(){}});
for(let f=0;f<40;f++)v06c.oneInterrupt(true);

// посадить солид-паттерн для TESTPAT
const patOff = (TESTPAT & 0xFC) * 8;
for(let i=0;i<32;i++) wr(A.vec_spr_buf + patOff + i, 0xFF);
console.log(`[${TAG}] GameStatus=0x${rd(A.GameStatus).toString(16)} vec_spr_buf=0x${A.vec_spr_buf.toString(16)} TESTPAT=0x${TESTPAT.toString(16)} (солид 0xFF)`);

function drawAt(Y, X, pat){
  const S = 0x7F00;
  wr(S+0,Y); wr(S+1,X); wr(S+2,pat); wr(S+3,0);
  wr(A.vnc_pbase, 0xE0);            // плоскость 3 (иначе рисует в p2/мусор)
  const SENT = 0x0001;
  cpu.sp = (cpu.sp-2)&0xffff;
  memory.bytes[memory.tobank(cpu.sp)] = SENT & 0xff;
  memory.bytes[memory.tobank((cpu.sp+1)&0xffff)] = (SENT>>8)&0xff;
  cpu.set_rp(4, S);
  cpu.pc = A.vec_nsx;
  let guard=0;
  while(cpu.pc !== SENT && guard++ < 200000) cpu.instruction();
  if(cpu.pc!==SENT) throw new Error("vec_nsx не вернулся (guard)");
}

function colsWithPixels(Y){
  const cols=[];
  for(let col=0; col<32; col++){
    let any=0;
    for(let r=0;r<16;r++){ const L=(255-Y-r)&0xff; any |= rd(0xE000 + col*0x100 + L); }
    if(any) cols.push(col);
  }
  return cols;
}

function test(name, Y, X){
  for(let col=0;col<32;col++) for(let r=0;r<16;r++){ wr(0xE000+col*0x100+((255-Y-r)&0xff),0); }
  drawAt(Y,X,TESTPAT);
  const cols=colsWithPixels(Y);
  const leftWrap = cols.filter(c=>c<=3);
  const body = cols.filter(c=>c>=28);
  console.log(`  ${name}: X=0x${X.toString(16)} -> col=[${cols.join(",")}]  ` +
              `левый(0..3)=[${leftWrap.join(",")}]  правый(28..31)=[${body.join(",")}]  ` +
              `${leftWrap.length? "WRAP!!!":"без wrap"}`);
  return leftWrap.length>0;
}

console.log("--- прямой vec_nsx блит, чтение plane3 ---");
test("середина    ", 0x50, 0x80);
test("край X=0xF7 ", 0x60, 0xF7);
test("край X=0xF8 ", 0x70, 0xF8);
test("край X=0xFA ", 0x80, 0xFA);
test("край X=0xFC ", 0x90, 0xFC);
test("край X=0xFF ", 0xA0, 0xFF);
