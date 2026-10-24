// blit_unify_census.js — ПЕРЕПИСЬ СПЕЦПУТЕЙ ТАЙЛОВОГО БЛИТТЕРА.
// Зачем: перед унификацией (docs/BLITTER_UNIFICATION.md) надо знать по КАЖДОМУ пути
//   1) сколько он стоит БАЙТ (берём из .sym: размер = адрес следующей метки - свой),
//   2) сколько раз ИСПОЛНЯЕТСЯ за реальный геймплейный прогон,
//   3) сколько ТАКТОВ съедает в СРЕДНЕМ и в ПИКОВОМ кадре (пик = главный источник фликера).
// Метод атрибуции: вход в блит = PC==vbt8_ent, выход = возврат в vec_blit_tile
// (адрес сразу за `call vbt8_ent`). Всё, что исполнено между ними, приписывается
//   - «прологу» (vbt_core + белый флаг + cc + диспетчер) до попадания в точку пути,
//   - самому ПУТИ после неё.
// Путь опознаём по первой достигнутой точке из PATHS; ветку общего механизма
// vbt8_planes дополнительно разбиваем по коду тайла (vw_byte) — гемы/нож/потолок/рама.
// Дополнительно: гистограмма опкодов -> ЧЕСТНАЯ таблица «сколько тактов стоит команда
// в этой машине» (шинная модель Вектора, 4 такта на слот), она нужна, чтобы считать
// цену ПРЕДЛАГАЕМОГО обобщённого движка без единой правки src/.
// Запуск: node tools/verify/blit_unify_census.js [rom] [sym] [кадров]
"use strict";
const fs=require("fs");
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||3000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu}=E;

// --- размеры процедур из .sym ---
const syms=[];
for(const l of fs.readFileSync(SYM,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);
  if(m){const a=parseInt(m[2],16); if(a<0x10000) syms.push([a,m[1]]);}
}
syms.sort((a,b)=>a[0]-b[0]);
function span(from,to){ // байт от метки from до метки to
  return (L[to]-L[from])|0;
}

// --- точки входа путей ---
const RET = L.vbt8_ent!==undefined ? null : null;
// адрес возврата: ищем в ROM `call vbt8_ent` внутри vec_blit_tile
let retAddr=null;
for(let a=L.vec_blit_tile;a<L.vec_blit_tile+0x80;a++){
  if(rd(a)===0xCD && rd(a+1)===(L.vbt8_ent&255) && rd(a+2)===(L.vbt8_ent>>8)){retAddr=a+3;break;}
}
if(retAddr===null){console.log("не нашёл call vbt8_ent");process.exit(1);}

const PATHS=[
  ["vbt8_planes","ОБЩИЙ vbt8_planes"],
  ["vbt8_p1","штатный (план не задан)"],
  // 2026-08-04: шесть отдельных петель (кирка, три рычага, две ступени) свёрнуты в один
  // сегментный движок vbt8_seg; какой именно тайл им нарисован, видно в разбивке по vw_byte.
  ["vbt8_seg","сегментный движок (рычаг/ступени/кирка)"],
  ["vbt8_brick","кирпич vbt8_brick"],
  ["vbt8_mapt","карта vbt8_mapt"],
  ["vec_blit_brillo","блеск vec_blit_brillo"],
];
const entry=new Map();
for(const [lab,name] of PATHS){ if(L[lab]===undefined){console.log("нет метки "+lab);process.exit(1);} entry.set(L[lab],name); }

// --- сбор ---
const cnt=new Uint32Array(0x10000), cy8=new Float64Array(0x10000);
const stat=new Map();  // имя пути -> {n, cy}
const tileHist=new Map(); // код тайла -> n
const planTile=new Map(); // тайл -> n (для vbt8_planes)
function bump(map,k,cy){const e=map.get(k)||{n:0,cy:0};e.n++;e.cy+=cy;map.set(k,e);}
let inBlit=false, curPath=null, curTile=0, prologCy=0, pathCy=0;
let frameBlitCy=0, frameTiles=0;
const frames=[]; // {cy, tiles, byPath:Map}
let frameByPath=new Map();
let active=false;

const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc; oI(); if(!active) return;
  const vc=cpu.vcycles|0;
  if(inBlit||pc===L.vbt8_ent){cnt[pc]++; cy8[pc]+=vc;}
  if(!inBlit){
    if(pc===L.vbt8_ent){inBlit=true;curPath=null;prologCy=vc;pathCy=0;curTile=rd(L.vw_byte);frameTiles++;}
    return;
  }
  if(pc===retAddr){ // конец блита клетки
    const nm=curPath||"???";
    bump(stat,nm,pathCy);
    const e=frameByPath.get(nm)||0; frameByPath.set(nm,e+pathCy);
    const p=frameByPath.get("(пролог vbt_core+флаги+диспетчер)")||0;
    frameByPath.set("(пролог vbt_core+флаги+диспетчер)",p+prologCy);
    bump(stat,"(пролог vbt_core+флаги+диспетчер)",prologCy);
    frameBlitCy+=prologCy+pathCy;
    tileHist.set(curTile,(tileHist.get(curTile)||0)+1);
    inBlit=false;curPath=null;
    return;
  }
  if(curPath===null){
    const nm=entry.get(pc);
    if(nm!==undefined){
      curPath=nm;
      if(pc===L.vbt8_planes){ planTile.set(curTile,(planTile.get(curTile)||0)+1); }
      pathCy=vc;
      return;
    }
    prologCy+=vc;
  }else pathCy+=vc;
};

// --- сценарий: блуждание + перескок пирамид (как в z80_gain/beam_top) ---
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1, gframes=0;
const gsFrames=new Map(), gsTiles=new Map(), gsCy=new Map();
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  const gs=rd(L.GameStatus);
  active=true;
  frameBlitCy=0;frameTiles=0;frameByPath=new Map();
  v06c.oneInterrupt(true);
  gframes++;frames.push({cy:frameBlitCy,tiles:frameTiles,byPath:frameByPath,gs});
  gsFrames.set(gs,(gsFrames.get(gs)||0)+1);
  gsTiles.set(gs,(gsTiles.get(gs)||0)+frameTiles);
  gsCy.set(gs,(gsCy.get(gs)||0)+frameBlitCy);
}
if(held>0)E.key(held,0);
active=false;

// --- отчёт ---
const F=gframes;
console.log(`ROM=${ROM}  кадров всего ${F} (бюджет кадра 59904 такта)\n`);
console.log("=== РАСПРЕДЕЛЕНИЕ ПО GameStatus (5 = геймплей, прочее = переходы/скролл) ===");
for(const [gs,n] of [...gsFrames.entries()].sort((a,b)=>b[1]-a[1]))
  console.log(`  GS=${gs}: кадров ${String(n).padStart(5)}, клеток ${String(gsTiles.get(gs)||0).padStart(6)} (${((gsTiles.get(gs)||0)/n).toFixed(2)}/кадр), тактов блита ${((gsCy.get(gs)||0)/n).toFixed(0)}/кадр`);
console.log("");

const sizes={
  "ОБЩИЙ vbt8_planes":span("vbt8_planes","vbt8_gem")+span("vbt8_p1","vbt8_seg"),
  "штатный (план не задан)":0,
  // движок + его программы (kv_pg_* лежат подряд от stair2 до маски кирки)
  "сегментный движок (рычаг/ступени/кирка)":span("vbt8_seg","vbt8_ad")+span("kv_pg_stair2","kv_pico_p1"),
  "кирпич vbt8_brick":span("vbt8_brick","vbt_core"),
  "карта vbt8_mapt":span("vbt8_mapt","vec_map_whiteforce"),
  "блеск vec_blit_brillo":span("vec_blit_brillo","vec_brillo_pal"),
  // диспетчер: пролог + цикл по таблице + сама таблица + разбор попадания
  "(пролог vbt_core+флаги+диспетчер)":span("vbt8_ent","vbt8_chk_map")+span("vbt8_tab","vbt8_planes")+span("vbt_core","vbt_mix"),
};
console.log("=== ПУТИ: байты / исполнения / такты ===");
console.log("  байт  исполн.   такт/исп   такт/кадр   %кадра  путь");
const arr=[...stat.entries()].sort((a,b)=>b[1].cy-a[1].cy);
for(const [nm,e] of arr){
  const sz=sizes[nm]!==undefined?sizes[nm]:"?";
  console.log(`  ${String(sz).padStart(4)}  ${String(e.n).padStart(7)}  ${(e.cy/e.n).toFixed(0).padStart(8)}  ${(e.cy/F).toFixed(0).padStart(9)}  ${(e.cy/F/59904*100).toFixed(2).padStart(6)}%  ${nm}`);
}
const totCy=arr.reduce((s,[,e])=>s+e.cy,0);
console.log(`  ИТОГО тайлового блита: ${(totCy/F).toFixed(0)} такт/кадр (${(totCy/F/59904*100).toFixed(1)}% кадра), клеток ${(frames.reduce((s,x)=>s+x.tiles,0)/F).toFixed(2)}/кадр`);

// --- пиковые кадры ---
frames.sort((a,b)=>b.cy-a.cy);
const pk=frames.slice(0,Math.max(1,Math.round(frames.length*0.01)));
console.log(`\n=== ПИКОВЫЕ КАДРЫ (верхний 1% по тактам тайлового блита, ${pk.length} кадров) ===`);
const pkAgg=new Map();let pkCy=0,pkTiles=0;
for(const f of pk){pkCy+=f.cy;pkTiles+=f.tiles;for(const [k,v] of f.byPath)pkAgg.set(k,(pkAgg.get(k)||0)+v);}
console.log(`  такт/пиковый кадр ${(pkCy/pk.length).toFixed(0)} (${(pkCy/pk.length/59904*100).toFixed(1)}% кадра), клеток ${(pkTiles/pk.length).toFixed(1)}`);
for(const [k,v] of [...pkAgg.entries()].sort((a,b)=>b[1]-a[1]))
  console.log(`    ${(v/pk.length).toFixed(0).padStart(7)} такт/пик.кадр  ${k}`);
const med=frames[Math.floor(frames.length/2)];
console.log(`  медианный кадр: ${med.cy} такт, клеток ${med.tiles}`);
const p99=frames[Math.floor(frames.length*0.01)];
console.log(`  99-й перцентиль: ${p99.cy} такт; максимум ${frames[0].cy} такт (клеток ${frames[0].tiles})`);

// --- какие тайлы идут через общий механизм ---
console.log(`\n=== ЧЕРЕЗ vbt8_planes ПРОШЛИ ТАЙЛЫ ===`);
for(const [t,n] of [...planTile.entries()].sort((a,b)=>b[1]-a[1]))
  console.log(`   0x${t.toString(16).toUpperCase().padStart(2,"0")}  x${n}`);
console.log(`\n=== ТОП-20 ТАЙЛОВ ПО ЧИСЛУ БЛИТОВ ===`);
for(const [t,n] of [...tileHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20))
  console.log(`   0x${t.toString(16).toUpperCase().padStart(2,"0")}  x${n}  (${(n/F).toFixed(2)}/кадр)`);

// --- разрез ПРОЛОГА по меткам (где именно лежат его такты) ---
console.log(`\n=== РАЗРЕЗ ПО МЕТКАМ ВНУТРИ БЛИТА (такт/кадр, доля от блита) ===`);
const perLab=new Map();
function labOf(pc){let lo=0,hi=syms.length-1,r=0;while(lo<=hi){const m=(lo+hi)>>1;if(syms[m][0]<=pc){r=m;lo=m+1;}else hi=m-1;}return syms[r][1];}
for(let pc=0;pc<0x10000;pc++){if(!cnt[pc])continue;const k=labOf(pc);perLab.set(k,(perLab.get(k)||0)+cy8[pc]);}
const grandTot=[...perLab.values()].reduce((a,b)=>a+b,0);
for(const [k,v] of [...perLab.entries()].sort((a,b)=>b[1]-a[1]).slice(0,18))
  console.log(`  ${(v/F).toFixed(0).padStart(6)}  ${(v/grandTot*100).toFixed(1).padStart(5)}%  ${k}`);

// --- честная таблица «цена команды» для расчёта нового движка ---
const opCost=new Map();
for(let pc=0;pc<0x10000;pc++){
  if(!cnt[pc])continue;
  const op=rd(pc);
  const e=opCost.get(op)||{n:0,cy:0};e.n+=cnt[pc];e.cy+=cy8[pc];opCost.set(op,e);
}
const WANT=[0x3E,0x7E,0x12,0x2F,0x1D,0x05,0xC3,0xC2,0xCD,0xC9,0x23,0x77,0x2B,0x1B,0x21,0x11,0x3A,0x32,0xB7,0xE6,0xFE,0x87,0x4F,0x57,0x5F,0x67,0x6F,0x79,0x7A,0x7C,0x7D,0xAF,0x0D,0x3D,0x1A,0x13,0xD6,0xC6,0x81,0xC5,0xC1,0xE1,0xE5];
console.log(`\n=== ЦЕНА КОМАНД В ЭТОЙ МАШИНЕ (среднее по прогону, шинная модель Вектора) ===`);
let line="";
for(const op of WANT){const e=opCost.get(op);if(!e)continue;
  line+=` ${op.toString(16).toUpperCase().padStart(2,"0")}=${(e.cy/e.n).toFixed(0)}`;
  if(line.length>90){console.log("  "+line);line="";}}
if(line)console.log("  "+line);
