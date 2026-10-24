// scene_shots.js — КОНТРОЛЬНЫЕ СНИМКИ ВСЕХ СЦЕН (кадр 576x288 целиком, вместе с каймой).
//
// ЗАЧЕМ. Перекомпоновка кадра (перенос табло и нижней подписи в кайму, центровка
// vec_vscroll) видна ТОЛЬКО на полном кадре: игровое поле при этом не меняется ни байтом,
// а меняется то, что вокруг него. Поэтому снимаем не поле, а весь кадр — как его видит
// глаз на экране, — и складываем в каталог, чтобы сравнить «до» и «после».
//
// СНИМАЕТСЯ ИДЕАЛЬНЫЙ КАДР (idealBmp), А НЕ ВЫВОД ЛУЧА: луч рвёт картинку по фазе, и два
// прогона одной и той же сборки давали бы разные PNG. idealBmp рисует то, что лежит во
// фреймбуфере, по той же геометрии, что и телевизор (lo = (vscroll - строка) & 255).
//
// Запуск: node tools/verify/scene_shots.js <каталог> [rom] [sym]
"use strict";
const fs=require("fs"),path=require("path");
const {make}=require("./beam_harness.js");
const T=__dirname;
let DIR=null,ROM=null,SYM=null;
for(const x of process.argv.slice(2)){
  if(/\.sym$/i.test(x))SYM=x; else if(/\.rom$/i.test(x))ROM=x; else DIR=x;}
ROM=ROM||T+"/../../build/kvalley_8c.rom";
SYM=SYM||T+"/../../build/kvalley_8c.sym";
if(!DIR){console.log("нужен каталог для снимков");process.exit(1);}
fs.mkdirSync(DIR,{recursive:true});

let n=0;
function shot(E,name){
  const f=path.join(DIR,`${String(n++).padStart(2,"0")}_${name}.png`);
  E.pngFrom(E.idealBmp(),f);
  console.log(`  ${f}  GS=${E.rd(E.L.GameStatus)} sub=${E.rd(E.L.subStatus)} map=${E.rd(E.L.flagPiramideMap)&1}`);
}
function session(body){const E=make(ROM,SYM);
  const runf=k=>{for(let i=0;i<k;i++)E.v06c.oneInterrupt(true);};
  body(E,runf,E.L,E.rd,E.key);}

// ===== СЕССИЯ A: логотип, титул, демо =====
session((E,runf,L,rd,key)=>{
  runf(150); shot(E,"konami");
  for(let i=0;i<600&&rd(L.GameStatus)!==1;i++)runf(1);
  runf(60);  shot(E,"titul");
  for(let i=0;i<1200&&rd(L.GameStatus)!==2;i++)runf(1);
  runf(240); shot(E,"demo");
});

// ===== СЕССИЯ B: партия — геймплей, переход, карта долины, смерть, концовка, бонус =====
session((E,runf,L,rd,key)=>{
  runf(400);
  key(112,1);key(116,1);
  for(let i=0;i<40&&rd(L.GameStatus)!==5;i++)runf(16);
  key(112,0);key(116,0);runf(120);
  shot(E,"geimplei_pyr1");
  key(78,1);runf(3);key(78,0);            // чит N: следующая пирамида
  runf(90);  shot(E,"perehod");
  for(let f=0;f<900;f++){runf(1);if(rd(L.GameStatus)===5&&!(rd(L.flagPiramideMap)&1))break;}
  runf(150); shot(E,"karta_doliny");
  for(let f=0;f<900;f++){runf(1);if(rd(L.GameStatus)===5&&(rd(L.flagPiramideMap)&1))break;}
  runf(150); shot(E,"vhod_pyr2");
  key(68,1);runf(3);key(68,0);runf(120);  // чит D: смерть
  shot(E,"smert");
  for(let i=0;i<900&&!(rd(L.GameStatus)===5&&(rd(L.flagPiramideMap)&1));i++)runf(1);
  runf(60);
  key(69,1);runf(3);key(69,0);            // чит E: концовка
  runf(400); shot(E,"kontsovka");
  runf(700); shot(E,"bonus");
});
