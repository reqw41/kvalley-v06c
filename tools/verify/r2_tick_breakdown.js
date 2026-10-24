// tools/verify/r2_tick_breakdown.js — raster-accurate (oneInterrupt) per-routine
// cycle attribution for ONE loop-tick of v2/r2/demo_game.asm. Stack-latch method
// (same as render2_perf_profile.js): each tracked routine's entry pushes its own
// return address on the real Z80/8080 stack; we watch cpu.pc for that routine's
// entry address, latch the return address, and attribute every subsequent
// instruction's cycles to that routine's bucket until pc returns to the latched
// address (nested calls fall inside the OUTER routine's bucket unless they are
// themselves tracked, in which case they get their own bucket and the outer
// resumes after). Used to find the REAL cost breakdown of one whole-game tick
// (build_sprites2/render_frame2/risky-fix/input/AI/hero/knife/gems/glue).
"use strict";
const fs = require("fs");
const base = "/Users/boris/Projects/vector06js";

function readSym(p) {
  const m = {};
  for (const l of fs.readFileSync(p, "latin1").split("\n")) {
    const g = l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);
    if (g) m[g[1]] = parseInt(g[2], 16);
  }
  return m;
}

function makeVector(romPath) {
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  const files=["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"];
  const vm=require("vm"); const ctx=vm.createContext({});
  ctx.window = ctx;
  ctx.document = { createElement: () => fc(), getElementById: () => fc() };
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
  return { cpu, memory, io, rd, frame: () => v06c.oneInterrupt(true) };
}

function driveTick(vec, maxCalls) {
  for (let n = 0; n < (maxCalls || 60); n++) {
    vec.frame();
    if (vec.rd(vec.cpu.pc) === 0x76) return n + 1;
  }
  throw new Error(`driveTick(): CPU did not reach halt in ${maxCalls || 60} calls`);
}

const romPath = process.argv[2] || "/tmp/r2_game.rom";
const symPath = process.argv[3] || "/tmp/r2_game.sym";
const N_TICKS = parseInt(process.argv[4] || "60", 10);
const sym = readSym(symPath);

const NAMES = ["loop", "build_sprites2", "render_frame2", "r2_pre_render", "r2_post_render",
  "bs2_risky_patch", "bs2_risky_restore", "input_read", "ai_momias", "hero_tick",
  "knife_tick", "knife_chk_coge", "gem_collect_tick", "program_palette2"];
for (const n of NAMES) if (sym[n] === undefined) { console.error(`missing symbol: ${n}`); process.exit(1); }

const vec = makeVector(romPath);
driveTick(vec, 300); // settle init

// stack-latch: a small stack of {name, retAddr, accumSelf} for nested tracked calls.
const bucketAddr = new Map(NAMES.map(n => [sym[n], n]));
const cyc = Object.fromEntries(NAMES.map(n => [n, 0]));
const calls = Object.fromEntries(NAMES.map(n => [n, 0]));
let stack = []; // {name, ret}
const HALT_PC = -1; // unused

vec.cpu.instruction = (function(orig) {
  return function() {
    const pc = vec.cpu.pc;
    const nm = bucketAddr.get(pc);
    if (nm && nm !== "loop") {
      // entering a tracked routine: the return address is on top of the real stack
      const sp = vec.cpu.sp;
      const ret = vec.memory.bytes[vec.memory.tobank(sp)] | (vec.memory.bytes[vec.memory.tobank((sp+1)&0xffff)] << 8);
      stack.push({ name: nm, ret });
      calls[nm]++;
    }
    const c = orig.call(vec.cpu);
    // attribute to innermost active tracked routine (top of stack), else "loop"/untracked
    const top = stack.length ? stack[stack.length - 1].name : "loop";
    cyc[top] += c;
    if (stack.length && vec.cpu.pc === stack[stack.length - 1].ret) stack.pop();
    return c;
  };
})(vec.cpu.instruction.bind(vec.cpu));

const totals = [];
for (let t = 0; t < N_TICKS; t++) {
  for (const n of NAMES) cyc[n] = 0;
  driveTick(vec, 40);
  totals.push(Object.assign({}, cyc));
}

const sum = Object.fromEntries(NAMES.map(n => [n, 0]));
const max = Object.fromEntries(NAMES.map(n => [n, 0]));
for (const t of totals) for (const n of NAMES) { sum[n] += t[n]; if (t[n] > max[n]) max[n] = t[n]; }
const wholeTick = totals.map(t => NAMES.reduce((a, n) => a + t[n], 0));
console.log(`ticks measured=${N_TICKS}`);
console.log(`whole-tick avg=${(wholeTick.reduce((a,b)=>a+b,0)/N_TICKS).toFixed(1)} max=${Math.max(...wholeTick)}`);
console.log("--- per-routine (own-cycles, nested calls attributed to innermost tracked caller) ---");
for (const n of NAMES) {
  console.log(`${n.padEnd(20)} avg=${(sum[n]/N_TICKS).toFixed(1).padStart(9)}  max=${String(max[n]).padStart(7)}  calls/tick(last)=${calls[n]}`);
}
