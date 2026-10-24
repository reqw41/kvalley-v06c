// p2_hud_vs_bg_tiles.js — измеряет, какие tile# рисует HUD-путь (vcp_cells, покадрово,
// РЕЗИДЕНТ) vs фон-путь (vec_nat_room, раз на комнату, ТРАНЗИЕНТ) в порте KV на Вектор.
// Разделение по адресу возврата на стеке в момент PC==vec_blit_tile:
//   ret < vcp_cells(0x640B) => вызов из vec_nat_room  => ФОН
//   ret >=vcp_cells         => вызов из vcp_cells      => HUD/динамика
// Плюс: экран-ряд B (regs[0]) для HUD-пути (row0/23 = настоящий HUD; иначе динамика маза).
// Использование: node tools/verify/p2_hud_vs_bg_tiles.js /tmp/kva.rom /tmp/kva.sym
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const romPath=process.argv[2]||"/tmp/kva.rom", symPath=process.argv[3]||"/tmp/kva.sym";
const S={};for(const l of fs.readFileSync(symPath,"latin1").split("\n")){const m=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(m)S[m[1]]=parseInt(m[2],16);}
const BLIT=S.vec_blit_tile, VCP=S.vcp_cells, GS=S.GameStatus, FPM=S.flagPiramideMap, VWB=S.vw_byte;
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
io.Palette=new Array(16).fill(0);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(65536);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(romPath));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0;cpu.sp=0xc300;cpu.iff=false;
timer.Write(3,0x36);timer.Write(3,0x76);timer.Write(3,0xb6);ay.reset&&ay.reset();
function rd(a){return memory.bytes[memory.tobank(a)];}

// bg[tile]=count (caller vec_nat_room), hud[tile]=count (caller vcp_cells)
const bg=new Map(), hud=new Map();
// per-tile per-row histogram for HUD path: hudRow[tile] = Map(row->count)
const hudRow=new Map();
// vcp-путь, разбитый по состоянию игры: inRoomVcp (GS==5) vs nonRoomVcp (титул/меню/gameover)
const inRoomVcp=new Set(), nonRoomVcp=new Set();
const inRoomRow=new Map(); // tile -> Map(row->count) для строго GS==5
let collecting=false;
const orig=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc;
  if(collecting && pc===BLIT){
    // на входе (до push bc) [sp],[sp+1] = адрес возврата
    const sp=cpu.sp;
    const ret=rd(sp)|(rd(sp+1)<<8);
    const tile=rd(VWB);
    const row=cpu.regs[0]; // B = screen row
    if(ret>=VCP){
      hud.set(tile,(hud.get(tile)||0)+1);
      let rm=hudRow.get(tile); if(!rm){rm=new Map();hudRow.set(tile,rm);} rm.set(row,(rm.get(row)||0)+1);
      if(rd(GS)===5 && rd(FPM)!==0){ inRoomVcp.add(tile); let rm2=inRoomRow.get(tile); if(!rm2){rm2=new Map();inRoomRow.set(tile,rm2);} rm2.set(row,(rm2.get(row)||0)+1);} else nonRoomVcp.add(tile);
    } else {
      bg.set(tile,(bg.get(tile)||0)+1);
    }
  }
  return orig();
};

// --- довести до геймплея: warmup, зажать пробел (старт), отпустить, войти в комнату ---
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
for(let f=0;f<450;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);}
keyboard.keyUp({keyCode:32,preventDefault(){}});
for(let f=0;f<60;f++)v06c.oneInterrupt(true);
// начинаем сбор — захватит первый vec_nat_room-бёрст + HUD
collecting=true;
let inRoom=-1;
// активная прогулка: чередуем направления/копание, чтобы максимизировать динамику маза
const keys=(process.argv[5]==="safe")?[39,39,37,37,38,39,37,38]:[39,39,39,37,37,38,40,32]; // safe: только ходьба/лестница
let cur=39;
const NF=parseInt(process.argv[4]||"12000",10);
for(let f=0;f<NF;f++){
  if(f%15===0){keyboard.keyUp({keyCode:cur,preventDefault(){}});cur=keys[(f/15|0)%keys.length];keyboard.keyDown({keyCode:cur,preventDefault(){}});}
  v06c.oneInterrupt(true);
  if(inRoom<0 && rd(GS)===5 && rd(FPM)!==0)inRoom=f;
}
console.log(`inRoom detected@frame=${inRoom}  GS=${rd(GS)} FPM=${rd(FPM)}  frames=${NF}`);

function fmt(map){return [...map.keys()].sort((a,b)=>a-b).map(t=>`0x${t.toString(16).padStart(2,"0")}`).join(" ");}
const bgSet=new Set(bg.keys()), hudSet=new Set(hud.keys());
const bgOnly=[...bgSet].filter(t=>!hudSet.has(t)).sort((a,b)=>a-b);
const both=[...bgSet].filter(t=>hudSet.has(t)).sort((a,b)=>a-b);
const hudOnly=[...hudSet].filter(t=>!bgSet.has(t)).sort((a,b)=>a-b);

console.log(`\n=== ФОН-путь (vec_nat_room), уникальных tile#: ${bgSet.size} ===`);
console.log(fmt(bg));
console.log(`\n=== HUD-путь (vcp_cells), уникальных tile#: ${hudSet.size} ===`);
console.log(fmt(hud));
const hx=t=>`0x${t.toString(16).padStart(2,"0")}`;
console.log(`\n--- HUD-путь: tile# -> {row:count} (row0/23 = настоящий HUD; иначе динамика маза) ---`);
for(const t of [...hudSet].sort((a,b)=>a-b)){
  const rm=hudRow.get(t); const rows=[...rm.entries()].sort((a,b)=>a[0]-b[0]).map(([r,c])=>`r${r}:${c}`).join(",");
  console.log(`  ${hx(t)} total=${hud.get(t)}  ${rows}`);
}
// разделяем HUD-путь: чистый HUD (только ряды 0/23) vs динамика маза (внутренние ряды)
const hudPureGlyph=[], hudDynMaze=[];
for(const t of hudSet){
  const rm=hudRow.get(t);
  const rows=[...rm.keys()];
  const onlyHud=rows.every(r=>r===0||r===23);
  if(onlyHud)hudPureGlyph.push(t); else hudDynMaze.push(t);
}
hudPureGlyph.sort((a,b)=>a-b); hudDynMaze.sort((a,b)=>a-b);
console.log(`\n--- HUD-путь детально ---`);
console.log(`Чистый HUD (ТОЛЬКО ряды 0/23), ${hudPureGlyph.length} тайлов: ${hudPureGlyph.map(hx).join(" ")}`);
console.log(`Динамика маза (внутр. ряды, vcp перерисовывает в игре), ${hudDynMaze.length} тайлов: ${hudDynMaze.map(hx).join(" ")}`);

console.log(`\n=== РАЗБИЕНИЕ ===`);
console.log(`HUD резидентный набор (нужен pat+col резидентно): ${hudSet.size} тайлов`);
console.log(`  ${hudOnly.length} только-HUD: ${hudOnly.map(hx).join(" ")}`);
console.log(`  ${both.length} и HUD и фон: ${both.map(hx).join(" ")}`);
console.log(`ФОН только (кандидат в транзиент, pat+col НЕ нужны резидентно): ${bgOnly.length} тайлов`);
console.log(`  ${bgOnly.map(hx).join(" ")}`);
const maxTile=Math.max(...bgSet,...hudSet);
console.log(`\n=== ОЦЕНКА БАЙТ (pat 8Б/тайл, col 8Б/тайл) ===`);
console.log(`макс tile# встречен: ${hx(maxTile)} (${maxTile})`);
console.log(`HUD-резидент pat: ${hudSet.size}*8 = ${hudSet.size*8}Б ; col: ${hudSet.size}*8 = ${hudSet.size*8}Б`);
console.log(`Фон-транзиент pat: ${bgOnly.length}*8 = ${bgOnly.length*8}Б ; col: ${bgOnly.length}*8 = ${bgOnly.length*8}Б`);
console.log(`Текущий резидент pat_shadow=2048Б col_shadow=2816Б (всё).`);

const inR=[...inRoomVcp].sort((a,b)=>a-b), nonR=[...nonRoomVcp].sort((a,b)=>a-b);
const nonROnly=nonR.filter(t=>!inRoomVcp.has(t));
console.log(`\n=== vcp_cells по состоянию игры ===`);
console.log(`В КОМНАТЕ (GS==5) vcp рисует ${inR.length} тайлов: ${inR.map(hx).join(" ")}`);
console.log(`ВНЕ комнаты (титул/меню/gameover) vcp рисует ${nonR.length} тайлов, из них ${nonROnly.length} НЕ встречаются в комнате:`);
console.log(`  ${nonROnly.map(hx).join(" ")}`);
console.log(`\n--- В КОМНАТЕ (GS==5): tile# -> {row:count} ---`);
for(const t of inR){const rm=inRoomRow.get(t);const rows=[...rm.entries()].sort((a,b)=>a[0]-b[0]).map(([r,c])=>`r${r}:${c}`).join(",");console.log(`  ${hx(t)}  ${rows}`);}
// сколько из in-room vcp — чисто ряды 0/23 (HUD-глифы) vs внутренние (динамика маза)
let irHud=0,irMaze=[];for(const t of inR){const rows=[...inRoomRow.get(t).keys()];if(rows.every(r=>r===0||r===23))irHud++;else irMaze.push(t);}
console.log(`In-room vcp: ${irHud} тайлов только-ряды0/23 (HUD-глифы); ${irMaze.length} с внутр.рядами (динамика): ${irMaze.map(hx).join(" ")}`);
