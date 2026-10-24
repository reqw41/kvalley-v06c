// fast_why.js — ПОЧЕМУ ПАЧКА НЕ ИДЁТ СЛИТОЙ ЗАПИСЬЮ (задача #53).
//
// ЗАЧЕМ. Владелец с железа: «мерцание уходит, если сдвинуть поле вниз». Замер beam_late
// подтвердил: поле по центру — транзиент 2968 пикс / 11 объектов, поле внизу — 176 / 1.
// Транзиент («луч прошёл над объектом МЕЖДУ стиранием и выводом», то есть в этот кадр
// объекта на экране не было) бывает ТОЛЬКО на медленном пути пачки. Слитая запись
// (vso_fastall) переписывает габарит «фон OR спрайт» за одну запись на байт — дыры не
// существует в принципе, и сдвиг луча ей не нужен. Значит цель — довести долю слитых
// пачек до 100%, а для этого надо знать, ЧТО именно её запрещает.
//
// КАК. Решение принимает vsp_fastmark в тике. Причину отказа берём НЕ из состояния (так
// первая редакция соврала: она считала гейтом ZFLAG слота, а он в этом месте не гейт, а
// ПЕРЕСЧИТЫВАЕТСЯ через vfm_zs), а по АДРЕСУ ТОГО САМОГО `ret`, на котором процедура
// вышла: адрес однозначно указывает на проваленную проверку. Адрес переводим в строку
// исходника по build/kvalley_8c.lst.
// Запуск: node tools/verify/fast_why.js [rom] [sym] [кадров=3000]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||3000);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu}=E;
for(const s of ["vsp_fastmark","vsp_fast","vsp_n","vsp_list","vop_i1","GameStatus"])
  if(L[s]===undefined){console.log("нет символа "+s+" в .sym");process.exit(2);}

const lst=(()=>{ // адрес -> строка исходника из листинга сборки
  const fs=require("fs");
  const f=T+"/../../build/kvalley_8c.lst";
  const map={};
  if(!fs.existsSync(f))return map;
  for(const line of fs.readFileSync(f,"latin1").split("\n")){
    // формат sjasm 0.39: "NNNNN+  AAAA CC CC   мнемоника" — номер строки, '+', адрес
    const m=line.match(/^\s*\d+\+?\s+([0-9A-Fa-f]{4})\s+[0-9A-Fa-f]{2}/);
    if(m){const a=parseInt(m[1],16);if(!(a in map))map[a]=line.replace(/\s+$/,"");}}
  return map;})();
const why={},slots={};let calls=0,fast=0;
let ret=-1,sp=-1,live=false,prevPC=-1,lastPC=-1,n0=0;
const retOf=()=>E.memory.read(cpu.sp,false)|(E.memory.read(cpu.sp+1,false)<<8);
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(ret>=0)lastPC=prevPC;
  prevPC=pc;
  if(pc===L.vsp_fastmark&&ret<0){sp=cpu.sp;ret=retOf();live=(rd(L.GameStatus)===5);n0=rd(L.vsp_n);return false;}
  if(ret>=0&&pc===ret&&cpu.sp>sp){const exitAt=lastPC;ret=-1;
    if(!live)return false;
    calls++;
    if(rd(L.vsp_fast)){fast++;return false;}
    const key=`0x${(exitAt>>>0).toString(16)}`;
    (why[key]=why[key]||{n:0,src:lst[exitAt]||"(нет в листинге)",objs:0}).n++;
    why[key].objs+=n0;}
  return false;};
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);
                      E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
for(let f=0;f<NF;f++){const ph=f%200;
  if(ph<100){E.key(39,1);E.key(37,0);}else{E.key(39,0);E.key(37,1);}
  v06c.oneInterrupt(true);}
if(!calls){console.log("ПРОВАЛ ПОКРЫТИЯ: vsp_fastmark ни разу не вызван в геймплее");process.exit(1);}
console.log(`ROM=${ROM.split("/").pop()}  решений о слитой записи: ${calls}, разрешено ${fast} = ${(100*fast/calls).toFixed(1)}%`);
console.log(`ОТКАЗЫ (${calls-fast}) — по адресу выхода из vsp_fastmark:`);
for(const [a,v] of Object.entries(why).sort((x,y)=>y[1].n-x[1].n))
  console.log(`   ${String(v.n).padStart(5)} (${(100*v.n/calls).toFixed(1)}%)  ${a}  ${v.src.trim().slice(0,90)}`);
