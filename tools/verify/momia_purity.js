// momia_purity.js — ЧИСТОТА ЦВЕТА МУМИИ: сколько пикселей её силуэта «загрязнены» фоном.
//
// ЗАЧЕМ. Мумия одноплоскостная: её силуэт кладётся OR-ом в ОДНУ плоскость (p0 у золотых,
// p2 у серых). Если под силуэтом в ДРУГИХ видимых плоскостях остались биты фона, пиксель
// получает чужой индекс палитры — фон «просвечивает» сквозь фигуру. Задача #41/#42 гасит
// такие плоскости; детектор решает это по габариту, поэтому ЛЮБАЯ правка габарита может
// изменить чистоту. Метрика меряет результат прямо на экране, а не решение детектора.
//
// Считает СРАЗУ ПОСЛЕ ПАЧКИ (vec_spr_out отработал, всё нарисовано): для каждой мумии
// берётся её ЗАПИСЬ ВЫВОДА (hi0/lo0/ncols) и СДВИНУТЫЙ СИЛУЭТ из слота (+0xA0), и по
// каждому биту силуэта проверяются две ЧУЖИЕ видимые плоскости.
// Мумия опознаётся по паттерну (0x28-0x33 прямые, 0x88-0x93 зеркальные) — слоты врагов
// 6-13 держат и других тварей, у них свой набор спрайтов.
//
// Запуск: node tools/verify/momia_purity.js [rom] [sym] [кадров на пирамиду] [пирамид]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const PF=+(process.argv[4]||900), NP=+(process.argv[5]||8);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu,memory}=E;
const isMomia=p=>(p>=0x28&&p<0x34)||(p>=0x88&&p<0x94);
let outs=0, silPx=0, dirtyPx=0, dirtyOuts=0, live=false, frames=0;
let retSP=-1, retPC=-1;
// ЗАПИСЬ ВЫВОДА живёт только ДО пачки (она сбрасывает pending), а фон под силуэтом
// оценивать надо ПОСЛЕ неё — поэтому геометрия снимается на входе, а пиксели на выходе.
let pending=[];
function beforePack(){
  pending=[];
  const n=rd(L.vsp_n);
  for(let k=0;k<n;k++){
    const idx=rd(L.vsp_list+k), pg=0xE000+idx*256;
    if(idx<6||idx>13)continue;
    if(rd(pg+0x96)!==1)continue;
    if(!isMomia(rd(L.sprAttrib+idx*4+2)))continue;
    const nc=rd(pg+0x99); if(!nc)continue;
    // ЗАДАЧА#51: мумия больше не обязана быть одноплоскостной — цвет idx6/idx10 кладётся
    // ДВУМЯ своими плоскостями (hi0 + hi0b). Признак «hi0b РИСУЕТ, а не ГАСИТ» — байт
    // слота +0xD0 (0 = OR, 1 = ANDN, см. vec_spr_show). Своя вторая плоскость чужой не
    // является, и считать её примесью нельзя: иначе метрика ругается на собственный цвет.
    const own2=rd(pg+0xD0)?0:rd(pg+0x9F);
    pending.push([pg,nc,rd(pg+0x97),rd(pg+0x98),own2]);
  }
}
function afterPack(){
  for(const [pg,nc,hi0,lo0,own2] of pending){
    // две чужие видимые плоскости: 0x80 -> 0xA0 -> 0xC0 -> 0x80 (столбец сохраняется);
    // если одна из них — ВТОРАЯ СВОЯ (own2), она из проверки выпадает.
    const rot=h=>{let a=h+0x20;if(a>=0xE0)a-=0x60;return a;};
    const p1=rot(hi0), p2=rot(p1);
    let sil=0, dirty=0;
    for(let c=0;c<nc;c++)for(let r=0;r<16;r++){
      const s=rd(pg+0xA0+c*16+r); if(!s)continue;
      const b1=(p1===own2)?0:rd((((p1+c)&0xFF)<<8)|((lo0+r)&0xFF));
      const b2=(p2===own2)?0:rd((((p2+c)&0xFF)<<8)|((lo0+r)&0xFF));
      for(let b=0;b<8;b++)if(s&(1<<b)){sil++;if((b1|b2)&(1<<b))dirty++;}
    }
    outs++; silPx+=sil; dirtyPx+=dirty; if(dirty)dirtyOuts++;
  }
  pending=[];
}
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===L.vec_spr_out&&retPC<0&&live){retSP=cpu.sp;retPC=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);beforePack();}
  else if(retPC>=0&&pc===retPC&&cpu.sp>retSP){retPC=-1;afterPack();}
  return false;
};
// --- ДРАЙВЕР СЦЕНЫ: --ticks N подаёт ввод по ИГРОВЫМ ТИКАМ (см. spr_cols.js) ---------
const TI=process.argv.indexOf("--ticks"), NT=TI>0?+(process.argv[TI+1]||2600):0;
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
let seed=2024;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const KS=[37,39,38,40];let held=-1;
function step(){v06c.oneInterrupt(true);live=(rd(L.GameStatus)===5);if(live)frames++;}
if(NT){
  let tick=0,prevT=rd(L.timer),heldSet=new Set(),guard=0;
  while(tick<=NT&&guard++<400000){
    const want=new Set(keysForTick(tick));
    for(const c of heldSet)if(!want.has(c))E.key(c,0);
    for(const c of want)if(!heldSet.has(c))E.key(c,1);
    heldSet=want;
    step();
    const t=rd(L.timer); if(t!==prevT){prevT=t;tick++;}
  }
}else
for(let p=0;p<NP;p++){
  if(p>0){live=false;E.key(78,1);step();E.key(78,0);
    for(let i=0;i<3000&&rd(L.GameStatus)!==5;i++)step();
    for(let i=0;i<40;i++)step();}
  for(let f=0;f<PF;f++){
    if(f%17===0){const k=KS[(rnd()*4)|0];if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
    step();
    if(rd(L.GameStatus)!==5)for(let i=0;i<3000&&rd(L.GameStatus)!==5;i++)step();
  }
  if(held>0){E.key(held,0);held=-1;}
}
console.log(`ROM=${ROM.replace(/.*\//,"")} кадров геймплея ${frames}, выводов мумий ${outs}`);
console.log(`  пикселей силуэта ${silPx}, загрязнено фоном ${dirtyPx} (${(100*dirtyPx/Math.max(1,silPx)).toFixed(2)}%)`);
console.log(`  выводов с примесью ${dirtyOuts} (${(100*dirtyOuts/Math.max(1,outs)).toFixed(1)}%), в среднем ${(dirtyPx/Math.max(1,dirtyOuts)).toFixed(1)} пикс на поражённый вывод`);
