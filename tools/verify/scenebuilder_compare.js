// СРАВНИВАТЕЛЬ TILEMAP ДЛЯ НАТИВНОГО build_tilemap (M2a Task 2, King's Valley
// engine v2). Задача: прогнать /tmp/sb_harness.rom (v2/sb_harness.asm, включает
// v2/scene_builder.asm) в headless vector06js, ПЕРЕД запуском CPU положить в
// RAM по адресу SB_MAPSCREEN (scratch, см. v2/sb_harness.asm) 704-байтный
// MapaRAM-экран текущей комнаты (входной блок снапшота, tools/verify/
// scene_extract.js, Task 1 M2a), исполнить харнесс до halt (build_tilemap
// должен заполнить scn_tilemap[32..735] = tilemap-клетки СТРОК 1..22, клетки
// 0..31 и 736..767 - HUD, НЕ строятся из MapaRAM - см. m2a-task-1-report.md),
// затем сравнить именно клетки 32..735 с РЕФЕРЕНСОМ - v1's живой name-table
// (блок tilemap@0 в том же снапшоте, см. заголовок scene_extract.js).
//
// Использование: node tools/verify/scenebuilder_compare.js [сценарий]
//   сценарий (1/2/3, по умолч. 1) выбирает /tmp/v1_scene_<n>.bin.
// Вход: /tmp/sb_harness.rom   (собрать: tools/bin/sjasm v2/sb_harness.asm /tmp/sb_harness.rom)
//       /tmp/v1_scene_<n>.bin (собрать: node tools/verify/scene_extract.js <n>)
"use strict";
const fs = require("fs");
const base = "/Users/boris/Projects/vector06js";

// --- Vector headless (vector06js), скопировано verbatim из driver_pixelcompare.js ---
function makeVector(romPath) {
  global.window = global;
  global.document = { createElement: () => fc(), getElementById: () => fc() };
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  global.requestAnimationFrame=()=>0; global.setTimeout=()=>0; global.print=()=>0; global.console.debug=()=>{};
  const files=["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"];
  const vm=require("vm"); const ctx=vm.createContext(global);
  for(const f of files) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  const {Memory,IO,AY,I8253,Keyboard,I8080,Vector06c,Floppy}=ctx;
  const memory=new Memory(),keyboard=new Keyboard(),timer=new I8253(),ay=new AY();
  const floppy=new(Floppy().FD1793)(); const io=new IO(keyboard,timer,memory,ay,floppy);
  io.Palette=new Array(16).fill(0);
  const cpu=new I8080(memory,io); const tape={advance:()=>{},sample:0,reset:()=>{}};
  const v06c=new Vector06c(cpu,memory,io,ay,tape);
  v06c.bmp=new Uint32Array(256*256); v06c.displayFrame=function(){}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
  if(v06c.soundnik) v06c.soundnik.soundStep=function(){};
  const img=new Uint8Array(fs.readFileSync(romPath));
  memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
  cpu.pc=0; cpu.sp=0xc300; cpu.iff=false;
  timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();
  const rd=(a)=>memory.bytes[memory.tobank(a)];
  const wr=(a,v)=>{ memory.bytes[memory.tobank(a)]=v; };
  return { cpu, memory, rd, wr };
}

const SCENARIO = parseInt(process.argv[2] || "1", 10);
if (![1, 2, 3].includes(SCENARIO)) {
  console.error(`Неизвестный сценарий '${process.argv[2]}': ожидается 1, 2 или 3`);
  process.exit(1);
}
const HARNESS_ROM = "/tmp/sb_harness.rom";
const SCENE_BIN = `/tmp/v1_scene_${SCENARIO}.bin`;

if (!fs.existsSync(HARNESS_ROM)) {
  console.error(`Не найден ${HARNESS_ROM}. Собрать: tools/bin/sjasm v2/sb_harness.asm ${HARNESS_ROM}`);
  process.exit(1);
}
if (!fs.existsSync(SCENE_BIN)) {
  console.error(`Не найден ${SCENE_BIN}. Собрать: node tools/verify/scene_extract.js ${SCENARIO}`);
  process.exit(1);
}

const vec = makeVector(HARNESS_ROM);
const scene = fs.readFileSync(SCENE_BIN);

// --- Офсеты снапшота (см. tools/verify/scene_extract.js) ---
const OFF_TILEMAP = 0, LEN_TILEMAP = 768;                 // РЕФЕРЕНС: v1 name-table
const OFF_SPRITES = 768, LEN_SPRITES = 80;                // РЕФЕРЕНС: v1 SAT (16*5, см. заголовок extract)
const OFF_NSPRITES = 848;                                 // РЕФЕРЕНС: число видимых спрайтов
const OFF_INPUT = 25429;                                  // блок ВХОДА (Task 1)
const OFF_MAPSCREEN = OFF_INPUT + 195, LEN_MAPSCREEN = 704; // 22x32 map-ID текущей комнаты
// SYNC-блок (M2a Task 3, дописан ПОСЛЕ блока ВХОДА Task1 = 899 байт) - см.
// заголовок tools/verify/scene_extract.js за подробным объяснением зачем это
// отдельный (temporally-синхронный) снимок, а не поля из блока ВХОДА выше.
const OFF_SYNC = OFF_INPUT + 899;
const OFF_SYNC_PROTA = OFF_SYNC, LEN_SYNC_PROTA = 4;             // Y,X,Frame,Sentido
const OFF_SYNC_NUMMOMIAS = OFF_SYNC + 4;
const OFF_SYNC_MOMIADAT = OFF_SYNC + 5, LEN_SYNC_MOMIADAT = 88;
const OFF_SYNC_OFFSETPLANOSPR = OFF_SYNC + 93;
const OFF_SYNC_TIMER = OFF_SYNC + 94;
const OFF_SYNC_NUMKNIFES = OFF_SYNC + 95;
const OFF_SYNC_KNIFESDATA = OFF_SYNC + 96, LEN_SYNC_KNIFESDATA = 102;
const MIN_LEN = OFF_SYNC_KNIFESDATA + LEN_SYNC_KNIFESDATA;

if (scene.length < MIN_LEN) {
  console.error(`Неожиданный размер ${SCENE_BIN}: ${scene.length} (ожидалось >= ${MIN_LEN})`);
  process.exit(1);
}

// --- Адреса контракта (v2/scene.inc + v2/sb_harness.asm) ---
const SCN_TILEMAP = 0x4000;
const SCN_SPRITES = 0x4300, SCN_NSPRITES = 0x4350;
const SB_MAPSCREEN = 0x6000; // scratch: сюда кладём вход ДО call build_tilemap (см. sb_harness.asm)
const SCN_PROTA = 0x6600, SCN_PROTAROOM = 0x6604, SCN_NUMMOMIAS = 0x6605;
const SCN_MOMIADAT = 0x6606, SCN_OFFSETPLANOSPR = 0x665E;
const SCN_NUMKNIFES = 0x665F, SCN_KNIFESDATA = 0x6660, SCN_TIMER = 0x66C6;

// Положить входной MapaRAM-экран в RAM ДО запуска CPU.
for (let i = 0; i < LEN_MAPSCREEN; i++) {
  vec.wr(SB_MAPSCREEN + i, scene[OFF_MAPSCREEN + i]);
}

// Положить SYNC-блок актёр-структур (build_sprites input, см. scene.inc) в RAM.
for (let i = 0; i < LEN_SYNC_PROTA; i++) vec.wr(SCN_PROTA + i, scene[OFF_SYNC_PROTA + i]);
vec.wr(SCN_PROTAROOM, scene[OFF_INPUT + 2]); // ProtaRoom берём из блока ВХОДА Task1 (не меняется внутри снапшота)
vec.wr(SCN_NUMMOMIAS, scene[OFF_SYNC_NUMMOMIAS]);
for (let i = 0; i < LEN_SYNC_MOMIADAT; i++) vec.wr(SCN_MOMIADAT + i, scene[OFF_SYNC_MOMIADAT + i]);
vec.wr(SCN_OFFSETPLANOSPR, scene[OFF_SYNC_OFFSETPLANOSPR]);
vec.wr(SCN_NUMKNIFES, scene[OFF_SYNC_NUMKNIFES]);
for (let i = 0; i < LEN_SYNC_KNIFESDATA; i++) vec.wr(SCN_KNIFESDATA + i, scene[OFF_SYNC_KNIFESDATA + i]);
vec.wr(SCN_TIMER, scene[OFF_SYNC_TIMER]);

// --- Прогнать CPU до halt (0x76) с лимитом инструкций ---
const MAX_INSTR = 2_000_000;
let executed = 0;
let halted = false;
for (; executed < MAX_INSTR; executed++) {
  if (vec.rd(vec.cpu.pc) === 0x76) { halted = true; break; }
  vec.cpu.instruction();
}
if (!halted) {
  console.error(`НЕ ДОШЁЛ до halt за ${MAX_INSTR} инструкций (pc=0x${vec.cpu.pc.toString(16)})`);
  process.exit(1);
}
console.log(`halt достигнут за ${executed} инструкций (pc=0x${vec.cpu.pc.toString(16)})`);

// --- Сравнить только клетки 32..735 (строки 1..22) - строки 0 и 23 (HUD)
// build_tilemap НЕ трогает (см. m2a-task-1-report.md, m2a-task-2-brief.md). ---
const CELL_LO = 32, CELL_HI = 735; // включительно
let mismatches = 0;
let firstBad = -1;
for (let cell = CELL_LO; cell <= CELL_HI; cell++) {
  const got = vec.rd(SCN_TILEMAP + cell);
  const want = scene[OFF_TILEMAP + cell];
  if (got === want) continue;
  mismatches++;
  if (firstBad < 0) firstBad = cell;
}

console.log(`tilemap клетки ${CELL_LO}..${CELL_HI} (704 клетки, строки 1..22): несовпавших = ${mismatches} / ${CELL_HI - CELL_LO + 1}`);

if (mismatches > 0) {
  const cell = firstBad;
  const row = Math.floor(cell / 32);
  const col = cell % 32;
  const mapScreenIdx = cell - CELL_LO; // 0-based индекс в 704-байтном mapScreen (row-1)*32+col
  const mapID = scene[OFF_MAPSCREEN + mapScreenIdx];
  const got = vec.rd(SCN_TILEMAP + cell);
  const want = scene[OFF_TILEMAP + cell];
  console.log(`  первое расхождение: cell=${cell} row=${row} col=${col} mapID=0x${mapID.toString(16)} got(tile)=0x${got.toString(16)} want(tile)=0x${want.toString(16)}`);
}

// --- Сравнить scn_sprites/scn_nsprites (build_sprites, M2a Task 3) с
// референсом sprites@768/nsprites@848 (v1 SAT, см. scene_extract.js). ---
const wantNsprites = scene[OFF_NSPRITES];
const gotNsprites = vec.rd(SCN_NSPRITES);
let spriteMismatches = 0;
let firstBadSprite = -1;
const N = Math.max(wantNsprites, gotNsprites, 0);
for (let s = 0; s < N; s++) {
  for (let f = 0; f < 5; f++) {
    const off = s * 5 + f;
    const got = s < gotNsprites ? vec.rd(SCN_SPRITES + off) : -1;
    const want = s < wantNsprites ? scene[OFF_SPRITES + off] : -1;
    if (got === want) continue;
    spriteMismatches++;
    if (firstBadSprite < 0) firstBadSprite = s;
  }
}
if (gotNsprites !== wantNsprites) spriteMismatches++;

console.log(`sprites: nsprites got=${gotNsprites} want=${wantNsprites}; байт-несовпадений в spr-полях = ${spriteMismatches}`);
if (spriteMismatches > 0 && firstBadSprite >= 0) {
  const s = firstBadSprite;
  const gotRec = [0, 1, 2, 3, 4].map(f => vec.rd(SCN_SPRITES + s * 5 + f));
  const wantRec = [0, 1, 2, 3, 4].map(f => scene[OFF_SPRITES + s * 5 + f]);
  console.log(`  первое расхождение: sprite[${s}] got={Y,X,FRAME,COLOR,FLAGS}=[${gotRec.map(x => "0x" + x.toString(16)).join(",")}] want=[${wantRec.map(x => "0x" + x.toString(16)).join(",")}]`);
}

console.log(`сценарий=${SCENARIO}`);

if (mismatches > 0 || spriteMismatches > 0) {
  console.log("FAIL");
  process.exit(1);
} else {
  console.log("PASS (0 несовпадений в tilemap[32..735] и sprites)");
  process.exit(0);
}
