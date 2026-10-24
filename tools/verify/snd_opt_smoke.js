"use strict";
// Быстрая проверка: покадровый выход чипа base vs opt (stress, AY и ВИ53).
const fs = require("fs"), path = require("path"), vm = require("vm");
const stream = require("./snd_cost_stream.js");
const ROOT = path.resolve(__dirname, "../..");

function loadLib(romdir) {
  // перезагрузка модуля с другим ROMDIR
  delete require.cache[require.resolve("./snd_cost_lib.js")];
  process.env.SND_COST_ROMDIR = romdir;
  process.env.SND_COST_OUT = path.dirname(romdir);
  return require("./snd_cost_lib.js");
}

function runStress(lib, chip) {
  const src = fs.readFileSync(path.join(__dirname, "perf_baseline_1205.js"), "utf8")
    .split("// --- main ----------------------------------------------------------------")[0]
    .replace('const { make, toGame } = require("./beam_harness.js");', "const { make, toGame } = __harness;")
    .replace("  let TT = 0;", "  __trace.arm();\n  let TT = 0;");
  let T = null, E0 = null;
  const wrapped = {
    make() { const E = lib.makeEmu(chip); E0 = E; T = lib.createTracker(E, chip); T.capturePorts = true; return E; },
    toGame: lib.harness.toGame,
  };
  const context = {
    require, __dirname, console,
    process: { argv: ["node", "smoke"], exitCode: 0, exit(c) { throw new Error("exit " + c); } },
    Buffer, __harness: wrapped, __trace: { arm() { T.arm(); } },
  };
  vm.createContext(context);
  vm.runInContext(src + "\nthis.__runScene=runScene;", context, { filename: "smoke.in-memory.js" });
  context.__runScene("repro", 120, { repro: true });
  T.disarm();
  const nFrames = T.frames.length;
  const ports = T.ports.slice();
  const init = chip === 0
    ? { ay: new Uint8Array(16), vi: ["off", "off", "off"] }
    : { ay: new Uint8Array(16), vi: ["off", "off", "off"] };
  // начальное состояние после бута неизвестно точно — берём снимок с портов от кадра -1
  // statesFromPorts накопит с нуля; для сравнения base/opt важна относительная идентичность
  const states = stream.statesFromPorts ? null : null;
  return { E: E0, T, nFrames, ports, chip };
}

// локальная копия модели (stream не экспортирует всё)
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
  snapAY() { return Array.from(this.ay.subarray(0, 14)); }
  snapVI() {
    return this.vi.map((s, i) => {
      if (!s.on) return { ch: i, on: 0, mode: s.mode, div: -1 };
      return { ch: i, on: 1, mode: s.mode, div: s.div };
    });
  }
}

function frameStates(ports, nFrames, chip) {
  const m = new OutModel();
  const st = []; let pi = 0;
  for (let f = 0; f < nFrames; f++) {
    while (pi < ports.length && ports[pi][0] <= f) { m.port(ports[pi][1], ports[pi][2]); pi++; }
    st.push(chip === 0 ? m.snapAY() : m.snapVI());
  }
  return st;
}

function compare(a, b, chip) {
  const diffs = [];
  const n = Math.min(a.length, b.length);
  if (a.length !== b.length) diffs.push({ frame: -1, why: `nFrames ${a.length} vs ${b.length}` });
  for (let f = 0; f < n && diffs.length < 40; f++) {
    if (chip === 0) {
      for (let r = 0; r < 14; r++) if (a[f][r] !== b[f][r])
        diffs.push({ frame: f, reg: r, base: a[f][r], opt: b[f][r] });
    } else {
      for (let c = 0; c < 3; c++) {
        const A = a[f][c], B = b[f][c];
        if (A.on !== B.on || A.mode !== B.mode || A.div !== B.div)
          diffs.push({ frame: f, ch: c, base: A, opt: B });
      }
    }
  }
  return diffs;
}

function main() {
  const baseDir = path.join(ROOT, "outputs/snd-opt/rom_base");
  const optDir = path.join(ROOT, "outputs/snd-opt/rom_opt");
  for (const chip of [0, 1]) {
    const name = chip === 0 ? "AY" : "VI";
    console.log("===", name, "stress ===");
    const libB = loadLib(baseDir);
    const b = runStress(libB, chip);
    const libO = loadLib(optDir);
    const o = runStress(libO, chip);
    const sb = frameStates(b.ports, b.nFrames, chip);
    const so = frameStates(o.ports, o.nFrames, chip);
    const d = compare(sb, so, chip);
    console.log("frames", b.nFrames, o.nFrames, "ports", b.ports.length, o.ports.length, "diffs", d.length);
    if (d.length) console.log(JSON.stringify(d.slice(0, 10), null, 2));
    else console.log("OK: выход чипа совпал");
  }
}
main();
