// vom_rate.js — как часто детектор непрозрачности мумии (vom_check, задача #41/#42)
// решает ГАСИТЬ чужие плоскости, и каким путём он к этому пришёл.
//
// Пути детектора: «фон прямо из fb» (vom_fb) и «инерция» — плоскость гасила ПРОШЛАЯ пачка,
// поэтому чистый фон берётся из сохранённого блока (vom_blk1/vom_blkw). Инерция смотрит на
// ВЕСЬ габарит, а не под силуэт, поэтому она чувствительна к ширине габарита — ровно к тому,
// что меняет задача #44.
//
// Запуск: node tools/debug/vom_rate.js <rom> <sym> [тиков=2600]
"use strict";
const {make,toGame}=require("../verify/beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const NT=+(process.argv[4]||2600);
const {L,rd,v06c,cpu,memory}=E;
let TT=0;const oI=cpu.instruction.bind(cpu);cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
let t0=0,sumT=0;
let calls=0,fired=0,viaInertia=0,viaFb=0,live=false,exact=0,exactClean=0,loOk=0;
const ncH={};
let cur=-1,inert=false,wasExact=false;
let nBox=0,nXc=0,nOr4=0,tBox=0,tXc=0,bt=0,xt=0;
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(!live)return false;
  if(pc===L.vom_check){cur=rd(L.vec_nsp_idx);inert=false;calls++;t0=TT;}
  else if(pc===L.vom_bok){exact++;wasExact=true;}
  else if(pc===L.vom_blo)loOk++;
  else if(pc===L.vop_box){nBox++;bt=TT;}
  else if(pc===L.vom_xc){nXc++;if(xt===0)xt=TT;}
  else if(pc===L.vop_or4)nOr4++;
  else if(pc===L.vom_hit||pc===L.vom_mset){if(xt){tXc+=TT-xt;xt=0;}}
  else if(pc===L.vom_blk1||pc===L.vom_blkw)inert=true;
  else if(pc===L.vsd_dpg&&cur>=0){
    const pg=0xE000+cur*256, m=rd(L.vom_m), nc=rd(pg+0x99);
    if(m){fired++;if(inert)viaInertia++;else viaFb++;}
    if(wasExact&&!m)exactClean++;
    sumT+=TT-t0;
    wasExact=false;
    const k=`nc=${nc} ${m?"ГАСИТ":"нет"}`; ncH[k]=(ncH[k]||0)+1;
    cur=-1;
  }
  return false;
};
function keysForTick(t){
  const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000)k.push(39);
  else if(t<1010)k.push(78);
  else if(t<1300)k.push((t&8)?39:37);
  else if(t<1310)k.push(78);
  else if(t<1600)k.push((t&8)?38:39);
  else if(t<1640)k.push(78);
  else if(t<2000)k.push((t&8)?39:37);
  else if(t<2060)k.push(78);
  else k.push((t&8)?37:39);
  return k;
}
let tick=0,prevT=rd(L.timer),held=new Set(),guard=0;
while(tick<=NT&&guard++<400000){
  const want=new Set(keysForTick(tick));
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  v06c.oneInterrupt(true); live=(rd(L.GameStatus)===5);
  const t=rd(L.timer); if(t!==prevT){prevT=t;tick++;}
}
console.log(`ROM=${process.argv[2].replace(/.*\//,"")}: вызовов детектора ${calls}, ГАСИТ ${fired} (${(100*fired/Math.max(1,calls)).toFixed(1)}%)`);
console.log(`  тактов на вызов детектора: ${(sumT/Math.max(1,calls)).toFixed(0)}`);
console.log(`  на вызов: vop_box ${(nBox/calls).toFixed(2)}, точных проходов по fb ${(nXc/calls).toFixed(2)} (столбцов), vop_or4 ${(nOr4/calls).toFixed(2)}`);
console.log(`  из них по живому fb ${viaFb}, по ИНЕРЦИИ (из сохранённого блока) ${viaInertia}`);
if(L.vom_bok!==undefined)console.log(`  точный проход по сейву: lo0 совпал ${loOk}, габарит совпал целиком ${exact}, отпустил гашение ${exactClean}`);
for(const k of Object.keys(ncH).sort())console.log(`  ${k}: ${ncH[k]}`);
