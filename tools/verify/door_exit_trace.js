// door_leaf_purity.js — ЦВЕТ И СТАБИЛЬНОСТЬ СТВОРОК ВОРОТ В ЖИВЫХ СЦЕНАХ.
//
// ЗАЧЕМ. Створки (слоты 0-3, setSprDoorProta/chkSalePiram) — единственные masked-объекты
// движка; правая створка накрывает героя на входе в пирамиду и на выходе из неё. Жалобы
// владельца по этим воротам приходили трижды: «правая сторона мерцает от героя», «ворота
// не зелёные», «внутри ступеньки не раскрашены».
//
// ПОЧЕМУ ГЕЙТ ПЕРЕПИСАН (2026-08-04). Прежняя редакция просто гоняла эмулятор от буста и
// мерила «кадры, где створки выведены». Она зеленела, НЕ ВИДЯ сцену владельца: без нажатия
// клавиши игра уходит в АТТРАКТ-ДЕМО, а демо жёстко стартует на ПИРАМИДЕ 5 (SetDemo кладёт
// в piramideDest 5). Владелец же смотрел ВХОД НА ПЕРВУЮ ПИРАМИДУ. Отсюда правило, которое
// теперь зашито в гейт: СЦЕНЫ ОБЪЯВЛЕНЫ ЯВНО И ГЕЙТ ПАДАЕТ, ЕСЛИ СЦЕНА НЕ НАЙДЕНА, —
// молча зеленеть на пустой выборке он больше не может.
//
// СЦЕНЫ (обе обязательные):
//   1) ВХОД НА ПИРАМИДУ 1 — настоящая партия (пробел из меню), InitStage: герой выходит
//      из ворот и спускается по лестнице, дверь за ним закрывается.
//   2) ВЫХОД ИЗ ПИРАМИДЫ 1 — штатный chkSalePiram (как в door_exit_regression): двери
//      ставится статус «открыта, ждёт выхода», герой телепортируется в salidaArea, и
//      игра САМА расставляет четыре спрайта правой створки поверх героя.
//
// ЧТО МЕРЯЕТ в каждой сцене, палитро-корректно (индексы палитры, а не биты плоскостей):
//   * ЦВЕТ СТВОРКИ. По записи вывода слота берётся СДВИНУТЫЙ СИЛУЭТ (+0xA0) и для каждого
//     его бита читается индекс на экране. Своих цветов у створки ДВА: idx14 (лица кирпичей)
//     и idx6 (швы). Всё остальное — брак:
//       - idx8/idx10/idx0 значит, что створку ЗАТЁРЛИ ТАЙЛЫ ворот и на её месте виден
//         кирпич в тон камня уровня (ровно то, на что жаловался владелец);
//       - idx2/idx4 значит, что СКВОЗЬ СТВОРКУ ПРОСВЕЧИВАЕТ ГЕРОЙ (одежда/кожа).
//   * МЕРЦАНИЕ. Пока запись вывода не менялась, картинка обязана быть той же: считаем
//     пиксели, сменившие индекс между соседними кадрами при неизменной геометрии.
//
// Запуск: node tools/verify/door_leaf_purity.js [rom] [sym] [--png КАТАЛОГ]
"use strict";
const fs=require("fs"),path=require("path");
const {make}=require("./beam_harness.js");
const T=__dirname;
const pos=process.argv.slice(2).filter(a=>/\.(rom|sym)$/.test(a));
const ROM=pos[0]||T+"/../../build/kvalley_8c.rom";
const SYM=pos[1]||ROM.replace(/\.rom$/,".sym");
const gi=process.argv.indexOf("--png"), PNGDIR=gi>0?process.argv[gi+1]:null;
if(PNGDIR) fs.mkdirSync(PNGDIR,{recursive:true});
const E=make(ROM,SYM);
const {L,rd,v06c,run,key}=E;
const wr=(a,v)=>E.memory.write(a&0xffff,v&0xff,false);
const need=n=>{if(L[n]===undefined){console.log(`нет символа ${n} в ${SYM}`);process.exit(2);} return L[n];};
const A={};
for(const n of ["GameStatus","piramideActual","piramideDest","puertaEntrada","flagPiramideMap",
  "flagEntraSale","flagStageClear","protaStatus","ProtaY","ProtaXdecimal","ProtaX","ProtaRoom",
  "pyramidDoors","sprAttrib"]) A[n]=need(n);

// Индекс палитры пикселя. p3 НЕ читаем: плоскость схлопнута (палитра[2k]==палитра[2k+1]),
// а её страницы заняты слотами save-under — чтение дало бы мусор.
const idxAt=(col,lo,b)=>{const a=0x8000+((col&31)<<8)+(lo&255);
  return ((rd(a)>>b)&1)<<3|((rd(a+0x2000)>>b)&1)<<2|((rd(a+0x4000)>>b)&1)<<1;};
// Силуэт створки из ЗАПИСИ ВЫВОДА: {ключ пикселя -> индекс палитры}
function leafPx(slot){
  const pg=0xE000+slot*256;
  if(rd(pg+0x96)!==1) return null;              // 1 = «нарисован», 2 = скрыт
  const nc=rd(pg+0x99); if(!nc) return null;
  const hi0=rd(pg+0x97), lo0=rd(pg+0x98), out={};
  for(let c=0;c<nc;c++)for(let r=0;r<16;r++){
    const v=rd(pg+0xA0+c*16+r); if(!v)continue;
    for(let b=0;b<8;b++) if(v&(1<<b)){
      const col=(hi0+c)&31, lo=(lo0-r)&255;
      out[col+":"+lo+":"+b]=idxAt(col,lo,b);
    }
  }
  return Object.keys(out).length?out:null;
}
const OWN=new Set([6,14]);                       // свои цвета створки
const TILE=new Set([0,8,10,12]);                 // фон/тайл ворот проступил
const HERO=new Set([2,4]);                       // герой просвечивает

// ФРЕЙМЫ, В КОТОРЫХ ПАЧКА РЕАЛЬНО ВЫВЕЛА СТВОРКУ. Это разделение принципиально: во время
// InitStage игровой тик длиннее кадра, следующие прерывания приходят ВЛОЖЕННО, а на
// вложенном уровне пачка не исполняется (vec_isr). Поэтому часть кадров анимации входа
// створки на экране просто НЕТ — и мерить по ним «какого она цвета» бессмысленно.
// Требование к цвету предъявляем к кадрам, где движок её нарисовал; «сколько кадров она
// отсутствовала» отчитываем отдельным числом.
// ВТОРОЕ РАЗДЕЛЕНИЕ: кадры, в которых ПОСЛЕ пачки блитились сами тайлы ворот. Пачка идёт
// в начале прерывания, а анимация закрытия двери рисует свои 15 клеток ПОЗЖЕ, уже в
// игровом тике, и затирает створку до следующего кадра. Пока анимация идёт, состояние
// створки на экране принципиально переходное — цвет спрашиваем только с УСТОЯВШИХСЯ
// кадров, а «сколько кадров створку затёрла анимация» отчитываем отдельно.
// === ТРЕТЬЯ СЦЕНА: ГЕРОЙ ПОД СТВОРКОЙ, ЛУЧЕВАЯ МЕТРИКА ==============================
// Жалоба с железа: «мерцание красным через правую зелёную створку, когда герой за неё
// уходит». В КАДРОВОМ снимке этого дефекта НЕТ — к концу кадра створка уже дорисована.
// Это ЛУЧЕВОЙ транзиент: лица кирпичей створки (idx14 = p0+p1+p2) приходят в кадр с
// погашенной p0 (её сбивает перерисовка блока ворот в игровом тике), а возвращает p0
// ДЕТАЛЬ створки — объект пачки. Если луч проходит над строкой раньше детали, пиксель
// показывается idx6 КРАСНЫМ. Старая метрика этого не видела вдвойне: искала idx2/idx4,
// а кожа героя и швы кирпича — оба idx6, и смотрела только конец кадра.
// Считаем ЧЕСТНО: снимаем реально повреждённые пиксели на входе в пачку и проверяем
// модель луча (та же, что в beam_late: приход над строкой Y = BEAM0 + 192*Y).
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));
let TT=0; const oI=E.cpu.instruction.bind(E.cpu);
E.cpu.instruction=function(){oI();TT+=E.cpu.vcycles|0;};
const retOf=()=>E.memory.read(E.cpu.sp,false)|(E.memory.read(E.cpu.sp+1,false)<<8);
// Габарит ворот на экране: столбцы и строки, накрытые слотами 0-3.
function leafRect(){
  let c0=99,c1=-1,loHi=-1,loLo=999;
  for(let s=0;s<4;s++){const pg=0xE000+s*256; if(rd(pg+0x96)!==1)continue;
    const nc=rd(pg+0x99); if(!nc)continue;
    const c=rd(pg+0x97)&31, lo=rd(pg+0x98);
    if(c<c0)c0=c; if(c+nc-1>c1)c1=c+nc-1;
    if(lo>loHi)loHi=lo; if(lo-15<loLo)loLo=lo-15;}
  return c1<0?null:{c0,c1,loHi,loLo};
}
// Снимок индексов палитры прямоугольника ворот: {lo -> массив индексов по строке}
function snapRect(R){const out={};
  for(let lo=R.loLo;lo<=R.loHi;lo++){const row=[];
    for(let c=R.c0;c<=R.c1;c++){const a=0x8000+((c&31)<<8)+(lo&255);
      const p0=rd(a),p1=rd(a+0x2000),p2=rd(a+0x4000);
      for(let b=7;b>=0;b--) row.push(((p0>>b)&1)<<3|((p1>>b)&1)<<2|((p2>>b)&1)<<1);}
    out[lo]=row;}
  return out;}
let tick0=0, shSP=-1, shRet=-1, snaps=null, rect=null;
let beamPix=0, beamFrames=0, overFrames=0;
function heroUnderLeaf(){
  const H=[]; for(const s of [4,5]){const pg=0xE000+s*256; if(rd(pg+0x96)!==1)continue;
    const nc=rd(pg+0x99); if(!nc)continue; H.push({c0:rd(pg+0x97)&31,nc,lo0:rd(pg+0x98)});}
  for(let s=0;s<4;s++){const pg=0xE000+s*256; if(rd(pg+0x96)!==1)continue;
    const nc=rd(pg+0x99); if(!nc)continue; const c0=rd(pg+0x97)&31, lo0=rd(pg+0x98);
    for(const h of H){ if(h.c0+h.nc<=c0||c0+nc<=h.c0) continue;
      if(h.lo0-16>=lo0||lo0-16>=h.lo0) continue; return true; }}
  return false;}
let drawnThisFrame=false, tiledThisFrame=false;
v06c.check_breakpoint=function(){
  const pc=E.cpu.pc;
  if(pc===L.vec_isr){tick0=TT; snaps=null; rect=null;}
  else if(pc===L.vec_spr_out){ rect=leafRect(); if(rect) snaps=[[0,snapRect(rect)]]; }
  if(pc===L.vec_spr_show&&shSP<0){shSP=E.cpu.sp;shRet=retOf();}
  else if(shSP>=0&&pc===shRet&&E.cpu.sp>shSP){
    if(snaps) snaps.push([TT-tick0,snapRect(rect)]);
    shSP=-1;}
  if(pc===L.vec_spr_show&&rd(L.vec_nsp_idx)<4) drawnThisFrame=true;
  else if(pc===L.vbt8_ent){const t=rd(L.vw_byte);
    if(t>=0x5C&&t<=0x81){ tiledThisFrame=true;
      tileCol=cpu.reg(1); tileNo=t; tileSP=cpu.sp;
      tileRet=E.memory.read(cpu.sp,false)|(E.memory.read(cpu.sp+1,false)<<8); }}
  else if(tileSP>=0&&pc===tileRet&&cpu.sp>tileSP){
    const e=rd(L.vbt8_e), h=tileHist.get(tileNo)||new Map();
    for(let r=0;r<8;r++)for(let b=7;b>=0;b--){const k=idxAt(tileCol,(e-r)&255,b);h.set(k,(h.get(k)||0)+1);}
    tileHist.set(tileNo,h); tileSP=-1;}
  return false;
};
const tileHist=new Map(), pal4=new Set(); let tileCol=0,tileNo=0,tileSP=-1,tileRet=-1;
const cpu=E.cpu;
const shown=[0,0,0,0];
{const oW=E.memory.write.bind(E.memory);
 E.memory.write=function(a,v,s){oW(a,v,s);
   const x=a&0xffff;if(x<0x8000||x>=0xE000)return;
   const si=rd(L.vec_nsp_idx);if(si<4)shown[si]++;};}
// Итог по кадру: сколько повреждённых пикселей луч успел показать до починки.
// ЧТО ПОКАЗАЛ ЛУЧ ПРОТИВ ТОГО, ЧЕМ КАДР ЗАКОНЧИЛСЯ. Модели «как должна выглядеть створка»
// здесь НЕТ вовсе: для каждой строки ворот берём снимок прямоугольника, актуальный на
// момент прихода луча, и сравниваем эту строку с ФИНАЛЬНЫМ состоянием кадра. Разошлось —
// значит зритель увидел не то, что осталось в кадре. Ровно это и есть «мерцание».
function beamTally(){
  if(!snaps||!rect){snaps=null;return;}
  if(!heroUnderLeaf()){snaps=null;return;}
  overFrames++;
  const fin=snapRect(rect);
  let hit=0;
  for(let lo=rect.loLo;lo<=rect.loHi;lo++){
    const Y=(255-lo)&255, tb=BEAM0+192*Y;
    let shot=snaps[0][1];
    for(const [t,S] of snaps) if(t<=tb) shot=S; else break;
    const a=shot[lo], b=fin[lo];
    for(let i=0;i<b.length;i++) if(a[i]!==b[i]) hit++;
  }
  if(hit){beamPix+=hit; beamFrames++;}
  snaps=null;
}
function newScene(name){return {name,frames:0,drawn:0,px:0,own:0,tile:0,hero:0,
  tiled:0,checked:0,hist:new Map(),flick:0,flickFrames:0,prev:null,prevGeo:"",shots:0,log:[]};}
function sample(S,tag){
  const all={};
  for(let s=0;s<4;s++){const p=leafPx(s); if(p) Object.assign(all,p);}
  const keys=Object.keys(all);
  if(!keys.length) return false;
  S.frames++;
  // Кадр годится для проверки цвета, если в нём НЕ перерисовывался блок ворот: анимация
  // закрытия легально затирает створку своими тайлами, и это переходное состояние.
  if(tiledThisFrame){S.tiled++;}
  if(drawnThisFrame) S.drawn++;
  S.checked++;
  for(const k of keys){const v=all[k]; S.px++;
    S.hist.set(v,(S.hist.get(v)||0)+1);
    if(OWN.has(v))S.own++; else if(HERO.has(v))S.hero++; else if(TILE.has(v))S.tile++;}
  const geo=keys.sort().join(",");
  if(S.prev&&geo===S.prevGeo){
    let d=0; for(const k of keys) if(S.prev[k]!==all[k])d++;
    if(d){S.flick+=d;S.flickFrames++;}
  }
  S.prev=all; S.prevGeo=geo;
  {const h={};for(const k of keys)h[all[k]]=(h[all[k]]||0)+1;
   S.log.push({f:S.frames,tiled:tiledThisFrame?1:0,drawn:drawnThisFrame?1:0,h,n:keys.length,
               out:[0,1,2,3].map(s=>shown[s]||0)});}
  if(PNGDIR&&S.shots<24){E.pngFrom(E.idealBmp(),path.join(PNGDIR,tag+"_"+String(S.shots).padStart(2,"0")+".png"));S.shots++;}
  return true;
}

// ---------- СЦЕНА 1: вход на пирамиду 1 (НАСТОЯЩАЯ партия, не аттракт) ----------
const S1=newScene("ВХОД НА ПИРАМИДУ 1");
run(700);
for(let i=0;i<30;i++){key(32,1);run(3);key(32,0);run(3);}   // старт игры из меню
if(rd(A.piramideActual)!==1){
  console.log(`ПРОВАЛ ПОКРЫТИЯ: после старта игры piramideActual=${rd(A.piramideActual)}, ждали 1.`);
  console.log("  (без нажатия клавиши игра уходит в аттракт-демо, а демо стартует на пирамиде 5)");
  process.exit(1);
}
for(let f=0;f<400;f++){
  v06c.oneInterrupt(true);
  beamTally();
  if(rd(A.GameStatus)===4&&rd(A.piramideActual)===1){ sample(S1,"entry");
    const pal=v06c.filler?v06c.filler.palette:E.io.Palette;
    pal4.add((pal[4]>>>0).toString(16)); }
  drawnThisFrame=false; tiledThisFrame=false;
  if(rd(A.GameStatus)===5&&S1.frames) break;
}

// ---------- СЦЕНА 2: штатный выход из пирамиды 1 ----------
const S2=newScene("ВЫХОД ИЗ ПИРАМИДЫ 1");
for(let i=0;i<600&&!(rd(A.GameStatus)===5&&(rd(A.flagPiramideMap)&1));i++) v06c.oneInterrupt(true);
const pira0=rd(A.piramideActual);
let door=-1, dd=null;
for(let d=0;d<4;d++){
  const b=[];for(let i=0;i<7;i++)b.push(rd(A.pyramidDoors+d*7+i));
  if(b[0]!==0xff&&b[5]!==0&&b[5]!==pira0&&door<0){door=d;dd=b;}
}
if(door<0){console.log("ПРОВАЛ ПОКРЫТИЯ: выходной двери на пирамиде "+pira0+" не нашлось");process.exit(1);}
wr(A.pyramidDoors+door*7+4,0x40);   // «открыта, ждёт выхода героя»
wr(A.flagStageClear,1); wr(A.protaStatus,0);
wr(A.ProtaRoom,dd[3]); wr(A.ProtaY,dd[0]); wr(A.ProtaXdecimal,0); wr(A.ProtaX,dd[2]);
for(let f=0;f<1400;f++){
  v06c.oneInterrupt(true);
  beamTally();
  sample(S2,"exit");
  drawnThisFrame=false; tiledThisFrame=false;
  if(rd(A.GameStatus)===5&&rd(A.piramideActual)===dd[5]) break;
}


// ---------- ПОКАДРОВАЯ ВЕДОМОСТЬ СЦЕНЫ ВЫХОДА ----------
// door_leaf_purity исключает из проверки цвета кадры перерисовки блока (tiledThisFrame) и
// сверяет луч только когда герой ПОД створкой. Жалоба владельца — ровно про момент выхода,
// то есть про исключённые кадры. Здесь печатается ВСЁ подряд, без изъятий.
console.log("\n=== ПОКАДРОВО: ВЫХОД ИЗ ПИРАМИДЫ 1 (без исключений) ===");
const nm=v=>`idx${v}`;
let redRun=0,redMax=0,redFrames=0;
for(const r of S2.log){
  const ks=Object.keys(r.h).map(Number).sort((a,b)=>r.h[b]-r.h[a]);
  const red=(r.h[6]||0), own=(r.h[6]||0)+(r.h[14]||0), tot=r.n;
  const redPct=tot?100*red/tot:0;
  if(redPct>=90){redFrames++;redRun++;if(redRun>redMax)redMax=redRun;}else redRun=0;
  if(S2.log.length<=200||r.f%1===0)
    console.log(`  кадр ${String(r.f).padStart(4)} ${r.tiled?"ТАЙЛЫ":"     "} ${r.drawn?"вывод":"     "} `
      +`пикс ${String(tot).padStart(4)} ${ks.slice(0,4).map(k=>nm(k)+":"+r.h[k]).join(" ").padEnd(34)}`
      +` красных ${redPct.toFixed(0).padStart(3)}%  слоты[${r.out.join(",")}]`);
}
console.log(`ИТОГ: кадров, где створка >=90% КРАСНАЯ (idx6): ${redFrames} из ${S2.log.length}, самая длинная серия подряд ${redMax}`);
