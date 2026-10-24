// АУДИТ ЗАНЯТОСТИ СТРАНИЦ save-under (p3, 0xE000-0xF4FF) — ПОЯЧЕЕЧНО.
//
// ЗАЧЕМ. save-under занимает 5376 Б = 2/3 всей плоскости p3, по ЦЕЛОЙ СТРАНИЦЕ на слот
// (H = 0xE0+idx, вычислений ноль). Вопрос владельца: сколько байт страницы РЕАЛЬНО живёт?
// Если половина пустует, есть соблазн перейти на полстраницы (0xE0+(idx>>1), смещение 0/128)
// и освободить ~2.6 КБ. Решать это можно только замером: «прикидка по геометрии» врёт,
// потому что в странице живут ТРИ разных вещи (шапка слота, данные фона, ЗАПИСЬ ВЫВОДА).
//
// ЧТО СЧИТАЕТ, отдельно для каждого из 21 слота и отдельно для КАЖДОГО смещения 0..255:
//   R  — чтений в игре (включая POP-хайджек: pop в i8080-js идёт через memory.read),
//   W  — записей в игре,
//   Wc — из них записей БЛОЧНОЙ ОЧИСТКОЙ (HideSprites/hsClrSU при загрузке уровня и
//        vec_init_clr на буте). Их надо вычитать: они пишут ВСЮ страницу и скрывают
//        картину (тот же приём, что в tools/debug/varblock_map.js с vec_ldir_*).
// Итог по слоту: максимальное ЖИВОЕ смещение (max offset, где R>0 или W-без-очистки>0)
// и число живых байт. Плюс сводка: сколько байт можно было бы срезать со страницы.
//
// Запуск: node tools/debug/p3_slot_audit.js [rom] [sym]
"use strict";
const fs = require("fs");
const { make, toGame } = require("../verify/beam_harness.js");
const T = __dirname, REPO = T + "/../..";
const ROM = process.argv[2] || REPO + "/build/kvalley_8c.rom";
const SYM = process.argv[3] || REPO + "/build/kvalley_8c.sym";
const E = make(ROM, SYM);
const { L, rd, v06c, memory, cpu, key } = E;

const BASE = L.vec_spr_save || 0xE000, NSLOT = 21;
const LO = BASE, HI = 0xFFFF, N = HI - LO + 1;
const R = new Uint32Array(N), W = new Uint32Array(N), Wc = new Uint32Array(N), X = new Uint32Array(N);
const writers = new Map();   // offset -> Map(pc -> n), только для слотов
let phase = 0;               // 0 = бут, 1 = игра

// PC-диапазоны блочных очисток: HideSprites (петли hsClrP3/hsClrSU) и vec_init_clr.
const CLR = [[L.HideSprites, L.HideSprites + 0x60], [L.vec_init_clr, L.vec_init_clr + 0x20]];
const isClr = pc => CLR.some(([a, b]) => a !== undefined && pc >= a && pc < b);

const ord = memory.read.bind(memory), owr = memory.write.bind(memory);
memory.read = function (a, s) { const aa = a & 0xffff; if (phase && aa >= LO) R[aa - LO]++; return ord(a, s); };
memory.write = function (a, v, s) {
  const aa = a & 0xffff;
  if (phase && aa >= LO) {
    const pc = cpu.pc & 0xffff;
    if (isClr(pc)) Wc[aa - LO]++; else {
      W[aa - LO]++;
      if (aa < BASE + NSLOT * 256) {
        const off = aa & 255; let m = writers.get(off); if (!m) writers.set(off, m = new Map());
        m.set(pc, (m.get(pc) || 0) + 1);
      }
    }
  }
  return owr(a, v, s);
};
const oins = cpu.instruction.bind(cpu);
cpu.instruction = function () { const pc = cpu.pc & 0xffff; if (phase && pc >= LO) X[pc - LO]++; return oins(); };

// ---- сценарий: тот же охват, что у tools/debug/lowram_audit.js ----
const rdr = a => ord(a & 0xffff, false), wr = (a, v) => owr(a & 0xffff, v, false);
const run = n => { for (let i = 0; i < n; i++) v06c.oneInterrupt(true); };
const GS = L.GameStatus;
run(400); phase = 1;
let ok = false;
for (let blk = 0; blk < 60 && !ok; blk++) {
  for (let f = 0; f < 25; f++) { key(32, 1); run(1); if (rdr(GS) === 5 && (rdr(L.flagPiramideMap) & 1)) { ok = true; break; } }
  key(32, 0); run(5);
}
if (!ok) { console.log("НЕ ВОШЛИ В ГЕЙМПЛЕЙ"); process.exit(2); }
run(60);
let seed = 20260803; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const KEYS = [37, 39, 38, 40, 32];
for (const dir of [39, 37, 39]) { key(dir, 1); run(300); key(dir, 0); run(20); }
for (let f = 0; f < 2500; f++) {
  const k = KEYS[(rnd() * KEYS.length) | 0];
  key(k, 1); run(1); if (rnd() < 0.35) key(k, 0);
  for (const kk of KEYS) if (rnd() < 0.2) key(kk, 0);
}
for (const kk of KEYS) key(kk, 0);
run(30);
const HOPS = +(process.env.KV_HOPS || 8);
for (let step = 0; step < HOPS; step++) {   // переходы через карту долины (чит N)
  key(78, 1); run(3); key(78, 0);
  for (let f = 0; f < 900; f++) { run(1); if (rdr(GS) === 5) break; }
  run(40);
  for (let f = 0; f < 500; f++) { const k = KEYS[(rnd() * KEYS.length) | 0]; key(k, 1); run(1); key(k, 0); }
}
for (const st of [6, 8]) { wr(GS, st); wr(L.subStatus, 0); run(300);
  for (let blk = 0; blk < 20 && rdr(GS) !== 5; blk++) { key(32, 1); run(10); key(32, 0); run(10); } }
run(100);

// ---------------------------- ОТЧЁТ ----------------------------
const sum = (arr, a, b) => { let s = 0; for (let i = a; i <= b; i++) s += arr[i - LO]; return s; };
console.log(`ROM=${ROM}\nбаза слотов 0x${BASE.toString(16)}, слотов ${NSLOT} по 256 Б = ${NSLOT * 256} Б\n`);
console.log("слот  адрес   R(игра)  W(игра)  W(очистка)  живых Б  max живое смещ.  карта живых зон");
let totalLive = 0, deadSlots = [];
const rows = [];
for (let i = 0; i < NSLOT; i++) {
  const a = BASE + i * 256, b = a + 255;
  const r = sum(R, a, b), w = sum(W, a, b), wc = sum(Wc, a, b);
  let live = 0, maxOff = -1; const liveMask = [];
  for (let o = 0; o < 256; o++) {
    const alive = R[a + o - LO] > 0 || W[a + o - LO] > 0;
    if (alive) { live++; if (o > maxOff) maxOff = o; }
    liveMask.push(alive);
  }
  // сжатая карта: диапазоны живых смещений
  const zones = []; let s = -1;
  for (let o = 0; o <= 256; o++) { const al = o < 256 && liveMask[o];
    if (al && s < 0) s = o; else if (!al && s >= 0) { zones.push(`${s}-${o - 1}`); s = -1; } }
  totalLive += live;
  if (live === 0) deadSlots.push(i);
  rows.push([i, a, r, w, wc, live, maxOff, zones.join(",")]);
  console.log(`  ${String(i).padStart(2)}  0x${a.toString(16)}  ${String(r).padStart(8)} ${String(w).padStart(8)} ${String(wc).padStart(11)}  ${String(live).padStart(7)}  ${String(maxOff).padStart(15)}  ${zones.join(",")}`);
}
console.log(`\nЖИВЫХ БАЙТ ВСЕГО: ${totalLive} из ${NSLOT * 256} (${(100 * totalLive / (NSLOT * 256)).toFixed(1)}%)`);
console.log(`МЁРТВЫЕ СЛОТЫ ЦЕЛИКОМ: ${deadSlots.length ? deadSlots.join(", ") : "нет"}  (${deadSlots.length * 256} Б)`);
const maxLiveOff = Math.max(...rows.map(r => r[6]));
console.log(`МАКСИМАЛЬНОЕ ЖИВОЕ СМЕЩЕНИЕ ПО ВСЕМ СЛОТАМ: ${maxLiveOff} => страница обязана быть >= ${maxLiveOff + 1} Б`);
console.log(`  при шаге 128 Б экономия была бы ${NSLOT * 128} Б, при шаге 192 Б — ${NSLOT * 64} Б`);
console.log(`  ФАКТ: шаг возможен только >= ${maxLiveOff + 1} Б (иначе слоты налезут друг на друга)`);

console.log("\n== КТО ПИШЕТ В КАКОЕ СМЕЩЕНИЕ (топ-PC на смещение, только живые) ==");
const offs = [...writers.keys()].sort((a, b) => a - b);
const labels = [];
for (const l of fs.readFileSync(SYM, "latin1").split("\n")) { const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) labels.push([parseInt(m[2], 16), m[1]]); }
labels.sort((a, b) => a[0] - b[0]);
const lbl = pc => { let lo = 0, hi = labels.length - 1, r = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (labels[m][0] <= pc) { r = m; lo = m + 1; } else hi = m - 1; } return labels[r][1]; };
// сгруппировать смежные смещения с одинаковым набором писателей
let prevKey = null, start = 0;
const packed = [];
for (let o = 0; o <= 255; o++) {
  const m = writers.get(o);
  const k = m ? [...m.keys()].sort((a, b) => a - b).map(lbl).join("|") : "";
  if (k !== prevKey) { if (prevKey !== null) packed.push([start, o - 1, prevKey]); prevKey = k; start = o; }
}
packed.push([start, 255, prevKey]);
for (const [a, b, k] of packed) if (k) console.log(`  смещ. ${String(a).padStart(3)}-${String(b).padStart(3)} (${b - a + 1} Б): ${k}`);
const dead = packed.filter(([, , k]) => !k).map(([a, b]) => `${a}-${b}`).join(", ");
console.log(`  НИКТО НЕ ПИШЕТ: смещения ${dead}`);

console.log("\n== ОСТАЛЬНАЯ p3 (0xF500-0xFFFF), R/W по зонам описи ==");
const ZON = [[0xF500, 0xF5BF, "vec_spr_buf_mir (живая часть)"], [0xF5C0, 0xF63F, "ДЫРА внутри mir (опись: R=0,W=1024)"],
  [0xF640, 0xF69F, "vec_spr_buf_mir (хвост)"], [0xF6A0, 0xF83F, "СВОБОДНО #1 (416 Б)"],
  [0xF840, 0xF99F, "vec_spr_buf (sprites2/карта)"], [0xF9A0, 0xFBFF, "pat_maze_cell"],
  [0xFC00, 0xFCFF, "переменные рендера"], [0xFD00, 0xFD03, "vkn_list"], [0xFD04, 0xFFFF, "СВОБОДНО #2 (764 Б)"]];
for (const [a, b, name] of ZON) {
  let live = 0; for (let o = a; o <= b; o++) if (R[o - LO] || W[o - LO]) live++;
  console.log(`  0x${a.toString(16)}-0x${b.toString(16)} ${String(b - a + 1).padStart(5)} Б  R=${String(sum(R, a, b)).padStart(7)} W=${String(sum(W, a, b)).padStart(7)} Wочистка=${String(sum(Wc, a, b)).padStart(6)} живых байт=${String(live).padStart(4)}  ${name}`);
}
