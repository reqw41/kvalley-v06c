#!/usr/bin/env node
"use strict";
// snd_gen.js — сборочный шаг звука: потоки событий ВИ53 для проигрывателя src/v06c/vec_snd.asm.
//
//   node tools/snd_gen/snd_gen.js            — captured.json -> src/gen/snd_streams.asm (+ проверка потоков моделью)
//   node tools/snd_gen/snd_gen.js --recapture — сначала снять captured.json прогоном ИСХОДНОГО драйвера Konami
//                                              (tools/snd_gen/base_e2b8f32.rom/.sym, режим ВИ53) в эмуляторе vector06js
//
// captured.json закоммичен: обычная сборка (build.sh) эмулятор не требует и этот шаг не вызывает;
// src/gen/snd_streams.asm закоммичен. Перегенерировать — только если менялись нотные данные.
const fs = require("fs"), path = require("path"), cp = require("child_process");
const enc = require("./encode.js");
const HERE = __dirname, ROOT = path.resolve(HERE, "../..");
const CAP = path.join(HERE, "captured.json");
const OUTASM = path.join(ROOT, "src/gen/snd_streams.asm");
const OUTFAR = path.join(ROOT, "src/gen/snd_streams_far.asm");
// layout.json: {"far": [имена потоков]} — потоки, уносимые ЗА выровненные таблицы (см. README.md, «зазор .align»)
const LAYOUT = fs.existsSync(path.join(HERE, "layout.json")) ? JSON.parse(fs.readFileSync(path.join(HERE, "layout.json"), "utf8")) : { far: [] };
const FAR = new Set(LAYOUT.far || []);

if (process.argv.includes("--recapture")) {
  const r = cp.spawnSync(process.execPath, [path.join(HERE, "capture.js")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status);
}
const cap = JSON.parse(fs.readFileSync(CAP, "utf8"));
const JUNK2 = [0x0A55, 0x0B66, 0x0C77];

// аргумент SetMusic_ -> имя
const NAMES = { 2: "удар о пол", 3: "вращающаяся дверь", 4: "взятие предмета", 6: "бросок ножа", 8: "мумия взорвана", 9: "взятие гема",
  0x1D: "смерть героя", 0x20: "тишина", 0x45: "кирка", 0x87: "появление мумии", 0x8A: "доп. жизнь", 0x8B: "музыка игры",
  0x8D: "дверь закрывается", 0x8F: "колокольчик выхода", 0x91: "фанфары карты", 0x94: "stage clear", 0x97: "старт игры", 0x9A: "game over" };

// 1) события и токены каждого голоса
const sounds = []; // {arg,id,name,voices:[{c, tokens, ev, nT, loop}]}
for (const [argS, { a, b }] of Object.entries(cap.args)) {
  const arg = +argS, id = arg & 0x3F;
  const vs = [];
  a.voices.forEach((v, c) => {
    if (!v) return;
    const w = b.voices[c];
    const loop = v.loop ? { tA: v.loop.tA, tE: v.loop.tE } : null;
    const nT = loop ? loop.tE - 1 : v.endTick;
    const ev = enc.voiceEvents(v, w, c, nT, loop);
    const tokens = enc.tokenize(ev, nT, loop);
    vs.push({ c, tokens, ev, nT, loop, cap: [v, w] });
  });
  sounds.push({ arg, id, name: NAMES[arg] || "?", voices: vs });
}
// падение: [DW 1][ON div0][FALL]
const fallDiv0 = cap.fall[0][1];
const fallTokens = [{ k: "DW", n: 1 }, { k: "ON", div: fallDiv0 }, { k: "FALL" }];

// 2) таблица делителей
const divSet = new Set([fallDiv0]);
for (const s of sounds) for (const v of s.voices) for (const t of v.tokens) if (t.div !== undefined) divSet.add(t.div);
const divs = [...divSet].sort((x, y) => x - y);
if (divs.length > 128) throw new Error("делителей " + divs.length + " > 128");
const divIdx = new Map(divs.map((d, i) => [d, i]));

// 3) байты, дедупликация одинаковых потоков без меток
const streams = []; // {name, comment, bytes, labels, fix}
const byKey = new Map();
function addStream(name, comment, tokens) {
  const r = enc.toBytes(tokens, divIdx);
  const key = r.fix.length || Object.keys(r.labels).length ? null : r.bytes.join(",");
  if (key && byKey.has(key)) return byKey.get(key);
  const s = { name, comment, ...r };
  streams.push(s);
  if (key) byKey.set(key, s);
  return s;
}
const slot = {}; // id -> stream
const sfxSingle = (s) => s.voices.length === 1 && s.voices[0].c === 2;
for (const s of sounds) {
  s.voices.forEach((v, k) => {
    const nm = `vsn_${s.id}${s.voices.length > 1 ? "_" + (k + 1) : ""}`;
    const st = addStream(nm, `${s.name} (A=0x${s.arg.toString(16).toUpperCase()}), голос ${v.c + 1}`, v.tokens);
    slot[s.id + k] = st;
    v.stream = st;
  });
}
slot[1] = addStream("vsn_fall", "падение (id 1): делитель растёт на 108 за тик", fallTokens);
for (let i = 1; i <= 34; i++) if (!slot[i]) throw new Error("нет потока для id " + i);

// 4) проверка моделью проигрывателя против съёмки
let checked = 0;
for (const s of sounds) for (const v of s.voices) {
  const [va, vb] = v.cap;
  for (const [cc, junk] of [[va, enc.JUNK], [vb, JUNK2]]) {
    const total = cc.ticks.length;
    const sim = enc.simulate(v.stream, divs, total, enc.ay2vi(junk[v.c]));
    for (let t = 0; t < total; t++) {
      const ref = cc.ticks[t];
      const exp = [ref[0], ref[0] ? ref[1] : 0];
      if (sim[t][0] !== exp[0] || sim[t][1] !== exp[1]) throw new Error(`звук 0x${s.arg.toString(16)} голос ${v.c} тик ${t + 1}: модель ${sim[t].slice(0, 2)} != съёмка ${exp}`);
      // остаток периода (для голоса 3): состояние делителя памяти == pdiv съёмки, когда оно не «чужое»
      if (v.c === 2 && cc === va) {
        const pd = ref[2];
        const other = vb.ticks[t][2];
        if (pd === other && sim[t][2] !== pd) throw new Error(`звук 0x${s.arg.toString(16)} тик ${t + 1}: период ${sim[t][2]} != ${pd}`);
      }
      checked++;
    }
  }
}
{
  const fst = enc.simulate(slot[1], divs, cap.fall.length, 0);
  cap.fall.forEach((r, i) => { if (fst[i][0] !== r[0] || fst[i][1] !== r[1]) throw new Error("падение тик " + (i + 1)); checked++; });
}

// 5) вывод asm
const lines = [];
lines.push("; ГЕНЕРИРУЕТСЯ tools/snd_gen/snd_gen.js — не править руками (формат потока — в tools/snd_gen/encode.js).");
lines.push("; Источник: покадровая съёмка ИСХОДНОГО драйвера Konami (сборка e2b8f32, режим ВИ53), tools/snd_gen/captured.json.");
lines.push("; vsn_tab: слово на каждый id звука 1..34 (голос k звука id лежит в слоте id+k, как раньше MusicIndex).");
lines.push("vsn_tab:");
for (let i = 1; i <= 34; i++) lines.push(`\tdw\t${slot[i].name}\t; ${i}`);
lines.push("; vsn_div: делители ВИ53 (13P + P/2 для периода AY P); индекс — в токене ON/PERIOD.");
lines.push("vsn_div:");
for (let i = 0; i < divs.length; i += 8) lines.push("\tdw\t" + divs.slice(i, i + 8).map((d) => "0x" + d.toString(16).toUpperCase().padStart(4, "0")).join(", "));
const farLines = ["; ГЕНЕРИРУЕТСЯ tools/snd_gen/snd_gen.js — потоки звука, вынесенные за выровненные таблицы (layout.json). Не править руками."];
for (const s of streams) {
  const dst = FAR.has(s.name) ? farLines : lines;
  dst.push(`; ${s.comment}`);
  dst.push(`${s.name}:`);
  const m = new Map(); // смещение -> метка
  for (const [nm, off] of Object.entries(s.labels)) m.set(off, `${s.name}_${nm}`);
  const fixAt = new Map(s.fix.map((f) => [f.at, f.name]));
  let row = [];
  const flush = () => { if (row.length) dst.push("\tdb\t" + row.join(", ")); row = []; };
  for (let i = 0; i < s.bytes.length; i++) {
    if (m.has(i)) { flush(); dst.push(`${m.get(i)}:`); }
    if (fixAt.has(i)) { flush(); dst.push(`\tdw\t${s.name}_${fixAt.get(i)}`); i++; continue; }
    row.push("0x" + s.bytes[i].toString(16).toUpperCase().padStart(2, "0"));
    if (row.length === 16) flush();
  }
  flush();
}
for (const f of FAR) if (!streams.some((s) => s.name === f)) throw new Error("layout.json: нет потока " + f);
fs.writeFileSync(OUTFAR, farLines.join("\n") + "\n");
lines.push("vsn_end:");
fs.writeFileSync(OUTASM, lines.join("\n") + "\n");
const total = streams.reduce((n, s) => n + s.bytes.length, 0);
console.log(`snd_gen: проверено тиков ${checked}; потоков ${streams.length}, байт потоков ${total}, делителей ${divs.length} (${divs.length * 2} Б), vsn_tab 68 Б -> ${path.relative(ROOT, OUTASM)}`);
const report = { streams_bytes: total, streams: streams.map((s) => ({ name: s.name, bytes: s.bytes.length, comment: s.comment })), dividers: divs.length, table_bytes: 68, divs_bytes: divs.length * 2, checked_ticks: checked };
fs.writeFileSync(path.join(HERE, "snd_gen_stats.json"), JSON.stringify(report, null, 1));
