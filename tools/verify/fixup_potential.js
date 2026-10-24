// РАЗВЕДКА ПЕРЕД ПРАВКОЙ «МАСКА ЗАНЯТЫХ СТОЛБЦОВ» (slots-in-ram 5140343 + be586e6):
// сколько на самом деле стоит vec_su_fixup и сколько его оборотов ХОЛОСТЫЕ.
// Сцена — та же СТАТИКА, что у tickcycles (уровень отрисован, ходьба в четыре стороны):
// в сцене tickavg/pack_prof («прогулка вправо») блитов клеток нет вовсе и fixup не
// вызывается НИ РАЗУ — мерить его там значит мерить тишину.
"use strict";
const {make,toGame}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {cpu,run,rd,L,key}=E;
let calls=0, turns=0, hitTurns=0, cyc=0, inFx=false, spAt=0, tot=0;
const orig=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc&0xffff;
  if(pc===L.vec_su_fixup&&!inFx){inFx=true;spAt=cpu.sp;calls++;}
  else if(pc===L.vfx_loop&&inFx){turns++;
    // валиден ли слот, на который сейчас смотрит цикл
    const idx=rd(L.vfx_idx); if(rd((0xE0+idx)*256))hitTurns++;}
  const t=orig();
  tot+=t; if(inFx){cyc+=t; if(cpu.sp>spAt)inFx=false;}
  return t;
};
toGame(E); run(120);
for(const d of [39,37,39,38,32]){ key(d,1); run(300); key(d,0); run(50); }
if(!calls){console.log("ГЕЙТ ПРОВАЛЕН: vec_su_fixup не вызывался — сцена его не задевает.");process.exit(2);}
console.log(`вызовов vec_su_fixup: ${calls}; всего ${cyc} тактов = ${(cyc/calls).toFixed(0)} на вызов, ${(100*cyc/tot).toFixed(2)}% всех тактов прогона`);
console.log(`оборотов цикла по слотам: ${turns} = ${(turns/calls).toFixed(1)} на вызов, из них по ВАЛИДНОМУ слоту ${hitTurns} = ${(100*hitTurns/turns).toFixed(1)}%`);
console.log(`ПОТОЛОК «маски занятых столбцов»: она снимает только ХОЛОСТЫЕ вызовы целиком;`);
console.log(`ПОТОЛОК «списка валидных слотов»: он снимает ${turns-hitTurns} холостых оборотов из ${turns}`);
