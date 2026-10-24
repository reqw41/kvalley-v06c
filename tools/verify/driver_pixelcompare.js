// ПИКСЕЛЬ-КОМПАР v2 РЕНДЕР-ДРАЙВЕРА (Task 4+5, Milestone 1, King's Valley engine v2).
// Задача: прогнать нативный i8080-харнесс (v2/test_harness.asm -> /tmp/v2_harness.rom)
// в headless vector06js, ПЕРЕД запуском CPU положить в память сцену из
// /tmp/v1_scene.bin (снятую с живого v1 движка, tools/verify/scene_extract.js),
// исполнить харнесс до halt (render_bg отрисовывает план0 из
// scn_tilemap/scn_bgpat, draw_sprites дорисовывает план0/план1 мультицветными
// спрайтами по scn_sprites/scn_sprpat), затем сравнить ОБА плана
// (0x8000-0x9FFF и 0xA000-0xBFFF) с эталоном из того же снапшота.
//
// Использование: node tools/verify/driver_pixelcompare.js [сценарий]
//   сценарий (1/2/3, по умолч. 1) выбирает /tmp/v1_scene_<сценарий>.bin —
//   см. tools/verify/scene_extract.js (Task 7: три РАЗНЫЕ сцены, чтобы
//   исключить случайное совпадение одной сцены).
// Вход: /tmp/v2_harness.rom      (собрать: tools/bin/sjasm v2/test_harness.asm /tmp/v2_harness.rom)
//       /tmp/v1_scene_<n>.bin    (собрать: node tools/verify/scene_extract.js <n>, см. заголовок файла)
"use strict";
const fs = require("fs");
const base = "/Users/boris/Projects/vector06js";

// --- Vector headless (vector06js), скопировано verbatim из lockstep_kv.js/scene_extract.js ---
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
const HARNESS_ROM = "/tmp/v2_harness.rom";
const SCENE_BIN = `/tmp/v1_scene_${SCENARIO}.bin`;

if (!fs.existsSync(HARNESS_ROM)) {
  console.error(`Не найден ${HARNESS_ROM}. Собрать: tools/bin/sjasm v2/test_harness.asm ${HARNESS_ROM}`);
  process.exit(1);
}
if (!fs.existsSync(SCENE_BIN)) {
  console.error(`Не найден ${SCENE_BIN}. Собрать: node tools/verify/scene_extract.js ${SCENARIO}`);
  process.exit(1);
}

const vec = makeVector(HARNESS_ROM);
const scene = fs.readFileSync(SCENE_BIN);

// --- Формат снапшота (см. tools/verify/scene_extract.js) ---
const OFF_TILEMAP = 0, LEN_TILEMAP = 768;
const OFF_SPRITES = 768, LEN_SPRITES = 80;
const OFF_NSPRITES = 848, LEN_NSPRITES = 1;
const OFF_PALETTE = 849, LEN_PALETTE = 4;
const OFF_BGPAT = 853, LEN_BGPAT = 6144;
const OFF_PLANE0 = 6997, LEN_PLANE0 = 8192;
const OFF_PLANE1 = 15189, LEN_PLANE1 = 8192;
const OFF_SPRPAT = 23381, LEN_SPRPAT = 2048;

// >= а не === : с M2a Task 1 scene_extract.js дописывает после существующего
// блока ещё блок ВХОДА (MapaRAM+актёры), сдвигая длину файла, но не офсеты
// внутри уже существующего (эталонного) блока — их и проверяем.
if (scene.length < OFF_SPRPAT + LEN_SPRPAT) {
  console.error(`Неожиданный размер ${SCENE_BIN}: ${scene.length} (ожидалось >= ${OFF_SPRPAT + LEN_SPRPAT})`);
  process.exit(1);
}

// --- Положить сцену в RAM ДО запуска CPU ---
// SCN_SPRPAT = 0x5C00 (НЕ 0x4C00 из первоначального брифа Task 5: тот адрес
// попадает внутрь диапазона scn_bgpat 0x4400-0x5BFF и затирает банк1 фоновых
// паттернов - см. v2/scene.inc). Кладём сразу после bgpat.
const SCN_TILEMAP = 0x4000, SCN_SPRITES = 0x4300, SCN_NSPRITES = 0x4350;
const SCN_PALETTE = 0x4351, SCN_BGPAT = 0x4400, SCN_SPRPAT = 0x5C00;

for (let i = 0; i < LEN_TILEMAP; i++) vec.wr(SCN_TILEMAP + i, scene[OFF_TILEMAP + i]);
for (let i = 0; i < LEN_SPRITES; i++) vec.wr(SCN_SPRITES + i, scene[OFF_SPRITES + i]);
for (let i = 0; i < LEN_NSPRITES; i++) vec.wr(SCN_NSPRITES + i, scene[OFF_NSPRITES + i]);
for (let i = 0; i < LEN_PALETTE; i++) vec.wr(SCN_PALETTE + i, scene[OFF_PALETTE + i]);
for (let i = 0; i < LEN_BGPAT; i++) vec.wr(SCN_BGPAT + i, scene[OFF_BGPAT + i]);
for (let i = 0; i < LEN_SPRPAT; i++) vec.wr(SCN_SPRPAT + i, scene[OFF_SPRPAT + i]);

// --- Прогнать CPU до halt (opcode 0x76 в точке PC) с лимитом инструкций ---
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

const nsprites = scene[OFF_NSPRITES];

// --- Task 5: сравнить ОБА плана целиком (спрайты теперь рисуются нативно,
// исключений клеток под спрайтами больше нет - ждём 0 несовпадений). ---
// Адрес A=hi*256+i: col=hi-0x80(план0)/hi-0xA0(план1), L=A&0xFF=i&0xFF,
// y=255-L (см. blit_bg_cell/spr_col: dec l по строкам). row=y>>3.
function comparePlane(name, base, off) {
  let mismatches = 0;
  let first = -1;
  for (let i = 0; i < 8192; i++) {
    const got = vec.rd(base + i);
    const want = scene[off + i];
    if (got === want) continue;
    mismatches++;
    if (first < 0) first = i;
  }
  console.log(`${name} (0x${base.toString(16)}-0x${(base+8191).toString(16)}): несовпавших байт = ${mismatches} / 8192`);
  if (mismatches > 0) {
    const i = first;
    const col = i >> 8;
    const L = i & 0xFF;
    const y = 255 - L;
    const row = (y >= 0 && y <= 191) ? (y >> 3) : -1;
    console.log(`  первое расхождение: offset=${i} (0x${(base+i).toString(16)}) row=${row} col=${col} got=0x${vec.rd(base+i).toString(16)} want=0x${scene[off+i].toString(16)}`);
  }
  return mismatches;
}

const mism0 = comparePlane("план0", 0x8000, OFF_PLANE0);
const mism1 = comparePlane("план1", 0xA000, OFF_PLANE1);
console.log(`сценарий=${SCENARIO} nsprites=${nsprites}`);

if (mism0 > 0 || mism1 > 0) {
  console.log("FAIL");
  process.exit(1);
} else {
  console.log("PASS (0 несовпадений в обоих планах)");
  process.exit(0);
}
