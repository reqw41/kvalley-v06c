// Flicker-тест (для валидации Этапа 2.8): ловит ОСЦИЛЛЯЦИЮ пикселей при движении.
// Сигнатура флика = пиксель toggle'ит A-B-A (frame[i]==frame[i-2] && frame[i]!=frame[i-1]).
// Клэш-флик soft-VDP: кирпич под движущимся спрайтом мигает фон<->спрайт => осцилляция.
// Нативный рендер (спрайты в своей плоскости) => фон под спрайтом НЕ трогается => 0 осцилляции.
// Использование: node tools/verify/flicker_test.js <rom> [captureFrames=16]
//
// ===== АУДИТ МЕТРИК 2026-08-09 — НЕ ПУТАТЬ С BEAM-RACE ==============================
// Это НЕ замер мерцания под лучом. Сэмпл — конечный bmp кадра (после oneInterrupt),
// без модели луча / erase-дыры / межплоскостного окна. Может быть «ФЛИКА НЕТ» при
// железом видном фликере героя наверху. Для beam-race: beam_ab + beam_tear +
// beam_color + hero_atomic (+ jump_top_beam). Этот файл НЕ правили по геометрии —
// только пометка. Откат пометки: удалить этот блок комментария.
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2]||"/Users/boris/Projects/vector06js/kvv_r3_ef.rom", N=+(process.argv[3]||16);
// Адрес GameStatus берём из .sym по имени (база переменных переезжала 0x6B00->0x6C00->0x7092,
// раньше тут было зашито число 0x6b00 — по этому адресу сейчас лежит код, а не переменная).
const symPath=process.argv[4]||rom.replace(/\.rom$/,".sym");
const L={};
for(const l of fs.readFileSync(symPath,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
if(L.GameStatus===undefined){console.error("GameStatus не найден в "+symPath);process.exit(2);}
const GS_ADDR=L.GameStatus;
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;const rd=a=>memory.read(a&0xffff);
// в геймплей
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
for(let f=0;f<50;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);keyboard.keyUp({keyCode:32,preventDefault(){}});}
for(let f=0;f<2000&&rd(GS_ADDR)!==5;f++)v06c.oneInterrupt(true);
if(rd(GS_ADDR)!==5){console.log("НЕ дошли до геймплея (GS=0x"+rd(GS_ADDR).toString(16)+")");process.exit(1);}
// ДЕРЖИМ движение непрерывно (герой реально идёт) + захват кадров
const frames=[];
keyboard.keyDown({keyCode:37,preventDefault(){}});  // LEFT зажат
for(let f=0;f<N;f++){v06c.oneInterrupt(true);frames.push(Uint32Array.from(v06c.bmp));}
keyboard.keyUp({keyCode:37,preventDefault(){}});
// движение вообще было?
let anyMove=0;for(let i=1;i<frames.length;i++)for(let p=0;p<W*H;p++)if(frames[i][p]!==frames[i-1][p]){anyMove++;break;}
// осцилляция: A-B-A
let osc=0,rmin=H,rmax=0,cmin=W,cmax=0;const oscSet=new Set();
for(let i=2;i<frames.length;i++)for(let p=0;p<W*H;p++){
  if(frames[i][p]!==frames[i-1][p] && frames[i][p]===frames[i-2][p]){
    if(!oscSet.has(p)){oscSet.add(p);const y=(p/W)|0,x=p%W;if(y<rmin)rmin=y;if(y>rmax)rmax=y;if(x<cmin)cmin=x;if(x>cmax)cmax=x;}
    osc++;
  }
}
console.log("ROM="+rom.split("/").pop()+"  GS=5, кадров="+N+", кадров-с-движением="+anyMove+"/"+(N-1));
console.log("ОСЦИЛЛИРУЮЩИХ пикселей (флик A-B-A): уникальных="+oscSet.size+" событий="+osc+(oscSet.size?" область y="+rmin+".."+rmax+" x="+cmin+".."+cmax:""));
console.log(oscSet.size>200?"=> ЗАМЕТНЫЙ ФЛИК (клэш/мерцание)":oscSet.size?"=> слабая осцилляция ("+oscSet.size+" пикс, спрайт-фаза?)":"=> ФЛИКА НЕТ (0 осцилляции)");
