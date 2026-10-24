// Этап 0.1 нативного рендера: снимок ИГРОВОГО СОСТОЯНИЯ (RAM) в геймплее.
// Контракт для будущего нативного рендерера: он читает ЭТО, а не VDP.
// Читаем через memory.read (банкинг Вектора!) — НЕ memory.bytes[].
// Использование: node tools/verify/state_snapshot.js <rom> [_ ] [moveFrames=0]
//
// === УСТАНОВЛЕННЫЙ КОНТРАКТ (2026-07-11, Этап 0.1, target vector) ===
// Адреса читаются из .sym ПО ИМЕНИ (база переменных с тех пор переезжала: 0x6B00->0x6C00->0x7092;
// зашитые числа устарели и указывали бы на код). GameStatus (5=геймплей), Vidas, flagMuerte,
//   offsetPlanoSpr, sprAttrib, enemyAttrib, MapaRAMRoot, MapaRAM — см. build/kvalley_8c.sym.
// Путь в геймплей: 400 warmup -> ~50 SPACE -> ~750 plain (интро-пирамида GS=0->1->4->5 к ~кадру 1188).
// СПРАЙТЫ: формат MSX SAT = [Y, X, pat, col] на запись, 4Б. sprAttrib=герой (до 6 записей: пара
//   спрайтов/половину для 2 цветослоёв — spr0/1 верх col1/3, spr2/3 низ; в геймплее герой может
//   быть на spr4/5). enemyAttrib=враги (до 4 врагов, оригинал РОТИРУЕТ их плоскости через
//   offsetPlanoSpr чтобы флик вместо исчезновения при >4 спр/строку — НАТИВНО не нужно). Y=225(0xE1)
//   ~скрыт/off. Позиция X в RAM = X на экране (проверено: hero X=219 = справа на honest-рендере).
// MapaRAM: 0x8A0=2208Б. Коды тайлов: 0x14 доминирует(1536, фон/пол), 0x00(открыто), 0x12,
//   0x20-0x23/0x17-0x18(спец: двери/лестницы/сокровища?), 0x80. ДЕКОД РАЗМЕРНОСТИ/КОДИРОВКИ
//   (2208≠768; структура «контент каждый 3-й ряд при W=32») = ЗАДАЧА 0.2 (маппинг код->паттерн+цвет).
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2]||"/Users/boris/Projects/vector06js/kvv_r3_ef.rom";
const holdSpace=+(process.argv[3]||500), moveFrames=+(process.argv[4]||0);
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const rd=a=>memory.read(a&0xffff);   // БАНКИРОВАННОЕ чтение

// Адреса берём из .sym по имени (раньше были зашиты числа "эры 0x6B00" — база переменных с тех
// пор переезжала ДВАЖДЫ: 0x6B00->0x6C00->0x7092; по старым адресам сейчас лежит код игры).
const symPath=process.argv[5]||rom.replace(/\.rom$/,".sym");
const L={};
for(const l of fs.readFileSync(symPath,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
const A={};
for(const name of ["GameStatus","Vidas","flagMuerte","offsetPlanoSpr","sprAttrib","enemyAttrib","MapaRAMRoot","MapaRAM"]){
  if(L[name]===undefined){console.error(name+" не найден в "+symPath);process.exit(2);}
  A[name]=L[name];
}

// прогон в геймплей: warmup -> space -> plain до GS==5 (интро-пирамида играет ~750 кадров)
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
for(let f=0;f<50;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);keyboard.keyUp({keyCode:32,preventDefault(){}});}
for(let f=0;f<2000 && rd(A.GameStatus)!==5;f++)v06c.oneInterrupt(true);
for(let f=0;f<moveFrames;f++){keyboard.keyDown({keyCode:37,preventDefault(){}});v06c.oneInterrupt(true);keyboard.keyUp({keyCode:37,preventDefault(){}});}
for(let f=0;f<10;f++)v06c.oneInterrupt(true);

const gs=rd(A.GameStatus);
console.log("=== СНИМОК СОСТОЯНИЯ ===");
console.log("GameStatus=0x"+gs.toString(16)+(gs===5?" (геймплей ✓)":" (НЕ геймплей!)")+"  Vidas="+rd(A.Vidas)+"  flagMuerte="+rd(A.flagMuerte)+"  offsetPlanoSpr="+rd(A.offsetPlanoSpr));

// --- спрайты: sprAttrib (6 героя) + enemyAttrib (враги). Формат MSX SAT: Y,X,pat,col ---
function dumpSpr(label,addr,n){console.log("\n"+label+" @0x"+addr.toString(16)+" (Y,X,pat,col):");
  for(let i=0;i<n;i++){const y=rd(addr+i*4),x=rd(addr+i*4+1),p=rd(addr+i*4+2),c=rd(addr+i*4+3);
    console.log("  спр"+i+": Y="+y+" X="+x+" pat=0x"+p.toString(16)+" col=0x"+c.toString(16)+(y===0xD0?" (стоп/скрыт)":""));}}
dumpSpr("sprAttrib (герой)",A.sprAttrib,6);
dumpSpr("enemyAttrib (враги)",A.enemyAttrib,8);

// --- MapaRAM: 0x8A0 байт. Пробуем разные ширины, печатаем как сетку hex-кодов ---
console.log("\n=== MapaRAM @0x"+A.MapaRAM.toString(16)+" (0x8A0=2208Б) ===");
const map=[];for(let i=0;i<0x8A0;i++)map.push(rd(A.MapaRAM+i));
// гистограмма кодов тайлов
const hist={};for(const v of map)hist[v]=(hist[v]||0)+1;
console.log("коды тайлов (топ):",Object.entries(hist).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>"0x"+(+k).toString(16)+":"+v).join(" "));
// печать сетки шириной W (по умолч. пробуем 32; KV экран 32×24=768, но MapaRAM 2208 -> м.б. с бордюром)
const gw=+(process.env.MAPW||32);
console.log("сетка ширины "+gw+" (символ на код: .=0, #=стена, др=hex):");
for(let r=0;r<Math.min(28,Math.ceil(map.length/gw));r++){
  let line="";for(let c=0;c<gw;c++){const v=map[r*gw+c];if(v===undefined)break;
    line+=(v===0?".":(v>=0x0f?"#":v.toString(16)));}
  console.log(String(r).padStart(2)+"|"+line);
}
console.log("\n(подбери MAPW=NN для верной ширины, сверив с honest_render.png)");
