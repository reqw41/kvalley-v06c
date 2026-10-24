// КАКИМ ЦВЕТОМ РИСУЮТСЯ ПРЕДМЕТЫ: нож (тайл 0x4B) и кирка (0x4C) — по ПИКСЕЛЯМ на экране.
//
// ЗАЧЕМ. Комментарии в vec_blit.asm описывают три разные эпохи раскраски подряд («нож
// сплошной серый idx2», «белое лезвие + тон подсветки», «патч p2-сегментов снят»), и
// понять по ним, что на экране СЕЙЧАС, нельзя. Здесь тайл находится в карте комнаты,
// пересчитывается в экранные координаты и снимается построчно: какой индекс палитры
// стоит в каждом пикселе шейпа.
//
// Разбор по строкам важен именно для этих двух предметов: у кирки граница «рукоять /
// головка» проходит ровно между строками 3 и 4 (форма снята с картриджа, см. vbt8_pico),
// у ножа — между лезвием и рукоятью. Двухцветность живёт по строкам, поэтому таблица
// строится «строка -> индексы», а не общей гистограммой.
//
// Запуск: node tools/verify/item_colors.js [rom] [sym] [пирамида]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const WANT=+(process.argv[4]||1);
const {L,rd,run,key,memory,v06c,io}=E;

const rgbOf=w8=>{const b=(w8&0xc0)>>6,g=(w8&0x38)>>3,r=w8&7;
  return "#"+[(r<<5),(g<<5),(b<<6)].map(x=>x.toString(16).padStart(2,"0")).join("");};
function rawByte(i){
  const c=(v06c.filler?v06c.filler.palette:io.Palette)[i]>>>0;
  return (((c>>16)&255)>>6)<<6 | (((c>>8)&255)>>5)<<3 | ((c&255)>>5);
}

const gs=toGame(E);
if(gs!==5){ console.log("ПРОВАЛ: до геймплея не дошли, GameStatus="+gs); process.exit(2); }
const CHEATS=L.vec_cheats!==undefined&&!!rd(L.vec_cheats);
if(CHEATS){ key(71,1); run(3); key(71,0); run(5); }
// добираемся до нужной пирамиды тем же способом, что palette_table.js
while(rd(L.piramideActual)<WANT){
  const cur=rd(L.piramideActual);
  if(CHEATS){ key(78,1); run(3); key(78,0); }
  else { const nxt=cur+1;
    if(L.vec_hop_ent!==undefined) memory.write(L.puertaEntrada, rd(L.vec_hop_ent-1+nxt), false);
    memory.write(L.piramideDest,nxt,false); memory.write(L.subStatus,0,false); memory.write(L.GameStatus,8,false); }
  let f=0; for(;f<9000 && !(rd(L.GameStatus)===5 && rd(L.piramideActual)!==cur);f++){
    if((f%600)===120){ key(32,1); run(2); key(32,0); }
    v06c.oneInterrupt(true); }
  if(rd(L.piramideActual)===cur){ console.log(`ПРОВАЛ: не дошли до пирамиды ${WANT}`); process.exit(2); }
}
run(120);
console.log(`пирамида ${rd(L.piramideActual)}, схема камня ${((rd(L.piramideActual)-1)>>2)&3}`);

// Карта комнаты: 22 строки по 96 столбцов; на экране видна одна комната шириной 32 клетки.
// Клетка 8x8; экранный столбец = c % 32, строка = r. Адрес байта плоскости: 0x8000 + col*256 + lo,
// где lo растёт СВЕРХУ ВНИЗ как (vscroll - экранная_строка) & 255 (см. beam_harness.idealBmp).
const VS=(L.vec_vscroll===undefined)?0x1F:L.vec_vscroll;
const bytes=memory.bytes;
const idxAt=(col,lo)=>{const a=0x8000+col*256+lo;
  const p0=bytes[memory.tobank(a)],p1=bytes[memory.tobank(a+0x2000)],
        p2=bytes[memory.tobank(a+0x4000)],p3=bytes[memory.tobank(a+0x6000)];
  return k=>((p0>>k)&1)<<3|((p1>>k)&1)<<2|((p2>>k)&1)<<1|((p3>>k)&1);};

// Сокровища (0x86-0x8B) добавлены сюда же: вопрос «каким индексом их можно красить»
// решается тем же способом — смотрим, в какие плоскости они реально пишутся.
// В КАРТЕ ЛЕЖАТ ID, А НЕ НОМЕРА ТАЙЛОВ. Прямое сравнение rd(MapaRAM+..)===тайл находит
// ноль совпадений и даёт молчаливо пустой отчёт. Преобразование ровно как getTileFromID
// в игре (и как в level_palette_survey.js): старший ниббл выбирает группу через indexTiles,
// младший — индекс внутри неё.
const rd16=a=>rd(a)|(rd(a+1)<<8);
const tileFromID=id=>{ const grp=rd16(L.indexTiles+((id>>3)&0x1E)); return rd(grp+(id&0x0F)); };

// СДВИГ КАРТЫ ОТНОСИТЕЛЬНО ЭКРАНА. Клетка карты r попадает НЕ на растровую строку r*8:
// над полем лежит зона в 48 строк (кайма с табло). Замер: герой с ProtaY=72 (клетка 9)
// рисуется со строки 121, то есть 9*8+48+1. Без этой поправки снимок клетки r2 показывал
// строку табло, а сокровища выходили «пустыми» — они были, просто смотрели не туда.
const MAP_Y0=48;
const ITEMS=[[0x4B,"НОЖ"],[0x4C,"КИРКА"],
  [0x86,"СОКРОВИЩЕ т.синее"],[0x87,"СОКРОВИЩЕ циан"],[0x88,"СОКРОВИЩЕ пурпур"],
  [0x89,"СОКРОВИЩЕ жёлтое"],[0x8A,"СОКРОВИЩЕ зелёное"],[0x8B,"СОКРОВИЩЕ серое"]];
let found=0;
for(const [tile,name] of ITEMS){
  const hits=[];
  for(let r=0;r<22;r++) for(let c=0;c<96;c++)
    { const id=rd(L.MapaRAM + r*96 + c); if(id && tileFromID(id)===tile) hits.push([r,c]); }
  if(!hits.length){ console.log(`\n${name} (тайл 0x${tile.toString(16).toUpperCase()}): на этой пирамиде нет`); continue; }
  // ЭКРАН ПОКАЗЫВАЕТ ОДНУ КОМНАТУ ИЗ ТРЁХ. Карта — 22 строки по 96 столбцов, то есть три
  // комнаты по 32; какая на экране, говорит ProtaRoom (он же старшая часть X героя).
  // Без этого фильтра берётся первая попавшаяся клетка, она может быть в соседней комнате,
  // и снимок покажет пустоту или ЧУЖИЕ пиксели — например силуэт героя, стоящего в той же
  // точке экрана. Именно так первый прогон «нашёл» у ножа спрайтовые цвета.
  const room=rd(L.ProtaRoom);
  const here=hits.filter(([,c])=>(c>>5)===room);
  if(!here.length){ console.log(`\n${name}: есть на пирамиде (${hits.length} шт), но НЕ В ЭТОЙ КОМНАТЕ (${room}) — пропускаю`); continue; }
  const [r,c]=here[0]; found++;
  console.log(`\n${name} (тайл 0x${tile.toString(16).toUpperCase()}): всего ${hits.length}, в комнате ${room} — ${here.length}; разбираем r${r} c${c}`);
  console.log("  строка | индексы пикселей (. = фон/пусто) | цвета");
  const col=c%32;
  for(let row=0;row<8;row++){
    const scr=MAP_Y0+r*8+row;                // экранная строка клетки (с поправкой поля)
    const lo=(VS-scr)&255;
    const get=idxAt(col,lo);
    const line=[], seen=new Set();
    for(let k=7;k>=0;k--){ const i=get(k); line.push(i?i.toString(16).toUpperCase():"."); if(i) seen.add(i); }
    const cols=[...seen].map(i=>`idx${i} 0x${rawByte(i).toString(16).toUpperCase().padStart(2,"0")} ${rgbOf(rawByte(i))}`).join("  ");
    console.log(`     ${row}   | ${line.join(" ")} | ${cols}`);
  }
  const all=new Set();
  for(let row=0;row<8;row++){ const get=idxAt(col,(VS-(MAP_Y0+r*8+row))&255);
    for(let k=7;k>=0;k--){ const i=get(k); if(i) all.add(i); } }
  console.log(`  ИТОГО ЦВЕТОВ У ПРЕДМЕТА: ${all.size} — ${[...all].map(i=>`idx${i} ${rgbOf(rawByte(i))}`).join(", ")}`);
}
if(!found){ console.log("\nПРОВАЛ ПОКРЫТИЯ: ни ножа, ни кирки на этой пирамиде не нашлось"); process.exit(1); }
