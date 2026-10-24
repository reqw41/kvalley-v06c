// door_stand_beam.js — «ГЕРОЙ СТОИТ, ВОРОТА ЗАКРЫВАЮТСЯ, СПРАЙТ МЕРЦАЕТ»
// (жалоба с железа, MiSTer, 2026-08-06).
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ door_beam / door_leaf_purity. Те меряют СТВОРКУ (слоты 0-3): её цвет
// и её своевременность. Здесь предмет замера — ГЕРОЙ, и сцена подобрана так, что он
// ЗАВЕДОМО НЕПОДВИЖЕН: спустился по лестнице входа и стоит, пока анимация закрытия ворот
// блитит клетки. Неподвижный объект перерисовывать не за чем — если он всё-таки мерцает,
// значит его КТО-ТО СТИРАЕТ. Кто именно — показывает атрибуция по PC писателя.
//
// МЕТОД тот же, что в jump_top_beam.js (он честнее модельных метрик вдвойне):
//   1) ЧАСЫ ЛУЧА ИЗ ЭМУЛЯТОРА (cyc = такты от запроса IRQ), а не «от входа в ISR»:
//      под DI вход в ISR уезжает, и модель перестаёт видеть своё опоздание;
//   2) СВЕРКА ПО БАЙТАМ fb: запоминается, ЧТО вывод героя записал в каждый байт, и в
//      момент прохода луча над строкой байты ЧИТАЮТСЯ ИЗ ПАМЯТИ и сравниваются. Автомат
//      «стёрли -> вывели» слеп к затирателю, который не vec_su_restore, — а здесь именно
//      такой случай: героя стирает ТАЙЛОВЫЙ БЛИТ анимации ворот.
//
// ДЕКЛАРАЦИЯ ПОКРЫТИЯ (иначе exit 1): в прогоне обязана найтись стоянка героя >= 60
// кадров с НЕИЗМЕННЫМИ Y/X/pat обеих половин пары, и внутри неё обязаны идти блиты
// тайлов ворот (0x5C..0x81) не меньше чем на 2 кадрах — то есть анимация закрытия
// реально попала в замер. Без этого гейт зеленел бы на пустой выборке.
//
// Запуск: node tools/verify/door_stand_beam.js [rom] [sym] [кадров=420] [-v]
"use strict";
const {make}=require("/Users/boris/projects/kvalley-v06c/tools/verify/beam_harness.js");
const T="/Users/boris/projects/kvalley-v06c";
const pos=process.argv.slice(2).filter(a=>/\.(rom|sym)$/.test(a));
const ROM=pos[0]||T+"/build/kvalley_8c.rom";
const SYM=pos[1]||ROM.replace(/\.rom$/,".sym");
const NF=+(process.argv.find(a=>/^\d+$/.test(a))||420);
const VERB=process.argv.includes("-v");
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu,key}=E;
const BEAM=Y=>13780+192*Y, cyc=E.cyc;
const HERO=new Set([4,5]);
const REST=L.vec_su_restore, SHOW=L.vec_spr_show, MERGE=L.vso_merge1, OUT=L.vec_spr_out;
const KA=L.vpr_ka, KB=L.vpr_kb, WA=L.vop_wa, WB=L.vop_wb, VPR_PA=0x29, VPR_PB=0x2B;
// ЗАДАЧА#53 (2026-08-07): пара героя пишется СТЕК-БЛИТОМ (vpz_col/vpz_bh в
// vec_sprout.asm), а не через vpr_ka/vpr_kb. Слот берём из САМОМОДИФИЦИРУЕМОГО
// операнда `ld h,страница_слота` — он верен и для пары, и для одиночного объекта.
const PZA=L.vpz_pa, PZB=L.vpz_pb;

const rowMap=[]; for(let i=0;i<192;i++)rowMap[i]=new Map();
const rowOf=a=>(255-(a&255))&255;
const lastPC=new Uint16Array(0x6000);
let curSlot=-1, phase=0, inPack=false;
let restRet=-1,restSp=-1, showRet=-1,showSp=-1, outRet=-1,outSp=-1;
const oW=memory.write.bind(memory);
memory.write=function(addr,w8,st){
  const a=addr&0xffff;
  if(a>=0x8000&&a<0xE000){
    lastPC[a-0x8000]=cpu.pc;
    if(phase&&HERO.has(curSlot)){
      const row=rowOf(a);
      if(row<192){
        if(phase===1)rowMap[row].delete(a);
        else{const before=rd(a);
          if((w8&255)!==before)rowMap[row].set(a,w8&255); else rowMap[row].delete(a);}
      }
    }
  }
  return oW(addr,w8,st);
};
const retOf=()=>memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
function prune(){
  const keepRow=new Uint8Array(256), keepCol=new Uint8Array(32); let any=false;
  for(const s of [4,5]){const pg=0xE000+s*256;
    if(!rd(pg))continue;
    const hi0=rd(pg+1),lo0=rd(pg+2),nc=rd(pg+3); if(!nc)continue;
    any=true;
    for(let k=0;k<16;k++)keepRow[(lo0+k)&255]=1;
    for(let k=0;k<nc;k++)keepCol[(hi0+k)&0x1F]=1;}
  if(!any)return;
  for(let row=0;row<192;row++){const m=rowMap[row];if(!m.size)continue;
    for(const a of m.keys())if(!keepRow[a&255]||!keepCol[(a>>8)&0x1F])m.delete(a);}
}
let prevC=1e9, nextRow=192, sPresent=0, sAbsent=0;
const killer={};
function sampleRow(row){
  const m=rowMap[row]; if(!m.size)return;
  for(const [a,v] of m){ if(rd(a)===v)sPresent++;
    else{sAbsent++;const k=lastPC[a-0x8000];killer[k]=(killer[k]||0)+1;} }
}
let blits=0, doorTiles=0, fxHero=0;
v06c.check_breakpoint=function(){const pc=cpu.pc;
  const c=cyc();
  if(c<prevC-2000){bfNew();}
  prevC=c;
  while(nextRow<192&&c>=BEAM(nextRow)){sampleRow(nextRow);nextRow++;}
  if(pc===OUT&&outRet<0){outSp=cpu.sp;outRet=retOf();inPack=true;}
  else if(outRet>=0&&pc===outRet&&cpu.sp>outSp){outRet=-1;inPack=false;phase=0;curSlot=-1;prune();}
  if(pc===REST&&restRet<0){restSp=cpu.sp;restRet=retOf();curSlot=rd(L.vec_nsp_idx);phase=1;}
  else if(restRet>=0&&pc===restRet&&cpu.sp>restSp){restRet=-1;phase=0;}
  if((pc===SHOW||pc===MERGE)&&showRet<0){showSp=cpu.sp;showRet=retOf();curSlot=rd(L.vec_nsp_idx);phase=2;}
  else if(showRet>=0&&pc===showRet&&cpu.sp>showSp){showRet=-1;phase=0;}
  if(inPack&&showRet<0&&restRet<0){
    if(pc===KA||pc===WA){curSlot=(rd(VPR_PA)-0xE0)&255;phase=2;}
    else if(pc===KB||pc===WB){curSlot=(rd(VPR_PB)-0xE0)&255;phase=2;}
    else if(pc===PZA){curSlot=(rd(PZA+1)-0xE0)&255;phase=2;}
    else if(pc===PZB){curSlot=(rd(PZB+1)-0xE0)&255;phase=2;}
  }
  if(pc===L.vbt8_ent){blits++;const t=rd(L.vw_byte);if(t>=0x5C&&t<=0x81)doorTiles++;}
  return false;};
function bfNew(){nextRow=0;}

// ---- старт настоящей партии на пирамиде 1 ----
const runf=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
runf(700);
for(let i=0;i<30;i++){key(32,1);runf(3);key(32,0);runf(3);}
if(rd(L.piramideActual)!==1){console.log("ПРОВАЛ ПОКРЫТИЯ: piramideActual="+rd(L.piramideActual));process.exit(1);}

// ---- прогон: НИ ОДНОЙ клавиши, герой стоит сам ----
const recs=[];
for(let f=0;f<NF;f++){
  sPresent=0;sAbsent=0;blits=0;doorTiles=0;
  const spr=[4,5].map(i=>[rd(L.sprAttrib+i*4),rd(L.sprAttrib+i*4+1),rd(L.sprAttrib+i*4+2)]);
  const doors=[0,1,2,3].filter(s=>rd(0xE000+s*256+0x96)===1).length;
  v06c.oneInterrupt(true);
  let n=0;for(let i=0;i<192;i++)n+=rowMap[i].size;
  recs.push({f,gs:rd(L.GameStatus),spr,doors,present:sPresent,absent:sAbsent,bytes:n,
             blits,doorTiles});
}

// ---- ДЕКЛАРАЦИЯ ПОКРЫТИЯ ----
// 1) герой обязан СТОЯТЬ: серия кадров с неизменными Y/X/pat обеих половин пары;
// 2) анимация закрытия ворот обязана РЕАЛЬНО идти в этой серии: блиты тайлов ворот
//    при валидных слотах створок 0-3.
const key45=r=>r.spr.map(a=>a.join("/")).join("|");
let best=null,i=0;
while(i<recs.length){let j=i;while(j+1<recs.length&&key45(recs[j+1])===key45(recs[i]))j++;
  if(!best||j-i>best[1]-best[0])best=[i,j]; i=j+1;}
const [s0,s1]=best;
const seg=recs.slice(s0,s1+1);
const tiles=seg.reduce((a,r)=>a+r.doorTiles,0);
const anim=seg.filter(r=>r.doorTiles>0).length;
console.log(`ROM=${ROM.split("/").pop()}`);
console.log(`ПОКРЫТИЕ: самая длинная стоянка героя — кадры ${s0}..${s1} (${seg.length} кадров), `
  +`спрайт ${key45(recs[s0])}, слотов створок ${Math.max(...seg.map(r=>r.doors))}`);
console.log(`  блитов тайлов ворот внутри стоянки: ${tiles} на ${anim} кадрах`);
if(seg.length<60){console.log("ПРОВАЛ ПОКРЫТИЯ: стоянка короче 60 кадров");process.exit(1);}
if(tiles<10||anim<2){console.log("ПРОВАЛ ПОКРЫТИЯ: анимации закрытия ворот в стоянке нет");process.exit(1);}

// ---- ОТЧЁТ ----
const pct=(a,b)=>b?(100*a/b).toFixed(1)+"%":"—";
let blank=0,part=0,ok=0,nobytes=0;
for(const r of seg){const tot=r.present+r.absent;
  if(tot===0){nobytes++;continue;}
  if(r.present===0)blank++; else if(r.present<tot*0.75)part++; else ok++;}
console.log(`ЛУЧ ВИДИТ ГЕРОЯ (байты спрайта в fb на момент прохода луча над строкой):`);
console.log(`   целиком (>=75%)  ${ok} = ${pct(ok,seg.length)}`);
console.log(`   частично         ${part} = ${pct(part,seg.length)}`);
console.log(`   НЕ ВИДИТ ВОВСЕ   ${blank} = ${pct(blank,seg.length)}`);
console.log(`   карта пуста      ${nobytes} = ${pct(nobytes,seg.length)}`);
const tot=seg.reduce((a,r)=>a+r.present+r.absent,0), abs=seg.reduce((a,r)=>a+r.absent,0);
console.log(`   байт-кадров всего ${tot}, из них ПОТЕРЯНО ${abs} = ${pct(abs,tot)}`);
const ks=Object.entries(killer).sort((a,b)=>b[1]-a[1]).slice(0,8);
console.log(`ЗАТИРАТЕЛИ байтов героя (PC): `+ks.map(([k,v])=>`0x${(+k).toString(16)}:${v}`).join(" "));
// длительность «дыр»
let holes=[],cur=0;
for(const r of seg){const t=r.present+r.absent;
  if(t===0||r.present<t*0.75)cur++; else {if(cur)holes.push(cur);cur=0;}}
if(cur)holes.push(cur);
console.log(`ДЫРЫ (подряд идущие кадры, где герой виден меньше чем на 75%): ${holes.length} шт, `
  +`длины [${holes.join(",")}] кадров`);
if(VERB)for(const r of seg)console.log(`  #${r.f} gs=${r.gs} present=${r.present} absent=${r.absent} `
  +`bytes=${r.bytes} blits=${r.blits}/${r.doorTiles}`);
