// M2: горячие точки ГЕЙМПЛЕЙНОГО тика (GS5 в пирамиде) — такты по ближайшей метке.
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
// путь можно переопределить аргументами: node gameplay_hotspots.js [rom] [sym]
const REPO=__dirname+"/../..";
const romPath=process.argv[2]||REPO+"/build/kvalley_8c.rom";
const symPath=process.argv[3]||REPO+"/build/kvalley_8c.sym";
const img=new Uint8Array(fs.readFileSync(romPath));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();
function rd(a){return memory.bytes[memory.tobank(a)];}
let syms=[]; for(const l of fs.readFileSync(symPath,"latin1").split("\n")){const m=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/); if(m)syms.push([parseInt(m[2],16),m[1]]);}
syms.sort((a,b)=>a[0]-b[0]);
function lbl(pc){let lo=0,hi=syms.length-1,r=0;while(lo<=hi){let m=(lo+hi)>>1;if(syms[m][0]<=pc){r=m;lo=m+1;}else hi=m-1;}return syms[r][1];}
const S={}; for(const[a,n]of syms)S[n]=a;
// Адрес GameStatus берём из .sym по имени (раньше было зашито число 0x6B00 "эры 0x6B00" — база
// переменных с тех пор переезжала ДВАЖДЫ: 0x6B00->0x6C00->0x7092, по старому адресу сейчас код).
for(const name of ["tickMain","GameStatus","flagPiramideMap"]){
  if(S[name]===undefined){console.error(name+" не найден в "+symPath);process.exit(2);}
}
const TM=S["tickMain"], GS=S["GameStatus"], FPM=S["flagPiramideMap"];
const acc={}; let total=0, gticks=0, collecting=false;
const orig=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc;
  if(pc===TM && rd(GS+5)===0){ collecting = (rd(GS)===5 && rd(FPM)!==0); if(collecting)gticks++; }
  const c=orig()||4;
  if(collecting){ const n=lbl(pc); acc[n]=(acc[n]||0)+c; total+=c; }
  return c;
};
let inGame=-1;
for(let f=0;f<80000;f++){ v06c.oneInterrupt(true);
  if(rd(GS)===5&&rd(FPM)!==0&&inGame<0)inGame=f;
  if(inGame>0&&gticks>=200)break; if(inGame>0&&f>inGame+12000)break; }
console.log("Геймплейных тиков:",gticks,"| всего тактов:",total,"| ср/тик:",Math.round(total/gticks));
const top=Object.entries(acc).sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log("\nТОП рутин по тактам (доля тика):");
for(const[n,c]of top) console.log("  "+(c/total*100).toFixed(1).padStart(5)+"%  "+Math.round(c/gticks).toString().padStart(6)+" т/тик  "+n);
// 2-way: VDP-эмуляция/рендер (устраняется v2) vs игровая логика (v2 исполняет)
const VDP=/^(vec_|vbt_|vcp|vcm|vrd_|vmu_|vxq|vw_|dummyLoop|setVDPWrite|setFillVRAM|fillVRAM|VRAM_|DEtoVRAM|vdcp|WRTVRM|WRTPSG|RDVDP|coordVRAM|getLocationDE|drawTile|invierteByte)/;
let vdp=0,logic=0,snd=0;
for(const[n,c]of Object.entries(acc)){
  if(/updateSound|processSndData|loc_7C|vec_vi_ch|vec_flushvi|SetFreq|FreqAY/.test(n))snd+=c;
  else if(VDP.test(n))vdp+=c; else logic+=c;
}
console.log("\n=== 2-WAY SPLIT геймплейного тика ===");
console.log("VDP-эмуляция+рендер (v2 УСТРАНЯЕТ шов сцены): "+(vdp/total*100).toFixed(1)+"% = "+Math.round(vdp/gticks)+" т/тик");
console.log("Звук (frame-paced): "+(snd/total*100).toFixed(1)+"% = "+Math.round(snd/gticks)+" т/тик");
console.log("ИГРОВАЯ ЛОГИКА (v2 нативит): "+(logic/total*100).toFixed(1)+"% = "+Math.round(logic/gticks)+" т/тик");
console.log("→ v2-оценка тика ≈ логика("+Math.round(logic/gticks)+")/2 нативно + native-render(dirty-only, дёшево) → бюджет 59904:",
  Math.round(logic/gticks/2)<40000?"С ЗАПАСОМ":"проверить");

