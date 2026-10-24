// level_content.js — СОСТАВ УРОВНЯ ИЗ ДАННЫХ, без прогона игры.
//
// Зовёт setupStage НАПРЯМУЮ (как gem_colors зовёт vec_nat_room): piramideDest = N,
// подсунутый адрес возврата 0, исполняем до pc==0 — и читаем разложенные структуры:
//   numMomias/momiasPiramid  — по 3 байта (y, x, ТИП);
//   gemasTotales/datosGemas  — по 9 байт, байт 0 = цвет<<4 | активен;
//   MapaRAM                  — 22 x 96 map-кодов (ножи/кирки/ворота/выходы).
// Так покрываются ВСЕ 15 пирамид: прогон спотыкался на переходе 12->13.
//
// ЦВЕТ МУМИИ НЕ ЛЕЖИТ В КАРТЕ. Карта задаёт ТИП, а цвет берётся из ГЛОБАЛЬНОЙ tiposMomia
// по индексу min(тип + numFinishGame, 4) — см. initMomia, kvalley_game.asm:7545.
// Поэтому таблица считается для КАЖДОГО numFinishGame 0..4.
//
// Запуск: node tools/verify/level_content.js [rom] [sym]
"use strict";
const fs=require("fs"), vm=require("vm");
const base="/Users/boris/Projects/vector06js";
const REPO=__dirname+"/../..";
const ROM=process.argv[2]||REPO+"/build/kvalley_8c.rom";
const SYM=process.argv[3]||ROM.replace(/\.rom$/,".sym");

const PEN={0:"прозр",1:"чёрн",2:"ср.зелён",3:"св.зелён",4:"т.синий",5:"св.синий",6:"т.красн",
  7:"циан",8:"ср.красн",9:"св.красн",10:"Т.ЖЁЛТ",11:"св.жёлт",12:"т.зелён",13:"пурпур",
  14:"серый",15:"белый"};

function boot(){
  const g={};g.window=g;
  const stub=()=>({width:0,height:0,style:{},getContext:()=>({createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}})});
  g.document={createElement:stub,getElementById:stub};
  g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;
  g.console={log(){},debug(){},warn(){},error(){},info(){}};
  const ctx=vm.createContext(g);
  for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
    vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  const L={};for(const l of fs.readFileSync(SYM,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
  const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
  const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
  v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;
  const img=new Uint8Array(fs.readFileSync(ROM));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
  cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
  timer.Write(3,0x36);timer.Write(3,0x76);timer.Write(3,0xb6);ay.reset&&ay.reset();
  return {v06c,cpu,memory,io,L,rd:a=>memory.read(a&0xffff,false),wr:(a,v)=>memory.write(a&0xffff,v,false)};
}
const e=boot();
const {rd,wr,cpu,L}=e;
// Дать игре инициализироваться (таблицы, ОЗУ), но не заходить в геймплей.
for(let i=0;i<200;i++) e.v06c.oneInterrupt(true);

function loadStage(p){
  wr(L.piramideDest,p);
  wr(L.numFinishGame,0);
  cpu.sp=(cpu.sp-2)&0xffff; wr(cpu.sp,0); wr(cpu.sp+1,0);
  cpu.pc=L.setupStage;
  let n=0; for(;n<40000000 && cpu.pc!==0;n++) cpu.instruction();
  if(cpu.pc!==0) throw new Error(`setupStage не вернулся на пирамиде ${p}`);
  if(rd(L.piramideActual)!==p) throw new Error(`piramideActual=${rd(L.piramideActual)} вместо ${p}`);
}
const tipos=[0,1,2,3,4].map(i=>rd(L.tiposMomia+i));
console.log("tiposMomia (ГЛОБАЛЬНАЯ, одна на всю игру; младший ниббл = цвет):");
console.log("  "+tipos.map((v,i)=>`тип${i} -> ${(v&15).toString(16)}=${PEN[v&15]}`).join(", "));
console.log("Эффективный тип = min(тип_из_карты + numFinishGame, 4) — см. initMomia.\n");

const KNIFE=new Set([0x30,0x31,0x32]), PICK=new Set([0x80]);
const GATE=new Set([0x50,0x51,0x52,0x53]);   // группа tilesGiratoria
const data=[];
for(let p=1;p<=15;p++){
  loadStage(p);
  const nm=rd(L.numMomias), types=[];
  for(let i=0;i<nm;i++) types.push(rd(L.momiasPiramid+i*3+2)&7);
  const ng=rd(L.gemasTotales), gems=[];
  for(let i=0;i<ng;i++) gems.push((rd(L.datosGemas+i*9)>>4)&15);
  let knives=0,picks=0,cells=0;
  const codes=new Map();
  for(let r=0;r<22;r++)for(let c=0;c<96;c++){
    const id=rd(L.MapaRAM+r*96+c); if(!id)continue; cells++;
    codes.set(id,(codes.get(id)||0)+1);
    if(KNIFE.has(id))knives++; if(PICK.has(id))picks++;
  }
  data.push({p,nm,types,ng,gems,knives,picks,codes});
}

// --- цвет гема: старший ниббл из данных уровня -> map ID 0x40+цвет -> тайл 0x86..0x8B
const GEMPEN={3:4,4:7,5:13,6:10,7:2,8:14};   // код цвета -> перо MSX (по tilesGemas)
const GEMNAME={3:"т.синий",4:"циан",5:"пурпур",6:"ЖЁЛТЫЙ",7:"зелён",8:"серый"};
console.log("=== СОСТАВ ИЗ ДАННЫХ УРОВНЯ (numFinishGame=0) ===");
console.log("пир | мумии: типы -> перья      | гемы: цвета из данных            | ножей кирок");
for(const d of data){
  const mt=[...new Set(d.types)].sort();
  const mp=[...new Set(mt.map(t=>tipos[t]&15))].sort((a,b)=>a-b);
  const gc=[...new Set(d.gems)].sort((a,b)=>a-b);
  console.log(`${String(d.p).padStart(3)} | ${(mt.join(",")+" -> "+mp.map(x=>x.toString(16)).join(",")).padEnd(26)}| `+
    `${gc.map(c=>GEMNAME[c]||("код"+c)).join(",").padEnd(34)}| ${String(d.knives).padStart(4)} ${String(d.picks).padStart(5)}`);
}

console.log("\n=== ТРЕБУЕМЫЕ ПЕРЬЯ ПО СОСТАВУ (мумии + гемы), numFinishGame = 0..4 ===");
for(let nf=0;nf<=4;nf++){
  const per=[];
  for(const d of data){
    const s=new Set();
    for(const t of d.types) s.add(tipos[Math.min(t+nf,4)]&15);
    for(const c of d.gems) s.add(GEMPEN[c]);
    per.push([...s].sort((a,b)=>a-b));
  }
  console.log(` numFinishGame=${nf}:`);
  for(let i=0;i<15;i++)
    console.log(`   пир ${String(i+1).padStart(2)}: ${per[i].length} перьев -> `+per[i].map(x=>x.toString(16)+"="+PEN[x]).join(", "));
}

console.log("\n=== ЕСТЬ ЛИ НА УРОВНЕ ЖЁЛТЫЙ ОБЪЕКТ (перо A) ===");
for(let nf=0;nf<=4;nf++){
  const row=data.map(d=>{
    const mum=d.types.some(t=>(tipos[Math.min(t+nf,4)]&15)===10);
    const gem=d.gems.includes(6);
    return mum&&gem?"МГ":mum?"М":gem?"Г":"—";
  });
  console.log(` nf=${nf}: `+row.map((v,i)=>`${i+1}:${v}`).join("  "));
}
console.log("  М = жёлтая мумия, Г = жёлтый гем, — = жёлтого объекта нет");
console.log("  (нож и кирка жёлтые/красные ВСЕГДА — их цвет не из карты, а из тайлсета)");

// ===== ЧТО ДАЁТ ПЕРЕАДРЕСАЦИЯ ГЕМОВ =====
// Палитра уровня (замер item_colors): восемь слотов, из них по СХЕМЕ меняются два.
const VEC={  // сырой байт Вектора %BBGGGRRR
  0:[0x00,0x00,0x00,0x00], 2:[0xF6,0xF6,0xF6,0xF6], 4:[0x3F,0x3F,0x3F,0x3F],
  6:[0x5F,0x5F,0x5F,0x5F], 8:[0x77,0xD2,0x56,0x69], 10:[0x57,0xE8,0x77,0xB7],
  12:[0xFF,0xFF,0xFF,0xFF], 14:[0x38,0x38,0x38,0x38] };
const vrgb=v=>[((v&7)*255/7)|0,(((v>>3)&7)*255/7)|0,(((v>>6)&3)*255/3)|0];
const MSXRGB=[[0,0,0],[0,0,0],[33,200,66],[94,220,120],[84,85,237],[125,118,252],[212,82,77],
  [66,235,245],[252,85,84],[255,121,120],[212,193,84],[230,206,128],[33,176,59],[201,91,186],
  [204,204,204],[255,255,255]];
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
// СЕЙЧАС: kv_gem_planes -> слот по коду цвета гема (3..8)
const NOWSLOT={3:12,4:10,5:6,6:8,7:14,8:2};
// Слоты, доступные ТАЙЛУ: все восемь, кроме мерцающего idx4 и чёрного idx0
const CAND=[2,6,8,10,12,14];
const scheme=p=>((p-1)>>2)&3;
// ВЗАИМНО ОДНОЗНАЧНАЯ расстановка: шесть гемов обязаны остаться ШЕСТЬЮ РАЗНЫМИ цветами
// (это результат задачи B «разноцветные сокровища»), поэтому два гема в один слот класть
// нельзя. Полный перебор: гемов на уровне <= 6, слотов-кандидатов 6 -> не больше 720 вариантов.
function bestAssign(colors, s){
  let best=null,bestSum=1e9;
  const perm=(rest,used,acc,sum)=>{
    if(sum>=bestSum) return;
    if(!rest.length){ bestSum=sum; best={...acc}; return; }
    const c=rest[0];
    for(const sl of CAND){
      if(used.has(sl)) continue;
      used.add(sl); acc[c]=sl;
      perm(rest.slice(1),used,acc,sum+dist(vrgb(VEC[sl][s]),MSXRGB[GEMPEN[c]]));
      used.delete(sl); delete acc[c];
    }
  };
  perm(colors,new Set(),{},0);
  return {map:best,sum:bestSum};
}
console.log("\n=== ГЕМЫ: НАСКОЛЬКО ДАЛЕКО ОТ ОРИГИНАЛА (RGB-расстояние до пера MSX) ===");
console.log("пир|сх| цвет гема | сейчас слот -> расст | лучший слот -> расст | выигрыш");
console.log("пир|сх|гемов| сейчас | по СХЕМЕ (все 6 цветов) | по СОСТАВУ (только свои) | выигрыш состава");
let SN=0,SS=0,SL=0;
// расстановка ПО СХЕМЕ: обязана обслужить ВСЕ шесть цветов, потому что схема не знает,
// какие гемы стоят на конкретном уровне
const schemeAssign=[0,1,2,3].map(s=>bestAssign([3,4,5,6,7,8],s));
for(const d of data){
  const s=scheme(d.p);
  const cols=[...new Set(d.gems)].sort((a,b)=>a-b);
  const now=cols.reduce((a,c)=>a+dist(vrgb(VEC[NOWSLOT[c]][s]),MSXRGB[GEMPEN[c]]),0);
  const bySch=cols.reduce((a,c)=>a+dist(vrgb(VEC[schemeAssign[s].map[c]][s]),MSXRGB[GEMPEN[c]]),0);
  const byLvl=bestAssign(cols,s);
  SN+=now; SS+=bySch; SL+=byLvl.sum;
  console.log(`${String(d.p).padStart(3)}|${s} | ${String(cols.length).padStart(4)}| ${String(Math.round(now)).padStart(6)} | ${String(Math.round(bySch)).padStart(23)} | ${String(Math.round(byLvl.sum)).padStart(24)} | ${Math.round(bySch-byLvl.sum)>0?"-"+Math.round(bySch-byLvl.sum):"0"}`);
}
console.log(`ИТОГО (сумма расстояний по 15 уровням): сейчас ${Math.round(SN)}, по схеме ${Math.round(SS)} (-${Math.round(100*(SN-SS)/SN)}%), по составу ${Math.round(SL)} (-${Math.round(100*(SN-SL)/SN)}%)`);
console.log(`ВЫИГРЫШ СОСТАВА НАД СХЕМОЙ: ${Math.round(SS-SL)} = ${Math.round(100*(SS-SL)/SN)}% от нынешней ошибки`);

console.log("\n=== РАССТАНОВКА ПО СХЕМЕ (взаимно однозначная, все шесть цветов) ===");
for(let s=0;s<4;s++)
  console.log(` схема ${s} (пир ${s*4+1}-${Math.min(s*4+4,15)}): `+
    [3,4,5,6,7,8].map(c=>`${GEMNAME[c]}->idx${schemeAssign[s].map[c]}`).join(", "));
console.log("\n=== РАССТАНОВКА ПО СОСТАВУ (для уровней, где она ОТЛИЧАЕТСЯ от схемной) ===");
for(const d of data){
  const s=scheme(d.p);
  const cols=[...new Set(d.gems)].sort((a,b)=>a-b);
  const byLvl=bestAssign(cols,s);
  const diff=cols.filter(c=>byLvl.map[c]!==schemeAssign[s].map[c]);
  if(diff.length)
    console.log(` пир ${String(d.p).padStart(2)} (сх ${s}): `+
      diff.map(c=>`${GEMNAME[c]}: idx${schemeAssign[s].map[c]} -> idx${byLvl.map[c]}`).join(", "));
}

console.log("\n=== МУМИИ: сколько РАЗНЫХ перьев на уровне и влезают ли они в доступные слоты ===");
console.log("Спрайт пишет ОДНУ плоскость поверх чёрного -> доступны idx2 (p2), idx4 (p1, мерцает),");
console.log("idx8 (p0 = ТОН A КИРПИЧА). idx6 — только двойной записью (дороже).");
for(let nf=0;nf<=1;nf++){
  console.log(` numFinishGame=${nf}:`);
  for(const d of data){
    const pens=[...new Set(d.types.map(t=>tipos[Math.min(t+nf,4)]&15))].sort((a,b)=>a-b);
    const note = pens.length===1 ? "одна краска — можно увести с idx8, слияния со стеной НЕ будет"
      : `${pens.length} краски — одна обязана лечь в idx8 = цвет кирпича (СЛИЯНИЕ)`;
    console.log(`   пир ${String(d.p).padStart(2)}: перья ${pens.map(x=>x.toString(16)).join(",")} — ${note}`);
  }
}
