// ПРОТОТИП/ПРОВЕРКА "compiled sprites" (M3 recon-задача — см.
// .superpowers/sdd/m3-compiled-recon-report.md, координаторская правка:
// колоночно-ориентированный PUSH-стрим для solid-строк + RMW с запечённой
// маской для mixed-строк — техника Rockman16/OldTower, докс:
// docs/reference/OLDTOWER_ANALYSIS.md §8).
//
// Задача: для НЕСКОЛЬКИХ РЕАЛЬНЫХ спрайтов King's Valley (взятых из живых
// снапшотов /tmp/v1_scene_{1,2,3}.bin — те же, что использует
// driver_pixelcompare.js/render_profile.js) сгенерировать (tools/verify/
// gen_compiled_sprite.js) компилированный i8080-блиттер и:
//   1) сравнить его выход С ТЕКУЩИМ v2/driver_vector.asm draw_sprites БАЙТ-
//      В-БАЙТ (план0 0x8000-0x9FFF + план1 0xA000-0xBFFF ПОЛНОСТЬЮ, не
//      только затронутое окно — эталон честности).
//   2) замерить РЕАЛЬНЫЕ такты компилированного вызова (headless vector06js,
//      тот же метод инструментации PC/cycles, что render_profile.js).
//   3) сверить замер с предсказанием генератора (стата stats.cycles).
//
// Тест-кейсы (см. §"ТЕСТ-КЕЙСЫ" ниже):
//   real1  — живой спрайт героя, shift=1, white (ХУДШИЙ случай: обе плоскости,
//            OR+AND-NOT, сосед-спилл) — сцена 1, спрайт 0.
//   real2  — живой спрайт (момия?), shift=7, red — сцена 2, спрайт 3.
//   solidBlock — СИНТЕТИЧЕСКИЙ instance (X/Y/COLOR придуманы), но ПАТТЕРН —
//            РЕАЛЬНЫЙ (блок 57 из ТОГО ЖЕ живого снапшота scn_sprpat сцены 1 —
//            сплошной 8x16 прямоугольник, НЕ встретился ни у одного живого
//            спрайта в 3 снятых сценах, см. отчёт §"честно про solid-строки") —
//            нужен, чтобы ВООБЩЕ увидеть PUSH-solid-путь на реальных байтах
//            паттерна (вероятно, объект типа "блок/сокровище", не в кадре
//            захвата).
//
// Использование: node tools/verify/compiled_sprite_prove.js
"use strict";
const fs = require("fs");
const { execFileSync } = require("child_process");
const { genCompiledSprite } = require("./gen_compiled_sprite.js");

const REPO = __dirname + "/../..";
const VEC_BASE = "/Users/boris/Projects/vector06js";
const DRIVER_ASM = REPO + "/v2/driver_vector.asm";
const SCENE_INC = REPO + "/v2/scene.inc";

function readScenePlanes(scen) {
  const b = fs.readFileSync(`/tmp/v1_scene_${scen}.bin`);
  const OFF_PLANE0 = 6997, OFF_PLANE1 = 15189, OFF_SPRPAT = 23381;
  return {
    plane0: b.subarray(OFF_PLANE0, OFF_PLANE0 + 8192),
    plane1: b.subarray(OFF_PLANE1, OFF_PLANE1 + 8192),
    sprpat: b.subarray(OFF_SPRPAT, OFF_SPRPAT + 2048),
  };
}
function extractSprite(scen, idx) {
  const b = fs.readFileSync(`/tmp/v1_scene_${scen}.bin`);
  const OFF_SPRITES = 768, OFF_SPRPAT = 23381;
  const o = OFF_SPRITES + idx * 5;
  const Y = b[o], X = b[o + 1], FRAME = b[o + 2], COLOR = b[o + 3];
  const base = OFF_SPRPAT + (FRAME & 0xfc) * 8;
  const pat = [...b.subarray(base, base + 32)];
  return { Y, X, FRAME, COLOR, pat, scen };
}

const CMAP = [0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 2, 2, 0, 1, 0, 0];
const COLOR_NAME = { 0: "white", 1: "red", 2: "ochre" };

// ======================================================================
// ТЕСТ-КЕЙСЫ
// ======================================================================
const real1 = extractSprite(1, 0);           // Y=151 X=177 shift=1 FRAME=112 COLOR=14(white)
const real2 = extractSprite(2, 3);           // Y=47  X=103 shift=7 FRAME=144 COLOR=8(red)
// solidBlock: РЕАЛЬНЫЙ паттерн (блок 57 сцены1 sprpat, найден сканом всех 3
// сцен x всех 64 блоков x всех 8 shift — САМЫЙ длинный solid-пробег, см. отчёт),
// X/Y/COLOR — синтетические (придуманы для теста, объект не был "жив" в
// захваченных 3 сценах).
const scene1Sprpat = readScenePlanes(1).sprpat;
const solidBlk = 57, solidFrame = solidBlk * 4;
const solidPat = [...scene1Sprpat.subarray(solidBlk * 32, solidBlk * 32 + 32)];
const solidBlock = { Y: 100, X: 96, FRAME: solidFrame, COLOR: 14, pat: solidPat, scen: 1 };

const CASES = [
  { name: "real1_white_shift1", spr: real1 },
  { name: "real2_red_shift7", spr: real2 },
  { name: "solidBlock_white_shift0_SYNTH", spr: solidBlock },
];

for (const c of CASES) {
  c.shift = c.spr.X & 7;
  c.colorMode = COLOR_NAME[CMAP[c.spr.COLOR & 0xf]];
  c.label = "csp_" + c.name.replace(/[^A-Za-z0-9_]/g, "_");
}

console.log("=== Тест-кейсы ===");
for (const c of CASES) {
  console.log(`${c.name}: scen=${c.spr.scen} Y=${c.spr.Y} X=${c.spr.X} shift=${c.shift} FRAME=${c.spr.FRAME} COLOR=${c.spr.COLOR} mode=${c.colorMode}`);
}

// ======================================================================
// Генерация компилированных routine'ов + сбор статистики
// ======================================================================
for (const c of CASES) {
  const gen = genCompiledSprite({ label: c.label, pattern32: c.spr.pat, shift: c.shift, color: c.colorMode });
  c.gen = gen;
}

// ======================================================================
// Сборка объединённого харнесса: scene.inc + driver_vector.asm (эталон,
// draw_sprites) + сгенерированные routine'ы + entry-заглушки (по 2 на кейс:
// ref_entry_N зовёт РЕАЛЬНЫЙ draw_sprites(nsprites=1), compiled_entry_N
// зовёт СГЕНЕРИРОВАННЫЙ routine с HL, вычисленным ТЕМ ЖЕ способом, что
// spr_col в driver_vector.asm: H=0A0h+((X>>3)&1Fh), L=~(Y+1)).
// ======================================================================
function entryHL(X, Y) {
  const vwspry = (Y + 1) & 0xff;
  const L = (~vwspry) & 0xff;
  const H = (0xa0 + ((X >> 3) & 0x1f)) & 0xff;
  return (H << 8) | L;
}

const asmLines = [];
asmLines.push("; --- АВТОГЕНЕРИРОВАНО tools/verify/compiled_sprite_prove.js — НЕ РЕДАКТИРОВАТЬ ---");
asmLines.push("        org     0100h");
asmLines.push(`        include "${SCENE_INC}"`);
asmLines.push("harness_boot:");
asmLines.push("        di");
asmLines.push("        ld      sp, 0FF00h");
asmLines.push("        halt");
for (const c of CASES) {
  const hl = entryHL(c.spr.X, c.spr.Y);
  asmLines.push(`; --- кейс ${c.name} ---`);
  asmLines.push(`ref_entry_${c.label}:`);
  asmLines.push("        di");
  asmLines.push("        ld      sp, 0FF00h");
  asmLines.push(`        ld      a, ${c.spr.Y}`);
  asmLines.push("        ld      (scn_sprites+0), a");
  asmLines.push(`        ld      a, ${c.spr.X}`);
  asmLines.push("        ld      (scn_sprites+1), a");
  asmLines.push(`        ld      a, ${c.spr.FRAME}`);
  asmLines.push("        ld      (scn_sprites+2), a");
  asmLines.push(`        ld      a, ${c.spr.COLOR}`);
  asmLines.push("        ld      (scn_sprites+3), a");
  asmLines.push("        xor     a");
  asmLines.push("        ld      (scn_sprites+4), a");
  asmLines.push("        ld      a, 1");
  asmLines.push("        ld      (scn_nsprites), a");
  asmLines.push("        call    draw_sprites");
  asmLines.push("        halt");
  asmLines.push(`compiled_entry_${c.label}:`);
  asmLines.push("        di");
  asmLines.push("        ld      sp, 0FF00h");
  asmLines.push(`        ld      hl, ${hl}`);
  asmLines.push(`        call    ${c.label}`);
  asmLines.push("        halt");
  asmLines.push(...c.gen.lines);
}
asmLines.push(`        include "${DRIVER_ASM}"`);

const ASM_PATH = "/tmp/compiled_sprite_prove.asm";
const ROM_PATH = "/tmp/compiled_sprite_prove.rom";
const LST_PATH = "/tmp/compiled_sprite_prove.lst";
const SYM_PATH = "/tmp/compiled_sprite_prove.sym";
fs.writeFileSync(ASM_PATH, asmLines.join("\n") + "\n");

console.log("\n=== Сборка харнесса (sjasm) ===");
execFileSync(REPO + "/tools/bin/sjasm", ["-s", ASM_PATH, ROM_PATH, LST_PATH], { stdio: "inherit" });

console.log("\n=== i8080-чистота (check_i8080.js) ===");
execFileSync("node", [REPO + "/tools/verify/check_i8080.js", LST_PATH], { stdio: "inherit" });

// ======================================================================
// Headless vector06js — копия makeVector из render_profile.js/driver_pixelcompare.js
// ======================================================================
function makeVector(romPath) {
  // ВАЖНО: НЕ переиспользовать реальный node `global` как sandbox (в отличие
  // от render_profile.js/driver_pixelcompare.js, которые создают машину ОДИН
  // РАЗ за процесс) — этому скрипту нужно НЕСКОЛЬКО независимых машин за один
  // прогон (reference vs compiled x N кейсов), а vm.createContext(global)
  // повторно на ТОМ ЖЕ объекте роняет "Identifier 'X' already declared" на
  // top-level const/let при повторном runInContext тех же файлов. Свежий
  // пустой sandbox-объект на каждый вызов - независимые контексты.
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.document = { createElement: () => fc(), getElementById: () => fc() };
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  sandbox.requestAnimationFrame=()=>0; sandbox.setTimeout=()=>0; sandbox.print=()=>0;
  sandbox.console = { debug: () => {}, log: () => {}, error: () => {}, warn: () => {} };
  const files=["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"];
  const vm=require("vm"); const ctx=vm.createContext(sandbox);
  for(const f of files) vm.runInContext(fs.readFileSync(VEC_BASE+"/"+f,"utf8"),ctx,{filename:f});
  const {Memory,IO,AY,I8253,Keyboard,I8080,Floppy}=ctx;
  const memory=new Memory(),keyboard=new Keyboard(),timer=new I8253(),ay=new AY();
  const floppy=new(Floppy().FD1793)(); const io=new IO(keyboard,timer,memory,ay,floppy);
  io.Palette=new Array(16).fill(0);
  const cpu=new I8080(memory,io);
  const img=new Uint8Array(fs.readFileSync(romPath));
  memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
  cpu.pc=0; cpu.sp=0xFF00; cpu.iff=false;
  const rd=(a)=>memory.bytes[memory.tobank(a)];
  const wr=(a,v)=>{ memory.bytes[memory.tobank(a)]=v & 0xff; };
  return { cpu, rd, wr };
}

function readSym(p) {
  const m = {};
  for (const l of fs.readFileSync(p, "latin1").split("\n")) {
    const g = l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);
    if (g) m[g[1]] = parseInt(g[2], 16);
  }
  return m;
}
const sym = readSym(SYM_PATH);

function runUntilHalt(vec, maxInstr) {
  let cycles = 0, n = 0;
  for (; n < maxInstr; n++) {
    if (vec.rd(vec.cpu.pc) === 0x76) break;
    cycles += vec.cpu.instruction();
  }
  if (vec.rd(vec.cpu.pc) !== 0x76) throw new Error("не дошли до halt за " + maxInstr + " инструкций");
  return { cycles, instrCount: n };
}

// ======================================================================
// Прогон каждого кейса: reference vs compiled, сравнение планов ПОЛНОСТЬЮ
// ======================================================================
console.log("\n=== Пиксель-компар + такты (reference draw_sprites vs compiled) ===");
let allPass = true;
const results = [];
for (const c of CASES) {
  const planes = readScenePlanes(c.spr.scen);

  // --- pass A: reference ---
  const vecA = makeVector(ROM_PATH);
  for (let i = 0; i < 8192; i++) { vecA.wr(0x8000 + i, planes.plane0[i]); vecA.wr(0xA000 + i, planes.plane1[i]); }
  for (let i = 0; i < 2048; i++) vecA.wr(0x5C00 + i, planes.sprpat[i]);
  vecA.cpu.pc = sym["ref_entry_" + c.label];
  const refRun = runUntilHalt(vecA, 2_000_000);
  const p0A = Buffer.alloc(8192), p1A = Buffer.alloc(8192);
  for (let i = 0; i < 8192; i++) { p0A[i] = vecA.rd(0x8000 + i); p1A[i] = vecA.rd(0xA000 + i); }

  // --- pass B: compiled ---
  const vecB = makeVector(ROM_PATH);
  for (let i = 0; i < 8192; i++) { vecB.wr(0x8000 + i, planes.plane0[i]); vecB.wr(0xA000 + i, planes.plane1[i]); }
  for (let i = 0; i < 2048; i++) vecB.wr(0x5C00 + i, planes.sprpat[i]);
  vecB.cpu.pc = sym["compiled_entry_" + c.label];
  const { cycles, instrCount } = runUntilHalt(vecB, 2_000_000);
  const p0B = Buffer.alloc(8192), p1B = Buffer.alloc(8192);
  for (let i = 0; i < 8192; i++) { p0B[i] = vecB.rd(0x8000 + i); p1B[i] = vecB.rd(0xA000 + i); }

  let diff0 = 0, diff1 = 0;
  for (let i = 0; i < 8192; i++) { if (p0A[i] !== p0B[i]) diff0++; if (p1A[i] !== p1B[i]) diff1++; }
  const pass = diff0 === 0 && diff1 === 0;
  allPass = allPass && pass;

  const st = c.gen.stats;
  const touched = st.totalTouchedBytes;
  // stub-обвязка ref_entry_* ПРЕДСКАЗУЕМА (di+ld sp,nn+ 4x(ld a,n/ld (nn),a)
  // +(xor a/ld (nn),a)+(ld a,1/ld (nn),a)+call) = 148T ТОЧНО (см. комментарий
  // в отчёте) — вычитаем, чтобы получить ЧИСТУЮ стоимость draw_sprites(1
  // спрайт) для ЭТОГО же instance (честное old vs new).
  const REF_STUB_CYCLES = 148;
  const refPureCycles = refRun.cycles - REF_STUB_CYCLES;
  const cycPerByte = touched ? (st.cycles / touched) : NaN;
  const speedup = refPureCycles / st.cycles;
  console.log(`\n--- ${c.name} ---`);
  console.log(`план0: ${diff0}/8192 расхожд., план1: ${diff1}/8192 расхожд. -> ${pass ? "PASS" : "FAIL"}`);
  console.log(`байт-классификация: transparent=${st.transparent} solid=${st.solid} mixed=${st.mixed} (touched=${touched})`);
  console.log(`push-пар=${st.pushPairs} solid-одиночных=${st.solidSingleTouches} rmw-касаний=${st.rmwTouches}`);
  console.log(`compiled: ИЗМЕРЕНО(с harness-стабом)=${cycles} (${instrCount} инстр.) ПРЕДСКАЗАНО(генератор,чистый routine)=${st.cycles} ${(cycles - 41) === st.cycles ? "(harness-стаб=41T, СОВПАДАЕТ)" : "(РАСХОЖДЕНИЕ!)"}`);
  console.log(`current draw_sprites (этот же instance, 1 спрайт): ИЗМЕРЕНО(всего)=${refRun.cycles} (${refRun.instrCount} инстр.), минус предсказ. stub(148T) = ЧИСТЫЙ=${refPureCycles}`);
  console.log(`cyc/byte compiled (по touched=${touched}) = ${cycPerByte.toFixed(2)}   |   УСКОРЕНИЕ compiled vs current (этот instance) = ${speedup.toFixed(2)}x`);
  results.push({ name: c.name, pass, diff0, diff1, compiledCyclesRaw: cycles, compiledCyclesPure: st.cycles, refCyclesRaw: refRun.cycles, refCyclesPure: refPureCycles, touched, speedup, stats: st });
}

console.log(`\n=== ИТОГ: ${allPass ? "ВСЕ PASS" : "ЕСТЬ FAIL"} ===`);
fs.writeFileSync("/tmp/compiled_sprite_prove_results.json", JSON.stringify(results, null, 2));
console.log("(результаты сохранены в /tmp/compiled_sprite_prove_results.json)");
if (!allPass) process.exit(1);
