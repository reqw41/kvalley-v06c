// Стенд «Вектор-06Ц + Z80» для разбора ЧУЖОГО порта King's Valley (И.Городецкий, 2008).
// Машина берётся из vector06js (память, ВВ55/порты, PixelFiller), процессор — Z80_v06.js
// вместо i8080. Наш проект не трогается: только чтение чужого ROM.
//
// Модель тактов (важно для сравнения с нашей метрикой луча):
//   у i8080 в vector06js «vcycles» = длина команды с учётом cpu_ready: каждый машинный
//   цикл добивается до кратного 4. Z80-ядро даёт только суммарные T-такты, поэтому
//   считаем: vcycles = 4*(число шинных М-циклов) + 4*ceil(остаток_внутренних_тактов/4).
//   Проверка модели на i8080-эквивалентах: NOP 4, LD A,(HL) 8, INC HL 8, PUSH 16 — совпало.
//   Есть и «оптимистичная» оценка raw = чистые T-такты (без ожиданий адаптера).
"use strict";
const fs = require("fs"), vm = require("vm"), zlib = require("zlib");
const base = "/Users/boris/Projects/vector06js";
const Z80 = require(base + "/Z80_v06.js");

function make(romPath, opt) {
  opt = opt || {};
  const g = {}; g.window = g;
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  g.document={createElement:()=>fc(),getElementById:()=>fc()};
  g.requestAnimationFrame=()=>0; g.setTimeout=()=>0; g.print=()=>0;
  g.console={log(){},debug(){},warn(){},error(){},info(){}};
  const ctx = vm.createContext(g);
  for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js",
                   "src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js",
                   "src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
    vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"), ctx, {filename:f});

  const memory=new ctx.Memory(), keyboard=new ctx.Keyboard(), timer=new ctx.I8253(),
        ay=new ctx.AY(), floppy=new(ctx.Floppy().FD1793)(),
        io=new ctx.IO(keyboard,timer,memory,ay,floppy);

  // --- счётчики обращений к шине для модели ожиданий ---
  let busM=0, memAcc=0, ioAcc=0;
  const trace = { onWrite:null };            // onWrite(addr, val)
  const zcore = {
    mem_read(a){ busM++; memAcc++; return memory.read(a&0xffff,false)&0xff; },
    mem_write(a,v){ busM++; memAcc++; a&=0xffff; v&=0xff;
                    if(trace.onWrite) trace.onWrite(a,v);
                    memory.write(a,v,false); },
    io_read(p){ busM++; ioAcc++; return io.input(p&0xff)&0xff; },
    io_write(p,v){ busM++; ioAcc++; io.output(p&0xff,v&0xff); },
  };
  const z80 = new Z80(zcore);

  // адаптер под интерфейс, который ждёт Vector06c: instruction(), vcycles, last_opcode, iff, pc, sp
  const cpu = {
    vcycles: 4, last_opcode: 0, rawT: 0,
    get pc(){ return z80.getState().pc; },
    set pc(v){ const s=z80.getState(); s.pc=v&0xffff; z80.setState(s); },
    get sp(){ return z80.getState().sp; },
    set sp(v){ const s=z80.getState(); s.sp=v&0xffff; z80.setState(s); },
    get iff(){ return !!z80.getState().iff1; },
    set iff(v){ const s=z80.getState(); s.iff1=v?1:0; s.iff2=v?1:0; z80.setState(s); },
    z80,
    instruction(){
      const st = z80.getState();
      const pc0 = st.pc;
      const op0 = memory.read(pc0,false)&0xff;
      let nM1 = 1;
      if (op0===0xCB||op0===0xED||op0===0xDD||op0===0xFD) nM1 = 2;
      this.last_opcode = op0;
      busM=0; memAcc=0; ioAcc=0;
      const t = z80.run_instruction();
      this.rawT = t;
      const baseline = 4*nM1 + 3*Math.max(0,memAcc-nM1) + 4*ioAcc;
      const leftover = Math.max(0, t - baseline);
      this.vcycles = 4*busM + 4*Math.ceil(leftover/4);
      if (this.vcycles < 4) this.vcycles = 4;   // halt: run_instruction вернул 1
      return this.vcycles;
    },
  };

  const v06c = new ctx.Vector06c(cpu, memory, io, ay, {advance:()=>{},sample:0,reset:()=>{}});
  const W=576,H=288;
  v06c.bmp=new Uint32Array(W*H); v06c.displayFrame=()=>{}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
  // Прерывание Вектора: на Z80 в IM0 на шине 0xFF => RST 38h; в IM1 тоже 0x0038.
  v06c.checkInterrupt = function(){
    if (this.irq && cpu.iff){
      this.irq = false;
      z80.interrupt(false, 0xFF);
      this.instr_time += 16;
    }
  };

  const img = new Uint8Array(fs.readFileSync(romPath));
  memory.init_from_array(img.subarray(0,0x10000), opt.load===undefined?0x100:opt.load);
  memory.detach_boot && memory.detach_boot();
  cpu.pc = opt.start===undefined?0x100:opt.start; cpu.sp=0xc300; cpu.iff=false;

  const rd = a => memory.bytes[memory.tobank(a&0xffff)];
  const key = (c,d) => { const e={which:c,keyCode:c,preventDefault(){},stopPropagation(){}};
                         d?keyboard.keyDown(e):keyboard.keyUp(e); };
  const run = n => { for(let i=0;i<n;i++) v06c.oneInterrupt(true); };
  const FRAME = 59904;
  // Такт от запроса IRQ (raster_line=0, raster_pixel=176)
  function cyc(){ const f=v06c.filler; if(!f) return 0;
    let p=(f.raster_line*768+f.raster_pixel)-176; if(p<0)p+=312*768; return (p/4)|0; }

  const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
  function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
  function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
  function pngFrom(u32,out){const rgb=Buffer.alloc(W*H*3);
    for(let i=0;i<W*H;i++){const c=u32[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
    const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
    const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
    fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));}
  const png = out => pngFrom(v06c.bmp,out);

  return {ctx,memory,keyboard,cpu,z80,v06c,io,rd,key,run,cyc,png,pngFrom,trace,FRAME,W,H};
}
module.exports = {make};
