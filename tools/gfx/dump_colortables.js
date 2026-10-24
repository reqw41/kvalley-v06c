// dump_colortables.js — СНИМАЕТ ЭТАЛОН цветовых таблиц, которые игра строит в рантайме.
//
// Зачем: цвет тайла сейчас выводится на лету — vec_col_store читает MSX color table и
// сводит её в кэш vec_tilemode (256Б: bit7 white, биты6-3 mix-слот, биты2-0 режим), а
// двухцветные строки получают один из 15 слотов vec_mixbuf (15x8Б). Конвертер (задача #27)
// должен производить РОВНО ЭТИ БАЙТЫ офлайн, поэтому сначала фиксируем, что получается
// сейчас — по одному снимку на профиль сцены.
//
// Использование: node tools/gfx/dump_colortables.js <rom> <sym> [выходной каталог]
"use strict";
const fs=require("fs"),vm=require("vm");const base="/Users/boris/Projects/vector06js";
const rom=process.argv[2], symPath=process.argv[3], outDir=process.argv[4]||"build/colortables";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console={log(){},debug(){},warn(){},error(){},info(){}};
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const L={};for(const l of fs.readFileSync(symPath,"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
const rd=a=>memory.read(a,false);
g.event=null;
const ev=c=>({which:c,keyCode:c,preventDefault(){},stopPropagation(){}});
const key=(c,d)=>d?keyboard.keyDown(ev(c)):keyboard.keyUp(ev(c));
const run=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
const press=(c,f=6)=>{key(c,1);run(f);key(c,0);run(4);};
// ВХОД конвертера: сами MSX-цвета. Игра пишет их в color table, а мы перехватываем
// vec_col_store (HL = свёрнутый адрес 0x0000-0x07FF, A = байт) и держим полную копию.
// touched: писали ли в этот адрес вообще. Без него НОЛЬ в таблице неотличим от «не писали»,
// а рантайм для записанного нуля даёт режим 0x40 (blank), не 0xFF.
const msxcol=Buffer.alloc(0x800,0), touched=Buffer.alloc(0x800,0);
v06c.check_breakpoint=function(){
  if(cpu.pc===L.vec_col_store){ const a=(cpu.h()<<8|cpu.l())&0x7FF; msxcol[a]=cpu.a(); touched[a]=1; }
  return false; };
function grab(){ const tm=Buffer.alloc(256), mb=Buffer.alloc(120), pal=Buffer.alloc(16);
  for(let i=0;i<256;i++) tm[i]=rd(L.vec_tilemode+i);
  for(let i=0;i<120;i++) mb[i]=rd(L.vec_mixbuf+i);
  for(let i=0;i<16;i++) pal[i]=io.Palette[i]&0xFF;   // младший байт RGB как отпечаток
  return {tm,mb,pal}; }
fs.mkdirSync(outDir,{recursive:true});
const shots=[];
function shot(name){ const s=grab(); shots.push({name,...s});
  const used=[...s.tm].filter(b=>b!==0xFF).length;
  const slots=new Set([...s.tm].filter(b=>b!==0xFF).map(b=>(b>>3)&15));
  console.log(`${name.padEnd(22)} вычислено тайлов ${String(used).padStart(3)}/256, mix-слотов ${[...slots].filter(x=>x).length}`);
  fs.writeFileSync(`${outDir}/${name}.tilemode.bin`, s.tm);
  fs.writeFileSync(`${outDir}/${name}.mixbuf.bin`, s.mb);
  fs.writeFileSync(`${outDir}/${name}.msxcolor.bin`, Buffer.from(msxcol));
  fs.writeFileSync(`${outDir}/${name}.touched.bin`, Buffer.from(touched));
  const nz=[...msxcol].filter(b=>b).length;
  console.log(`${" ".repeat(23)}вход: ненулевых байт MSX-цвета ${nz}`); }
run(120); shot("konami");
run(220); shot("titul");
press(32); run(200); press(32); run(400);
for(let i=0;i<12 && rd(L.GameStatus)!==5;i++){ press(32); run(150); }
run(150); shot("gameplay_pyr01");
// чит N -> следующие пирамиды: схема камней меняется каждые 4
// Чит N (следующая пирамида) отрабатывает не мгновенно: игра уходит на карту долины,
// потом грузит уровень. Ждём именно СМЕНЫ piramideActual, а не фиксированного числа кадров —
// с ростом номера пирамиды переход становится длиннее, и по таймауту снимок дублировался.
for(let step=0;step<14;step++){
  const before=rd(L.piramideActual);
  // Задаём переход НАПРЯМУЮ, как это делает chkSalePiram: пирамида назначения + статус
  // «этап пройден». Клавишный чит на переходе 4->5 почему-то не срабатывает (отдельная
  // находка), а дампу нужны все банки графики.
  memory.write(L.piramideDest, before+1, false);
  memory.write(L.subStatus, 0, false);
  memory.write(L.GameStatus, 8, false);
  let w=0;
  while(w<4000 && !(rd(L.piramideActual)!==before && rd(L.GameStatus)===5)){ run(1); w++; }
  run(120);
  const cur=rd(L.piramideActual);
  if(cur===before){ console.log(`   (пирамида ${before}: чит не сработал за ${w} кадров, дальше не идём)`); break; }
  shot(`gameplay_pyr${String(cur).padStart(2,"0")}`);
}
console.log(`\nснимки в ${outDir}/ — это ЭТАЛОН для конвертера (#27)`);
// сводка различий между профилями геймплея: сколько байт tilemode отличается
for(let i=1;i<shots.length;i++){ let d=0; for(let j=0;j<256;j++) if(shots[i].tm[j]!==shots[i-1].tm[j]) d++;
  console.log(`   ${shots[i-1].name} -> ${shots[i].name}: различий в tilemode ${d} байт`); }
