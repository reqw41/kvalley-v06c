// stageclear_recolor.js — ЗАМЕР ПЕРЕКРАСКИ ЛАБИРИНТА ПРИ ОКОНЧАНИИ УРОВНЯ (задача #31).
//
// ЧТО МЕРЯЕТ. Проходит титул -> геймплей, жмёт чит N (GameStatus=8 = stageClear) и
// покадрово снимает:
//   * содержимое ВИДИМЫХ плоскостей p0/p1/p2 (0x8000-0xDFFF) -> индекс палитры каждого
//     пикселя idx=(p0<<3)|(p1<<2)|(p2<<1) (p3 в 8C-раскладке невидима);
//   * реальный цвет каждого пикселя = io.Palette[idx] -> гистограмму цветов кадра;
//   * сами регистры палитры.
// Ключевая метрика — ПРИРОСТ НЕФОНОВЫХ ЦВЕТОВ между соседними кадрами:
//     gain(t) = sum по цветам c != фон  max(0, hist[t][c] - hist[t-1][c])
// Честное стирание умеет только УБАВЛЯТЬ нефоновые цвета (пиксели уходят в фон), поэтому
// gain ~ 0. Перекраска = пиксели МАССОВО переезжают из одного нефонового цвета в другой,
// и gain взлетает до десятков тысяч. То же самое считаем по индексам (recolor-cells):
// сколько пикселей сменили нефоновый индекс на ДРУГОЙ НЕФОНОВЫЙ (а не на фон).
//
// Запуск: node tools/verify/stageclear_recolor.js [rom] [каталог для PNG]
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
// ВНИМАНИЕ: soundnik.soundStep НЕ глушим — он тактует ВИ53, на нём часы музыки.
const img=new Uint8Array(fs.readFileSync(rom));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();

const symfile = rom.replace(/\.rom$/, ".sym");
const L={};
if (fs.existsSync(symfile))
  for(const l of fs.readFileSync(symfile,"latin1").split("\n")){
    const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16); }
const rd=a=>memory.read(a&0xffff);
const run=n=>{for(let i=0;i<n;i++) v06c.oneInterrupt(true);};
const key=(code,down)=>{const e={keyCode:code,which:code,preventDefault(){},stopPropagation(){}};
  if(down) keyboard.keyDown(e); else keyboard.keyUp(e);};
const press=(c,f=6)=>{key(c,1);run(f);key(c,0);run(4);};

const GameStatus = L.GameStatus, subStatus = L.subStatus;

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

// ---- снимок кадра ------------------------------------------------------------------
// Индекс палитры каждого пикселя фреймбуфера: p0=0x8000, p1=0xA000, p2=0xC000.
// p3 (0xE000) в 8C невидима (color[2k]==color[2k+1]) -> в индексе не участвует.
const NPX = 8192*8;
function idxMap(){
  const m = new Uint8Array(NPX);
  for(let i=0;i<8192;i++){
    const b0=rd(0x8000+i), b1=rd(0xA000+i), b2=rd(0xC000+i);
    for(let b=7;b>=0;b--){
      const v = (((b0>>b)&1)<<3) | (((b1>>b)&1)<<2) | (((b2>>b)&1)<<1);
      m[i*8+(7-b)] = v;
    }
  }
  return m;
}
function palSnap(){ const p=new Uint32Array(16); for(let i=0;i<16;i++) p[i]=io.Palette[i]>>>0; return p; }
function colorHist(m,pal){ const h=new Map(); for(let i=0;i<NPX;i++){ const c=pal[m[i]]>>>0; h.set(c,(h.get(c)||0)+1); } return h; }
const hex=c=>"#"+((c>>>0)&0xFFFFFF).toString(16).padStart(6,"0");

// ---- до геймплея -------------------------------------------------------------------
run(400);
let ok=false;
for(let blk=0; blk<60 && !ok; blk++){
  for(let f=0; f<25; f++){ key(32,true); run(1);
    if(rd(GameStatus)===5 && (rd(L.flagPiramideMap)&1)){ok=true;break;} }
  key(32,false); run(5);
}
run(60);
if (!ok){ console.log("НЕ ДОШЛИ ДО ГЕЙМПЛЕЯ, GS="+rd(GameStatus)); process.exit(1); }
console.log("геймплей достигнут: GS=%d пирамида=%d", rd(GameStatus), rd(L.piramideActual));

// ---- чит N: конец уровня -----------------------------------------------------------
const NF   = parseInt(process.env.KV_FRAMES||"170",10);  // кадров на один переход
const PRE  = 6;                                          // кадров ДО нажатия чита
const NCLR = parseInt(process.env.KV_CLEARS||"2",10);    // сколько окончаний уровня меряем
const VERB = process.env.KV_VERBOSE==="1";
const bgOf = F => F.pal[0]>>>0;                          // фон = слот 0 (void/бордюр)
if(outdir) fs.mkdirSync(outdir,{recursive:true});

let grandGain=0, grandRe=0, verdict=true;
for(let clear=0; clear<NCLR; clear++){
  const pyr = rd(L.piramideActual);
  const frames = [];
  for(let f=0; f<NF; f++){
    if(f===PRE) key(78,true);
    if(f===PRE+3) key(78,false);
    run(1);
    if(outdir) png(`${outdir}/c${clear}_f${String(f-PRE).padStart(3,"0")}.png`);
    const m = idxMap(), pal = palSnap();
    frames.push({f:f-PRE, gs:rd(GameStatus), sub:rd(subStatus), fpm:rd(L.flagPiramideMap),
                 m, pal, hist: colorHist(m,pal)});
  }
  console.log(`\n=== ОКОНЧАНИЕ УРОВНЯ ${clear+1}: пирамида ${pyr}, фон=${hex(bgOf(frames[0]))} ===`);
  console.log("кадр GS/sub fpm |нефон.пикс| ПРИРОСТ нефон | ПЕРЕКРАШЕНО пикс (idx:было->стало) | палитра idx 0,2,4,6,8,10,12,14");
  console.log("       (ПРИРОСТ учитывается в вердикте только при sub=0 — фаза стирания; при sub=1 рисуется карта)");
  let worstGain=0, worstRe=0, sumGain=0, sumRe=0;
  for(let i=0;i<frames.length;i++){
    const F=frames[i], bg=bgOf(F);
    let nonbg=0; for(const [c,n] of F.hist) if(c!==bg) nonbg+=n;
    let gain=0, re=0; const by=new Map();
    if(i>0){
      const P=frames[i-1], pbg=bgOf(P);
      for(const [c,n] of F.hist){ if(c===bg) continue; const p=P.hist.get(c)||0; if(n>p) gain+=n-p; }
      for(let k=0;k<NPX;k++){
        const ia=P.m[k], ib=F.m[k];
        const ca=P.pal[ia]>>>0, cb=F.pal[ib]>>>0;
        if(ca!==pbg && cb!==bg && ca!==cb){ re++;
          const key=`${ia}:${hex(ca).slice(1)}->${hex(cb).slice(1)}`;
          by.set(key,(by.get(key)||0)+1); }
      }
      // прирост нефоновых цветов считаем ТОЛЬКО в фазе стирания (subStatus=0):
      // при subStatus=1 рисуется карта долины, там рост нефоновых пикселей законен.
      if(F.sub===0 && gain>worstGain) worstGain=gain;
      if(re>worstRe) worstRe=re;
      if(F.sub===0) sumGain+=gain;
      sumRe+=re;
    }
    if(!VERB && i>0 && gain===0 && re===0 && i%20!==0 && i!==frames.length-1) continue;
    const p8=[0,2,4,6,8,10,12,14].map(k=>hex(F.pal[k]).slice(1,7)).join(" ");
    const top=[...by.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k,n])=>`${k} x${n}`).join("  ");
    console.log(`${String(F.f).padStart(4)} ${F.gs}/${String(F.sub).padEnd(2)} ${String(F.fpm).padStart(3)} |`+
      `${String(nonbg).padStart(9)} |${String(i?gain:"-").padStart(14)} |`+
      ` ${String(i?re:"-").padStart(7)} ${top.padEnd(28)} | ${p8}`);
  }
  console.log(`ИТОГ уровня ${clear+1}: макс.прирост нефоновых цветов/кадр = ${worstGain}, макс.перекрашено пикс/кадр = ${worstRe}` +
              ` (суммы: ${sumGain} / ${sumRe})`);
  grandGain=Math.max(grandGain,worstGain); grandRe=Math.max(grandRe,worstRe);
  // доводим переход до конца, чтобы следующий чит сработал
  for(let f=0; f<900 && !(rd(GameStatus)===5 && (rd(L.flagPiramideMap)&1)); f++) run(1);
  run(40);
  if(rd(GameStatus)!==5){ console.log("переход не завершился, GS="+rd(GameStatus)); verdict=false; break; }
}
const LIM = parseInt(process.env.KV_LIMIT||"200",10);
console.log(`\nВЕРДИКТ: максимум за кадр — перекрашенных пикселей ${grandRe}, прирост нефоновых цветов в фазе стирания ${grandGain}` +
            ` (порог ${LIM}) -> ${(verdict && grandGain<=LIM && grandRe<=LIM)?"ПЕРЕКРАСКИ НЕТ":"ЕСТЬ ПЕРЕКРАСКА"}`);
if(outdir) console.log(`PNG: ${outdir}/c<номер>_f<кадр>.png`);
process.exit((verdict && grandGain<=LIM && grandRe<=LIM)?0:1);
