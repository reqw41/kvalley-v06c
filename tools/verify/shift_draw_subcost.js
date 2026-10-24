// Микро-разбивка vec_nsx_col (shift-draw rot{s}_loop) на под-операции — измеряет
// ПРЯМЫМ вызовом vec_nsx_col c контролируемым паттерном/сдвигом/краем (как spr_blit_equiv).
// Изолирует: (1) фикс. накладные петли/строку (пустой паттерн, все rows skip),
//   (2) стоимость непустой строки shift=0 (OR-write, без rotate/mask/spill),
//   (3) непустой строки shift=s (rotate + mask + OR + spill + edge-check),
//   (4) вклад проверки правого края (col31 vs не-край при том же shift).
// Использ.: node tools/verify/shift_draw_subcost.js <rom> <sym>
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function readSym(p){const s={};for(const l of fs.readFileSync(p,"latin1").split("\n")){const g=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(g)s[g[1]]=parseInt(g[2],16);}return s;}
function mkCtx(){const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
  const ctx=vm.createContext(g);
  for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  return ctx;}
function mkMachine(romPath){
  const ctx=mkCtx();
  const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
  const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
  v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
  const img=new Uint8Array(fs.readFileSync(romPath));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
  cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
  return {ctx,cpu,memory,v06c};
}
const RD=(m,a)=>m.memory.read(a,false);
const WR=(m,a,v)=>m.memory.write(a,v,false);
const SENT=0xABCD;
function callCol(m,S,X,patAddr){
  const cpu=m.cpu; const sp=0x6E80;
  WR(m,sp,SENT&0xFF); WR(m,sp+1,(SENT>>8)&0xFF);
  cpu.sp=sp; cpu.pc=S.vec_nsx_col&0xFFFF;
  cpu.regs[4]=(patAddr>>8)&0xFF; cpu.regs[5]=patAddr&0xFF;   // HL=pattern (regs 4=H,5=L)
  cpu.regs[1]=X&0xFF;                                        // C=screen X (regs 1=C)
  cpu.iff=false;
  let cyc=0,steps=0;
  while((cpu.pc&0xFFFF)!==SENT){cpu.instruction();cyc+=cpu.vcycles|0;steps++;if(steps>200000)throw new Error("no ret");}
  return cyc;
}
const R=process.argv[2],Sp=process.argv[3];
const S=readSym(Sp);
const m=mkMachine(R);
const PAT=0x6E00;                       // 16-байт scratch pattern
function setPat(fill){for(let i=0;i<16;i++)WR(m,PAT+i,fill);}
function setPatBytes(arr){for(let i=0;i<16;i++)WR(m,PAT+i,arr[i]||0);}
// pre-set globals read by rot loop
WR(m,S.vw_spry,0x40);                    // Y -> L=255-0x40=0xBF (16 rows fit)
WR(m,S.vnc_pbase,0xE0);                  // p3 plane base
// clear FB region we touch
function clearFB(){for(let c=0;c<34;c++)for(let r=0;r<16;r++)WR(m,((0xE0+c)<<8)|(0xBF-r),0);}

console.log("=== Микро-разбивка vec_nsx_col (shift-draw) ===");
console.log("(16 строк/полустолбец; X даёт col=X>>3, shift=X&7)\n");

// helper: измерить среднее из нескольких прогонов (детерминизм — 1 достаточно)
function meas(X,fill){clearFB();setPat(fill);return callCol(m,S,X,PAT);}
function measBytes(X,arr){clearFB();setPatBytes(arr);return callCol(m,S,X,PAT);}

// 1) ПУСТОЙ паттерн (все 16 строк = 0 -> `or a; jp z next`): фикс. накладные/строку + диспатч
const empty0=meas(0x40,0x00);            // shift=0
const empty3=meas(0x43,0x00);            // shift=3
console.log(`1) ПУСТОЙ паттерн (16 rows skip): shift0=${empty0}т  shift3=${empty3}т`);
console.log(`   -> накладные (dispatch + 16×[read+test+skip-loop]) ≈ ${empty0}т, ~${(empty0/16).toFixed(1)}т/строку холостая`);

// 2) ПОЛНЫЙ паттерн shift=0 (col не край): каждая строка непустая, OR-write, БЕЗ rotate/mask/spill
const full0=meas(0x40,0xFF);
console.log(`\n2) ПОЛНЫЙ shift=0 (col=8, OR-write, без rotate/mask/spill): ${full0}т`);
console.log(`   -> непустая строка shift0 ≈ ${((full0-0)/16).toFixed(1)}т; дельта vs пустой = ${full0-empty0}т (=16×[rlca×0+or(hl)+ld(hl) вместо skip])`);

// 3) ПОЛНЫЙ паттерн shift=3 (col не край, spill есть): rotate×3 + mask + OR + spill-write + edge-check(не взят)
const full3=meas(0x43,0xFF);
console.log(`\n3) ПОЛНЫЙ shift=3 (col=8, rotate3+mask+OR+spill+edge-check): ${full3}т`);
console.log(`   -> непустая строка shift3 ≈ ${(full3/16).toFixed(1)}т; дельта vs shift0 = ${full3-full0}т за 16 строк = ${((full3-full0)/16).toFixed(1)}т/строку (rotate+mask+spill+edgecheck)`);

// 4) ПОЛНЫЙ shift=3 у ПРАВОГО КРАЯ (col=31): edge-check ВЗЯТ -> spill НЕ пишется
const full3edge=meas(0xFB,0xFF);         // X=0xFB -> col=31, shift=3
console.log(`\n4) ПОЛНЫЙ shift=3 у ПРАВОГО КРАЯ (col=31, edge-check ВЗЯТ, spill skip): ${full3edge}т`);
console.log(`   -> экономия от НЕ-записи spill (край): ${full3-full3edge}т за 16 строк = ${((full3-full3edge)/16).toFixed(1)}т/строку`);

// 5) shift 1..7 полный паттерн — стоимость rotate растёт с s (rrca×s или rlca×(8-s))
console.log(`\n5) ПОЛНЫЙ паттерн, зависимость от shift (col=8, не край):`);
for(let s=0;s<8;s++){const t=meas(0x40+s,0xFF);console.log(`   shift=${s}: ${t}т  (${(t/16).toFixed(1)}т/строку)`);}

// 6) реалистичная плотность: спрайт-паттерн НЕ полностью заполнен. Замерим с типичной
//    плотностью (半 непустых). Берём чередование.
const halfArr=[0xFF,0,0xFF,0,0xFF,0,0xFF,0,0xFF,0,0xFF,0,0xFF,0,0xFF,0];
const half3=measBytes(0x43,halfArr);
console.log(`\n6) 8/16 непустых строк shift=3: ${half3}т (пустые строки дешевле — реальный спрайт между full3 и empty3)`);
