// Запас до луча у порта Городецкого: для каждой записи в fb — сколько тактов остаётся
// до прихода луча на эту строку. Плюс раскладка кадра: какие байтовые строки где на экране.
"use strict";
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[4] || "/tmp/gorod_kv.rom";
const SKIP=+(process.argv[2]||1000), NF=+(process.argv[3]||120);
const E=make(ROM);
E.run(SKIP);
const scroll=E.io.ScrollStart();
const rowOfLo = lo => (scroll-lo)&255;
const beamOfLo = lo => (40+rowOfLo(lo))*192-44;
const FB=a=>a>=0x8000&&a<0xE000;
let W=[];
E.trace.onWrite=(a,v)=>{ if(FB(a)) W.push([E.cyc(),a,v]); };
for(let f=0;f<NF;f++){ E.v06c.oneInterrupt(true); }
if(!W.length){ console.log("ПРОВАЛ ПОКРЫТИЯ: нет записей в fb"); process.exit(1); }
const marg=W.map(([c,a])=>beamOfLo(a&0xff)-c).sort((x,y)=>x-y);
const q=p=>marg[Math.floor(p*(marg.length-1))];
console.log(`записей ${W.length} за ${NF} кадров, scroll=0x${scroll.toString(16)}`);
console.log(`ЗАПАС до луча (такты; >0 = успел): мин ${marg[0]}, p1 ${q(0.01)}, p10 ${q(0.1)}, медиана ${q(0.5)}, макс ${marg[marg.length-1]}`);
const late=marg.filter(m=>m<0).length;
console.log(`записей ПОСЛЕ прохода луча: ${late} (${(100*late/W.length).toFixed(2)}%)`);
// раскладка: какие lo пишутся и на какой экранной строке они видны
const los=new Map();
for(const [c,a] of W){ const lo=a&0xff; los.set(lo,(los.get(lo)||0)+1); }
const keys=[...los.keys()].sort((a,b)=>a-b);
const rows=keys.map(rowOfLo).sort((a,b)=>a-b);
console.log(`байтовые строки с записями: ${keys.length} шт, lo от ${keys[0]} до ${keys[keys.length-1]}`);
console.log(`они же на экране: строки r от ${rows[0]} до ${rows[rows.length-1]} (луч над ними ${(40+rows[0])*192-44}..${(40+rows[rows.length-1])*192-44} тактов от IRQ)`);
// запас по экранным строкам: минимум на каждую десятку строк
const byRow=new Map();
for(const [c,a] of W){ const r=rowOfLo(a&0xff); const m=beamOfLo(a&0xff)-c;
  const k=(r/16)|0; const cur=byRow.get(k); if(!cur||m<cur[0]) byRow.set(k,[m,r]); }
console.log("минимальный запас по полосам экрана (строки r -> такты запаса):");
[...byRow.keys()].sort((a,b)=>a-b).forEach(k=>{ const [m,r]=byRow.get(k);
  console.log(`  r=${String(k*16).padStart(3)}..${String(k*16+15).padStart(3)}: запас ${m} (худшая строка r=${r}, луч в ${(40+r)*192-44})`); });
