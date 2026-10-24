"use strict";
// snd_vi53_rec.js — запись «состояний каналов ВИ53 после каждого тика звука» и состояния игры
// после каждого логического тика. Работает и на основе (e2b8f32, режим ВИ53 подменой пробы AY
// в памяти), и на новой сборке (проигрыватель ВИ53 без AY).
//
//   node tools/verify/snd_vi53_rec.js <rom> <sym> <base|new> <scene> <out.json> [--ticks N]
// scene: natural | demo | knife | gem | death | scroll | s_hush | s_modes | pause (см. SCENES)
//
// Состояние канала = порт-модель (режим/вкл/делитель) по записям в порты 0x08-0x0B, как в
// snd_cost_lib.createTracker; канал 2 в режиме часов виден как "2:60000".
const fs = require("fs"), path = require("path");
const harness = require("./beam_harness.js");

function makeModel(E) {
  const vi = [0, 1, 2].map(() => ({ mode: -1, on: false, div: -1, ph: 0, lo: 0 }));
  const old = E.io.output.bind(E.io);
  E.io.output = function (port, w8) {
    port &= 255; w8 &= 255;
    if (port === 0x08) {
      const ch = w8 >> 6;
      if (ch < 3 && (w8 & 0x30) !== 0) { vi[ch].mode = (w8 >> 1) & 7; vi[ch].on = false; vi[ch].ph = 0; vi[ch].div = -1; }
    } else if (port >= 0x09 && port <= 0x0B) {
      const s = vi[port === 0x0B ? 0 : port === 0x0A ? 1 : 2];
      if (s.ph === 0) { s.lo = w8; s.ph = 1; } else { s.div = s.lo | (w8 << 8); s.ph = 0; s.on = true; }
    }
    return old(port, w8);
  };
  return { vi, key: () => vi.map((s) => (s.on ? `${s.mode}:${s.div}` : "off")).join("|") };
}

// сцены: возвращают { keyFn(logicTick)->[keys], frames|ticks, setup(E) }
const SCENES = {
  natural: { logicTicks: 2600, keyFn: (t) => {
    const k = [];
    if (t < 900) { if ((t >> 2) & 1) k.push(32); }
    else if (t < 1000) k.push(39);
    else if (t < 1010) k.push(78);
    else if (t < 1300) k.push(t & 8 ? 39 : 37);
    else if (t < 1310) k.push(78);
    else if (t < 1600) k.push(t & 8 ? 38 : 39);
    else if (t < 1640) k.push(78);
    else if (t < 2000) k.push(t & 8 ? 39 : 37);
    else if (t < 2060) k.push(78);
    else k.push(t & 8 ? 37 : 39);
    return k;
  } },
};

// сцены-сценарии: drive(api) ведёт кадры сам; запись в память игры — как в snd_cost_scenes.js (на границе логического тика)
const idle = (E) => { for (let t = 0; t < 80 && E.rd(E.L.tickInProgress); t++) E.run(1); };
const wr = (E, a, v) => E.memory.write(a, v & 255, false);
SCENES.demo = { noGame: true, drive: (E) => { E.run(400); E.run(5200); } };
SCENES.knife = { drive: (E) => { E.run(30); for (let k = 0; k < 3; k++) { idle(E); wr(E, E.L.objetoCogido, 0x10); E.key(32, 1); E.run(3); E.key(32, 0); E.run(90); } E.run(60); } };
SCENES.gem = { drive: (E) => {
  const { L, rd } = E; E.run(30);
  for (let gi = 0; gi < 4; gi++) {          // 4 гема комнаты 0: последний даёт «stage clear» (0x94) и фанфары до возврата игровой музыки
    const a = L.datosGemas + gi * 9; const Y = rd(a + 2), X = rd(a + 4);
    idle(E); wr(E, L.ProtaRoom, 0); wr(E, L.ProtaX, X); wr(E, L.ProtaY, gi === 2 ? Y : Y - 8); wr(E, L.protaStatus, 0);
    E.run(90);
  }
  E.run(700);
} };
SCENES.scroll = { drive: (E) => {
  const { L } = E; E.run(30);
  for (const [x, k] of [[240, 39], [240, 39], [10, 37], [10, 37]]) { idle(E); wr(E, L.ProtaX, x); E.key(k, 1); E.run(150); E.key(k, 0); E.run(40); }
} };
SCENES.death = { drive: (E) => {
  const { L, rd } = E; E.run(30);
  let seen6 = false;
  for (let f = 0; f < 1800; f++) { E.run(1); const g = rd(L.GameStatus); if (g === 6) seen6 = true; if (seen6 && g !== 6) break; }
  E.run(120);
  if (!seen6) throw new Error("герой не погиб");
} };
// клавиша S (режимы 0->1->2->0) и пауза P поверх играющей музыки; эффекты (нож) во всех режимах
SCENES.keys_s_p = { drive: (E) => {
  const { L } = E; E.run(60);
  const tap = (k) => { E.key(k, 1); E.run(4); E.key(k, 0); E.run(4); };
  const knife = () => { idle(E); wr(E, L.objetoCogido, 0x10); E.key(32, 1); E.run(3); E.key(32, 0); };
  knife(); E.run(60);
  tap(83); E.run(70); knife(); E.run(60);            // режим 1: только эффекты
  tap(83); E.run(70); knife(); E.run(60);            // режим 2: тишина
  tap(83); E.run(70); knife(); E.run(60);            // режим 0: назад
  tap(80); E.run(120); tap(80); E.run(80);           // пауза и выход из неё
  tap(83); E.run(40); tap(80); E.run(100); tap(80); E.run(60); tap(83); E.run(40); tap(83); E.run(60);  // паузы в режимах 1/2
} };

function record(rom, sym, kind, sceneName, opts = {}) {
  const E = harness.make(rom, sym);
  const { L, cpu, memory, rd, v06c } = E;
  if (kind === "base") {
    const a = L.vec_ay_ok, t = L.vec_no_ay;
    memory.write(a, 0xC3, false); memory.write(a + 1, t & 255, false); memory.write(a + 2, t >> 8, false);
  }
  const model = makeModel(E);
  // --- расписание кадров: номера кадров (от включения), на которых начинались логические тики ---
  let frameAbs = 0, startsSeen = 0;
  const startFrames = [];
  const sched = opts.schedule || null;
  let schedMiss = 0;
  const origOne = v06c.oneInterrupt.bind(v06c);
  v06c.oneInterrupt = function (...a) {
    if (sched && rd(L.tickInProgress) === 0 && startsSeen < sched.length) {
      const want = sched[startsSeen];
      const par = rd(L.vec_fr_par);
      if (want > frameAbs) { if (par < 2) memory.write(L.vec_fr_par, 2, false); }
      else if (want === frameAbs) { if (par > 1) memory.write(L.vec_fr_par, 1, false); }
    }
    const r = origOne(...a);
    frameAbs++;
    return r;
  };
  const rec = { kind, scene: sceneName, ticks: [], tickFrames: [], logic: [], starts: [], ops: [], notes: [], frames: 0 };
  // --- тики звука ---
  const US = L.updateSound;
  const open = [];
  let tickNo = 0, frameNo = 0, logicNo = 0;
  const rd16 = (a) => rd(a) | (rd((a + 1) & 65535) << 8);
  const oldInstr = cpu.instruction.bind(cpu);
  const SM = L.SetMusic_, AP = L.vec_snd_apply, HU = L.vec_snd_hush;
  let armed = true; // запись операций — с включения питания
  let applyEnd = null, ixSave = null;
  const playerLo = kind === "base" ? L.setMusic : L.updateSound, playerHi = kind === "base" ? L.vec_font_rom : L.vsn_end;
  cpu.instruction = function () {
    if (armed) {
      const pc = cpu.pc;
      if (process.env.PRESERVE_IX && L.z80_ix !== undefined) {
        if ((pc === L.vsnd_tick_coop || pc === L.setMusic) && !ixSave) ixSave = { v: rd16(L.z80_ix), ret: rd16(cpu.sp), sp: (cpu.sp + 2) & 65535 };
        else if (ixSave && pc === ixSave.ret && cpu.sp === ixSave.sp) { memory.write(L.z80_ix, ixSave.v & 255, false); memory.write(L.z80_ix + 1, ixSave.v >> 8, false); ixSave = null; }
      }
      if (applyEnd && pc === applyEnd.ret && cpu.sp === applyEnd.sp) applyEnd = null;
      if (pc === US) { open.push({ ret: rd16(cpu.sp), sp: (cpu.sp + 2) & 65535 }); }
      else if (pc === SM) { rec.starts.push([tickNo, cpu.regs[7], frameAbs]); rec.ops.push(["S", cpu.regs[7]]); }
      else if (pc === AP) { rec.starts.push([tickNo, "apply", frameNo]); rec.ops.push(["A"]); applyEnd = { ret: rd16(cpu.sp), sp: (cpu.sp + 2) & 65535 }; }
      else if (pc === L.vtm_start && rd16(cpu.sp) >= L.vec_init && rd16(cpu.sp) < L.vsnd_cdiv) rec.ops.push(["K"]); // запуск часов из бута
      else if (pc === HU && !applyEnd) { rec.starts.push([tickNo, "hush", frameNo]); rec.ops.push(["H"]); }
    }
    const r = oldInstr();
    if (armed && open.length) {
      const o = open[open.length - 1];
      if (cpu.pc === o.ret && cpu.sp === o.sp) {
        open.pop(); tickNo++;
        rec.ticks.push(model.key()); rec.tickFrames.push(frameAbs); rec.ops.push(["T"]);
      }
    }
    return r;
  };
  // --- логические тики ---
  const oldWrite = memory.write.bind(memory);
  const fp = () => {
    const parts = [];
    const range = (a, n) => { for (let i = 0; i < n; i++) parts.push(rd(a + i)); };
    range(L.ProtaY, 4); parts.push(rd(L.protaStatus)); parts.push(rd(L.GameStatus)); parts.push(rd(L.subStatus));
    // momiaDat: слот 22 Б; байты 12,13 слота — УКАЗАТЕЛЬ в таблицу valoresSalto (адрес зависит от раскладки кода,
    // а не от поведения) -> сравниваем смещение от метки, а не абсолютный адрес
    for (let i = 0; i < 84; i++) {
      const sl = (i / 22) | 0, o = i % 22, a0 = L.momiaDat + sl * 22;
      if (o === 12 || o === 13) { const ptr = rd(a0 + 12) | (rd(a0 + 13) << 8); const rel = ptr - L.valoresSalto; parts.push(rel >= -64 && rel < 4096 ? "p" + (o === 12 ? rel : "") : rd(L.momiaDat + i)); }
      else parts.push(rd(L.momiaDat + i));
    }
    range(L.score_0000xx, 3); range(L.score_xx0000, 1);
    parts.push(rd(L.Vidas)); parts.push(rd(L.gemasCogidas)); parts.push(rd(L.flagVivo)); parts.push(rd(L.piramideActual));
    return parts.join(",");
  };
  memory.write = function (a, b, stack) {
    const addr = a & 65535;
    if (process.env.WATCH && addr === L.momiaDat + (+process.env.WATCH) && logicNo >= 596 && logicNo <= 600) (rec.watch = rec.watch || []).push([logicNo, frameAbs, cpu.pc, b & 255]);
    const st = addr === L.tickInProgress && (b & 255) === 1 && rd(a) === 0;
    if (st) { startFrames.push(frameAbs); if (sched && sched[startsSeen] !== frameAbs) schedMiss++; startsSeen++; }
    const was = armed && addr === L.tickInProgress && (b & 255) === 0 && rd(a) === 1;
    if (addr === L.vec_snd_mode && rd(a) !== (b & 255)) rec.ops.push(["M", b & 255]);
    if (addr >= L.MusicChanData && addr < L.MusicChanData + 0x2A && (b & 255) === 0 && !(cpu.pc >= playerLo && cpu.pc < playerHi)) {
      const lastOp = rec.ops[rec.ops.length - 1];
      if (!lastOp || lastOp[0] !== "Z") rec.ops.push(["Z"]);
    }
    const r = oldWrite(a, b, stack);
    if (was) { logicNo++; rec.logic.push(fp()); }
    return r;
  };
  const sc = SCENES[sceneName];
  if (!sc) throw new Error("сцена " + sceneName);
  if (!sc.noGame && harness.toGame(E) !== 5) throw new Error("нет геймплея");
  if (sc.drive) {
    if (!sc.noGame) E.run(0);
    sc.drive(E);
    frameNo = frameAbs;
  } else {
    E.run(30);
    let held = new Set();
    const cap = sc.logicTicks * 8 + 4000;
    while (logicNo < sc.logicTicks && frameNo < cap) {
      const want = new Set(sc.keyFn(logicNo));
      for (const c of held) if (!want.has(c)) E.key(c, 0);
      for (const c of want) if (!held.has(c)) E.key(c, 1);
      held = want;
      v06c.oneInterrupt(true);
      frameNo++;
    }
    for (const c of held) E.key(c, 0);
  }
  rec.frames = frameNo; rec.soundTicks = tickNo; rec.logicTicks = logicNo;
  rec.startFrames = startFrames; rec.schedMiss = schedMiss; rec.framesAbs = frameAbs;
  cpu.instruction = oldInstr; memory.write = oldWrite;
  return rec;
}

if (require.main === module) {
  const [rom, sym, kind, scene, out, sch] = process.argv.slice(2);
  const r = record(rom, sym, kind, scene, sch ? { schedule: JSON.parse(fs.readFileSync(sch, "utf8")).startFrames } : {});
  fs.writeFileSync(out, JSON.stringify(r));
  console.log(`${kind}/${scene}: кадров ${r.frames}, тиков звука ${r.soundTicks}, логических ${r.logicTicks}, запусков ${r.starts.length}, промахов расписания ${r.schedMiss}`);
}
module.exports = { record, SCENES, makeModel };
