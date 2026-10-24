// ПРОФИЛЬ ТАКТОВ render_frame (Task 6, Milestone 1, King's Valley engine v2).
// Задача: прогнать тот же нативный i8080-харнесс (v2/test_harness.asm ->
// /tmp/v2_harness.rom), что и driver_pixelcompare.js, но вместо сравнения
// байт планов — посчитать суммарные T-такты (vcycles) исполнения ОТ входа в
// render_frame (публичный шов: set_palette + render_bg + draw_sprites) ДО
// halt, и вывести это число + процент от бюджета кадра 50Гц (59904 такта).
//
// ВАЖНО: сцена в /tmp/v1_scene.bin — ПОЛНЫЙ блит всех 768 клеток фона (нет
// dirty-фильтрации), плюс отрисовка всех активных спрайтов кадра. Это ВЕРХНЯЯ
// ГРАНИЦА стоимости рендера: в боевом движке (Milestone 2+) фон будет
// dirty-only (только изменённые клетки), поэтому реальная стоимость кадра
// будет заметно меньше данного числа.
//
// Использование: node tools/verify/driver_profile.js
// Вход: /tmp/v2_harness.rom (собрать: tools/bin/sjasm v2/test_harness.asm /tmp/v2_harness.rom)
//       /tmp/v1_scene.bin   (собрать: node tools/verify/scene_extract.js)
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

const HARNESS_ROM = "/tmp/v2_harness.rom";
const SCENE_BIN = "/tmp/v1_scene.bin";

if (!fs.existsSync(HARNESS_ROM)) {
  console.error(`Не найден ${HARNESS_ROM}. Собрать: tools/bin/sjasm v2/test_harness.asm ${HARNESS_ROM}`);
  process.exit(1);
}
if (!fs.existsSync(SCENE_BIN)) {
  console.error(`Не найден ${SCENE_BIN}. Собрать: node tools/verify/scene_extract.js`);
  process.exit(1);
}

const vec = makeVector(HARNESS_ROM);
const scene = fs.readFileSync(SCENE_BIN);

// --- Формат снапшота (см. tools/verify/scene_extract.js), verbatim из driver_pixelcompare.js ---
const OFF_TILEMAP = 0, LEN_TILEMAP = 768;
const OFF_SPRITES = 768, LEN_SPRITES = 80;
const OFF_NSPRITES = 848, LEN_NSPRITES = 1;
const OFF_PALETTE = 849, LEN_PALETTE = 4;
const OFF_BGPAT = 853, LEN_BGPAT = 6144;
const OFF_SPRPAT = 23381, LEN_SPRPAT = 2048;

const SCN_TILEMAP = 0x4000, SCN_SPRITES = 0x4300, SCN_NSPRITES = 0x4350;
const SCN_PALETTE = 0x4351, SCN_BGPAT = 0x4400, SCN_SPRPAT = 0x5C00;

for (let i = 0; i < LEN_TILEMAP; i++) vec.wr(SCN_TILEMAP + i, scene[OFF_TILEMAP + i]);
for (let i = 0; i < LEN_SPRITES; i++) vec.wr(SCN_SPRITES + i, scene[OFF_SPRITES + i]);
for (let i = 0; i < LEN_NSPRITES; i++) vec.wr(SCN_NSPRITES + i, scene[OFF_NSPRITES + i]);
for (let i = 0; i < LEN_PALETTE; i++) vec.wr(SCN_PALETTE + i, scene[OFF_PALETTE + i]);
for (let i = 0; i < LEN_BGPAT; i++) vec.wr(SCN_BGPAT + i, scene[OFF_BGPAT + i]);
for (let i = 0; i < LEN_SPRPAT; i++) vec.wr(SCN_SPRPAT + i, scene[OFF_SPRPAT + i]);

// --- Адреса из v2/test_harness.lst (пересобрать при изменении харнесса) ---
// 0104: call render_frame ; 0107: halt ; 0153: render_frame:
const RENDER_FRAME_ADDR = 0x0153;
const HALT_ADDR = 0x0107;

const MAX_INSTR = 2_000_000;
let executed = 0;
let counting = false;
let totalCycles = 0;
let instrInRender = 0;
let haltHit = false;

for (; executed < MAX_INSTR; executed++) {
  const pc = vec.cpu.pc;
  if (pc === HALT_ADDR) { haltHit = true; break; }
  if (pc === RENDER_FRAME_ADDR) counting = true;
  const cycles = vec.cpu.instruction();
  if (counting) {
    totalCycles += cycles;
    instrInRender++;
  }
}

if (!haltHit) {
  console.error(`НЕ ДОШЁЛ до halt за ${MAX_INSTR} инструкций (pc=0x${vec.cpu.pc.toString(16)})`);
  process.exit(1);
}
if (!counting || totalCycles === 0) {
  console.error(`НЕ ЗАФИКСИРОВАН вход в render_frame (0x${RENDER_FRAME_ADDR.toString(16)}) до halt`);
  process.exit(1);
}

const FRAME_BUDGET = 59904; // 50Гц кадр, Вектор-06Ц (см. docs/JOURNAL.md)
const pct = (totalCycles / FRAME_BUDGET) * 100;

console.log(`render_frame: ${instrInRender} инструкций, ${totalCycles} тактов`);
console.log(`бюджет кадра 50Гц = ${FRAME_BUDGET} тактов -> render_frame = ${pct.toFixed(1)}%`);
console.log(`ПРИМЕЧАНИЕ: сцена = ПОЛНЫЙ блит всех 768 клеток фона (верхняя граница);` +
            ` в реальном движке фон dirty-only, реальная стоимость кадра будет меньше.`);
