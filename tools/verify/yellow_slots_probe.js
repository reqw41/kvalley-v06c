// yellow_slots_probe.js — ЗАДАЧА #54: «САМЫЙ ЖЁЛТЫЙ СЛОТ СХЕМЫ» НА ВСЕХ ЧЕТЫРЁХ СХЕМАХ.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СТЕНД, А НЕ РАСШИРЕНИЕ door_leaf_purity. Тот гейт по построению живёт на
// ПИРАМИДЕ 1 (стартует настоящую партию и падает, если piramideActual!=1) — то есть видит
// РОВНО схему 0, где жёлтый лежит в idx8. Именно поэтому его проверка «рычаг вверх ->
// idx8» была зелёной всё время, пока на схемах 1..3 ручка была синей/красной/зелёной:
// гейт туда не заходил. Здесь читом N обходятся пирамиды 1/5/9/13 (по одной на схему) и
// для каждой меряется, в КАКОМ слоте оказался жёлтый фон рычага и потолка ворот.
//
// ЧТО МЕРЯЕТ. Хук на vbt8_ent (вход тайлового блиттера): запоминаем номер тайла, столбец
// (регистр C) и верхнюю строку (vbt8_e), на возврате снимаем 8x8 ИНДЕКСОВ ПАЛИТРЫ этой
// клетки прямо из fb. Гистограмма «тайл -> индекс -> пикселей» + РЕАЛЬНЫЙ RGB слота из
// палитры на том же кадре. Цвет проверяется не на глаз: слот обязан быть ЖЁЛТЫМ по
// критерию R>=0xA0 && G>=0x80 && B<=0x80 (жёлтый = много красного и зелёного, мало синего).
//
// ВЕРХНЯЯ ПЛОЩАДКА ЛЕСТНИЦЫ (0x73/0x74/0x82/0x83, задача #55) СЮДА НЕ ДОБАВЛЕНА НАРОЧНО:
// у неё ЧЕТЫРЕ цвета, а не один жёлтый, и проверять надо все четыре разом, построчно и
// против паттерна. Это делает отдельный стенд tools/verify/stair_top_probe.js — он гоняет
// те же четыре схемы (пирамиды 1/5/9/13) и тот же критерий «жёлтый по РЕАЛЬНОМУ RGB»,
// плюс серый/белый/светло-красный. Дублировать здесь значит иметь две несогласованные
// формулировки одного требования.
// ТАЙЛЫ ПОД НАБЛЮДЕНИЕМ:
//   0x5D  рычаг ворот В ВЕРХНЕМ ПОЛОЖЕНИИ — фон строк 1-3 = видимая «ручка»
//   0x63/0x64  потолок (перемычка) проёма ворот
//   0x5C  рычаг ВНИЗ — контроль: он обязан ПО-ПРЕЖНЕМУ мигать (idx4 присутствует)
//
// Запуск: node tools/verify/yellow_slots_probe.js [rom] [sym] [--png КАТАЛОГ]
"use strict";
const fs=require("fs"), path=require("path"), zlib=require("zlib");
// Свой мини-писатель PNG: pngFrom из beam_harness жёстко привязан к размеру ЭКРАНА,
// а карточки тайлов — картинка произвольного размера.
function writePng(out,W,H,px){ // px: Uint32Array в ABGR, как палитра
  const raw=Buffer.alloc(H*(W*3+1));
  for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;
    for(let x=0;x<W;x++){const c=px[y*W+x]>>>0, o=y*(W*3+1)+1+x*3;
      raw[o]=c&255; raw[o+1]=(c>>8)&255; raw[o+2]=(c>>16)&255;}}
  const ch=(t,d)=>{const b=Buffer.concat([Buffer.from(t,"ascii"),d]);
    const l=Buffer.alloc(4); l.writeUInt32BE(d.length,0);
    const c=Buffer.alloc(4); c.writeUInt32BE(zlib.crc32?zlib.crc32(b):crc32(b),0); return Buffer.concat([l,b,c]);};
  function crc32(buf){let c=~0; for(const b of buf){c^=b; for(let k=0;k<8;k++) c=(c>>>1)^(0xEDB88320&-(c&1));} return ~c>>>0;}
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=2;
  fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    ch("IHDR",ihdr),ch("IDAT",zlib.deflateSync(raw)),ch("IEND",Buffer.alloc(0))]));}
const {make}=require("./beam_harness.js");
const T=__dirname;
const pos=process.argv.slice(2).filter(a=>/\.(rom|sym)$/.test(a));
const ROM=pos[0]||T+"/../../build/kvalley_8c.rom";
const SYM=pos[1]||ROM.replace(/\.rom$/,".sym");
const gi=process.argv.indexOf("--png"), PNGDIR=gi>0?process.argv[gi+1]:null;
if(PNGDIR) fs.mkdirSync(PNGDIR,{recursive:true});
const E=make(ROM,SYM);
const {L,rd,v06c,run,key,cpu}=E;
const wr=(a,v)=>E.memory.write(a&0xffff,v&0xff,false);
const need=n=>{if(L[n]===undefined){console.log(`нет символа ${n} в ${SYM}`);process.exit(2);} return L[n];};
const A={};
for(const n of ["GameStatus","piramideActual","flagPiramideMap","flagStageClear","protaStatus",
  "ProtaY","ProtaXdecimal","ProtaX","ProtaRoom","pyramidDoors","objetoCogido","IDcuchilloCoge"]) A[n]=need(n);

// 0x45-0x4B — НОЖ (0x45-0x4A полёт, 0x4B на полу/воткнут): рукоять обязана быть жёлтой,
// лезвие — остаться серым idx2. Их отдельная сцена ниже (нож в руку + импульсы FIRE).
const WATCH=new Set([0x5C,0x5D,0x63,0x64,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B]);
const idxAt=(col,lo,b)=>{const a=0x8000+((col&31)<<8)+(lo&255);
  return ((rd(a)>>b)&1)<<3|((rd(a+0x2000)>>b)&1)<<2|((rd(a+0x4000)>>b)&1)<<1;};
const palette=()=>v06c.filler?v06c.filler.palette:E.io.Palette;
// ПОРЯДОК БАЙТ. Слот лежит u32 как 0xAABBGGRR (ABGR — так его кладёт filler для канваса),
// а НЕ 0xAARRGGBB. Проверено на константах: idx6 = 05Fh = %BBGGGRRR -> R=0xE0,G=0x60,B=0x40,
// и в слоте это 0xff4060e0 — то есть красный лежит в МЛАДШЕМ байте. Прочитать наоборот =
// объявить красный синим (первый прогон стенда так и сделал: «жёлтых 0» при верной картинке).
function rgbOf(v){v=v>>>0;return {r:v&255,g:(v>>8)&255,b:(v>>16)&255};}
const hexOf=v=>{const c=rgbOf(v);return [c.r,c.g,c.b].map(x=>x.toString(16).padStart(2,"0")).join("");};
const isYellowV=v=>{const c=rgbOf(v); return c.r>=0xA0&&c.g>=0x80&&c.b<=0x80;};

// ПАЛИТРУ СНИМАЕМ В МОМЕНТ ОТРИСОВКИ ТАЙЛА, а не в конце прогона: к концу цикла игра уже
// уходит на карту долины, где схемы камня нет вовсе и idx8/idx10 стоят цветами карты.
// Первый прогон стенда читал именно их и показывал одинаковый idx8=4060e0 на всех четырёх
// пирамидах — при том, что своп слотов в fb был уже правильный.
let hist=new Map(), palAt=new Map(), patSeen=new Map();
let tCol=0,tNo=0,tSP=-1,tRet=-1;
// ФИЛЬТР ПО ПИРАМИДЕ. Стимул ножа мясной (мешим клавиши и суём нож в руку), герой на нём
// иногда ГИБНЕТ, а после исчерпания жизней партия начинается заново — С ПИРАМИДЫ 1, то есть
// со СХЕМЫ 0. Без фильтра эти кадры падали в гистограмму текущей пирамиды, и стенд показывал
// «на пирамиде 9 потолок idx8, жёлтого нет» — при том, что idx8 там был честным цветом
// СХЕМЫ 0, просто нарисованным уже в другой партии. Ловилось это по метке ⚠ «рисовался при
// РАЗНЫХ состояниях: pyr9/ceil1 | pyr1/ceil0». Пишем в гистограмму ТОЛЬКО кадры своей пирамиды.
let curPira=-1;
let card=new Map();
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===L.vbt8_ent){const t=rd(L.vw_byte);
    if(WATCH.has(t)){tNo=t;tCol=cpu.reg(1);tSP=cpu.sp;
      tRet=E.memory.read(cpu.sp,false)|(E.memory.read(cpu.sp+1,false)<<8);}}
  else if(tSP>=0&&pc===tRet&&cpu.sp>tSP){
    if(curPira>=0&&rd(A.piramideActual)!==curPira){tSP=-1;return false;}
    const e=rd(L.vbt8_e), h=hist.get(tNo)||new Map();
    for(let r=0;r<8;r++)for(let b=7;b>=0;b--){const k=idxAt(tCol,(e-r)&255,b);h.set(k,(h.get(k)||0)+1);}
    hist.set(tNo,h); tSP=-1;
    // палитра слотов на момент отрисовки тайла — она и есть цвет, который увидит зритель
    const P=palette();
    for(const i of [4,6,8,10,12,14]){const s=palAt.get(i)||new Set(); s.add(P[i]>>>0); palAt.set(i,s);}
    // КАРТОЧКА ТАЙЛА: та самая клетка 8x8, крупно. Скриншот целого экрана для приёмки цвета
    // не годится — тайл на нём 8 пикселей и на глаз не читается; здесь же видно каждый пиксель.
    if(PNGDIR&&!card.has(tNo)){
      const px=[]; for(let r=0;r<8;r++){const row=[];
        for(let b=7;b>=0;b--) row.push(palette()[idxAt(tCol,(e-r)&255,b)]>>>0); px.push(row);}
      card.set(tNo,px);
    }
    // СОСТОЯНИЕ ПАТЧЕЙ + пирамида НА МОМЕНТ ОТРИСОВКИ: если тайл нарисован под чужой
    // схемой, гистограмма покажет «не тот» слот, и без этой записи причину не отличить
    // от настоящего дефекта раскраски.
    const st=`pyr${rd(A.piramideActual)}/ceil${rd(L.kv_ceil_pl)}/lv${rd(L.kv_lvup_p2).toString(16)}`;
    const ss=patSeen.get(tNo)||new Set(); ss.add(st); patSeen.set(tNo,ss);
  }
  return false;
};

// ---- старт настоящей партии (не аттракт: демо стартует на пирамиде 5) ----
run(700);
for(let i=0;i<30;i++){key(32,1);run(3);key(32,0);run(3);}
if(rd(A.piramideActual)!==1){console.log(`ПРОВАЛ: старт дал пирамиду ${rd(A.piramideActual)}, ждали 1`);process.exit(1);}

// Открыть ворота на ТЕКУЩЕЙ пирамиде и дать блоку перерисоваться: только в этой фазе
// рисуется тайл 0x5D (рычаг ВВЕРХ) — при закрытых воротах на его месте 0x5C.
function openGate(){
  for(let i=0;i<600&&!(rd(A.GameStatus)===5&&(rd(A.flagPiramideMap)&1));i++) v06c.oneInterrupt(true);
  const pira=rd(A.piramideActual);
  for(let d=0;d<4;d++){
    const b=[];for(let i=0;i<7;i++)b.push(rd(A.pyramidDoors+d*7+i));
    if(b[0]!==0xff&&b[5]!==0&&b[5]!==pira){
      wr(A.pyramidDoors+d*7+4,0x40); wr(A.flagStageClear,1); wr(A.protaStatus,0);
      wr(A.ProtaRoom,b[3]); wr(A.ProtaY,b[0]); wr(A.ProtaXdecimal,0); wr(A.ProtaX,b[2]);
      return true;}
  }
  return false;
}

const SCHEME=p=>((p-1)>>2)&3;
const rows=[]; let bad=0;
for(const target of [1,5,9,13]){
  while(rd(A.piramideActual)<target){
    const before=rd(A.piramideActual);
    key(78,true); run(3); key(78,false);
    for(let f=0;f<4000&&!(rd(A.GameStatus)===5&&rd(A.piramideActual)!==before);f++) v06c.oneInterrupt(true);
  }
  const pira=rd(A.piramideActual);
  hist=new Map(); palAt=new Map(); patSeen=new Map(); curPira=pira; card=new Map();
  // ПОРЯДОК СЦЕН ЗНАЧИМ. Нож — ПЕРВЫМ, на ОБЫЧНОМ геймплее; ворота — вторыми, потому что
  // openGate ставит flagStageClear=1 и телепортирует героя к двери, то есть уводит партию
  // в фазу ВЫХОДА, где бросок ножа уже невозможен. Первая версия стенда шла в обратном
  // порядке и получала «0x45-0x4A НЕ ВСТРЕТИЛСЯ» на всех схемах — не потому, что тайлы
  // мёртвые, а потому, что сцена была не та.
  // ---- СЦЕНА НОЖА: нож в руку + импульсы FIRE ----
  // РЕЦЕПТ ЦЕЛИКОМ ИЗ knife_cost.js, включая обе грабли:
  //  1) ВВОД ПО ИГРОВОМУ ТИКУ, а не по кадру: логика тикает через кадр, и «импульс раз в
  //     16 кадров» до броска просто не доживает;
  //  2) ФОРС ТОЛЬКО НА СВОБОДНЫЙ НОЖ — сторож это knifesData (СТАТУС НОЖА), а НЕ
  //     protaStatus. С protaStatus (первая версия стенда) форс срабатывал невпопад,
  //     бросок перехватывал нож посреди отскока, и тайлы полёта 0x45-0x4A не рисовались
  //     ВООБЩЕ: прогон показывал «НЕ ВСТРЕТИЛСЯ» на всех четырёх схемах.
  const KN=need("knifesData");
  {
    const held=new Set();
    const setKeys=w=>{for(const c of held) if(!w.has(c)) key(c,false);
      for(const c of w) if(!held.has(c)) key(c,true);
      held.clear(); for(const c of w) held.add(c);};
    let tick=0, prevT=rd(L.timer), fr=0, knShot=false;
    while(tick<=900&&fr<40000){
      const w=new Set();
      if((tick&31)<16) w.add(39); else w.add(37);   // бежим вправо/влево
      if((tick&15)===3) w.add(32);                  // импульс FIRE = бросок
      setKeys(w);
      if(rd(KN)<=2){wr(A.objetoCogido,0x10); wr(A.IDcuchilloCoge,0);}
      // ЖИЗНИ ДЕРЖИМ ПОЛНЫМИ. Стимул мясной, герой на нём гибнет; на пирамиде 9 он успевал
      // потерять все жизни ДО того, как выпадал хоть один кадр вращения ножа, и прогон
      // возвращался на пирамиду 1 — стенд честно отфильтровывал чужие кадры и отчитывался
      // «на схеме 2 не встретился НИ ОДИН тайл». Это дыра ПОКРЫТИЯ, а не дефект картинки.
      wr(L.Vidas,5);
      v06c.oneInterrupt(true); fr++;
      // СНИМОК ЛОВИМ ПО СОБЫТИЮ, а не по номеру кадра: кадр 900 приходился на случайный
      // момент, и на картинке оказывались кирки вместо ножа. Снимаем сразу, как блиттер
      // нарисовал тайл ПОЛЁТА (0x45-0x4A) — тогда нож заведомо в кадре.
      if(PNGDIR&&!knShot&&[0x45,0x46,0x47,0x48,0x49,0x4A].some(k=>hist.has(k))){
        E.pngFrom(E.idealBmp(),path.join(PNGDIR,`pyr${String(pira).padStart(2,"0")}_scheme${SCHEME(pira)}_knife.png`));knShot=true;}
      const t=rd(L.timer); if(t!==prevT){prevT=t;tick++;}
      if(rd(A.piramideActual)!==pira) break;
    }
    setKeys(new Set());
  }

  // ---- СЦЕНА ВОРОТ: открыть выходную дверь и дать блоку перерисоваться ----
  if(!openGate()){console.log(`пирамида ${pira}: выходной двери не нашлось`);bad++;continue;}
  let shot=0;
  for(let f=0;f<1500;f++){
    v06c.oneInterrupt(true);
    if(hist.has(0x5D)&&PNGDIR&&shot<2&&f%40===0){
      E.pngFrom(E.idealBmp(),path.join(PNGDIR,`pyr${String(pira).padStart(2,"0")}_scheme${SCHEME(pira)}_gate_${shot}.png`));shot++;}
    if(rd(A.piramideActual)!==pira) break;
  }

  const sc=SCHEME(pira);
  if(PNGDIR&&card.size){
    // Все карточки этой пирамиды одним листом: строка = тайл, 8x8 клетка при масштабе 12.
    const ids=[...card.keys()].sort((a,b)=>a-b), S=12, GAP=4;
    const W=8*S, H=ids.length*(8*S+GAP)-GAP, buf=new Uint32Array(W*H);
    ids.forEach((id,n)=>{const px=card.get(id);
      for(let r=0;r<8;r++)for(let c=0;c<8;c++){const v=px[r][c];
        for(let dy=0;dy<S;dy++)for(let dx=0;dx<S;dx++){
          const y=n*(8*S+GAP)+r*S+dy, x=c*S+dx; buf[y*W+x]=v;}}});
    writePng(path.join(PNGDIR,`cards_pyr${String(pira).padStart(2,"0")}_scheme${sc}.png`),W,H,buf);
    console.log(`  карточки тайлов (сверху вниз ${ids.map(i=>"0x"+i.toString(16)).join(", ")}):`
      +` cards_pyr${String(pira).padStart(2,"0")}_scheme${sc}.png`);
  }
  // Слот, стабильный за сцену, отдаёт одно значение; idx4 (аура) мерцает — его не смотрим.
  const oneOf=i=>{const s=palAt.get(i); return s&&s.size?[...s][0]:0;};
  console.log(`\n===== ПИРАМИДА ${pira} (схема ${sc}) =====`);
  console.log(`  палитра в момент отрисовки ворот: idx8=${hexOf(oneOf(8))} idx10=${hexOf(oneOf(10))}`
    +` idx12=${hexOf(oneOf(12))} idx6=${hexOf(oneOf(6))}`);
  for(const t of [0x5D,0x63,0x64,0x5C,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B]){
    const h=hist.get(t);
    // Тайлы ножа условны: какой кадр вращения выпадет, зависит от того, куда полетел нож.
    // Не встретился — это дыра ПОКРЫТИЯ, отчитываем отдельно, но не красим гейт: за
    // обязательное покрытие отвечает сводка внизу.
    if(!h){console.log(`  тайл 0x${t.toString(16)}: НЕ ВСТРЕТИЛСЯ`);
      if(t===0x5D||t===0x63||t===0x64){bad++;} continue;}
    const parts=[...h.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`idx${k}x${v}`).join(",");
    console.log(`  тайл 0x${t.toString(16)}: ${parts}`);
    const ss=patSeen.get(t); if(ss&&ss.size>1) console.log(`     ⚠ рисовался при РАЗНЫХ состояниях: ${[...ss].join(" | ")}`);
    if(t===0x5C){
      const blink=h.has(4);
      console.log(`     мигающий слот idx4 ${blink?"ЕСТЬ (рычаг вниз мигает, как раньше)":"❌ ПРОПАЛ"}`);
      if(!blink)bad++;
      continue;
    }
    // ЖЁЛТАЯ ЛИ ЧАСТЬ? Жёлтый живёт ТОЛЬКО в idx8/idx10 (тона камня) — берём те из них,
    // что реально встретились в клетке, и смотрим их настоящий цвет.
    const cand=[...h.keys()].filter(k=>k===8||k===10);
    if(!cand.length){console.log(`     ❌ ни idx8, ни idx10 — жёлтому взяться неоткуда`);bad++;continue;}
    const yel=cand.filter(k=>isYellowV(oneOf(k)));
    const desc=cand.map(k=>`idx${k}=${hexOf(oneOf(k))}${isYellowV(oneOf(k))?" ЖЁЛТЫЙ":""}`).join(", ");
    if(yel.length){console.log(`     ✅ ${desc}`);}
    else {console.log(`     ❌ ${desc} — жёлтого нет`);bad++;}
    // У НОЖА отдельно требуем, что ЛЕЗВИЕ осталось серым idx2 (владелец: «лезвие не трогать»).
    if(t>=0x45&&t<=0x4B){
      if(!h.has(2)){console.log(`     ❌ лезвие: idx2 СЕРОГО в тайле нет — лезвие перекрашено`);bad++;}
      else console.log(`     ✅ лезвие idx2 серое: ${h.get(2)} пикс`);
    }
    rows.push([pira,sc,t,cand.join("/"),yel.length>0]);
  }
}
if(PNGDIR)console.log(`\nPNG: ${PNGDIR}`);
console.log(`\nСВОДКА: ${rows.length} измерений, жёлтых ${rows.filter(r=>r[4]).length}`);
// ДЕКЛАРАЦИЯ ПОКРЫТИЯ: гейт, не увидевший ни одного тайла ножа, «зелен» бессодержательно.
const knRows=rows.filter(r=>r[2]>=0x45&&r[2]<=0x4B);
const schemesWithKnife=new Set(knRows.map(r=>r[1]));
console.log(`ПОКРЫТИЕ: тайлов ножа измерено ${knRows.length} на ${schemesWithKnife.size} схемах`
  +` (${[...schemesWithKnife].sort().join(",")}); ворот — ${rows.length-knRows.length}`);
if(schemesWithKnife.size<4){console.log("  ❌ нож увиден не на всех четырёх схемах — стимул не добил");bad++;}
if(bad){console.log("РЕЗУЛЬТАТ: ПРОВАЛ");process.exit(1);}
console.log("РЕЗУЛЬТАТ: OK — рычаг вверх, потолок ворот и рукоять ножа ЖЁЛТЫЕ на всех четырёх схемах");
