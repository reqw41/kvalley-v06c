// snd_firstnote.js — ПЕРВАЯ НОТА МЕЛОДИИ ОБЯЗАНА ЗВУЧАТЬ.
//
// Жалоба с железа (2026-08-01): «музыка после нажатия SPACE на стартовом экране не
// отыгрывает первую ноту, звук включается со второй». Гейт сторожит ТРИ независимых
// механизма, каждый из которых даёт ровно этот симптом и каждый был реально найден:
//
//  1) ВИ53, ДЕДУП ДЕЛИТЕЛЯ. Управляющее слово (0x36/0x76/0xB6) ОСТАНАВЛИВАЕТ счётчик
//     канала до записи нового значения. vec_vi_ch зажигает молчавший канал этим словом
//     и ВСЕГДА пишет делитель (кэша частоты больше нет). Проверяем прямой подстановкой:
//     гасим канал и требуем, чтобы делитель уехал в порт канала.
//
//  2) AY, ОГИБАЮЩАЯ В РЕГИСТРЕ ГРОМКОСТИ. Игра НИКОГДА не программирует огибающую
//     (R11-R13) и никогда не ставит бит 4 в регистрах громкости 8/9/10. Если такой байт
//     всё же долетел до чипа, канал переключился на мёртвую огибающую и замолчал до
//     следующей ноты. Источник — гонка в WRTPSG (номер регистра лежал в ОБЩЕЙ ячейке
//     vec_wp_md, прерывание между записью и чтением уводило байт основного потока
//     0x8F = ReadKeys в чужой регистр). Считаем такие байты: их обязано быть НОЛЬ.
//
//  3) МЕЛОДИЯ ВООБЩЕ ЗАГРУЗИЛАСЬ И ЗАЗВУЧАЛА. На каждой точке старта музыки первая нота
//     обязана дойти до чипа не позже +2 кадров: тон разрешён микшером (R7), громкость > 0,
//     делитель не ноль. Заодно ловится отказ по приоритету (мелодия начала партии 0x97
//     слабее «тишины» 0x20 и не загрузится, если тишину не успели дотикать).
//
// Использование: node tools/verify/snd_firstnote.js <rom> <sym>
// PASS = все три проверки зелёные в обоих режимах (AY и ВИ53).
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const g = {}; g.window = g;
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.document={createElement:()=>fc(),getElementById:()=>fc()};
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;
g.console={log(){},debug(){},warn(){},error(){},info(){}};
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
  vm.runInContext(fs.readFileSync(base + "/" + f, "utf8"), ctx, { filename: f });

const romPath = process.argv[2] || "build/kvalley_8c.rom";
const symPath = process.argv[3] || "build/kvalley_8c.sym";

function machine(noAy) {
  const memory=new ctx.Memory(), keyboard=new ctx.Keyboard(), timer=new ctx.I8253(),
        ay=new ctx.AY(), floppy=new (ctx.Floppy().FD1793)(),
        io=new ctx.IO(keyboard,timer,memory,ay,floppy);
  const cpu=new ctx.I8080(memory,io), tape={advance:()=>{},sample:0,reset:()=>{}};
  const v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
  v06c.bmp=new Uint32Array(576*288); v06c.displayFrame=()=>{}; v06c.dbg=null;
  v06c.check_breakpoint=()=>false;
  const img=new Uint8Array(fs.readFileSync(romPath));
  memory.init_from_array(img.subarray(0,0x10000),0x100);
  memory.detach_boot && memory.detach_boot();
  cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
  if (noAy) cpu.io.ay = { read: () => 0xFF, write: () => {}, reset: () => {} };
  return { memory, keyboard, io, cpu, v06c, ay };
}
const L={};
for (const l of fs.readFileSync(symPath,"latin1").split("\n")) {
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
const ev=c=>({which:c,keyCode:c,preventDefault(){},stopPropagation(){}});

// делитель ВИ53 из периода AY — БАЙТ В БАЙТ как vec_ay2vi: 13P + (P>>1), 16 бит
const ay2vi = P => ((13*P + (P>>1)) & 0xFFFF);

let fails = 0;
const ok  = t => console.log("  ОК   " + t);
const bad = t => { console.log("  СБОЙ " + t); fails++; };

// ------------------------------------------------------------------ 1) ВИ53: дедуп
console.log("1) ВИ53: канал зажгли управляющим словом -> делитель ОБЯЗАН быть перезалит");
{
  const M=machine(true), rd=a=>M.memory.read(a,false), wr=(a,v)=>M.memory.write(a,v,false);
  const key=(c,d)=>d?M.keyboard.keyDown(ev(c)):M.keyboard.keyUp(ev(c));
  const run=n=>{for(let i=0;i<n;i++) M.v06c.oneInterrupt(true);};
  const press=(c,f=6)=>{key(c,1);run(f);key(c,0);run(4);};
  const hits={0x0B:0,0x0A:0,0x09:0};
  const oo=M.io.realoutput.bind(M.io);
  M.io.realoutput=function(p,v){p&=0xFF; if(hits[p]!==undefined) hits[p]++; return oo(p,v);};
  run(400);
  if (!L.vec_vi_ch) {
    bad("нет метки vec_vi_ch (оверлей ВИ53 не экспортирован)");
  } else {
  if (rd(L.vec_snd_chip)!==1) bad("бут не выбрал ВИ53 (проба AY не должна была ответить)");
  press(32); run(60); press(32); run(200);
  const SENT=0x0080, SP=0x7F00;
  function call_vi(ch){
    const cpu=M.cpu;
    const st={pc:cpu.pc,sp:cpu.sp,iff:cpu.iff,r:[0,1,2,3,4,5,7].map(x=>cpu.reg(x)),
              sf:cpu.sf,zf:cpu.zf,hf:cpu.hf,pf:cpu.pf,cf:cpu.cf};
    cpu.iff=false; wr(SP,SENT&255); wr(SP+1,SENT>>8); cpu.sp=SP; cpu.pc=L.vec_vi_ch; cpu.set_a(ch);
    let n=0; while(cpu.pc!==SENT){ cpu.instruction(); M.io.commit(); if(++n>20000) throw new Error("vec_vi_ch hang"); }
    cpu.pc=st.pc; cpu.sp=st.sp; cpu.iff=st.iff;
    [0,1,2,3,4,5,7].forEach((x,i)=>cpu.set_reg(x,st.r[i]));
    cpu.sf=st.sf;cpu.zf=st.zf;cpu.hf=st.hf;cpu.pf=st.pf;cpu.cf=st.cf;
  }
  const chans=[{n:"A",port:0x0B,vol:8,per:0,vch:0},
               {n:"B",port:0x0A,vol:9,per:2,vch:1},
               {n:"C",port:0x09,vol:10,per:4,vch:2}];
  for (const c of chans) {
    const P = 0x0100 + c.vch*0x40;          // период ноты, который «повторяется»
    wr(L.vec_ayregs+7, 0xB8);               // тон A/B/C разрешён, шум выключен
    wr(L.vec_ayregs+c.vol, 12);             // громкость выше порога 6
    wr(L.vec_ayregs+c.per,   P & 0xFF);
    wr(L.vec_ayregs+c.per+1, P >> 8);
    wr(L.vec_vch+c.vch, 0);                 // канал считается погашенным
    hits[c.port]=0;
    call_vi(c.vch);
    if (hits[c.port] >= 2) ok(`канал ${c.n}: делитель перезалит (записей в порт 0x${c.port.toString(16)}: ${hits[c.port]})`);
    else bad(`канал ${c.n}: делитель НЕ перезалит (записей ${hits[c.port]}) — нота будет НЕМОЙ`);
  }
  }
}

// ------------------------------------------------------------- 2) AY: бит огибающей
console.log("2) AY: в регистры громкости 8/9/10 не должен попадать байт с битом 4 (огибающая)");
{
  const M=machine(), rd=a=>M.memory.read(a,false), wr=(a,v)=>M.memory.write(a,v,false);
  const key=(c,d)=>d?M.keyboard.keyDown(ev(c)):M.keyboard.keyUp(ev(c));
  const run=n=>{for(let i=0;i<n;i++) M.v06c.oneInterrupt(true);};
  const press=(c,f=6)=>{key(c,1);run(f);key(c,0);run(4);};
  let reg=-1, envVol=0, envShape=0, frames=0;
  const oo=M.io.realoutput.bind(M.io);
  M.io.realoutput=function(p,v){ p&=0xFF;
    if (p===0x15) reg=v;
    else if (p===0x14) { if (reg>=8 && reg<=10 && (v & 0x10)) envVol++; if (reg>=11 && reg<=13) envShape++; }
    return oo(p,v); };
  run(400);
  if (rd(L.vec_snd_chip)!==0) bad("бут не выбрал режим AY — проверка огибающей не проведена");
  press(32); run(60); press(32); run(600); frames+=1070;
  for(let i=0;i<10 && rd(L.GameStatus)!==5;i++){ press(32); run(120); frames+=130; }
  run(1200); press(78); run(900); wr(L.flagVivo,0); run(600); frames+=2710;
  if (envVol===0) ok(`байтов «громкость по огибающей» за ${frames} кадров: 0`);
  else bad(`байтов «громкость по огибающей»: ${envVol} — канал глохнет до следующей ноты`);
  if (envShape===0) ok("огибающая (R11-R13) игрой не программируется, как и на MSX");
  else bad(`неожиданные записи в R11-R13: ${envShape}`);
}

// ------------------------------------------- 3) первая нота доходит до чипа на всех точках
console.log("3) первая нота каждой мелодии доходит до чипа не позже +2 кадров");
for (const noAy of [false, true]) {
  const M=machine(noAy), rd=a=>M.memory.read(a,false), wr=(a,v)=>M.memory.write(a,v,false);
  const key=(c,d)=>d?M.keyboard.keyDown(ev(c)):M.keyboard.keyUp(ev(c));
  let frame=0, prev=0, cur=null; const starts=[];
  const mir=()=>Array.from({length:14},(_,i)=>rd(L.vec_ayregs+i));
  const audible=()=>{ const m=mir(); for(let c=0;c<3;c++){
      const per=m[2*c]|((m[2*c+1]&15)<<8), vol=m[8+c]&15;
      if (((m[7]>>c)&1)===0 && vol>0 && per!==0) return true; } return false; };
  const step=()=>{ M.v06c.oneInterrupt(true); frame++;
    const c=rd(L.musicCh1);
    if (c!==0 && c!==prev) { cur={id:c,f0:frame,rows:[]}; starts.push(cur); }
    prev=c;
    if (cur && cur.rows.length<6) cur.rows.push(audible()); };
  const run=n=>{for(let i=0;i<n;i++) step();};
  const press=(c,f=6)=>{key(c,1);run(f);key(c,0);run(4);};
  run(400);
  const name = noAy ? "ВИ53" : "AY";
  starts.length=0;
  press(32); run(60);                       // логотип -> меню
  press(32); run(500);                      // меню -> НАЧАЛО ПАРТИИ (джингл 0x97)
  const gotIntro = starts.some(s=>s.id===0x97);
  for(let i=0;i<10 && rd(L.GameStatus)!==5;i++){ press(32); run(120); }
  run(600);
  press(78); run(900);                      // чит N: смена уровня + карта долины
  wr(L.flagVivo,0); run(400);               // смерть героя (музыка 0x1D)
  for(let i=0;i<10 && rd(L.GameStatus)!==5;i++) run(60);
  // последняя жизнь -> GAME OVER (музыка 0x9A): Vidas держим нулём весь пролёт смерти,
  // иначе счётчик жизней успевает восстановиться и игра уходит в setGameMode
  wr(L.flagVivo,0);
  for(let i=0;i<900;i++){ wr(L.Vidas,0); step(); }
  press(32); run(200); press(32); run(400);  // назад в меню и снова в партию
  press(69); run(700);                      // чит E: финальный экран
  if (gotIntro) ok(`${name}: мелодия начала партии (0x97) загрузилась`);
  else bad(`${name}: мелодия начала партии (0x97) НЕ загрузилась — отказ по приоритету`);
  const late = starts.filter(s => s.id!==0x20 && !s.rows.slice(0,3).some(Boolean));
  const seen = [...new Set(starts.filter(s=>s.id!==0x20).map(s=>"0x"+s.id.toString(16)))];
  if (late.length===0) ok(`${name}: ${starts.length-late.length} стартов музыки, у всех первая нота слышна <= +2 кадров (${seen.join(" ")})`);
  else bad(`${name}: молчащих стартов ${late.length}: ` + late.map(s=>"0x"+s.id.toString(16)+"@к"+s.f0).join(", "));
}

console.log(fails ? `ИТОГ: СБОЙ (${fails})` : "ИТОГ: ОК — первая нота звучит на всех точках старта");
process.exit(fails ? 1 : 0);
