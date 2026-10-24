// z80_gain.js — СКОЛЬКО ДАЛ БЫ Z80 ВМЕСТО КР580ВМ80А. Чисто расчётный инструмент:
// прогон реального геймплея, гистограмма ИСПОЛНЕНИЙ по каждому PC, затем переоценка
// каждой исполненной инструкции по таблице Z80 — БЕЗ единой правки кода.
//
// МОДЕЛЬ ШИНЫ (главное). Вектор-06Ц — не «голый» процессор: из RTL MiSTer
// (Vector-06C_MiSTer) и i8080 и Z80 получают один и тот же ce_f1 3 МГц и ОДИН И ТОТ ЖЕ
// cpu_ready — арбитраж с видео: НЕ БОЛЕЕ ОДНОГО ОБРАЩЕНИЯ К ШИНЕ НА 4 ТАКТА CPU.
// Поэтому такты считаются не по учебной таблице T-состояний, а по «слотам» шины:
//   слоты = M1 + обращения к памяти + обращения к портам + ceil(внутренние/4)
//   внутренние = всегоT - 4*M1 - 3*память - 4*порты;   такты = 4*слоты
// Для i8080 это ровно то, что считает vector06js (T4=4, T43=8, T433=12, T4333=16,
// T43333=20) — и ровно те числа, которыми оперирует проект (строка спрайта = 48 тактов).
// Для Z80 формула та же (проверена в форке devector-fork/z80, замедление шиной 1.206x).
// СЛЕДСТВИЕ, которого нет в учебной таблице: 4-тактовые регистровые команды Z80
// (inc r, ld r,r') стоят 4 такта против 8 у i8080 (у того они 5T -> следующая выборка
// только в следующем окне). Именно отсюда весь выигрыш, а вовсе не из ldir.
//
// Запуск: node tools/verify/z80_gain.js [rom] [sym] [кадров]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||3000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;

// ---------- таблица Z80 для 8080-подмножества: [всегоT, память, порты] (M1 всегда 1) ----------
function z80info(op,taken){
  const h=op>>4,l=op&15;
  if(op===0x76)return[4,0,0];                       // halt
  if(op>=0x40&&op<0x80)return((op&7)===6||(op&0x38)===0x30)?[7,1,0]:[4,0,0]; // ld r,r'
  if(op>=0x80&&op<0xC0)return((op&7)===6)?[7,1,0]:[4,0,0];                    // alu r
  switch(op){
    case 0x00:case 0x07:case 0x0F:case 0x17:case 0x1F:
    case 0x27:case 0x2F:case 0x37:case 0x3F:
    case 0xE9:case 0xEB:case 0xF3:case 0xFB: return[4,0,0];
    case 0x01:case 0x11:case 0x21:case 0x31: return[10,2,0];  // ld dd,nn
    case 0x02:case 0x12:case 0x0A:case 0x1A: return[7,1,0];   // ld (bc/de),a / a,(bc/de)
    case 0x22:case 0x2A: return[16,4,0];                      // ld (nn),hl / hl,(nn)
    case 0x32:case 0x3A: return[13,3,0];                      // ld (nn),a / a,(nn)
    case 0x03:case 0x13:case 0x23:case 0x33:
    case 0x0B:case 0x1B:case 0x2B:case 0x3B: return[6,0,0];   // inc/dec ss
    case 0x34:case 0x35: return[11,2,0];                      // inc/dec (hl)
    case 0x36: return[10,2,0];                                // ld (hl),n
    case 0x09:case 0x19:case 0x29:case 0x39: return[11,0,0];  // add hl,ss
    case 0xE3: return[19,4,0];                                // ex (sp),hl
    case 0xF9: return[6,0,0];                                 // ld sp,hl
    case 0xC9: return[10,2,0];                                // ret
    case 0xCD: return[17,4,0];                                // call
    case 0xC3: return[10,2,0];                                // jp
    case 0xD3:case 0xDB: return[11,1,1];                      // out (n),a / in a,(n)
  }
  if((op&0xC7)===0x04||(op&0xC7)===0x05)return[4,0,0];        // inc r / dec r
  if((op&0xC7)===0x06)return[7,1,0];                          // ld r,n
  if((op&0xC7)===0xC6)return[7,1,0];                          // alu n
  if((op&0xC7)===0xC7)return[11,2,0];                         // rst
  if((op&0xCF)===0xC1)return[10,2,0];                         // pop
  if((op&0xCF)===0xC5)return[11,2,0];                         // push
  if((op&0xC7)===0xC2)return[10,2,0];                         // jp cc  (10 всегда)
  if((op&0xC7)===0xC4)return taken?[17,4,0]:[10,2,0];         // call cc
  if((op&0xC7)===0xC0)return taken?[11,2,0]:[5,0,0];          // ret cc
  return null;                                                // не 8080-подмножество
}
function z80clk(op,taken){
  const it=z80info(op,taken); if(!it)return null;
  const[t,mem,prt]=it;
  const inner=t-4-3*mem-4*prt;
  return 4*(1+mem+prt+(inner>0?Math.ceil(inner/4):0));
}
// такты i8080 берём ИЗ ЭМУЛЯТОРА (он и есть источник чисел проекта), но для условных
// команд нужно знать, взят переход или нет — различаем по самим тактам.
const isCondCall=op=>(op&0xC7)===0xC4, isCondRet=op=>(op&0xC7)===0xC0;

// ---------- сбор: сколько раз исполнен каждый PC и с какими тактами ----------
const cnt=new Uint32Array(0x10000), cy8=new Float64Array(0x10000);
const takenCnt=new Uint32Array(0x10000);           // для условных: сколько раз «взят»
let active=false, frames=0, totalCy=0, packFrames=0, nShow=0;
const SHOWPC=[];
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc; oI(); if(!active)return;
  const vc=cpu.vcycles|0; const op=rd(pc);
  cnt[pc]++; cy8[pc]+=vc; totalCy+=vc;
  if(pc===SHOWPC[0]||pc===SHOWPC[1])nShow++;
  if(isCondCall(op)){ if(vc>=16)takenCnt[pc]++; }
  else if(isCondRet(op)){ if(vc>=12)takenCnt[pc]++; }
};

// сценарий как в beam_top/beam_late: случайное блуждание + перескок пирамид
SHOWPC[0]=L.vec_spr_show;SHOWPC[1]=L.vso_merge1;
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  const gs=rd(L.GameStatus);
  active=(gs===5); if(active)frames++;
  const s0=nShow;
  v06c.oneInterrupt(true);
  if(active&&nShow>s0)packFrames++;
}
if(held>0)E.key(held,0);
active=false;

// ---------- переоценка ----------
const labels=[];for(const k in L)if(L[k]>=0&&L[k]<0x10000)labels.push([L[k],k]);
labels.sort((a,b)=>a[0]-b[0]);
const addrs=labels.map(x=>x[0]);
function lab(pc){let lo=0,hi=addrs.length-1,r=0;
  while(lo<=hi){const m=(lo+hi)>>1;if(addrs[m]<=pc){r=m;lo=m+1;}else hi=m-1;}
  return labels[r][1];}

let sum8=0,sumZ=0,unknown=0;const perLab=new Map();
for(let pc=0;pc<0x10000;pc++){
  if(!cnt[pc])continue;
  const op=rd(pc), n=cnt[pc], c8=cy8[pc];
  let cz;
  if(isCondCall(op)||isCondRet(op)){
    const tk=takenCnt[pc], nt=n-tk;
    const a=z80clk(op,true), b=z80clk(op,false);
    if(a===null||b===null){unknown+=n;continue;}
    cz=tk*a+nt*b;
  }else{
    const v=z80clk(op,false);
    if(v===null){unknown+=n;continue;}
    cz=n*v;
  }
  sum8+=c8; sumZ+=cz;
  const k=lab(pc); const e=perLab.get(k)||{c8:0,cz:0,n:0}; e.c8+=c8;e.cz+=cz;e.n+=n;perLab.set(k,e);
}
const F=frames, P=packFrames, K=frames/packFrames;
console.log(`ROM=${ROM}`);
console.log(`кадров геймплея: ${F}, из них С ПАЧКОЙ ВЫВОДА (есть выведенные объекты): ${P} (${(100*P/F).toFixed(1)}%) — именно на них нормируют beam_top/beam_late`);
console.log(`кадров геймплея: ${F}, инструкций учтено: ${[...perLab.values()].reduce((s,e)=>s+e.n,0)}, не 8080-подмножество: ${unknown}`);
console.log(`\n=== ВЕСЬ КОД, ОПКОД В ОПКОД (без единой Z80-специфичной замены) ===`);
console.log(`i8080: ${(sum8/F).toFixed(0)} тактов/кадр (${(sum8/F/59904*100).toFixed(1)}% кадра)`);
console.log(`Z80  : ${(sumZ/F).toFixed(0)} тактов/кадр (${(sumZ/F/59904*100).toFixed(1)}% кадра)`);
console.log(`выигрыш: ${((sum8-sumZ)/F).toFixed(0)} тактов/кадр = ${((sum8-sumZ)/sum8*100).toFixed(1)}% работы, ${((sum8-sumZ)/F/59904*100).toFixed(1)} п.п. кадра`);

const arr=[...perLab.entries()].map(([k,e])=>[k,e]).sort((a,b)=>(b[1].c8-b[1].cz)-(a[1].c8-a[1].cz));
console.log(`\n=== ТОП-25 РЕГИОНОВ ПО АБСОЛЮТНОМУ ВЫИГРЫШУ (тактов/кадр) ===`);
console.log(`  выигрыш   i8080   Z80   %  регион`);
for(const [k,e] of arr.slice(0,25))
  console.log(`  ${((e.c8-e.cz)/F).toFixed(0).padStart(7)} ${(e.c8/F).toFixed(0).padStart(7)} ${(e.cz/F).toFixed(0).padStart(6)} ${((e.c8-e.cz)/e.c8*100).toFixed(0).padStart(4)}%  ${k}`);
console.log(`\n=== ТО ЖЕ, НО НА КАДР С ПАЧКОЙ (шкала beam_top: x${K.toFixed(2)}) ===`);
for(const [k,e] of arr.slice(0,15))
  console.log(`  ${((e.c8-e.cz)/P).toFixed(0).padStart(7)} ${(e.c8/P).toFixed(0).padStart(7)} ${(e.cz/P).toFixed(0).padStart(6)} ${((e.c8-e.cz)/e.c8*100).toFixed(0).padStart(4)}%  ${k}`);

// ---------- адресный разрез по интересующим петлям ----------
const spans=[
 ["vec_nat_sprites","vec_spr_flush","логика спрайтов+фликер (тик)"],
 ["vec_su_ptr","RDVDP","save-under: снятие и возврат фона (обе процедуры целиком)"],
 ["vec_su_restore","vec_su_save","  из них restore (возврат фона)"],
 ["vec_su_save","vsu_hide","  из них save (снятие фона)"],
 ["vsu_rcol","vsu_r3","    петля столбцов restore (POP-хайджек)"],
 ["vsu_srow","vsu_s3","    петля столбцов save (POP-хайджек)"],
 ["vec_spr_prep","vsp_fastmark","подготовка спрайта: сдвиг+слияние плоскостей (тик)"],
 ["vsp_row","vsp_masks","  из неё горячая петля сдвига строки vsp_row"],
 ["vsd_orl","vop_on","  из неё слияние плоскостей пары vsd_orl"],
 ["vsp_fastmark","vec_spr_out","решатель слитой записи (тик)"],
 ["vec_spr_out","vec_knife_erase","ПАЧКА ВЫВОДА целиком (ISR)"],
 ["vec_spr_show","vsb_or","  вход старого пути (vec_spr_show)"],
 ["vsb_or","vsb_merge","  старый OR-вывод (vsb_or)"],
 ["vsb_merge","vso_merge1","  СЛИТАЯ ЗАПИСЬ (vsb_merge+vsb_mcol)"],
 ["vso_merge1","vsm_shift","  вход слитой записи + vpr_save"],
 ["vsm_shift","vsb_andn","  сдвиг фона в слоте (vsm_shift)"],
 ["vsb_andn","vec_knife_erase","  гашение плоскости (vsb_andn)"],
 ["vpr_scan","vpr_wr","  поиск пары (vpr_scan, тик)"],
 ["vpr_wr","vso_setidx","  чередованная запись пары (vpr_wr)"],
 ["vso_sortord","vso_prev","  сортировка порядка вывода"],
 ["vec_knife_erase","vkn_m2s","короткий путь ножа"]];
console.log(`\n=== ИМЕННЫЕ УЧАСТКИ (по диапазону адресов) ===`);
for(const [a,b,nm] of spans){
  if(L[a]===undefined||L[b]===undefined){console.log(`  нет метки ${a}/${b}`);continue;}
  let c8=0,cz=0,n=0;
  for(let pc=L[a];pc<L[b];pc++){
    if(!cnt[pc])continue;const op=rd(pc);
    let v;
    if(isCondCall(op)||isCondRet(op)){const tk=takenCnt[pc];v=tk*z80clk(op,true)+(cnt[pc]-tk)*z80clk(op,false);}
    else v=cnt[pc]*z80clk(op,false);
    c8+=cy8[pc];cz+=v;n+=cnt[pc];
  }
  if(!n)continue;
  console.log(`  ${(nm||a).padEnd(54)} НА КАДР С ПАЧКОЙ i8080 ${(c8/P).toFixed(0)}, Z80 ${(cz/P).toFixed(0)}, выигрыш ${((c8-cz)/P).toFixed(0)} (${((c8-cz)/c8*100).toFixed(0)}%) | на любой кадр геймплея ${(c8/F).toFixed(0)} -> ${(cz/F).toFixed(0)}`);
}

// ---------- счётчики байт: сколько байт реально проходит через горячие петли ----------
const probes=[["vsu_rcol (restore, pop de)","vsu_rcol",0xD1,2,150],
              ["vsu_srow (save, pop de)","vsu_srow",0xD1,2,80],
              ["vsb_mcol (слитая запись, ld a,(de))","vsb_mcol",0x1A,1,220],
              ["vsb_or (старый OR-вывод, ld a,(de))","vsb_or",0x1A,1,220],
              ["vsb_andn (гашение, ld a,(de))","vsb_andn",0x1A,1,90],
              ["vsm_p2u (сдвиг слота вверх)","vsm_p2u",0x1A,1,60],
              ["vsm_p2dl (сдвиг слота вниз)","vsm_p2dl",0x1A,1,60],
              ["vsm_p1r (хвост габарита)","vsm_p1r",0x7E,1,12],
              ["vsm_p3r (край габарита)","vsm_p3r",0x0A,1,12]];
console.log(`\n=== ОБЪЁМ: БАЙТ В КАДР ЧЕРЕЗ КАЖДУЮ ПЕТЛЮ ===`);
let fbBytes=0;
for(const [nm,l0,opWant,bytesPer,span] of probes){
  if(L[l0]===undefined){console.log(`  нет метки ${l0}`);continue;}
  let ex=0;
  for(let pc=L[l0];pc<L[l0]+span;pc++){if(cnt[pc]&&rd(pc)===opWant)ex+=cnt[pc];}
  const b=ex*bytesPer/P;
  if(/vsb_mcol|vsb_or|vsb_andn/.test(nm))fbBytes+=b;
  console.log(`  ${nm.padEnd(38)} ${(ex/P).toFixed(1).padStart(7)} исп/пачкокадр -> ${b.toFixed(1).padStart(7)} байт/пачкокадр`);
}
console.log(`  ИТОГО байт в фреймбуфер за кадр (слитая + старый OR + гашение): ${fbBytes.toFixed(1)}`);

const byC=[...perLab.entries()].sort((a,b)=>b[1].c8-a[1].c8);
console.log(`\n=== ТОП-40 РЕГИОНОВ ПО ТАКТАМ i8080 ===`);
for(const [k,e] of byC.slice(0,40))
  console.log(`  ${(e.c8/F).toFixed(0).padStart(7)} т/кадр  ${(e.n/F).toFixed(1).padStart(8)} исп/кадр  ${k}`);
