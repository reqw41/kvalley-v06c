// M3 rollout-B: измеряет РЕАЛЬНЫЕ i8080 такты (headless vector06js, тот же
// CPU-движок, что render_profile.js) для current-style HL-indirect fused RMW
// (or (hl)/and (hl), как в spc_wrm_white/red/ochre) против stack-based
// POP/PUSH RMW для MASKED (маска меняется побайтно) касания - т.е. именно
// того сценария, что просит m3-rollout-b-brief.md ("mixed"-байты маскированного
// спрайта, НЕ solid-пробеги - те уже проверены в recon/rollout-A).
//
// См. tools/verify/rmw_stack_bench.asm (сам микро-бенчмарк) и
// .superpowers/sdd/m3-rollout-b-report.md (полный разбор вывода).
//
// Использование: node tools/verify/rmw_stack_bench.js
"use strict";
const fs = require("fs");
const { execFileSync } = require("child_process");
const REPO = __dirname + "/../..";
const base = "/Users/boris/Projects/vector06js";

// ВАЖНО: источник берём через __dirname напрямую (НЕ через REPO+"/tools/verify/..",
// который даёт "задвоенный" путь tools/verify/../../tools/verify/... - на нём
// sjasm -s почему-то НЕ создаёт .sym рядом с исходником, видимо наивная строковая
// манипуляция путём внутри sjasm путается на повторных ".." - см. m3-rollout-b-report.md).
const ASM = __dirname + "/rmw_stack_bench.asm";
const ROM = "/tmp/rmw_stack_bench.rom";
const LST = "/tmp/rmw_stack_bench.lst";
const SYM = __dirname + "/rmw_stack_bench.sym"; // sjasm -s кладёт РЯДОМ с исходником

console.log("=== Сборка микро-бенчмарка (sjasm) ===");
execFileSync(REPO + "/tools/bin/sjasm", ["-s", ASM, ROM, LST], { cwd: REPO, stdio: "inherit" });

console.log("\n=== i8080-чистота (check_i8080.js) ===");
execFileSync("node", [REPO + "/tools/verify/check_i8080.js", LST], { stdio: "inherit" });

function readSym(p) {
  const m = {};
  for (const l of fs.readFileSync(p, "latin1").split("\n")) {
    const g = l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);
    if (g) m[g[1]] = parseInt(g[2], 16);
  }
  return m;
}

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
  cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
  const rd=(a)=>memory.bytes[memory.tobank(a)];
  return { cpu, memory, io, rd };
}

const sym = readSym(SYM);
const vec = makeVector(ROM);

const names = ["A", "B", "C", "D", "E"];
const cyc = { A: 0, B: 0, C: 0, D: 0, E: 0 };
const active = { A: false, B: false, C: false, D: false, E: false };
const vOrig = vec.cpu.instruction.bind(vec.cpu);
vec.cpu.instruction = function () {
  const pc = vec.cpu.pc;
  for (const n of names) {
    if (pc === sym["method" + n + "_start"]) active[n] = true;
    if (pc === sym["method" + n + "_end"]) active[n] = false;
  }
  const c = vOrig();
  for (const n of names) if (active[n]) cyc[n] += c;
  return c;
};

let guard = 0;
while (vec.rd(vec.cpu.pc) !== 0x76) {
  vec.cpu.instruction();
  if (++guard > 100000) { console.error("FAIL: never reached halt"); process.exit(1); }
}

console.log("\n=== Результат (16 байт на метод) ===");
console.log(`A current-style (HL-indirect fused OR, ORA M 7T; маска через LDA 13T): ${cyc.A} T => ${(cyc.A/16).toFixed(2)} T/байт`);
console.log(`B stack-RMW paired POP/PUSH (маска через LDA+mov-shuffle, т.к. ALU только через A): ${cyc.B} T => ${(cyc.B/16).toFixed(2)} T/байт   ratio B/A=${(cyc.B/cyc.A).toFixed(3)}`);
console.log(`C positive-control: solid fill current-style (ld (hl),lit): ${cyc.C} T => ${(cyc.C/16).toFixed(2)} T/байт`);
console.log(`D positive-control: solid-run PUSH (константная пара, БЕЗ маски): ${cyc.D} T => ${(cyc.D/16).toFixed(2)} T/байт   ratio D/C=${(cyc.D/cyc.C).toFixed(3)} (ожидается <1 - подтверждает, что харнесс НЕ смещён против стек-техники в принципе, совпадает с recon 5.5T/байт)`);
console.log(`E stack-RMW paired + ПОЛНАЯ di/save-SP/restore-SP/ei церемония (реалистичный роллаут): ${cyc.E} T => ${(cyc.E/16).toFixed(2)} T/байт   ratio E/A=${(cyc.E/cyc.A).toFixed(3)}`);

console.log("\n=== Вывод ===");
if (cyc.B <= cyc.A * 0.95) {
  console.log("B БЫСТРЕЕ A (>=5%) - stack-RMW для mixed-байт можно рассматривать для роллаута.");
} else {
  console.log("B НЕ быстрее A (parity/regression) - stack-RMW для mixed-байт НЕ выгоден на этом i8080-коде");
  console.log("(причина: ORA M/ANA M уже fusят read+compute за 7T; POP/PUSH не может это побить без mov-shuffle через A, который стоит больше сэкономленного).");
}
