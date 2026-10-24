// M2-kickoff: характеризует тики v1 — раскладывает по контексту (геймплей в
// пирамиде vs переходные: загрузка/шторка) и по стоимости тактов, чтобы понять
// запас нативной логики до 50 Гц (59904 такт/кадр).
"use strict";
const fs=require("fs"); const base="/Users/boris/Projects/vector06js";
global.window=global; global.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
global.requestAnimationFrame=()=>0; global.setTimeout=()=>0; global.print=()=>0; global.console.debug=()=>{};
const files=["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"];
const vm=require("vm"); const ctx=vm.createContext(global);
for(const f of files) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const {Memory,IO,AY,I8253,Keyboard,I8080,Vector06c,Floppy}=ctx;
const memory=new Memory(),keyboard=new Keyboard(),timer=new I8253(),ay=new AY();
const floppy=new(Floppy().FD1793)(); const io=new IO(keyboard,timer,memory,ay,floppy);
io.Palette=new Array(16).fill(0);
const cpu=new I8080(memory,io); const tape={advance:()=>{},sample:0,reset:()=>{}};
const v06c=new Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(65536); v06c.displayFrame=function(){}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
if(v06c.soundnik)v06c.soundnik.soundStep=function(){};
// ROM/SYM больше не зашиты на /tmp/kvv.* — по умолчанию берём актуальную сборку из build/,
// путь можно переопределить аргументами: node tick_characterize.js [rom] [sym]
const REPO=__dirname+"/../..";
const romPath=process.argv[2]||REPO+"/build/kvalley_8c.rom";
const symPath=process.argv[3]||REPO+"/build/kvalley_8c.sym";
const img=new Uint8Array(fs.readFileSync(romPath));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();
function rd(a){return memory.bytes[memory.tobank(a)];}
// Адреса GameStatus/subStatus/flagPiramideMap берём из .sym по имени (раньше были зашиты числа
// GS=0x6B00/SUB=0x6B01 "эры 0x6B00" + fallback 0x6B51 для FPM — база переменных с тех пор
// переезжала ДВАЖДЫ (0x6B00->0x6C00->0x7092); fallback убран — молчаливая подстановка старого
// числа маскировала бы точно такую же поломку, из-за которой понадобилась эта правка).
let syms={}; for(const l of fs.readFileSync(symPath,"latin1").split("\n")){const m=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/); if(m)syms[m[1]]=parseInt(m[2],16);}
for(const name of ["tickMain","GameStatus","subStatus","flagPiramideMap"]){
  if(syms[name]===undefined){console.error(name+" не найден в "+symPath);process.exit(2);}
}
const TM=syms["tickMain"], GS=syms["GameStatus"], FPM=syms["flagPiramideMap"], SUB=syms["subStatus"];
// собираем полные тики: старт (вход tickMain, tickInProgress==0), считаем такты до след. полного тика,
// метим контекст на старте: GS, flagPiramideMap
let inTick=false, cyc=0, startCtx=null, ticks=[];
const orig=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc;
  if(pc===TM && rd(GS+5)===0){ // полный тик
    if(inTick){ ticks.push({cyc, gs:startCtx.gs, fpm:startCtx.fpm}); }
    inTick=true; cyc=0; startCtx={gs:rd(GS), fpm:rd(FPM)};
  }
  const c=orig(); cyc+=(c||4); return c;
};
let lg=-1;
// ждём УСТОЙЧИВЫЙ геймплей в пирамиде (GS5 & fpm!=0), собираем ТАМ
let inGame=-1;
for(let f=0;f<80000;f++){ v06c.oneInterrupt(true);
  if(rd(GS)===5 && rd(FPM)!==0 && inGame<0) inGame=f;
  if(inGame>0 && ticks.filter(t=>t.gs===5&&t.fpm!==0).length>=250) break;
  if(inGame>0 && f>inGame+12000) break;
}
// категоризация
const BUD=59904;
function cat(t){
  if(t.gs!==5) return "не-игра(GS"+t.gs+")";      // меню/заставка/конец
  if(t.fpm===0) return "карта пирамид";            // GS5, показ карты
  return "геймплей в пирамиде";                     // GS5, внутри
}
const groups={};
for(const t of ticks){ const k=cat(t); (groups[k]=groups[k]||[]).push(t.cyc); }
console.log("Тиков собрано:",ticks.length,"| бюджет 50Гц =",BUD,"такт/кадр\n");
for(const [k,arr] of Object.entries(groups)){
  arr.sort((a,b)=>a-b);
  const n=arr.length, avg=Math.round(arr.reduce((s,x)=>s+x,0)/n);
  const med=arr[n>>1], min=arr[0], max=arr[n-1];
  const over=arr.filter(x=>x>BUD).length;
  console.log(k+": n="+n);
  console.log("  такт/тик: min="+min+" медиана="+med+" avg="+avg+" max="+max);
  console.log("  >бюджета(59904): "+over+"/"+n+" ("+Math.round(over/n*100)+"%) | медиана в кадрах: "+(med/BUD).toFixed(2));
  console.log("");
}
