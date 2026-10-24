#!/usr/bin/env node
"use strict";
// snd_cost_stream.js — часть В: поток реальных изменений на выходе для каждого звука игры.
// Звук запускается штатным SetMusic_ (A = номер), дальше драйвер Konami тикается вызовами
// updateSound по одному на «кадр». Прерывания выключены, игровая логика не идёт: поток чистый
// (без наложения других звуков). Выход берётся с портов (AY: 0x15/0x14, ВИ53: 0x08-0x0B).
// Запуск: node tools/verify/snd_cost_stream.js [--natural]
const fs = require("fs"), path = require("path");
const lib = require("./snd_cost_lib.js");
const { q } = lib;

const SOUNDS = [
  { id: 1, arg: 0x01, name: "Падение (SFX_Dummy+updateSfxCaer)", kind: "sfx" },
  { id: 2, arg: 0x02, name: "Удар о пол (SFX_Dummy)", kind: "sfx" },
  { id: 3, arg: 0x03, name: "Вращающаяся дверь (SFX_PuertaGir)", kind: "sfx", blocks: ["SFX_PuertaGir"] },
  { id: 4, arg: 0x04, name: "Взятие ножа/кирки (SFX_Coger)", kind: "sfx", blocks: ["SFX_Coger"] },
  { id: 5, arg: 0x45, name: "Кирка (SFX_Picar)", kind: "sfx", blocks: ["SFX_Picar"] },
  { id: 6, arg: 0x06, name: "Бросок ножа (SFX_Lanzar)", kind: "sfx", blocks: ["SFX_Lanzar"] },
  { id: 7, arg: 0x87, name: "Появление мумии (SFX_Momia)", kind: "sfx", blocks: ["SFX_Momia"] },
  { id: 8, arg: 0x08, name: "Мумия взорвана (SFX_Hit)", kind: "sfx", blocks: ["SFX_Hit"] },
  { id: 9, arg: 0x09, name: "Взятие гема (SFX_Gema)", kind: "sfx", blocks: ["SFX_Gema"] },
  { id: 10, arg: 0x8A, name: "Доп. жизнь (SFX_VidaExtra)", kind: "sfx", blocks: ["SFX_VidaExtra"] },
  { id: 11, arg: 0x8B, name: "Музыка игры (MUS_Ingame)", kind: "music", blocks: ["MUS_Ingame", "MUS_Ingame2"] },
  { id: 13, arg: 0x8D, name: "Дверь закрывается (MUS_CloseDoor)", kind: "jingle", blocks: ["MUS_CloseDoor", "MUS_CloseDoor2"] },
  { id: 15, arg: 0x8F, name: "Колокольчик выхода (MUS_SalirPiram)", kind: "jingle", blocks: ["MUS_SalirPiram", "MUS_SalirPiram2"] },
  { id: 17, arg: 0x91, name: "Фанфары карты (MUS_Mapa)", kind: "jingle", blocks: ["MUS_Mapa", "MUS_Mapa2", "MUS_Mapa3"] },
  { id: 20, arg: 0x94, name: "Stage clear (MUS_StageClr)", kind: "jingle", blocks: ["MUS_StageClr", "MUS_StageClr2", "MUS_StageClr3"] },
  { id: 23, arg: 0x97, name: "Старт игры (MUS_Start)", kind: "jingle", blocks: ["MUS_Start", "MUS_Start2", "MUS_Start3"] },
  { id: 26, arg: 0x9A, name: "Game Over (MUS_GameOver)", kind: "jingle", blocks: ["MUS_GameOver", "MUS_GameOver2", "MUS_GameOver3"] },
  { id: 29, arg: 0x1D, name: "Смерть героя (MUS_Muerte)", kind: "jingle", blocks: ["MUS_Muerte", "MUS_Muerte2", "MUS_Muerte3"] },
];

// ---- ручной вызов процедуры игры (без прерываний) ------------------------------------------
const SENT = 0x00F0;
function callSub(E, addr, a, guard = 400000, preserve = false) {
  const { cpu, memory } = E;
  const sv = preserve ? { pc: cpu.pc, sp: cpu.sp, iff: cpu.iff, ip: cpu.iff_pending, f: [cpu.sf, cpu.pf, cpu.hf, cpu.zf, cpu.cf], regs: cpu.regs.slice(), lo: cpu.last_opcode } : null;
  cpu.iff = false;
  const sp = (cpu.sp - 2) & 65535;
  memory.write(sp, SENT & 255, true); memory.write(sp + 1, SENT >> 8, true);
  cpu.sp = sp; cpu.pc = addr; if (a !== undefined) cpu.regs[7] = a;
  let cyc = 0, n = 0;
  while (cpu.pc !== SENT) {
    cpu.instruction(); cyc += cpu.vcycles | 0;
    if (++n > guard) throw new Error("callSub: не вернулся " + addr.toString(16));
  }
  if (sv) {
    cpu.pc = sv.pc; cpu.sp = sv.sp; cpu.iff = sv.iff; cpu.iff_pending = sv.ip;
    [cpu.sf, cpu.pf, cpu.hf, cpu.zf, cpu.cf] = sv.f; for (let i = 0; i < 8; i++) cpu.regs[i] = sv.regs[i]; cpu.last_opcode = sv.lo;
  }
  return cyc;
}

// ---- модель выхода по портам -----------------------------------------------------------------
class OutModel {
  constructor() { this.ay = new Uint8Array(16); this.sel = 0; this.vi = [0, 1, 2].map(() => ({ mode: 3, on: false, div: 0, ph: 0, lo: 0 })); }
  port(p, w) {
    if (p === 0x15) this.sel = w & 15;
    else if (p === 0x14) this.ay[this.sel] = w;
    else if (p === 0x08) { const ch = w >> 6; if (ch < 3 && (w & 0x30)) { const s = this.vi[ch]; s.mode = (w >> 1) & 7; s.on = false; s.ph = 0; } }
    else if (p >= 0x09 && p <= 0x0B) {
      const s = this.vi[p === 0x0B ? 0 : p === 0x0A ? 1 : 2];
      if (s.ph === 0) { s.lo = w; s.ph = 1; } else { s.div = s.lo | (w << 8); s.ph = 0; s.on = true; }
    }
  }
  snapAY() { return Array.from(this.ay); }
  snapVI() { return this.vi.map((s) => (s.on ? `${s.mode}:${s.div}` : "off")); }
}

// состояния по кадрам из журнала портов [(frame, port, value)]
function statesFromPorts(ports, nFrames, chip, init) {
  const m = new OutModel();
  if (init) { m.ay.set(init.ay); init.vi.forEach((k, i) => { if (k !== "off") { const [mo, d] = k.split(":").map(Number); m.vi[i] = { mode: mo, on: true, div: d, ph: 0, lo: 0 }; } }); }
  const st = []; let pi = 0;
  for (let f = 0; f < nFrames; f++) {
    while (pi < ports.length && ports[pi][0] <= f) { m.port(ports[pi][1], ports[pi][2]); pi++; }
    st.push(chip === 0 ? m.snapAY() : m.snapVI());
  }
  return st;
}

// ---- события: изменения итогового состояния от кадра к кадру ---------------------------------
function eventsAY(states, init) {
  const ev = []; let prev = init.ay;
  states.forEach((s, f) => { for (let r = 0; r < 14; r++) if (s[r] !== prev[r]) ev.push([f, r, s[r]]); prev = s; });
  return ev;
}
// вид события ВИ53: off / clk (канал 2, режим 2) / div (канал уже играет в режиме 3) / start (был выключен или другой режим)
function eventsVI(states, init) {
  const ev = []; let prev = init.vi;
  states.forEach((s, f) => {
    for (let c = 0; c < 3; c++) if (s[c] !== prev[c]) {
      if (s[c] === "off") ev.push([f, c, "off", 0]);
      else { const [mo, d] = s[c].split(":").map(Number);
        if (mo === 2) ev.push([f, c, "clk", d]);
        else ev.push([f, c, prev[c] !== "off" && prev[c].startsWith("3:") ? "div" : "start", d]); }
    }
    prev = s;
  });
  return ev;
}

// ---- упаковка ----------------------------------------------------------------------------------
// Общее: поток — последовательность токенов. 0x00 = конец. 0x01..0x7F = «ждать N кадров» (длинные паузы
// режутся по 127). Токен >= 0x80 = событие.
// AY:  0x80|reg (reg 0..13), затем 1 байт значения.                          -> 2 байта на событие
// ВИ53: 0x80|(kind<<2)|ch; kind: 0=off, 1=clk, 2=div, 3=start; div/start +2 байта (lo, hi) -> 3 байта,
//       off/clk -> 1 байт (делитель часов фиксирован 60000 = 0xEA60).
const VK = { off: 0, clk: 1, div: 2, start: 3 }, VKN = ["off", "clk", "div", "start"];
function pack(ev, chip, nFrames) {
  const out = []; let cur = 0;
  const wait = (n) => { while (n > 0) { const k = Math.min(127, n); out.push(k); n -= k; } };
  for (const e of ev) {
    wait(e[0] - cur); cur = e[0];
    if (chip === 0) { out.push(0x80 | e[1], e[2]); }
    else { out.push(0x80 | (VK[e[2]] << 2) | e[1]); if (e[2] === "div" || e[2] === "start") out.push(e[3] & 255, e[3] >> 8); }
  }
  wait(nFrames - cur);
  out.push(0);
  return Uint8Array.from(out);
}
// независимый декодер + проигрыватель: из байтов -> состояния по кадрам
function replay(bytes, chip, init, nFrames) {
  const m = new OutModel(); m.ay.set(init.ay);
  m.vi = init.vi.map((k) => (k === "off" ? { mode: 3, on: false, div: 0, ph: 0, lo: 0 } : { mode: +k.split(":")[0], on: true, div: +k.split(":")[1], ph: 0, lo: 0 }));
  const st = []; let p = 0, wait = 0;
  for (let f = 0; f < nFrames; f++) {
    if (wait > 0) wait--;
    while (wait === 0 && p < bytes.length) {
      const t = bytes[p++];
      if (t === 0) { wait = 1e9; break; }
      if (t < 0x80) { wait = t; break; }
      if (chip === 0) { m.ay[t & 15] = bytes[p++]; }
      else {
        const ch = t & 3, k = VKN[(t >> 2) & 3], s = m.vi[ch];
        if (k === "off") s.on = false;
        else if (k === "clk") { s.mode = 2; s.on = true; s.div = 60000; }
        else { s.mode = 3; s.on = true; s.div = bytes[p] | (bytes[p + 1] << 8); p += 2; }
      }
    }
    // событие «ждать N» означает: следующие N кадров без изменений, затем читаем дальше
    if (wait > 0 && wait < 1e9) { /* wait уже учтён в начале следующего кадра */ }
    st.push(chip === 0 ? m.snapAY() : m.snapVI());
  }
  return st;
}
const eqStates = (a, b) => a.length === b.length && a.every((s, i) => s.length === b[i].length && s.every((x, j) => x === b[i][j]));

// ---- захват одного звука ------------------------------------------------------------------------
function captureSound(E, T, snd, chip) {
  const { L, rd, memory } = E;
  const wr = (a, v) => memory.write(a, v & 255, false);
  // чистое состояние драйвера: каналы, флаг звука падения
  for (let i = 0; i < 42; i++) wr(L.MusicChanData + i, 0);
  wr(L.flagSetCaeSnd, 0);
  // нулевая линия выхода: hush (AY: громкости 0, микшер 0x3F; ВИ53: стоп каналов)
  T.capturePorts = true; T.ports.length = 0; T.frameNo = 0;
  callSub(E, L.vec_snd_hush);
  const init0 = { ay: new Uint8Array(16), vi: ["off", "off", "off"] };
  const baseStates = statesFromPorts(T.ports.map((x) => [0, x[1], x[2]]), 1, chip, init0);
  const init = chip === 0 ? { ay: Uint8Array.from(baseStates[0]), vi: ["off", "off", "off"] } : { ay: new Uint8Array(16), vi: baseStates[0] };
  T.ports.length = 0;
  // запуск звука
  const startCyc = callSub(E, L.SetMusic_, snd.arg);
  const chanActive = () => [0, 1, 2].filter((i) => (rd(L.MusicChanData + i * 14 + 2) & 0x3F) !== 0);
  const startIds = chanActive();
  // слежение за бесконечным циклом паттерна (FE FF): канал «прошёл цикл» -> дальше повтор
  const looped = new Set();
  const { cpu } = E;
  const oldInstr = cpu.instruction.bind(cpu);
  cpu.instruction = function () {
    if (cpu.pc === L.patternLoop) {
      const hl = (cpu.regs[4] << 8) | cpu.regs[5];
      if (rd(hl + 1) === 0xFF) looped.add(Math.floor(((rd(L.z80_ix) | (rd(L.z80_ix + 1) << 8)) - L.MusicChanData) / 14));
    }
    return oldInstr();
  };
  const tickCyc = [];
  let f = 0; const MAXF = snd.id === 1 ? 60 : 4000;
  for (; f < MAXF; f++) {
    T.frameNo = f;
    tickCyc.push(callSub(E, L.updateSound));
    const act = chanActive();
    if (act.length === 0) { f++; break; }
    if (act.every((i) => looped.has(i))) { f++; break; }
  }
  cpu.instruction = oldInstr;
  // «хвост»: ещё 2 тика для затухания громкости до нуля после конца
  const nFrames = f;
  const states = statesFromPorts(T.ports.map((x) => [x[0], x[1], x[2]]), nFrames, chip, init);
  const ev = chip === 0 ? eventsAY(states, init) : eventsVI(states, init);
  const bytes = pack(ev, chip, nFrames);
  const re = replay(bytes, chip, init, nFrames);
  const ok = eqStates(states, re);
  // дубль-проверка: сырой журнал портов -> та же модель -> состояние покадрово == состояние из воспроизведения
  const perFrame = new Array(nFrames).fill(0); for (const e of ev) perFrame[e[0]]++;
  const kindsFrame = Array.from({ length: nFrames }, () => [0, 0, 0, 0]); if (chip === 1) for (const e of ev) kindsFrame[e[0]][VK[e[2]]]++;
  const rawPorts = T.ports.length;
  T.capturePorts = false;
  return {
    id: snd.id, name: snd.name, kind: snd.kind, channels_used: startIds.length, frames: nFrames,
    looped_channels: [...looped], events: ev.length, events_per_frame: q(perFrame), event_frames: perFrame.filter((x) => x > 0).length,
    raw_port_writes: rawPorts, bytes: bytes.length, replay_ok: ok,
    driver_tick_cycles: q(tickCyc), driver_start_cycles: startCyc, driver_cycles_total: tickCyc.reduce((a, b) => a + b, 0),
    events_list: ev, packed_hex: Buffer.from(bytes).toString('hex'), init, per_frame_events: perFrame, per_frame_kinds: chip === 1 ? kindsFrame : null, ev_sample: ev.slice(0, 12),
  };
}

function dataSizes(L) {
  // блоки данных по меткам .sym (MUS_/SFX_/byte_7E*), конец области — vec_font_rom
  const names = Object.keys(L).filter((n) => /^(MUS_|SFX_|byte_7E)/.test(n));
  const addrs = names.map((n) => [L[n], n]).sort((a, b) => a[0] - b[0]);
  const size = {};
  addrs.forEach(([a, n], i) => { const end = i + 1 < addrs.length ? addrs[i + 1][0] : L.vec_font_rom; size[n] = { addr: a, size: end - a }; });
  return size;
}

function main() {
  const out = { sounds: {}, natural: {}, data: {}, code: {} };
  const Lx = lib.parseSym(lib.SYM);
  const sizes = dataSizes(Lx);
  out.data.blocks = sizes;
  out.data.range = { start: Lx.SFX_Dummy, end: Lx.vec_font_rom, bytes: Lx.vec_font_rom - Lx.SFX_Dummy };
  out.data.music_index = { addr: Lx.MusicIndex, bytes: Lx.SFX_Dummy - Lx.MusicIndex };
  out.code = {
    driver: { start: Lx.setMusic, end: Lx.freqNotas, bytes: Lx.freqNotas - Lx.setMusic, note: "setMusic..musicStorePtr (SetMusic_, setChanData, patternLoop, updateSound, processSndData, setFreq, ...)" },
    freq_table: { addr: Lx.freqNotas, bytes: Lx.MusicIndex - Lx.freqNotas },
    overlay_ay: { addr: Lx.WRTPSG, bytes: Lx.snd_ov_ay_end - Lx.snd_ov_ay },
    overlay_vi: { addr: Lx.WRTPSG, bytes: Lx.snd_ov_vi_end - Lx.snd_ov_vi },
    clock_vtm: { start: Lx.vtm_start, end: Lx.RDPSG, bytes: Lx.RDPSG - Lx.vtm_start },
    ram_channels: 42,
  };
  for (const [cn, chip] of [["ay", 0], ["vi", 1]]) {
    const E = lib.makeEmu(chip);
    const T = lib.createTracker(E, chip);
    if (lib.harness.toGame(E) !== 5) throw new Error("нет геймплея");
    E.run(5);
    // защитная копия состояния драйвера не нужна: эмулятор одноразовый
    out.sounds[cn] = {};
    for (const snd of SOUNDS) {
      const r = captureSound(E, T, snd, chip);
      // данные звука (сумма блоков)
      r.data_bytes = (snd.blocks || []).reduce((s, b) => s + (sizes[b] ? sizes[b].size : 0), 0);
      if (snd.id === 11) r.data_bytes += sizes.byte_7E61.size + sizes.byte_7E6B.size + sizes.byte_7E75.size + sizes.byte_7E7F.size;
      fs.mkdirSync(path.join(lib.OUT, "streams"), { recursive: true });
      fs.writeFileSync(path.join(lib.OUT, "streams", `${cn}_${String(snd.id).padStart(2, "0")}.json`), JSON.stringify({
        chip: cn, id: snd.id, call_arg: snd.arg, name: snd.name, frames: r.frames,
        format: cn === "ay" ? "events: [кадр, регистр AY, значение]" : "events: [кадр, канал ВИ53, вид (off|clk|div|start), делитель]",
        pack: "токены: 0x00 конец; 0x01..0x7F пауза N кадров; >=0x80 событие (AY: 0x80|рег + байт; ВИ53: 0x80|вид<<2|канал [+lo,hi для div/start])",
        init: { ay: Array.from(r.init.ay), vi: r.init.vi }, events: r.events_list, packed_hex: r.packed_hex }));
      delete r.events_list; delete r.packed_hex; delete r.init;
      out.sounds[cn][snd.id] = r;
      console.log(cn, snd.id, snd.name, "кадров", r.frames, "событий", r.events, "байт", r.bytes, "данные", r.data_bytes, "replay", r.replay_ok);
    }
  }
  // события в обычном прогоне (музыка и эффекты вместе): тот же способ — изменения итогового состояния выхода
  const { runDriver } = require("./snd_cost_measure.js");
  out.natural = {};
  for (const [cn, chip] of [["ay", 0], ["vi", 1]]) {
    const { T } = runDriver(chip, "natural", 2600, { capture: true });
    const nF = T.frames.length + 1;
    const init0 = { ay: new Uint8Array(16), vi: ["off", "off", "off"] };
    const st = statesFromPorts(T.ports, nF, chip, init0);
    const ev = chip === 0 ? eventsAY(st, init0) : eventsVI(st, init0);
    const cnt = new Array(nF).fill(0), kinds = Array.from({ length: nF }, () => [0, 0, 0, 0]);
    for (const e of ev) { cnt[e[0]]++; if (chip === 1) kinds[e[0]][VK[e[2]]]++; }
    const gs = [0].concat(T.frames.map((f) => f.gs));
    const sel = (pred) => cnt.map((c, i) => [c, i]).filter(([c, i]) => i >= 1 && pred(i)).map(([c]) => c);
    const bytes = pack(ev.filter((e) => e[0] >= 1).map((e) => [e[0] - 1, ...e.slice(1)]), chip, nF - 1);
    out.natural[cn] = {
      frames: nF - 1, events: ev.filter((e) => e[0] >= 1).length, bytes: bytes.length,
      per_frame: q(sel(() => true)), per_frame_gs5: q(sel((i) => gs[i] === 5)),
      zero_event_frac: sel(() => true).filter((x) => x === 0).length / (nF - 1),
      cnt: cnt.slice(1), kinds: chip === 1 ? kinds.slice(1) : null, gs: gs.slice(1), ticks: T.frames.map((f) => f.ticks), step: T.frames.map((f) => f.step),
      port_writes: T.ports.length,
    };
    console.log("natural", cn, "кадров", nF - 1, "событий", out.natural[cn].events, "байт упаковки", bytes.length, JSON.stringify(out.natural[cn].per_frame));
  }
  fs.mkdirSync(path.join(lib.OUT, "partial"), { recursive: true });
  fs.writeFileSync(path.join(lib.OUT, "partial/stream.json"), JSON.stringify(out));
}
if (require.main === module) main();
module.exports = { callSub, VK, statesFromPorts, eventsAY, eventsVI, pack, replay, eqStates, OutModel };
