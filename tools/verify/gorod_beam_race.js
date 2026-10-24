// Гонка с лучом у порта Городецкого: что ЛУЧ видит в байте в момент прохода над строкой.
// «Дырка» = бит, который был выставлен ДО кадра и остался ПОСЛЕ кадра, но в момент луча = 0
// (то самое мерцание: спрайт стёрт и ещё не нарисован). Аналог нашей метрики «транзиент».
// Аргументы: [skip кадров] [кадров измерения]
"use strict";
const {make} = require("./gorod_z80_harness.js");
const ROM = process.argv[4] || "/tmp/gorod_kv.rom";
const SKIP=+(process.argv[2]||1000), NF=+(process.argv[3]||300);
const E=make(ROM);
E.run(SKIP);
if(process.argv[4]==="game"){                       // войти в геймплей и держать «вправо»
  const press=()=>{E.key(32,1);E.run(10);E.key(32,0);E.run(60);};
  press(); press(); E.run(400); E.key(39,1);
}
const scroll=E.io.ScrollStart();
// экранная строка r показывает байтовую строку lo=(scroll-r)&255 => r=(scroll-lo)&255
// луч над экранной строкой r: (40+r)*192-44 такта от IRQ (та же модель, что в beam_harness.js)
const beamOfLo = lo => { const r=(scroll-lo)&255; return (40+r)*192-44; };
const FB = a => a>=0x8000 && a<0xE000;

let W=null, start=null;
E.trace.onWrite=(a,v)=>{ if(!FB(a))return;
  if(!start.has(a)) start.set(a, E.rd(a));       // значение ДО первой записи в этом кадре
  W.push([E.cyc(), a, v]); };

let holes=0, holeBytes=0, stale=0, framesWithHole=0, totalW=0, gaps=[];
const pop=x=>{let n=0;while(x){n+=x&1;x>>=1;}return n;};
for(let f=0; f<NF; f++){
  W=[]; start=new Map();
  E.v06c.oneInterrupt(true);
  totalW+=W.length;
  // значение в момент луча и в конце кадра
  const beamVal=new Map(), finVal=new Map();
  for(const [c,a,v] of W){
    const T=beamOfLo(a&0xff);
    if(c<T) beamVal.set(a,v);                     // последняя запись ДО луча
    finVal.set(a,v);
  }
  let fh=0;
  for(const [a,vf] of finVal){
    const vs=start.get(a);
    const vb=beamVal.has(a)?beamVal.get(a):vs;
    const h=pop(vs & vf & ~vb & 0xff);
    if(h){ fh+=h; holeBytes++; }
    if(vb!==vf && vb!==vs) stale++;
  }
  if(fh){ framesWithHole++; holes+=fh; }
  // окно «стёрто, но ещё не нарисовано» по каждому байту: такт стирания (v==0) -> такт возврата
  const last0=new Map();
  for(const [c,a,v] of W){
    if(v===0) last0.set(a,c);
    else if(last0.has(a)){ gaps.push(c-last0.get(a)); last0.delete(a); }
  }
}
if(totalW===0){ console.log("ПРОВАЛ ПОКРЫТИЯ: за измерение нет записей в fb"); process.exit(1); }
if(gaps.length===0){ console.log("ПРОВАЛ ПОКРЫТИЯ: не найдено ни одной пары «стёрли(0) -> нарисовали»"); process.exit(1); }
gaps.sort((a,b)=>a-b);
const gq=p=>gaps[Math.floor(p*(gaps.length-1))];
console.log(`кадров ${NF}, записей в fb ${totalW} (${(totalW/NF).toFixed(0)}/кадр), scroll=0x${scroll.toString(16)}`);
console.log(`ДЫРКИ ПОД ЛУЧОМ: ${holes} пикселей в ${holeBytes} байтах, кадров с дыркой ${framesWithHole}/${NF}`);
console.log(`луч увидел «не то и не это» (тиринг) в ${stale} байтах`);
console.log(`окно «стёрт -> нарисован» по байту, тактов: мин ${gaps[0]}, p50 ${gq(0.5)}, p90 ${gq(0.9)}, макс ${gaps[gaps.length-1]} (пар ${gaps.length})`);
