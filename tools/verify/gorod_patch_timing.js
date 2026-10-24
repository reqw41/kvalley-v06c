// ПОЧЕМУ пропатченный ROM не совпадает с оригиналом байт-в-байт, хотя хук ничего не трогает.
// Гипотеза: игра НЕ ждёт кадр в halt — она считает в главном цикле, а ISR отъедает такты.
// Любое удорожание ISR сдвигает фазу и меняет «случайность» демо.
//
// Опыт РАЗДЕЛЯЕТ две причины:
//   A) ОРИГИНАЛ против ОРИГИНАЛА+ЗАДЕРЖКА: тот же ROM, но на инструкции 0x01FF ему
//      дописывается ровно D vcycles (памяти и портов не касаемся вовсе).
//   B) ОРИГИНАЛ+ЗАДЕРЖКА против ПАТЧА: если совпало байт-в-байт, значит весь эффект
//      патча — ровно эта задержка, побочных действий у хука нет.
"use strict";
const {make} = require("./gorod_z80_harness.js");
const DIR = "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/";
const ORIG = process.argv[2] || DIR+"kvalley.rom";
const PATCHED = process.argv[3] || DIR+"kvalley_Lcenter.rom";
const NF = +(process.argv[4]||1200);
const D  = +(process.argv[5]||108);
// байты, которые патч меняет ПО ОПРЕДЕЛЕНИЮ (сверять их бессмысленно)
const SKIP = new Set([0x01ff,0x0200,0x0201,0x020b,0x00fe,0x00ff]);
for(let a=0x000b;a<=0x0027;a++) SKIP.add(a);

function delayed(rom, d){
  const E = make(rom);
  const orig = E.cpu.instruction.bind(E.cpu);
  E.cpu.instruction = function(){ const pc=this.pc; const c=orig(); if(pc===0x01ff){ this.vcycles=c+d; return c+d; } return c; };
  return E;
}
function firstDiff(X,Y,lo,hi){ for(let a=lo;a<=hi;a++){ if(SKIP.has(a)) continue; if(X.rd(a)!==Y.rd(a)) return a; } return -1; }

console.log(`=== A) оригинал vs оригинал+${D} vcycles на кадр ===`);
{
  const X = make(ORIG), Y = delayed(ORIG, D);
  let f0=-1, a0=-1;
  for(let f=0;f<NF;f++){
    X.v06c.oneInterrupt(true); Y.v06c.oneInterrupt(true);
    if(f0<0){ const a=firstDiff(X,Y,0x0100,0xffff); if(a>=0){ f0=f; a0=a; } }
  }
  if(f0<0) console.log(`  оригинал НЕ чувствителен к задержке ${D} за ${NF} кадров — расхождение патча имеет другую причину!`);
  else console.log(`  ЧУВСТВИТЕЛЕН: первое расхождение на кадре ${f0}, адрес 0x${a0.toString(16)} (только из-за тактов, память и порты не тронуты)`);
}
console.log(`=== B) оригинал+${D} vcycles vs пропатченный ROM ===`);
{
  const Y = delayed(ORIG, D), Q = make(PATCHED);
  let bad=0, first=null, cmps=0;
  for(let f=0;f<NF;f++){
    Y.v06c.oneInterrupt(true); Q.v06c.oneInterrupt(true);
    // до 120-го кадра оба ещё РАСПАКОВЫВАЮТСЯ (у патча ldir на 70 байт длиннее, копир
    // съедает свои такты) — там сверять нечего, работа просто в разной точке
    if(f>=120 && (f%25===24 || f===NF-1)){
      cmps++;
      const a = firstDiff(Y,Q,0x0100,0xffff);
      if(a>=0){ bad++; console.log(`    расхождение: кадр ${f}, адрес 0x${a.toString(16)}: задержка ${Y.rd(a)} / патч ${Q.rd(a)}`); if(!first) first=`кадр ${f}`; }
    }
  }
  console.log(`  сверок: ${cmps}, расхождений: ${bad}`);
  if(bad===0) console.log(`  ВЫВОД: пропатченный ROM байт-в-байт равен оригиналу, которому просто дописали ${D} тактов в ISR.`);
  else console.log(`  первое расхождение: ${first}`);
  process.exit(bad?1:0);
}
