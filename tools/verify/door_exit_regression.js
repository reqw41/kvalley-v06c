// door_exit_regression.js — ШТАТНЫЙ выход из пирамиды через дверь (без чита).
//
// Воспроизводит реальный путь chkSalePiram: ставит двери статус #40 («открыта, ждёт
// выхода героя»), телепортирует героя в зону выхода (salidaArea: ProtaX = X двери,
// ProtaY в пределах -2..+3 от Y двери, та же комната) и проверяет, что игра САМА
// скопировала из данных двери piramideDest и puertaEntrada, прошла лестницу входа
// и вернулась в геймплей на пирамиде назначения.
//
// Гарантия отсутствия регрессии от правки чита (клавиша N): здесь клавиша N не
// нажимается ни разу, а путь идёт через нетронутый chkSalePiram.
//
// АДРЕСА — ТОЛЬКО ИЗ .sym (2026-07-31, задача #37). Здесь была зашита ЦЕЛАЯ таблица
// адресов от базы 0x6C00; после уплотнения нижней ОЗУ (база -> 0x7092) по ним лежит КОД,
// и скрипт «телепортировал героя», записывая байты в собственные инструкции игры.
//
// Запуск: node tools/verify/door_exit_regression.js [rom] [sym]
//         (sym по умолчанию — одноимённый с rom)
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const rom = process.argv[2] || "build/kvalley_8c.rom";
const symfile = process.argv[3] || rom.replace(/\.rom$/, ".sym");

const g = {}; g.window = g;
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.document={createElement:()=>fc(),getElementById:()=>fc()};
g.requestAnimationFrame=()=>0; g.setTimeout=()=>0; g.print=()=>0; g.console=console;
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
  vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"), ctx, {filename:f});
const memory=new ctx.Memory(), keyboard=new ctx.Keyboard(), timer=new ctx.I8253(), ay=new ctx.AY();
const floppy=new(ctx.Floppy().FD1793)(), io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io), tape={advance:()=>{},sample:0,reset:()=>{}};
const v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288); v06c.displayFrame=()=>{}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
const img=new Uint8Array(fs.readFileSync(rom));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();

const rd=a=>memory.read(a&0xffff), wr=(a,x)=>memory.write(a&0xffff,x&0xff);
const run=n=>{for(let i=0;i<n;i++) v06c.oneInterrupt(true);};
const key=(c,d)=>{const e={keyCode:c,which:c,preventDefault(){},stopPropagation(){}}; d?keyboard.keyDown(e):keyboard.keyUp(e);};

const L={};
for(const l of fs.readFileSync(symfile,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16); }
const A={}; // ИМЯ В СКРИПТЕ -> ИМЯ СИМВОЛА В .sym
for(const [k,s] of [["GameStatus","GameStatus"],["piramideActual","piramideActual"],
    ["piramideDest","piramideDest"],["puertaEntrada","puertaEntrada"],
    ["flagPiramideMap","flagPiramideMap"],["statusEntrada","statusEntrada"],
    ["flagEntraSale","flagEntraSale"],["flagStageClear","flagStageClear"],
    ["protaStatus","protaStatus"],["ProtaY","ProtaY"],["ProtaXdec","ProtaXdecimal"],
    ["ProtaX","ProtaX"],["ProtaRoom","ProtaRoom"],["pyramidDoors","pyramidDoors"],
    ["gemasCogidas","gemasCogidas"]]){
  if(L[s]===undefined){ console.log(`❌ в ${symfile} нет символа ${s}`); process.exit(2); }
  A[k]=L[s]; }

run(400);
let ok=false;
for(let blk=0;blk<60&&!ok;blk++){
  for(let f=0;f<25;f++){key(32,true);run(1); if(rd(A.GameStatus)===5&&(rd(A.flagPiramideMap)&1)){ok=true;break;}}
  key(32,false); run(5);
}
if(!ok){console.log("НЕ УДАЛОСЬ войти в геймплей"); process.exit(2);}
run(60);
const pira0=rd(A.piramideActual);
console.log(`геймплей: пирамида ${pira0}, GS=${rd(A.GameStatus)}`);

// найти выходную дверь (не ту, через которую вошли: ищем дверь с назначением != текущей)
let door=-1, dd=null;
for(let d=0; d<4; d++){
  const b=[]; for(let i=0;i<7;i++) b.push(rd(A.pyramidDoors+d*7+i));
  console.log(`  pyramidDoors[${d}] = ${b.map(x=>x.toString(16).padStart(2,"0")).join(" ")}`);
  if(b[0]!==0xff && b[5]!==0 && b[5]!==pira0 && door<0){door=d; dd=b;}
}
if(door<0){console.log("выходной двери не нашлось"); process.exit(2);}
console.log(`берём дверь ${door}: Y=${dd[0]} X=${dd[2]} комната=${dd[3]} назнач=${dd[5]} вход=${dd[6]}`);

// дверь «открыта, ждёт выхода» + герой в зоне выхода (salidaArea: dX=1 w=2, dY=4 h=6)
wr(A.pyramidDoors+door*7+4, 0x40);
wr(A.flagStageClear, 1);
wr(A.protaStatus, 0);
wr(A.ProtaRoom, dd[3]);
wr(A.ProtaY, dd[0]);
wr(A.ProtaXdec, 0);
wr(A.ProtaX, dd[2]);

// шаг 1: chkSalePiram должен сработать и скопировать данные двери
let hit=-1;
for(let f=0;f<200;f++){ run(1);
  if(rd(A.flagEntraSale)===1 && rd(A.piramideDest)===dd[5]){hit=f;break;} }
if(hit<0){
  console.log(`ПРОВАЛ: chkSalePiram не сработал. dest=${rd(A.piramideDest)} `+
    `puertaEntrada=${rd(A.puertaEntrada)} flagEntraSale=${rd(A.flagEntraSale)}`);
  process.exit(1);
}
const pe=rd(A.puertaEntrada);
console.log(`chkSalePiram сработал на кадре ${hit}: piramideDest=${rd(A.piramideDest)} `+
  `puertaEntrada=${pe} (ожидалось ${dd[5]} / ${dd[6]})`);
if(rd(A.piramideDest)!==dd[5] || pe!==dd[6]){
  console.log("ПРОВАЛ: данные двери скопированы неверно"); process.exit(1);
}

// шаг 2: переход должен доехать до геймплея на пирамиде назначения
let fin=-1;
for(let f=0;f<1500;f++){ run(1);
  if(rd(A.GameStatus)===5 && rd(A.piramideActual)===dd[5] && rd(A.flagEntraSale)===0){fin=f;break;} }
if(fin<0){
  console.log(`ПРОВАЛ: переход не завершился. GS=${rd(A.GameStatus)} pira=${rd(A.piramideActual)} `+
    `statusEntrada=${rd(A.statusEntrada)} ProtaY=${rd(A.ProtaY)}`);
  process.exit(1);
}
console.log(`штатный выход завершён за ${fin} кадров: пирамида ${pira0} -> ${rd(A.piramideActual)}, GS=5`);
console.log("ВЕРДИКТ: штатный выход через дверь работает — OK");
