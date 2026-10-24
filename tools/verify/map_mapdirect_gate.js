// MAPDIRECT gate: доказывает, что фикс полосы карты (KV_NO_MAPDIRECT off по умолчанию)
//  (2) очищает видимую p2 pat-shadow (0xC900-0xD100) на экране карты (pergamino), и
//  (3) НЕ меняет саму картинку карты (плоскости p0/p1/p3 байт-в-байт как каноническая сборка).
// Путь к карте — как в stripe_transition_probe: дойти до геймплея (GS=5), poke GS=8
// (stageClear) -> игра сама показывает pergamino (setupPergamino) -> дамп плоскостей.
// Использование: node map_mapdirect_gate.js <baseRom> <baseSym> <fixRom> <fixSym>
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
function mk(romPath){
  const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
  const ctx=vm.createContext(g);
  for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
  const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
  v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
  const img=new Uint8Array(fs.readFileSync(romPath));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
  cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
  return {v06c,keyboard,rd:a=>memory.bytes[memory.tobank(a)],wr:(a,v)=>memory.write(a,v)};
}
function loadSym(p){const S={};for(const l of fs.readFileSync(p,"latin1").split("\n")){const m=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(m)S[m[1]]=parseInt(m[2],16);}return S;}
function dumpMap(romPath,symPath){
  const M=mk(romPath),S=loadSym(symPath),GS=S.GameStatus,SUB=S.subStatus,FPM=S.flagPiramideMap;
  for(let f=0;f<400;f++)M.v06c.oneInterrupt(true);
  let reached=false;
  for(let blk=0;blk<50&&!reached;blk++){
    for(let f=0;f<25;f++){M.keyboard.keyDown({keyCode:32,preventDefault(){}});M.v06c.oneInterrupt(true);if(M.rd(GS)===5&&(M.rd(FPM)&1)){reached=true;break;}}
    M.keyboard.keyUp({keyCode:32,preventDefault(){}});
    for(let f=0;f<5;f++){M.v06c.oneInterrupt(true);if(M.rd(GS)===5&&(M.rd(FPM)&1)){reached=true;break;}}
  }
  M.wr(GS,8);M.wr(SUB,0);
  let atMap=-1;
  for(let f=0;f<200;f++){M.v06c.oneInterrupt(true);if(M.rd(GS)===4&&M.rd(SUB)===1){if(atMap<0)atMap=f;if(f>=atMap+8)break;}}
  const p=Buffer.alloc(4*8192);for(let pl=0;pl<4;pl++){const b=0x8000+pl*0x2000;for(let i=0;i<8192;i++)p[pl*8192+i]=M.rd(b+i);}
  return {planes:p,reached};
}
const B=dumpMap(process.argv[2],process.argv[3]),O=dumpMap(process.argv[4],process.argv[5]);
const per=[0,0,0,0];for(let i=0;i<B.planes.length;i++)if(B.planes[i]!==O.planes[i])per[(i/8192)|0]++;
const p2shBase=[...Array(0x800)].reduce((a,_,i)=>a+(B.planes[2*8192+0x900+i]?1:0),0);
const p2shFix =[...Array(0x800)].reduce((a,_,i)=>a+(O.planes[2*8192+0x900+i]?1:0),0);
console.log(`reached base=${B.reached} fix=${O.reached}`);
console.log(`p2 pat-shadow (0xC900-0xD100) nonzero: base=${p2shBase}  fix=${p2shFix}   [GATE2: fix==0]`);
console.log(`map-frame plane diffs base-vs-fix: p0=${per[0]} p1=${per[1]} p2=${per[2]} p3=${per[3]}   [GATE3: p0/p1/p3==0]`);
const ok2=p2shFix===0, ok3=(per[0]===0&&per[1]===0&&per[3]===0);
console.log(ok2&&ok3?"✅ MAPDIRECT GATE PASS (p2 карты пуста; картинка p0/p1/p3 идентична канону)":"❌ FAIL");
process.exit(ok2&&ok3?0:1);
