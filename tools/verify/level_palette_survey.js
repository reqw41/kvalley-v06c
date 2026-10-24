// level_palette_survey.js — РАЗВЕДКА «ПАЛИТРА НА УРОВЕНЬ».
//
// Для каждой из 15 пирамид собирает ФАКТИЧЕСКИЙ состав уровня и считает, сколько
// РАЗНЫХ MSX-перьев он требует. Если перьев <= 8, уровень можно было бы воспроизвести
// ТОЧНО своей палитрой; если больше — сведение неизбежно и на этом уровне.
//
// Источники:
//   * MapaRAM (22 ряда x 96 = 3 комнаты x 32) — map-коды -> тайлы через getTileFromID
//     (таблицы indexTiles/tiles* читаются из образа, логика повторена один в один);
//   * numMomias/momiasPiramid — типы мумий уровня -> tiposMomia -> цвет-ниббл;
//   * sprAttrib — цвет-нибблы героя (слоты 4,5) и створок ворот (слоты 0-3);
//   * MSX color table — build/colortables/gameplay_pyrNN.msxcolor.bin (дамп рантайма,
//     сверен с картриджем на тайлах предметов).
//
// Пирамиды проходятся ОДНОЙ машиной без drawRoom (рендер тут не нужен) — быстро.
//
// Запуск: node tools/verify/level_palette_survey.js [rom] [sym] [каталог colortables]
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path");
const base = "/Users/boris/Projects/vector06js";
const REPO = path.join(__dirname, "..", "..");
const ROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[3] || ROM.replace(/\.rom$/, ".sym");
const CT = process.argv[4] || "/Users/boris/projects/kvalley-v06c/build/colortables";

// Пишем СРАЗУ на диск: обход 15 пирамид идёт десятки минут, и буфер stdout при
// аварийной остановке теряется целиком (проверено — потеряли полный прогон).
const LOG = process.env.LPS_LOG || "/tmp/level_palette_survey.log";
try { fs.writeFileSync(LOG, ""); } catch(e) {}
const say = s => { try { fs.appendFileSync(LOG, s + "\n"); } catch(e) {} process.stdout.write(s + "\n"); };
const PEN = {0:"прозр",1:"чёрн",2:"ср.зелён",3:"св.зелён",4:"т.синий",5:"св.синий",6:"т.красн",
  7:"циан",8:"ср.красн",9:"св.красн",10:"Т.ЖЁЛТ",11:"св.жёлт",12:"т.зелён",13:"пурпур",
  14:"серый",15:"белый"};

const g = {}; g.window = g;
const stub = () => ({ width:0, height:0, style:{}, getContext: () => ({
  createImageData:()=>({data:new Uint8ClampedArray(4)}), putImageData:()=>{},
  getImageData:()=>({data:new Uint8ClampedArray(4)}), drawImage:()=>{}, fillRect:()=>{},
  save:()=>{}, restore:()=>{}, scale:()=>{}, setTransform:()=>{} }) });
g.document = { createElement: stub, getElementById: stub };
g.requestAnimationFrame=()=>0; g.setTimeout=()=>0; g.print=()=>0;
g.console = { log(){}, debug(){}, warn(){}, error(){}, info(){} };
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js",
  "src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js",
  "src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
  vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"), ctx, {filename:f});
const L = {};
for (const line of fs.readFileSync(SYM,"latin1").split("\n")) {
  const m = line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2],16); }
const memory=new ctx.Memory(), keyboard=new ctx.Keyboard(), timer=new ctx.I8253(),
  ay=new ctx.AY(), floppy=new(ctx.Floppy().FD1793)(), io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io), tape={advance:()=>{},sample:0,reset:()=>{}};
const v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288); v06c.displayFrame=()=>{}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
const img=new Uint8Array(fs.readFileSync(ROM));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();
const rd=a=>memory.read(a&0xffff,false), wr=(a,v)=>memory.write(a&0xffff,v,false);
const run=n=>{for(let i=0;i<n;i++) v06c.oneInterrupt(true);};

// getTileFromID один в один: старший ниббл -> группа (indexTiles), младший -> индекс в ней
const rd16 = a => rd(a) | (rd(a+1)<<8);
function tileFromID(id){
  const grp = rd16(L.indexTiles + ((id>>3)&0x1E));
  return rd(grp + (id & 0x0F));
}
// боевой путь: дойти до геймплея
// Стартовая последовательность ровно как в tools/gfx/dump_colortables.js: КОРОТКИЕ нажатия.
// Долгое удержание SPACE прогоняет игру дальше по пирамидам (замер: старт сразу на 5-й).
const press=(c,f=6)=>{ keyboard.keyDown({keyCode:c,preventDefault(){}}); run(f);
  keyboard.keyUp({keyCode:c,preventDefault(){}}); run(4); };
run(120); run(220);
press(32); run(200); press(32); run(400);
for(let i=0;i<12 && rd(L.GameStatus)!==5;i++){ press(32); run(150); }
run(150);
if(rd(L.GameStatus)!==5){ console.error("геймплей не достигнут"); process.exit(2); }

const tipos=[0,1,2,3,4].map(i=>rd(L.tiposMomia+i));
say("tiposMomia (младший ниббл = цвет): " +
  tipos.map((v,i)=>`тип${i}=0x${v.toString(16)} цвет ${(v&15).toString(16)}=${PEN[v&15]}`).join("; "));

// --- MSX-перья по тайлам уровня
function pensOf(p, tiles){
  const b=fs.readFileSync(`${CT}/gameplay_pyr${String(p).padStart(2,"0")}.msxcolor.bin`);
  const pens=new Map();
  for(const [t,n] of tiles){
    for(let y=0;y<8;y++){
      const c=b[t*8+y]; const fg=(c>>4)&15, bg=c&15;
      if(fg) pens.set(fg,(pens.get(fg)||0)+1);
      if(bg) pens.set(bg,(pens.get(bg)||0)+1);
    }
  }
  return pens;
}
const GEMT={0x86:"гем т.синий",0x87:"гем циан",0x88:"гем пурпур",0x89:"гем ЖЁЛТЫЙ",0x8a:"гем зелён",0x8b:"гем серый"};
const rows=[];
// Стартовую пирамиду печатаем СРАЗУ: переход умеет только «следующая», и если разгон
// оставил игру не на первой, обход снизу невозможен — это надо видеть, а не гадать.
say(`старт: пирамида ${rd(L.piramideActual)}, GS=${rd(L.GameStatus)}`);
for (let p=1; p<=15; p++){
  // Переход как в dump_colortables: piramideDest = следующая + GameStatus=8, ждать СМЕНЫ
  // piramideActual и возврата в GS=5 (клавишный чит на переходе 4->5 не срабатывает).
  while (rd(L.piramideActual)!==p){
    const cur=rd(L.piramideActual);
    // ВПЕРЁД — только «следующая» (прыжок через уровень на переходе 8->9 не отрабатывает),
    // НАЗАД — прямым номером (так разведка доходит до 1-й, куда инкрементом не вернуться).
    wr(L.piramideDest, cur>p ? p : cur+1); wr(L.subStatus,0); wr(L.GameStatus,8);
    let w=0; while(w<6000 && !(rd(L.piramideActual)!==cur && rd(L.GameStatus)===5)){ v06c.oneInterrupt(true); w++; }
    run(60);
    if (rd(L.piramideActual)===cur){ console.error(`переход с ${cur} не сработал`); break; }
  }
  if (rd(L.piramideActual)!==p){
    console.error(`пирамида ${p} не загрузилась (piramideActual=${rd(L.piramideActual)}, GS=${rd(L.GameStatus)})`); break; }
  // --- состав карты
  const codes=new Map();
  for(let r=0;r<22;r++) for(let c=0;c<96;c++){
    const id=rd(L.MapaRAM + r*96 + c); if(!id) continue;
    codes.set(id,(codes.get(id)||0)+1); }
  const tiles=new Map();
  for(const [id,n] of codes){ const t=tileFromID(id); if(t) tiles.set(t,(tiles.get(t)||0)+n); }
  // --- мумии
  const nm=rd(L.numMomias), mtypes=new Map();
  for(let i=0;i<nm;i++){ const ty=rd(L.momiasPiramid+i*3+2)&7;
    mtypes.set(ty,(mtypes.get(ty)||0)+1); }
  // --- спрайты (герой 4/5, створки 0-3)
  const sprCols=[];
  for(let s=0;s<6;s++) sprCols.push(rd(L.sprAttrib+s*4+3)&15);
  const r={p, codes, tiles, nm, mtypes, sprCols};
  rows.push(r);
  // печатаем СРАЗУ: обход длинный, промежуточный результат должен пережить остановку
  const mm=[...r.mtypes].sort().map(([t,n])=>`${t}x${n}->${(tipos[t]&15).toString(16)}`).join(" ");
  const gems=[0x86,0x87,0x88,0x89,0x8a,0x8b].filter(t=>r.tiles.has(t))
    .map(t=>`${GEMT[t]}:${r.tiles.get(t)}`).join(" ");
  const pick=r.tiles.get(0x4c)||0, knife=r.tiles.get(0x4b)||0;
  const lever=(r.tiles.get(0x5c)||0)+(r.tiles.get(0x5d)||0);
  const gate=(r.tiles.get(0x68)||0)+(r.tiles.get(0x69)||0)+(r.tiles.get(0x77)||0)+(r.tiles.get(0x78)||0);
  const exits=[0x5f,0x60,0x61,0x62,0x6c,0x6d,0x6e,0x6f,0x70,0x71,0x72,0x7b,0x7c,0x7d,0x7e,0x7f,0x80,0x81]
    .reduce((a,t)=>a+(r.tiles.get(t)||0),0);
  const pens=pensOf(r.p, r.tiles);
  for(const [t] of r.mtypes) pens.set(tipos[t]&15,(pens.get(tipos[t]&15)||0)+1);
  for(const c of r.sprCols) if(c) pens.set(c,(pens.get(c)||0)+1);
  const list=[...pens.keys()].sort((a,b)=>a-b);
  say(`пир ${String(p).padStart(2)} | мумии ${mm.padEnd(22)}| ${gems.padEnd(48)}| кирок ${String(pick).padStart(2)} ножей ${String(knife).padStart(2)} рычаг ${String(lever).padStart(2)} ворот ${String(gate).padStart(2)} выходов ${String(exits).padStart(3)} | перьев ${String(list.length).padStart(2)}: ${list.map(x=>x.toString(16)).join("")}`);
}

say("\n=== СОСТАВ УРОВНЕЙ ===");
say("пир | клеток | мумии (тип x N -> цвет) | гемы на карте | кирок | ножей | рычаг | ворота");
for(const r of rows){
  const mm=[...r.mtypes].sort().map(([t,n])=>`${t}x${n}->${(tipos[t]&15).toString(16)}`).join(" ");
  const gems=[0x86,0x87,0x88,0x89,0x8a,0x8b].filter(t=>r.tiles.has(t))
    .map(t=>`${GEMT[t]}:${r.tiles.get(t)}`).join(" ");
  const pick=r.tiles.get(0x4c)||0, knife=r.tiles.get(0x4b)||0;
  const lever=(r.tiles.get(0x5c)||0)+(r.tiles.get(0x5d)||0);
  const gate=(r.tiles.get(0x68)||0)+(r.tiles.get(0x69)||0)+(r.tiles.get(0x77)||0)+(r.tiles.get(0x78)||0);
  say(`${String(r.p).padStart(3)} | ${String([...r.codes.values()].reduce((a,b)=>a+b,0)).padStart(6)} | ${mm.padEnd(24)}| ${gems.padEnd(46)}| ${String(pick).padStart(5)} | ${String(knife).padStart(5)} | ${String(lever).padStart(5)} | ${gate}`);
}

say("\n=== СКОЛЬКО РАЗНЫХ MSX-ПЕРЬЕВ ТРЕБУЕТ УРОВЕНЬ (тайлы карты + мумии + герой) ===");
for(const r of rows){
  const pens=pensOf(r.p, r.tiles);
  for(const [t] of r.mtypes) pens.set(tipos[t]&15,(pens.get(tipos[t]&15)||0)+1);
  for(const c of r.sprCols) if(c) pens.set(c,(pens.get(c)||0)+1);
  const list=[...pens.keys()].sort((a,b)=>a-b);
  say(`пир ${String(r.p).padStart(2)}: перьев ${String(list.length).padStart(2)} -> ` +
    list.map(x=>x.toString(16)+"="+PEN[x]).join(", "));
}
