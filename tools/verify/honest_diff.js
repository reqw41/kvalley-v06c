// Гейт для спрайт/рендер-оптимизаций: два рома, ОДИНАКОВЫЙ прогон, попиксельное
// сравнение реального bmp эмулятора (плоскости 0-3). 0 расхождений = рендер
// идентичен. Спрайт-опт НЕ должна менять картинку. Логику это не проверяет
// (для логики - z80_logic_gate.js); тут именно ВИЗУАЛ.
// Использование: node honest_diff.js <baseRom> <optRom> [hold=900] [move=60]
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function mk(romPath){
  const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
  const ctx=vm.createContext(g);
  for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
  const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
  v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
  const img=new Uint8Array(fs.readFileSync(romPath));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
  cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
  return {v06c,keyboard,rd:a=>memory.bytes[memory.tobank(a)]};
}
const hold=+(process.argv[4]||900),move=+(process.argv[5]||60);
function run(romPath){
  const M=mk(romPath);
  for(let f=0;f<400;f++)M.v06c.oneInterrupt(true);
  for(let f=0;f<hold;f++){M.keyboard.keyDown({keyCode:32,preventDefault(){}});M.v06c.oneInterrupt(true);}
  M.keyboard.keyUp({keyCode:32,preventDefault(){}});
  for(let f=0;f<move;f++){M.keyboard.keyDown({keyCode:37,preventDefault(){}});M.v06c.oneInterrupt(true);}
  // снять все 4 плоскости (0x8000/A000/C000/E000, по 8К)
  const p=Buffer.alloc(4*8192);
  for(let pl=0;pl<4;pl++){const b=0x8000+pl*0x2000;for(let i=0;i<8192;i++)p[pl*8192+i]=M.rd(b+i);}
  return p;
}
const B=run(process.argv[2]),O=run(process.argv[3]);
let diffs=0,firstPl=-1,firstOff=-1;
for(let i=0;i<B.length;i++){if(B[i]!==O[i]){diffs++;if(firstPl<0){firstPl=(i/8192)|0;firstOff=i%8192;}}}
if(diffs===0)console.log("✅ РЕНДЕР ИДЕНТИЧЕН (0 расхождений во всех 4 плоскостях,",hold,"+",move,"кадров)");
else console.log(`❌ РЕНДЕР РАСХОДИТСЯ: ${diffs} байт. Первое: плоскость ${firstPl} (${["p0/син","p1/бел","p2/тень","p3/спрайт"][firstPl]}) offset 0x${firstOff.toString(16)}`);
