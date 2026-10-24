// sprite_phase_profile.js — куда РЕАЛЬНО уходит кадр в спрайтовой подсистеме.
// Бакеты по ДИАПАЗОНУ PC (такты каждой инструкции идут в бакет своего адреса):
//   Ф-флаги / sticky / список видимых / Ф-распространение / цикл подготовки —
//   это части vec_nat_sprites; отдельно vec_spr_prep (геометрия+сдвиг), save-under
//   (restore/save), пачка вывода (vec_spr_out+vec_spr_show+vsb_*), прочий тик, halt.
// Считаются только кадры геймплея (GameStatus=5).
// Запуск: node tools/verify/sprite_phase_profile.js [rom] [sym] [кадров на пирамиду] [пирамид]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const PF=+(process.argv[4]||900), NP=+(process.argv[5]||6);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu}=E;
const B=[
  ["флаги Ф",            L.vflf_nofc, L.vflm_loop],
  // БАКЕТ «список видимых» СНЯТ 2026-08-06 (задача #51, фаза 1). Он мерил отдельный
  // проход-сборщик vfla_loop по всем 21 слотам; задача#53 перенесла сборку тройек
  // (idx,Y,X) в ФАЗУ F (vflf_cur_see — там Y и X уже прочитаны), а мёртвый проход
  // удалён вместе с меткой. Его такты теперь считаются в бакете «флаги Ф», и это
  // не потеря разрешения: своего кода у сборщика больше нет. Границей «sticky»
  // вместо vfla_loop стал vflp_pass — следующая живая метка по адресу.
  ["sticky",             L.vflm_loop, L.vflp_pass],
  ["распространение П",  L.vflp_pass, L.vflp_done],
  ["цикл подготовки",    L.vflp_done, L.vec_spr_flush],
  ["vec_spr_flush",      L.vec_spr_flush, L.vec_su_ptr],
  ["save-under (R/S)",   L.vec_su_ptr, L.vec_scan_keys],
  ["ПОДГОТОВКА spr_prep",L.vec_spr_prep, L.vec_spr_out],
  ["ПАЧКА spr_out",      L.vec_spr_out, L.vec_spr_mkmir],
];
const names=B.map(b=>b[0]).concat(["прочий тик","halt"]);
const acc={};for(const n of names)acc[n]=0;
const fs_={};for(const n of names)fs_[n]=0;
let live=false,frames=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc&0xffff;oI();
  if(!live)return;const vc=cpu.vcycles|0;
  if(cpu.last_opcode===0x76){acc["halt"]+=vc;return;}
  for(let i=0;i<B.length;i++)if(pc>=B[i][1]&&pc<B[i][2]){acc[B[i][0]]+=vc;return;}
  acc["прочий тик"]+=vc;
};
let seed=2024;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const KS=[37,39,38,40];let held=-1;
function step(){for(const n of names)acc[n]=0;
  v06c.oneInterrupt(true);live=(rd(L.GameStatus)===5);
  if(live){frames++;for(const n of names)fs_[n]+=acc[n];}}
for(let p=0;p<NP;p++){
  if(p>0){live=false;E.key(78,1);step();E.key(78,0);for(let i=0;i<4000&&rd(L.GameStatus)!==5;i++)step();}
  for(let f=0;f<PF;f++){
    if(f%17===0){const k=KS[(rnd()*4)|0];if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
    step();if(!live)for(let i=0;i<4000&&rd(L.GameStatus)!==5;i++)step();
  }
  if(held>0){E.key(held,0);held=-1;}
}
console.log(`кадров геймплея ${frames}; кадр Вектора = 59904 такта\n`);
console.log("бакет                     тактов/кадр   % кадра");
let tot=0;
for(const n of names){const v=fs_[n]/frames;tot+=v;
  console.log(`${n.padEnd(24)} ${v.toFixed(0).padStart(11)}   ${(100*v/59904).toFixed(1)}%`);}
console.log(`${"ИТОГО".padEnd(24)} ${tot.toFixed(0).padStart(11)}   ${(100*tot/59904).toFixed(1)}%`);
const nat=["флаги Ф","sticky","распространение П","цикл подготовки"].reduce((a,n)=>a+fs_[n]/frames,0);
console.log(`\nvec_nat_sprites (без вложенных подпрограмм) = ${nat.toFixed(0)} тактов/кадр`);
