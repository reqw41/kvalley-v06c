// hero_editor.js — БРАУЗЕРНЫЙ РЕДАКТОР СПРАЙТОВ ГЕРОЯ (набор «с киркой»).
//
// ЗАЧЕМ. Герой рисуется ДВУМЯ наложенными слоями в разных плоскостях (как два спрайта на
// MSX): у каждого слоя свой паттерн, а цвет пикселя — следствие того, в какой плоскости он
// лежит. Данные лежат распакованными в образе (src/gen/vec_sprdata.asm, задача #12), поэтому
// читаются прямо из ПЗУ по vec_spr_pico.
//
// РАСКЛАДКА (проверена дампом): спрайт 16x16 = четыре блока по 8 байт в порядке SGT MSX —
// левый верх, левый низ, правый верх, правый низ. Кадр анимации = ПАРА спрайтов: слой A
// (чётный) и слой B (нечётный), то есть паттерны 8*k .. 8*k+7.
//
// ЧТО ДЕЛАЕТ СТРАНИЦА: показывает кадры целиком (наложение слоёв), даёт красить пиксели
// мышью и выдаёт готовые байты ОБОИХ слоёв для вставки. Разбор «какой слой каким цветом»
// виден прямо в сетке: A и B — разные плоскости.
//
// Запуск: node tools/gfx/hero_editor.js [rom] [sym] [выходной html]
"use strict";
const fs = require("fs"), path = require("path");
const REPO = path.join(__dirname, "..", "..");
const ROM = process.argv[2] || path.join(REPO, "build/kvalley_8c.rom");
const SYM = process.argv[3] || ROM.replace(/\.rom$/, ".sym");
const OUT = process.argv[4] || path.join(REPO, "build/hero_editor.html");

const sym = fs.readFileSync(SYM, "latin1");
const L = {};
for (const m of sym.matchAll(/(\w+):\s+equ\s+0*([0-9A-Fa-f]+)h/g)) L[m[1]] = parseInt(m[2], 16);
const rom = fs.readFileSync(ROM);
if (L.vec_spr_pico === undefined) { console.error("в .sym нет vec_spr_pico"); process.exit(1); }
const BASE = L.vec_spr_pico - 0x100;          // образ грузится с 0x0100

// спрайт s (16x16) -> массив из 16 строк по 16 бит
function spr(s) {
  const o = BASE + s * 32, b = [];
  for (let i = 0; i < 4; i++) b.push(rom.subarray(o + i * 8, o + i * 8 + 8));
  const rows = [];
  for (let r = 0; r < 16; r++) {
    const left = r < 8 ? b[0][r] : b[1][r - 8];
    const right = r < 8 ? b[2][r] : b[3][r - 8];
    rows.push((left << 8) | right);
  }
  return rows;
}
const FRAMES = [];
for (let k = 0; k < 5; k++)
  FRAMES.push({ k, patA: k * 8, patB: k * 8 + 4, A: spr(k * 2), B: spr(k * 2 + 1) });

const html = `<h1>Спрайты героя с киркой</h1>
<p class="sub">Данные прочитаны из <code>${path.basename(ROM)}</code> по <code>vec_spr_pico</code>
(набор лежит в образе распакованным). Кадр 16×16 — это ДВА наложенных слоя в разных
плоскостях: <b>A</b> и <b>B</b>. Кисть выбирает слой; клик красит, зажатая кнопка рисует.
Внизу каждого кадра — готовые байты обоих слоёв.</p>
<p class="sub"><b>Почему кисть выбирает слой, а не цвет.</b> Пиксель физически принадлежит
плоскости, а цвет — уже следствие того, в какой слот эта плоскость попадёт при выводе.
Так же вышло с тайлом кирки: задавалось, какие пиксели красные, а не «покрасить в #ff6d55».</p>
<div id="app"></div>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1200px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #6b7280; margin: 0 0 14px; max-width: 78ch; }
  .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 16px; margin-bottom: 20px; }
  .card h2 { font-size: 16px; margin: 0 0 12px; }
  .flex { display: flex; gap: 26px; flex-wrap: wrap; align-items: flex-start; }
  .grid { display: grid; grid-template-columns: repeat(16, 22px); gap: 1px; }
  .px { width: 22px; height: 22px; border-radius: 2px; cursor: crosshair; user-select: none;
        border: 1px solid rgba(128,128,128,.25); font: 10px ui-monospace, monospace;
        display: flex; align-items: center; justify-content: center; color: rgba(0,0,0,.45); }
  .px:hover { outline: 2px solid #2563eb; outline-offset: -2px; }
  .prev { display: grid; grid-template-columns: repeat(16, 11px); gap: 0; }
  .prev div { width: 11px; height: 11px; }
  .chip { display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:6px;
          vertical-align:-2px; border:1px solid rgba(128,128,128,.5); }
  .pcap { font: 12px ui-monospace, monospace; color: #6b7280; margin: 6px 0 4px; }
  button.sw { font: 12px ui-monospace, monospace; padding: 4px 9px; border-radius: 6px;
              border: 1px solid #9ca3af; background: transparent; cursor: pointer; color: inherit; }
  button.sw.on { border-color: #2563eb; border-width: 2px; }
  code.out { display: block; font: 12px ui-monospace, monospace; background: rgba(128,128,128,.12);
             padding: 10px 12px; border-radius: 8px; margin-top: 12px; white-space: pre-wrap; }
  @media (prefers-color-scheme: dark) { .card { border-color: #374151; } .sub, .pcap { color: #9ca3af; }
    .px { color: rgba(255,255,255,.5); } }
</style>
<script>
const FRAMES = ${JSON.stringify(FRAMES)};
// ЦВЕТА СНЯТЫ ЗАМЕРОМ ИЗ ЖИВОЙ ИГРЫ, а не выбраны на глаз (первая редакция их перепутала):
//   слот 4: pat=0x60 col=0x0E -> col&8 стоит -> ОДЕЖДА, плоскость p2, idx2 СЕРЫЙ  #dadaff
//   слот 5: pat=0x64 col=0x06 -> col&8 снят  -> КОЖА,   плоскость p1, idx6 КРАСНЫЙ #ff6d55
// То есть МЕНЬШИЙ паттерн пары — одежда, больший (+4) — кожа. Правило выбора плоскости
// живёт в vns_pbher (src/v06c/vec_sprites.asm) и читает цвет-ниббл, а не номер слота.
const COL = { A: "#dadaff", B: "#ff6d55", "": "transparent" };
const LNAME = { A: "одежда", B: "кожа" };
const BG  = [ {n:"чёрный коридор", c:"#000000"}, {n:"кирпич", c:"#ffda55"}, {n:"лестница", c:"#ffffff"} ];
let brush = "A", painting = false;
document.addEventListener("mouseup", () => { painting = false; });
const app = document.getElementById("app");

const bar = document.createElement("div"); bar.className = "card";
bar.innerHTML = "<h2>Кисть</h2>";
const bw = document.createElement("div"); bw.className = "flex";
function drawBar() {
  bw.textContent = "";
  for (const s of ["A", "B", ""]) {
    const b = document.createElement("button");
    b.className = "sw" + (s === brush ? " on" : "");
    b.innerHTML = s === "" ? "стереть"
      : '<span class="chip" style="background:' + COL[s] + '"></span>' + LNAME[s] + " (" + s + ")";
    b.onclick = () => { brush = s; drawBar(); };
    bw.appendChild(b);
  }
}
drawBar(); bar.appendChild(bw); app.appendChild(bar);

for (const f of FRAMES) {
  // распаковываем в матрицу символов: "A", "B", "" (пусто). Если пиксель есть в обоих
  // слоях — держим "A", но помечаем: при выводе плоскости складываются.
  f.m = [];
  for (let r = 0; r < 16; r++) {
    const row = [];
    for (let c = 0; c < 16; c++) {
      const m = 1 << (15 - c);
      row.push((f.A[r] & m) ? "A" : ((f.B[r] & m) ? "B" : ""));
    }
    f.m.push(row);
  }
  const card = document.createElement("div"); card.className = "card";
  card.innerHTML = "<h2>кадр " + f.k + " — паттерны 0x" + f.patA.toString(16).toUpperCase() +
                   " (ОДЕЖДА, серая) и 0x" + f.patB.toString(16).toUpperCase() + " (КОЖА, красная)</h2>";
  const flex = document.createElement("div"); flex.className = "flex";
  const grid = document.createElement("div"); grid.className = "grid";
  const prevs = document.createElement("div"); prevs.className = "flex";
  const out = document.createElement("code"); out.className = "out";
  function paint() {
    grid.textContent = "";
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
      const v = f.m[r][c];
      const d = document.createElement("div"); d.className = "px";
      d.style.background = COL[v];
      d.textContent = v;
      d.title = "строка " + r + ", столбец " + c + (v ? (" — " + LNAME[v] + " (слой " + v + ")") : " — пусто");
      const put = () => { f.m[r][c] = brush; paint(); };
      d.onmousedown = () => { painting = true; put(); };
      d.onmouseenter = () => { if (painting) put(); };
      grid.appendChild(d);
    }
    prevs.textContent = "";
    for (const bg of BG) {
      const w = document.createElement("div");
      const cap = document.createElement("div"); cap.className = "pcap"; cap.textContent = "на фоне: " + bg.n;
      const g = document.createElement("div"); g.className = "prev";
      for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
        const v = f.m[r][c];
        const d = document.createElement("div");
        d.style.background = v ? COL[v] : bg.c;
        g.appendChild(d);
      }
      w.appendChild(cap); w.appendChild(g); prevs.appendChild(w);
    }
    // обратная упаковка в четыре блока 8x8 на слой, порядок SGT MSX: LT, LB, RT, RB
    const pack = (want) => {
      const blk = [[], [], [], []];
      for (let r = 0; r < 16; r++) {
        let left = 0, right = 0;
        for (let c = 0; c < 16; c++) if (f.m[r][c] === want) {
          if (c < 8) left |= 1 << (7 - c); else right |= 1 << (15 - c);
        }
        if (r < 8) { blk[0].push(left); blk[2].push(right); }
        else { blk[1].push(left); blk[3].push(right); }
      }
      return blk;
    };
    const hx = v => v.toString(16).padStart(2, "0").toUpperCase();
    const fmt = (blk) => blk.map(b => b.map(hx).join(" ")).join("  |  ");
    out.textContent =
      "ОДЕЖДА, слой A (паттерны 0x" + f.patA.toString(16).toUpperCase() + "-0x" + (f.patA+3).toString(16).toUpperCase() + "):\\n  " +
      fmt(pack("A")) + "\\n" +
      "КОЖА, слой B (паттерны 0x" + f.patB.toString(16).toUpperCase() + "-0x" + (f.patB+3).toString(16).toUpperCase() + "):\\n  " +
      fmt(pack("B")) + "\\n\\n" +
      "порядок блоков: левый верх | левый низ | правый верх | правый низ";
  }
  paint();
  flex.appendChild(grid); flex.appendChild(prevs);
  card.appendChild(flex); card.appendChild(out);
  app.appendChild(card);
}
</script>`;

fs.writeFileSync(OUT, html);
console.log("vec_spr_pico = 0x" + L.vec_spr_pico.toString(16) + ", кадров 5 (по два слоя)");
console.log("страница: " + OUT);
