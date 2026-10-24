// snd_source.js — ВЫБОР СЛУШАНИЯ (клавиша S) и запись в выбранный чип.
//
// Драйвер шлёт ноты в один из двух источников: реальный AY (порты 0x15 регистр / 0x14
// данные) или ВИ53 (0x08 управление, 0x09/0x0A/0x0B счётчики каналов C/B/A). Чип выбирает
// бут. Клавиша S гоняет слушание: музыка+SFX -> только SFX -> тишина. Скрипт считает
// записи в порты каждого источника в каждом режиме — в активном источнике они должны
// быть, в остальных ноль. Шум AY на ВИ53 не повторяем: кирка патчится в тона на буте.
//
// Использование: node tools/verify/snd_source.js <rom> <sym>
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const rom=process.argv[2],symPath=process.argv[3];
if(!rom||!symPath){console.log("usage: node snd_source.js <rom> <sym>");process.exit(2);}
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console={log(){},debug(){},warn(){},error(){},info(){}};
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=function(step){this.timerwrapper.step(step/2);};  // ВИ53 обязан тактоваться: на нём часы музыки
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const L={};for(const l of fs.readFileSync(symPath,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
const rd=a=>memory.read(a,false);
// считаем записи в порты источников
let cnt={ay:0, vi:0}, viC=[];
// ВАЖНО: в режиме AY канал 2 ВИ53 (порт 0x09) занят ЧАСАМИ музыки, и в него постоянно
// летят latch-команды (0x08 <- 0x80) и настройка. Это не звук, поэтому «голосом ВИ53»
// считаем только каналы A/B (порты 0x0B/0x0A) и их управляющие слова 0x36/0x76.
// Канал C — часы музыки (latch 0x80 / период 60000), не голос.
const origOut=io.realoutput.bind(io);
io.realoutput=function(port,val){ const p=port&0xFF;
  if(p===0x14||p===0x15) cnt.ay++;
  else if(p===0x0A||p===0x0B) cnt.vi++;
  else if(p===0x08 && (val===0x36||val===0x76)) cnt.vi++;
  else if(p===0x09) viC.push(val);
  return origOut(port,val); };
g.event=null;
const ev=c=>({which:c,keyCode:c,preventDefault(){},stopPropagation(){}});
const key=(c,d)=>d?keyboard.keyDown(ev(c)):keyboard.keyUp(ev(c));
const run=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
const press=(c,f=6)=>{key(c,1);run(f);key(c,0);run(4);};
const { sndOvLoad } = require("./snd_ov_load");
const MODE=L["vec_snd_mode"], CHIP=L["vec_snd_chip"], PROBE=L["vec_ay_probe"];

run(300);
console.log(`проба AY на буте: ${rd(PROBE)?"чип ответил":"чип не ответил"} -> чип ${rd(CHIP)?"ВИ53":"AY"}, слушание ${rd(MODE)} (0=музыка+SFX 1=SFX 2=тишина)`);
const names=["музыка+SFX","SFX","тишина"];
let fail=0;
press(32); run(200); press(32); run(300);
const chip0=rd(CHIP);
for(let step=0;step<4;step++){
  const m=rd(MODE);
  cnt={ay:0,vi:0};
  run(250);
  console.log(`слушание ${m} (${names[m]}), чип ${chip0?"ВИ53":"AY"}: записей в AY ${cnt.ay}, в ВИ53-голоса ${cnt.vi}`);
  if(m===0 && chip0===0 && (cnt.ay===0 || cnt.vi>0)) { console.log("   ОШИБКА: на AY в музыка+SFX должен звучать только AY"); fail++; }
  if(m===0 && chip0===1 && (cnt.vi===0 || cnt.ay>0)) { console.log("   ОШИБКА: на ВИ53 в музыка+SFX должен звучать только ВИ53"); fail++; }
  if(m===2 && (cnt.ay>0 || cnt.vi>0))   { console.log("   ОШИБКА: в тишине не должно быть записей"); fail++; }
  press(83);
}
// Принудительный ВИ53: сначала геймплей (GS=5), иначе на GS=4 громкости нули и
// оверлей ВИ53 молчит (vol<6), а AY-счётчик при этом всё равно растёт от записи регистров.
const GS=L.GameStatus;
for (let i = 0; i < 12 && rd(GS) !== 5; i++) { press(32); run(150); }
memory.write(CHIP, 1, false);
sndOvLoad(memory, L, img, true);
memory.write(MODE, 0, false);
{ const SENT=0x0080, SP=0x7F00;
  const st={pc:cpu.pc,sp:cpu.sp,iff:cpu.iff,r:[0,1,2,3,4,5,7].map(x=>cpu.reg(x)),
            sf:cpu.sf,zf:cpu.zf,hf:cpu.hf,pf:cpu.pf,cf:cpu.cf};
  cpu.iff=false;
  memory.write(SP,SENT&255,false); memory.write(SP+1,SENT>>8,false);
  cpu.sp=SP; cpu.pc=L.vec_snd_apply;
  let n=0; while(cpu.pc!==SENT){ cpu.instruction(); io.commit(); if(++n>50000) throw new Error("vec_snd_apply hang"); }
  cpu.pc=st.pc; cpu.sp=st.sp; cpu.iff=st.iff;
  [0,1,2,3,4,5,7].forEach((x,i)=>cpu.set_reg(x,st.r[i]));
  cpu.sf=st.sf;cpu.zf=st.zf;cpu.hf=st.hf;cpu.pf=st.pf;cpu.cf=st.cf; }
cnt={ay:0,vi:0};
run(250);
console.log(`\nчип принудительно ВИ53, слушание музыка+SFX: записей в AY ${cnt.ay}, в ВИ53-голоса ${cnt.vi}`);
if(cnt.vi===0 || cnt.ay>0){ console.log("   ОШИБКА: на ВИ53 должен звучать только ВИ53"); fail++; }

const PAUSED=L["vec_paused"], TIMER=L["timer"];
if(!PAUSED||!TIMER){console.log("нет символов vec_paused/timer в .sym");process.exit(2);}
memory.write(MODE, 0, false);
memory.write(CHIP, chip0, false);
sndOvLoad(memory, L, img, chip0 !== 0);
run(120);
const snap=()=>{const b=Buffer.alloc(0x6000);for(let a=0;a<0x6000;a++)b[a]=rd(0x8000+a);return b;};
press(80);   // P
const pausedFlag=rd(PAUSED);
run(5);      // хвост: пачка вывода спрайтов дорисовывает подготовленное прошлым тиком
const t0=rd(TIMER), s0=snap();
cnt={ay:0,vi:0};
run(200);
const t1=rd(TIMER), s1=snap();
let moved=0; for(let i=0;i<s0.length;i++) if(s0[i]!==s1[i]) moved++;
console.log(`\nпауза: флаг ${pausedFlag}, игровой таймер ${t0} -> ${t1}, экран изменился на ${moved} байт, записей в звук AY ${cnt.ay} / ВИ53 ${cnt.vi}`);
if(!pausedFlag || t1!==t0 || moved!==0 || cnt.ay || cnt.vi){ console.log("   ОШИБКА: пауза не держит игру или звук не заглушён"); fail++; }
press(80);   // снять паузу
cnt={ay:0,vi:0};
run(200);
const t2=rd(TIMER);
console.log(`снятие паузы: флаг ${rd(PAUSED)}, таймер ${t1} -> ${t2}, записей в звук AY ${cnt.ay} / ВИ53 ${cnt.vi}`);
if(rd(PAUSED) || t2===t1 || (cnt.ay===0 && cnt.vi===0)){ console.log("   ОШИБКА: игра или звук не возобновились"); fail++; }
console.log(fail? `\nИТОГ: ОШИБОК ${fail}` : "\nИТОГ: ОК");
process.exit(fail?1:0);
