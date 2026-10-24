// slot_ledger.js — ОПИСЬ ЗАНЯТОСТИ ВОСЬМИ СЛОТОВ ПАЛИТРЫ. Переносимая: ничего не знает
// о маршрутизации цвета заранее, всё МЕРЯЕТ на переданном ПЗУ. Опись протухает после
// каждой правки цвета — этот инструмент для того и сделан, чтобы её переснимать.
//
// ДВА ИЗМЕРЕНИЯ, оба без догадок:
//  1) ТАЙЛЫ. Для каждого тайла 0x00-0xFF: очищаем плоскости, зовём vec_blit_tile в
//     служебную клетку и читаем, какие idx появились. Получается таблица «тайл -> слоты»
//     ДЛЯ ТЕКУЩЕГО ПРОФИЛЯ СЦЕНЫ (профиль выбирается по номеру пирамиды/экрану, поэтому
//     прогон повторяется для каждой схемы камня и для карты долины).
//  2) СПРАЙТЫ. Хук на vns_pbmc: записываем (номер слота, цвет-ниббл, ОБЕ выбранные
//     плоскости) по факту исполнения. Правило выбора живёт в ПЗУ, а не в инструменте.
//
// Плоскости -> слот для спрайта поверх ЧЁРНОГО фона: idx = 8*p0 + 4*p1 + 2*p2. Одна
// плоскость даёт idx8 / idx4 / idx2, пара — idx12 / idx10 / idx6. Мумии с ЗАДАЧИ#51
// разложены по четырём слотам (idx2, idx6, idx8, idx10), герой — по idx2 и idx6.
//
// Запуск: node tools/verify/slot_ledger.js [rom] [sym]
"use strict";
const fs=require("fs"), vm=require("vm");
const base="/Users/boris/Projects/vector06js";
const REPO=__dirname+"/../..";
const ROM=process.argv[2]||REPO+"/build/kvalley_8c.rom";
const SYM=process.argv[3]||ROM.replace(/\.rom$/,".sym");

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
  return {v06c,cpu,memory,io,keyboard,L,rd:a=>memory.read(a&0xffff,false),wr:(a,v)=>memory.write(a&0xffff,v,false)};
}
let e,rd,wr,cpu,L,v06c,run,press;
function newMachine(){
  e=boot(); ({rd,wr,cpu,L,v06c}=e);
  run=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
  press=(c,f=6)=>{e.keyboard.keyDown({keyCode:c,preventDefault(){}});run(f);e.keyboard.keyUp({keyCode:c,preventDefault(){}});run(4);};
  run(340); press(32); run(200); press(32); run(400);
  for(let i=0;i<12&&rd(L.GameStatus)!==5;i++){ press(32); run(150); }
  run(150);
  if(rd(L.GameStatus)!==5) throw new Error("геймплей не достигнут");
}
newMachine();

// ---- ЗАМЕР 1: тайл -> слоты, через прямой вызов vec_blit_tile
const ROWT=10, COLT=10;                       // служебная клетка в середине поля
function clearPlanes(){ for(let a=0x8000;a<0x0E000;a++) wr(a,0); }
function cellSlots(){
  const s=new Set();
  // B=row у vec_blit_tile — УЖЕ экранный ряд (0-23), поэтому без +1: Etop=255-row*8.
  for(let y=0;y<8;y++){ const lo=(255-(ROWT*8+y))&255;
    const p0=rd(0x8000+COLT*256+lo), p1=rd(0x0A000+COLT*256+lo), p2=rd(0x0C000+COLT*256+lo);
    for(let x=0;x<8;x++){
      const v=(((p0>>(7-x))&1)<<3)|(((p1>>(7-x))&1)<<2)|(((p2>>(7-x))&1)<<1);
      s.add(v);
    } }
  return s;
}
function blitTile(t){
  clearPlanes();
  wr(L.vw_byte,t);
  cpu.set_b(ROWT); cpu.set_c(COLT);   // регистры i8080-js: set_reg(0)=B, set_reg(1)=C
  cpu.sp=(cpu.sp-2)&0xffff; wr(cpu.sp,0); wr(cpu.sp+1,0);
  cpu.pc=L.vec_blit_tile;
  for(let i=0;i<2000000 && cpu.pc!==0;i++) cpu.instruction();
  if(cpu.pc!==0) throw new Error("vec_blit_tile не вернулся, тайл 0x"+t.toString(16));
  return cellSlots();
}

// палитра пирамиды: сырые байты Вектора по чётным слотам
const raw2=a=>(((a>>>22)&3)<<6)|(((a>>>13)&7)<<3)|((a>>>5)&7);
const palCache=new Map();
function palOf(p){ return palCache.get(p)||null; }
// планы клетки после блита тайла: idx каждого пикселя
function cellPlanes(t){
  blitTile(t);
  const out=[];
  for(let y=0;y<8;y++){ const lo=(255-(ROWT*8+y))&255, row=[];
    const p0=rd(0x8000+COLT*256+lo), p1=rd(0x0A000+COLT*256+lo), p2=rd(0x0C000+COLT*256+lo);
    for(let x=0;x<8;x++) row.push((((p0>>(7-x))&1)<<3)|(((p1>>(7-x))&1)<<2)|(((p2>>(7-x))&1)<<1));
    out.push(row); }
  return out;
}
// ---- имена тайлов (для читаемости описи; на замер не влияют)
function tileName(t){
  if(t>=0x40&&t<=0x44) return "кирпич";
  if(t>=0x45&&t<=0x4A) return "НОЖ В ПОЛЁТЕ (framesCuchillo)";
  if(t===0x4B) return "нож на полу";
  if(t===0x4C) return "КИРКА";
  if(t===0x4E) return "дыра";
  if(t>=0x51&&t<=0x53) return "БЛЁСТКИ СОКРОВИЩА (аура)";
  if(t>=0x54&&t<=0x5B) return "цепь/декор выхода";
  if(t===0x5C) return "рычаг вниз";
  if(t===0x5D) return "рычаг вверх";
  if(t===0x5E) return "подставка рычага";
  if(t>=0x5F&&t<=0x62) return "выход";
  if(t>=0x63&&t<=0x64) return "верх выхода (в MSX ЖЁЛТЫЙ)";
  if(t>=0x65&&t<=0x67) return "вход в пирамиду";
  if(t===0x68||t===0x69||t===0x77||t===0x78) return "вращающаяся дверь";
  if(t>=0x6C&&t<=0x72) return "выход/лоза";
  if(t>=0x73&&t<=0x76) return "лестница";
  if(t>=0x7B&&t<=0x81) return "выход/лоза";
  if(t>=0x82&&t<=0x85) return "лестница";
  if(t>=0x86&&t<=0x8B) return "СОКРОВИЩЕ "+["т.синий","циан","пурпур","ЖЁЛТЫЙ","зелён","серый"][t-0x86];
  if(t>=0x10&&t<=0x3F) return "шрифт табло";
  if(t>=0xC0&&t<=0xE7) return "карта долины";
  return null;
}
// ---- ЗАМЕР 2: спрайты — хук на vns_pbmc (правило выбора плоскостей живёт в ПЗУ).
// ПОЧЕМУ НЕ vns_pbset: через него идут не все объекты. С ЗАДАЧИ#51 мумия выбирает цвет
// таблицей и прыгает СРАЗУ на vns_pbmc, минуя vns_pbset; общая для всех точка — только
// vns_pbmc, и к ней обе ячейки (vnc_pbase = первая плоскость, vnc_dupb = вторая своя,
// 0 = её нет) уже выставлены. Читаем ОЗУ, а не регистр A: у мумии в A лежит не плоскость.
const seen=new Map();     // "слот|ниббл" -> [первая плоскость, вторая (0=нет)]
const PB=L.vns_pbmc, IDX=L.vec_nsp_idx, PTR=L.vec_nsp_ptr;
v06c.check_breakpoint=function(){
  if(cpu.pc===PB){
    const slot=rd(IDX);
    const ptr=rd(PTR)|(rd(PTR+1)<<8);
    const col=rd(ptr+3)&15;
    seen.set(`${slot}|${col}`, [rd(L.vnc_pbase), rd(L.vnc_dupb)]);
  }
  return false;
};
run(1200);                       // геймплей: герой, мумии, ворота, нож
v06c.check_breakpoint=()=>false;

const PLN={0x80:"p0",0xA0:"p1",0xC0:"p2"}, PBIT={0x80:8,0xA0:4,0xC0:2};
const PLANE=pl=>PLN[pl[0]]+(pl[1]?"+дубль "+PLN[pl[1]]:"");
const PLIDX=pl=>(PBIT[pl[0]]||0)+(pl[1]?PBIT[pl[1]]:0);   // idx поверх ЧЁРНОГО фона
const cls=s=>s<4?"СТВОРКА ВОРОТ":s<6?"ГЕРОЙ":s<14?"МУМИЯ":s<19?"НОЖ (отскок/падение)":"карта долины";

// ---- прогон по схемам камня
const SCHEMES=[1,5,9,13];
const perScheme=new Map();
function gotoPyr(p){
  while(rd(L.piramideActual)!==p){
    const cur=rd(L.piramideActual);
    wr(L.piramideDest, cur>p?p:cur+1); wr(L.subStatus,0); wr(L.GameStatus,8);
    let w=0; while(w<6000&&!(rd(L.piramideActual)!==cur&&rd(L.GameStatus)===5)){v06c.oneInterrupt(true);w++;}
    run(40);
    if(rd(L.piramideActual)===cur) return false;
  }
  return true;
}
// какие тайлы реально стоят на карте пирамиды
function tilesOnMap(){
  const s=new Set();
  for(let r=0;r<22;r++)for(let c=0;c<96;c++){
    const id=rd(L.MapaRAM+r*96+c); if(!id)continue;
    const grp=rd(L.indexTiles+((id>>3)&0x1E))|(rd(L.indexTiles+((id>>3)&0x1E)+1)<<8);
    const t=rd(grp+(id&15)); if(t) s.add(t);
  }
  return s;
}
console.log("=== ОПИСЬ СЛОТОВ. ПЗУ: "+ROM);
console.log("Тайлы меряются прямым вызовом vec_blit_tile, спрайты — хуком на vns_pbset.\n");
const onMapBy=new Map();
for(const p of SCHEMES){
  // СВОЯ машина на пирамиду: развёртка тайлов уводит CPU в pc=0 и портит ОЗУ,
  // после неё ни навигация, ни чтение MapaRAM не годятся.
  if(p!==SCHEMES[0]) newMachine();
  if(!gotoPyr(p)){ console.log(`(пирамида ${p} не загрузилась — пропуск)`); continue; }
  onMapBy.set(p, tilesOnMap());   // СНИМАЕМ ДО развёртки
  { const m={}; for(const sl of [0,2,4,6,8,10,12,14]) m[sl]=raw2(e.io.Palette[sl]>>>0); palCache.set(p,m); }
  const map=new Map();          // слот -> Set(тайлов)
  for(let t=0;t<256;t++){
    let s; try{ s=blitTile(t); }catch(err){ continue; }
    s.delete(0);
    if(!s.size) continue;
    for(const v of s){ if(!map.has(v)) map.set(v,new Set()); map.get(v).add(t); }
  }
  perScheme.set(p,map);
}


const SLOTS=[2,4,6,8,10,12,14];
for(const [p,map] of perScheme){
  const onMap=onMapBy.get(p)||new Set();
  console.log(`--- ПИРАМИДА ${p} (схема ${((p-1)>>2)&3}) ---`);
  for(const sl of SLOTS){
    const set=map.get(sl);
    if(!set){ console.log(`  idx${String(sl).padEnd(2)}: тайлов НЕТ`); continue; }
    const names=new Map();
    for(const t of set){ const n=tileName(t)||("тайл 0x"+t.toString(16));
      if(!names.has(n))names.set(n,[]); names.get(n).push(t); }
    const shown=[...names].map(([n,ts])=>n+(ts.some(t=>onMap.has(t))?"":" [нет на карте]"));
    console.log(`  idx${String(sl).padEnd(2)}: `+shown.join("; "));
  }
}
console.log("\n--- СПРАЙТЫ (замер по факту исполнения vns_pbmc) ---");
const bySlot=new Map();
for(const [k,pb] of seen){
  const [slot,col]=k.split("|").map(Number);
  const c=cls(slot);
  const key=`${c}`;
  if(!bySlot.has(key))bySlot.set(key,new Map());
  bySlot.get(key).set(col,pb);
}
for(const [c,m] of bySlot){
  console.log(`  ${c}: `+[...m].map(([col,pl])=>`ниббл ${col.toString(16)} -> ${PLANE(pl)} = idx${PLIDX(pl)}`).join(", "));
}
console.log("\nПРИМЕЧАНИЕ: idx для спрайта дан ПОВЕРХ ЧЁРНОГО фона. Створки ворот кладут базу");
console.log("p1+p2 с гашением p0 (idx6) и деталь только в p0 (поверх базы = idx14).");

// ================= СКАНЕР СЛИЯНИЙ =================
// (а) ЦВЕТОВОЕ: два разных слота, близкие RGB — глаз не видит границы.
// (б) ПЛОСКОСТНОЕ: спрайт делает OR в плоскость, где у фона уже единица -> пиксель НЕ
//     МЕНЯЕТСЯ, силуэт физически исчезает. Считается прямым перебором, без рассуждений.
const raw=a=>(((a>>>22)&3)<<6)|(((a>>>13)&7)<<3)|((a>>>5)&7);
const rgbOf=v=>[Math.round((v&7)*255/7),Math.round(((v>>3)&7)*255/7),Math.round(((v>>6)&3)*255/3)];
function dRGB(a,b){return Math.round(Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]));}
function dRedmean(a,b){ // взвешенная метрика (redmean) — ближе к восприятию, чем чистый RGB
  const r=(a[0]+b[0])/2, dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2];
  return Math.round(Math.sqrt((2+r/256)*dr*dr + 4*dg*dg + (2+(255-r)/256)*db*db));
}
const SLOTNAME={0:"фон/пустота",2:"одежда героя, холодная мумия, нож-отскок, серое сокровище",
  4:"блёстки сокровищ (МЕРЦАЕТ)",6:"кожа героя, рукоять ножа, кирка, рычаг, пурпурное сокровище",
  8:"ТОН A КАМНЯ, тёплая мумия, жёлтое сокровище, выходы",
  10:"ТОН B КАМНЯ, циановое сокровище",12:"текст табло, лестницы, пол, лезвие ножа, синее сокровище",
  14:"ворота (рама+створки), зелёное сокровище"};
console.log("\n================= (а) ЦВЕТОВЫЕ СЛИЯНИЯ =================");
console.log("Порог взят ИЗ САМОГО ПРОЕКТА: idx12 #ffffff и idx2 #dadaff живут бок о бок");
console.log("(одежда героя на белой лестнице) и приняты как РАЗЛИЧИМЫЕ — их расстояние и есть");
console.log("нижняя планка различимости. Всё, что НИЖЕ неё, считаем слиянием.");
let POROG=null;
for(const p of SCHEMES){
  const m=palOf(p); if(!m) continue;
  const d=dRGB(rgbOf(m[12]),rgbOf(m[2]));
  if(POROG===null){POROG=d; console.log(`ПОРОГ = ${d} (RGB), ${dRedmean(rgbOf(m[12]),rgbOf(m[2]))} (redmean)\n`);}
}
for(const p of SCHEMES){
  const m=palOf(p); if(!m) continue;
  console.log(`--- пирамида ${p} (схема ${((p-1)>>2)&3}) ---`);
  const list=[];
  for(let i=0;i<SLOTS.length;i++)for(let j=i+1;j<SLOTS.length;j++){
    const a=SLOTS[i],b=SLOTS[j];
    const dr=dRGB(rgbOf(m[a]),rgbOf(m[b])), dm=dRedmean(rgbOf(m[a]),rgbOf(m[b]));
    list.push([dr,dm,a,b]);
  }
  list.sort((x,y)=>x[0]-y[0]);
  for(const [dr,dm,a,b] of list.slice(0,4))
    console.log(`  idx${String(a).padEnd(2)} / idx${String(b).padEnd(2)}: RGB ${String(dr).padStart(3)}  redmean ${String(dm).padStart(3)}  ${dr<POROG?"<<< СЛИЯНИЕ":""}`);
}
console.log("\n================= (б) ПЛОСКОСТНЫЕ СЛИЯНИЯ =================");
console.log("Спрайт кладёт OR в ОДНУ плоскость. Считаем, сколько пикселей клетки фона");
console.log("НЕ ИЗМЕНЯТ индекс, если по ним пройти спрайтом сплошняком.");
const BGT=[[0x40,"кирпич"],[0x75,"лестница"],[0x00,"пустота"]];
for(const p of SCHEMES.slice(0,1)){
  for(const [t,name] of BGT){
    const cells=cellPlanes(t);
    // idx = p0<<3 | p1<<2 | p2<<1 -> бит плоскости: p0=8, p1=4, p2=2
    for(const [bit,plname] of [[8,"p0 (ТЁПЛАЯ МУМИЯ)"],[4,"p1"],[2,"p2 (одежда героя, ХОЛОДНАЯ МУМИЯ, нож-отскок)"]]){
      let hidden=0,tot=0;
      for(let y=0;y<8;y++)for(let x=0;x<8;x++){
        const b=cells[y][x]; tot++;
        if((b|bit)===b) hidden++;      // бит уже стоит -> пиксель не изменится, силуэт пропал
      }
      console.log(`  фон «${name}» + спрайт в ${plname}: невидимо ${hidden} из ${tot} пикс (${Math.round(100*hidden/tot)}%)`);
    }
  }
}
