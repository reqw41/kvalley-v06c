// atomic_gate.js — детектор РАЗРЫВА рендер-прохода между кадрами (I0 спеки
// 2026-07-27-kv8c-atomic-render-design.md).
// Инвариант: каждый вызов vec_su_restore / vec_su_save исполняется В ТОМ ЖЕ КАДРЕ,
// что и вход в vec_nat_sprites, к которому он принадлежит. Разрыв (restore в кадре N,
// save/draw в N+1) = экран показан с наполовину снятыми спрайтами (мигание ворот,
// рассогласование save-under => вечные остатки створки).
// Использование: node tools/verify/atomic_gate.js <rom> <sym> [frames=20000]
// PASS = 0 разрывов. На билдах до I1 обязан FAIL (baseline воспроизводит баг).
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2],sym=process.argv[3],MAXF=+(process.argv[4]||20000);
if(!rom||!sym){console.log("usage: node atomic_gate.js <rom> <sym> [frames]");process.exit(2);}
const L={};for(const line of fs.readFileSync(sym,"latin1").split("\n")){const m=line.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const NS=L["vec_nat_sprites"],REST=L["vec_su_restore"],SAVE=L["vec_su_save"];
if(!NS||!REST||!SAVE){console.log("нет символов vec_nat_sprites/vec_su_*");process.exit(2);}
// ФИКС ДЕТЕКТОРА 2026-07-29: раньше passFrame взводился на входе в vec_nat_sprites и жил
// ДО СЛЕДУЮЩЕГО входа. Любой save/restore ВНЕ прохода (фоновые блиты тика, fixup) в другом
// кадре засчитывался как «разрыв» — ложные срабатывания составляли почти весь счёт.
// Теперь проход закрывается по ВОЗВРАТУ ИЗ vec_nat_sprites. ВАЖНО: закрывать по SP НЕЛЬЗЯ —
// vec_su_restore/save делают SP-хайджек (SP := адрес данных слота, 0xE000+, ВЫШЕ стека),
// и любая SP-эвристика «закрывает» проход на первом же restore.
// ЗАДАЧА#53 (2026-08-05): ВЫЗОВЫ ИЗ ПАЧКИ ВЫВОДА — НЕ ЧАСТЬ ПРОХОДА ПОДГОТОВКИ.
// Инвариант выше писался, когда весь рендер жил в vec_nat_sprites. После разделения фаз
// (задача #14) restore/save делает ПАЧКА vec_spr_out, и она теперь запускается ещё и с
// ВЛОЖЕННОГО прерывания, то есть законно исполняется ПОСРЕДИ длинного тика — её вызовы
// приходятся на кадр, следующий за началом прохода, и засчитывались разрывом (12 штук
// на 8783 прохода). Пачка атомарна сама по себе (её проверяют spr_resid_gate и beam_*),
// поэтому интервал внутри vec_spr_out из учёта исключаем, а вызовы вне пачки — то есть
// fixup и всё, что делает сам тик, — гейт проверяет как раньше.
const OUT=L["vec_spr_out"];
if(!OUT){console.log("нет символа vec_spr_out");process.exit(2);}
let f=0,passFrame=-1,retAddr=-1,violations=0,passes=0,samples=[];
let inPack=false,packRet=-1,packSp=-1,packSkips=0;
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===OUT&&!inPack){inPack=true;packSp=cpu.sp;packRet=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);return false;}
  if(inPack&&pc===packRet&&cpu.sp>packSp){inPack=false;return false;}
  if(pc===NS&&passFrame<0){passFrame=f;retAddr=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);passes++;return false;}
  if(passFrame>=0&&pc===retAddr){passFrame=-1;retAddr=-1;return false;}  // проход завершён
  if((pc===REST||pc===SAVE)&&inPack){packSkips++;return false;}
  if((pc===REST||pc===SAVE)&&passFrame>=0&&f!==passFrame){
    violations++;
    if(samples.length<6)samples.push("кадр "+f+": "+(pc===REST?"restore":"save")+" из прохода, начатого в кадре "+passFrame);
    passFrame=f; // не спамить по каждому вызову того же разорванного прохода
  }
  return false;
};
while(f<MAXF){v06c.oneInterrupt(true);f++;}
// ПОКРЫТИЕ: проход обязан хоть раз состояться, иначе «0 разрывов» ничего не значит.
if(!passes){console.log("atomic_gate: ПРОВАЛ ПОКРЫТИЯ — vec_nat_sprites не вызывался ни разу");process.exit(1);}
console.log("atomic_gate: кадров="+MAXF+" проходов="+passes+" разрывов="+violations+" ("+(passes?(100*violations/passes).toFixed(2):0)+"% проходов)"+(violations?"  ❌ FAIL":"  ✅ PASS"));
console.log("   вызовов restore/save внутри пачки вывода (вне учёта): "+packSkips);
console.log(samples.join("\n"));
process.exit(violations?1:0);
