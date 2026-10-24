// snd_tempo.js — ТЕМП МУЗЫКИ: сколько раз за кадр вызывается updateSound (норма 1.0).
//
// Зачем: тик музыки — это кадр плеера, и в штатном режиме его даёт кадровое прерывание.
// Но на долгих операциях (скролл комнаты, перерисовка окна) прерывания закрыты, и тик
// заменяют кооперативные вызовы updateSound из vec_scroll (на столбец) и vec_nr_row
// (на ряд). Их частота задаётся аккумулятором vsnd_acc + долями vsnd_k_col/vsnd_k_row
// (см. шапку vec_boot.asm). Если доли не совпали со стоимостью шага — музыка на скролле
// уезжает по темпу, и это СЛЫШНО: маска «каждый 4-й столбец», подобранная под медленный
// скролл, после ускорения 307 -> 98 кадров дала 1.15-1.22 тика/кадр (+18%).
//
// Печатает: темп по фазам игры (GameStatus) от холодного старта + темп на форсированном
// скролле (режим 9 взводится записью в память, как это делает chkScroll3).
// Норма: все фазы близко к 1.00; скролл 0.95-1.05.
//
// Использование: node tools/verify/snd_tempo.js <rom> <sym>
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const rom=process.argv[2],symPath=process.argv[3];
if(!rom||!symPath){console.log("usage: node snd_tempo.js <rom> <sym>");process.exit(2);}
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console={log(){},debug(){},warn(){},error(){},info(){}};
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]){
  vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
}
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;// soundStep НЕ глушим: он тактует ВИ53, на котором висят часы музыки (суррогат тактовал в сотни раз медленнее и врал)
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const L={};for(const l of fs.readFileSync(symPath,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
const { sndOvLoad } = require("./snd_ov_load");
const US=L["updateSound"], GS=L["GameStatus"];
const rd=a=>memory.read(a,false);
g.event=null;
const ev=c=>({which:c,keyCode:c,preventDefault(){},stopPropagation(){}});
const key=(c,d)=>d?keyboard.keyDown(ev(c)):keyboard.keyUp(ev(c));
const run=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
const press=(c,f=6)=>{key(c,1);run(f);key(c,0);run(2);};
// откуда пришёл вызов — чтобы видеть, какая точка гонит темп
let calls=0, byRet={};
v06c.check_breakpoint=function(){
  if(cpu.pc===US){ calls++;
    const r=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
    byRet[r]=(byRet[r]||0)+1; }
  return false;
};
function nameOf(addr){ let best=null;
  for(const [n,a] of Object.entries(L)) if(a<=addr && (!best||a>best[1])) best=[n,a];
  return best?`${best[0]}+${addr-best[1]}`:`0x${addr.toString(16)}`; }

const names={0:"титул/лого",1:"меню",2:"демо-старт",3:"старт партии",4:"вход/карта",5:"игра",6:"смерть",7:"game over",8:"stage clear",9:"скролл",10:"финал"};
const acc={};
for(let i=0;i<12000;i++){ const gs=rd(GS); calls=0; run(1);
  const a=acc[gs]||(acc[gs]={f:0,t:0,max:0}); a.f++; a.t+=calls; if(calls>a.max)a.max=calls; }
// Сборка только 3 МГц: vsnd_cdiv фиксирован (джингл ВИ53 без часов).
const freqBad = rd(L["vsnd_cdiv"])!==3;
console.log(`3 МГц: vsnd_cdiv=${rd(L["vsnd_cdiv"])} (ждём 3)${freqBad?"  <-- НЕ СОВПАЛО":""}\n`);
console.log("ТЕМП ПО ФАЗАМ (холодный старт, дальше играет демо):");
console.log("фаза                тиков/кадр   макс за кадр   кадров");
for(const gs of Object.keys(acc).sort((a,b)=>a-b)){ const a=acc[gs];
  console.log(`${(names[gs]||("GS="+gs)).padEnd(20)} ${(a.t/a.f).toFixed(3).padStart(6)}         ${String(a.max).padStart(3)}       ${a.f}`); }

// Демо ходит внутри одной комнаты и скролл не запускает -> взводим режим 9 сами.
console.log("\nФОРСИРОВАННЫЙ СКРОЛЛ (режим 9 взведён записью в память):");
//  СТАРТ КОМБИНАЦИЕЙ F1+F5 (замок читов, 2026-08-11): нагруженную сцену ниже собирает
//  чит N, а с обычного старта пробелом он мёртв по замыслу — замер уходил в пустую
//  выборку («0.000 тика/кадр», сцена не собралась). Пробел не нажимается ни разу.
const holdF15=d=>{ key(112,d); key(116,d); };
run(400); holdF15(1); run(200); run(200);
for(let i=0;i<12 && rd(GS)!==5;i++){ run(150); }
holdF15(0); run(8);
let worst=0;
for(let pass=0;pass<4;pass++){
  run(60);
  memory.write(L["waitCounter"],0x20); memory.write(L["flagScrolling"],1);
  memory.write(L["sentidoProta"],2); memory.write(GS,9);
  let f=0,t=0; byRet={};
  while(rd(GS)===9 && f<400){ calls=0; run(1); f++; t+=calls; }
  const r=t/Math.max(f,1); worst=Math.max(worst,Math.abs(r-1));
  console.log(`  скролл #${pass+1}: ${f} кадров, ${t} тиков = ${r.toFixed(3)} тика/кадр -> темп x${r.toFixed(2)}`);
  if(pass===0) for(const [a,n] of Object.entries(byRet).sort((x,y)=>y[1]-x[1]))
    console.log(`      из ${nameOf(+a)}: ${n}`);
  run(120);
}
// ------------------------------------------------------------------------------------------
// НАГРУЖЕННЫЙ КАДР: бросок ножа при мумиях на экране (2026-08-03).
// Зачем отдельная фаза: средний темп по фазе и темп на скролле — ИНТЕГРАЛЬНЫЕ меры, и обе
// молчали, когда владелец с железа услышал «в некоторых нагруженных кадрах полёта ножа звук
// подтормаживает». Слышно не средний темп, а ПОКАДРОВЫЙ: плеер то стоит кадр, то прыгает через
// два. Замер на сборке до правки: 21.4% кадров БЕЗ тика, 14.4% с двумя, 0.930 тика на кадр
// (мелодия ещё и отставала на 7%); после правки — 11.9% / 11.1% / 0.992.
// Сцена берётся форсом, как и скролл выше: чит N уводит на пирамиду с мумиями, в руки герою
// кладётся нож (objetoCogido = #10, ровно то, что проверяет protaAnda), и дальше он бежит и
// жмёт FIRE. Ждать, пока герой сам подберёт нож с пола, бессмысленно: демо этого не делает.
console.log("\nНАГРУЖЕННЫЙ КАДР (бросок ножа при мумиях):");
holdF15(1); for(let i=0;i<40 && rd(GS)!==5;i++){ run(60); } holdF15(0); run(8);
for(let p=0;p<5;p++){ press(78,4); run(40);            // N = следующая пирамида
  for(let j=0;j<300 && rd(GS)!==5;j++) run(1); run(20); }
const visSpr=i=>rd(L["sprAttrib"]+i*4)<0xD0;
let lf=0, lt=0, lz=0, l2=0, flying=0;
const dirs=[37,39,38,40]; let dcur=0;
for(let s=0;s<2200;s++){
  memory.write(L["objetoCogido"],0x10);                // в руках у героя нож
  if(s%20===0){ key(dirs[dcur],0); dcur=(dcur+1)%4; key(dirs[dcur],1); }
  if(s%5===0) key(32,1); else if(s%5===2) key(32,0);
  calls=0; run(1);
  if(rd(GS)!==5) continue;
  let fly=0; for(let i=0;i<4;i++){ const st=rd(L["knifesData"]+i*8); if(st>=4&&st<=7) fly++; }
  let mum=0; for(let i=6;i<14;i++) if(visSpr(i)) mum++;
  if(!(fly>0 && mum>0)) continue;                      // считаем ТОЛЬКО нагруженные кадры
  flying++; lf++; lt+=calls; if(!calls) lz++; if(calls>=2) l2++;
}
for(const c of dirs) key(c,0); key(32,0);
const lr = lt/Math.max(lf,1), lzp = 100*lz/Math.max(lf,1);
console.log(`  кадров «нож в полёте + мумии»: ${lf}`);
console.log(`  ${lr.toFixed(3)} тика/кадр; БЕЗ тика ${lz} (${lzp.toFixed(1)}%), с двумя и более ${l2} (${(100*l2/Math.max(lf,1)).toFixed(1)}%)`);
const loadBad = lf<300 || lr<0.97 || lzp>15;
if(lf<300) console.log("  <-- СЦЕНА НЕ СОБРАЛАСЬ (мало кадров с летящим ножом), замер недействителен");
else if(loadBad) console.log(`  <-- ПОКАДРОВЫЙ ТЕМП ПЛЫВЁТ${lr<0.97?`: ${lr.toFixed(3)} тика/кадр (норма >= 0.97)`:""}${lzp>15?`; кадров без тика ${lzp.toFixed(1)}% (норма <= 15%)`:""}`);

// РЕЖИМ ВИ53: канал 2 занят нотами, часов нет -> темп держится долями по работе.
// Проверяем отдельно: именно здесь слышно подтормаживание в скролле.
console.log("\nТО ЖЕ НА ЧИПЕ ВИ53 (часы делят канал C с нотами, счёт по работе):");
//  [snd-vi53] В сборке без AY чип один (ВИ53) и уже выбран: подмена чипа и оверлей — только для основы e2b8f32.
if(L["vec_snd_chip"]!==undefined){ memory.write(L["vec_snd_chip"], 1); sndOvLoad(memory, L, img, true); }
memory.write(L["vec_snd_mode"], 0);
console.log(`  чип=${L["vec_snd_chip"]!==undefined?rd(L["vec_snd_chip"]):"ВИ53 (единственный)"}, слушание=${rd(L["vec_snd_mode"])}, часы: ${rd(L["vtm_have"])?"есть":"нет"}`);
let worstVi=0;
for(let pass=0;pass<3;pass++){
  run(60);
  memory.write(L["waitCounter"],0x20); memory.write(L["flagScrolling"],1);
  memory.write(L["sentidoProta"],2); memory.write(GS,9);
  let f=0,t=0;
  while(rd(GS)===9 && f<400){ calls=0; run(1); f++; t+=calls; }
  const r=t/Math.max(f,1); worstVi=Math.max(worstVi,Math.abs(r-1));
  console.log(`  скролл #${pass+1}: ${f} кадров, ${t} тиков = ${r.toFixed(3)} тика/кадр -> темп x${r.toFixed(2)}`);
  run(120);
}
console.log(`  отклонение в режиме ВИ53: ${(worstVi*100).toFixed(0)}%`);
const ok = worst<=0.05 && !freqBad && !loadBad;
const why=[];
if(freqBad) why.push("ДЕТЕКТ ЧАСТОТЫ НЕ СОВПАЛ");
if(worst>0.05) why.push(`ТЕМП НА СКРОЛЛЕ УЕХАЛ на ${(worst*100).toFixed(0)}%`);
if(loadBad) why.push(`ПОКАДРОВЫЙ ТЕМП В НАГРУЖЕННЫХ КАДРАХ: ${lr.toFixed(3)} тика/кадр, без тика ${lzp.toFixed(1)}%`);
console.log(ok ? "\nРЕЗУЛЬТАТ: ОК (скролл <= 5%, нагруженный кадр >= 0.97 тика/кадр и <= 15% пустых)"
  : `\nРЕЗУЛЬТАТ: ${why.join(" + ")}`);
process.exit(ok?0:1);
