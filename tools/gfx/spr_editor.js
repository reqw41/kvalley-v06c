// spr_editor.js — БРАУЗЕРНЫЙ РЕДАКТОР СПРАЙТОВ ГЕРОЯ И МУМИИ (двухслойных, 16x16).
//
// ЗАЧЕМ. tile_editor.js правит ЦВЕТ тайлов предметов (форма приходит из данных уровня,
// граница цвета живёт в блиттере). Здесь задача другая: править САМУ ФОРМУ спрайтов, и
// править её ПОСЛОЙНО — герой физически рисуется ДВУМЯ спрайтами в одной точке:
//   слот 4 = ОДЕЖДА (цвет-ниббл 0x0E, protaColorRopa) -> плоскость p2        -> idx2
//   слот 5 = КОЖА   (цвет-ниббл 6,    ProtaColorPiel) -> p1 + ДУБЛЬ в p2     -> idx6
// Маршрут плоскостей ЗАМЕРЕН (tools/verify/slot_ledger.js, хук на vns_pbset), а не взят из
// комментариев: «ГЕРОЙ: ниббл e -> p2 = idx2, ниббл 6 -> p1(+дубль p2) = idx6».
// Значит пиксель принадлежит СЛОЮ, а цвет — уже следствие, и кисть здесь выбирает слой.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ИНСТРУМЕНТ, А НЕ РАСШИРЕНИЕ tile_editor. У тайла один слой 8x8, форма
// неизменна, а на выходе — маски плоскостей для вставки в ассемблер. У спрайта два слоя,
// 16x16, форма правится, а на выходе — ИСХОДНИК src/res/gfx/hero_momia_rle.txt, который
// потом проходит штатный путь spr_unpack.py -> src/gen/vec_sprdata.asm. Общего кода почти
// нет, склейка дала бы страницу, где половина элементов управления всегда лишняя.
//
// ЧТО СНИМАЕТСЯ ИЗ ЖИВОЙ СБОРКИ (замер, не догадки):
//   - палитра геймплея на всех четырёх схемах камня (пирамиды 1/5/9/13, io.Palette);
//   - плоскости фоновых клеток (кирпич 0x40, лестница 0x75, пустота 0x00) прямым вызовом
//     vec_blit_tile — предпросмотр героя идёт ПОВЕРХ настоящего фона;
//   - таблица framesProta (номер спрайта для каждого кадра анимации) — подписи кадров;
//   - сами таблицы vec_spr_* — как СВЕРКА того, что JS-распаковщик RLE читает исходник
//     ровно так же, как spr_unpack.py.
// Замер сцены кэшируется в build/spr_editor_scene.json (полный прогон ~2 мин: навигация
// по пирамидам). Пересъёмка: --remeasure.
//
// ЦИКЛ ПРАВКИ (правка ОБЯЗАНА идти через исходник, иначе её сотрёт следующая генерация):
//   node tools/gfx/spr_editor.js          -> build/spr_editor.html
//   node tools/gfx/spr_editor.js --mummy  -> build/momia_editor.html (мумия: оригинал + сдвиг + cap8)
//   правим в браузере, жмём «Скачать hero_momia_rle.txt»
//   кладём файл в src/res/gfx/, затем:
//   python3 tools/gfx/spr_unpack.py       -> src/gen/vec_sprdata.asm
//   tools/build_nodeploy.sh
// Страница умеет и ЗАГРУЗИТЬ hero_momia_rle.txt обратно (кнопка «Загрузить файл»), поэтому
// правки инкрементальные и повторный прогон node для этого не нужен.
//
// Запуск: node tools/gfx/spr_editor.js [rom] [sym] [выходной html] [--remeasure] [--mummy]
"use strict";
const fs = require("fs"), path = require("path");
const { make, toGame } = require("../verify/beam_harness.js");
const REPO = path.join(__dirname, "..", "..");
const MUMMY = process.argv.includes("--mummy");
const REMEASURE = process.argv.includes("--remeasure");
const args = process.argv.slice(2).filter(a => a !== "--remeasure" && a !== "--mummy");
const ROM = args[0] || path.join(REPO, "build/kvalley_8c.rom");
const SYM = args[1] || ROM.replace(/\.rom$/, ".sym");
const OUT = args[2] || path.join(REPO, MUMMY ? "build/momia_editor.html" : "build/spr_editor.html");
const SRC = path.join(REPO, "src/res/gfx/hero_momia_rle.txt");
const CACHE = path.join(REPO, "build/spr_editor_scene.json");

// ============================ 1. ИСХОДНИК RLE -> БАЙТЫ ============================
// Точная копия чтения и распаковки из tools/gfx/spr_unpack.py. Держим её здесь, а не
// зовём питон, потому что тот же самый код должен УЕХАТЬ В СТРАНИЦУ: браузеру нужно и
// распаковывать загруженный файл, и запаковывать правку обратно.
const SGT = 0x1800, HERO_LEN = 0x140, MOMIA_AT = 0x1940, MOMIA_LEN = 0x60;
const MOMIA_LSHIFT = 3;                 // см. momia_push_left в spr_unpack.py
const SETS = [
  { key: "GFX_Prota",      label: "vec_spr_prota", base: SGT,      len: HERO_LEN,  caption: "герой без предмета", hero: true },
  { key: "GFX_ProtaKnife", label: "vec_spr_knife", base: SGT,      len: HERO_LEN,  caption: "герой с ножом",      hero: true },
  { key: "GFX_ProtaPico",  label: "vec_spr_pico",  base: SGT,      len: HERO_LEN,  caption: "герой с киркой",     hero: true },
  { key: "GFX_MOMIA",      label: "vec_spr_momia", base: MOMIA_AT, len: MOMIA_LEN, caption: "мумия",              hero: false },
];

// --- разбор файла на блоки: заголовок = строка, не похожая на hex; тело = hex-байты
function readBlocks(text) {
  const blocks = {}, order = [], head = [];
  let cur = null, seenBlock = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) { if (!seenBlock) head.push(rawLine); continue; }
    const isHex = /^[0-9A-Fa-f ]+$/.test(line);
    if (!isHex) { cur = line; blocks[cur] = []; order.push(cur); seenBlock = true; continue; }
    if (!seenBlock) { head.push(rawLine); continue; }
    for (const t of line.split(/\s+/)) blocks[cur].push(parseInt(t, 16));
  }
  // шапка файла = всё до первого блока, включая комментарии
  const headText = text.split("\n").slice(0, text.split("\n").findIndex(l => /^GFX_/.test(l.trim()))).join("\n");
  return { blocks, order, head: headText };
}
// --- распаковка unpackGFXset -> {mem: Map(адрес->байт), used}
function unrle(b) {
  let addr = b[0] | (b[1] << 8), i = 2;
  const mem = new Map();
  while (i < b.length) {
    const n = b[i++];
    if (n === 0x00) break;
    if (n === 0x80) { addr = b[i] | (b[i + 1] << 8); i += 2; continue; }
    const cnt = n & 0x7F;
    if (n & 0x80) { for (let k = 0; k < cnt; k++) mem.set(addr++, b[i++]); }
    else { const v = b[i++]; for (let k = 0; k < cnt; k++) mem.set(addr++, v); }
  }
  return { mem, used: i };
}
// --- УПАКОВКА обратно. Жадная: серия >=3 одинаковых -> fill, иначе literal.
// Токен 0x00 (конец) и 0x80 (смена адреса) не порождаются никогда: счётчик всегда >=1.
function enrle(data, addrBase, top) {
  const out = [addrBase & 255, addrBase >> 8];
  let i = 0;
  const lit = [];
  const flushLit = () => {
    while (lit.length) {
      const n = Math.min(0x7F, lit.length);
      out.push(0x80 | n);
      for (let k = 0; k < n; k++) out.push(lit[k]);
      lit.splice(0, n);
    }
  };
  while (i < top) {
    let run = 1;
    while (i + run < top && data[i + run] === data[i] && run < 0x7F) run++;
    if (run >= 3) { flushLit(); out.push(run); out.push(data[i]); i += run; }
    else { for (let k = 0; k < run; k++) lit.push(data[i + k]); i += run; }
  }
  flushLit();
  return out;
}
// --- хвост «пусто» = хвост набора с ножом (fill_prota_tail в spr_unpack.py)
const PROTA_SIG = 0xC0;

function decodeSource(text) {
  const { blocks, order, head } = readBlocks(text);
  const sets = {};
  for (const s of SETS) {
    const raw = blocks[s.key];
    if (!raw) throw new Error("в исходнике нет блока " + s.key);
    const { mem, used } = unrle(raw);
    if (used !== raw.length) throw new Error(s.key + ": RLE не совпал с длиной блока");
    let top = 0;
    for (const a of mem.keys()) if (a + 1 - s.base > top) top = a + 1 - s.base;
    if (top > s.len) throw new Error(s.key + ": распаковка вышла за таблицу");
    const data = new Uint8Array(s.len);
    for (let k = 0; k < s.len; k++) data[k] = mem.has(s.base + k) ? mem.get(s.base + k) : 0;
    sets[s.key] = { data, top, rle: raw };
  }
  // хвост «пусто» берётся из набора с ножом — ровно как в генераторе
  const p = sets["GFX_Prota"], kn = sets["GFX_ProtaKnife"];
  for (let k = PROTA_SIG; k < HERO_LEN; k++) p.data[k] = kn.data[k];
  return { sets, order, head, blocks };
}
const srcText = fs.readFileSync(SRC, "utf8");
const SRCDEC = decodeSource(srcText);

// ============================ 2. ЖИВАЯ СБОРКА: СВЕРКА + СЦЕНА ============================
function momiaShift(data, k) {
  const out = Uint8Array.from(data);
  for (let blk = 0; blk < data.length; blk += 32)
    for (let r = 0; r < 16; r++) {
      let w = (data[blk + r] << 8) | data[blk + 16 + r];
      if (w & (~(0xFFFF >> k) & 0xFFFF)) throw new Error(`мумия: сдвиг на ${k} теряет биты (блок ${blk / 32}, строка ${r})`);
      w = (w << k) & 0xFFFF;
      out[blk + r] = w >> 8; out[blk + 16 + r] = w & 0xFF;
    }
  return out;
}
function momiaCap8(data) {
  const out = Uint8Array.from(data);
  for (let blk = 0; blk < data.length; blk += 32)
    for (let r = 0; r < 16; r++) {
      if (!data[blk + 16 + r]) continue;
      out[blk + r] = data[blk + r] | 0x01;
      out[blk + 16 + r] = 0;
    }
  return out;
}
function momiaToRom(data) { return momiaCap8(momiaShift(data, MOMIA_LSHIFT)); }

// blitTile уводит CPU в pc=0 и портит ОЗУ, поэтому каждая схема снимается на СВОЕЙ машине
// (то же правило, что в slot_ledger.js). Собираем прогоны по одному.
function measureAll() {
  const parts = [];
  let head = null;
  for (const pyr of [1, 5, 9, 13]) {
    const one = measureOne(pyr);
    if (!head) head = one;
    parts.push(one.scheme);
  }
  return { cmp: head.cmp, framesProta: head.framesProta, colRopa: head.colRopa, colPiel: head.colPiel, schemes: parts };
}
function measureOne(pyr) {
  const E = make(ROM, SYM);
  if (toGame(E) !== 5) throw new Error("не удалось дойти до геймплея");
  const { L, rd, v06c, io, memory, cpu } = E;
  const wr = (a, v) => memory.write(a & 0xffff, v, false);
  const cmp = [];
  for (const s of SETS) {
    const at = L[s.label];
    if (at === undefined) throw new Error("в .sym нет " + s.label);
    const rom = new Uint8Array(s.len);
    for (let k = 0; k < s.len; k++) rom[k] = rd(at + k);
    let js = SRCDEC.sets[s.key].data;
    if (s.key === "GFX_MOMIA") js = momiaToRom(js);
    let diff = 0;
    for (let k = 0; k < s.len; k++) if (rom[k] !== js[k]) diff++;
    cmp.push({ label: s.label, diff });
  }
  const framesProta = [];
  for (let k = 0; k < 10; k++) framesProta.push(rd(L.framesProta + k));
  const colRopa = rd(L.protaColorRopa), colPiel = rd(L.ProtaColorPiel);
  const raw2 = a => (((a >>> 22) & 3) << 6) | (((a >>> 13) & 7) << 3) | ((a >>> 5) & 7);
  const hex = v => "#" + [Math.round((v & 7) * 255 / 7), Math.round(((v >> 3) & 7) * 255 / 7),
    Math.round(((v >> 6) & 3) * 255 / 3)].map(x => x.toString(16).padStart(2, "0")).join("");
  while (rd(L.piramideActual) !== pyr) {
    const cur = rd(L.piramideActual);
    wr(L.piramideDest, cur + 1); wr(L.subStatus, 0); wr(L.GameStatus, 8);
    let w = 0;
    while (w < 6000 && !(rd(L.piramideActual) !== cur && rd(L.GameStatus) === 5)) { v06c.oneInterrupt(true); w++; }
    for (let i = 0; i < 40; i++) v06c.oneInterrupt(true);
    if (rd(L.piramideActual) === cur) throw new Error("пирамида " + pyr + " не загрузилась");
  }
  const pal = []; for (let s = 0; s < 16; s += 2) pal.push(hex(raw2(io.Palette[s] >>> 0)));
  const ROWT = 10, COLT = 10;
  function blitTile(t) {
    for (let a = 0x8000; a < 0xE000; a++) wr(a, 0);
    wr(L.vw_byte, t);
    cpu.set_b(ROWT); cpu.set_c(COLT);
    cpu.sp = (cpu.sp - 2) & 0xffff; wr(cpu.sp, 0); wr(cpu.sp + 1, 0);
    cpu.pc = L.vec_blit_tile;
    for (let i = 0; i < 2000000 && cpu.pc !== 0; i++) cpu.instruction();
    if (cpu.pc !== 0) throw new Error("vec_blit_tile не вернулся, тайл 0x" + t.toString(16));
    const g = [];
    for (let y = 0; y < 8; y++) {
      const lo = (255 - (ROWT * 8 + y)) & 255, row = [];
      const p0 = rd(0x8000 + COLT * 256 + lo), p1 = rd(0xA000 + COLT * 256 + lo), p2 = rd(0xC000 + COLT * 256 + lo);
      for (let x = 0; x < 8; x++) row.push((((p0 >> (7 - x)) & 1) << 3) | (((p1 >> (7 - x)) & 1) << 2) | (((p2 >> (7 - x)) & 1) << 1));
      g.push(row);
    }
    return g;
  }
  const bg = {};
  for (const [t, name] of [[0x00, "пустота"], [0x40, "кирпич"], [0x75, "лестница"]]) bg[name] = blitTile(t);
  return { cmp, framesProta, colRopa, colPiel, scheme: { pyr, scheme: ((pyr - 1) >> 2) & 3, pal, bg } };
}

// Ключ кэша — СОДЕРЖИМОЕ ПЗУ, а не mtime: пересборка без правок даёт байт-в-байт тот же
// образ, и переснимать по ней сцену (пять минут навигации по пирамидам) незачем.
const romHash = require("crypto").createHash("sha1").update(fs.readFileSync(ROM)).digest("hex");
let scene = null;
if (!REMEASURE && fs.existsSync(CACHE)) {
  const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  if (c.romHash === romHash) scene = c.scene;
}
if (!scene) {
  if (MUMMY || !REMEASURE) {
    process.stdout.write("замер схемы пирамиды 1...\n");
    const one = measureOne(1);
    scene = { cmp: one.cmp, framesProta: one.framesProta, colRopa: one.colRopa, colPiel: one.colPiel, schemes: [one.scheme] };
  } else {
    process.stdout.write("замер сцены (палитра + фоны на 4 схемах камня, ~5 мин)...\n");
    scene = measureAll();
    fs.writeFileSync(CACHE, JSON.stringify({ romHash, scene }));
  }
} else {
  process.stdout.write("сцена взята из кэша " + path.relative(REPO, CACHE) + " (--remeasure для пересъёмки)\n");
}
// сверка исходник<->образ считается ВСЕГДА заново на текущем ПЗУ, кэш её не подменяет
{
  const E = make(ROM, SYM);
  if (toGame(E) !== 5) throw new Error("не удалось дойти до геймплея");
  scene.cmp = SETS.map(s => {
    const at = E.L[s.label];
    const rom = new Uint8Array(s.len);
    for (let k = 0; k < s.len; k++) rom[k] = E.rd(at + k);
    let js = SRCDEC.sets[s.key].data;
    if (s.key === "GFX_MOMIA") js = momiaToRom(js);
    let diff = 0;
    for (let k = 0; k < s.len; k++) if (rom[k] !== js[k]) diff++;
    return { label: s.label, diff };
  });
}

// ============================ 3. САМОПРОВЕРКА УПАКОВЩИКА ============================
// Без неё экспорт нельзя отдавать: если enrle врёт, правка молча испортит спрайты.
const packCheck = [];
for (const s of SETS) {
  const d = SRCDEC.sets[s.key];
  let top = d.top;
  const src = s.key === "GFX_Prota" ? d.data.subarray(0, PROTA_SIG) : d.data;
  const rle = enrle(src, s.base, top);
  const back = unrle(rle);
  let ok = back.used === rle.length;
  for (let k = 0; k < top && ok; k++) ok = (back.mem.get(s.base + k) || 0) === src[k];
  let bt = 0; for (const a of back.mem.keys()) if (a + 1 - s.base > bt) bt = a + 1 - s.base;
  packCheck.push({ key: s.key, ok: ok && bt === top, was: d.rle.length, now: rle.length, top });
}

// ============================ 4. РАЗБОР НА КАДРЫ ============================
// Раскладка 16x16 = раскладка SGT MSX: спрайт = 4 паттерна по 8 Б = 32 Б,
// [0..15] ЛЕВАЯ половина (строки 0-15), [16..31] ПРАВАЯ. Номер спрайта в атрибуте = N,
// следующий спрайт пары = N+4 (setAttribProta зовёт setAttribProta3 дважды, второй раз
// с A+4). Первый спрайт пары — слот 4 (protaColorRopa = ОДЕЖДА), второй — слот 5
// (ProtaColorPiel = КОЖА): protaAttrib=0x72AB, значит цвет первого лежит в 0x72AE
// (protaColorRopa), цвет второго — в 0x72B2 (ProtaColorPiel).
const FP = scene.framesProta;
function frameUsers(pat) {                     // какие protaFrame ссылаются на этот спрайт
  const u = []; for (let f = 0; f < FP.length; f++) if (FP[f] === pat) u.push(f);
  return u;
}
const FRAME_NOTE = {
  0x00: "ноги вместе — покой, кадр 1 после действия, кадр на лестнице",
  0x08: "шаг — ходьба и подъём/спуск по лестнице",
  0x10: "ноги врозь — второй кадр ходьбы, он же прыжок",
  0x18: "ДЕЙСТВИЕ, кадр 1 — замах киркой (protaPicando) / бросок ножа (setFrameLanzar)",
  0x20: "ДЕЙСТВИЕ, кадр 2 — удар киркой / вторая фаза броска (setFrameLanzar2)",
};
const HERO_FRAMES = [0x00, 0x08, 0x10, 0x18, 0x20].map(pat => ({
  pat, blk: pat / 4, users: frameUsers(pat), note: FRAME_NOTE[pat] || "",
}));
const MOMIA_FRAMES = [
  { pat: 0x28, blk: 0, users: [], note: "стойка" },
  { pat: 0x2C, blk: 1, users: [], note: "шаг" },
  { pat: 0x30, blk: 2, users: [], note: "шаг 2" },
];

// ============================ 5. КОНСОЛЬНЫЙ ДАМП ============================
function dumpFrame(data, blk, twoLayer) {
  const bit = (b, r, c) => (data[b * 32 + (c < 8 ? r : 16 + r)] >> (7 - (c & 7))) & 1;
  const rows = [];
  for (let r = 0; r < 16; r++) {
    let s = "";
    for (let c = 0; c < 16; c++) {
      const o = bit(blk, r, c), k = twoLayer ? bit(blk + 1, r, c) : 0;
      s += k && o ? "@" : k ? "#" : o ? "o" : ".";
    }
    rows.push(s);
  }
  return rows;
}
console.log("\n=== СВЕРКА исходник -> JS-распаковка -> таблицы в образе ===");
for (const c of scene.cmp) console.log("  " + c.label.padEnd(15) + (c.diff ? "РАСХОЖДЕНИЕ " + c.diff + " Б" : "совпало байт-в-байт"));
console.log("\n=== САМОПРОВЕРКА УПАКОВЩИКА (enrle -> unrle) ===");
for (const p of packCheck)
  console.log("  " + p.key.padEnd(16) + (p.ok ? "ок" : "СЛОМАН") + "   значащих " + p.top +
    " Б, RLE было " + p.was + " -> станет " + p.now + " Б");
console.log("\n=== ЦВЕТ СЛОЁВ (замер) ===");
console.log("  одежда: ниббл 0x" + scene.colRopa.toString(16) + " -> p2      -> idx2  " + scene.schemes[0].pal[1]);
console.log("  кожа:   ниббл 0x" + scene.colPiel.toString(16) + " -> p1+p2   -> idx6  " + scene.schemes[0].pal[3]);
console.log("\n=== МУМИЯ оригинал / после сдвига+cap8 (o = пиксель) ===");
{
  const src = SRCDEC.sets["GFX_MOMIA"].data;
  const rom = momiaToRom(src);
  for (const f of MOMIA_FRAMES) {
    console.log("  " + f.note + "  pat 0x" + f.pat.toString(16));
    const a = dumpFrame(src, f.blk, false);
    const b = dumpFrame(rom, f.blk, false);
    for (let r = 0; r < 16; r++) console.log("    " + a[r] + "  |  " + b[r]);
  }
}
if (!MUMMY) {
  console.log("\n=== ГЕРОЙ С КИРКОЙ, все кадры (o = одежда p2/idx2, # = кожа p1+p2/idx6, @ = обе) ===");
  for (const f of HERO_FRAMES) {
    console.log("  спрайт 0x" + f.pat.toString(16).padStart(2, "0") + " — " + f.note);
    for (const r of dumpFrame(SRCDEC.sets["GFX_ProtaPico"].data, f.blk, true)) console.log("    " + r);
  }
}

// ============================ 6. СТРАНИЦА ============================
const PAGE = {
  sets: SETS.map(s => ({ key: s.key, label: s.label, caption: s.caption, hero: s.hero, base: s.base, len: s.len })),
  data: Object.fromEntries(SETS.map(s => [s.key, Array.from(SRCDEC.sets[s.key].data)])),
  tops: Object.fromEntries(SETS.map(s => [s.key, SRCDEC.sets[s.key].top])),
  rle: Object.fromEntries(SETS.map(s => [s.key, SRCDEC.sets[s.key].rle])),
  head: SRCDEC.head,
  heroFrames: HERO_FRAMES, momiaFrames: MOMIA_FRAMES,
  schemes: scene.schemes, PROTA_SIG, MOMIA_LSHIFT, HERO_LEN,
  startSet: MUMMY ? "GFX_MOMIA" : "GFX_ProtaPico",
};

const html = `<!DOCTYPE html><meta charset="utf-8">
<title>${MUMMY ? "Редактор спрайта мумии" : "Редактор спрайтов героя"}</title>
<h1>${MUMMY ? "Мумия: оригинал и то, что в образе" : "Спрайты героя — послойный редактор"}</h1>
${MUMMY ? `<p class="sub">Правим <b>неподрезанный</b> MSX-арт в <code>src/res/gfx/hero_momia_rle.txt</code>.
Генератор жмёт влево на 3 (<code>momia_push_left</code>) и загибает всё правее 8 px в край
(<code>momia_cap8</code>) — сейв тогда ≤ 16. Слева — снимок оригинала, он <b>не меняется</b>
от кликов. Рядом сетка правки, затем сдвиг и то, как ляжет в ПЗУ. Красная рамка — столбцы 0–2
(сдвиг их съест). Янтарный контур — пиксели, которые cap8 загнёт в столбец 7 образа.</p>` : `<p class="sub">Исходник <code>src/res/gfx/hero_momia_rle.txt</code>, распакован тем же RLE, что и
<code>tools/gfx/spr_unpack.py</code>; сверено с таблицами в живой сборке <code>${path.basename(ROM)}</code>.
Слева сетка <b>оригинала</b> — она не меняется, пока правите. Рядом — рабочая копия.</p>
<p class="sub"><b>Герой — ДВА спрайта в одной точке.</b> Слот 4 (<code>protaColorRopa</code>, ниббл
0x${scene.colRopa.toString(16)}) — ОДЕЖДА, идёт в плоскость p2 = idx2. Слот 5 (<code>ProtaColorPiel</code>,
ниббл 0x${scene.colPiel.toString(16)}) — КОЖА, идёт в p1 <i>и дублем</i> в p2 = idx6. Номер спрайта одежды
берётся из <code>framesProta</code>, кожа — тот же номер +4. Поэтому кисть выбирает СЛОЙ: цвет —
следствие того, в какую плоскость лёг пиксель.</p>
<p class="sub"><b>Спрайты прозрачные.</b> Гасить чужие плоскости умеет только мумия (vom_check);
герой кладёт свои биты ИЛИ-ом поверх фона. Правило наложения тут не выдумано: ровно эту модель
(OR по hi0/hi0b, ANDN по hi0c) проверяет <code>tools/verify/spr_resid_gate.js</code>, и она сходится
с настоящим кадровым буфером байт-в-байт. Отсюда и вид превью: одежда (p2) на кирпиче тона A
(idx8) даёт idx10 — тон B камня, а кожа (p1+p2) на нём же даёт idx14 (зелёный). Смотрите превью
на всех трёх фонах, а не только на чёрном.</p>
<p class="sub"><b>Что в превью упрощено.</b> Фон — ОДНА клетка 8&times;8, размноженная 2&times;2 на
габарит спрайта: настоящие 16&times;16 могут накрыть четыре РАЗНЫЕ клетки карты, и точное
положение зависит от X&amp;7. Это стенд «как складываются цвета», а не эмулятор кадра; за кадр
целиком отвечают гейты в <code>tools/verify/</code>.</p>`}
<div id="app"></div>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1600px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #6b7280; margin: 0 0 12px; max-width: 90ch; }
  .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 14px 16px; margin-bottom: 18px; }
  .card h2 { font-size: 15px; margin: 0 0 10px; }
  .flex { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; }
  .grid16 { display: grid; grid-template-columns: repeat(16, 17px); gap: 1px; width: max-content; }
  .cols { display: grid; grid-template-columns: repeat(16, 17px); gap: 1px; width: max-content;
          font: 9px ui-monospace, monospace; color: #6b7280; text-align: center; margin-bottom: 2px; }
  .px { width: 17px; height: 17px; cursor: crosshair; user-select: none;
        border: 1px solid rgba(128,128,128,.22); border-radius: 2px; }
  .px.ro { cursor: not-allowed; }
  .px:hover { outline: 2px solid #2563eb; outline-offset: -2px; }
  .px.ro:hover { outline: none; }
  .px.forbid { box-shadow: inset 0 0 0 1px #b91c1c; }
  .px.foldbit { outline: 2px solid #d97706; outline-offset: -2px; }
  .prev { display: grid; gap: 0; width: max-content; }
  .prev div { width: 9px; height: 9px; }
  .prev .capwall { box-shadow: inset -2px 0 0 #2563eb; }
  .pcap { font: 11px ui-monospace, monospace; color: #6b7280; margin: 0 0 3px; }
  button { font: 12px ui-monospace, monospace; padding: 4px 9px; border-radius: 6px;
           border: 1px solid #9ca3af; background: transparent; cursor: pointer; color: inherit; }
  button:hover { border-color: #2563eb; }
  button.on { border-color: #2563eb; border-width: 2px; font-weight: 600; }
  select { font: 12px ui-monospace, monospace; padding: 3px 6px; }
  .chip { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 5px;
          vertical-align: -1px; border: 1px solid rgba(128,128,128,.5); }
  textarea { width: 100%; height: 240px; font: 11px/1.35 ui-monospace, monospace; }
  .warn { color: #b91c1c; font-weight: 600; }
  .ok { color: #15803d; }
  .note { font: 12px ui-monospace, monospace; color: #6b7280; }
  @media (prefers-color-scheme: dark) { .card { border-color: #374151; } .sub,.pcap,.note { color: #9ca3af; } }
  :root[data-theme="light"] .card { border-color: #d1d5db; }
  :root[data-theme="dark"]  .card { border-color: #374151; }
</style>
<script>
const P = ${JSON.stringify(PAGE)};
for (const k in P.data) P.data[k] = Uint8Array.from(P.data[k]);
const ORIG = {}; for (const k in P.data) ORIG[k] = Uint8Array.from(P.data[k]);

// ---------- модель ----------
// Пиксель (r,c) спрайта blk: байт blk*32 + (c<8 ? r : 16+r), бит 7-(c&7).
const bitAt  = (d, blk, r, c) => (d[blk*32 + (c<8 ? r : 16+r)] >> (7-(c&7))) & 1;
const setBit = (d, blk, r, c, v) => { const i = blk*32 + (c<8 ? r : 16+r), m = 1 << (7-(c&7));
                                      d[i] = v ? (d[i]|m) : (d[i]&~m); };
let curSet = P.startSet || "GFX_ProtaPico", curScheme = 0, brush = 1, mirror = false, painting = false;
document.addEventListener("mouseup", () => { painting = false; });
const LAYERS = [ {v:0,n:"пусто",       col:null},
                 {v:1,n:"ОДЕЖДА p2",   col:1},     // idx2
                 {v:2,n:"КОЖА p1+p2",  col:3},     // idx6
                 {v:3,n:"обе (=кожа)", col:3} ];
const BGNAMES = ["пустота","кирпич","лестница"];

function setDef(){ return P.sets.find(s => s.key === curSet); }
function framesOf(){ return setDef().hero ? P.heroFrames : P.momiaFrames; }
function palNow(){ return P.schemes[curScheme].pal; }
// idx фона -> цвет; idx = p0*8 + p1*4 + p2*2 (p3 схлопнут)
const colOf = idx => palNow()[idx >> 1];

// Слой пикселя: 0 пусто, 1 одежда, 2 кожа, 3 обе.
function layerAt(d, f, r, c) {
  if (!setDef().hero) return bitAt(d, f.blk, r, c) ? 1 : 0;
  return bitAt(d, f.blk, r, c) | (bitAt(d, f.blk+1, r, c) << 1);
}
function layerSet(d, f, r, c, v) {
  if (!setDef().hero) { setBit(d, f.blk, r, c, v ? 1 : 0); return; }
  setBit(d, f.blk,   r, c, v & 1);
  setBit(d, f.blk+1, r, c, (v >> 1) & 1);
}
// Кладём спрайт ИЛИ-ом поверх idx фона — ровно как блиттер героя (гасит только мумия).
function overIdx(bgIdx, lay) {
  if (!setDef().hero) return lay ? (bgIdx | 2) : bgIdx;     // мумия: p2 (и она ещё гасит чужие)
  let v = bgIdx;
  if (lay & 1) v |= 2;            // одежда -> p2
  if (lay & 2) v |= 4 | 2;        // кожа   -> p1 + дубль p2
  return v;
}
const rev16 = w => { let r = 0; for (let i = 0; i < 16; i++) if (w & (1<<i)) r |= 1 << (15-i); return r; };
// Отзеркаленная строка кадра: слой каждого пикселя, справа налево.
function rowLayers(d, f, r) {
  const out = [];
  for (let c = 0; c < 16; c++) out.push(layerAt(d, f, r, c));
  return mirror ? out.reverse() : out;
}
// mode: orig = исходник; shift = после momia_push_left; cap8 = то, что в ПЗУ.
function mummyBit(d, blk, r, c, mode) {
  if (mode === "orig") return bitAt(d, blk, r, c);
  const o = c + P.MOMIA_LSHIFT;
  const sh = o < 16 ? bitAt(d, blk, r, o) : 0;
  if (mode === "shift") return sh;
  if (c >= 8) return 0;
  if (c < 7) return sh;
  let v = sh;
  for (let oc = 8 + P.MOMIA_LSHIFT; oc < 16; oc++) if (bitAt(d, blk, r, oc)) v = 1;
  return v;
}
function mummyBBox(d, f, mode) {
  let mn = 99, mx = -1, nr = 0, fold = 0;
  for (let r = 0; r < 16; r++) {
    let row = false;
    for (let c = 0; c < 16; c++) {
      if (mummyBit(d, f.blk, r, c, mode)) { mn = Math.min(mn, c); mx = Math.max(mx, c); row = true; }
      if (mode === "orig" && c >= 8 + P.MOMIA_LSHIFT && bitAt(d, f.blk, r, c)) fold++;
    }
    if (row) nr++;
  }
  return mx < 0 ? { w: 0, lo: 0, hi: -1, nr: 0, fold: 0 } : { w: mx - mn + 1, lo: mn, hi: mx, nr, fold };
}
function mummyMini(d, f, mode, label) {
  const wrap = document.createElement("div");
  const bb = mummyBBox(d, f, mode);
  const cap = document.createElement("div"); cap.className = "pcap";
  cap.textContent = label + "  [" + bb.lo + ".." + bb.hi + "] w=" + bb.w + (bb.fold ? "  загиб " + bb.fold : "");
  const gg = document.createElement("div"); gg.className = "prev";
  gg.style.gridTemplateColumns = "repeat(16, 9px)";
  for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
    const el = document.createElement("div");
    el.style.background = mummyBit(d, f.blk, r, c, mode) ? palNow()[1] : palNow()[0];
    if (mode === "cap8" && c === 7) el.className = "capwall";
    gg.appendChild(el);
  }
  wrap.appendChild(cap); wrap.appendChild(gg);
  return wrap;
}

// ---------- разметка ----------
const app = document.getElementById("app");
const bar = document.createElement("div"); bar.className = "card";
const frames = document.createElement("div");
const exportCard = document.createElement("div"); exportCard.className = "card";
app.appendChild(bar); app.appendChild(frames); app.appendChild(exportCard);

function drawBar() {
  bar.textContent = "";
  bar.innerHTML = "<h2>Что правим</h2>";
  const f = document.createElement("div"); f.className = "flex";
  const selSet = document.createElement("select");
  for (const s of P.sets) { const o = document.createElement("option");
    o.value = s.key; o.textContent = s.label + " — " + s.caption; if (s.key===curSet) o.selected = true;
    selSet.appendChild(o); }
  selSet.onchange = () => { curSet = selSet.value; drawAll(); };
  const selSch = document.createElement("select");
  P.schemes.forEach((s,i) => { const o = document.createElement("option");
    o.value = i; o.textContent = "схема " + s.scheme + " (пирамида " + s.pyr + ")";
    if (i===curScheme) o.selected = true; selSch.appendChild(o); });
  selSch.onchange = () => { curScheme = +selSch.value; drawAll(); };
  const mir = document.createElement("button");
  mir.textContent = "зеркало (влево)"; mir.className = mirror ? "on" : "";
  mir.onclick = () => { mirror = !mirror; drawAll(); };
  f.appendChild(selSet); f.appendChild(selSch); f.appendChild(mir);
  bar.appendChild(f);

  const b2 = document.createElement("div"); b2.className = "flex"; b2.style.marginTop = "10px";
  const cap = document.createElement("span"); cap.className = "note"; cap.textContent = "кисть:";
  b2.appendChild(cap);
  for (const l of LAYERS) {
    if (!setDef().hero && l.v > 1) continue;
    const b = document.createElement("button");
    b.className = l.v === brush ? "on" : "";
    b.innerHTML = (l.col === null ? '<span class="chip" style="background:' + palNow()[0] + '"></span>'
                                  : '<span class="chip" style="background:' + palNow()[l.col] + '"></span>') + l.n;
    b.onclick = () => { brush = l.v; drawAll(); };
    b2.appendChild(b);
  }
  bar.appendChild(b2);
  const hint = document.createElement("div"); hint.className = "note"; hint.style.marginTop = "8px";
  hint.textContent = setDef().hero
    ? "Клик красит пиксель на ПРАВОЙ сетке. Левая — снимок оригинала, от кликов не меняется. «Обе» = одежда+кожа; на экране это КОЖА (p1+p2 = idx6)."
    : "Мумия одноплоскостная (p2, idx2). Левая сетка — снимок неподрезанного оригинала (не меняется). Правим соседнюю. Сдвиг −" + P.MOMIA_LSHIFT + " и cap8 справа — то, что в ПЗУ. Столбцы 0–" + (P.MOMIA_LSHIFT - 1) + " оставьте пустыми.";
  bar.appendChild(hint);
}

function heroBBox(d, f) {
  let mn = 99, mx = -1, nr = 0;
  for (let r = 0; r < 16; r++) {
    let row = false;
    for (let c = 0; c < 16; c++) if (layerAt(d, f, r, c)) { mn = Math.min(mn, c); mx = Math.max(mx, c); row = true; }
    if (row) nr++;
  }
  return mx < 0 ? { w: 0, lo: 0, hi: -1, nr: 0 } : { w: mx - mn + 1, lo: mn, hi: mx, nr };
}
function makeGrid(d, f, opts) {
  const wrap = document.createElement("div");
  const cap = document.createElement("div"); cap.className = "pcap";
  cap.textContent = opts.caption;
  const nums = document.createElement("div"); nums.className = "cols";
  for (let c = 0; c < 16; c++) { const n = document.createElement("div"); n.textContent = String(c); nums.appendChild(n); }
  wrap.appendChild(cap); wrap.appendChild(nums);
  const g = document.createElement("div"); g.className = "grid16";
  const foldFrom = 8 + P.MOMIA_LSHIFT;
  const isMum = !setDef().hero;
  for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
    const lay = layerAt(d, f, r, c);
    const el = document.createElement("div"); el.className = "px" + (opts.ro ? " ro" : "");
    const L = LAYERS[lay];
    el.style.background = L.col === null ? "transparent" : palNow()[L.col];
    if (L.col === null) el.style.opacity = ".3";
    if (lay === 3) el.style.boxShadow = "inset 0 0 0 2px #2563eb";
    if (isMum && c < P.MOMIA_LSHIFT) el.classList.add("forbid");
    if (isMum && c >= foldFrom && lay) el.classList.add("foldbit");
    el.title = "строка " + r + ", столбец " + c + " -> " + L.n;
    if (!opts.ro) {
      const put = () => { layerSet(P.data[curSet], f, r, c, brush); drawFrames(); drawExport(); };
      el.onmousedown = e => { e.preventDefault(); painting = true; put(); };
      el.onmouseenter = () => { if (painting) put(); };
    }
    g.appendChild(el);
  }
  wrap.appendChild(g);
  return wrap;
}

function drawFrames() {
  frames.textContent = "";
  const d = P.data[curSet];
  const orig = ORIG[curSet];
  const sch = P.schemes[curScheme];
  const isMum = !setDef().hero;
  for (const f of framesOf()) {
    const box = document.createElement("div"); box.className = "card";
    const ro = curSet === "GFX_Prota" && f.pat*8 >= P.PROTA_SIG;
    const bbO = isMum ? mummyBBox(orig, f, "orig") : heroBBox(orig, f);
    const bbN = isMum ? mummyBBox(d, f, "cap8") : heroBBox(d, f);
    box.innerHTML = "<h2>спрайт 0x" + f.pat.toString(16).padStart(2,"0").toUpperCase() +
      (setDef().hero ? " / кожа 0x" + (f.pat+4).toString(16).padStart(2,"0").toUpperCase() : "") +
      " — " + f.note + (f.users.length ? "  <span class='note'>(protaFrame " + f.users.join(", ") + ")</span>" : "") +
      "  <span class='note'>оригинал [" + bbO.lo + ".." + bbO.hi + "] w=" + bbO.w +
      (bbN.w !== bbO.w || bbN.lo !== bbO.lo ? " → сейчас w=" + bbN.w : "") +
      (isMum && bbO.fold ? ", загиб " + bbO.fold + " px" : "") + "</span>" +
      (ro ? "  <span class='warn'>ХВОСТ НАБОРА С НОЖОМ — правится в наборе «нож»</span>" : "") + "</h2>";
    const flex = document.createElement("div"); flex.className = "flex";
    flex.appendChild(makeGrid(orig, f, { ro: true, caption: "оригинал — не меняется" }));
    flex.appendChild(makeGrid(d, f, { ro: ro, caption: ro ? "хвост ножа, только смотрим" : "правим" }));
    if (isMum) {
      flex.appendChild(mummyMini(d, f, "shift", "сдвиг −" + P.MOMIA_LSHIFT));
      flex.appendChild(mummyMini(d, f, "cap8", "в образе, cap8"));
    }
    const pv = document.createElement("div"); pv.className = "flex";
    for (const bgName of BGNAMES) {
      const bg = sch.bg[bgName];
      const w = document.createElement("div");
      const cap = document.createElement("div"); cap.className = "pcap";
      cap.textContent = "фон: " + bgName + (isMum ? " (как на экране)" : "");
      const gg = document.createElement("div"); gg.className = "prev";
      gg.style.gridTemplateColumns = "repeat(16, 9px)";
      for (let r = 0; r < 16; r++) {
        const lays = isMum
          ? (() => { const a = []; for (let c = 0; c < 16; c++) a.push(mummyBit(d, f.blk, r, c, "cap8")); return mirror ? a.reverse() : a; })()
          : rowLayers(d, f, r);
        for (let c = 0; c < 16; c++) {
          const bgIdx = bg[r & 7][c & 7];
          const el = document.createElement("div");
          el.style.background = colOf(overIdx(bgIdx, lays[c]));
          gg.appendChild(el);
        }
      }
      w.appendChild(cap); w.appendChild(gg); pv.appendChild(w);
    }
    flex.appendChild(pv);
    box.appendChild(flex);
    frames.appendChild(box);
  }
}

// ---------- упаковка обратно и экспорт ----------
function enrle(data, addrBase, top) {
  const out = [addrBase & 255, addrBase >> 8];
  let i = 0; const lit = [];
  const flushLit = () => { while (lit.length) { const n = Math.min(0x7F, lit.length);
      out.push(0x80 | n); for (let k = 0; k < n; k++) out.push(lit[k]); lit.splice(0, n); } };
  while (i < top) {
    let run = 1;
    while (i + run < top && data[i+run] === data[i] && run < 0x7F) run++;
    if (run >= 3) { flushLit(); out.push(run); out.push(data[i]); i += run; }
    else { for (let k = 0; k < run; k++) lit.push(data[i+k]); i += run; }
  }
  flushLit();
  return out;
}
function unrle(b) {
  let addr = b[0] | (b[1] << 8), i = 2; const mem = new Map();
  while (i < b.length) { const n = b[i++];
    if (n === 0) break;
    if (n === 0x80) { addr = b[i] | (b[i+1] << 8); i += 2; continue; }
    const cnt = n & 0x7F;
    if (n & 0x80) { for (let k = 0; k < cnt; k++) mem.set(addr++, b[i++]); }
    else { const v = b[i++]; for (let k = 0; k < cnt; k++) mem.set(addr++, v); } }
  return { mem, used: i };
}
// Сколько байт блока ЗНАЧАЩИЕ. Держим прежнюю границу, пока правка её не перешагнула:
// от неё зависит и хвост «пусто», и текст комментария в vec_sprdata.asm, то есть
// байт-в-байт совпадение при НЕИЗМЕНЁННЫХ данных.
function topOf(key) {
  const s = P.sets.find(x => x.key === key), d = P.data[key];
  const lim = key === "GFX_Prota" ? P.PROTA_SIG : s.len;
  let last = 0;
  for (let k = 0; k < lim; k++) if (d[k]) last = k + 1;
  return Math.max(P.tops[key], last);
}
function changed(key) {
  const a = P.data[key], b = ORIG[key];
  const lim = key === "GFX_Prota" ? P.PROTA_SIG : a.length;
  for (let k = 0; k < lim; k++) if (a[k] !== b[k]) return true;
  return false;
}
function hexLines(bytes, indent) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 16)
    out.push(indent + Array.from(bytes.slice(i, i+16)).map(v => v.toString(16).toUpperCase().padStart(2,"0")).join(" "));
  return out.join("\\n");
}
// Генератор ДОСДВИГАЕТ мумию влево на MOMIA_LSHIFT и АВАРИЙНО ВЫХОДИТ, если сдвиг съедает
// биты (momia_push_left). Ловим это здесь, до записи файла: три левых столбца обязаны быть
// пусты в КАЖДОЙ строке КАЖДОГО кадра.
function momiaShiftLoss() {
  const d = P.data["GFX_MOMIA"], bad = [];
  for (let blk = 0; blk * 32 < d.length; blk++)
    for (let r = 0; r < 16; r++)
      for (let c = 0; c < P.MOMIA_LSHIFT; c++)
        if (bitAt(d, blk, r, c)) bad.push("кадр " + blk + " строка " + r + " столбец " + c);
  return bad;
}
function buildFile() {
  const parts = [P.head.replace(/\\s*$/, "")];
  const report = [];
  const mloss = momiaShiftLoss();
  for (const s of P.sets) {
    const ch = changed(s.key);
    const top = topOf(s.key);
    const bytes = ch ? enrle(P.data[s.key], s.base, top) : P.rle[s.key];
    // проверка: распаковка обязана дать ровно то, что нарисовано
    const back = unrle(bytes);
    let bad = -1, bt = 0;
    for (const a of back.mem.keys()) if (a + 1 - s.base > bt) bt = a + 1 - s.base;
    for (let k = 0; k < top; k++) if ((back.mem.get(s.base + k) || 0) !== P.data[s.key][k]) { bad = k; break; }
    report.push({ key: s.key, ch, top, len: bytes.length, ok: bad < 0 && back.used === bytes.length && bt === top,
                  bad, over: top > s.len, mloss: s.key === "GFX_MOMIA" ? mloss : [] });
    parts.push("");
    parts.push(s.key);
    parts.push(hexLines(bytes, "  "));
  }
  return { text: parts.join("\\n") + "\\n", report };
}
function drawExport() {
  exportCard.textContent = "";
  exportCard.innerHTML = "<h2>Экспорт — новый src/res/gfx/hero_momia_rle.txt</h2>";
  const { text, report } = buildFile();
  const info = document.createElement("div"); info.className = "note";
  const lines = report.map(r => {
    const s = P.sets.find(x => x.key === r.key);
    if (r.over) return '<span class="warn">' + r.key + ": НЕ ВЛЕЗЛО — значащих " + r.top +
      " Б при потолке " + s.len + " Б. Набор в образе ФИКСИРОВАН, расти нельзя (в образе свободно 15 Б).</span>";
    if (!r.ok) return '<span class="warn">' + r.key + ": УПАКОВКА СЛОМАНА (расхождение на байте " + r.bad + ") — НЕ СОХРАНЯТЬ.</span>";
    if (r.mloss && r.mloss.length) return '<span class="warn">' + r.key + ": СДВИГ ГЕНЕРАТОРА СЪЕСТ БИТЫ — " +
      "momia_push_left двигает силуэт влево на " + P.MOMIA_LSHIFT + " пикс. и аварийно выйдет. Занято в левых " +
      P.MOMIA_LSHIFT + " столбцах: " + r.mloss.slice(0, 6).join("; ") + (r.mloss.length > 6 ? " и ещё " + (r.mloss.length - 6) : "") + ".</span>";
    return r.key + ": " + (r.ch ? "ИЗМЕНЁН, перепакован" : "без изменений, токены исходника взяты как есть") +
      ", значащих " + r.top + "/" + s.len + " Б, RLE " + r.len + " Б";
  });
  lines.push("<span class='note'>Размер образа от правки НЕ МЕНЯЕТСЯ: в ПЗУ едут таблицы фиксированной " +
    "длины (герой 3&times;320 Б, мумия 96 Б), а RLE-исходник в сборку не входит. Расти может только " +
    "«значащая» часть набора — за этим и следит потолок выше.</span>");
  info.innerHTML = lines.join("<br>");
  exportCard.appendChild(info);

  const bad = report.some(r => !r.ok || r.over || (r.mloss && r.mloss.length));
  const row = document.createElement("div"); row.className = "flex"; row.style.margin = "10px 0";
  const dl = document.createElement("button");
  dl.textContent = "Скачать hero_momia_rle.txt"; dl.disabled = bad;
  dl.onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], {type:"text/plain"}));
    a.download = "hero_momia_rle.txt"; a.click();
  };
  const up = document.createElement("input"); up.type = "file"; up.accept = ".txt";
  up.onchange = () => { const fr = new FileReader();
    fr.onload = () => { try { loadSource(fr.result); } catch (e) { alert("не разобрать файл: " + e.message); } };
    fr.readAsText(up.files[0]); };
  const rst = document.createElement("button");
  rst.textContent = "Откатить всё к исходнику";
  rst.onclick = () => { for (const k in ORIG) P.data[k] = Uint8Array.from(ORIG[k]); drawAll(); };
  row.appendChild(dl); row.appendChild(rst);
  const ulab = document.createElement("span"); ulab.className = "note"; ulab.textContent = "загрузить файл:";
  row.appendChild(ulab); row.appendChild(up);
  exportCard.appendChild(row);

  const steps = document.createElement("div"); steps.className = "note";
  steps.innerHTML = "Дальше: положить файл в <code>src/res/gfx/hero_momia_rle.txt</code>, затем " +
    "<code>python3 tools/gfx/spr_unpack.py</code> и <code>tools/build_nodeploy.sh</code>. " +
    "Править <code>src/gen/vec_sprdata.asm</code> руками нельзя — его перетрёт генератор.";
  exportCard.appendChild(steps);

  const ta = document.createElement("textarea"); ta.value = text; ta.readOnly = true;
  exportCard.appendChild(ta);
}
// Загрузка исходника обратно в страницу — тот же разбор, что в node-части.
function loadSource(text) {
  const blocks = {}; let cur = null;
  for (const raw of text.split("\\n")) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    if (!/^[0-9A-Fa-f ]+$/.test(line)) { cur = line; blocks[cur] = []; continue; }
    if (!cur) continue;
    for (const t of line.split(/\\s+/)) blocks[cur].push(parseInt(t, 16));
  }
  const nd = {}, nt = {}, nr = {};
  for (const s of P.sets) {
    const raw = blocks[s.key];
    if (!raw) throw new Error("нет блока " + s.key);
    const { mem, used } = unrle(raw);
    if (used !== raw.length) throw new Error(s.key + ": RLE не совпал с длиной блока");
    let top = 0; for (const a of mem.keys()) if (a + 1 - s.base > top) top = a + 1 - s.base;
    if (top > s.len) throw new Error(s.key + ": распаковка вышла за таблицу");
    const d = new Uint8Array(s.len);
    for (let k = 0; k < s.len; k++) d[k] = mem.has(s.base + k) ? mem.get(s.base + k) : 0;
    nd[s.key] = d; nt[s.key] = top; nr[s.key] = raw;
  }
  for (let k = P.PROTA_SIG; k < P.HERO_LEN; k++) nd["GFX_Prota"][k] = nd["GFX_ProtaKnife"][k];
  for (const k in nd) { P.data[k] = nd[k]; ORIG[k] = Uint8Array.from(nd[k]); P.tops[k] = nt[k]; P.rle[k] = nr[k]; }
  drawAll();
}
function drawAll() { drawBar(); drawFrames(); drawExport(); }
drawAll();
</script>`;

fs.writeFileSync(OUT, html);
console.log("\nстраница: " + OUT);
