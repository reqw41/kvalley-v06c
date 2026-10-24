// tools/verify/r2_startup_trace.js — raster-accurate startup trace for v2/r2
// demo_game.rom: per-frame (oneInterrupt) log of io.Palette non-zero count,
// planes 0,1 non-zero byte count, and PC. Used to verify the "black screen
// during DI init" diagnosis AND to measure before/after startup-frame count.
"use strict";
const fs = require("fs");
const base = "/Users/boris/Projects/vector06js";

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

function countNonZero(memory, lo, hi) {
  let n = 0;
  for (let a = lo; a <= hi; a++) if (memory.bytes[memory.tobank(a)] !== 0) n++;
  return n;
}

const romPath = process.argv[2] || "/tmp/r2_game.rom";
const maxFrames = parseInt(process.argv[3] || "90", 10);
const vec = makeVector(romPath);

console.log(`frame\tpalNZ\tplanes01NZ\tpc`);
let firstPalNZFrame = -1, firstStableFrame = -1, lastPlanes01 = -1, stableRun = 0;
for (let f = 0; f < maxFrames; f++) {
  vec.frame();
  const palNZ = vec.io.Palette.filter(v => v !== 0).length;
  const p01 = countNonZero(vec.memory, 0x8000, 0xBFFF);
  const pc = vec.cpu.pc;
  console.log(`${f}\t${palNZ}\t${p01}\t0x${pc.toString(16)}`);
  if (palNZ > 0 && firstPalNZFrame < 0) firstPalNZFrame = f;
  if (p01 === lastPlanes01) stableRun++; else stableRun = 0;
  lastPlanes01 = p01;
  if (palNZ > 0 && stableRun >= 2 && firstStableFrame < 0) firstStableFrame = f;
}
console.log(`\n--- summary ---`);
console.log(`first frame palette non-zero: ${firstPalNZFrame}`);
console.log(`first frame planes0,1 stable (bg fully drawn) AND palette on: ${firstStableFrame}`);
