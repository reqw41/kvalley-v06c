// ending_door_fidelity.js — ГЕЙТ ВХОДА В БОЛЬШУЮ ПИРАМИДУ на финальном экране.
//
// ЗАЧЕМ ОТДЕЛЬНО ОТ bonus_ending_gate.js. Тот сверяет кадр с СОХРАНЁННЫМ PNG, то есть
// сторожит «как было вчера»: если расцветку сломать и обновить эталон, гейт снова зелёный.
// Здесь оракул — САМ ОРИГИНАЛ: паттерн и MSX color table тайлов 0x63-0x67 сняты с
// картриджа (headless-WebMSX, GameStatus=0x0A / subStatus=0) и зашиты ниже, а проверка
// идёт ПОКЛЕТОЧНО: для каждого из 384 пикселей входа считается, какой цвет показал бы MSX
// (шейп -> старший ниббл цвета строки, фон -> младший), он переводится в слот палитры
// Вектора и сравнивается с тем, что реально лежит в плоскостях p0/p1/p2.
//
// ПОВОД: владелец на железе увидел «в углу справа вход белый, в оригинале жёлтый скос и
// бело-серые ступени» — скос и ступени сливались в один слот. Скриншотный гейт этого не
// ловил, потому что эталон снимался с той же сломанной сборки.
//
// Запуск: node tools/verify/ending_door_fidelity.js [rom] [sym]
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path");
const base = "/Users/boris/Projects/vector06js";
const rom = process.argv[2] || "build/kvalley_8c.rom";
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
io.tape_player = tape;
v06c.bmp=new Uint32Array(576*288); v06c.displayFrame=()=>{}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
const img=new Uint8Array(fs.readFileSync(rom));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();
const symfile = (process.argv[3] || rom.replace(/\.rom$/, ".sym"));
const L={};
for(const l of fs.readFileSync(symfile,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16); }
const rd=a=>memory.read(a&0xffff);
const run=n=>{for(let i=0;i<n;i++) v06c.oneInterrupt(true);};
const key=(c,d)=>{const e={keyCode:c,which:c,preventDefault(){},stopPropagation(){}}; d?keyboard.keyDown(e):keyboard.keyUp(e);};
const runTicks=n=>{ let last=rd(L.timer),c=0,guard=0;
  while(c<n && guard++<n*40){ run(1); const t=rd(L.timer); if(t!==last){last=t;c++;} } };
let inGame=false;
for(let blk=0; blk<60 && !inGame; blk++){
  for(let f=0; f<25; f++){ key(32,true); run(1);
    if(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1)){ inGame=true; break; } } key(32,false); run(5); }
key(32,false); run(4); runTicks(40);
key(69,true); run(6); key(69,false); run(4);
runTicks(120);   // фаза 3_walk: герой ушёл влево, вход открыт

// ---- ожидание по MSX ----------------------------------------------------------------
// цвет и паттерн тайлов входа сняты с картриджа (см. vec_ending.asm, kv_end_door)
const MSXCOL = { 0x63:[0xEA,0xEA,0xEA,0xEA,0xEA,0xA0,0xA0,0xA0],
                 0x64:[0xEA,0xA0,0xA0,0xA0,0xA0,0xA0,0xA0,0xA0],
                 0x65:[0xF0,0xF0,0xF0,0xF0,0xF0,0xE0,0xF0,0xE0],
                 0x66:[0xF0,0xF0,0xF0,0xE0,0xE0,0xFE,0xFE,0xFE],
                 0x67:[0xFE,0xFE,0xFE,0xFE,0xFE,0xFE,0xFE,0xFE] };
const MSXPAT = { 0x63:[0xFF,0x00,0x00,0x00,0x00,0xFC,0xF0,0xC0],
                 0x64:[0xFF,0xFC,0xF0,0xC0,0x00,0x00,0x00,0x00],
                 0x65:[0x00,0x00,0x00,0x00,0x01,0x01,0x0F,0x0F],
                 0x66:[0x00,0x00,0x1F,0x1F,0x1F,0xFF,0x00,0x00],
                 0x67:[0xFF,0x00,0xFF,0x00,0x00,0xFF,0x00,0x00] };
// MSX-цвет -> ожидаемый слот палитры Вектора
const WANT = { 0x0:0, 0xE:2, 0xA:10, 0xF:12 };
const NAME = {0:"чёрный",2:"серый",10:"песок",12:"белый"};
// клетки двери: (ряд, столбец) -> тайл (name table сцены, снята с оригинала)
const CELLS = [[16,30,0x63],[16,31,0x64],[17,30,0x00],[17,31,0x65],[18,30,0x66],[18,31,0x67]];
const idxAt=(row,col,y,x)=>{                     // индекс палитры пикселя клетки
  const lo=(255-(row*8+y))&0xff;
  const b0=rd(0x8000+col*256+lo), b1=rd(0xA000+col*256+lo), b2=rd(0xC000+col*256+lo);
  const b=7-x; return (((b0>>b)&1)<<3)|(((b1>>b)&1)<<2)|(((b2>>b)&1)<<1); };
const hex=c=>((c>>>0)&0xFFFFFF).toString(16).padStart(6,"0");
console.log(`ROM: ${rom}`);
console.log("палитра сцены: " + [0,2,4,6,8,10,12,14].map(k=>`idx${k}=${hex(io.Palette[k])}`).join(" "));
let bad=0, tot=0;
for(const [row,col,tile] of CELLS){
  if(tile===0){                                  // проём: обязан быть чёрным
    let nz=0; for(let y=0;y<8;y++) for(let x=0;x<8;x++) if(idxAt(row,col,y,x)!==0) nz++;
    console.log(`клетка (${row},${col}) тайл 0x00 проём: не-чёрных пикселей ${nz}`);
    bad+=nz; tot+=64; continue; }
  const col8=MSXCOL[tile], pat=MSXPAT[tile];
  let miss=0; const rows=[];
  for(let y=0;y<8;y++){
    let s="";
    for(let x=0;x<8;x++){
      const on=(pat[y]>>(7-x))&1;
      const want=WANT[on ? (col8[y]>>4) : (col8[y]&15)];
      const got=idxAt(row,col,y,x);
      tot++; if(got!==want){ miss++; bad++; s+="X"; }
      else s += want===0?".":want===2?"g":want===10?"y":"W";
    }
    rows.push(s);
  }
  console.log(`клетка (${row},${col}) тайл 0x${tile.toString(16)}: расхождений ${miss}/64` +
              `   . чёрный  g серый  y песок  W белый  X НЕ СОВПАЛО`);
  for(const r of rows) console.log("      " + r);
}
console.log(`\nИТОГ: сверено ${tot} пикселей входа, расхождений с моделью MSX — ${bad}`);
console.log(bad===0 ? "✅ вход в пирамиду воспроизводит оригинал поклеточно"
                    : "❌ вход в пирамиду не совпал с оригиналом");
process.exit(bad===0?0:1);
