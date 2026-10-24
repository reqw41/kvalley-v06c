// z80_lines.js — ПОСТРОЧНЫЙ пересчёт петли: такты i8080 против тактов Z80 на шине
// Вектора-06Ц. Статический инструмент (эмулятор не нужен): берёт build/kvalley_8c.lst,
// вырезает диапазон адресов между двумя метками и печатает цену каждой строки.
//
// ТАКТЫ i8080 — таблица снята С ЭМУЛЯТОРА vector06js (он же источник всех чисел
// проекта): NOP 4, MOV r,r 8, MOV r,M 8, INR/DCR r 8, INX/DCX 8, MVI r 8, ALU r 4,
// ALU M 8, LDA/STA 16, LHLD/SHLD 20, LDAX/STAX 8, DAD 12, JMP/Jcc 12, CALL 24,
// Ccc 16/24, RET 12, Rcc 8/16, PUSH/RST 16, POP 12, XTHL 24, PCHL/SPHL 8, XCHG 4,
// IN/OUT 12, INR M/DCR M 12, MVI M 12, EI/DI 4.
// ТАКТЫ Z80 — та же модель шины (одно обращение на 4 такта, cpu_ready общий для обоих
// процессоров по RTL MiSTer): слоты = M1 + память + порты + ceil(внутренние/4).
// Проверка модели: она в точности воспроизводит таблицу i8080 выше из T-состояний 8080.
//
// Запуск: node tools/verify/z80_lines.js <метка_начала> <метка_конца> [lst] [sym]
"use strict";
const fs=require("fs");
const T=__dirname;
const A=process.argv[2],B=process.argv[3];
const LST=process.argv[4]||T+"/../../build/kvalley_8c.lst";
const SYM=process.argv[5]||T+"/../../build/kvalley_8c.sym";
const L={};for(const l of fs.readFileSync(SYM,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
if(L[A]===undefined||L[B]===undefined){console.log("нет метки");process.exit(1);}

// ---- i8080 (как считает vector06js = как считает проект) ----
function c8080(op,taken){
  if(op===0x76)return 4;
  if(op>=0x40&&op<0x80)return 8;                                  // MOV (любой)
  if(op>=0x80&&op<0xC0)return((op&7)===6)?8:4;                    // ALU r / ALU M
  switch(op){
    case 0x00:case 0x07:case 0x0F:case 0x17:case 0x1F:
    case 0x27:case 0x2F:case 0x37:case 0x3F:case 0xEB:
    case 0xF3:case 0xFB: return 4;
    case 0x01:case 0x11:case 0x21:case 0x31: return 12;
    case 0x02:case 0x12:case 0x0A:case 0x1A: return 8;
    case 0x22:case 0x2A: return 20;
    case 0x32:case 0x3A: return 16;
    case 0x34:case 0x35:case 0x36: return 12;
    case 0x09:case 0x19:case 0x29:case 0x39: return 12;
    case 0xE3: return 24; case 0xE9:case 0xF9: return 8;
    case 0xC9: return 12; case 0xCD: return 24; case 0xC3: return 12;
    case 0xD3:case 0xDB: return 12;
  }
  if((op&0xCF)===0x03||(op&0xCF)===0x0B)return 8;                   // INX/DCX
  if((op&0xC7)===0x04||(op&0xC7)===0x05||(op&0xC7)===0x06)return 8; // INR/DCR/MVI r
  if((op&0xC7)===0xC6)return 8;                                     // ALU imm
  if((op&0xC7)===0xC7)return 16;                                    // RST
  if((op&0xCF)===0xC1)return 12;                                    // POP
  if((op&0xCF)===0xC5)return 16;                                    // PUSH
  if((op&0xC7)===0xC2)return 12;                                    // Jcc
  if((op&0xC7)===0xC4)return taken?24:16;                           // Ccc
  if((op&0xC7)===0xC0)return taken?16:8;                            // Rcc
  return null;
}
// ---- Z80 на той же шине ----
function z80info(op,taken){
  if(op===0x76)return[4,0,0];
  if(op>=0x40&&op<0x80)return((op&7)===6||(op&0x38)===0x30)?[7,1,0]:[4,0,0];
  if(op>=0x80&&op<0xC0)return((op&7)===6)?[7,1,0]:[4,0,0];
  switch(op){
    case 0x00:case 0x07:case 0x0F:case 0x17:case 0x1F:
    case 0x27:case 0x2F:case 0x37:case 0x3F:
    case 0xE9:case 0xEB:case 0xF3:case 0xFB: return[4,0,0];
    case 0x01:case 0x11:case 0x21:case 0x31: return[10,2,0];
    case 0x02:case 0x12:case 0x0A:case 0x1A: return[7,1,0];
    case 0x22:case 0x2A: return[16,4,0];
    case 0x32:case 0x3A: return[13,3,0];
    case 0x03:case 0x13:case 0x23:case 0x33:
    case 0x0B:case 0x1B:case 0x2B:case 0x3B: return[6,0,0];
    case 0x34:case 0x35: return[11,2,0];
    case 0x36: return[10,2,0];
    case 0x09:case 0x19:case 0x29:case 0x39: return[11,0,0];
    case 0xE3: return[19,4,0];
    case 0xF9: return[6,0,0];
    case 0xC9: return[10,2,0];
    case 0xCD: return[17,4,0];
    case 0xC3: return[10,2,0];
    case 0xD3:case 0xDB: return[11,1,1];
  }
  if((op&0xC7)===0x04||(op&0xC7)===0x05)return[4,0,0];
  if((op&0xC7)===0x06)return[7,1,0];
  if((op&0xC7)===0xC6)return[7,1,0];
  if((op&0xC7)===0xC7)return[11,2,0];
  if((op&0xCF)===0xC1)return[10,2,0];
  if((op&0xCF)===0xC5)return[11,2,0];
  if((op&0xC7)===0xC2)return[10,2,0];
  if((op&0xC7)===0xC4)return taken?[17,4,0]:[10,2,0];
  if((op&0xC7)===0xC0)return taken?[11,2,0]:[5,0,0];
  return null;
}
function cz80(op,taken){const it=z80info(op,taken);if(!it)return null;
  const[t,mem,prt]=it;const inner=t-4-3*mem-4*prt;
  return 4*(1+mem+prt+(inner>0?Math.ceil(inner/4):0));}
const isCond=op=>((op&0xC7)===0xC4)||((op&0xC7)===0xC0);

const lines=fs.readFileSync(LST,"utf8").split("\n");
let s8=0,sz=0,n=0;
console.log(`=== ${A} .. ${B} ===`);
console.log(`адрес  байты        i8080  Z80   исходник`);
for(const ln of lines){
  const m=ln.match(/^\d+[+ ]\s+([0-9A-F]{4})\s(.*)$/);
  if(!m)continue;
  const a=parseInt(m[1],16); if(a<L[A]||a>=L[B])continue;
  const rest=m[2];
  const bm=rest.match(/^((?:[0-9A-F]{2} )+)\s*(.*)$/);
  if(!bm)continue;
  const bytes=bm[1].trim(), src=bm[2].replace(/\s+/g," ").trim();
  const op=parseInt(bytes.slice(0,2),16);
  const c=c8080(op,true), z=cz80(op,true);
  if(c===null||z===null){console.log(`${m[1]}  ${bytes.padEnd(11)}   ?     ?    ${src}`);continue;}
  const c2=c8080(op,false), z2=cz80(op,false);
  const cs=isCond(op)?`${c2}/${c}`:`${c}`, zs=isCond(op)?`${z2}/${z}`:`${z}`;
  s8+=c;sz+=z;n++;
  const d=z-c;
  console.log(`${m[1]}  ${bytes.padEnd(11)} ${cs.padStart(5)} ${zs.padStart(5)}  ${d<0?"-":d>0?"+":" "}  ${src}`);
}
console.log(`ИТОГО по диапазону (каждая строка по разу, условные — как взятые): i8080 ${s8}, Z80 ${sz}, разница ${sz-s8} (${((sz-s8)/s8*100).toFixed(1)}%)`);
