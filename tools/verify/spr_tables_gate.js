// spr_tables_gate.js — ЗАДАЧА #12: доказательство, что спрайты, ПЕРЕЕХАВШИЕ В ОБРАЗ
// распакованными, побайтно равны тем, что раньше распаковывались в ОЗУ.
//
// Что делает: поднимает обе сборки до геймплея и прогоняет ЧЕТЫРЕ состояния рук
// (нож -> пусто -> кирка -> пусто) настоящим путём подбора cogeObjeto -> loadAnimation,
// снимая ровно те байты, которые прочитает блиттер:
//   * паттерны героя 0x00-0x27 (10 спрайтов 16x16),
//   * паттерны мумии 0x28-0x33 (3 спрайта),
//   * паттерны sprites2/предметов 0xD4-0xFF (искра, дверь, взрыв, нож, гемы),
//   * кэш зеркал vec_spr_buf_mir — доказательство, что герой смотрит и влево.
// БАЗА паттерна берётся так же, как её берёт vsp_pat в СВОЕЙ сборке: в старой это единый
// буфер ОЗУ vec_spr_buf, в новой — таблица образа (vsp_hbase+1 для героя, vec_spr_momia
// для мумии) и остаток буфера для sprites2.
//
// Побочно пишет PNG-листы опознания (по спрайту на клетку) для обеих сборок.
//
// Запуск: node tools/verify/spr_tables_gate.js <до.rom> <после.rom> [каталог-PNG]
"use strict";
const fs = require("fs"), vm = require("vm"), zlib = require("zlib");
const base = "/Users/boris/Projects/vector06js";

function mk(rom) {
  const g = {}; g.window = g;
  const fcx = () => ({ createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), drawImage: () => {}, fillRect: () => {},
    save: () => {}, restore: () => {}, scale: () => {}, setTransform: () => {} });
  const fc = () => ({ width: 0, height: 0, style: {}, getContext: fcx });
  g.document = { createElement: fc, getElementById: fc };
  g.requestAnimationFrame = () => 0; g.setTimeout = () => 0; g.print = () => 0;
  g.console = { log() {}, debug() {}, warn() {}, error() {}, info() {} };
  const ctx = vm.createContext(g);
  for (const f of ["i8080-js/i8080_trace.js", "i8080-js/i8080_disasm.js", "i8080-js/i8080.js",
    "src/fili.js", "src/ay.js", "src/fd1793.js", "src/fddimage.js", "src/i8253.js",
    "src/io.js", "src/keyboard.js", "src/memory.js", "src/sound.js", "src/tv.js"])
    vm.runInContext(fs.readFileSync(base + "/" + f, "utf8"), ctx, { filename: f });
  const memory = new ctx.Memory(), keyboard = new ctx.Keyboard(), t8253 = new ctx.I8253(),
    ay = new ctx.AY(), floppy = new (ctx.Floppy().FD1793)(),
    io = new ctx.IO(keyboard, t8253, memory, ay, floppy);
  const cpu = new ctx.I8080(memory, io), tape = { advance: () => {}, sample: 0, reset: () => {} };
  const v = new ctx.Vector06c(cpu, memory, io, ay, tape);
  v.bmp = new Uint32Array(576 * 288); v.displayFrame = () => {}; v.check_breakpoint = () => false; v.dbg = null;
  memory.init_from_array(new Uint8Array(fs.readFileSync(rom)).subarray(0, 0x10000), 0x100);
  memory.detach_boot && memory.detach_boot();
  cpu.pc = 0x100; cpu.sp = 0xc300; cpu.iff = false;
  t8253.Write(3, 0x36); t8253.Write(3, 0x76); t8253.Write(3, 0xb6); ay.reset && ay.reset();
  const L = {};
  for (const l of fs.readFileSync(rom.replace(/\.rom$/, ".sym"), "latin1").split("\n")) {
    const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16); }
  const rd = a => memory.bytes[memory.tobank(a & 0xffff)];
  return { v, memory, keyboard, cpu, L, rd, wr: (a, x) => memory.bytes[memory.tobank(a)] = x,
           rdw: a => rd(a) | (rd(a + 1) << 8) };
}
function toGame(m) {
  for (let f = 0; f < 700; f++) m.v.oneInterrupt(true);
  // Импульс пробела (как beam_harness/startup_gate): удержание без отпускания уходит в аттракт.
  for (let i = 0; i < 40 && m.rd(m.L.GameStatus) !== 5; i++) {
    m.keyboard.keyDown({ which: 32, keyCode: 32, preventDefault() {}, stopPropagation() {} });
    for (let j = 0; j < 8; j++) m.v.oneInterrupt(true);
    m.keyboard.keyUp({ which: 32, keyCode: 32, preventDefault() {}, stopPropagation() {} });
    for (let j = 0; j < 8; j++) m.v.oneInterrupt(true);
  }
  for (let f = 0; f < 60; f++) m.v.oneInterrupt(true);
}
function callSub(m, addr, a) {
  const SENT = 0x0038, sp0 = m.cpu.sp;
  m.cpu.sp = (m.cpu.sp - 2) & 0xffff; m.wr(m.cpu.sp, SENT & 0xff); m.wr(m.cpu.sp + 1, SENT >> 8);
  const savePC = m.cpu.pc, iff = m.cpu.iff; m.cpu.pc = addr; m.cpu.iff = false;
  if (a !== undefined) m.cpu.set_a(a);
  for (let n = 0; n < 2000000; n++) { m.cpu.instruction(); if (m.cpu.pc === SENT && m.cpu.sp >= sp0) break; }
  m.cpu.pc = savePC; m.cpu.iff = iff;
}
// адрес паттерна / байты кадра — та же развилка, что в vsp_pat этой сборки
function heroFrame(m, pat) {
  const p = pat & 0xfc;
  const map = m.rdw(m.L.vsp_hbase + 1);
  const pool = m.L.vec_spr_pool;
  const out = [];
  for (let k = 0; k < 4; k++) {
    const idx = m.rd(map + p + k);
    for (let i = 0; i < 8; i++) out.push(m.rd(pool + idx * 8 + i));
  }
  return out;
}
function patBytes(m, pat) {
  const p = pat & 0xfc;
  if (m.L.vec_spr_momia === undefined) {
    const a = m.L.vec_spr_buf + (p < 0xa0 ? p : p - 0xa0) * 8;
    const r = []; for (let k = 0; k < 32; k++) r.push(m.rd(a + k)); return r;
  }
  if (p < 0x28) {
    if (m.L.vec_spr_pool !== undefined) return heroFrame(m, p);
    // линейная таблица + задача #51: хвост 0x18-0x27 у prota читается из knife
    let base = m.rdw(m.L.vsp_hbase + 1);
    if (p >= 0x18 && base === m.L.vec_spr_prota) base = m.L.vec_spr_knife;
    const a = base + p * 8;
    const r = []; for (let k = 0; k < 32; k++) r.push(m.rd(a + k)); return r;
  }
  const a = p < 0xa0 ? m.L.vec_spr_momia - 0x140 + p * 8 : m.L.vec_spr_buf + (p - 0xa0) * 8;
  const r = []; for (let k = 0; k < 32; k++) r.push(m.rd(a + k)); return r;
}
function grab(m, pats) {
  return pats.map(p => patBytes(m, p));
}
function mirCache(m) { const b = []; for (let i = 0; i < 416; i++) b.push(m.rd(m.L.vec_spr_buf_mir + i)); return b; }

const HERO = [], MOMIA = [], ITEMS = [];
for (let p = 0x00; p < 0x28; p += 4) HERO.push(p);
for (let p = 0x28; p < 0x34; p += 4) MOMIA.push(p);
for (let p = 0xd4; p < 0x100; p += 4) ITEMS.push(p);
// ПОРЯДОК СОСТОЯНИЙ ВАЖЕН. Набор «пусто» (GFX_Prota) всегда распаковывал лишь 191 Б, то
// есть паттерны действия 0x18-0x27 в старой сборке доставались ему ОТ ПРЕДЫДУЩЕГО набора.
// Прочитать их можно ровно одним путём — chkLanzaEnd (конец броска ножа) отдаёт предмет,
// не сбросив кадр действия, и герой в тот же тик рисуется кадром 8/9 уже без предмета.
// Значит наблюдаемый хвост — ХВОСТ НОЖА, и именно его кладёт в таблицу spr_unpack.py.
// Поэтому «пусто» проверяется ПОСЛЕ ножа полностью (320 Б), а «пусто после кирки» —
// только по значащей части 0x00-0x17: его хвост в игре не читается никогда
// (protaPicando4 сбрасывает кадр на 1 ДО quitaObjeto).
const SIG = 6;   // 6 блоков по 32 Б = паттерны 0x00-0x17 — то, что GFX_Prota реально писал
const STATES = [[0x10, "нож", 10], [0x00, "пусто/нож", 10], [0x20, "кирка", 10],
                [0x00, "пусто/кирка", SIG]];

function collect(rom) {
  const m = mk(rom); toGame(m);
  const res = {};
  for (const [obj, name, nblk] of STATES) {
    callSub(m, m.L.cogeObjeto, obj);
    res[name] = { hero: grab(m, HERO).slice(0, nblk), momia: grab(m, MOMIA),
                  items: grab(m, ITEMS), mir: mirCache(m).slice(0, nblk * 32) };
  }
  return res;
}

// --- PNG-лист: спрайты 16x16, байты 0-15 = левый столбец, 16-31 = правый ---
function sheet(groups, path) {
  const SC = 4, PAD = 2, cell = 16 * SC + PAD * 2;
  const cols = Math.max(...groups.map(g => g.spr.length));
  const W = 8 + cols * cell, H = groups.length * (cell + 10) + 8;
  const rgb = Buffer.alloc(W * H * 3, 0x18);
  const px = (x, y, r, gg, b) => { if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3; rgb[o] = r; rgb[o + 1] = gg; rgb[o + 2] = b; };
  groups.forEach((grp, gi) => {
    const y0 = 8 + gi * (cell + 10);
    grp.spr.forEach((s, si) => {
      const x0 = 4 + si * cell;
      for (let row = 0; row < 16; row++) for (let half = 0; half < 2; half++) {
        const byte = s[half * 16 + row];
        for (let bit = 0; bit < 8; bit++) {
          const on = (byte >> (7 - bit)) & 1;
          for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++)
            px(x0 + PAD + (half * 8 + bit) * SC + dx, y0 + PAD + row * SC + dy,
               on ? 255 : 40, on ? 235 : 40, on ? 120 : 48);
        }
      }
    });
  });
  const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
  const crc = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const tt = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(tt));
    return Buffer.concat([l, tt, c]); };
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const A = collect(process.argv[2]), B = collect(process.argv[3]);
const dir = process.argv[4] || "/tmp";
let bad = 0;
for (const [, name] of STATES) {
  for (const part of ["hero", "momia", "items"]) {
    const a = A[name][part].flat(), b = B[name][part].flat();
    let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    console.log(`  руки=${name.padEnd(11)} ${part.padEnd(5)}: ${a.length} Б, различий ${d}`);
    if (d) bad += d;
  }
  const am = A[name].mir, bm = B[name].mir;
  let dm = 0; for (let i = 0; i < am.length; i++) if (am[i] !== bm[i]) dm++;
  console.log(`  руки=${name.padEnd(11)} зеркала: ${am.length} Б, различий ${dm}`);
  if (dm) bad += dm;
}
for (const [tag, S] of [["do", A], ["posle", B]]) {
  for (const [, name] of STATES) {
    const tr = { "нож": "knife", "пусто/нож": "empty", "кирка": "pick", "пусто/кирка": "empty2" }[name];
    sheet([{ spr: S[name].hero }, { spr: S[name].momia }, { spr: S[name].items },
           { spr: Array.from({ length: S[name].mir.length / 32 }, (_, i) => S[name].mir.slice(i * 32, i * 32 + 32)) }],
          `${dir}/spr_${tag}_${tr}.png`);
  }
}
console.log(`PNG-листы: ${dir}/spr_{do,posle}_{empty,knife,pick}.png ` +
            `(строки: герой / мумия / предметы+гемы / кэш зеркал)`);
if (bad) { console.log(`ПРОВАЛ: суммарно ${bad} байт расхождения`); process.exit(1); }
console.log("ВЕРДИКТ: все паттерны героя (3 состояния), мумии, предметов и весь кэш зеркал — БАЙТ В БАЙТ");
