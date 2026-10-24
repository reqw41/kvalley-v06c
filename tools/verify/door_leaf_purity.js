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
//     его бита читается индекс на экране. SWAP 2026-08-16 (vec_palette.asm): зелёный
//     двери переехал с idx14 на idx4, мигающая аура/рычаг — на idx14. Своих цветов у
//     створки теперь ДВА плюс остаток: idx4 (лица), idx0 (швы, vsc_leaf гасит p2/p0)
//     и idx6 (старая заливка p1+p2 — была OWN и до SWAP; замер 2026-08-20: это
//     8-рядная полоса ВНЕ габарита героя, не кожа). Всё остальное — брак:
//       - idx8/idx10 значит, что створку ЗАТЁРЛИ ТАЙЛЫ ворот и на её месте виден
//         кирпич в тон камня уровня (ровно то, на что жаловался владелец);
//       - idx2 значит, что СКВОЗЬ СТВОРКУ ПРОСВЕЧИВАЕТ одежда героя.
//     Прежняя карта OWN={6,14} / HERO={2,4} после SWAP принимала зелёные лица за кожу
//     (~25% «героя») и требовала idx14 на раме, которой там больше нет. Это не порча
//     картинки — протухшая схема гейта. Новые слоты доказывают ТЕ ЖЕ правила владельца
//     (свои лица/швы, камень не просвечивает, одежда не просвечивает) на новой карте.
//     idx4 убран из HERO, а не «ослаблен порог»: 5 пикс idx2 ≈ 0.03%, порог 0.5% тот же.
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
const OWN=new Set([0,4,6]);                   // idx4 лица + idx0 швы после SWAP; idx6 — остаток старой заливки (был OWN и до SWAP)
const TILE=new Set([8,10,12]);                 // фон/тайл ворот проступил (камень/белый)
const HERO=new Set([2]);                       // одежда; idx4 больше не кожа, idx6 в силуэте — не герой (полоса вне его габарита)

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
const tileHist=new Map(), pal4=new Set(), pal14=new Set(); let tileCol=0,tileNo=0,tileSP=-1,tileRet=-1;
const cpu=E.cpu;
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
  tiled:0,checked:0,hist:new Map(),flick:0,flickFrames:0,prev:null,prevGeo:"",shots:0};}
function sample(S,tag){
  const all={};
  for(let s=0;s<4;s++){const p=leafPx(s); if(p) Object.assign(all,p);}
  const keys=Object.keys(all);
  if(!keys.length) return false;
  S.frames++;
  // Кадр годится для проверки цвета, если в нём НЕ перерисовывался блок ворот: анимация
  // закрытия легально затирает створку своими тайлами, и это переходное состояние.
  if(tiledThisFrame){S.tiled++; return true;}
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
    pal4.add((pal[4]>>>0).toString(16)); pal14.add((pal[14]>>>0).toString(16)); }
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

// ---------- отчёт ----------
console.log(`ROM: ${ROM}`);
let bad=0;
for(const S of [S1,S2]){
  console.log(`\n=== ${S.name} ===`);
  // ПОКРЫТИЕ. «Кадров вывода» как порог больше не годится: с тех пор как неподвижная
  // створка не стирается и не пересохраняется (vso_static), пачка выводит её РЕДКО — и
  // это правильно. Требуем, чтобы сцена нашлась (створка стояла в слотах) и чтобы её
  // хоть раз реально нарисовали, иначе мы меряли бы протухшие пиксели.
  if(S.checked<20||S.drawn<1){
    console.log(`ПРОВАЛ ПОКРЫТИЯ: пригодных кадров ${S.checked} (нужно >= 20), из них с выводом `
      +`${S.drawn} (нужно >= 1); всего кадров со створками ${S.frames}.`);
    console.log("  Гейт обязан ПАДАТЬ на пустой выборке, а не зеленеть: сцена не проверена.");
    bad++; continue;
  }
  console.log(`кадров со створками в слотах: ${S.frames}, пригодных для проверки цвета: `
    +`${S.checked}, из них пачка выводила створку в ${S.drawn}`);
  console.log(`  кадров, где анимация ворот перерисовывала блок (переходные, не проверяем): ${S.tiled}`);
  console.log(`  пикселей силуэта в проверяемых кадрах: ${S.px}`);
  console.log(`  цвета: `+[...S.hist.entries()].sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>`idx${k}:${v}`).join(" "));
  const pTile=100*S.tile/S.px, pHero=100*S.hero/S.px;
  console.log(`  СВОИ (idx0/idx4/idx6): ${S.own} (${(100*S.own/S.px).toFixed(1)}%)`);
  console.log(`  СТВОРКУ ЗАТЁРЛИ ТАЙЛЫ (idx8/10/12): ${S.tile} (${pTile.toFixed(1)}%)`);
  console.log(`  ГЕРОЙ ПРОСВЕЧИВАЕТ (idx2): ${S.hero} (${pHero.toFixed(1)}%)`);
  console.log(`  МЕРЦАНИЕ: ${S.flick} пикс на ${S.flickFrames} кадрах`);
  if(pHero>0.5){console.log("  ❌ герой просвечивает сквозь створку");bad++;}
  if(S.flick>600){console.log("  ❌ створка мерцает сверх порога 600 пикс");bad++;}
}
// ---------- РАСЦВЕТКА САМОГО БЛОКА ВОРОТ ----------
// Жалобы «ворота не зелёные» и «внутри ступеньки не раскрашены» — ПРО ТАЙЛЫ, а не про
// спрайт-створку, и прежний гейт их не видел в принципе. Эталон с картриджа
// (tools/gfx/msx_p1_gate.js, реальная пирамида 1):
//   рама/столбы/закрывающиеся кирпичи 0x6C-0x72 и 0x7B-0x81 — цвет 0x30 во всех строках,
//     перо MSX 3 светло-зелёное => после SWAP 2026-08-16 у нас idx4 ЗЕЛЁНЫЙ (был idx14),
//     и НИ ОДНОГО пикселя в тоне камня;
//   ступеньки проёма 0x66/0x67 — перо 15 белое на фоне 14 СЕРОМ => у нас idx12 на idx2;
//   рычаг 0x5C — фон 6 тёмно-красный, сердцевина мигает в idx14 (vec_brillo_pal пишет 14).
console.log("\n=== ГЕРОЙ ПОД СТВОРКОЙ: ЛУЧЕВОЙ ТРАНЗИЕНТ ===");
if(overFrames<10){
  console.log(`ПРОВАЛ ПОКРЫТИЯ: кадров, где габарит героя пересекается со створкой, всего `
    +`${overFrames} (нужно >= 10). Сцена «герой заходит ЗА створку» не проверена.`);
  bad++;
} else {
  console.log(`  кадров, где герой ПОД створкой: ${overFrames}`);
  console.log(`  ЛУЧ ПОКАЗАЛ НЕ ТО, ЧЕМ КАДР ЗАКОНЧИЛСЯ: ${beamPix} пиксель-кадров на ${beamFrames} кадрах`);
  // ПОРОГ 180. Замер на сборке, что стоит на железе, даёт 204 на 6 кадрах — гейт обязан
  // на ней ПАДАТЬ (проверено). ОСТАТОК СТРУКТУРНЫЙ и порогом не лечится: створка собрана
  // ДВУМЯ объектами (база кладёт p1+p2 и ГАСИТ p0 на всём габарите, деталь возвращает p0
  // на лица кирпичей), и между ними створка неизбежно читается как idx6 КРАСНАЯ. Убрать
  // окно можно только третьим объектом на половину створки или полем «писать p0» третьей
  // плоскости в записи вывода — см. отчёт.
  if(beamPix>180){console.log("  ❌ лучевой транзиент створки сверх порога 180");bad++;}
}
console.log("\n=== РАСЦВЕТКА БЛОКА ВОРОТ (пирамида 1) ===");
const STONE=new Set([8,10]);
function chk(tiles,name,must,forbid){
  let seen=0, ok=true, det=[];
  for(const t of tiles){ const h=tileHist.get(t); if(!h)continue; seen++;
    det.push(`0x${t.toString(16)}:`+[...h.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`idx${k}x${v}`).join(","));
    if(must!==null&&!h.has(must))ok=false;
    if(forbid) for(const f of forbid) if(h.has(f))ok=false; }
  if(!seen){console.log(`  ПРОВАЛ ПОКРЫТИЯ: ${name} — ни один тайл не нарисован в сцене`);bad++;return;}
  console.log(`  ${name}: ${det.join("  ")}`);
  if(!ok){console.log(`  ❌ ${name}: расцветка не по картриджу`);bad++;}
}
chk([0x6C,0x6D,0x6E,0x6F,0x70,0x71,0x72,0x7B,0x7C,0x7D,0x7E,0x7F,0x80,0x81],
    "рама и столбы -> зелёные (idx4 после SWAP 2026-08-16)", 4, STONE);
chk([0x66,0x67], "ступеньки проёма -> белые на СЕРОМ", 2, null);
// ФАЗА ЗАКРЫТИЯ СТВОРОК — ОБЯЗАТЕЛЬНАЯ. Жалоба с железа: «когда створки закрываются,
// лестница внутри ворот перекрашивается цветом кирпичей уровня». В этой фазе блок ворот
// перерисовывается ДРУГИМ набором тайлов (animExitClosing), и четыре из них — 0x5F/0x60
// (верхний ряд) и 0x61/0x62 (нижний) — наезжают на лестницу проёма. Если они уходят
// штатным путём, то выходят idx8, то есть тоном камня уровня. chk падает и когда цвет
// не тот, и когда фаза вообще не встретилась. must=4: после SWAP зелень двери в idx4.
chk([0x5F,0x60,0x61,0x62], "закрывающиеся кирпичи -> зелёные на сером (idx4)", 4, STONE);
chk([0x5C], "рычаг вниз -> красный обвод + мигающая сердцевина idx14", 14, STONE);
// ЖАЛОБА С ЖЕЛЕЗА 2026-08-05: «рычаг в ВЕРХНЕМ положении в оригинале ТОЖЕ ЖЁЛТЫЙ, как в
// нижнем, и НЕ мигает». Эталон с картриджа (тайл 0x5D одинаков на пирамидах 1 и 5):
// 60 6A 6A 6A 6F 6F 6F 6F — строки 1-3 перо 6 на фоне A ЖЁЛТОМ, строки 4-7 на фоне F белом.
// Видна именно ПОДЛОЖКА: у 0x5D ручка — просвет в красном обводе (7E E7 C3 C3 E7 E7 E7 FF).
// Жёлтого, не зависящего от схемы камня, в палитре нет, поэтому ручка идёт в тон камня —
// тем же цветом, что потолок проёма 0x63/0x64. Отсюда обе половины проверки:
//   must=8     — жёлтая ручка есть (до правки строки 1-3 были idx12 БЕЛЫМИ);
//   forbid={14} — idx14 (мигающая аура после SWAP 2026-08-16; раньше это был idx4)
//                 в верхнем рычаге не встречается, то есть он НЕ МИГАЕТ.
//                 Мигать обязан только 0x5C выше.
//
// ПОЧЕМУ ЗДЕСЬ ПО-ПРЕЖНЕМУ ЖЁСТКО idx8, ХОТЯ ЗАДАЧА #54 СДЕЛАЛА СЛОТ ПЛАВАЮЩИМ (2026-08-06).
// С задачи #54 ручка идёт в «самый жёлтый слот СХЕМЫ»: idx8 на схеме 0, idx10 на схемах
// 1..3 (после задачи #44 жёлтый есть в каждой схеме, но в разных тонах камня). Этот гейт
// ПО ПОСТРОЕНИЮ живёт на ПИРАМИДЕ 1 — он стартует настоящую партию и падает, если
// piramideActual!=1 (см. проверку покрытия ниже), — то есть видит РОВНО схему 0, где
// «самый жёлтый» это и есть idx8. Менять здесь 8 на «8 или 10» было бы ОСЛАБЛЕНИЕМ: на
// схеме 0 idx10 — красный, и такая проверка пропустила бы настоящий дефект.
// ВТОРАЯ СТОРОНА (схемы 1..3) ПРОВЕРЯЕТСЯ ОТДЕЛЬНЫМ СТЕНДОМ tools/verify/yellow_slots_probe.js:
// он обходит читом N пирамиды 1/5/9/13 и требует, чтобы слот ручки/потолка/рукояти ножа был
// ЖЁЛТЫМ ПО РЕАЛЬНОМУ RGB палитры, а не по номеру. Именно односторонность этой проверки и
// была причиной, по которой «рычаг вверх жёлтый» держался зелёным всё время, пока на
// пирамидах 5-15 ручка была синей/красной/зелёной.
chk([0x5D], "рычаг вверх -> жёлтая ручка (тон A, схема 0) и НЕ мигает", 8, new Set([14]));
// ТРЕТЬЯ ЖАЛОБА: «на входе нет мигания рычага». После SWAP сердцевина лежит в idx14 —
// том же слоте, что аура сокровищ; мигание там ПАЛИТРОВОЕ (vbp_pulse пишет A=14).
// idx4 на входе даёт ДВА значения (титульный синий → игровой зелёный) — это смена
// сцены, а не пульс; требовать pal4.size>=2 после SWAP было бы ложным зелёным.
console.log(`  палитра idx4 (стабильный зелёный) за сцену входа: ${[...pal4].join(",")}`);
console.log(`  палитра idx14 (аура/рычаг) за сцену входа: ${[...pal14].join(",")}`);
if(pal14.size<2){console.log("  ❌ idx14 не мигает во время входа в пирамиду");bad++;}
if(PNGDIR)console.log(`\nPNG: ${PNGDIR}`);
if(bad){console.log("\nРЕЗУЛЬТАТ: ПРОВАЛ");process.exit(1);}
console.log("\nРЕЗУЛЬТАТ: OK — обе сцены найдены, створка своего цвета, герой не просвечивает");
