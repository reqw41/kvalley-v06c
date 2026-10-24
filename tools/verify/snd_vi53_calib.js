#!/usr/bin/env node
"use strict";
// snd_vi53_calib.js — зависимость темпа стартового джингла от vsnd_k_cell (доля кадра на блит клетки).
//   node tools/verify/snd_vi53_calib.js <outfile.json> <k1,k2,...>
// Копирует src/ во временный каталог, подставляет значение, собирает sjasm'ом и гоняет jingle_tempo_gate.
// Репозиторий и build/ не трогает.
const fs = require("fs"), path = require("path"), cp = require("child_process"), os = require("os");
const ROOT = path.resolve(__dirname, "../..");
const out = process.argv[2], ks = process.argv[3].split(",").map(Number);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kvcal-"));
const res = [];
for (const k of ks) {
  const dir = path.join(tmp, "k" + k);
  fs.mkdirSync(dir, { recursive: true });
  cp.execSync(`cp -R "${ROOT}/src" "${dir}/src"`);
  const f = path.join(dir, "src/v06c/vec_boot.asm");
  const s = fs.readFileSync(f, "utf8");
  const s2 = s.replace(/(vsnd_k_cell:\s+equ )\d+/, `$1${k}`);
  if (s === s2 && !/vsnd_k_cell:\s+equ \d+/.test(s)) throw new Error("vsnd_k_cell не найден");
  fs.writeFileSync(f, s2);
  fs.mkdirSync(path.join(dir, "build"));
  const r = cp.spawnSync(path.join(ROOT, "tools/bin/sjasm"), ["-s", "src/kvalley_8c.asm", "build/k.rom", "build/k.lst", "build/k.sym"], { cwd: dir, encoding: "utf8" });
  if (!fs.existsSync(path.join(dir, "build/k.rom"))) throw new Error("sjasm: " + r.stdout + r.stderr);
  const g = cp.spawnSync(process.execPath, [path.join(ROOT, "tools/verify/jingle_tempo_gate.js"), path.join(dir, "build/k.rom"), path.join(dir, "build/k.sym")], { cwd: ROOT, encoding: "utf8", timeout: 400000 });
  const m = /джингл №1: (\d+) кадров, (\d+) тиков/.exec(g.stdout), m2 = /ВИ53\/AY по первой партии = ([\d.]+)/.exec(g.stdout);
  res.push({ k_cell: k, frames: m ? +m[1] : null, ticks: m ? +m[2] : null, ratio_to_ay: m2 ? +m2[1] : null, gate_exit: g.status });
  console.log(JSON.stringify(res[res.length - 1]));
  cp.execSync(`rm -rf "${dir}"`);
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
