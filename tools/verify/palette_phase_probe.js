// ФАЗА ЗАПИСИ ПАЛИТРЫ (порт 0x0C) ВНУТРИ КАДРА. Палитра латчится по лучу: запись позже
// начала картинки (такт ~7636 от запроса IRQ) красит экран не тем цветом — «экран мерцает».
// Печатает распределение фазы записей за N кадров геймплея/демо и долю записей после порога.
// Запуск: node tools/verify/palette_phase_probe.js [rom] [sym] [кадров]
"use strict";
const {make}=require(require("path").resolve(__dirname,"beam_harness.js"));
const ROM=process.argv[2]||"build/kvalley_8c.rom", SYM=process.argv[3]||"build/kvalley_8c.sym", N=+(process.argv[4]||3000);
const E=make(ROM,SYM); const {L,rd,v06c,io,cyc}=E;
const LIMIT=7636; let on=false, ph=[];
const orig=io.output.bind(io);
io.output=function(port,val){ if(on && (port&0xff)===0x0c) ph.push(cyc()); return orig(port,val); };
for(let f=0;f<9000 && rd(L.GameStatus)!==5;f++) v06c.oneInterrupt(true);
on=true; for(let f=0;f<N;f++) v06c.oneInterrupt(true);
ph.sort((a,b)=>a-b); const q=p=>ph[Math.min(ph.length-1,Math.floor(p*ph.length))];
const late=ph.filter(x=>x>LIMIT).length;
console.log(`записей в порт 0x0C: ${ph.length} за ${N} кадров; фаза (тактов от IRQ): min ${q(0)} p50 ${q(.5)} p90 ${q(.9)} p99 ${q(.99)} max ${q(1)}`);
console.log(`ПОЗЖЕ начала картинки (${LIMIT}): ${late} (${(100*late/ph.length).toFixed(2)}%) -> ${late?"КРАСНЫЙ: палитра пишется в видимой области":"OK: все записи в гашении"}`);
process.exit(late?1:0);
