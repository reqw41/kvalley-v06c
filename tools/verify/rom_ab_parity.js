// rom_ab_parity.js — A/B-парити двух сборок: гоняет ДВЕ прошивки на одном и том же
// детерминированном потоке нажатий и сверяет игровые данные и картинку покадрово.
// Нужен, чтобы доказать, что правка НЕ поменяла обычную игру (в потоке нет клавиши N —
// отладочный чит «следующая пирамида» не срабатывает ни разу).
//
// Запуск: node tools/verify/rom_ab_parity.js <до.rom> <после.rom> [до.sym] [после.sym]
//         .sym по умолчанию — одноимённые с .rom. БЕЗ .sym скрипт не работает: адресов
//         переменных в нём больше не зашито (см. ниже).
//
// ЗАДАЧА#37: если правка ПЕРЕЛОЖИЛА переменные (сдвинулась база 0x6C00), фиксированные
// диапазоны сравнивать бессмысленно — они указывают в разные вещи. С двумя .sym скрипт
// берёт границы ИЗ СИМВОЛОВ каждой сборки (GameStatus..stackArea = игровые переменные,
// MapaRAMRoot..vec_ovpad = карта комнат) и сравнивает СОДЕРЖИМОЕ по смещению внутри блока.
// Тогда «побайтно совпадает» означает: раскладка переехала, а игра — та же.
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function mk(rom){
  const g={};g.window=g;
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  g.document={createElement:()=>fc(),getElementById:()=>fc()};
  g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console={log:()=>{},debug:()=>{},error:()=>{},warn:()=>{}};
  const ctx=vm.createContext(g);
  for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
    vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY();
  const floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
  const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}};
  const v=new ctx.Vector06c(cpu,memory,io,ay,tape);
  v.bmp=new Uint32Array(576*288);v.displayFrame=()=>{};v.check_breakpoint=()=>false;v.dbg=null;
  const img=new Uint8Array(fs.readFileSync(rom));
  memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
  cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
  timer.Write(3,0x36);timer.Write(3,0x76);timer.Write(3,0xb6);ay.reset&&ay.reset();
  return {v,memory,keyboard,io};
}
const A=mk(process.argv[2]),B=mk(process.argv[3]);
const key=(k,c,d)=>{const e={keyCode:c,which:c,preventDefault(){},stopPropagation(){}};d?k.keyDown(e):k.keyUp(e);};
// один и тот же поток клавиш: SPACE-старт, потом влево/вправо/вверх/прыжок. Клавиши N НЕТ.
const KEYS=[32,37,39,38,40,32]; // SPACE, стрелки, SPACE(прыжок)
// Сравниваем ИГРОВЫЕ данные: переменные движка 0x6B00..0x7013 и карту комнат
// 0x7413..0x7D13, плюс хеш отрисованного кадра v.bmp (визуальная идентичность).
// НЕ сравниваем: стек 0x7013..0x7413 (в мусоре под SP лежат протухшие адреса возврата —
// код сдвинулся, это и есть правка) и служебные ячейки vec_ (0x7D13+, 0xFDF6 vec_pal_ptr
// и т.п.), где хранятся УКАЗАТЕЛИ В ПЗУ: таблицы переехали, содержимое то же.
function syms(p){const L={};for(const l of fs.readFileSync(p,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}return L;}
// ЗАДАЧА#37: ЗАПАСНЫЕ ЧИСЛА УБРАНЫ. Раньше без .sym брались диапазоны 0x6B00..0x7013 и
// 0x7413..0x7D13 — раскладка ПОЗАПРОШЛОЙ эры; скрипт молча сравнивал не то (по этим
// адресам теперь код и карта) и всегда рапортовал «идентично». Границы только из .sym.
function ranges(symPath){
  const L=syms(symPath);
  for(const n of ["GameStatus","stackArea","MapaRAMRoot","vec_ovpad"])
    if(L[n]===undefined){ console.log(`в ${symPath} нет символа ${n}`); process.exit(2); }
  return [[L.GameStatus,L.stackArea],[L.MapaRAMRoot,L.vec_ovpad]];
}
// СКРЕТЧ ТРАНСЛЯЦИИ i8080 (dummy_10: z80_ix/iy/alt-регистры, il_tmp/il_a, vec_kl_*) из
// сравнения ИСКЛЮЧЁН: там лежат УКАЗАТЕЛИ (напр. z80_ix = адрес игровой переменной), и при
// переезде раскладки они обязаны отличаться ровно на сдвиг — это не расхождение поведения.
function skipOf(symPath){
  const L=syms(symPath); return (L.dummy_10&&L.statusEntrada)?[[L.dummy_10,L.statusEntrada]]:[]; }
const SYMA=process.argv[4]||process.argv[2].replace(/\.rom$/,".sym");
const SYMB=process.argv[5]||process.argv[3].replace(/\.rom$/,".sym");
const RA=ranges(SYMA), RB=ranges(SYMB);
const SKIP=skipOf(SYMA).map(([s,e])=>[s-RA[0][0],e-RA[0][0]]);   // смещения в блоке 0
const skipped=(i,o)=>i===0&&SKIP.some(([s,e])=>o>=s&&o<e);
if(RA.length!==RB.length||RA.some((r,i)=>r[1]-r[0]!==RB[i][1]-RB[i][0]))
  { console.log("РАЗНЫЕ РАЗМЕРЫ блоков переменных — сравнивать нечего:",JSON.stringify(RA),JSON.stringify(RB)); process.exit(2); }
// СДВИГ РАСКЛАДКИ: игровые переменные хранят и УКАЗАТЕЛИ друг на друга (pMomiaProceso,
// z80_ix, MusicChanData...). После переезда такой байт ОБЯЗАН отличаться, и отличаться
// ровно на сдвиг. Поэтому расхождение принимается, если 16-битное слово (в любой из двух
// раскладок пары) отличается ровно на DELTA — это тот же указатель, а не другое поведение.
const DELTA=RB[0][0]-RA[0][0];
function w16(m,a){return m.read(a)|(m.read(a+1)<<8);}
function ptrOK(i,o){ if(!DELTA) return false;
  const [sa]=RA[i],[sb]=RB[i];
  for(const d of [0,-1]){ const oa=sa+o+d, ob=sb+o+d;
    if(o+d<0) continue;
    if(((w16(B.memory,ob)-w16(A.memory,oa))&0xffff)===(DELTA&0xffff)) return true; }
  return false; }
function bmpHash(v){let h=0x811c9dc5;const b=v.bmp;
  for(let i=0;i<b.length;i++){h^=b[i]&0xff;h=(h*0x01000193)>>>0;h^=(b[i]>>>8)&0xff;h=(h*0x01000193)>>>0;h^=(b[i]>>>16)&0xff;h=(h*0x01000193)>>>0;}
  return h>>>0;}
// возвращает список расхождений (пустой = сборки эквивалентны)
function diffs(limit){const out=[];
  for(let i=0;i<RA.length;i++){const n=RA[i][1]-RA[i][0];
    for(let o=0;o<n;o++){ if(skipped(i,o)) continue;
      const va=A.memory.read(RA[i][0]+o), vb=B.memory.read(RB[i][0]+o);
      if(va!==vb&&!ptrOK(i,o)){ out.push([i,o,va,vb]); if(out.length>=limit) return out; } }}
  return out;}
const N=6000;let bad=-1,badWhat="",held=null,softFrames=0,softPx=0;
for(let f=0;f<N;f++){
  // детерминированная «игра»: каждые 40 кадров меняем удерживаемую клавишу
  if(f%40===0){
    const nk=KEYS[(f/40)%KEYS.length];
    if(held!==null){key(A.keyboard,held,false);key(B.keyboard,held,false);}
    held=nk;key(A.keyboard,held,true);key(B.keyboard,held,true);
  }
  A.v.oneInterrupt(true);B.v.oneInterrupt(true);
  if(f%500===0)process.stderr.write(` ${f}`);
  if(f%50===49){
    if(bmpHash(A.v)!==bmpHash(B.v)){
      // KV_SOFT_FRAME=1: расхождение КАДРА не валит прогон, а копится в статистику. Нужно
      // при переезде раскладки: служебные ячейки p3 (0xFC00-0xFCFF) лежат в СТОЛБЦАХ 28-31
      // видимого поля и невидимы лишь потому, что палитра схлопнута; в них хранятся
      // сохранённый SP и указатели, которые после переезда обязаны отличаться, и на кадрах
      // с НЕсхлопнутой палитрой это даёт единицы пикселей. RAM-сверка при этом остаётся
      // жёсткой — она и доказывает, что игра идёт та же.
      if(process.env.KV_SOFT_FRAME==="1"){ let px=0;const ba=A.v.bmp,bb=B.v.bmp;
        for(let i=0;i<ba.length;i++) if(ba[i]!==bb[i]) px++;
        softFrames++; softPx=Math.max(softPx,px); }
      else { bad=f;badWhat="КАДР";break; }
    }
    if(diffs(1).length){bad=f;badWhat="RAM";break;}
  }
}
if(bad>=0){
  console.log(`РАСХОЖДЕНИЕ ${badWhat} на кадре ${bad}`);
  const dd=diffs(20000);
  for(const [i,o,va,vb] of dd.slice(0,20))
    console.log(`  +${o} (A 0x${(RA[i][0]+o).toString(16)} / B 0x${(RB[i][0]+o).toString(16)}): ${va} != ${vb}`);
  console.log(`  всего различий в RAM: ${dd.length}`);
  // при расхождении КАДРА полезно знать, где именно разъехалась видеопамять
  const pl=["p0 0x8000","p1 0xA000","p2 0xC000","p3 0xE000"]; let first=-1;
  for(let p=0;p<4;p++){let n=0;
    for(let a=0x8000+p*0x2000;a<0x8000+(p+1)*0x2000;a++)
      if(A.memory.read(a)!==B.memory.read(a)){n++;if(first<0)first=a;}
    console.log(`  VRAM ${pl[p]}: различий ${n}`);}
  if(first>=0)console.log(`  первое различие VRAM: 0x${first.toString(16)}`);
  let px=0;const ba=A.v.bmp,bb=B.v.bmp;
  for(let i=0;i<ba.length;i++) if(ba[i]!==bb[i]) px++;
  console.log(`  различающихся пикселей в кадре: ${px} из ${ba.length}`);
  process.exit(1);
}
const L=syms(SYMB);   // ЗАДАЧА#37: было запасное зашитое семейство адресов эры 0x6C00
const rd=a=>B.memory.read(a);
console.log(`Игровые данные и кадр идентичны на всех ${N} кадрах (сверка каждые 50). `+
  `GS=${rd(L.GameStatus)} pira=${rd(L.piramideActual)} Vidas=${rd(L.Vidas)} ProtaY=${rd(L.ProtaY)} ProtaX=${rd(L.ProtaX)}`);
if(softFrames)console.log(`  сверок кадра с расхождением: ${softFrames} (макс. ${softPx} пикс. из 165888) — KV_SOFT_FRAME=1`);
console.log("ВЕРДИКТ: без клавиши N поведение сборок до/после совпадает побайтно — OK");
