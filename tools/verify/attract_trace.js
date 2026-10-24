// ТРАССА АТТРАКТ-ЦИКЛА: демо -> титул -> демо, без единого нажатия.
//
// ЗАЧЕМ. Жалоба владельца 2026-09-11: «глюки с нестиранием HUD и спрайтов, видно в работе
// демо-режима и перехода на стартовый экран, а потом обратно в демо». Аттракт идёт сам,
// значит воспроизводится чистым прогоном. Здесь снимаем покадрово GameStatus/subStatus/
// piramideActual/скролл и печатаем кадры переходов; по --png N вокруг каждого перехода
// кладём кадры.
//
// Запуск: node tools/verify/attract_trace.js [rom] [sym] [кадров] [prefix]
"use strict";
const {make}=require("./beam_harness.js");
const ROM=process.argv[2]||"build/kvalley_8c.rom", SYM=process.argv[3]||"build/kvalley_8c.sym";
const N=+(process.argv[4]||6000);
const PREFIX=process.argv[5]||"";
const E=make(ROM,SYM);
const {L,rd,run,v06c,io,png}=E;

function state(){
  return {gs:rd(L.GameStatus),ss:rd(L.subStatus),pa:rd(L.piramideActual),
          cp:rd(L.controlPlayer),fv:rd(L.flagVivo),fpm:rd(L.flagPiramideMap),
          vs:io.PA&255,vid:rd(L.Vidas),wc:rd(L.waitCounter)};
}
let prev=null;
const marks=[];
for(let f=0;f<N;f++){
  v06c.oneInterrupt(true);
  const s=state();
  if(!prev || s.gs!==prev.gs || s.ss!==prev.ss || s.vs!==prev.vs || s.pa!==prev.pa){
    marks.push({f,...s});
    console.log(`f=${String(f).padStart(5)} GS=${s.gs} sub=${s.ss} pyr=${s.pa} cp=0x${s.cp.toString(16)} fv=${s.fv} fpm=${s.fpm} scroll=0x${s.vs.toString(16)} vidas=${s.vid}`);
    prev=s;
  }
  if(PREFIX && ((f%25)===0)) png(`${PREFIX}${String(f).padStart(5,"0")}.png`);
}
console.log(`итого ${marks.length} смен состояния за ${N} кадров`);
