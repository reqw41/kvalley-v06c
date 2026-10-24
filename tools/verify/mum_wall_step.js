// Мумия на 25 Гц: два шага 0xA8 с chkChocaAndar2 между ними. ×2 одним
// mueve минует X&7==0/4 и X оказывается в тайле 0x10 (стена/платформа).
// Смотрим живых мумий: шаг влево ≥2, пропущенный X&7∈{0,4} лежит в 0x10 на Y или Y+8.
"use strict";
const { make, toGame } = require("./beam_harness.js");
const ROM = process.argv[2] || "build/kvalley_8c.rom";
const SYM = process.argv[3] || "build/kvalley_8c.sym";
const FRAMES = +(process.env.FRAMES || 2500);
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
if (!L.GameStatus || !L.momiaDat || !L.MapaRAMRoot) {
  console.log("нет символов");
  process.exit(2);
}
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
if (L.vec_god) wr(L.vec_god, 1);

const STRIDE = 0x16;
const tile = (room, y, x) => rd(L.MapaRAMRoot + ((y >> 3) & 31) * 96 + room * 32 + ((x >> 3) & 31));
const isWall = (room, y, x) => (tile(room, y, x) & 0xF0) === 0x10 || (tile(room, y + 8, x) & 0xF0) === 0x10;
function tick() {
  const t0 = rd(L.timer);
  do v06c.oneInterrupt(true); while (rd(L.timer) === t0 && rd(L.GameStatus) === 5);
}

let walk2 = 0, leftWalks = 0, wallSkip = 0, dxMin = 0, dxMax = 0;
const bad = [];
if (L.mumWalk2) {
  const W2 = L.mumWalk2;
  v06c.check_breakpoint = function () { if (cpu.pc === W2) walk2++; return false; };
}
const prev = [];
for (let i = 0; i < 4; i++) prev[i] = { st: -1, x: -1, y: -1, room: -1 };

for (let f = 0; f < FRAMES; f++) {
  wr(L.controlPlayer, rd(L.controlPlayer) | 0x40);
  tick();
  if (rd(L.GameStatus) !== 5) break;
  for (let i = 0; i < 4; i++) {
    const p = L.momiaDat + i * STRIDE;
    const st = rd(p), x = rd(p + 5), y = rd(p + 3), room = rd(p + 6), ctrl = rd(p + 1);
    const pr = prev[i];
    if (st === 0 && pr.st === 0 && pr.room === room) {
      const dx = (x - pr.x) << 24 >> 24;
      if (dx < dxMin) dxMin = dx;
      if (dx > dxMax) dxMax = dx;
      if ((ctrl & 4) && dx < 0) {
        leftWalks++;
        for (let k = 1; k < -dx; k++) {
          const s = (pr.x - k) & 255;
          if (((s & 7) === 0 || (s & 7) === 4) && isWall(room, y, s)) {
            wallSkip++;
            if (bad.length < 8) bad.push("i=" + i + " " + pr.x + "->" + x + " skip " + s + " y=" + y + " f=" + f);
          }
        }
      }
    }
    prev[i] = { st, x, y, room };
  }
}

console.log("leftWalks", leftWalks, "walk2", walk2, "dx", dxMin + ".." + dxMax, "wallSkip", wallSkip);
if (bad.length) console.log("  " + bad.join("\n  "));
if (!leftWalks) { console.log("FAIL пустая выборка: мумия не шла влево"); process.exit(1); }
if (!walk2) { console.log("FAIL mumWalk2 не звался"); process.exit(1); }
if (wallSkip) { console.log("FAIL мумия проскочила стену"); process.exit(1); }
console.log("OK");
process.exit(0);
