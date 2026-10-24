#!/usr/bin/env node
// tick_profile.js — ПРОФИЛЬ ИГРОВОГО ТИКА ПО ТАКТАМ (не по инструкциям).
//
// Зачем: чтобы уместить тик в ОДИН кадр (50 Гц = 83% темпа оригинала MSX и, тем же
// движением, короче окно под лучом), надо знать, где лежат такты. Инструкционный профиль
// врёт на POP-хайджеках: там мало команд и много тактов, — поэтому считаем именно такты,
// беря их из растровой позиции эмулятора (cyc), с учётом перехода через кадр.
//
// Атрибуция — по БЛИЖАЙШЕЙ МЕТКЕ СНИЗУ. Помним про грабли (docs/JOURNAL): метка обрезает
// тело процедуры первой внутренней меткой, поэтому одна процедура видна как несколько
// строк — для поиска горячих мест это скорее плюс.
//
// Запуск: node tools/verify/tick_profile.js [rom] [sym] [--ticks N] [--scene walk|idle|mum]
"use strict";
const path = require("path");
const { make } = require("./beam_harness.js");
const REPO = path.join(__dirname, "../..");
const args = process.argv.slice(2);
let ROM = path.join(REPO, "build/kvalley_8c.rom");
let SYM = path.join(REPO, "build/kvalley_8c.sym");
let NTICKS = 120, SCENE = "mum";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/\.rom$/i.test(a)) ROM = a;
  else if (/\.sym$/i.test(a)) SYM = a;
  else if (a === "--ticks") NTICKS = +args[++i];
  else if (a === "--scene") SCENE = args[++i];
}
const E = make(ROM, SYM);
const { L, rd, v06c, memory, keyboard, cpu, cyc, FRAME } = E;
const wr = (a, v) => memory.write(a & 0xffff, v & 255, false);

// заход в геймплей, устойчивый к любой каденции (ждём GS=5 по кадрам, не по тикам)
function toGameAny() {
  const runf = n => { for (let i = 0; i < n; i++) v06c.oneInterrupt(true); };
  const key = (c, d) => { const e = { keyCode: c, which: c, preventDefault() {}, stopPropagation() {} }; d ? keyboard.keyDown(e) : keyboard.keyUp(e); };
  runf(600); key(112, 1); key(116, 1);
  let fr = 0; while (fr < 5000 && rd(L.GameStatus) !== 5) { v06c.oneInterrupt(true); fr++; }
  key(112, 0); key(116, 0); runf(40);
  return rd(L.GameStatus);
}
if (toGameAny() !== 5) { console.log("нет геймплея"); process.exit(1); }
function tick() { const t0 = rd(L.timer); do v06c.oneInterrupt(true); while (rd(L.timer) === t0); }
for (let i = 0; i < 30; i++) tick();
wr(L.vec_god, 1);
if (SCENE === "mum") {           // герой и мумия рядом — самый нагруженный случай
  const MD = L.momiaDat, hY = rd(L.ProtaY), hX = rd(L.ProtaX);
  wr(MD + 0, 0); wr(MD + 3, hY); wr(MD + 5, (hX + 12) & 255); wr(MD + 6, rd(L.ProtaRoom));
  wr(L.enemyAttrib, hY); wr(L.enemyAttrib + 1, (hX + 12) & 255);
  for (let i = 0; i < 10; i++) tick();
}
if (SCENE !== "idle") keyboard.keyDown({ keyCode: 39, which: 39, preventDefault() {}, stopPropagation() {} });

const syms = Object.entries(L).filter(([k, v]) => v >= 0x100 && v < 0x8000).sort((a, b) => a[1] - b[1]);
const addrs = syms.map(s => s[1]);
function nearest(pc) {           // двоичный поиск ближайшей метки снизу
  let lo = 0, hi = addrs.length - 1, r = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (addrs[m] <= pc) { r = m; lo = m + 1; } else hi = m - 1; }
  return syms[r][0];
}

const cost = new Map();
let frames = 0, inTick = false, prev = 0, ticks = 0, tickCycles = 0, packCycles = 0, inPack = false;
const now = () => frames * FRAME + cyc();
v06c.check_breakpoint = function () {
  const pc = cpu.pc, t = now();
  if (inTick) {
    let d = t - prev; if (d < 0) d += FRAME;            // страховка от рассинхрона кадра
    if (d > 0 && d < 4000) {
      const k = nearest(pc);
      cost.set(k, (cost.get(k) || 0) + d);
      tickCycles += d;
      if (inPack) packCycles += d;
    }
  }
  prev = t;
  if (pc === L.runGame && !inTick) { inTick = true; ticks++; }
  else if (pc === L.tickMain2 && inTick) inTick = false;
  if (pc === L.vec_spr_out) inPack = true;
  else if (pc === L.vso_prev) inPack = false;           // грубая граница пачки
  return false;
};
while (ticks < NTICKS && frames < NTICKS * 6) { v06c.oneInterrupt(true); frames++; }
v06c.check_breakpoint = () => false;

const total = tickCycles || 1;
const rows = [...cost.entries()].sort((a, b) => b[1] - a[1]).slice(0, 26);
console.log(`ROM=${path.basename(ROM)} сцена=${SCENE} тиков=${ticks} кадров=${frames}`);
console.log(`ТАКТОВ В ТИКЕ: всего ${Math.round(total / ticks)} (кадр = ${FRAME}), т.е. ${(total / ticks / FRAME).toFixed(2)} кадра`);
console.log(`из них пачка вывода ~${Math.round(packCycles / ticks)} (${(100 * packCycles / total).toFixed(0)}%)`);
console.log("--- где такты (ближайшая метка снизу):");
for (const [k, v] of rows) {
  const perTick = Math.round(v / ticks);
  console.log(`  ${(100 * v / total).toFixed(1).padStart(5)}%  ${String(perTick).padStart(6)} т/тик  ${k}`);
}

// --- Группировка по подсистемам (для решения «что резать») ---------------------------
const groups = { "подготовка спрайтов": 0, "вывод (пачка+save-under)": 0, "блиты тайлов": 0,
                 "звук": 0, "ISR/служебное": 0, "игровая логика": 0 };
function groupOf(k) {
  if (/^(vns_|vsp_|vsd_|vop_|vom_|vfl|vfz_|vmx_|vpr_scan)/.test(k)) return "подготовка спрайтов";
  if (/^(vso_|vsu_|vsb_|vsm_|vpz_|vss_|vsz_|vsn_|vtm_|vpr_|vsc_|vhr_|vfr_)/.test(k)) return "вывод (пачка+save-under)";
  if (/^(vbt|vec_blit|vec_text|vlb_|vw_)/.test(k)) return "блиты тайлов";
  if (/^(vsnd_|updateSound|vec_ay|vec_vi_ch|vec_flushvi|fv)/.test(k)) return "звук";
  if (/^(vec_isr|vec_scan_keys|vec_pal|vip_|vec_cache|vec_ind|vec_hop|vec_su_ptr|vec_exx|vec_ix|il_)/.test(k)) return "ISR/служебное";
  return "игровая логика";
}
for (const [k, v] of cost) groups[groupOf(k)] += v;
console.log("--- по подсистемам:");
for (const [g, v] of Object.entries(groups).sort((a, b) => b[1] - a[1]))
  console.log(`  ${(100 * v / total).toFixed(1).padStart(5)}%  ${String(Math.round(v / ticks)).padStart(6)} т/тик  ${g}`);
