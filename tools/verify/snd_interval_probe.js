// ИНТЕРВАЛЫ МЕЖДУ ТИКАМИ ПЛЕЕРА (updateSound) В ТАКТАХ — честная метрика дрожания музыки.
// Покадровая гистограмма («кадров без тика / с двумя») врёт: тик, уехавший с конца кадра N
// на начало N+1, даёт пару 0/2, хотя сдвиг — 2000 тактов из 59904. Здесь считаем сами
// интервалы: p10/p50/p90/max, доля интервалов вне окна 0.5..1.5 кадра (слышимый сбой) и
// доля «слипшихся» (< 0.25 кадра = догон). Сцена — демо (трое движущихся).
// Запуск: node tools/verify/snd_interval_probe.js [rom] [sym] [кадров]
"use strict";
const {make}=require(require("path").resolve(__dirname,"beam_harness.js"));
const ROM=process.argv[2]||"build/kvalley_8c.rom", SYM=process.argv[3]||"build/kvalley_8c.sym", N=+(process.argv[4]||3500);
const E=make(ROM,SYM); const {L,rd,v06c,cpu,cyc,FRAME}=E;
let frame=0, last=-1, iv=[], on=false;
v06c.check_breakpoint=function(){ if(on && cpu.pc===L.updateSound){ const t=frame*FRAME+cyc(); if(last>=0) iv.push(t-last); last=t; } return false; };
for(let f=0;f<9000 && rd(L.GameStatus)!==5;f++) v06c.oneInterrupt(true);
on=true;
for(let f=0;f<N;f++){ v06c.oneInterrupt(true); frame++; if(rd(L.GameStatus)!==5) break; }
iv.sort((a,b)=>a-b); const q=p=>iv[Math.min(iv.length-1,Math.floor(p*iv.length))];
const out=iv.filter(x=>x<0.5*FRAME||x>1.5*FRAME).length, glued=iv.filter(x=>x<0.25*FRAME).length, long=iv.filter(x=>x>1.5*FRAME).length, vlong=iv.filter(x=>x>2.5*FRAME).length;
console.log(`тиков ${iv.length+1} за ${frame} кадров; интервал/кадр: p10 ${(q(.1)/FRAME).toFixed(2)} p50 ${(q(.5)/FRAME).toFixed(2)} p90 ${(q(.9)/FRAME).toFixed(2)} max ${(iv[iv.length-1]/FRAME).toFixed(2)}`);
console.log(`вне окна 0.5..1.5 кадра: ${out} (${(100*out/iv.length).toFixed(2)}%), из них длинных >1.5: ${long}, >2.5: ${vlong}; слипшихся <0.25: ${glued}`);
