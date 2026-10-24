// M3 rollout-F: RENDER-ШЕДУЛЕР (priority+cap+defer) - целевой тест ДЕФЕРРАЛА.
//
// Зачем ОТДЕЛЬНЫЙ скрипт (не расширение twopass_compare.js): twopass_compare.js
// сверяет КАЖДЫЙ кадр с "чистой композицией" (cleanRender ТЕКУЩЕГО снимка,
// т.е. ВСЕ спрайты на ИХ ТЕКУЩЕЙ позиции) - это ВЕРНО для rollout-E (only-moved
// рисует КАЖДЫЙ реально изменившийся спрайт КАЖДЫЙ кадр, никогда не откладывает),
// но НЕВЕРНО для rollout-F шедулера: отложенный спрайт НАМЕРЕННО остаётся на
// ПРОШЛОЙ позиции один-два кадра - сравнение с "чистой композицией текущего
// кадра" ложно провалилось бы на кадре с деферралом, хотя движок работает
// ПРАВИЛЬНО (это и есть весь смысл фичи). Поэтому здесь эталон каждого кадра -
// "СМЕШАННЫЙ" снимок (часть спрайтов на НОВОЙ позиции - те, что шедулер реально
// отрендерил, часть на СТАРОЙ - отложенные), а не "все на новой". Смешанный
// снимок вычисляется ЭТИМ скриптом (мы точно знаем, сколько слотов K и в каком
// порядке ротации - см. driver_vector.asm sch_select), затем рендерится ЧИСТО
// (fullrender=1, свежий экземпляр - НЕЗАВИСИМЫЙ oracle, та же техника, что
// cleanRender в twopass_compare.js) и сверяется БАЙТ-В-БАЙТ с реальным
// (scheduled, персистентный экземпляр) прогоном - см. заголовки сценариев A/B.
//
// Синтетическая (не из v1) сцена: полностью контролируемый фон (tilemap/bgpat
// = НОЛИ - erase детерминированно даёт plane0=0 под спрайтом) + спрайты цвета
// RED (COLOR=6, vec_cmap индекс6=1 -> OR-композиция на ОБЕИХ плоскостях,
// паттерн spr_pat = 0xFF везде) - присутствие спрайта == ненулевые байты в
// его футпринте, отсутствие == нули (фон). X кратен 8 (shift=0 путь - 2
// тайл-колонки, без LUT-неоднозначности), упрощает ручной расчёт overlap
// (не обязателен для верификации - см. заголовок сценария B, но упрощает
// рассуждение при отладке).
//
// Использование:
//   tools/bin/sjasm -s v2/twopass_harness.asm /tmp/v2_twopass_harness.rom /tmp/v2_twopass_harness.sym
//   node tools/verify/scheduler_defer_compare.js
"use strict";
const fs = require("fs");
const REPO = __dirname + "/../..";
const base = "/Users/boris/Projects/vector06js";

function makeVector(romPath) {
  global.document = { createElement: () => fc(), getElementById: () => fc() };
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  const files=["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"];
  const vm=require("vm"); const ctx=vm.createContext({});
  ctx.window = ctx; ctx.document = global.document;
  ctx.requestAnimationFrame=()=>0; ctx.setTimeout=()=>0; ctx.print=()=>0; ctx.console=console;
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

const HARNESS_ROM = "/tmp/v2_twopass_harness.rom";
if (!fs.existsSync(HARNESS_ROM)) {
  console.error(`Не найден ${HARNESS_ROM}. Собрать:\n  tools/bin/sjasm -s v2/twopass_harness.asm /tmp/v2_twopass_harness.rom /tmp/v2_twopass_harness.sym`);
  process.exit(1);
}

const SCN_TILEMAP = 0x4000, SCN_SPRITES = 0x4300, SCN_NSPRITES = 0x4350;
const SCN_PALETTE = 0x4351, SCN_BGPAT = 0x4400, SCN_SPRPAT = 0x5C00;
const SCN_NDIRTY = 0x43D5, SCN_FULLRENDER = 0x43D6;

// --- синтетический фон: НОЛИ везде (erase/blit -> plane0=0, детерминировано) ---
const tilemap = Buffer.alloc(768, 0);
const bgpat = Buffer.alloc(6144, 0);
const palette = Buffer.from([0, 0, 0, 0]);
const sprpat = Buffer.alloc(2048, 0xFF);   // сплошной 16x16 паттерн (левая+правая половины)

function spritesBuf(list) {
  // list: массив [Y,X,FRAME,COLOR,FLAGS], до 16 записей
  const b = Buffer.alloc(80, 0);
  list.forEach((s, i) => { for (let k = 0; k < 5; k++) b[i * 5 + k] = s[k]; });
  return b;
}

function pokeScene(vec, sprites, nsprites) {
  for (let i = 0; i < 768; i++) vec.wr(SCN_TILEMAP + i, tilemap[i]);
  const sb = spritesBuf(sprites);
  for (let i = 0; i < 80; i++) vec.wr(SCN_SPRITES + i, sb[i]);
  vec.wr(SCN_NSPRITES, nsprites);
  for (let i = 0; i < 4; i++) vec.wr(SCN_PALETTE + i, palette[i]);
  for (let i = 0; i < 6144; i++) vec.wr(SCN_BGPAT + i, bgpat[i]);
  for (let i = 0; i < 2048; i++) vec.wr(SCN_SPRPAT + i, sprpat[i]);
}
function runToHalt(vec) {
  vec.cpu.pc = 0x0100;
  for (let n = 0; n < 2_000_000; n++) {
    if (vec.rd(vec.cpu.pc) === 0x76) return true;
    vec.cpu.instruction();
  }
  return false;
}
function readPlanes(vec) {
  const p0 = Buffer.alloc(8192); for (let i = 0; i < 8192; i++) p0[i] = vec.rd(0x8000 + i);
  const p1 = Buffer.alloc(8192); for (let i = 0; i < 8192; i++) p1[i] = vec.rd(0xA000 + i);
  return { p0, p1 };
}
// cleanRender: НЕЗАВИСИМЫЙ oracle - свежий экземпляр, fullrender=1 (старый
// erase-all/draw-all путь, omv_active=0 - ШЕДУЛЕР НЕ УЧАСТВУЕТ) - "что должно
// быть на экране", если СМЕШАННЫЙ (частично старый/частично новый) список
// спрайтов отрендерить целиком с нуля. Та же техника, что twopass_compare.js.
function cleanRender(sprites, nsprites) {
  const vec = makeVector(HARNESS_ROM);
  pokeScene(vec, sprites, nsprites);
  vec.wr(SCN_FULLRENDER, 1); vec.wr(SCN_NDIRTY, 0);
  if (!runToHalt(vec)) throw new Error("cleanRender: не дошёл до halt");
  return readPlanes(vec);
}
function firstDiff(got, want) {
  let count = 0, first = -1;
  for (let i = 0; i < got.length; i++) if (got[i] !== want[i]) { count++; if (first < 0) first = i; }
  return { count, first };
}
function assertMatch(label, actual, expectedSprites, expectedN) {
  const want = cleanRender(expectedSprites, expectedN);
  const m0 = firstDiff(actual.p0, want.p0);
  const m1 = firstDiff(actual.p1, want.p1);
  const ok = m0.count === 0 && m1.count === 0;
  console.log(`  ${label}: план0 ${m0.count === 0 ? "OK" : `MISMATCH ${m0.count}@0x${(0x8000+m0.first).toString(16)}`}, ` +
    `план1 ${m1.count === 0 ? "OK" : `MISMATCH ${m1.count}@0x${(0xA000+m1.first).toString(16)}`}`);
  return ok;
}

let allPass = true;

// ============================================================================
// СЦЕНАРИЙ A: cap+defer+round-robin БЕЗ overlap. K=3 (см. SCH_K в
// driver_vector.asm). 5 спрайтов: hero(idx0,1) + 3 "момии" (idx2,3,4),
// разнесённые по X так, что их 16x16 футпринты (2 тайл-колонки при shift=0)
// НИКОГДА не пересекаются - overlap-machinery не должна вмешиваться, ЧИСТЫЙ
// тест cap/rotation.
// ============================================================================
console.log("=== Сценарий A: cap+defer+round-robin (без overlap) ===");
{
  const S0 = [
    [40, 32, 0, 6, 0],   // hero half A
    [40, 32, 0, 6, 0],   // hero half B (та же позиция, как реальный герой)
    [100, 64, 0, 6, 0],  // "момия" idx2
    [100, 96, 0, 6, 0],  // "момия" idx3
    [100, 128, 0, 6, 0], // "момия" idx4
  ];
  const vec = makeVector(HARNESS_ROM);
  pokeScene(vec, S0, 5);
  vec.wr(SCN_FULLRENDER, 1); vec.wr(SCN_NDIRTY, 0);
  if (!runToHalt(vec)) { console.error("seed: не дошёл до halt"); process.exit(1); }
  console.log("  seed (frame0, fullrender): OK (нет oracle - сам себе эталон)");

  // frame1: герой ДВИЖЕТСЯ (hero_changed=2 -> remaining=K-2=1); ВСЕ 3 момии
  // тоже двигаются (3 кандидата > 1 слот) - ротация (sch_rr_index стартует
  // с 2 на первом активном кадре) выбирает idx2 ПЕРВЫМ -> idx2 рендерится,
  // idx3/idx4 ОТКЛАДЫВАЮТСЯ (остаются на позиции S0).
  const S1 = [
    [48, 40, 0, 6, 0],
    [48, 40, 0, 6, 0],
    [100, 72, 0, 6, 0],   // idx2 движется -> ДОЛЖЕН отрендериться (1й слот ротации)
    [108, 96, 0, 6, 0],   // idx3 движется -> ДОЛЖЕН отложиться
    [100, 136, 0, 6, 0],  // idx4 движется -> ДОЛЖЕН отложиться
  ];
  pokeScene(vec, S1, 5);
  vec.wr(SCN_FULLRENDER, 0); vec.wr(SCN_NDIRTY, 0);
  if (!runToHalt(vec)) { console.error("frame1: не дошёл до halt"); process.exit(1); }
  const f1 = readPlanes(vec);
  // ОЖИДАНИЕ: hero+idx2 на НОВОЙ позиции, idx3/idx4 на СТАРОЙ (S0) позиции.
  const mixed1 = [S1[0], S1[1], S1[2], S0[3], S0[4]];
  const okA1 = assertMatch("frame1 (idx2 рендерится, idx3/idx4 отложены)", f1, mixed1, 5);
  allPass = allPass && okA1;

  // frame2: тот же ЦЕЛЕВОЙ снимок S1 подаётся ПОВТОРНО (герой/idx2 больше не
  // "moved" - совпадают с уже сохранённым spv_prev; idx3/idx4 ВСЁ ЕЩЁ moved
  // против своей СТАРОЙ spv_prev-записи) - hero_changed=0 -> remaining=K=3,
  // оба оставшихся кандидата (idx3,idx4) ПОМЕЩАЮТСЯ -> ОБА рендерятся в этом
  // кадре (полное разрешение отложенности за 1 доп. кадр, << границы (lim-2)=3).
  pokeScene(vec, S1, 5);
  vec.wr(SCN_FULLRENDER, 0); vec.wr(SCN_NDIRTY, 0);
  if (!runToHalt(vec)) { console.error("frame2: не дошёл до halt"); process.exit(1); }
  const f2 = readPlanes(vec);
  const okA2 = assertMatch("frame2 (idx3/idx4 разрешены - итог == чистый рендер S1)", f2, S1, 5);
  allPass = allPass && okA2;
}

// ============================================================================
// СЦЕНАРИЙ B: overlap-promotion. Герой движется (remaining=1), idx2 и idx3
// ОБА кандидаты - idx2 побеждает ротацию (1й слот), idx3 должен был бы
// отложиться, НО idx2's НОВАЯ (draw) позиция ПЕРЕСЕКАЕТ idx3's СТАРУЮ
// (prev, т.к. отложен) позицию по тайлам -> idx3 ДОЛЖЕН быть ПРОМОУТНУТ
// (полностью отрендерен В ЭТОМ ЖЕ кадре, а не отложен) - иначе его пиксели
// были бы затёрты erase/draw idx2 без восстановления (corruption).
// ============================================================================
console.log("\n=== Сценарий B: overlap-promotion (отложенный спрайт под угрозой) ===");
{
  const T0 = [
    [40, 32, 0, 6, 0],
    [40, 32, 0, 6, 0],
    [100, 64, 0, 6, 0],   // idx2 (row0=12 (Y+1=101>>3=12), col0=8 (X=64>>3))
    [100, 96, 0, 6, 0],   // idx3 (col0=12) - ДАЛЕКО от idx2 на T0 (никакого overlap пока)
    [100, 160, 0, 6, 0],  // idx4 - НЕ движется (filler, не кандидат)
  ];
  const vec = makeVector(HARNESS_ROM);
  pokeScene(vec, T0, 5);
  vec.wr(SCN_FULLRENDER, 1); vec.wr(SCN_NDIRTY, 0);
  if (!runToHalt(vec)) { console.error("seed B: не дошёл до halt"); process.exit(1); }

  // idx2 X: 64->88 (col0 8->11, покрывает col11,12 при shift0). idx3 СТАРАЯ
  // (prev, т.к. будет отложен изначально) позиция X=96 -> col0=12, покрывает
  // col12,13. Колонка 12 ОБЩАЯ, Y везде=100 (строки идентичны) -> overlap.
  const T1 = [
    [48, 40, 0, 6, 0],
    [48, 40, 0, 6, 0],
    [100, 88, 0, 6, 0],    // idx2 движется -> побеждает ротацию (1й слот) -> АКТИВЕН
    [100, 104, 0, 6, 0],   // idx3 движется -> изначально ОТКЛАДЫВАЕТСЯ, НО его
                            // СТАРАЯ позиция (X=96) пересекается с idx2's НОВОЙ
                            // (X=88) -> ДОЛЖЕН промоутнуться в ЭТОТ ЖЕ кадр
    [100, 160, 0, 6, 0],   // idx4 не движется - не кандидат вовсе
  ];
  pokeScene(vec, T1, 5);
  vec.wr(SCN_FULLRENDER, 0); vec.wr(SCN_NDIRTY, 0);
  if (!runToHalt(vec)) { console.error("frame1 B: не дошёл до halt"); process.exit(1); }
  const g1 = readPlanes(vec);
  // ОЖИДАНИЕ: hero+idx2 НОВЫЕ (обычное планирование), idx3 ТОЖЕ НОВЫЙ (промоут
  // overlap'ом, НЕ отложен), idx4 не важно (не менялся) - т.е. ВЕСЬ T1 целиком.
  const okB1 = assertMatch("frame1 (idx3 промоутнут overlap'ом - итог == чистый рендер T1)", g1, T1, 5);
  allPass = allPass && okB1;
}

if (allPass) {
  console.log("\nPASS: шедулер (cap+defer+round-robin+overlap-promotion) корректен - " +
    "отложенные спрайты остаются на прошлой позиции БЕЗ порчи, разрешаются в " +
    "пределах нескольких кадров, overlap форсирует промоут без искажений.");
  process.exit(0);
} else {
  console.log("\nFAIL: см. MISMATCH выше - шедулер даёт некорректный композит " +
    "(отложенный спрайт либо не остался на месте, либо не промоутнулся при overlap, " +
    "либо не разрешился со временем)");
  process.exit(1);
}
