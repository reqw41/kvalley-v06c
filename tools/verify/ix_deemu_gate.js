// IX-DEEMU GATE: покадровый diff игрового состояния base<->opt для проверки
// нативных переписей IX-эмуляции (см. roadmap "выпиливание IX", память
// project_kv_color_sprites_plan / reference_kv_z80_untranslated_ld_a_i).
//
// Отличие от logic_diff.js: ИСКЛЮЧАЕТ build-зависимые АБСОЛЮТНЫЕ УКАЗАТЕЛИ из
// сравнения. Перепись, сжимающая код, сдвигает адреса данных -> любой указатель,
// сохранённый в game-state RAM, легитимно отличается между билдами, хотя ведёт
// на ту же логическую таблицу (движение идентично). Единственный такой указатель
// в снимке momiaData/MapaRAM/Prota — ACTOR_JMP_P/JMP_P_H (смещения 0x0C/0x0D в
// каждой из 4 структур мумий; указывает на valoresSalto/подтаблицу прыжка).
// Реальный баг прыжка всё равно виден через ACTOR_Y/JUMPSENT (их читают ПО
// указателю -> при неверном указателе Y разойдётся). Исключаем ТОЛЬКО байты
// самого указателя.
//
// Использование: node tools/verify/ix_deemu_gate.js <baseRom> <optRom> <sym> [hold=900] [move=400] [warmup=400]
// PASS = 0 не-benign расхождений. Печатает список исключённых benign-хитов для аудита.
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function readSym(p){const s={};for(const line of fs.readFileSync(p,"utf8").split("\n")){const m=line.match(/^(\S+):\s+equ\s+0?([0-9A-Fa-f]+)h?/);if(m)s[m[1]]=parseInt(m[2],16);}return s;}
function makeVector(romPath){
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
const baseRom=process.argv[2],optRom=process.argv[3],symPath=process.argv[4];
const hold=+(process.argv[5]||900),move=+(process.argv[6]||400),warmup=+(process.argv[7]||400);
const sv=readSym(symPath);
const ranges=[
  ["momiaData", sv.momiasPiramid, sv.momiaDat+0x16*4],
  ["MapaRAM", sv.MapaRAM, sv.MapaRAM+0x8A0],
  ["Prota", sv.ProtaY, sv.ProtaX+1],
];
const singles=["numMomias","momiaEnProceso","GameStatus"].filter(k=>sv[k]!==undefined);
// benign build-зависимые указатели: ACTOR_JMP_P(0x0C)/JMP_P_H(0x0D) в 4 мумиях
const EXCL=new Set();
for(let i=0;i<4;i++){EXCL.add(sv.momiaDat+i*0x16+0x0C);EXCL.add(sv.momiaDat+i*0x16+0x0D);}
function snap(A){const parts=[];for(const [nm,lo,hi] of ranges){const b=[];for(let a=lo;a<hi;a++)b.push(A.rd(a));parts.push([nm,lo,b]);}for(const k of singles)parts.push([k,sv[k],[A.rd(sv[k])]]);return parts;}
const B=makeVector(baseRom),O=makeVector(optRom);
function step(A,down){if(down!==undefined){const e={keyCode:down,preventDefault(){}};A.keyboard.keyDown(e);}A.v06c.oneInterrupt(true);}
function bothStep(down){step(B,down);step(O,down);}
let realDiffs=0,benign=0,firstReal=null;const benignAddrs=new Set(),realAddrs=new Set();
for(let f=0;f<warmup;f++)bothStep();
for(let f=0;f<hold;f++)bothStep(32);
B.keyboard.keyUp({keyCode:32,preventDefault(){}});O.keyboard.keyUp({keyCode:32,preventDefault(){}});
// сценарий движения: чередуем LEFT/RIGHT/UP/SPACE для активного возбуждения мумий (погоня/прыжки)
const seq=[37,37,39,39,38,32,40,39,37];
for(let f=0;f<move;f++){
  bothStep(seq[f%seq.length]);
  const sb=snap(B),so=snap(O);
  for(let i=0;i<sb.length;i++){
    const [nm,lo,bb]=sb[i],[,,oo]=so[i];
    for(let j=0;j<bb.length;j++){
      if(bb[j]!==oo[j]){
        const addr=lo+j;
        if(EXCL.has(addr)){benign++;benignAddrs.add(addr.toString(16));}
        else{realDiffs++;realAddrs.add(nm+":"+addr.toString(16));if(!firstReal)firstReal={frame:warmup+hold+f,region:nm,addr:addr.toString(16),base:bb[j].toString(16),opt:oo[j].toString(16)};}
      }
    }
  }
}
console.log("benign (сдвинутые указатели JMP_P):",benign,"хитов, адреса:",[...benignAddrs].join(",")||"нет");
if(realDiffs===0)console.log("✅ ПОВЕДЕНИЕ ИДЕНТИЧНО (0 не-benign расхождений за",move,"кадров активного движения)");
else{console.log("❌ РЕАЛЬНОЕ РАСХОЖДЕНИЕ:",realDiffs,"байт-кадров, поля:",[...realAddrs].join(","));console.log("   Первое:",JSON.stringify(firstReal));}
