// door_fixup.js — ГЕЙТ «ворота стираются ПОЛНОСТЬЮ» (save-under створок ворот).
//
// ЧТО ПРОВЕРЯЕТ. Створки ворот (слоты 0..3, setSprDoorProta/chkSalePiram) — masked-объекты:
// заливка пишет p1, гасит p0, и ANDN-ит p2 (vsc_leaf). p0 и p1 обязаны вернуться после
// скрытия. p2 в сейв заливки НЕ входит с 2026-08-18 (vsd_nlf: +0x9A := 0) — пара героя
// рисуется в пачке первой, и сейв p2 под створкой клал одежду «фоном», а restore
// выплёвывал её красными точками на раму. В дверном проёме легального p2 нет (рама p0/p1,
// за створкой чернота); vsc_leaf гасит p2 сам и не восстанавливает.
//
// БАГ, КОТОРЫЙ ЛОВИТ ТЕСТ (найден 2026-07-31): vec_su_fixup освежал только hi0 и hi0b, а
// hi0c оставлял протухшим. Кадр анимации ворот, нарисованный под створкой, затем затирался
// СТАРЫМ p0 из слота — «огрызок ворот» в их правом столбце (6-8 Б p0 на каждую клетку,
// до ~40 Б на дверь). Гейт обязан FAIL'ить на билдах до фикса. Это p0, не p2.
//
// КАК ПРОВЕРЯЕТ. Движок спрайтов гоняется напрямую (vec_nat_sprites + vec_spr_out), два
// прогона с одинаковым итогом:
//   A: чистый фон -> блит клетки            -> эталон
//   B: чистый фон -> створка -> блит клетки -> створка убрана
// Сверяются p0 и p1. p2 считается отдельно: ненулевой остаток p2 в произвольной X — это
// ANDN заливки без сейва, и гейт его НЕ красит; но если p2-остаток ни разу не встретился,
// выборка не доказала, что плоскость исключена осознанно. Дополнительно (без блита)
// проверяется стирание во всех 63 X.
//
// ГИПОТЕЗА «X=248 = столбец 32 чужой плоскости» ОТВЕРГНУТА замером 2026-08-20: клип
// vec_spr_prep срабатывает (nc=1, hi0=0xBF = p1 стб 31), в fb нет записи за край.
// Остаток на X=0/200/248 — одни и те же байты p2, которые заливка погасила.
//
// Запуск: node tools/verify/door_fixup.js [rom] [sym]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
const rom = process.argv[2] || "build/kvalley_8c.rom";
const sym = process.argv[3] || "build/kvalley_8c.sym";

const g = {}; g.window = g;
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.document={createElement:()=>fc(),getElementById:()=>fc()};
g.requestAnimationFrame=()=>0; g.setTimeout=()=>0; g.print=()=>0; g.console=console;
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
  vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"), ctx, {filename:f});
const memory=new ctx.Memory(), keyboard=new ctx.Keyboard(), timer=new ctx.I8253(), ay=new ctx.AY();
const floppy=new(ctx.Floppy().FD1793)(), io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io), tape={advance:()=>{},sample:0,reset:()=>{}};
const v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288); v06c.displayFrame=()=>{}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
// ВНИМАНИЕ: soundnik.soundStep НЕ глушим — он тактует ВИ53, на нём часы музыки.
const img=new Uint8Array(fs.readFileSync(rom));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();

const L={};
for(const l of fs.readFileSync(sym,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16);
}
const rd=a=>memory.read(a&0xffff), wr=(a,x)=>memory.write(a&0xffff,x&0xff);
const run=n=>{for(let i=0;i<n;i++) v06c.oneInterrupt(true);};
const key=(c,d)=>{const e={keyCode:c,which:c,preventDefault(){},stopPropagation(){}}; d?keyboard.keyDown(e):keyboard.keyUp(e);};
// ЗАДАЧА#37: адреса берём ИЗ .sym — база игровых переменных переезжает при уплотнении
// нижней ОЗУ, зашитые здесь 0x6C00/0x6C51/0x6CB0 после переезда указывали бы в код.
const A={GameStatus:L.GameStatus, flagPiramideMap:L.flagPiramideMap, sprAttrib:L.sprAttrib};

// прямой вызов подпрограммы ROM (без прерываний), свой стек в хвосте кода.
// ЗАДАЧА#37: скретч-стек тоже НЕ зашит числом (был 0x6BEE) — он берётся впритык под базой
// игровых переменных: там паддинг образа, живых данных нет, и адрес едет вместе с раскладкой.
const SENT=0x0038;
const SCRATCH_SP=L.GameStatus-2;
function callSub(addr, regs){
  const st={pc:cpu.pc,sp:cpu.sp,iff:cpu.iff,r:[0,1,2,3,4,5,7].map(x=>cpu.reg(x)),
            sf:cpu.sf,zf:cpu.zf,hf:cpu.hf,pf:cpu.pf,cf:cpu.cf};
  cpu.iff=false; wr(SCRATCH_SP,SENT&255); wr(SCRATCH_SP+1,SENT>>8); cpu.sp=SCRATCH_SP; cpu.pc=addr;
  if(regs){const M={b:0,c:1,d:2,e:3,h:4,l:5,a:7}; for(const k of Object.keys(regs)) cpu.set_reg(M[k],regs[k]);}
  let n=0; while(cpu.pc!==SENT){ cpu.instruction(); if(++n>8e6) throw new Error("не вернулась из 0x"+addr.toString(16)); }
  cpu.pc=st.pc; cpu.sp=st.sp; cpu.iff=st.iff;
  [0,1,2,3,4,5,7].forEach((x,i)=>cpu.set_reg(x,st.r[i]));
  cpu.sf=st.sf;cpu.zf=st.zf;cpu.hf=st.hf;cpu.pf=st.pf;cpu.cf=st.cf;
}
const fbSnap=()=>{const a=new Uint8Array(0x6000); for(let i=0;i<0x6000;i++) a[i]=rd(0x8000+i); return a;};
const objSnap=o=>{const s={}; for(const k of Object.keys(o)){const v=o[k];
  if(typeof v==="number"||typeof v==="boolean") s[k]=v;
  else if(ArrayBuffer.isView(v)) s[k]=v.slice();
  else if(Array.isArray(v)&&v.every(x=>typeof x==="number")) s[k]=v.slice();} return s;};
const objRest=(o,s)=>{for(const k of Object.keys(s)){const v=s[k];
  if(ArrayBuffer.isView(v)) o[k].set(v); else if(Array.isArray(v)) o[k].splice(0,o[k].length,...v); else o[k]=v;}};
const snap =()=>({mem:memory.bytes.slice(),cpu:objSnap(cpu),tim:objSnap(timer),ay:objSnap(ay),tv:objSnap(v06c),io:objSnap(io)});
const rest =s =>{memory.bytes.set(s.mem);objRest(cpu,s.cpu);objRest(timer,s.tim);objRest(ay,s.ay);objRest(v06c,s.tv);objRest(io,s.io);};

// --- буст в геймплей ------------------------------------------------------------------
run(400);
let ok=false;
for(let blk=0;blk<60&&!ok;blk++){
  for(let f=0;f<25;f++){key(32,true);run(1); if(rd(A.GameStatus)===5&&(rd(A.flagPiramideMap)&1)){ok=true;break;}}
  key(32,false); run(5);
}
if(!ok){ console.log("НЕ УДАЛОСЬ войти в геймплей"); process.exit(2); }
key(32,false); run(30);

const pump   =()=>{ callSub(L.vec_nat_sprites); callSub(L.vec_spr_out); };
const hideAll=()=>{ for(let i=0;i<21;i++) wr(A.sprAttrib+i*4,0xD0); };
// створки, как их ставит chkSalePiram: две пары 16x32, X = X двери + 16, Y = Y двери - 0x11.
// Пары с цветом 1 — «рисунок кирпичей», это и есть masked-спрайты (гасят p0).
function setFlaps(y,x){
  [[y,x,216,1],[y,x,220,3],[(y+16)&255,x,224,1],[(y+16)&255,x,228,3]]
    .forEach((c,i)=>{ for(let k=0;k<4;k++) wr(A.sprAttrib+i*4+k,c[k]); });
}
const blit=(row,col,tile)=>{ wr(L.vw_byte,tile); callSub(L.vec_blit_tile,{b:row,c:col}); };
const splitDiff=(a,b)=>{
  const p01=[], p2=[];
  for(let i=0;i<0x4000;i++) if(a[i]!==b[i]) p01.push(i);
  for(let i=0x4000;i<0x6000;i++) if(a[i]!==b[i]) p2.push(i);
  return {p01,p2};
};
const where=list=>{const by={};
  for(const i of list){const pl=["p0","p1","p2"][i>>13], c=(i>>8)&31; (by[pl+" стб "+c]=by[pl+" стб "+c]||[]).push(i&255);}
  return Object.entries(by).map(([k,l])=>`${k}: ${l.length}Б lo ${Math.min(...l)}..${Math.max(...l)}`).join("; ");};

const base0=snap();
const Y=95, ROW=12, TILE=0x40;   // 0x40 = кирпич: меняет все три плоскости
let failErase=0, failFixup=0, nErase=0, nFixup=0, p2Erase=0, p2Fixup=0;

// --- тест 1: створка ушла -> p0/p1 обязаны вернуться (все позиции X) -------------------
for(let x=0;x<=248;x+=4){
  rest(base0); hideAll(); pump(); pump();
  const fb0=fbSnap();
  setFlaps(Y,x); pump();
  hideAll(); pump();
  const d=splitDiff(fb0,fbSnap()); nErase++;
  if(d.p2.length) p2Erase++;
  if(d.p01.length){ failErase++;
    console.log(`СТИРАНИЕ X=${x}: остаток p0/p1 ${d.p01.length} Б — ${where(d.p01)}`); }
}

// --- тест 2: под створкой перерисована клетка фона -------------------------------------
for(let x=0;x<=248;x+=8){
  for(let dcol=0;dcol<3;dcol++){
    const col=Math.min(31,(x>>3)+dcol);
    rest(base0); hideAll(); pump(); pump(); blit(ROW,col,TILE);
    const fbA=fbSnap();
    rest(base0); hideAll(); pump(); pump();
    setFlaps(Y,x); pump(); blit(ROW,col,TILE); hideAll(); pump();
    const d=splitDiff(fbA,fbSnap()); nFixup++;
    if(d.p2.length) p2Fixup++;
    if(d.p01.length){ failFixup++;
      console.log(`FIXUP X=${x} (створка стб ${x>>3},${(x>>3)+1}), клетка стб ${col} ряд ${ROW}: расхождение p0/p1 ${d.p01.length} Б — ${where(d.p01)}`); }
  }
}

console.log(`\nстирание створки p0/p1: ${nErase-failErase}/${nErase} позиций чисто`);
console.log(`фон под створкой p0/p1: ${nFixup-failFixup}/${nFixup} случаев чисто`);
console.log(`p2 после скрытия (не в сейве заливки, vsd_nlf): стирание ${p2Erase}/${nErase}, fixup ${p2Fixup}/${nFixup}`);
if(!p2Erase && !p2Fixup){
  console.log("ПРОВАЛ ПОКРЫТИЯ: ни в одном случае p2 не отличался — исключение плоскости не доказано");
  process.exit(1);
}
const fail=failErase+failFixup;
console.log(fail ? `ВЕРДИКТ: ворота стираются НЕ полностью (p0/p1) — ПРОВАЛ (${fail} случаев)`
                 : "ВЕРДИКТ: p0/p1 под створкой не протухают; p2 заливка не сейвит (2026-08-18) — OK");
process.exit(fail?1:0);
