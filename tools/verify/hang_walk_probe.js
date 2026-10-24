// hang_walk_probe.js — ищем зависание тика: лимит инструкций на кадр + живой timer.
// Сцены: обычная ходьба (скролл комнат) и край evitaSorpresa5 (мумия у правого края соседней).
"use strict";
const { make, toGame } = require("./beam_harness.js");
const ROM = process.argv[2] || "build/kvalley_8c.rom";
const SYM = process.argv[3] || "build/kvalley_8c.sym";
const FRAMES = +(process.argv[4] || 4000);
const CAP = +(process.env.CAP || 250000);
const E = make(ROM, SYM);
const { L, rd, v06c, cpu, memory } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);
if (!L.GameStatus || !L.timer || !L.momiaDat) {
  console.log("нет символов GameStatus/timer/momiaDat");
  process.exit(2);
}
if (toGame(E) !== 5) { console.log("нет геймплея"); process.exit(1); }
if (L.vec_god) wr(L.vec_god, 1);

let insn = 0, frame0 = 0, decideFromEvita = 0;
const EVITA = L.evitaSorpresa, DECIDE = L.momiaDecide, EVITA6 = L.evitaSorpresa6;
v06c.check_breakpoint = function () {
  insn++;
  if (insn - frame0 > CAP) {
    throw new Error("HANG frame insn>" + CAP + " pc=" + cpu.pc.toString(16) +
      " gs=" + rd(L.GameStatus) + " timer=" + rd(L.timer));
  }
  if (cpu.pc === DECIDE) {
    const ra = memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8);
    if (EVITA && ra > EVITA && ra < (L.momiaDecide || 0xffff)) decideFromEvita++;
  }
  return false;
};

function runFrames(n, keys) {
  for (const c of [37, 39, 32, 38, 40]) E.key(c, keys.includes(c) ? 1 : 0);
  let stuck = 0, maxStuck = 0, lastT = rd(L.timer);
  for (let i = 0; i < n; i++) {
    frame0 = insn;
    v06c.oneInterrupt(true);
    const t = rd(L.timer), gs = rd(L.GameStatus), ip = rd(L.tickInProgress);
    if (t === lastT) {
      stuck++;
      if (stuck > maxStuck) maxStuck = stuck;
      if (stuck >= 40) {
        throw new Error("timer застыл " + stuck + " кадр t=" + t + " gs=" + gs +
          " ip=" + ip + " pc=" + cpu.pc.toString(16) + " sp=" + cpu.sp.toString(16));
      }
    } else { stuck = 0; lastT = t; }
    if (gs !== 5 && gs !== 9) {
      console.log("GS ушёл на", gs, "кадр", i, "timer", t);
      break;
    }
  }
  return maxStuck;
}

const MD = L.momiaDat;
function placeEdge() {
  const room = rd(L.ProtaRoom);
  wr(MD + 0, 0);
  wr(MD + 1, 8);
  wr(MD + 2, 2);
  wr(MD + 3, rd(L.ProtaY));
  wr(MD + 5, 0xC0);
  wr(MD + 6, (room + 1) & 255);
  wr(MD + 0x11, 8);
  wr(L.ProtaX, 0x80);
}

try {
  console.log("walk+fire…");
  const w1 = runFrames(Math.min(FRAMES, 2500), [39, 32]);
  console.log("  timer", rd(L.timer), "room", rd(L.ProtaRoom), "x", rd(L.ProtaX),
    "gs", rd(L.GameStatus), "maxStuck", w1, "insn/frame ~", ((insn / 2500) | 0));
  placeEdge();
  decideFromEvita = 0;
  console.log("evitaSorpresa5 edge…");
  const w2 = runFrames(600, [39]);
  console.log("  decideFromEvita", decideFromEvita, "timer", rd(L.timer),
    "m.stat", rd(MD), "m.ctrl", rd(MD + 1), "m.room", rd(MD + 6), "maxStuck", w2);
  if (decideFromEvita) throw new Error("evitaSorpresa провалилась в momiaDecide x" + decideFromEvita);
  console.log("PASS");
} catch (e) {
  console.log("FAIL", e.message);
  process.exit(1);
}
