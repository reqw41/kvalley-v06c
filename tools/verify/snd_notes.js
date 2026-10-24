// Как часто в режиме ВИ53 обновляются ДЕЛИТЕЛИ каналов (ноты) — в геймплее и в скролле.
// Если в скролле реже, ноты «залипают», и это слышно как подтормаживание, даже когда
// темп плеера ровный.
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console={log(){},debug(){},warn(){},error(){},info(){}};
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=function(){ if(cpu.pc===0x4629) psd++; else if(cpu.pc===L.updateSound) us++; else if(cpu.pc===L.WRTPSG) wrt++; return false; };v06c.dbg=null;
const img=new Uint8Array(fs.readFileSync(process.argv[2]));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const L={};for(const l of fs.readFileSync(process.argv[3],"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
const { sndOvLoad } = require("./snd_ov_load");
const rd=a=>memory.read(a,false), wr=(a,v)=>memory.write(a,v,false);
let notes=0, ctrl=0, psd=0, us=0, wrt=0;
const origOut=io.realoutput.bind(io);
io.realoutput=function(port,val){ const p=port&0xFF;
  if(p===0x09||p===0x0A||p===0x0B) notes++;
  else if(p===0x08) ctrl++;
  return origOut(port,val); };
g.event=null;
const ev=c=>({which:c,keyCode:c,preventDefault(){},stopPropagation(){}});
const key=(c,d)=>d?keyboard.keyDown(ev(c)):keyboard.keyUp(ev(c));
const run=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
const press=(c,f=6)=>{key(c,1);run(f);key(c,0);run(4);};
run(400); press(32); run(200); press(32); run(300);
for(let i=0;i<12 && rd(L.GameStatus)!==5;i++){ press(32); run(150); }
wr(L.vec_snd_chip, 1); wr(L.vec_snd_mode, 0);
sndOvLoad(memory, L, img, true);
console.log(`чип=${rd(L.vec_snd_chip)} (1 = ВИ53), слушание=${rd(L.vec_snd_mode)}, часы: ${rd(L.vtm_have)?"есть":"нет"}`);
{const snapAy=()=>Array.from({length:14},(_,i)=>rd(L.vec_ayregs+i)).join(",");
let prevAy=snapAy(), ch=0; notes=0; ctrl=0;
for(let i=0;i<200;i++){ run(1); const n=snapAy(); if(n!==prevAy){ch++; prevAy=n;} }
console.log(`   зеркало AY менялось ${ch} раз за 200 кадров геймплея`);}
console.log(`геймплей 200 кадров: записей делителей ${notes} (${(notes/200).toFixed(2)}/кадр), ctrl-слов ${ctrl}`);
console.log(`   MusicChanData[0..7]=${Array.from({length:8},(_,i)=>rd(L.MusicChanData+i)).join(",")} z80_ix=${(rd(L.z80_ix)|(rd(L.z80_ix+1)<<8)).toString(16)}`);
console.log(`   каналы плеера до скролла: ch1=${rd(L.musicCh1)} ch2=${rd(L.musicCh1+1)} ch3=${rd(L.musicCh1+2)}, mixer=${rd(L.mixerValuePSG)}`);
// ждём момент, когда музыка ТОЧНО играет: зеркало AY должно меняться
{const snap=()=>Array.from({length:14},(_,i)=>rd(L.vec_ayregs+i)).join(",");
 let ok=false;
 for(let tries=0;tries<40 && !ok;tries++){ let p0=snap(), ch=0;
   for(let i=0;i<20;i++){ run(1); const n=snap(); if(n!==p0){ch++; p0=n;} }
   if(ch>=5) ok=true; }
 console.log(`   музыка играет перед скроллом: ${ok?"да":"НЕТ (не дождались)"}`);}
wr(L.waitCounter,0x20); wr(L.flagScrolling,1); wr(L.sentidoProta,2); wr(L.GameStatus,9);
notes=0; ctrl=0;
// заодно смотрим, меняется ли ЗЕРКАЛО AY-регистров (то, что играет плеер)
const snapAy=()=>Array.from({length:14},(_,i)=>rd(L.vec_ayregs+i)).join(",");
let prevAy=snapAy(), ayChanges=0;
us=0; psd=0; wrt=0;
let f=0; while(rd(L.GameStatus)===9 && f<400){ run(1); f++; const n=snapAy(); if(n!==prevAy){ayChanges++; prevAy=n;} 
  if(f===40) console.log(`   в середине скролла: MusicChanData[0..7]=${Array.from({length:8},(_,i)=>rd(L.MusicChanData+i)).join(",")}, tickInProgress=${rd(L.tickInProgress)}`); }
console.log(`   зеркало AY менялось ${ayChanges} раз за скролл; updateSound ${us}, processSndData ${psd}, WRTPSG ${wrt}`);
console.log(`скролл ${f} кадров: записей делителей ${notes} (${(notes/f).toFixed(2)}/кадр), ctrl-слов ${ctrl}`);
