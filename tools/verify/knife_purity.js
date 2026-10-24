// knife_purity.js — ПРИМЕСЬ ФОНА У СПРАЙТОВОГО НОЖА (жалоба с железа 2026-08-04:
// «нож при падении пересекается с лестницей ЗЕЛЁНЫМ цветом»).
//
// МЕХАНИКА ДЕФЕКТА. Спрайтовый нож (статусы 7/8, слоты 15..18, короткий путь vkn_blit)
// одноплоскостной: он делает OR в p2 и чужие плоскости под силуэтом НЕ ГАСИТ. Значит
// итоговый индекс пикселя = 2 | (то, что было в p0/p1 фона):
//     чёрный фон (0)      -> idx2  СЕРЫЙ   — как задумано;
//     лестница p0+p1 (12) -> idx14 ЗЕЛЁНЫЙ — ровно та жалоба;
//     кирпич  p1 (4)/p0(8)-> idx6 / idx10  — тоже не свой цвет.
// Тайловый нож (0x45-0x4B, фаза полёта) идёт ШТАТНЫМ путём блиттера тайлов и здесь
// не участвует — меряем только спрайтовый.
//
// КАК СЧИТАЕТ (всё с живого кадра, без моделей):
//   СИЛУЭТ — из паттерна ножа в vec_spr_buf, повёрнутого ровно так, как это делает
//            vkn_blit (8 верхних строк клетки, сдвиг s=X&7, перелив во второй столбец);
//   ФИНАЛ  — три плоскости fb СРАЗУ ПОСЛЕ vkn_blit (нож уже выведен, поверх него в этом
//            кадре никто не пишет — он рисуется последним).
// Примесь = пиксель силуэта, чей итоговый индекс НЕ РАВЕН чистому индексу своей
// плоскости (для p2 это idx2).
//
// ОБЯЗАТЕЛЬНОЕ ПОКРЫТИЕ: сцена «нож над лестницей» должна быть найдена, иначе замер
// покажет ноль и соврёт. Если пикселей с фоном-idx12 не нашлось — гейт ПАДАЕТ (код 3).
//
// Запуск: node tools/verify/knife_purity.js [rom] [sym] [тиков=2600]
"use strict";
const { make } = require("./beam_harness.js");
const T = __dirname;
const ROM = process.argv[2] || T + "/../../build/kvalley_8c.rom";
const SYM = process.argv[3] || T + "/../../build/kvalley_8c.sym";
const NT = +(process.argv[4] || 2600);
const E = make(ROM, SYM);
const { L, rd, v06c, memory, cpu, keyboard } = E;
// ДВА РЕЖИМА. A: нож идёт СВОИМ коротким путём (есть символ vkn_blit) — силуэт берём из
// паттерна и крутим ровно как vkn_blit. B: нож в ОБЩЕМ конвейере — силуэт берём из буфера
// слота (pg+0xA0), как в momia_hidden.js, а финал читаем после пачки vec_spr_out.
const MODE = L.vkn_blit !== undefined ? "A" : "B";
const need = ["timer", "GameStatus", "objetoCogido", "IDcuchilloCoge", "knifesData"]
  .concat(MODE === "A" ? ["vkn_blit", "vkn_shl", "vkn_pat", "vkn_hi", "vsu_lo", "vsu_nc", "vec_spr_buf"]
    : ["vec_spr_out", "vsp_n", "vsp_list"]);
for (const n of need) if (L[n] === undefined) { console.log("нет символа " + n); process.exit(2); }
function wr(a, v) { memory.write(a & 0xffff, v & 255, false); }

let outs = 0, silPx = 0, badPx = 0, badOuts = 0, frames = 0;
const byFinal = new Map();   // итоговый индекс пикселя ножа -> пикселей
const byBg = new Map();      // индекс фона под пикселем (p0/p1, свою p2 не считаем) -> пикселей
let retPC = -1, retSP = -1, shot = null;

// СИЛУЭТ + ГЕОМЕТРИЯ на входе в vkn_blit (операнды самомода уже проставлены vkn_one)
function beforeBlit() {
  const s = rd(L.vkn_shl + 1) & 7;
  const pat = rd(L.vkn_pat + 1);
  const hi0 = rd(L.vkn_hi + 1);          // p2 + col0 (страница fb)
  const lo0 = rd(L.vsu_lo);
  const nc = rd(L.vsu_nc);
  const base = L.vec_spr_buf + (((pat & 0xFC) - 0xA0) & 0xFF) * 8;
  const m1 = s ? (0xFF >> s) : 0xFF;      // маска своего столбца
  const m2 = nc > 1 ? (~m1) & 0xFF : 0;   // перелив в соседний (у правого края некуда)
  const px = [];
  for (let r = 0; r < 8; r++) {
    const b = rd(base + r); if (!b) continue;
    const rot = ((b >> s) | (b << (8 - s))) & 0xFF;   // ровно цепочка rrca
    const lo = (lo0 + 15 - r) & 0xFF;
    for (const [pg, mask] of [[hi0, rot & m1], [(hi0 + 1) & 0xFF, rot & m2]]) {
      if (!mask) continue;
      for (let bit = 0; bit < 8; bit++) if (mask & (1 << bit)) px.push([pg, lo, bit]);
    }
  }
  shot = { px, plane: (hi0 & 0xE0), col: (hi0 & 0x1F) };
}
// ФИНАЛ сразу после vkn_blit
function afterBlit() {
  if (!shot) return;
  const { px, plane, blocks, pg: spg, nc, hi0, lo0 } = shot; shot = null;
  const own = plane === 0x80 ? 8 : plane === 0xA0 ? 4 : 2;
  let bad = 0;
  for (const [pgp, lo, bit] of px) {
    const col = pgp & 0x1F;
    let f = 0, b0 = 0;
    for (const [pbase, w] of [[0x80, 8], [0xA0, 4], [0xC0, 2]]) {
      const page = (pbase + col) & 0xFF;
      if (rd((page << 8) | lo) & (1 << bit)) f |= w;
      // ФОН: сохранённую плоскость берём из блока сейва, несохранённую — из fb
      if (blocks && blocks.size) {
        const cOff = (pgp - hi0) & 0xFF, base = (pbase + (hi0 & 0x1F)) & 0xFF;
        const src = blocks.has(base) ? rd(spg + blocks.get(base) + cOff * 16 + ((lo - lo0) & 0xFF))
          : rd((page << 8) | lo);
        if (src & (1 << bit)) b0 |= w;
      }
    }
    const bg = (blocks && blocks.size) ? (b0 & ~own) : (f & ~own);
    silPx++;
    byFinal.set(f, (byFinal.get(f) || 0) + 1);
    byBg.set(bg, (byBg.get(bg) || 0) + 1);
    if (f !== own) { badPx++; bad++; }
  }
  outs++; if (bad) badOuts++;
}
// --- режим B: нож в общем конвейере; силуэт из буфера слота, финал после пачки ---
let pend = [];
function beforePack() {
  pend = [];
  const n = rd(L.vsp_n);
  for (let k = 0; k < n; k++) {
    const idx = rd(L.vsp_list + k); if (idx < 15 || idx > 18) continue;
    const pg = 0xE000 + idx * 256;
    if (rd(pg + 0x96) !== 1) continue;
    const nc = rd(pg + 0x99); if (!nc) continue;
    pend.push([pg, nc, rd(pg + 0x97), rd(pg + 0x98)]);
  }
}
function afterPack() {
  for (const [pg, nc, hi0, lo0] of pend) {
    const px = [];
    for (let c = 0; c < nc; c++) for (let r = 0; r < 16; r++) {
      const s = rd(pg + 0xA0 + c * 16 + r); if (!s) continue;
      const lo = (lo0 + r) & 0xFF, page = (hi0 + c) & 0xFF;
      for (let bit = 0; bit < 8; bit++) if (s & (1 << bit)) px.push([page, lo, bit]);
    }
    // ФОН для покрытия берём из save-under (в финале его уже нет — гашение его стёрло):
    // блоки идут в порядке hi0 -> hi0b -> hi0c по 16*ncols байт.
    const blocks = new Map();
    if (rd(pg) === 1 && rd(pg + 1) === hi0 && rd(pg + 2) === lo0 && rd(pg + 3) === nc) {
      let off = 6;
      for (const h of [rd(pg + 1), rd(pg + 4), rd(pg + 5)]) { if (!h) continue; blocks.set(h, off); off += 16 * nc; }
    }
    shot = { px, plane: hi0 & 0xE0, col: hi0 & 0x1F, pg, nc, hi0, lo0, blocks };
    afterBlit();
  }
  pend = [];
}
v06c.check_breakpoint = function () {
  const pc = cpu.pc;
  if (MODE === "B") {
    if (pc === L.vec_spr_out && retPC < 0) {
      retSP = cpu.sp; retPC = memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8);
      beforePack();
    } else if (retPC >= 0 && pc === retPC && cpu.sp > retSP) { retPC = -1; retSP = -1; afterPack(); }
    return false;
  }
  if (pc === L.vkn_blit && retPC < 0) {
    retSP = cpu.sp;
    retPC = memory.read(cpu.sp, false) | (memory.read(cpu.sp + 1, false) << 8);
    beforeBlit();
  } else if (retPC >= 0 && pc === retPC && cpu.sp > retSP) { retPC = -1; retSP = -1; afterBlit(); }
  return false;
};

// ---- ввод как функция игрового тика (правило A/B, тот же профиль, что в knife_cost.js) ----
const held = new Set();
function keysFor(t) {
  const k = [];
  if (t < 260) { if ((t >> 2) & 1) k.push(32); return k; }
  if ((t & 31) < 16) k.push(39); else k.push(37);
  if ((t & 15) === 3) k.push(32);
  // ЛЕСТНИЦА В ВЫБОРКЕ ОБЯЗАТЕЛЬНА: раз в 64 тика лезем вверх/вниз, чтобы герой (а с ним
  // и точка броска) оказывался у лестницы — иначе нож над ней не пролетит ни разу.
  if ((t & 63) < 10) k.push(38);
  if ((t & 63) >= 32 && (t & 63) < 42) k.push(40);
  return k;
}
function setKeys(t) {
  const want = new Set(keysFor(t));
  for (const c of held) if (!want.has(c)) keyboard.keyUp({ keyCode: c, which: c, preventDefault() {}, stopPropagation() {} });
  for (const c of want) if (!held.has(c)) keyboard.keyDown({ keyCode: c, which: c, preventDefault() {}, stopPropagation() {} });
  held.clear(); for (const c of want) held.add(c);
}
function forceKnife() { const st = rd(L.knifesData); if (st <= 2) { wr(L.objetoCogido, 0x10); wr(L.IDcuchilloCoge, 0); } }

let tick = 0, prevT = rd(L.timer), fr = 0;
while (tick <= NT && fr < 400000) {
  setKeys(tick);
  if (tick >= 260) forceKnife();
  v06c.oneInterrupt(true); fr++;
  if (rd(L.GameStatus) === 5) frames++;
  const t = rd(L.timer);
  if (t !== prevT) { prevT = t; tick++; }
}
console.log("ROM: " + ROM);
console.log(`кадров геймплея ${frames}, выводов спрайтового ножа ${outs}, пикселей силуэта ${silPx}`);
console.log(`ПРИМЕСЬ (индекс не свой): ${badPx} = ${silPx ? (100 * badPx / silPx).toFixed(2) : 0}% площади, выводов с примесью ${badOuts} = ${outs ? (100 * badOuts / outs).toFixed(1) : 0}%`);
const nmi = { 0: "чёрный", 2: "СВОЙ (серый)", 4: "", 6: "", 8: "", 10: "", 12: "лестница", 14: "ЗЕЛЁНЫЙ" };
console.log("итоговый индекс пикселя ножа:");
for (const [i, n] of [...byFinal].sort((a, b) => b[1] - a[1]))
  console.log(`  idx${String(i).padEnd(2)} ${(nmi[i] || "").padEnd(13)}: ${String(n).padStart(7)} пикс  ${(100 * n / silPx).toFixed(2)}%`);
console.log("ЧТО БЫЛО ПОД СИЛУЭТОМ (чужие плоскости фона):");
for (const [i, n] of [...byBg].sort((a, b) => b[1] - a[1]))
  console.log(`  фон idx${String(i).padEnd(2)} ${(nmi[i] || "").padEnd(13)}: ${String(n).padStart(7)} пикс  ${(100 * n / silPx).toFixed(2)}%`);
const ladder = (byBg.get(12) || 0);
console.log(`ПОКРЫТИЕ «нож над лестницей» (фон idx12 = p0+p1): ${ladder} пикс`);
if (!outs) { console.log("ГЕЙТ ПАДАЕТ: спрайтовый нож не выводился ни разу — выборка не та"); process.exit(3); }
if (!ladder) { console.log("ГЕЙТ ПАДАЕТ: сцены «нож над лестницей» в выборке нет — ноль соврал бы"); process.exit(3); }
console.log("ГЕЙТ: покрытие есть.");
