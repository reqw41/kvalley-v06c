// map_slot_free.js — ПЕРЕПИСЬ СЛОТОВ ПАЛИТРЫ НА КАРТЕ ДОЛИНЫ.
// Зачем: логотип в полосе над полем (клавиша L) не может пользоваться слотами, которые карта
// рисует сама, — но и не обязан их обходить, если у слота НОЛЬ пикселей. Скрипт снимает
// гистограмму индексов по трём видимым плоскостям на КАЖДОМ показе карты (переходы гоняются
// читом H, то есть все четыре схемы камня) и печатает максимум по каждому слоту.
// Слот с максимумом 0 на ВСЕХ показах занимать безопасно: картинка карты не изменится.
// «Мы на карте» определяется не по GameStatus (карта живёт и под GS=5), а по патч-сайту
// vec_brillo_pal: там стоит `jp vbp_map`.
//
// === ЧТО ЭТОТ СКРИПТ УЖЕ ДОКАЗАЛ (2026-08-03) =======================================
// ОДНОГО ПОКАЗА КАРТЫ ДЛЯ ТАКОГО ВЫВОДА НЕ ХВАТАЕТ. По первому показу (пирамида 1 -> 6)
// выходило, что idx2 и idx10 пусты и их можно занять под тона камня целевой пирамиды. На
// втором и третьем показах у них уже 5-7 и 22 пикселя: ПОДСВЕТКА ЦЕЛЕВОЙ ПИРАМИДКИ КОЧУЕТ
// ПО СЛОТАМ. Сумма её пикселей постоянна (47 / 47 / 49), а раскладка по слотам каждый раз
// другая — 0/5/0/42, 5/0/22/20, 7/0/22/20 для idx2/idx6/idx10/idx14.
// ПОЧЕМУ ТАК. Подсветка рисуется установкой бита ОДНОЙ плоскости (p2) поверх фона, БЕЗ
// гашения остальных, поэтому итоговый слот = p2 + то, что лежало под ним:
//   над чёрным фоном      -> idx2   (p2)
//   над буквами GOAL idx4 -> idx6   (p1+p2)
//   над шейпом пирамид idx8 -> idx10 (p0+p2)
//   над телом пергамента idx12 -> idx14 (p0+p1+p2)
// Четыре слота крутятся НЕ потому, что подсветка четырёхцветная, а потому что она
// накладывается OR-ом на четыре разных фона. Свободных слотов на карте нет ни одного.
// Запуск: node tools/verify/map_slot_free.js [rom] [sym]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||ROM.replace(/\.rom$/,".sym");
const E=make(ROM,SYM);
const {L,rd,run,key,memory,io}=E;
for(const s of ["vec_brillo_pal","vbp_map","piramideDest","piramideActual"])
  if(L[s]===undefined){console.log("нет символа "+s);process.exit(2);}
const onMap=()=>rd(L.vec_brillo_pal)===0x0C3 &&
  (rd(L.vec_brillo_pal+1)|(rd(L.vec_brillo_pal+2)<<8))===L.vbp_map;
const hex=c=>((c>>>0)&0xFFFFFF).toString(16).padStart(6,"0");
function census(){                       // пиксели на каждый чётный слот
  const c=new Array(16).fill(0),b=memory.bytes,tb=a=>memory.tobank(a);
  for(let i=0;i<8192;i++){
    const p0=b[tb(0x8000+i)],p1=b[tb(0xA000+i)],p2=b[tb(0xC000+i)];
    if(!(p0|p1|p2)){c[0]+=8;continue;}
    for(let k=7;k>=0;k--)c[(((p0>>k)&1)<<3)|(((p1>>k)&1)<<2)|(((p2>>k)&1)<<1)]++;
  }
  return c;
}
if(toGame(E)!==5){console.log("нет геймплея");process.exit(2);}
const SLOTS=[0,2,4,6,8,10,12,14];
const shows=[];
// ЧТО СЧИТАЕТСЯ «ПОКАЗОМ КАРТЫ». Ветку vbp_map ставит setupPergamino ДО того, как карта
// нарисована, поэтому первые десятки кадров на экране ещё висит доедаемый шторкой лабиринт —
// его пиксели в idx8/idx10 к карте отношения не имеют. Признак «карта уже на экране» —
// ПЕРГАМЕНТ: его тело idx12 занимает ~15.7 тыс. пикселей, порога 10000 достаточно.
const DRAWN=10000;
// Читом H прыгаем по пирамидам: каждый переход идёт ЧЕРЕЗ карту долины, а H ставит
// piramideDest наравне со штатным выходом через дверь.
for(let jump=0;jump<4;jump++){
  for(let i=0;i<2000&&!(rd(L.GameStatus)===5&&!onMap());i++)run(1);   // дождаться геймплея
  key(72,1);run(4);key(72,0);
  let cur=null;
  for(let i=0;i<2000;i++){
    run(1);
    if(onMap()){
      const c=(i&7)===0?census():null;
      if(c&&c[12]>=DRAWN){
        if(!cur)cur={dest:rd(L.piramideDest),act:rd(L.piramideActual),n:0,max:new Array(16).fill(0),
                     pal:new Map()};
        for(const s of SLOTS)if(c[s]>cur.max[s])cur.max[s]=c[s];
        cur.n++;
        for(const s of SLOTS){const v=io.Palette[s]>>>0;
          (cur.pal.get(s)||cur.pal.set(s,new Set()).get(s)).add(v);}
      }
    } else if(cur){shows.push(cur);cur=null;break;}
  }
  if(cur)shows.push(cur);
}
console.log("ПОКАЗЫ КАРТЫ ДОЛИНЫ: "+shows.length);
console.log("показ  пирамида->цель  замеров  "+SLOTS.map(s=>("idx"+s).padStart(8)).join(""));
const glob=new Array(16).fill(0);
shows.forEach((s,i)=>{
  for(const k of SLOTS)if(s.max[k]>glob[k])glob[k]=s.max[k];
  console.log(`  ${String(i+1).padStart(3)}  ${String(s.act).padStart(6)}->${String(s.dest).padStart(3)}  `+
    `${String(s.n).padStart(7)}  `+SLOTS.map(k=>String(s.max[k]).padStart(8)).join(""));
});
console.log("МАКСИМУМ ПО ВСЕМ ПОКАЗАМ:            "+SLOTS.map(k=>String(glob[k]).padStart(8)).join(""));
const free=SLOTS.filter(k=>k!==0&&glob[k]===0);
console.log("\nСЛОТЫ С НУЛЁМ ПИКСЕЛЕЙ НА КАРТЕ (можно занять): "+(free.length?free.map(k=>"idx"+k).join(", "):"нет"));
console.log("значения слотов на карте (разные цвета за показ = слот пульсирует):");
for(const k of SLOTS){
  const all=new Set(); for(const s of shows) for(const v of (s.pal.get(k)||[]))all.add(v);
  console.log(`  idx${String(k).padStart(2)}  `+[...all].map(hex).join(" ")+
    (glob[k]===0?"   (пикселей 0 — невидим)":""));
}
