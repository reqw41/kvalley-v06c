// ГЕЙТ ДЕМО-МАРШРУТА. Демо воспроизводит записанные клавиши (DemoKeyData) ПО ТИКАМ логики,
// поэтому любая правка шага героя/мумий (например fixed25: protaSpeed 0xA8 -> 0xC9) уводит
// героя с маршрута: 2026-09-12 в 3plane-composite25 герой с тика 456 стоял в левом нижнем
// углу (x=4..12, y=160) до конца демо. Эталон снят с 66bb266 и совпадает с 4+4 (demo-residue):
// 1896 тиков, финал room=0 x=228 y=56, герой жив.
//
// Запуск: node tools/verify/demo_path_gate.js [rom] [sym]
//   BREAK=1 — негативный контроль: подменяет эталон, гейт обязан покраснеть.
//   DUMP=1 — напечатать значения в контрольных тиках (для перегенерации эталона).
// Выход 0 = зелёный. Печатает первые расхождения траектории с эталоном по контрольным тикам.
// СНИМОК ТОЛЬКО ПРИ tickInProgress==0: тик логики может длиться два кадра, и координаты,
// снятые на границе кадра посреди тика, зависят от ТАЙМИНГА (первая редакция гейта
// покраснела на 1 px от переноса тика музыки в шапку ISR при полностью совпавшем маршруте).
"use strict";
const {make}=require(require("path").resolve(__dirname,"beam_harness.js"));
const ROM=process.argv[2]||"build/kvalley_8c.rom", SYM=process.argv[3]||"build/kvalley_8c.sym";
const E=make(ROM,SYM); const {L,rd,v06c}=E;
// контрольные точки: тик -> [room,x,y] — завершённые тики, эталон 66bb266 = 4+4 demo-residue (DUMP=1, 2026-09-12)
const REF={160:[0,132,152],216:[0,169,152],320:[0,113,128],976:[0,100,32],1320:[0,13,32],1704:[0,204,16],1872:[0,214,42]};
const FINAL={ticks:1896,room:0,x:228,y:56,fv:1};
if(process.env.BREAK) { FINAL.x=4; REF[160]=[0,114,160]; }
let tick=-1, prevT=-1, last=null, bad=0, seen=false; const st={};
for(let f=0;f<9000;f++){
  v06c.oneInterrupt(true);
  const gs=rd(L.GameStatus);
  if(gs!==5){ if(seen) break; continue; }
  seen=true;
  const t=rd(L.timer); if(t!==prevT){ prevT=t; tick++; }
  if(tick<0 || rd(L.tickInProgress)&1) continue;   // тик ещё идёт — состояние неконсистентно
  last={tick,f,room:rd(L.ProtaRoom),x:rd(L.ProtaX),y:rd(L.ProtaY),fv:rd(L.flagVivo)};
  st[tick]=last;
}
if(process.env.DUMP){ console.log(Object.keys(REF).map(k=>`${k}:[${st[k]?[st[k].room,st[k].x,st[k].y]:'нет'}]`).join(' ')); }
for(const k of Object.keys(REF)){ const r=REF[k], s=st[k];
  if(!s){ bad++; console.log(`тик ${k}: завершённого состояния не снято`); continue; }
  if(r[0]!==s.room||r[1]!==s.x||r[2]!==s.y){ bad++; console.log(`тик ${k}: room=${s.room} x=${s.x} y=${s.y}, эталон room=${r[0]} x=${r[1]} y=${r[2]}`); }
}
if(!last){ console.log("ДЕМО НЕ НАЧАЛОСЬ (GS=5 не встречен за 9000 кадров)"); process.exit(1); }
// Финал: тиков всего (по смене timer) и координаты ПОСЛЕДНЕГО ЗАВЕРШЁННОГО тика. Конец демо
// (flagVivo=0 из ControlProtaDemo) ставится внутри последнего тика, до его завершения GS
// уже меняется — поэтому fv здесь не проверяем, а финальные координаты берём у last.
const okF = tick+1===FINAL.ticks && last.room===FINAL.room && last.x===FINAL.x && last.y===FINAL.y;
console.log(`покрытие: ${tick+1} тиков демо (завершённых снято до тика ${last.tick}), ${Object.keys(REF).length} контрольных точек; финал room=${last.room} x=${last.x} y=${last.y}`);
if(bad||!okF){ console.log(`ГЕЙТ КРАСНЫЙ: расхождений ${bad}, финал ${okF?"совпал":"НЕ совпал"} (эталон ${FINAL.ticks} тиков, x=${FINAL.x} y=${FINAL.y})`); process.exit(1); }
console.log("ГЕЙТ ЗЕЛЁНЫЙ: демо идёт по записанному маршруту.");
