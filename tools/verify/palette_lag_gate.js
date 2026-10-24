// palette_lag_gate.js — ПОКАДРОВЫЙ ЗАМЕР РАССОГЛАСОВАНИЯ «КАРТИНКА vs ПАЛИТРА» (задача #21).
//
// ЖАЛОБА ВЛАДЕЛЬЦА: «практически на КАЖДОМ экране видно дёргание палитры ПОСЛЕ отрисовки
// графики» — картинка появляется в одной палитре, через несколько кадров цвета прыгают.
//
// ЧТО МЕРЯЕТ. Гоняет партию по сценарию и на КАЖДОМ кадре снимает:
//   * индекс палитры каждого пикселя видимых плоскостей p0/p1/p2 (idx=(p0<<3)|(p1<<2)|(p2<<1));
//   * 16 регистров палитры (io.Palette).
// Из пары соседних кадров считает ДВА независимых числа:
//   moved(t)   = пикселей, у которых СМЕНИЛСЯ ИНДЕКС  -> «картинка рисуется/стирается»;
//   recolor(t) = пикселей, у которых индекс ТОТ ЖЕ, а ЦВЕТ другой -> «дёрнулась палитра
//                под неизменной картинкой». Это ровно то, что видит глаз как рывок цвета.
// Плюс список слотов палитры, изменившихся в этом кадре (idx: старый->новый).
//
// Отсюда для каждого экрана: кадр появления картинки (первый крупный moved после пустого
// экрана), кадр(ы) смены палитры и ЛАГ = кадр_палитры - кадр_картинки. Лаг > 0 = дефект.
//
// Запуск: node tools/verify/palette_lag_gate.js [rom] [каталог PNG]
// KV_PNG_AROUND=имя_экрана — сохранить PNG вокруг перехода этого экрана.
"use strict";
const fs = require("fs"), vm = require("vm"), zlib = require("zlib");
const base = "/Users/boris/Projects/vector06js";
const rom = process.argv[2] || "build/kvalley_8c.rom";
const outdir = process.argv[3] || null;

const g = {}; g.window = g;
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.document={createElement:()=>fc(),getElementById:()=>fc(),all:undefined};
g.requestAnimationFrame=()=>0; g.setTimeout=()=>0; g.print=()=>0; g.console=console;
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
  vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"), ctx, {filename:f});
const memory=new ctx.Memory(), keyboard=new ctx.Keyboard(), timer=new ctx.I8253(), ay=new ctx.AY();
const floppy=new(ctx.Floppy().FD1793)(), io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io), tape={advance:()=>{},sample:0,reset:()=>{}};
const v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;
v06c.bmp=new Uint32Array(W*H); v06c.displayFrame=()=>{}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
// soundnik.soundStep НЕ глушим — он тактует ВИ53 (часы музыки).
const img=new Uint8Array(fs.readFileSync(rom));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();

const symfile = rom.replace(/\.rom$/, ".sym");
const L={};
for(const l of fs.readFileSync(symfile,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16); }
const rd=a=>memory.read(a&0xffff);
const key=(code,down)=>{const e={keyCode:code,which:code,preventDefault(){},stopPropagation(){}};
  if(down) keyboard.keyDown(e); else keyboard.keyUp(e);};

// ---- трассировка ВЫЗОВОВ (KV_CALLS=1) ----------------------------------------------
// Кто именно трогает палитру и когда: ловим вход в помеченные процедуры по PC.
// check_breakpoint зовётся эмулятором перед КАЖДОЙ инструкцией — вешаемся туда.
const WATCH = ["vec_setpal_a","vec_setpal_menu","vsp_defer","vsp_load","vec_ct_load",
  "vec_ct_stage","vec_ct_ending","vec_brillo_pal","vbp_map","vbp_dopulse","setupStage",
  "setupPergamino","setupEnding","drawCortinilla","unpackStage","setupRoom","clearScreen",
  "setColor","loadKonamiLogo","InitStage","showMap","stageClear"];
const pcName = new Array(0x10000).fill(null);
let hits = null;   // Map имя -> счётчик в текущем кадре
if(process.env.KV_CALLS){
  for(const n of WATCH) if(L[n]!==undefined) pcName[L[n]] = n;
  hits = new Map();
  v06c.check_breakpoint = function(){ const n = pcName[cpu.pc]; if(n) hits.set(n,(hits.get(n)||0)+1); return false; };
}

// ---- PNG ---------------------------------------------------------------------------
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
function png(out){ const bmp=v06c.bmp, rgb=Buffer.alloc(W*H*3);
  for(let i=0;i<W*H;i++){const c=bmp[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
  const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
  fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
}
const hex=c=>((c>>>0)&0xFFFFFF).toString(16).padStart(6,"0");

// ---- снимок кадра ------------------------------------------------------------------
const NPX = 8192*8;
function idxMap(m){
  for(let i=0;i<8192;i++){
    const b0=rd(0x8000+i), b1=rd(0xA000+i), b2=rd(0xC000+i);
    for(let b=7;b>=0;b--) m[i*8+(7-b)] = (((b0>>b)&1)<<3)|(((b1>>b)&1)<<2)|(((b2>>b)&1)<<1);
  }
  return m;
}
let prevM = new Uint8Array(NPX), curM = new Uint8Array(NPX);
let prevP = new Uint32Array(16);
let haveP = false;

// Трасса кадров: собираем в массив записей и печатаем по секциям.
const trace = [];
let fno = 0;
let section = "boot";
const pngWant = process.env.KV_PNG_AROUND || null;
let pngTag = null;
const PNG_FROM = process.env.KV_PNG_FROM ? parseInt(process.env.KV_PNG_FROM,10) : null;
const PNG_TO   = process.env.KV_PNG_TO   ? parseInt(process.env.KV_PNG_TO,10)   : 0;

function step(){
  v06c.oneInterrupt(true);
  const t = curM; curM = prevM; prevM = t;      // prevM <- прошлый curM
  idxMap(curM);
  const pal = new Uint32Array(16);
  for(let i=0;i<16;i++) pal[i]=io.Palette[i]>>>0;
  let moved=0, recolor=0, crec=0, nonbg=0;
  const bg = pal[0]>>>0;
  if(haveP){
    for(let i=0;i<NPX;i++){
      const a=prevM[i], b=curM[i];
      if(a!==b) moved++;
      else if(prevP[a]!==pal[b]){ recolor++; if(a!==0) crec++; }
    }
  }
  for(let i=0;i<NPX;i++) if(pal[curM[i]]!==bg) nonbg++;
  const slots=[];
  if(haveP) for(let k=0;k<16;k+=2) if(prevP[k]!==pal[k]) slots.push(`${k}:${hex(prevP[k])}->${hex(pal[k])}`);
  let calls="";
  if(hits){ calls=[...hits.entries()].map(([k,v])=>v>1?`${k}x${v}`:k).join(","); hits.clear(); }
  const rec = {f:fno++, sec:section, gs:rd(L.GameStatus), sub:rd(L.subStatus),
               fpm:rd(L.flagPiramideMap), pyr:rd(L.piramideActual), tick:rd(L.timer),
               moved, recolor, crec, nonbg, slots, pal, calls};
  trace.push(rec);
  prevP = pal; haveP = true;
  if(pngTag && outdir) png(`${outdir}/${pngTag}_${String(fno).padStart(4,"0")}.png`);
  // окно PNG по АБСОЛЮТНЫМ номерам кадров (KV_PNG_FROM..KV_PNG_TO) — для сверки до/после
  if(outdir && PNG_FROM!==null && rec.f>=PNG_FROM && rec.f<=PNG_TO)
    png(`${outdir}/f${String(rec.f).padStart(4,"0")}.png`);
  return rec;
}
const run=n=>{for(let i=0;i<n;i++) step();};
function mark(name){ section=name; if(pngWant && pngWant===name){ pngTag=name; } else pngTag=null; }
if(outdir) fs.mkdirSync(outdir,{recursive:true});

// ================= СЦЕНАРИЙ =========================================================
mark("konami");   run(320);                    // логотип Konami
mark("title");    for(let i=0;i<420 && rd(L.GameStatus)!==1;i++) step(); run(60);
mark("menu");     run(60);
// вход в игру: пробел до карты долины, потом до геймплея
mark("map_start");
let seen=false, inGame=false;
for(let blk=0; blk<60 && !inGame; blk++){
  for(let f=0; f<25; f++){ key(32,true); step();
    if(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1)){inGame=true;break;} }
  key(32,false); run(4);
}
mark("game1");    run(90);
mark("clear1");   key(78,true); run(3); key(78,false);
for(let f=0; f<520 && !(rd(L.GameStatus)===5 && !(rd(L.flagPiramideMap)&1)); f++) step();
mark("map1");     run(150);
mark("game2");    for(let f=0; f<600 && !(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1)); f++) step();
run(90);
// ЧИТ H: прыжок на 5 пирамид — вход в пирамиду с ДРУГОЙ схемой цвета камней (самый
// заметный случай: цвет кирпичей на входе обязан отличаться от предыдущего уровня).
mark("hop5");     key(72,true); run(3); key(72,false);
for(let f=0; f<900 && !(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1) && rd(L.piramideActual)>=6); f++) step();
run(60);
// ЧИТ E: финальный экран.
mark("ending");   key(69,true); run(3); key(69,false); run(320);
// СМЕРТЬ И GAME OVER. Чита нет, поэтому герой «умирает» по-настоящему: обнуляем flagVivo
// (chkVivo -> следующий статус = потеря жизни), как это делает столкновение с мумией.
for(let f=0; f<1200 && !(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1)); f++) step();
run(40);
mark("death");    memory.write(L.flagVivo,0); run(300);
for(let f=0; f<600 && !(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1)); f++) step();
run(40);
// Game Over: жизней не осталось -> надпись GAME OVER поверх уровня, затем лого Konami.
mark("gameover"); memory.write(L.Vidas,0); memory.write(L.flagVivo,0); run(420);

// ================= ОТЧЁТ ============================================================
if(process.env.KV_TSV){
  const out=["f\tsec\tgs\tsub\tfpm\tpyr\ttick\tmoved\trecolor\tcrec\tnonbg\tslots\tcalls"];
  for(const r of trace) out.push([r.f,r.sec,r.gs,r.sub,r.fpm,r.pyr,r.tick,r.moved,r.recolor,r.crec,r.nonbg,r.slots.join(" "),r.calls].join("\t"));
  fs.writeFileSync(process.env.KV_TSV,out.join("\n"));
}
console.log("ROM: "+rom+"   кадров: "+trace.length);
console.log("f    секция     GS/s fpm pyr |  moved | ПЕРЕКРАС |   nonbg | слоты палитры");
let curSec=null;
for(const r of trace){
  const interesting = r.slots.length || r.crec>200 || r.moved>2000 || r.sec!==curSec;
  if(r.sec!==curSec){ curSec=r.sec; console.log("--- "+curSec+" ---"); }
  if(!interesting) continue;
  console.log(`${String(r.f).padStart(5)} ${r.sec.padEnd(10)} ${r.gs}/${String(r.sub).padEnd(2)} `+
    `${String(r.fpm).padStart(3)} ${String(r.pyr).padStart(3)} |${String(r.moved).padStart(7)} |`+
    `${String(r.crec).padStart(9)} |${String(r.nonbg).padStart(8)} | ${r.slots.join(" ")}`);
}

// ===== МЕТРИКА ЗАДАЧИ #21 ============================================================
//  ПЕРЕКРАС (crec) = пикселей, у которых индекс палитры ТОТ ЖЕ, что в прошлом кадре, индекс
//  НЕ ФОНОВЫЙ (idx!=0), а цвет другой. То есть картинка стоит, а цвет под ней прыгнул — ровно
//  то, что глаз читает как «дёргание палитры». Пиксели фона (idx0) исключены сознательно:
//  на пустом экране (лого Konami, титул) смена фонового цвета — это и есть появление экрана.
//  ЛАГ = сколько кадров подряд картинка уже была на экране к моменту прыжка (считаем с
//  последнего пустого кадра). Лаг>0 при большом ПЕРЕКРАСЕ = «палитра после отрисовки».
const LIM  = parseInt(process.env.KV_LIMIT||"200",10);
const EMPTY= 200;   // порог «экран пуст» по нефоновым пикселям
const SEEN = 500;   // порог «картинка на экране»
console.log("\n=== ЭКРАН -> ЗАДЕРЖКА ПАЛИТРЫ (кадров картинки до прыжка цвета) ===");
console.log("секция       худший ПЕРЕКРАС  кадр  ЛАГ(кадров)  слотов  слоты");
const bySec=new Map();
let shown=0, worst=0, worstSec="";
for(const r of trace){
  if(r.nonbg<EMPTY) shown=0; else if(r.nonbg>=SEEN) shown++;
  const s=bySec.get(r.sec)||{max:0,at:null,lag:0,sum:0,slots:"",n:0};
  s.sum+=r.crec;
  if(r.crec>s.max){ s.max=r.crec; s.at=r.f; s.lag=shown; s.slots=r.slots.join(" "); s.n=r.slots.length; }
  bySec.set(r.sec,s);
  if(r.crec>worst){ worst=r.crec; worstSec=r.sec; }
}
for(const [k,s] of bySec)
  console.log(`${k.padEnd(12)} ${String(s.max).padStart(14)} ${String(s.at).padStart(5)} ${String(s.lag).padStart(12)} ${String(s.n).padStart(7)}  ${s.slots}`);
if(outdir && pngWant) console.log(`PNG: ${outdir}/${pngWant}_*.png`);
const ok = worst<=LIM;
console.log(`\nВЕРДИКТ: худший ПЕРЕКРАС за кадр = ${worst} (секция ${worstSec}), порог ${LIM} -> `+
            (ok?"ПАЛИТРА НЕ ДЁРГАЕТСЯ":"ЕСТЬ ДЁРГАНИЕ ПАЛИТРЫ"));
process.exit(ok?0:1);
