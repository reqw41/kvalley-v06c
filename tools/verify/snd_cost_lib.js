"use strict";
// snd_cost_lib.js — общий слой замера цены звука (задача sound-cost, только чтение игры).
// Ничего не пишет в src/ build/ devector/ docs/. Эмулятор vector06js, ROM — замороженная копия
// outputs/sound-cost/rom/kvalley_8c.rom. Такты — cpu.vcycles после каждой инструкции (+16 на
// приём прерывания, как в tick_breakdown.js).
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");
const ROOT = path.resolve(__dirname, "../..");
const OUT = process.env.SND_COST_OUT || path.join(ROOT, "outputs/sound-cost");
const ROMDIR = process.env.SND_COST_ROMDIR || path.join(OUT, "rom");
const ROM = process.env.SND_COST_ROM || path.join(ROMDIR, "kvalley_8c.rom");
const SYM = process.env.SND_COST_SYM || path.join(ROMDIR, "kvalley_8c.sym");
const harness = require("./beam_harness.js");

// ---- статистика ---------------------------------------------------------------------------
function q(a) {
  const n = a.length;
  if (!n) return { n: 0, mean: 0, median: 0, p90: 0, max: 0 };
  const b = Array.from(a).sort((x, y) => x - y);
  let s = 0; for (const x of b) s += x;
  return { n, mean: s / n, median: b[Math.floor(n * 0.5)], p90: b[Math.min(n - 1, Math.floor(n * 0.9))], max: b[n - 1] };
}
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
function treeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? treeFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]);
}
function manifest(dirs = ["src", "build", "devector"]) {
  const m = {};
  for (const d of dirs) for (const p of treeFiles(path.join(ROOT, d))) m[path.relative(ROOT, p)] = sha256(p);
  return m;
}

// ---- категории ----------------------------------------------------------------------------
const CATS = [
  "clk_entry", "clk_gate", "clk_delta", "clk_lease",          // участок 1
  "drv_parse", "drv_env", "drv_fx", "drv_other", "drv_start", // участок 2
  "ov_shadow", "ov_modechk",                                    // участок 3
  "out_ay", "out_route", "out_vich", "out_ay2vi", "out_svc",   // участок 4
  "ext_overlay", "nonsound",                                    // не звук
];
const CI = Object.fromEntries(CATS.map((c, i) => [c, i]));
const NSND = 16; // категории 0..15 — звук
const SECTION = {
  clk_entry: 1, clk_gate: 1, clk_delta: 1, clk_lease: 1,
  drv_parse: 2, drv_env: 2, drv_fx: 2, drv_other: 2, drv_start: 2,
  ov_shadow: 3, ov_modechk: 3,
  out_ay: 4, out_route: 4, out_vich: 4, out_ay2vi: 4, out_svc: 4,
};

function parseSym(p) {
  const L = {};
  for (const l of fs.readFileSync(p, "latin1").split("\n")) {
    const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);
    if (m) L[m[1]] = parseInt(m[2], 16);
  }
  return L;
}

// Карта PC -> категория для выбранного чипа. Границы берутся из .sym (игра, оверлей), не из головы.
function buildCatMapNew(L) {
  // новая сборка (snd-vi53): проигрыватель потоков ВИ53 в v06c/vec_snd.asm, оверлея и WRTPSG нет.
  // Участок 2 = тик/разбор потока/запуск звука; участок 4 = программирование чипа (vc_on/vc_off) и apply/hush.
  const map = new Int8Array(65536).fill(CI.nonsound);
  const fill = (a, b, c) => { for (let i = a; i < b; i++) map[i] = CI[c]; };
  fill(L.vtm_start, L.vtm_grab, "clk_lease");
  fill(L.vtm_grab, L.vtm_read, "clk_lease");
  fill(L.vtm_read, L.vsnd_tick_clk, "clk_delta");
  fill(L.vsnd_tick_clk, L.RDPSG, "clk_gate");
  fill(L.updateSound, L.vpl, "drv_other");       // проверка dirty, обход трёх голосов, счёт сна
  fill(L.vpl, L.vc_on, "drv_parse");             // разбор потока, vpl_fin, vrec_addr, vw_addr, падение
  fill(L.vc_on, L.vsn_resync, "out_vich");       // vc_on / vc_off — программирование канала ВИ53
  fill(L.vsn_resync, L.setMusic, "out_svc");     // resync / apply / hush
  fill(L.setMusic, L.vsn_tab, "drv_start");      // setMusic, SetMusic_
  return { map, lda: -1, ovsym: {} };
}
function buildCatMap(L, img, chip) {
  if (L.patternLoop === undefined) return buildCatMapNew(L);
  const map = new Int8Array(65536).fill(CI.nonsound);
  const rdImg = (a) => img[a - 0x100];
  const fill = (a, b, c) => { for (let i = a; i < b; i++) map[i] = CI[c]; };
  // --- часы (vec_isr.asm) ---
  fill(L.vtm_start, L.vtm_grab, "clk_lease");
  fill(L.vtm_grab, L.vtm_read, "clk_lease");
  fill(L.vtm_read, L.vsnd_tick_clk, "clk_delta");     // vtm_read + vtm_delta
  fill(L.vsnd_tick_clk, L.RDPSG, "clk_gate");        // vsnd_tick_clk/hdr/coop/tick, vst_*, vtm_hold/alive
  // --- драйвер Konami (kvalley_game.asm) ---
  fill(L.setMusic, L.patternLoop, "drv_start");            // setMusic, SetMusic_, setChanData
  fill(L.patternLoop, L.switchCh3OnOff, "drv_parse");      // команда цикла паттерна
  fill(L.switchCh3OnOff, L.updateSfxCaer, "drv_other");    // switchCh3OnOff, SetPSGMixer, updateSound, updateSound2
  fill(L.updateSfxCaer, L.processSndData, "drv_fx");       // звук падения (+ caidaSndData)
  fill(L.processSndData, L.nextNote, "drv_other");         // голова processSndData: счёт длительности
  fill(L.nextNote, L.loc_7C2D, "drv_parse");               // разбор нотных данных
  fill(L.loc_7C2D, L.setNote, "drv_env");                  // loc_7C2D, loc_7C47, decVolume, setVolume
  fill(L.setNote, L.freqNotas, "drv_parse");               // setNote ... setFreq, incMusicPoint, musicStorePtr
  // --- оверлей ---
  const W = L.WRTPSG;
  const ovsym = parseSym(path.join(ROMDIR, chip === 0 ? "snd_ov_ay.sym" : "snd_ov_vi.sym"));
  const ovbin = fs.readFileSync(path.join(ROMDIR, chip === 0 ? "snd_ov_ay.bin" : "snd_ov_vi.bin"));
  // проверка: оверлей в образе ROM совпадает с собранным .bin
  const off = (chip === 0 ? L.snd_ov_ay : L.snd_ov_vi) - 0x100;
  for (let i = 0; i < ovbin.length; i++) if (img[off + i] !== ovbin[i]) throw new Error("оверлей в ROM != .bin @" + i);
  // первая `ld a,(vec_snd_mode)` (3A F0 FC) после входа vwp
  const vwp = chip === 0 ? ovsym.vwp_ay : ovsym.vwp_vi;
  let lda = -1;
  for (let a = vwp; a < vwp + 40; a++) {
    if (ovbin[a - W] === 0x3A && ovbin[a - W + 1] === (L.vec_snd_mode & 255) && ovbin[a - W + 2] === (L.vec_snd_mode >> 8)) { lda = a; break; }
  }
  if (lda < 0) throw new Error("нет проверки vec_snd_mode в оверлее");
  fill(W, W + 3, "ov_shadow");                 // jp vwp_* на входе WRTPSG
  if (chip === 0) {
    fill(W + 3, ovsym.vwp_ay, "out_svc");      // jp apply / jp hush
    fill(ovsym.vwp_ay, lda, "ov_shadow");
    fill(lda, ovsym.vwp_ay_out, "ov_modechk");
    fill(ovsym.vwp_ay_out, ovsym.vwp_ay_done, "out_ay");
    fill(ovsym.vwp_ay_done, ovsym.vsa_ay, "ov_shadow");
    fill(ovsym.vsa_ay, L.snd_ov_ay_end - L.snd_ov_ay + W, "out_svc");
  } else {
    fill(W + 3, ovsym.vwp_vi, "out_svc");
    fill(ovsym.vwp_vi, lda, "ov_shadow");
    fill(lda, ovsym.vwp_vi_chip, "ov_modechk");
    fill(ovsym.vwp_vi_chip, ovsym.vwp_vi_done, "out_route");
    fill(ovsym.vwp_vi_done, ovsym.vec_vi_ch, "ov_shadow");
    fill(ovsym.vec_vi_ch, ovsym.vvi_tbit, "out_vich");
    fill(ovsym.vsa_vi, L.vec_ay2vi, "out_svc");
    fill(L.vec_ay2vi, L.vec_ay2vi + 0x17, "out_ay2vi"); // vec_ay2vi: 23 байт до ret
  }
  return { map, lda, ovsym };
}

// ---- загрузка эмулятора -------------------------------------------------------------------
// chip: 0 = AY (проба на старте находит AY в vector06js), 1 = ВИ53 (проба принудительно «нет AY»:
// в образе в памяти первые 3 байта vec_ay_ok заменены на jp vec_no_ay; файл ROM не меняется).
function patchChip(E, chip) {
  const { L, memory } = E;
  if (chip !== 1 || L.vec_ay_ok === undefined) return; // в новой сборке пробы AY нет
  const a = L.vec_ay_ok, t = L.vec_no_ay;
  memory.write(a, 0xC3, false); memory.write(a + 1, t & 255, false); memory.write(a + 2, t >> 8, false);
}

// make(chip): обычный harness.make на замороженной копии + патч режима чипа + общий перехватчик
function makeEmu(chip, tracker) {
  const E = harness.make(ROM, SYM);
  patchChip(E, chip);
  E.chipForced = chip;
  return E;
}

// ---- трекер ------------------------------------------------------------------------------
const ENTRY_NAMES = ["vsnd_tick_clk", "vsnd_tick_hdr", "vsnd_tick_coop", "vsnd_tick", "updateSound", "setMusic", "SetMusic_", "vec_snd_apply", "vec_snd_hush"];

function createTracker(E, chip, opts = {}) {
  const { L, cpu, memory, v06c, rd } = E;
  const img = new Uint8Array(fs.readFileSync(ROM));
  const { map, lda, ovsym } = buildCatMap(L, img, chip);
  const rd16 = (a) => rd(a) | (rd((a + 1) & 65535) << 8);
  const entryAt = new Map();
  for (const n of ENTRY_NAMES) if (L[n] !== undefined) entryAt.set(L[n], n);
  const isStartEntry = (n) => n === "setMusic" || n === "SetMusic_";
  const gluesAddr = new Set([L.vsnd_acc, L.vsnd_busy, L.vec_sndb]);
  const NC = CATS.length;
  const T = {
    armed: false, chip, E, L,
    frames: [], steps: [], curFrame: null, curStep: null,
    wrCalls: [], viCalls: [], soundStarts: [], pairs: 0,
    ports: [], capturePorts: false,
    gsHist: {}, orphan: {},
  };
  // --- ВИ53: модель выхода по записям в порты ---
  const vi = [0, 1, 2].map(() => ({ mode: -1, on: false, div: -1, ph: 0, lo: 0 }));
  T.vi = vi;
  const viKey = (c) => `${vi[c].mode}/${vi[c].on ? 1 : 0}/${vi[c].on ? vi[c].div : -1}`;
  const ctrlLog = [];
  const oldOut = E.io.output.bind(E.io);
  const portOwner = { frame: null, count: 0 };
  E.io.output = function (port, w8) {
    port &= 255; w8 &= 255;
    if (port === 0x08) {
      const ch = w8 >> 6;
      if (ch < 3 && (w8 & 0x30) !== 0) { vi[ch].mode = (w8 >> 1) & 7; vi[ch].on = false; vi[ch].ph = 0; vi[ch].div = -1; }
    } else if (port >= 0x09 && port <= 0x0B) {
      const ch = port === 0x0B ? 0 : port === 0x0A ? 1 : 2;
      const s = vi[ch];
      if (s.ph === 0) { s.lo = w8; s.ph = 1; }
      else { s.div = s.lo | (w8 << 8); s.ph = 0; s.on = true; }
    }
    if (T.capturePorts) T.ports.push([T.frameNo | 0, port, w8]);
    if (T.armed && T.curFrame) {
      if (port === 0x14 || port === 0x15) T.curFrame.ay_ports++;
      else if (port >= 0x08 && port <= 0x0B) T.curFrame.vi_ports++;
    }
    return oldOut(port, w8);
  };
  T.frameNo = 0;

  // --- состояния прерываний / контекстов ---
  const irq = [];            // стек кадров ISR: {ret, sp}
  const ctxs = [];           // контексты звука: {sp, ret, depth, entry}
  const wrStack = [];        // открытые вызовы WRTPSG
  const viStack = [];        // открытые вызовы vec_vi_ch
  let lastWr = null;         // предыдущий закрытый вызов WRTPSG (для пар hi/lo)
  let lastCtxRet = -1;
  let glueLeft = 0;
  let instrTotal = 0;        // такты инструкций за кадр (для независимого замыкания)
  let accepts = 0;

  function newFrame() {
    return {
      cat: new Float64Array(NC), dep: new Float64Array(3 * NC), total: 0, accepts: 0, gs: rd(L.GameStatus),
      ids: [rd(L.MusicChanData + 2) & 0x3F, rd(L.MusicChanData2 + 2) & 0x3F, rd(L.MusicChanData3 + 2) & 0x3F],
      ticks: 0, ticks_by_depth: [0, 0, 0], tick_entry: {}, cycles_nonsound: 0, ay_ports: 0, vi_ports: 0,
      wr: 0, wr_same: 0, wr_same_cyc: 0, wr_cyc: 0, wr_ext: 0, wr_ext_cyc: 0,
      wr_reg: new Int32Array(16), wr_same_reg: new Int32Array(16), wr_cyc_reg: new Float64Array(16), wr_same_cyc_reg: new Float64Array(16),
      vich: 0, vich_same: 0, vich_same_cyc: 0, vich_cyc: 0,
      vol_calls: 0, vol_cyc: 0, vol_useful: 0, vol_useful_cyc: 0, vol_useless: 0, vol_useless_cyc: 0,
      per_calls: 0, per_cyc: 0, mix_calls: 0, mix_cyc: 0,
      pair: 0, pair_cyc: 0, pair_vich_cyc: 0, noeff: 0, noeff_cyc: 0, pair_eff_cyc: 0,
      kind_cyc: new Float64Array(3), // драйвер: музыка / эффект / нет канала
      ctx_cyc: 0, entry_cyc: 0, helper_cyc: 0, pcrange_cyc: 0,
      starts: 0,
    };
  }
  function newStep(gs) {
    return { cat: new Float64Array(NC), total: 0, gs, frames: 0, ticks: 0, b: { wr_calls: 0, wr_cyc: 0, wr_same_cyc: 0, noeff_cyc: 0, pair_eff_cyc: 0, vich_calls: 0, vich_same_cyc: 0, vol_useless_cyc: 0, pair: 0, pair_cyc: 0 } };
  }

  // --- обёртки ---
  const oldInstruction = cpu.instruction.bind(cpu);
  const oldCheck = v06c.checkInterrupt.bind(v06c);
  const oldOneInt = v06c.oneInterrupt.bind(v06c);
  const oldWrite = memory.write.bind(memory);

  v06c.checkInterrupt = function () {
    if (T.armed && this.irq && cpu.iff) {
      const ret = cpu.pc + (cpu.last_opcode === 0x76 ? 1 : 0);
      irq.push({ ret: ret & 65535, sp: (cpu.sp - 2) & 65535 });
      if (T.curFrame) { T.curFrame.accepts++; }
    }
    return oldCheck();
  };
  v06c.oneInterrupt = function (...a) {
    if (!T.armed) return oldOneInt(...a);
    const f = newFrame();
    T.curFrame = f; T.frames.push(f); T.frameNo = T.frames.length;
    f.step = T.steps.length; // индекс шага, внутри которого начался кадр
    const r = oldOneInt(...a);
    f.total = 0; for (let i = 0; i < NC; i++) f.total += f.cat[i];
    f.total += f.accepts * 16;
    return r;
  };
  memory.write = function (a, b, stack) {
    if (T.armed && (a & 65535) === L.tickInProgress && (b & 255) === 1 && rd(a) === 0) {
      const s = newStep(rd(L.GameStatus));
      T.curStep = s; T.steps.push(s);
    }
    return oldWrite(a, b, stack);
  };

  function ctxActive(depth) {
    for (let i = ctxs.length - 1; i >= 0; i--) if (ctxs[i].depth === depth) return true;
    return false;
  }

  function charge(cat, c, depth) {
    const f = T.curFrame; if (!f) return;
    f.cat[cat] += c;
    f.dep[Math.min(depth, 2) * NC + cat] += c;
    const s = T.curStep; if (s) s.cat[cat] += c;
  }

  cpu.instruction = function () {
    if (!T.armed) return oldInstruction();
    const pc = cpu.pc, op = rd(pc), depth = irq.length;
    const f = T.curFrame;
    let entryName = entryAt.get(pc);
    // открыть контекст звука
    if (entryName) {
      const sp = cpu.sp, ret = rd16(sp);
      let dup = false;
      for (const c of ctxs) if (c.depth === depth && c.sp === sp && c.ret === ret) { dup = true; break; }
      if (!dup) ctxs.push({ sp, ret, depth, entry: entryName });
      if (entryName === "updateSound" && f) {
        f.ticks++; f.ticks_by_depth[Math.min(depth, 2)]++;
        const top = ctxs[ctxs.length - 1];
        const key = (dup ? "(tail)" : "(call)");
        const en = (ctxs.find((c) => c.depth === depth && c.sp === sp && c.ret === ret) || {}).entry;
        // кто породил тик: имя первого контекста с этим sp/ret
        f.tick_entry[en] = (f.tick_entry[en] || 0) + 1;
        if (T.curStep) T.curStep.ticks++;
      }
      if (entryName === "SetMusic_") T.soundStarts.push({ frame: T.frames.length, depth, id: cpu.regs[7], stepGs: rd(L.GameStatus) });
    }
    const inCtx = ctxs.length ? ctxActive(depth) : false;
    // открыть вызов WRTPSG
    let wrRec = null;
    if (pc === L.WRTPSG) {
      const reg = cpu.regs[7], val = cpu.regs[3];
      wrRec = {
        sp: cpu.sp, ret: rd16(cpu.sp), depth, reg: reg & 15, regFull: reg, val, sound: inCtx,
        shadow: rd(L.vec_ayregs + (reg & 15)), cyc: 0, frame: T.frames.length, vich_cyc: 0, vich: [],
        mode: rd(L.vec_snd_mode), pcCaller: rd16(cpu.sp),
      };
      wrStack.push(wrRec);
    }
    let viRec = null;
    if (chip === 1 && pc === L.vec_vi_ch) {
      const ch = cpu.regs[7] & 3;
      viRec = { sp: cpu.sp, ret: rd16(cpu.sp), depth, ch, before: ch < 3 ? viKey(ch) : "", cyc: 0, parent: wrStack.length ? wrStack[wrStack.length - 1] : null, frame: T.frames.length };
      viStack.push(viRec);
    }
    // категория
    let cat, viaGlue = false;
    const tgt = (op === 0xCD || (op & 0xC7) === 0xC4) ? rd16(pc + 1) : -1;
    const isGlueOp = (op === 0x3A || op === 0x32 || op === 0x21) && gluesAddr.has(rd16(pc + 1));
    const nextIsEntryCall = op === 0xF5 && rd(pc + 1) === 0xCD && entryAt.has(rd16(pc + 2)) && !isStartEntry(entryAt.get(rd16(pc + 2)));
    if (pc === lastCtxRet && op === 0xF1) { cat = CI.clk_entry; viaGlue = true; }
    else if (isGlueOp || nextIsEntryCall || glueLeft > 0) {
      cat = CI.clk_entry; viaGlue = true; if (glueLeft > 0) glueLeft--;
      if (op === 0x21 && rd16(pc + 1) === L.vsnd_acc) glueLeft = 3;
    } else if (inCtx) {
      cat = map[pc];
      if (cat === CI.nonsound) cat = CI.drv_other; // вспомогательные процедуры, вызванные драйвером (ADD_A_HL, vec_ldir_bwd)
    } else {
      cat = map[pc];
      if (cat >= CI.ov_shadow && cat <= CI.out_svc) cat = CI.ext_overlay;
      else if (cat < NSND) { cat = CI.nonsound; T.orphan[pc] = (T.orphan[pc] || 0) + 1; }
    }
    const preSp = cpu.sp;
    const kindInfo = inCtx && cat >= CI.drv_parse && cat <= CI.drv_other;
    let kind = 2;
    if (kindInfo) {
      const ix = rd16(L.z80_ix);
      if (ix >= L.MusicChanData && ix <= L.MusicChanData3) {
        const id = rd(ix + 2) & 0x3F;
        kind = id === 0 ? 2 : (id >= 1 && id <= 10 ? 1 : 0);
      }
    }
    oldInstruction();
    const c = cpu.vcycles | 0;
    // вызов в вход звука (в т.ч. условный: проверяем, что вызов состоялся)
    if (tgt >= 0 && cpu.pc === tgt && cpu.sp === ((preSp - 2) & 65535) && entryAt.has(tgt)) {
      cat = isStartEntry(entryAt.get(tgt)) ? CI.drv_start : CI.clk_entry; viaGlue = true;
    }
    if (f) {
      if (viaGlue) f.entry_cyc += c; else if (inCtx) f.ctx_cyc += c;
      if (inCtx && !viaGlue && map[pc] === CI.nonsound) f.helper_cyc += c;
      if (!viaGlue && map[pc] < NSND) f.pcrange_cyc += c;
    }
    charge(cat, c, depth);
    if (f && kindInfo) f.kind_cyc[kind] += c;
    // вызовы WRTPSG / vec_vi_ch: накопить такты
    if (wrStack.length) for (const w of wrStack) if (w.depth === depth) w.cyc += c;
    if (viStack.length) for (const v of viStack) if (v.depth === depth) v.cyc += c;
    // закрыть vec_vi_ch / WRTPSG
    const npc = cpu.pc, nsp = cpu.sp;
    while (viStack.length) {
      const v = viStack[viStack.length - 1];
      if (v.depth === irq.length && npc === v.ret && nsp === ((v.sp + 2) & 65535)) { viStack.pop(); closeVi(v); } else break;
    }
    while (wrStack.length) {
      const w = wrStack[wrStack.length - 1];
      if (w.depth === irq.length && npc === w.ret && nsp === ((w.sp + 2) & 65535)) { wrStack.pop(); closeWr(w); } else break;
    }
    // закрыть контексты звука
    for (let i = ctxs.length - 1; i >= 0; i--) {
      const x = ctxs[i];
      if (x.depth === irq.length && npc === x.ret && nsp === ((x.sp + 2) & 65535)) { ctxs.splice(i, 1); lastCtxRet = npc; }
    }
    // выход из ISR
    while (irq.length) {
      const fr = irq[irq.length - 1];
      if (npc === fr.ret && nsp === ((fr.sp + 2) & 65535)) {
        irq.pop();
        while (ctxs.length && ctxs[ctxs.length - 1].depth > irq.length) ctxs.pop();
        while (wrStack.length && wrStack[wrStack.length - 1].depth > irq.length) wrStack.pop();
        while (viStack.length && viStack[viStack.length - 1].depth > irq.length) viStack.pop();
      } else break;
    }
    return;
  };

  const same0 = (v) => viKey(v.ch) === v.before;
  function closeVi(v) {
    const f = T.curFrame; if (!f || v.ch > 2) return;
    const after = viKey(v.ch);
    const same = after === v.before;
    f.vich++; f.vich_cyc += v.cyc;
    if (T.curStep) { T.curStep.b.vich_calls++; if (same0(v)) T.curStep.b.vich_same_cyc += v.cyc; }
    if (same) { f.vich_same++; f.vich_same_cyc += v.cyc; }
    v.same = same; v.after = after;
    if (v.parent) { v.parent.vich.push(v); v.parent.vich_cyc += v.cyc; }
    if (T.recordCalls) T.viCalls.push({ f: T.frames.length, ch: v.ch, before: v.before, after, cyc: v.cyc, reg: v.parent ? v.parent.reg : -1 });
  }
  function closeWr(w) {
    const f = T.curFrame; if (!f) return;
    if (!w.sound) { f.wr_ext++; f.wr_ext_cyc += w.cyc; return; }
    const same = w.val === w.shadow;
    f.wr++; f.wr_cyc += w.cyc; f.wr_reg[w.reg]++; f.wr_cyc_reg[w.reg] += w.cyc;
    const sb = T.curStep ? T.curStep.b : null;
    if (sb) { sb.wr_calls++; sb.wr_cyc += w.cyc; if (same) sb.wr_same_cyc += w.cyc; }
    if (same) { f.wr_same++; f.wr_same_cyc += w.cyc; f.wr_same_reg[w.reg]++; f.wr_same_cyc_reg[w.reg] += w.cyc; }
    // классы для ВИ53
    if (chip === 1) {
      w.noeff = w.vich.every((v) => v.same);
      if (w.noeff) { f.noeff++; f.noeff_cyc += w.cyc; if (sb) sb.noeff_cyc += w.cyc; }
      if (w.reg >= 8 && w.reg <= 10) {
        f.vol_calls++; f.vol_cyc += w.cyc;
        const useful = w.vich.some((v) => !v.same);
        if (useful) { f.vol_useful++; f.vol_useful_cyc += w.cyc; } else { f.vol_useless++; f.vol_useless_cyc += w.cyc; if (sb) sb.vol_useless_cyc += w.cyc; }
      } else if (w.reg <= 5) { f.per_calls++; f.per_cyc += w.cyc; }
      else if (w.reg === 7) { f.mix_calls++; f.mix_cyc += w.cyc; }
    }
    // пара «старший, затем младший» одного голоса подряд
    if (lastWr && lastWr.frame === w.frame && lastWr.depth === w.depth && lastWr.reg < 6 && (lastWr.reg & 1) === 1 && w.reg === lastWr.reg - 1) {
      f.pair++; f.pair_cyc += lastWr.cyc; f.pair_vich_cyc += lastWr.vich_cyc;
      if (chip === 1 && !lastWr.noeff) { f.pair_eff_cyc += lastWr.cyc; if (sb) sb.pair_eff_cyc += lastWr.cyc; }
      if (sb) { sb.pair++; sb.pair_cyc += lastWr.cyc; }
    }
    if (T.recordCalls) T.wrCalls.push({ f: T.frames.length, reg: w.reg, val: w.val, shadow: w.shadow, cyc: w.cyc, vich: w.vich.map((v) => [v.ch, v.same ? 1 : 0, v.cyc]) });
    lastWr = w;
  }

  T.arm = function () { T.armed = true; };
  T.disarm = function () { T.armed = false; };
  T.recordCalls = !!opts.recordCalls;
  T.catMap = map;
  T.modechkLda = lda;
  T.ovsym = ovsym;
  return T;
}

module.exports = {
  ROOT, OUT, ROMDIR, ROM, SYM, CATS, CI, NSND, SECTION, q, sha256, manifest, parseSym,
  makeEmu, createTracker, buildCatMap, harness, patchChip,
};
