// Перепись записей в фреймбуфер у порта Городецкого: когда относительно IRQ, куда,
// какими сериями (по столбцам addr+1 / по строкам addr+0x100), сколько раз в один байт.
// Аргументы: [skip кадров] [сколько кадров мерить]
"use strict";
const {make} = require("./gorod_z80_harness.js");
const ROM = "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/kvalley.rom";
const SKIP = +(process.argv[2]||1000), NF = +(process.argv[3]||60);
const E = make(ROM);
E.run(SKIP);

const FB = a => a>=0x8000 && a<0xE000;   // 0xE000+ = ОЗУ/стек (4-я плоскость скрыта палитрой)
let cur = null, frames = [];
E.trace.onWrite = (a,v) => { if(!FB(a)) return; cur.w.push([E.cyc(), a, v, E.cpu.pc]); };

for (let f=0; f<NF; f++){
  cur = {w:[]};
  E.v06c.oneInterrupt(true);
  frames.push(cur);
}
const scroll = E.io.ScrollStart();
console.log(`scroll(порт 0x03) = 0x${scroll.toString(16)}`);

// --- базовая самопроверка ---
const tot = frames.reduce((s,f)=>s+f.w.length,0);
if (tot===0){ console.log("ПРОВАЛ ПОКРЫТИЯ: за измеряемые кадры нет записей в fb"); process.exit(1); }
const busy = frames.filter(f=>f.w.length>0).length;
if (busy < NF*0.5){ console.log(`ПРОВАЛ ПОКРЫТИЯ: пишущих кадров ${busy} из ${NF} — стенд, похоже, не в игре`); process.exit(1); }

// --- статистика по кадрам ---
const cnt = frames.map(f=>f.w.length).sort((a,b)=>a-b);
const q = p => cnt[Math.min(cnt.length-1, Math.floor(p*cnt.length))];
console.log(`кадров ${NF}, записей в fb: медиана ${q(0.5)}, мин ${cnt[0]}, макс ${cnt[cnt.length-1]}, всего ${tot}`);

// --- серии: направление ---
let runCol=0, runRow=0, runOther=0, runsCol=[], runsRow=[];
for (const f of frames){
  let i=0;
  while(i<f.w.length){
    let j=i+1, d=null;
    while(j<f.w.length){
      const dd = f.w[j][1]-f.w[j-1][1];
      if (d===null){ if(dd===1||dd===-1||dd===0x100||dd===-0x100) d=dd; else break; }
      else if (dd!==d) break;
      j++;
    }
    const len=j-i;
    if (len>1){
      if (Math.abs(d)===1){ runCol+=len; runsCol.push(len); }
      else { runRow+=len; runsRow.push(len); }
    } else runOther+=1;
    i=j;
  }
}
const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1):"-";
console.log(`серии: по СТОЛБЦАМ (шаг ±1) ${runCol} байт (серий ${runsCol.length}, средняя ${avg(runsCol)}), ` +
            `по СТРОКАМ (шаг ±0x100) ${runRow} байт (серий ${runsRow.length}, средняя ${avg(runsRow)}), одиночных ${runOther}`);
// гистограмма длин столбцовых серий
const h={}; for(const l of runsCol) h[l]=(h[l]||0)+1;
console.log("длины столбцовых серий:", Object.keys(h).map(Number).sort((a,b)=>a-b).map(k=>`${k}:${h[k]}`).join(" "));

// --- сколько раз пишется один и тот же байт за кадр (стирание отдельным проходом?) ---
let mult=0, single=0, maxmult=0, sampleMulti=null;
for (const f of frames){
  const m=new Map();
  for (const [c,a] of f.w) m.set(a,(m.get(a)||0)+1);
  for (const [a,n] of m){ if(n>1){mult++; if(n>maxmult){maxmult=n;} if(!sampleMulti)sampleMulti=[a,n];} else single++; }
}
console.log(`байты за кадр: записаны 1 раз ${single}, >1 раза ${mult} (макс ${maxmult})`);

// --- время от IRQ ---
const all=[]; for(const f of frames) for(const w of f.w) all.push(w[0]);
all.sort((a,b)=>a-b);
const pc=p=>all[Math.floor(p*(all.length-1))];
console.log(`такт от IRQ по всем записям: мин ${all[0]}, p10 ${pc(0.1)}, медиана ${pc(0.5)}, p90 ${pc(0.9)}, макс ${all[all.length-1]} (кадр 59904)`);
const firsts=frames.filter(f=>f.w.length).map(f=>f.w[0][0]).sort((a,b)=>a-b);
const lasts =frames.filter(f=>f.w.length).map(f=>f.w[f.w.length-1][0]).sort((a,b)=>a-b);
console.log(`первая запись кадра: медиана ${firsts[firsts.length>>1]}, макс ${firsts[firsts.length-1]}`);
console.log(`последняя запись кадра: медиана ${lasts[lasts.length>>1]}, макс ${lasts[lasts.length-1]}`);

// --- гистограмма: такт от IRQ (корзины по 2000) -> байт ---
const bins=new Array(30).fill(0);
for(const c of all) bins[Math.min(29,(c/2000)|0)]++;
console.log("гистограмма такт-от-IRQ -> байт:");
for(let i=0;i<30;i++) if(bins[i]) console.log(`  ${String(i*2000).padStart(5)}..${String(i*2000+1999).padStart(5)}: ${bins[i]}`);

// --- где живут пишущие процедуры (PC) ---
const bypc=new Map();
for(const f of frames) for(const w of f.w){ const k=w[3]&0xfff8; bypc.set(k,(bypc.get(k)||0)+1); }
const top=[...bypc].sort((a,b)=>b[1]-a[1]).slice(0,12);
console.log("горячие PC (округл. до 8) -> байт:", top.map(([k,n])=>`${k.toString(16)}:${n}`).join(" "));
