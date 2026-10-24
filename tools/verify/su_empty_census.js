// su_empty_census.js — ЗАДАЧА#49: ПЕРЕПИСЬ «ФОН ПОД ОБЪЕКТОМ ПУСТ».
// ЗАЧЕМ. Идея владельца: «может не сохранять под героем поле, а восстанавливать из карты
// тайлов?». Буквальная форма отвергнута арифметикой (клетка кирпича стоит 1308 тактов,
// герой накрывает 4-9 клеток, а весь save-under кадра — 1586), но у неё есть рабочая:
// ЕСЛИ ФОН ПОД ГАБАРИТОМ — НУЛИ, то сдвигать блок фона в слоте не нужно (сдвиг нулей =
// тождество), а слитая запись «фон OR спрайт» вырождается в «записать спрайт».
// ЭТОТ ИНСТРУМЕНТ МЕРИТ ГЛАВНОЕ ЧИСЛО: как часто блок фона в слоте ЦЕЛИКОМ НУЛЕВОЙ —
// отдельно по геймплейным слотам (герой 4-5, мумии 6-13, нож 14-18). Ворота 0-3 и спрайты
// карты долины 19-20 считаются отдельно и в решении не участвуют (они не геймплей).
// ПОЧЕМУ ФОН ПУСТ. Спрайт ростом 16 строк = РОВНО высота коридора, а кирпичи лежат строго
// вне габарита; кроме того тайлы поля живут в p0/p1, а герой и мумии пишут p1/p2.
// Плюс разбор сдвига по фазам (1 хвост / 2 сдвиг блока / 3 добор края) — фаза 2 и есть та,
// которую приём убирает.
// Запуск: node tools/verify/su_empty_census.js [rom] [sym] [кадров]
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
const OUT=L.vec_spr_out,MRG=L.vso_merge1,SH=L.vsm_shift,WR=L.vsm_wr,
      P2U=L.vsm_p2u,P2D=L.vsm_p2d,P3=L.vsm_p3;
for(const [n,v] of [["vec_spr_out",OUT],["vso_merge1",MRG],["vsm_shift",SH],["vsm_wr",WR],
                    ["vsm_p2u",P2U],["vsm_p2d",P2D],["vsm_p3",P3]])
  if(v===undefined){console.log("нет символа "+n+" в .sym");process.exit(2);}
const cat=i=>i<4?"ворота":i<6?"герой":i<14?"мумии":i<19?"нож":"карта";
const pg=i=>0xE000+i*256;
const S={};
const st=k=>S[k]||(S[k]={n:0,zero:0,bytes:0,nzb:0,sh:0,t1:0,t2:0,t3:0,tot:0});
// блок фона слота целиком нулевой? (размер — по ШАПКЕ: ncols +3, hi0b +4, hi0c +5)
function blockZero(i){
  const p=pg(i),nc=rd(p+3);
  if(!rd(p)||!nc) return null;
  const nb=16*nc*(1+(rd(p+4)?1:0)+(rd(p+5)?1:0));
  let nz=0; for(let b=0;b<nb;b++) if(rd(p+6+b))nz++;
  return {nb,nz};
}
let packs=0,objs=0,cur=null,idx=0;
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===OUT&&rd(L.GameStatus)===5)packs++;
  if(pc===MRG&&rd(L.GameStatus)===5){
    idx=rd(L.vec_nsp_idx);
    const z=blockZero(idx);
    if(z){const s=st(cat(idx));s.n++;objs++;s.bytes+=z.nb;s.nzb+=z.nz;if(!z.nz)s.zero++;}
    cur=null;}
  else if(pc===SH){cur={i:idx,t0:TT,p2:-1,p3:-1};}
  else if(cur&&(pc===P2U||pc===P2D)&&cur.p2<0)cur.p2=TT;
  else if(cur&&pc===P3&&cur.p3<0)cur.p3=TT;
  else if(cur&&pc===WR){const s=st(cat(cur.i));s.sh++;s.tot+=TT-cur.t0;
    const p2=cur.p2<0?(cur.p3<0?TT:cur.p3):cur.p2;
    s.t1+=p2-cur.t0;
    if(cur.p3>=0){s.t2+=cur.p3-p2;s.t3+=TT-cur.p3;}
    cur=null;}
  return false;};
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  v06c.oneInterrupt(true);}
console.log(`ROM=${ROM.split("/").pop()} кадров ${NF}, пачек GS=5 ${packs}, объектов слитой записи ${objs}`);
let gN=0,gZ=0;
for(const k of ["герой","мумии","нож","ворота","карта"]){
  const s=S[k]; if(!s)continue;
  const play=k==="герой"||k==="мумии"||k==="нож";
  if(play){gN+=s.n;gZ+=s.zero;}
  console.log(`${k}${play?"":" (вне геймплея, справочно)"}: объектов ${s.n}`);
  console.log(`   БЛОК ФОНА ЦЕЛИКОМ НУЛЕВОЙ: ${s.zero} = ${(100*s.zero/s.n).toFixed(1)}%`+
              `  (ненулевых байт ${s.nzb} из ${s.bytes} = ${(100*s.nzb/Math.max(1,s.bytes)).toFixed(2)}%)`);
  if(s.sh)console.log(`   сдвигов габарита ${s.sh}, тактов на сдвиг ${(s.tot/s.sh).toFixed(0)}`+
              ` = фаза1 хвост ${(s.t1/s.sh).toFixed(0)} + фаза2 сдвиг блока ${(s.t2/s.sh).toFixed(0)}`+
              ` + фаза3 край ${(s.t3/s.sh).toFixed(0)}`);
}
console.log(`\nГЛАВНОЕ ЧИСЛО (герой+мумии+нож): ${gZ}/${gN} = ${(100*gZ/Math.max(1,gN)).toFixed(1)}% выводов идут по ПУСТОМУ фону`);
console.log(`ФАЗА 2 (сдвиг блока) у объектов с нулевым блоком обязана быть 0 тактов —`+
            ` это и есть приём ЗАДАЧИ#49 (см. vsm_ph3 в vec_sprout.asm).`);
