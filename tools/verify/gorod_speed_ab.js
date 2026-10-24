// A/B скорости героя: наш порт против порта Городецкого, ОДНИМ методом.
// Метод: держим «вправо», раз в кадр читаем X героя из MSX-структуры sprAttrib, слот 4
// (у обоих портов структура одна и та же: 4 байта на слот Y,X,pat,col; у Городецкого
// таблица найдена перебором ОЗУ по поведению — 0x3b00, слот 4 => X в 0x3b11).
// Считаем пиксели за кадр на отрезке НЕПРЕРЫВНОЙ ходьбы (X растёт, разрывы <= 12 кадров).
"use strict";
const path=require("path");
const G=require("./gorod_z80_harness.js");
const B=require("./beam_harness.js");
const NF=+(process.argv[2]||800);

function walkStats(xs){
  // самый длинный отрезок, где X строго растёт с паузами <= 12 кадров
  let bi=0,bj=0,i=0;
  while(i<xs.length){
    let j=i,lastCh=i;
    while(j+1<xs.length){
      const d=((xs[j+1]-xs[j]+128)&255)-128;
      if(d>0){ j++; lastCh=j; }
      else if(d===0 && j-lastCh<12){ j++; }
      else break;
    }
    if(lastCh-i>bj-bi){ bi=i; bj=lastCh; }
    i=Math.max(j+1,i+1);
  }
  const fr=bj-bi, px=((xs[bj]-xs[bi]+256)&255);
  return {fr,px,pxf:fr?px/fr:0};
}

// --- Городецкий ---
const EG=G.make("/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom");
EG.run(1000);
const pressG=()=>{EG.key(32,1);EG.run(10);EG.key(32,0);EG.run(60);};
pressG(); pressG(); EG.run(400);
EG.key(39,1);
const xg=[]; for(let f=0;f<NF;f++){ EG.run(1); xg.push(EG.rd(0x3b11)); }
EG.key(39,0);
const sg=walkStats(xg);

// --- наш порт ---
const ROOT=path.join(__dirname,"..","..");
const EO=B.make(path.join(ROOT,"build","kvalley_8c.rom"), path.join(ROOT,"build","kvalley_8c.sym"));
const st=B.toGame(EO);
if(st!==5){ console.log(`ПРОВАЛ ПОКРЫТИЯ: наш порт не дошёл до геймплея (GameStatus=${st})`); process.exit(1); }
EO.run(120);
const ATTR=EO.L.sprAttrib;
if(ATTR===undefined){ console.log("ПРОВАЛ ПОКРЫТИЯ: в .sym нет sprAttrib"); process.exit(1); }
EO.key(39,1);
const xo=[]; for(let f=0;f<NF;f++){ EO.run(1); xo.push(EO.rd(ATTR+4*4+1)); }
EO.key(39,0);
const so=walkStats(xo);

if(sg.fr<50||so.fr<50){ console.log(`ПРОВАЛ ПОКРЫТИЯ: короткий отрезок ходьбы (Городецкий ${sg.fr} кадров, наш ${so.fr})`); process.exit(1); }
console.log(`Городецкий: ходьба ${sg.fr} кадров, ${sg.px} px => ${sg.pxf.toFixed(3)} px/кадр (${(1/sg.pxf).toFixed(2)} кадра на пиксель)`);
console.log(`наш порт  : ходьба ${so.fr} кадров, ${so.px} px => ${so.pxf.toFixed(3)} px/кадр (${(1/so.pxf).toFixed(2)} кадра на пиксель)`);
console.log(`отношение скоростей наш/Городецкий = ${(so.pxf/sg.pxf).toFixed(2)}x`);
