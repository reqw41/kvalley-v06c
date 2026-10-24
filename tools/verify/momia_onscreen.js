// momia_onscreen.js — ЧЕСТНЫЙ ОТВЕТ НА ЖАЛОБУ «на части уровней мумий не хватает».
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ЗАМЕР. Считать выводы хуком на vec_spr_show НЕЛЬЗЯ: после шага C
// большинство пачек идёт СЛИТОЙ ЗАПИСЬЮ (vsm_multi), которая vec_spr_show не зовёт
// вовсе — счётчик занижен в разы и ни о чём не говорит. Здесь ничего не считается по
// путям кода: берётся ЖИВОЙ ФРЕЙМБУФЕР после пачки.
//
// КАК СЧИТАЕТ. Сразу после возврата vec_spr_out, для каждого слота врагов 6-13:
//   ЖИВА ПО ЛОГИКЕ — sprAttrib[idx]: паттерн мумии (0x28-0x33 / 0x88-0x93) и Y < 0xD0
//                    (ровно тот порог, по которому vec_spr_prep прячет объект);
//   НА ЭКРАНЕ      — сдвинутый силуэт слота (+0xA0) накладывается на fb по геометрии
//                    ЗАПИСИ ВЫВОДА (+0x97 hi0, +0x98 lo0, +0x99 ncols) и считается доля
//                    битов силуэта, реально стоящих в fb в СВОЕЙ плоскости объекта.
// Мумия, которую видно, обязана дать 100%: свои плоскости она кладёт OR-ом, а чужие
// гасит, так что дырок в её собственной плоскости быть не может.
//
// Разбивка ПО ПИРАМИДАМ (переход читом N, как в momia_hidden.js).
//
// Запуск: node tools/verify/momia_onscreen.js [rom] [sym] [кадров на пирамиду] [пирамид]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const PF=+(process.argv[4]||500), NP=+(process.argv[5]||15);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu,memory}=E;
const wr=(a,v)=>memory.write(a&0xffff,v,false);
const isMomia=p=>(p>=0x28&&p<0x34)||(p>=0x88&&p<0x94);
let pyr=1, live=false;
const st=new Map();                    // пирамида -> счётчики
function cur(){ if(!st.has(pyr)) st.set(pyr,{frames:0,alive:0,full:0,part:0,none:0,nogeo:0,bits:0,shown:0}); return st.get(pyr); }
let retSP=-1, retPC=-1;
// ПОЧЕМУ МУМИИ НЕТ. Разбор случая «геометрия есть, а в fb ни одного бита силуэта»:
//   под створкой — габарит пересекается с живой створкой ворот (слоты 0-3), а створки
//     непрозрачны и выводятся ПОСЛЕДНИМИ, то есть накрывают мумию целиком (это эталонное
//     поведение MSX: плоскости 0-3 перекрывают всё);
//   слот скрыт  — запись вывода помечена pending=2 (объект спрятан в этом кадре);
//   прочее      — остаётся на разбор.
const whyN={leaf:0,hidden:0,stale:0,other:0};
function why(idx,pg,hi0,lo0,nc){
  if(rd(pg+0x96)===2){ whyN.hidden++; return; }
  // запись вывода описывает ПРОШЛОЕ положение объекта? Тогда мы искали силуэт не там:
  // мумия только что появилась/переехала, и пачка нарисует её следующим кадром.
  const a=L.sprAttrib+idx*4;
  if(rd(pg+0x9C)!==rd(a)||rd(pg+0x9D)!==rd(a+1)||rd(pg+0x9E)!==rd(a+2)){ whyN.stale++; return; }
  const c0=hi0&0x1F;
  for(let g=0;g<4;g++){
    const gp=0xE000+g*256, gn=rd(gp+0x99); if(!gn) continue;
    if(rd(gp+0x96)===0) continue;
    const gc=rd(gp+0x97)&0x1F, gl=rd(gp+0x98);
    if(c0<gc+gn&&gc<c0+nc&&lo0<=gl+15&&gl<=lo0+15){ whyN.leaf++; return; }
  }
  whyN.other++;
}
function afterPack(){
  const s=cur(); s.frames++;
  for(let idx=6;idx<=13;idx++){
    const a=L.sprAttrib+idx*4, Y=rd(a), X=rd(a+1), pat=rd(a+2);
    if(!isMomia(pat)||Y>=0xD0) continue;
    s.alive++;
    const pg=0xE000+idx*256, nc=rd(pg+0x99), hi0=rd(pg+0x97), lo0=rd(pg+0x98);
    if(!nc||!hi0){ s.nogeo++; s.none++; continue; }
    let tot=0, on=0;
    for(let c=0;c<nc;c++)for(let r=0;r<16;r++){
      const sil=rd(pg+0xA0+c*16+r); if(!sil)continue;
      const fb=rd((((hi0+c)&0xFF)<<8)|((lo0+r)&0xFF));
      for(let b=0;b<8;b++) if(sil&(1<<b)){ tot++; if(fb&(1<<b)) on++; }
    }
    if(!tot){ s.nogeo++; s.none++; continue; }   // силуэт пуст — геометрии верить нельзя
    s.bits+=tot; s.shown+=on;
    if(on===tot) s.full++;
    else if(on===0){ s.none++; why(idx,pg,hi0,lo0,nc); }
    else s.part++;
  }
}
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===L.vec_spr_out&&retPC<0&&live){retSP=cpu.sp;retPC=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
  else if(retPC>=0&&pc===retPC&&cpu.sp>retSP){retPC=-1;retSP=-1;afterPack();}
  return false;
};
function gotoPyr(p){
  while(rd(L.piramideActual)!==p){
    const c=rd(L.piramideActual);
    wr(L.piramideDest,c>p?p:c+1); wr(L.subStatus,0); wr(L.GameStatus,8);
    let w=0; while(w<9000&&!(rd(L.piramideActual)!==c&&rd(L.GameStatus)===5)){v06c.oneInterrupt(true);w++;}
    for(let i=0;i<40;i++)v06c.oneInterrupt(true);
    if(rd(L.piramideActual)===c) return false;
  }
  return true;
}
for(let p=1;p<=NP;p++){
  if(p>1&&!gotoPyr(p)) break;
  pyr=p; live=false; for(let i=0;i<30;i++)v06c.oneInterrupt(true);
  live=true;
  for(let i=0;i<PF;i++) v06c.oneInterrupt(true);
  live=false;
}
console.log("ROM: "+ROM);
console.log("пир | кадров | живых | целиком | частично | НЕТ НА ЭКРАНЕ | без геометрии | пикс силуэта видно");
let A=0,F=0,P=0,N=0,G=0,BT=0,SH=0;
for(const p of [...st.keys()].sort((a,b)=>a-b)){
  const s=st.get(p);
  A+=s.alive;F+=s.full;P+=s.part;N+=s.none;G+=s.nogeo;BT+=s.bits;SH+=s.shown;
  console.log(` ${String(p).padStart(2)} | ${String(s.frames).padStart(6)} | ${String(s.alive).padStart(5)} | `+
    `${String(s.full).padStart(7)} | ${String(s.part).padStart(8)} | ${String(s.none).padStart(13)} | `+
    `${String(s.nogeo).padStart(13)} | ${s.bits?(100*s.shown/s.bits).toFixed(2):"—"}%`);
}
console.log(`ИТОГО живых записей ${A}: целиком на экране ${F} (${(100*F/A).toFixed(1)}%), частично ${P}, НЕТ ${N} (${(100*N/A).toFixed(2)}%), без геометрии ${G}`);
console.log(`пикселей силуэта ${BT}, из них видно ${SH} = ${(100*SH/BT).toFixed(3)}%`);
console.log(`ПОЧЕМУ НЕТ (для случаев с геометрией): под створкой ворот ${whyN.leaf}, слот скрыт ${whyN.hidden}, `+
  `запись вывода от ПРОШЛОГО положения (мумия только появилась/переехала — пачка нарисует её следующим кадром) ${whyN.stale}, прочее ${whyN.other}`);
