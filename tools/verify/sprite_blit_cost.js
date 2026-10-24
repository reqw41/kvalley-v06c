// Разбивка RENDER (updateSprites / vec_nat_sprites) на под-стоимости спрайт-блита
// через SP-bracket'инг тактов по под-функциям. Фаза 2 POP-плана (measure-before-optimize).
// Под-функции:
//   vec_nsx_clear = стирание prev footprint (16 строк x 2-3 столбца = 0)
//   vec_nsx       = рисование спрайта (диспетч jp(hl) по X&7 + shift-петли), ВКЛ. вложенные
//   vec_nsx_col   = сами shift-петли (rot{s}_loop), вложено в vec_nsx
//   vnsx_rev16    = зеркало (bit-reverse 16Б по LUT), вложено в vec_nsx
// Навигация как frame_budget_cats: пиковый busy-кадр (>=2 мумии, без скролла), пик по RENDER.
// Использ.: node tools/verify/sprite_blit_cost.js <rom> <sym>
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function readSym(p){const s={};for(const l of fs.readFileSync(p,"latin1").split("\n")){const g=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(g)s[g[1]]=parseInt(g[2],16);}return s;}
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(process.argv[2]));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const S=readSym(process.argv[3]);
// БЫЛО зашито 0x6bc8/0x6c3a (эра 0x6B00/0x6C00) — теперь по именам из .sym.
if(!S.enemyAttrib||!S.ProtaRoom){console.log("нет символов enemyAttrib/ProtaRoom в .sym");process.exit(2);}
const ENEMY=S.enemyAttrib, PROTAROOM=S.ProtaRoom, BUDGET=59904;
const rd=a=>memory.bytes[memory.tobank(a)];
// ВНИМАНИЕ: vec_nsx/vec_nsx_clear/vec_nsx_col/vnsx_rev16 — символы СТАРОГО спрайт-блиттера,
// он полностью переписан (см. src/v06c/vec_sprites.asm, семейства vns_*/vsu_*/vsp_*/vso_*),
// в текущем .sym этих имён больше нет. Подстановка "похожего" адреса была бы угадыванием
// не той функции — вместо этого явная ошибка: разбивка ниже требует ПЕРЕПИСАТЬ под новый
// конвейер (см. отчёт), а не патч адреса.
if(!S.vec_nsx_clear||!S.vec_nsx||!S.vec_nsx_col||!S.vnsx_rev16){
  console.log("нет символов vec_nsx*/vnsx_rev16 в .sym — спрайт-блиттер переписан (vns_*/vsu_*/vsp_*/vso_*), скрипт нужно переписать под новый конвейер, а не патчить адреса");
  process.exit(2);
}
const FN={CLEAR:S.vec_nsx_clear, DRAW:S.vec_nsx, COL:S.vec_nsx_col, REV:S.vnsx_rev16};
const NAMES=Object.keys(FN);
const NS=S.vec_nat_sprites;
let st={}; // per-fn {active,sp,cyc,total,calls}
function resetSt(){st={};for(const n of NAMES)st[n]={active:false,sp:0,cyc:0,total:0,calls:0};
  st.RENDER={active:false,sp:0,cyc:0,total:0,calls:0};}
resetSt();
let recording=false;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc&0xffff, sp=cpu.sp&0xffff;
  if(recording){
    // финализируем вернувшиеся
    for(const n of NAMES){const e=st[n]; if(e.active && sp>e.sp){e.active=false;e.total+=e.cyc;e.calls++;}}
    {const e=st.RENDER; if(e.active && sp>e.sp){e.active=false;e.total+=e.cyc;e.calls++;}}
    // входы
    for(const n of NAMES){if(pc===FN[n] && !st[n].active){st[n].active=true;st[n].sp=sp;st[n].cyc=0;}}
    if(pc===NS && !st.RENDER.active){st.RENDER.active=true;st.RENDER.sp=sp;st.RENDER.cyc=0;}
  }
  oI();
  if(recording){
    const vc=cpu.vcycles|0;
    for(const n of NAMES) if(st[n].active) st[n].cyc+=vc;
    if(st.RENDER.active) st.RENDER.cyc+=vc;
  }
};
function key(dn,c){const e={keyCode:c,preventDefault(){}};dn?keyboard.keyDown(e):keyboard.keyUp(e);}
function mummies(){let n=0;for(let i=0;i<4;i++)if(rd(ENEMY+i*4)!==0xE0)n++;return n;}
function frameProf(dn){resetSt();recording=true;if(dn!==undefined)key(true,dn);v06c.oneInterrupt(true);if(dn!==undefined)key(false,dn);recording=false;
  const snap={};for(const n of NAMES)snap[n]={t:st[n].total,c:st[n].calls};
  snap.RENDER={t:st.RENDER.total,c:st.RENDER.calls};
  return {s:snap, mum:mummies(), room:rd(PROTAROOM)};}
// навигация идентична frame_budget_cats
recording=false;
for(let f=0;f<420;f++)v06c.oneInterrupt(true);
for(let f=0;f<900;f++){key(true,32);v06c.oneInterrupt(true);key(false,32);}
for(let f=0;f<400;f++){key(true,37);v06c.oneInterrupt(true);key(false,37);}
const KNIFE=[90,88,77,32];
let prevRoom=rd(PROTAROOM); const frames=[];
for(let f=0;f<400;f++){
  let dn=37; if(f%6===0)dn=KNIFE[(f/6|0)%KNIFE.length];
  const r=frameProf(dn); r.scroll=(r.room!==prevRoom); prevRoom=r.room; frames.push(r);
}
const busy=frames.filter(x=>x.mum>=2 && !x.scroll);
const peak=busy.reduce((a,b)=>b.s.RENDER.t>a.s.RENDER.t?b:a, busy[0]);
console.log("busy-кадров:",busy.length,"| пиковый RENDER=",peak.s.RENDER.t,"тактов, мумий=",peak.mum);
function show(r,tag){
  const s=r.s;
  console.log(`\n=== ${tag} ===`);
  console.log(`RENDER (vec_nat_sprites): ${s.RENDER.t} т  (${(100*s.RENDER.t/BUDGET).toFixed(1)}% кадра)`);
  const clr=s.CLEAR, drw=s.DRAW, col=s.COL, rev=s.REV;
  const drawOnly=drw.t-col.t-rev.t; // overhead vec_nsx (адресация/половины) без вложенных
  console.log(`  vec_nsx_clear (стирание): ${String(clr.t).padStart(6)} т, ${clr.c} выз, ${(clr.t/(clr.c||1)).toFixed(0)} т/выз`);
  console.log(`  vec_nsx       (рисование): ${String(drw.t).padStart(6)} т, ${drw.c} выз, ${(drw.t/(drw.c||1)).toFixed(0)} т/выз (вкл. вложенное)`);
  console.log(`    ├ vec_nsx_col (shift-петли): ${String(col.t).padStart(6)} т, ${col.c} выз (полустолбцов), ${(col.t/(col.c||1)).toFixed(0)} т/полуст`);
  console.log(`    ├ vnsx_rev16  (зеркало):     ${String(rev.t).padStart(6)} т, ${rev.c} выз, ${(rev.t/(rev.c||1)).toFixed(0)} т/выз`);
  console.log(`    └ vec_nsx overhead (адрес/half): ${String(drawOnly).padStart(6)} т`);
  const acc=clr.t+drw.t;
  console.log(`  clear+draw = ${acc} т (${(100*acc/(s.RENDER.t||1)).toFixed(0)}% RENDER); остальное RENDER (диспетч vec_nat_sprites): ${s.RENDER.t-acc} т`);
  // доли
  console.log(`  ДОЛИ RENDER: clear ${(100*clr.t/(s.RENDER.t||1)).toFixed(1)}% | draw-overhead ${(100*drawOnly/(s.RENDER.t||1)).toFixed(1)}% | shift-петли ${(100*col.t/(s.RENDER.t||1)).toFixed(1)}% | зеркало ${(100*rev.t/(s.RENDER.t||1)).toFixed(1)}%`);
}
show(peak, `ПИКОВЫЙ RENDER busy-кадр (мумий=${peak.mum})`);
// среднее по busy
const avg={s:{}};for(const n of NAMES)avg.s[n]={t:0,c:0};avg.s.RENDER={t:0,c:0};
for(const r of busy){for(const k of[...NAMES,"RENDER"]){avg.s[k].t+=r.s[k].t;avg.s[k].c+=r.s[k].c;}}
for(const k of[...NAMES,"RENDER"]){avg.s[k].t=Math.round(avg.s[k].t/busy.length);avg.s[k].c=(avg.s[k].c/busy.length).toFixed(1);}
avg.mum="avg";show(avg,`СРЕДНИЙ busy-кадр (n=${busy.length})`);
