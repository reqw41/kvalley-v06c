// snd_rent.js — АРЕНДА КАНАЛА C ПОД ЧАСЫ МУЗЫКИ В РЕЖИМЕ ВИ53 (задача #26).
//
// Зачем: темп музыки задают часы на канале 2 ВИ53 (см. vtm_* в vec_isr.asm). В режиме AY
// все три канала свободны и часы стоят там постоянно. В режиме ВИ53 канал C — голос, но
// занят он вспышками: между нотами молчит. Часы берут его в аренду на простое и отдают
// по первому требованию (vtm_grab), поэтому темп ровный, а голосов по-прежнему ТРИ.
//
// Скрипт доказывает обе половины утверждения:
//   1) часы в режиме ВИ53 реально доступны большую часть времени (vtm_have=1);
//   2) музыка от этого ничего не потеряла — все три канала так же зажигаются (vec_vch),
//      и в канал C так же летят делители нот (порт 0x09 при режиме 3).
// Делители часов от делителей нот отличаем по управляющему слову канала 2: 0xB4 = часы
// (режим 2, rate generator), 0xB6 = голос (режим 3, меандр).
//
// Использование: node tools/verify/snd_rent.js <rom> <sym>
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const rom=process.argv[2],symPath=process.argv[3];
if(!rom||!symPath){console.log("usage: node snd_rent.js <rom> <sym>");process.exit(2);}
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console={log(){},debug(){},warn(){},error(){},info(){}};
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
// soundStep НЕ глушим: он тактует ВИ53, а на нём и живут часы музыки.
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const L={};for(const l of fs.readFileSync(symPath,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
const { sndOvLoad } = require("./snd_ov_load");
const rd=a=>memory.read(a,false);
const GS=L["GameStatus"], VCH=L["vec_vch"], MODE=L["vec_snd_mode"], CHIP=L["vec_snd_chip"], HAVE=L["vtm_have"];
// счётчики записей: каналы A/B и канал C с разделением «часы / голос»
let w={A:0,B:0,Cvoice:0,Cclock:0}, ch2mode=0;
const origOut=io.realoutput.bind(io);
io.realoutput=function(port,val){ const p=port&0xFF;
  if(p===0x0B) w.A++;
  else if(p===0x0A) w.B++;
  else if(p===0x08){ if(val===0xB4) ch2mode=0xB4; else if(val===0xB6) ch2mode=0xB6; }
  else if(p===0x09){ if(ch2mode===0xB6) w.Cvoice++; else w.Cclock++; }
  return origOut(port,val); };
g.event=null;
const ev=c=>({which:c,keyCode:c,preventDefault(){},stopPropagation(){}});
const key=(c,d)=>d?keyboard.keyDown(ev(c)):keyboard.keyUp(ev(c));
const run=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
const press=(c,f=6)=>{key(c,1);run(f);key(c,0);run(2);};
run(400); press(32); run(200); press(32); run(200);
for(let i=0;i<12 && rd(GS)!==5;i++){ press(32); run(150); }
memory.write(CHIP, 1); sndOvLoad(memory, L, img, true); memory.write(MODE, 0);
if(rd(CHIP)!==1){ console.log("не удалось включить чип ВИ53"); process.exit(1); }
let fail=0;
// --- геймплей: 2000 кадров ---
w={A:0,B:0,Cvoice:0,Cclock:0};
let n=0, busy=[0,0,0], have=0;
for(let i=0;i<2000;i++){ run(1); n++;
  for(let c=0;c<3;c++) if(rd(VCH+c)) busy[c]++;
  if(rd(HAVE)) have++; }
console.log(`режим ВИ53, геймплей ${n} кадров:`);
console.log(`  часы доступны в ${(100*have/n).toFixed(1)}% кадров (аренда простоя канала C)`);
console.log(`  канал зажжён: A ${(100*busy[0]/n).toFixed(1)}%, B ${(100*busy[1]/n).toFixed(1)}%, C ${(100*busy[2]/n).toFixed(1)}%`);
console.log(`  записей делителей: A ${w.A}, B ${w.B}, C(голос) ${w.Cvoice}, C(часы) ${w.Cclock}`);
if(have < n*0.5){ console.log("  ОШИБКА: часы в режиме ВИ53 почти недоступны — аренда не работает"); fail++; }
if(!busy[0]||!busy[1]||!busy[2]){ console.log("  ОШИБКА: не все три канала зажигаются"); fail++; }
if(!w.A||!w.B||!w.Cvoice){ console.log("  ОШИБКА: в какой-то канал не приходят делители нот"); fail++; }
// --- тон на C: аренда обязана отдать канал и забрать его обратно ---
const AYR=L["vec_ayregs"];
const SENT=0x0080, SP=0x7F00;
function call_vi(ch){
  const st={pc:cpu.pc,sp:cpu.sp,iff:cpu.iff,r:[0,1,2,3,4,5,7].map(x=>cpu.reg(x)),
            sf:cpu.sf,zf:cpu.zf,hf:cpu.hf,pf:cpu.pf,cf:cpu.cf};
  cpu.iff=false;
  memory.write(SP,SENT&255,false); memory.write(SP+1,SENT>>8,false);
  cpu.sp=SP; cpu.pc=L.vec_vi_ch; cpu.set_a(ch);
  let n=0; while(cpu.pc!==SENT){ cpu.instruction(); io.commit(); if(++n>20000) throw new Error("vec_vi_ch hang"); }
  cpu.pc=st.pc; cpu.sp=st.sp; cpu.iff=st.iff;
  [0,1,2,3,4,5,7].forEach((x,i)=>cpu.set_reg(x,st.r[i]));
  cpu.sf=st.sf;cpu.zf=st.zf;cpu.hf=st.hf;cpu.pf=st.pf;cpu.cf=st.cf;
}
w={A:0,B:0,Cvoice:0,Cclock:0};
memory.write(AYR+7, 0xB8);
memory.write(AYR+10, 12);
memory.write(AYR+4, 0x00);
memory.write(AYR+5, 0x01);
memory.write(VCH+2, 0);
call_vi(2);
console.log(`тон C: канал ${rd(VCH+2)?"включён":"ВЫКЛЮЧЕН"}, часы ${rd(HAVE)?"есть":"отданы"}, делителей C(голос) ${w.Cvoice}, C(часы) ${w.Cclock}`);
if(!rd(VCH+2) || rd(HAVE) || w.Cvoice<2){ console.log("  ОШИБКА: аренда не отдала канал под ноту C"); fail++; }
if(w.Cclock>0){ console.log("  ОШИБКА: часы лезут в канал, отданный ноте"); fail++; }
w={A:0,B:0,Cvoice:0,Cclock:0};
memory.write(AYR+10, 0);
call_vi(2);
console.log(`C смолк: канал ${rd(VCH+2)?"включён":"выключен"}, часы ${rd(HAVE)?"есть":"нет"}`);
if(rd(VCH+2)){ console.log("  ОШИБКА: канал C не погас после ноты"); fail++; }
console.log(fail? `\nИТОГ: ОШИБОК ${fail}` : "\nИТОГ: ОК — часы арендуют простой канала C, три голоса целы");
process.exit(fail?1:0);
