// ШАГ 2, проверка идеи владельца ЧИСЛОМ: перенести обработку объекта в «окно после луча».
// Единственные точки в коде, куда можно посадить второй проход, — внутри тика:
//   A) сразу после подготовки vec_nat_sprites,  B) в конце тика H_TIMI.
// Для КАЖДОГО реально выведенного объекта считаем, что было бы, если бы его пара
// (стирание+вывод) уехала на этот якорь: попадает ли запись ПОД ЛУЧ (рвёт объект)
// и на сколько кадров сдвигается момент, когда объект впервые виден.
// Арифметика по модулю кадра: луч над строкой Y приходит в моменты irq0+m*59904+BEAM0+192Y.
//
// ИСТОРИЧЕСКИЙ WHAT-IF (задача #5). Идея ОТВЕРГНУТА замером — НЕ приёмка фликера.
// Нет хуков merge/vpr_wr намеренно: это снимок эпохи «только SHOW»; для живой ROM
// использовать beam_ab / beam_tear / beam_color / hero_atomic.
//
// ===== АУДИТ МЕТРИК 2026-08-09 ========================================================
// ЧТО ПОЧИНЕНО: SHOW читал lo0 из шапки (+2); рисует из +0x98. BEAM0 учитывает vscroll.
// ОТКАТ: rd(pg+2)/rd(pg+3) и зашитое 13780 в beamAfter.
// ПРОВЕРКА: инструмент сравнительный; регрессия = изменение относительного вердикта
// «якорь хуже as-is», а не абсолютных пикселей. Merge по-прежнему не видит — OK.
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||8000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;
const FR=59904;
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));
const ISR=L.vec_isr,OUT=L.vec_spr_out,NAT=L.vec_nat_sprites,TICK=L.H_TIMI,
      SHOW=L.vec_spr_show,REST=L.vec_su_restore;
let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
let irq0=-1, cur=null;
const frames=[];
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
const B={out:{pc:OUT},nat:{pc:NAT},tick:{pc:TICK}};
for(const k in B){B[k].ret=-1;B[k].sp=-1;}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0){
    if(cur)frames.push(cur);
    if(irq0<0)irq0=TT;
    cur={irq:TT,outS:-1,natE:-1,tickE:-1,er:{},draws:[],gs:rd(L.GameStatus)};}
  if(!cur)return false;
  for(const k in B){const b=B[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();if(k==="out")cur.outS=TT;}
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){b.ret=-1;
      if(k==="nat")cur.natE=TT; else if(k==="tick")cur.tickE=TT;}}
  if(pc===REST){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256; if(rd(pg))cur.er[i]=TT;}
  // 2026-08-09: геометрия ВЫВОДА +0x98/+0x99. Откат: +2/+3.
  if(pc===SHOW){const i=rd(L.vec_nsp_idx),pg=0xE000+i*256;
    cur.draws.push({i,t:TT,lo0:rd(pg+0x98),nc:rd(pg+0x99),te:cur.er[i]!==undefined?cur.er[i]:-1});}
  return false;};
let seed=12345; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  if(cur)cur.gs=rd(L.GameStatus);
  v06c.oneInterrupt(true);
}
if(held>0)E.key(held,0);
if(cur)frames.push(cur);

// луч над строкой Y: моменты irq0 + m*FR + BEAM0 + 192*Y
const beamAfter=(t,Y)=>{const b=BEAM0+192*Y; const m=Math.ceil((t-irq0-b)/FR); return irq0+m*FR+b;};
const crosses=(t0,t1,Y)=>beamAfter(t0,Y)<t1;          // луч прошёл строку между t0 и t1
const visFrame=(t,Y)=>Math.floor((beamAfter(t,Y)-irq0)/FR); // номер кадра, когда стало видно

function evalScheme(shift){ // shift(fr,prevFr) -> сдвиг всей пары (стирание,вывод) или null
  let obj=0,tornObj=0,tornPx=0,lagSum=0,lagHist={},noAnchor=0;
  for(let i=1;i<frames.length;i++){
    const fr=frames[i],pv=frames[i-1];
    if(fr.gs!==5||pv.gs!==5)continue;
    for(const d of fr.draws){ if(!d.nc||d.te<0)continue;
      const Ytop=255-(d.lo0+15); if(Ytop<0||Ytop>190)continue;
      const s=shift(fr,pv,d); if(s===null){noAnchor++;continue;}
      obj++;
      const te=d.te+s, td=d.t+s;
      let px=0;
      for(let k=0;k<16;k++){const Y=Ytop+k; if(crosses(te,td,Y))px+=d.nc*8;}
      if(px){tornObj++;tornPx+=px;}
      const lag=visFrame(td,Ytop)-visFrame(d.t,Ytop);
      lagSum+=lag; lagHist[lag]=(lagHist[lag]||0)+1;
    }}
  return {obj,tornObj,tornPx,lagSum,lagHist,noAnchor};
}
function pr(name,r){
  const h=Object.keys(r.lagHist).map(Number).sort((a,b)=>a-b)
    .map(k=>`${k>0?"+":""}${k}к:${(100*r.lagHist[k]/r.obj).toFixed(1)}%`).join(" ");
  console.log(`${name.padEnd(34)} объектов ${String(r.obj).padStart(5)} | РВЁТСЯ ЛУЧОМ ${String(r.tornObj).padStart(5)} (${(100*r.tornObj/r.obj).toFixed(1)}%), ${String(r.tornPx).padStart(6)} пикс | задержка avg ${(r.lagSum/r.obj).toFixed(2)} кадра [${h}]${r.noAnchor?`  нет якоря: ${r.noAnchor}`:""}`);
}
console.log(`ROM=${ROM.split("/").pop()} внешних ISR=${frames.length}`);
console.log(`\n=== ЧТО ЕСТЬ СЕЙЧАС (пачка в начале кадра) ===`);
pr("как есть",evalScheme(()=>0));
console.log(`\n=== ЕСЛИ ПЕРЕНЕСТИ ПАРУ (стирание+вывод) НА ЯКОРЬ ВНУТРИ ТИКА ===`);
pr("A) сразу после vec_nat_sprites",evalScheme((fr,pv,d)=>pv.natE<0?null:pv.natE-fr.outS));
pr("B) в конце тика H_TIMI",evalScheme((fr,pv,d)=>pv.tickE<0?null:pv.tickE-fr.outS));
// только верхняя зона на якорь, остальное как есть
for(const K of [32,48,64,80,96]){
  pr(`A) только Ytop<${K}, остальное как есть`,evalScheme((fr,pv,d)=>{
    const Y=255-(d.lo0+15); if(Y>=K)return 0; return pv.natE<0?null:pv.natE-fr.outS;}));
}
