// tools/verify/r2_sprite_stability_check.js — after startup, confirm planes 0,1
// (bg) stay byte-for-byte STABLE across frames while planes 2,3 (sprites)
// CHANGE (hero/momia motion, gem blink). Raster-accurate (oneInterrupt).
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
  return { cpu, memory, io, frame: () => v06c.oneInterrupt(true) };
}

function snap(memory, lo, hi) {
  const a = Buffer.alloc(hi - lo + 1);
  for (let i = lo; i <= hi; i++) a[i - lo] = memory.bytes[memory.tobank(i)];
  return a;
}

const romPath = process.argv[2] || "/tmp/r2_game.rom";
const SETTLE = parseInt(process.argv[3] || "35", 10); // Task 9: bg.asm откатан на
  // цикл (экономия кода) - render_bg2 (once-at-init) теперь settle'ится
  // ~frame33 (было ~frame20) - порог поднят с запасом (см. отчёт).
const vec = makeVector(romPath);

// прогнать init + несколько кадров игрового цикла (ei/halt каждый кадр,
// hero/momia двигаются симуляцией KeyHold=0 - momias всё равно шевелятся AI).
const N = SETTLE + 60;
let prevBg = null, prevSpr = null;
let bgStableFrames = 0, sprChangedFrames = 0;
let prevSprCount = null, maxJump = 0, altCount = 0;
for (let f = 0; f < N; f++) {
  vec.frame();
  const bg = snap(vec.memory, 0x8000, 0xBFFF);
  const spr = snap(vec.memory, 0xC000, 0xFFFF);
  let sprNZ = 0;
  for (const b of spr) if (b !== 0) sprNZ++;
  if (prevBg) {
    const bgSame = bg.equals(prevBg);
    const sprSame = spr.equals(prevSpr);
    if (f > SETTLE) { // после старта игрового цикла (см. r2_startup_trace)
      if (bgSame) bgStableFrames++;
      if (!sprSame) sprChangedFrames++;
      if (prevSprCount !== null) {
        const d = Math.abs(sprNZ - prevSprCount);
        if (d > maxJump) maxJump = d;
        if (d > 20) altCount++; // Task 9: alternation defect signature (erase/draw
                                 // spanning 2 frames -> big NZ-count swing every frame)
      }
    }
  }
  prevBg = bg; prevSpr = spr; prevSprCount = sprNZ;
}
const checked = N - SETTLE - 1;
console.log(`после старта (>frame${SETTLE}): bg(планы0,1) стабилен ${bgStableFrames}/${checked} кадров, sprites(планы2,3) изменились в ${sprChangedFrames}/${checked} кадрах, макс. скачок NZ-байт=${maxJump}, "alternation"-скачков(>20Б)=${altCount}/${checked}`);
console.log((bgStableFrames > checked * 0.8 && sprChangedFrames > 0 && altCount === 0) ? "PASS (bg flicker-free, sprites живые, БЕЗ alternation)" : "FAIL");
