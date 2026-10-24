// tile_editor.js — БРАУЗЕРНЫЙ РЕДАКТОР РАСКРАСКИ ТАЙЛОВ ПРЕДМЕТОВ (кирка, нож).
//
// ЗАЧЕМ. Форма тайла приходит из распакованных данных уровня и правится в графике, а вот
// ГРАНИЦА ЦВЕТА (какая строка каким слотом красится) задаётся в коде — в диспетчере
// vec_blit.asm для тайлов 0x45-0x4C. Подбирать её вслепую неудобно: надо собрать ПЗУ,
// прогнать, посмотреть. Этот скрипт снимает НАСТОЯЩИЕ паттерны из работающей сборки
// (pat_maze_base + тайл*8 в p3, куда их кладёт UnpackPatterns) и генерирует самодостаточную
// HTML-страницу, где строки переключаются мышью, а результат сразу виден в цветах ВСЕХ
// ЧЕТЫРЁХ схем камня. Страница выдаёт готовую строку для вставки в исходник.
//
// ПОЧЕМУ ПАТТЕРН БЕРЁТСЯ ИЗ ЭМУЛЯТОРА, А НЕ ИЗ ПЗУ: в образе он лежит упакованным, а
// UnpackPatterns раскладывает его в p3 при загрузке уровня. Читать распакованное — значит
// видеть ровно то, что видит блиттер.
//
// Запуск: node tools/gfx/tile_editor.js [rom] [sym] [выходной html]
"use strict";
const fs = require("fs"), path = require("path");
const { make, toGame } = require("../verify/beam_harness.js");
const REPO = path.join(__dirname, "..", "..");
const ROM = process.argv[2] || path.join(REPO, "build/kvalley_8c.rom");
const SYM = process.argv[3] || ROM.replace(/\.rom$/, ".sym");
const OUT = process.argv[4] || path.join(REPO, "build/tile_editor.html");

const E = make(ROM, SYM);
if (toGame(E) !== 5) { console.error("не удалось дойти до геймплея"); process.exit(1); }
const { L, rd } = E;

// Паттерны предметов: адрес = pat_maze_base + тайл*8 (см. vec_boot.asm, pat_maze_base).
const BASE = L.pat_maze_base;
if (BASE === undefined) { console.error("в .sym нет pat_maze_base"); process.exit(1); }
const TILES = [
  { id: 0x4c, name: "КИРКА" },
  { id: 0x4b, name: "НОЖ на полу" },
  { id: 0x45, name: "НОЖ полёт 1" },
  { id: 0x46, name: "НОЖ полёт 2" },
  { id: 0x48, name: "НОЖ полёт 3" },
  { id: 0x49, name: "НОЖ полёт 4" },
];
for (const t of TILES) {
  t.rows = [];
  for (let i = 0; i < 8; i++) t.rows.push(rd(BASE + t.id * 8 + i));
}

// Палитра геймплея по схемам камня: idx -> #rrggbb. Снята замером (item_colors.js),
// границы схем — пирамиды 5, 9, 13; меняются только тона камня idx8/idx10.
const PAL = [
  { name: "схема 0 (пир 1-4)",   c: ["#000000","#dadaff","#000000","#ff6d55","#ffda55","#ff4855","#ffffff","#00ff00"] },
  { name: "схема 1 (пир 5-8)",   c: ["#000000","#dadaff","#ffffff","#ff6d55","#4848ff","#00b6ff","#ffffff","#00ff00"] },
  { name: "схема 2 (пир 9-12)",  c: ["#000000","#dadaff","#ffff00","#ff6d55","#da4855","#ffda55","#ffffff","#00ff00"] },
  { name: "схема 3 (пир 13-15)", c: ["#000000","#dadaff","#ffff00","#ff6d55","#24b655","#ffdaaa","#ffffff","#00ff00"] },
];

const html = `<h1>Раскраска тайлов предметов</h1>
<p class="sub">Паттерны сняты из работающей сборки <code>${path.basename(ROM)}</code>
(p3, <code>pat_maze_base + тайл*8</code>). Выберите цвет кистью и красьте пиксели мышью
(зажатая кнопка рисует). Кнопка слева от строки красит всю строку целиком.
Справа — как это выглядит на всех четырёх схемах камня.</p>
<p class="sub"><b>Чем платим за попиксельный цвет.</b> Сейчас блиттер красит тайл ПО СТРОКАМ
и хранит одну маску на тайл. Произвольный цвет пикселя требует ТРЁХ масок на строку — по
одной на плоскость p0/p1/p2, то есть 24 байта данных на тайл вместо одного, плюс петля,
которая пишет три плоскости по маскам. Страница выдаёт эти маски внизу: если раскраска
укладывается в «цвет постоянен внутри строки», хватит старого дешёвого пути.</p>
<div id="app"></div>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1100px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #6b7280; margin: 0 0 24px; max-width: 70ch; }
  .tile { border: 1px solid #d1d5db; border-radius: 10px; padding: 16px; margin-bottom: 20px; }
  .tile h2 { font-size: 16px; margin: 0 0 12px; }
  .flex { display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-start; }
  .grid { display: grid; grid-template-columns: 92px repeat(8, 26px); gap: 2px; align-items: center; }
  .px { width: 26px; height: 26px; border-radius: 3px; border: 1px solid rgba(128,128,128,.35);
        cursor: crosshair; user-select: none; }
  .px:hover { outline: 2px solid #2563eb; outline-offset: -2px; }
  button.sw.on { border-color: #2563eb; border-width: 2px; }
  .chip { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px;
          vertical-align: -2px; border: 1px solid rgba(128,128,128,.5); }
  .lab { font: 12px ui-monospace, monospace; color: #6b7280; text-align: right; padding-right: 6px; }
  button.sw { font: 12px ui-monospace, monospace; padding: 3px 8px; border-radius: 6px;
              border: 1px solid #9ca3af; background: transparent; cursor: pointer; color: inherit; }
  button.sw:hover { border-color: #2563eb; }
  .prev { display: grid; grid-template-columns: repeat(8, 14px); gap: 1px; }
  .prev div { width: 14px; height: 14px; }
  .pcap { font: 12px ui-monospace, monospace; color: #6b7280; margin: 6px 0 4px; }
  code.out { display: block; font: 13px ui-monospace, monospace; background: rgba(128,128,128,.12);
             padding: 10px 12px; border-radius: 8px; margin-top: 14px; white-space: pre-wrap; }
  @media (prefers-color-scheme: dark) { .tile { border-color: #374151; } .sub, .lab, .pcap { color: #9ca3af; } }
  :root[data-theme="light"] .tile { border-color: #d1d5db; }
  :root[data-theme="dark"]  .tile { border-color: #374151; }
</style>
<script>
const TILES = ${JSON.stringify(TILES)};
const PAL = ${JSON.stringify(PAL)};
// Слоты, доступные предметам. idx = p0*8 + p1*4 + p2*2, нечётные — близнецы чётных.
const CHOICE = [2, 6, 8, 10, 12, 14, 0];
const NAMES = {0:"фон/чёрный",2:"серый",6:"красный",8:"тон A камня",10:"тон B камня",12:"белый",14:"зелёный"};
let brush = 6;                      // текущая кисть
let painting = false;               // зажата ли кнопка мыши
document.addEventListener("mouseup", () => { painting = false; });

const app = document.getElementById("app");

// панель кистей — одна на страницу
const bar = document.createElement("div"); bar.className = "tile";
bar.innerHTML = "<h2>Кисть</h2>";
const bwrap = document.createElement("div"); bwrap.className = "flex";
function drawBar() {
  bwrap.textContent = "";
  for (const s of CHOICE) {
    const b = document.createElement("button");
    b.className = "sw" + (s === brush ? " on" : "");
    b.innerHTML = '<span class="chip" style="background:' + PAL[0].c[s >> 1] + '"></span>idx' + s + " " + NAMES[s];
    b.onclick = () => { brush = s; drawBar(); };
    bwrap.appendChild(b);
  }
}
drawBar(); bar.appendChild(bwrap); app.appendChild(bar);

for (const t of TILES) {
  // ПО УМОЛЧАНИЮ — то, что сейчас в коде: у кирки строки 0-3 серые (рукоять), 4-7 красные
  // (головка); нож весь серый. Слот хранится ПОПИКСЕЛЬНО, чтобы можно было отойти от строк.
  t.px = [];
  for (let r = 0; r < 8; r++) {
    const def = (t.id === 0x4c && r >= 4) ? 6 : 2;
    t.px.push(new Array(8).fill(def));
  }
  const box = document.createElement("div"); box.className = "tile";
  box.innerHTML = "<h2>" + t.name + " — тайл 0x" + t.id.toString(16) + "</h2>";
  const flex = document.createElement("div"); flex.className = "flex";
  const grid = document.createElement("div"); grid.className = "grid";
  const previews = document.createElement("div"); previews.className = "flex";
  const out = document.createElement("code"); out.className = "out";
  function paint() {
    grid.textContent = "";
    for (let r = 0; r < 8; r++) {
      const b = document.createElement("button"); b.className = "sw";
      b.textContent = "стр" + r;
      b.title = "покрасить всю строку текущей кистью";
      b.onclick = () => { for (let c = 0; c < 8; c++) t.px[r][c] = brush; paint(); };
      grid.appendChild(b);
      for (let c = 0; c < 8; c++) {
        const on = (t.rows[r] >> (7 - c)) & 1;
        const d = document.createElement("div"); d.className = "px";
        d.style.background = on ? PAL[0].c[t.px[r][c] >> 1] : "transparent";
        if (!on) d.style.opacity = ".25";
        d.title = on ? ("строка " + r + ", бит " + c + " -> idx" + t.px[r][c])
                     : ("строка " + r + ", бит " + c + " — ПУСТО (фон клетки)");
        const put = () => { t.px[r][c] = brush; paint(); };
        d.onmousedown = () => { painting = true; put(); };
        d.onmouseenter = () => { if (painting) put(); };
        grid.appendChild(d);
      }
    }
    previews.textContent = "";
    for (const p of PAL) {
      const w = document.createElement("div");
      const cap = document.createElement("div"); cap.className = "pcap"; cap.textContent = p.name;
      const g = document.createElement("div"); g.className = "prev";
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const on = (t.rows[r] >> (7 - c)) & 1;
        const d = document.createElement("div");
        d.style.background = on ? p.c[t.px[r][c] >> 1] : p.c[0];
        g.appendChild(d);
      }
      w.appendChild(cap); w.appendChild(g); previews.appendChild(w);
    }
    // --- вывод для вставки в исходник ---
    // Три маски на строку: какие ПИКСЕЛИ ФОРМЫ идут в p0, p1, p2. idx = p0*8+p1*4+p2*2.
    const m0 = [], m1 = [], m2 = [];
    let perRow = true, firstOfRow;
    for (let r = 0; r < 8; r++) {
      let a = 0, b = 0, cc = 0;
      firstOfRow = null;
      for (let c = 0; c < 8; c++) {
        if (!((t.rows[r] >> (7 - c)) & 1)) continue;   // пустой пиксель формы не красится
        const s = t.px[r][c];
        if (firstOfRow === null) firstOfRow = s; else if (s !== firstOfRow) perRow = false;
        if (s & 8) a |= 1 << (7 - c);
        if (s & 4) b |= 1 << (7 - c);
        if (s & 2) cc |= 1 << (7 - c);
      }
      m0.push(a); m1.push(b); m2.push(cc);
    }
    const hx = v => "0x" + v.toString(16).padStart(2, "0").toUpperCase();
    let txt =
      "паттерн (форма из ПЗУ): " + t.rows.map(v => v.toString(16).padStart(2,"0")).join(" ") + "\\n\\n" +
      "ТРИ МАСКИ ПЛОСКОСТЕЙ (idx = p0*8 + p1*4 + p2*2), по строкам сверху вниз:\\n" +
      "  p0: " + m0.map(hx).join(", ") + "\\n" +
      "  p1: " + m1.map(hx).join(", ") + "\\n" +
      "  p2: " + m2.map(hx).join(", ") + "\\n";
    if (perRow) {
      // цвет постоянен внутри каждой строки -> хватит дешёвого пути по строкам
      const slots = [];
      for (let r = 0; r < 8; r++) {
        let s = null;
        for (let c = 0; c < 8; c++) if ((t.rows[r] >> (7 - c)) & 1) { s = t.px[r][c]; break; }
        slots.push(s);
      }
      const base = slots.find(v => v !== null);
      let mask = 0;
      for (let r = 0; r < 8; r++) if (slots[r] !== null && slots[r] !== base) mask |= 1 << (7 - r);
      txt += "\\nЦВЕТ ПОСТОЯНЕН ВНУТРИ СТРОКИ — хватит нынешнего дешёвого пути (1 байт на тайл):\\n" +
             "  слоты по строкам: " + slots.map(v => v === null ? "--" : "idx" + v).join(" ") + "\\n" +
             "  маска второго тона: " + hx(mask) + "   (бит7 = строка 0, формат kv_knife_rows)";
    } else {
      txt += "\\nЦВЕТ МЕНЯЕТСЯ ВНУТРИ СТРОКИ — нужен попиксельный путь: 24 байта масок на тайл\\n" +
             "и петля, пишущая три плоскости по маскам вместо одной маски цвета.";
    }
    out.textContent = txt;
  }
  paint();
  flex.appendChild(grid); flex.appendChild(previews);
  box.appendChild(flex); box.appendChild(out);
  app.appendChild(box);
}
</script>`;

fs.writeFileSync(OUT, html);
console.log("паттерны сняты из p3 (pat_maze_base = 0x" + BASE.toString(16) + "):");
for (const t of TILES)
  console.log("  0x" + t.id.toString(16) + " " + t.name.padEnd(14) +
              t.rows.map(v => v.toString(16).padStart(2, "0")).join(" "));
console.log("\nстраница: " + OUT);
