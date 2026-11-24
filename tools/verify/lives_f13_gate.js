// [lives-f13] Бесконечные жизни с титула: F1+F3 -> старт партии, гибель жизнь не отнимает; обычный SPACE -> жизни
// убывают до game over. Гибель — штатным касанием мумии (как jingle_tempo_gate: PC с «мумия в комнате?» в momiaMataProta).
// node tools/verify/lives_f13_gate.js <rom> <sym>   (рядом .lst)
"use strict";
const BH = require("./beam_harness.js");
const [rom, sym] = process.argv.slice(2);
const lst = require("fs").readFileSync(rom.replace(/\.rom$/, ".lst"), "utf8").split("\n");
const iMM = lst.findIndex(x => /jp c,momiaMataProta/.test(x));
let KILL_AT = -1;
for (let i = iMM; i >= 0 && KILL_AT < 0; i--) { const m = /^\S+\s+([0-9A-F]{4}) C2 .*jp nz,chkLastACTOR_/.exec(lst[i]); if (m) KILL_AT = parseInt(m[1], 16); }
function party(keys) {
  const E = BH.make(rom, sym); const { cpu, v06c, rd, key, L } = E;
  let want = false;
  v06c.check_breakpoint = () => { if (want && cpu.pc === KILL_AT) { want = false; cpu.pc = L.momiaMataProta; } return false; };
  const step = () => v06c.oneInterrupt(true), runN = n => { for (let i = 0; i < n; i++) step(); };
  let f = 0; while (rd(L.GameStatus) !== 1 && f < 4000) { step(); f++; }
  runN(20); keys.forEach(k => key(k, 1)); runN(12); keys.forEach(k => key(k, 0));
  f = 0; while (rd(L.GameStatus) !== 5 && f < 2000) { step(); f++; }
  const out = { start: rd(L.GameStatus), cheat: rd(L.vec_cheats), vidas: [rd(L.Vidas)] };
  for (let k = 0; k < 5; k++) {
    want = true; for (let i = 0; i < 1500 && rd(L.GameStatus) === 5; i++) step(); want = false;
    for (let i = 0; i < 1500; i++) { step(); if ([5, 0, 1, 7].includes(rd(L.GameStatus))) break; }
    runN(60); out.vidas.push(rd(L.Vidas) + "@GS" + rd(L.GameStatus));
    if (rd(L.GameStatus) !== 5) break;
  }
  return out;
}
const a = party([112, 114]), b = party([32]);
console.log("F1+F3:", JSON.stringify(a)); console.log("SPACE:", JSON.stringify(b));
const okA = a.start === 5 && a.cheat === 1 && a.vidas.slice(1).every(v => v === a.vidas[0] + "@GS5");
const okB = b.start === 5 && b.cheat === 0 && !String(b.vidas[b.vidas.length - 1]).endsWith("@GS5");
console.log(okA && okB ? "РЕЗУЛЬТАТ: ОК" : "РЕЗУЛЬТАТ: ПРОВАЛ"); process.exit(okA && okB ? 0 : 1);
