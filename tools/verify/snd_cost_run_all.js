#!/usr/bin/env node
"use strict";
// snd_cost_run_all.js — полный прогон задачи sound-cost одной командой:
//   node tools/verify/snd_cost_run_all.js
// 1) SHA256 src/ build/ devector/ до; 2) копия ROM/SYM из outputs/stage-sched-nested (если ещё нет) и проверка SHA;
// 3) части А/Б по всем сценам и обоим чипам; 4) поток событий (часть В); 5) цена проигрывателя;
// 6) контроль старым стендом snd_tempo на копии ROM; 7) results.json -> REPORT.md; 8) SHA256 после.
const fs = require("fs"), path = require("path"), cp = require("child_process");
const lib = require("./snd_cost_lib.js");

const EXPECT = "764c32f5f827bbf8eea945eda4aafbfc358bb4095e5ab638abebfe3066138ecd";
const run = (args, opts = {}) => {
  const r = cp.spawnSync(process.execPath, args, { cwd: lib.ROOT, encoding: "utf8", maxBuffer: 1 << 28, ...opts });
  process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || "");
  if (r.status !== 0 && !opts.allowFail) throw new Error("сбой: " + args.join(" "));
  return r;
};
const V = (f) => path.join(__dirname, f);

fs.mkdirSync(lib.ROMDIR, { recursive: true });
const before = lib.manifest();
fs.writeFileSync(path.join(lib.OUT, "manifest_before.json"), JSON.stringify(before, null, 1));
console.log("манифест до:", Object.keys(before).length, "файлов");

const srcRom = path.join(lib.ROOT, "outputs/stage-sched-nested/kvalley_8c.rom"), srcSym = path.join(lib.ROOT, "outputs/stage-sched-nested/kvalley_8c.sym");
if (!fs.existsSync(lib.ROM)) {
  if (lib.sha256(srcRom) !== EXPECT) throw new Error("исходный ROM не совпал с ожидаемым SHA256");
  fs.copyFileSync(srcRom, lib.ROM); fs.copyFileSync(srcSym, lib.SYM);
}
if (lib.sha256(lib.ROM) !== EXPECT) throw new Error("копия ROM не совпала с ожидаемым SHA256");

run([V("snd_cost_measure.js"), "--chips", "ay,vi", "--scenes", "stress,natural,effects_knife,effects_gem,effects_death,scroll,idle_m0,idle_m2"]);
run([V("snd_cost_stream.js")]);
run([V("snd_cost_player.js")]);
run([V("snd_cost_assemble.js")]);
const t = run([V("snd_tempo.js"), lib.ROM, lib.SYM], { allowFail: true });
const lines = (t.stdout || "").trim().split("\n").filter(Boolean);

const after = lib.manifest();
fs.writeFileSync(path.join(lib.OUT, "manifest_after.json"), JSON.stringify(after, null, 1));
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]);
const res = JSON.parse(fs.readFileSync(path.join(lib.OUT, "results.json")));
res.sanity = { exit_code: t.status, last_line: lines[lines.length - 1] || "" };
res.integrity = { files_before: Object.keys(before).length, files_after: Object.keys(after).length, identical: changed.length === 0, changed };
fs.writeFileSync(path.join(lib.OUT, "results.json"), JSON.stringify(res, null, 1));
run([V("snd_cost_report.js")]);
console.log(changed.length ? "ВНИМАНИЕ: изменились файлы: " + changed.join(", ") : "файлы src/build/devector не менялись");
