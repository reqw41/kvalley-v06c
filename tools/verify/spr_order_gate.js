// spr_order_gate.js — ПРЯМАЯ проверка порядка стирания/сейва в пачке (задача #47).
// Скользящий фронт стирания законен ровно при одном условии: фон под объектом X снимается
// ПОСЛЕ того, как стёрт КАЖДЫЙ объект Y, чей СТАРЫЙ габарит с этим фоном пересекается.
// Нарушение = протухший save-under (сейв X содержит пиксели ещё не стёртого Y).
// Здесь это проверяется НАПРЯМУЮ по трассе вызовов, без модели композиции:
//   стирание Y: габарит берётся из ШАПКИ слота (+1 hi0, +2 lo0, +3 ncols, +4 hi0b, +5 hi0c)
//               на ВХОДЕ в vec_su_restore — это то, что реально лежит в fb;
//   сейв X:     габарит берётся из ЗАПИСИ ВЫВОДА (+0x97/0x98/0x99/0x9A/0x9B) на входе в
//               vec_su_save — это то, что реально читается из fb.
// Пересечение считается ПОБАЙТНО (страница fb = плоскость+столбец, строка = lo0+0..15).
// Заодно та же проверка для пары «стирание Y ПОСЛЕ вывода X» (стирание затёрло бы
// нарисованное) — второй способ сломать картинку тем же фронтом.
// Запуск: node tools/verify/spr_order_gate.js [rom] [sym] [кадров]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||4000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu}=E;
const OUT=L.vec_spr_out,REST=L.vec_su_restore,SAVE=L.vec_su_save,SHOW=L.vec_spr_show,MERGE=L.vso_merge1;
function cells(hi,lo,nc,hib,hic){           // множество байт fb под габаритом
  const s=[];
  for(const h of [hi,hib,hic]){ if(!h)continue;
    for(let c=0;c<nc;c++){const pg=(h+c)&0xff;
      for(let r=0;r<16;r++)s.push(pg*256+((lo+r)&0xff));}}
  return s;}
function hdr(i){const pg=0xE000+i*256;
  return rd(pg)!==1?null:cells(rd(pg+1),rd(pg+2),rd(pg+3),rd(pg+4),rd(pg+5));}
function out(i){const pg=0xE000+i*256;
  if(rd(pg+0x96)>=2||!rd(pg+0x99))return null;
  return cells(rd(pg+0x97),rd(pg+0x98),rd(pg+0x99),rd(pg+0x9A),rd(pg+0x9B));}
function shw(i){const pg=0xE000+i*256;
  if(!rd(pg+0x99))return null;
  return cells(rd(pg+0x97),rd(pg+0x98),rd(pg+0x99),rd(pg+0x9F),rd(pg+0x9B));}
let ev=null,frame=0;
let badSave=0,badShow=0,batches=0,saves=0,rests=0;const samp=[];
function judge(){
  if(!ev)return;
  batches++;
  for(let a=0;a<ev.length;a++){
    const X=ev[a]; if(X.k!=="save"&&X.k!=="show")continue;
    for(let b=a+1;b<ev.length;b++){
      const Y=ev[b]; if(Y.k!=="rest"||!Y.set)continue;
      const inter=X.set.filter(v=>Y.set.includes(v)).length;
      if(!inter)continue;
      if(X.k==="save"){badSave++;if(samp.length<8)samp.push(`кадр ${frame}: сейв слота ${X.i} ДО стирания слота ${Y.i} (общих байт ${inter})`);}
      else {badShow++;if(samp.length<8)samp.push(`кадр ${frame}: вывод слота ${X.i} ДО стирания слота ${Y.i} (общих байт ${inter})`);}
    }}
  ev=null;}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===OUT){judge();ev=[];}
  else if(ev){
    const i=rd(L.vec_nsp_idx);
    if(pc===REST){rests++;ev.push({k:"rest",i,set:hdr(i)});}
    else if(pc===SAVE){const s=out(i);saves++;if(s)ev.push({k:"save",i,set:s});}
    else if(pc===SHOW){const s=shw(i);if(s)ev.push({k:"show",i,set:s});}
    else if(pc===MERGE){ev=null;}   // слитый путь: ни стирания, ни сейва нет вовсе
  }
  return false;};
let seed=987654321; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(frame=0;frame<NF;frame++){
  if(frame%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(frame>0&&frame%500===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  v06c.oneInterrupt(true);
}
judge();
console.log(`ROM=${ROM.split("/").pop()} кадров=${NF}, пачек старого пути ${batches}, стираний ${rests}, сейвов ${saves}`);
console.log(`СЕЙВ РАНЬШЕ СТИРАНИЯ ПЕРЕСЕКАЮЩЕГОСЯ СОСЕДА (протухший save-under): ${badSave}`);
console.log(`ВЫВОД РАНЬШЕ СТИРАНИЯ ПЕРЕСЕКАЮЩЕГОСЯ СОСЕДА (стирание затрёт вывод): ${badShow}`);
for(const s of samp)console.log("   "+s);
console.log((badSave||badShow)?"SPR ORDER GATE FAIL":"SPR ORDER GATE OK");
process.exit((badSave||badShow)?1:0);
