// prep_why.js — ПОЧЕМУ объект попал в подготовку (задача #53).
// Подготовка стоит 19081 такта на объект (prep_hot), поэтому важно, сколько объектов
// готовится ПО ДЕЛУ (сам сменил Y/X/pat) и сколько «подтянуто»: фазой P за пересечение
// с изменившимся соседом, sticky-флагом vfl_dirty (фон переписан блитом) или форсом
// смены сцены. Разрез считается на входе в vec_spr_prep сравнением cur с vec_nsp_prev.
// Запуск: node tools/verify/prep_why.js [rom] [sym] [кадров=3000]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||3000);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu}=E;
const PREP=L.vec_spr_prep,IDX=L.vec_nsp_idx,PREV=L.vec_nsp_prev,ATTR=L.sprAttrib;
for(const s of ["vec_spr_prep","vec_nsp_idx","vec_nsp_prev","sprAttrib","GameStatus"])
  if(L[s]===undefined){console.log("нет символа "+s);process.exit(2);}

//  РАЗРЕЗ ПРИЧИН подтягивания: sticky vfl_dirty (фон под спрайтом переписан блитом —
//  взводит vec_su_fixup) против фазы P (пересечение с изменившимся соседом, vflp_hit).
//  Обе метки ловим по PC и запоминаем, какому слоту флаг поставлен.
const FIX=L.vec_su_fixup,HIT=L.vflp_hit;
const cause={};	// slot -> {dirty, hit}
let dirtyN=0,hitN=0;
let self=0,pulled=0,total=0;
const bySlot={};
v06c.check_breakpoint=function(){
  if(HIT!==undefined&&cpu.pc===HIT){
    const s=cpu.regs?cpu.regs[1]:-1;	// C = адрес флага в vfl_flags (мл. байт)
    const k=(s-(L.vfl_flags&255))&255;
    (cause[k]=cause[k]||{dirty:0,hit:0}).hit++;hitN++;
    return false;}
  if(FIX!==undefined&&cpu.pc===FIX){dirtyN++;return false;}
  if(cpu.pc!==PREP)return false;
  if(rd(L.GameStatus)!==5)return false;
  const i=rd(IDX);
  const y=rd(ATTR+i*4),x=rd(ATTR+i*4+1),p=rd(ATTR+i*4+2);
  const py=rd(PREV+i*3),px=rd(PREV+i*3+1),pp=rd(PREV+i*3+2);
  const moved=(y!==py||x!==px||p!==pp);
  total++;if(moved)self++;else pulled++;
  const k=i;bySlot[k]=bySlot[k]||{n:0,m:0};bySlot[k].n++;if(moved)bySlot[k].m++;
  return false;};

for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);
                      E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
for(let f=0;f<NF;f++){const ph=f%200;
  if(ph<100){E.key(39,1);E.key(37,0);}else{E.key(39,0);E.key(37,1);}
  v06c.oneInterrupt(true);}

if(!total){console.log("ПРОВАЛ ПОКРЫТИЯ: подготовка ни разу не вызвана");process.exit(1);}
console.log(`объектов подготовлено ${total}`);
console.log(`  сам изменился (Y/X/pat != prev): ${self} = ${(100*self/total).toFixed(1)}%`);
console.log(`  ПОДТЯНУТ (prev совпал):          ${pulled} = ${(100*pulled/total).toFixed(1)}%`);
console.log(`\nсрабатываний фазы P (пересечение): ${hitN}; вызовов vec_su_fixup (блит под спрайтом): ${dirtyN}`);
console.log("\nслот   подготовок   из них по делу   подтянут фазой P");
for(const [k,v] of Object.entries(bySlot).sort((a,b)=>b[1].n-a[1].n))
  console.log(`  ${String(k).padStart(3)} ${String(v.n).padStart(10)} ${String(v.m).padStart(12)}  (${(100*v.m/v.n).toFixed(0)}%) ${String((cause[k]||{hit:0}).hit).padStart(12)}`);
