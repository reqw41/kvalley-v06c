// ГЕЙТ 2 (Фаза 2): БАЙТ-ЭКВИВАЛЕНТНОСТЬ спрайт-блита base vs POPSPR + чистый (без
// траекторного шума) замер тактов vec_nsx_clear. Инжектирует спрайт в известную позицию,
// заливает p2/p3 одинаково на обеих ROM, зовёт блит НАПРЯМУЮ (клир и клир+рисование),
// сравнивает footprint плоскостей p2(0xC000-0xDFFF)+p3(0xE000-0xFFFF) = 0 расхождений.
// Инварианты: vec_spr_buf копируется base->popspr (идентичные паттерны), одинаковая пред-
// заливка FB, одинаковая запись [Y,X,pat,col]. Проверяет X&7=0..7, оба плана, герой+мумия,
// зеркало и прямой, правый край.
// Использ.: node tools/verify/spr_blit_equiv.js <base.rom> <base.sym> <popspr.rom> <popspr.sym>
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
  return {ctx,cpu,memory,keyboard,v06c};
}
function key(m,dn,c){const e={keyCode:c,preventDefault(){}};dn?m.keyboard.keyDown(e):m.keyboard.keyUp(e);}
function toGameplay(m){
  for(let f=0;f<420;f++)m.v06c.oneInterrupt(true);
  for(let f=0;f<900;f++){key(m,true,32);m.v06c.oneInterrupt(true);key(m,false,32);}
  for(let f=0;f<400;f++){key(m,true,37);m.v06c.oneInterrupt(true);key(m,false,37);}
}
const RD=(m,a)=>m.memory.read(a,false);
const WR=(m,a,v)=>m.memory.write(a,v,false);
const SENT=0xABCD;
function callRoutine(m,addr,H,L){
  const cpu=m.cpu;
  // sentinel-based return
  const sp=0x6E00;
  WR(m,sp,SENT&0xFF); WR(m,sp+1,(SENT>>8)&0xFF);
  cpu.sp=sp; cpu.pc=addr&0xFFFF;
  cpu.regs[4]=H&0xFF; cpu.regs[5]=L&0xFF;   // HL
  cpu.iff=false;
  let cyc=0,steps=0;
  while((cpu.pc&0xFFFF)!==SENT){
    cpu.instruction(); cyc+=cpu.vcycles|0; steps++;
    if(steps>500000){throw new Error("routine did not return @"+addr.toString(16));}
  }
  return cyc;
}
// footprint снимок: p2+p3 полностью (0xC000-0xFFFF) через CPU-семантику чтения
function snapPlanes(m){const a=new Uint8Array(0x4000);for(let i=0;i<0x4000;i++)a[i]=RD(m,0xC000+i);return a;}
function fillPlanes(m,val){for(let i=0;i<0x4000;i++)WR(m,0xC000+i,val);}
function diffPlanes(a,b){let n=0,first=-1;for(let i=0;i<0x4000;i++)if(a[i]!==b[i]){n++;if(first<0)first=0xC000+i;}return {n,first};}

const bR=process.argv[2],bS=process.argv[3],pR=process.argv[4],pS=process.argv[5];
const SB=readSym(bS), SP=readSym(pS);
console.log("=== ГЕЙТ 2: байт-эквивалентность спрайт-блита (base vs POPSPR) ===");
const mb=mkMachine(bR), mp=mkMachine(pR);
toGameplay(mb); toGameplay(mp);
// критично: копируем vec_spr_buf base->popspr => идентичные паттерны для draw-теста
const SBUF=SB.vec_spr_buf, SBUF2=SP.vec_spr_buf;
for(let i=0;i<768;i++){ WR(mp,SBUF2+i, RD(mb,SBUF+i)); }
console.log("vec_spr_buf синхронизирован (768Б) base->popspr");

const REC=0x0060; // scratch для [Y,X,pat,col]
function setup(m,S,Y,X,pat,col,pbase,fill){
  fillPlanes(m,fill);
  WR(m,REC,Y);WR(m,REC+1,X);WR(m,REC+2,pat);WR(m,REC+3,col);
  WR(m,S.vnc_pbase,pbase);
}
// Тест-матрица
const cases=[];
for(let s=0;s<8;s++) for(const Y of [0x30,0x50]) for(const pb of [0xC0,0xE0])
  cases.push({name:`clear X&7=${s} Y=${Y.toString(16)} p${pb===0xC0?2:3}`,Y,X:0x40+s,pat:0x88,col:pb===0xC0?8:0,pbase:pb,mode:"clear"});
cases.push({name:"clear right-edge X=0xF8 p3",Y:0x40,X:0xF8,pat:0x88,col:0,pbase:0xE0,mode:"clear"});
cases.push({name:"clear right-edge X=0xFA p2",Y:0x40,X:0xFA,pat:0x88,col:8,pbase:0xC0,mode:"clear"});
// erase+draw (герой mirror, мумия mirror, дверь non-mirror), оба плана, разные сдвиги
for(const [pat,tag] of [[0x60,"hero"],[0x88,"momia"],[0xDC,"door-direct"]])
  for(const s of [0,3,5,7]) for(const pb of [0xC0,0xE0])
    cases.push({name:`erase+draw ${tag} X&7=${s} p${pb===0xC0?2:3}`,Y:0x48,X:0x50+s,pat,col:pb===0xC0?8:0,pbase:pb,mode:"ed"});

let fails=0, clearCycB=0, clearCycP=0, clearN=0;
for(const c of cases){
  // base
  setup(mb,SB,c.Y,c.X,c.pat,c.col,c.pbase, c.mode==="clear"?0xFF:0x00);
  let cb;
  if(c.mode==="clear"){ cb=callRoutine(mb,SB.vec_nsx_clear,0x00,REC); }
  else { callRoutine(mb,SB.vec_nsx_clear,0x00,REC); callRoutine(mb,SB.vec_nsx,0x00,REC); }
  const snB=snapPlanes(mb);
  // popspr
  setup(mp,SP,c.Y,c.X,c.pat,c.col,c.pbase, c.mode==="clear"?0xFF:0x00);
  let cp;
  if(c.mode==="clear"){ cp=callRoutine(mp,SP.vec_nsx_clear,0x00,REC); }
  else { callRoutine(mp,SP.vec_nsx_clear,0x00,REC); callRoutine(mp,SP.vec_nsx,0x00,REC); }
  const snP=snapPlanes(mp);
  const d=diffPlanes(snB,snP);
  const ok=d.n===0;
  if(!ok)fails++;
  let extra="";
  if(c.mode==="clear"){ clearCycB+=cb;clearCycP+=cp;clearN++; extra=`  такты clear: base ${cb} -> popspr ${cp} (${cp-cb>0?'+':''}${cp-cb})`; }
  console.log(`${ok?'OK ':'FAIL'} ${c.name.padEnd(34)} diff=${d.n}${d.first>=0?' @0x'+d.first.toString(16):''}${extra}`);
}
console.log(`\nИТОГ: ${cases.length} кейсов, расхождений байт: ${fails} кейсов`);
if(clearN)console.log(`clear такты (сумма ${clearN} кейсов): base ${clearCycB} -> popspr ${clearCycP} = -${clearCycB-clearCycP}т (${(100*(clearCycB-clearCycP)/clearCycB).toFixed(1)}% быстрее), на кейс ${(clearCycB/clearN).toFixed(0)}->${(clearCycP/clearN).toFixed(0)}`);
console.log(fails===0 ? "\nГЕЙТ 2 ПРОЙДЕН: блит POPSPR байт-идентичен base на всех кейсах." : "\nГЕЙТ 2 ПРОВАЛЕН");
process.exit(fails===0?0:1);
