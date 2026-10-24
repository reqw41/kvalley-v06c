// ВЫДЕРЖКА пропатченного ROM: длинный прогон с нажатиями (старт партии, ходьба, прыжки,
// пауза F1, самоликвидация F2) — не затрёт ли игра сам патч и не полезет ли она сама
// в скролл. Провал, если:
//   * кто-то, кроме хука, пишет в 0x000B..0x0027 (тело хука) или 0x01FF..0x0201 (call);
//   * в 0x020B пишет не хук;
//   * в порт 3 попадает значение скролла не из 0x020A;
//   * L перестаёт переключать.
"use strict";
const {make} = require("./gorod_z80_harness.js");
const DIR = "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/";
const ROM = process.argv[2] || DIR+"kvalley_Lcenter.rom";
const NF  = +(process.argv[3]||6000);
const KEY = {L:76, SPACE:32, LEFT:37, RIGHT:39, UP:38, DOWN:40, F1:112, F2:113, ENTER:13};
let checks=0, fails=0;
const ok  = m=>{ checks++; console.log("  ok    "+m); };
const bad = m=>{ checks++; fails++; console.log("  ПРОВАЛ "+m); };

const E = make(ROM);
E.run(150);                                   // распаковка + установка патча
const guard = [];                             // чужие записи в тело патча
const scrollW = new Map();                    // кто пишет 0x020B
E.trace.onWrite = (a,v)=>{
  const pc = E.cpu.pc;
  if ((a>=0x000b&&a<=0x0027) || (a>=0x01ff&&a<=0x0201)){
    if (!(pc>=0x000b && pc<=0x0028)) guard.push(`0x${a.toString(16)} <- PC 0x${pc.toString(16)} (val ${v})`);
  }
  if (a===0x020b) scrollW.set(pc,(scrollW.get(pc)||0)+1);
};
const out3 = new Map();
const origOut = E.io.output.bind(E.io);
E.io.output = function(p,v){ if(p===3 && v!==0xfe && v!==0xfd && v!==0x7f && v!==0xdf){
  const pc=(E.cpu.pc-2)&0xffff; out3.set(`${pc.toString(16)}|${v.toString(16)}`,(out3.get(`${pc.toString(16)}|${v.toString(16)}`)||0)+1); }
  return origOut(p,v); };

// сценарий: тычем клавишами, чтобы уйти из демо в партию и походить
const seq = [KEY.SPACE, KEY.ENTER, KEY.SPACE, KEY.RIGHT, KEY.LEFT, KEY.UP, KEY.DOWN,
             KEY.SPACE, KEY.RIGHT, KEY.F1, KEY.F1, KEY.RIGHT, KEY.SPACE, KEY.F2, KEY.SPACE];
let toggles = 0, lastScroll = E.io.ScrollStart(), flips = 0;
for(let f=0; f<NF; f++){
  const k = seq[(f>>5)%seq.length];
  if (f%32===0) E.key(k,true);
  if (f%32===12) E.key(k,false);
  // каждые ~500 кадров дёргаем L
  if (f%500===200){ E.key(KEY.L,true); toggles++; }
  if (f%500===206){ E.key(KEY.L,false); }
  E.v06c.oneInterrupt(true);
  const s = E.io.ScrollStart();
  if (s!==lastScroll){ flips++; lastScroll=s; }
}
console.log(`прогон ${NF} кадров, нажатий L: ${toggles}, смен скролла: ${flips}`);
guard.length===0 ? ok("тело хука и call в ISR никто, кроме хука, не трогал")
                 : bad("патч затирают: "+guard.slice(0,5).join("; "));
const badScroll = [...scrollW.keys()].filter(pc=>!(pc>=0x000b&&pc<=0x0028));
badScroll.length===0 ? ok(`в 0x020B пишет только хук (${[...scrollW.entries()].map(([p,c])=>`PC 0x${p.toString(16)}×${c}`).join(", ")||"ни разу"})`)
                     : bad("в 0x020B пишет посторонний: "+badScroll.map(p=>"0x"+p.toString(16)).join(","));
// PC ядра в момент io_write уже съехал по операнду, поэтому штатный `out (3),a` из 0x020A
// виден как 0x020A/0x020B — оба считаем «своим» источником
const badOut = [...out3.keys()].filter(k=>!["20a","20b"].includes(k.split("|")[0]));
badOut.length===0 ? ok(`значение скролла в порт 3 идёт только из 0x020A (${[...out3.entries()].map(([k,c])=>k+"×"+c).join(", ")})`)
                  : bad("посторонняя запись скролла: "+badOut.join(", "));
flips>=toggles ? ok(`скролл переключался ${flips} раз при ${toggles} нажатиях L`) : bad(`скролл переключился ${flips} раз при ${toggles} нажатиях`);
E.png(DIR+"soak.png"); console.log("  снимок конца прогона: "+DIR+"soak.png");
console.log(`=== ИТОГ: проверок ${checks}, провалов ${fails} ===`);
if (checks===0){ console.log("ПРОВАЛ ПОКРЫТИЯ"); process.exit(1); }
process.exit(fails?1:0);
