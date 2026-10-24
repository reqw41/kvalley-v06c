// su_loop_census.js — АКТУАЛИЗАЦИЯ ЧИСЕЛ РЕЗЕРВА «vsu_rcol/vsu_srow» (2026-08-04).
// Старый расчёт (из Z80-отчёта) обещал ~-313 тактов/кадр за «страницу fb в B + lo0
// самомодифицируемым + полный анролл save». С тех пор появились ZFLAG и слитая запись
// (vso_fastall) — save/restore зовутся реже. Этот инструмент меряет ФАКТ на живой игре:
//   * вызовов vec_su_restore / vec_su_save на геймплейный кадр (и ранних выходов);
//   * столбцов restore (виток vsu_rcol) и save (виток vsu_scol) на кадр;
//   * витков полуанролла save (vsu_srow, 2 на столбец);
//   * тактов между входом в процедуру и выходом на vsu_rdone (для сверки до/после).
// Запуск: node tools/verify/su_loop_census.js [rom] [sym] [кадров=6000]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom",
      SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||6000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu}=E;
let TT=0;const oI=cpu.instruction.bind(cpu);cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
const REST=L.vec_su_restore,SAVE=L.vec_su_save,RCOL=L.vsu_rcol,SCOL=L.vsu_scol,
      SROW=L.vsu_srow,DONE=L.vsu_rdone,HIDE=L.vsu_hide;
// vsu_srow: до анролла 2026-08-04 — 2 витка на столбец, после — синоним «начало тела
// столбца» (1 хит на столбец); печатается как есть, интерпретировать с оглядкой на сборку.
for(const [n,v] of [["vec_su_restore",REST],["vec_su_save",SAVE],["vsu_rcol",RCOL],
                    ["vsu_scol",SCOL],["vsu_srow",SROW],["vsu_rdone",DONE]])
  if(v===undefined){console.log("нет символа "+n+" в .sym");process.exit(2);}
const S={rc:0,sc:0,rcol:0,scol:0,srow:0,rt:0,st:0,hide:0};
let mode=0,t0=0,frames=0,inplay=0;
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(rd(L.GameStatus)!==5)return false;
  if(pc===REST){mode=1;t0=TT;S.rc++;}
  else if(pc===SAVE){mode=2;t0=TT;S.sc++;}
  else if(pc===RCOL)S.rcol++;
  else if(pc===SCOL)S.scol++;
  else if(pc===SROW)S.srow++;
  else if(pc===HIDE)S.hide++;
  else if(pc===DONE&&mode){(mode===1?(S.rt+=TT-t0):(S.st+=TT-t0));mode=0;}
  return false;};
// Ввод — тот же генератор «блуждание + перескок пирамид», что в beam_late.js.
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  if(rd(L.GameStatus)===5)inplay++;
  v06c.oneInterrupt(true);
  frames++;
}
if(held>0)E.key(held,0);
const per=x=>(x/Math.max(1,inplay)).toFixed(2);
console.log(`кадров ${frames}, геймплейных ${inplay}`);
console.log(`restore: вызовов/кадр ${per(S.rc)}  столбцов/кадр ${per(S.rcol)}  тактов/кадр ${per(S.rt)}`);
console.log(`save:    вызовов/кадр ${per(S.sc)}  столбцов/кадр ${per(S.scol)}  витков srow/кадр ${per(S.srow)}  тактов/кадр ${per(S.st)}  hide ${S.hide}`);
console.log(`итого тактов save+restore на кадр: ${per(S.rt+S.st)}`);
