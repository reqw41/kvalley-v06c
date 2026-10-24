// msx_overlap.js — ДОКАЗАТЕЛЬСТВО: перекрывает ли правая створка двери героя в оригинале KV (MSX).
// Для каждого кадра прохода рендерит экран дважды: как есть и со спрятанными спрайтами створки,
// считает пиксели героя и сохраняет пары зумов.
"use strict";
const fs = require("fs");
const { makeEmu, renderScreen, png, MSXPAL } = require("./msx_door_lib.js");
const ROM = process.argv[2], OUT = process.argv[3] || "build/msxref";
fs.mkdirSync(OUT, { recursive: true });
const h = x => x.toString(16).padStart(2, "0").toUpperCase();
const L = []; const say = s => { L.push(s); process.stderr.write(s + "\n"); };

const e = makeEmu(ROM);
e.runFrames(200); e.press(" "); e.runFrames(40);
let f = 0;
while (f < 3000 && !(e.rd(0xE000) === 4 && e.rd(0xE0B2) === 0xD8 && e.rd(0xE0B0) !== 0xE1)) { e.runFrames(1); f++; }
const B = renderScreen(e.vram(), e.regs()).bases;
const v0 = e.vram();
let lever = 0; for (let i = 0; i < 768; i++) if (v0[B.nameBase + i] === 0x5E) { lever = i; break; }
const DC = lever % 32, DR = ((lever / 32) | 0) - 1;
const X0 = Math.max(0, (DC - 1) * 8), Y0 = Math.max(0, (DR - 1) * 8), WW = 56, HH = 48;
say(`старт на кадре ${f}; окно ворот x=${X0}..${X0 + WW} y=${Y0}..${Y0 + HH}`);

function dump(path, pix, W, H, zoom) {
  const buf = Buffer.alloc(W * zoom * H * zoom * 3);
  for (let y = 0; y < H * zoom; y++) for (let x = 0; x < W * zoom; x++) {
    const c = MSXPAL[pix[((y / zoom) | 0) * W + ((x / zoom) | 0)]];
    const o = (y * W * zoom + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; }
  fs.writeFileSync(path, png(W * zoom, H * zoom, buf)); return path;
}
const crop = sc => { const p = new Uint8Array(WW * HH);
  for (let y = 0; y < HH; y++) for (let x = 0; x < WW; x++) p[y * WW + x] = sc.pix[(Y0 + y) * 256 + X0 + x]; return p; };

const rows = [];
for (let i = 0; i < 26; i++) {
  const vv = e.vram(), r = e.regs();
  const leafOn = vv[B.sprAttr] !== 0xE1 && vv[B.sprAttr + 2] === 0xD8;
  const withS = renderScreen(vv, r);
  const vNo = Uint8Array.from(vv); for (let k = 0; k < 4; k++) vNo[B.sprAttr + k * 4] = 0xE1;
  const noS = renderScreen(vNo, r);
  let hw = 0, hn = 0, cover = 0;
  for (let o = 0; o < 256 * 192; o++) {
    if (withS.src[o] === 4 || withS.src[o] === 5) hw++;
    if (noS.src[o] === 4 || noS.src[o] === 5) { hn++; if (withS.src[o] >= 0 && withS.src[o] <= 3) cover++; }
  }
  const tag = String(i * 2).padStart(2, "0");
  const a = dump(`${OUT}/ab_${tag}_real.png`, crop(withS), WW, HH, 8);
  const b = dump(`${OUT}/ab_${tag}_noleaf.png`, crop(noS), WW, HH, 8);
  rows.push({ i: i * 2, leafOn, heroVisible: hw, heroTotal: hn, hiddenByLeaf: cover,
    leafY: h(vv[B.sprAttr]), leafX: h(vv[B.sprAttr + 1]), heroY: h(vv[B.sprAttr + 16]), heroX: h(vv[B.sprAttr + 17]),
    heroPat: h(vv[B.sprAttr + 18]), heroCol: vv[B.sprAttr + 19] & 15, real: a, noleaf: b });
  e.runFrames(2);
}
fs.writeFileSync(`${OUT}/overlap.json`, JSON.stringify(rows, null, 1));
say("кадр | створка | пикс.героя видно | всего | СКРЫТО створкой | створка Y,X | герой Y,X,pat");
for (const r of rows) say(`  ${String(r.i).padStart(3)} | ${r.leafOn ? "есть  " : "убрана"} | ${String(r.heroVisible).padStart(4)} | ` +
  `${String(r.heroTotal).padStart(4)} | ${String(r.hiddenByLeaf).padStart(4)} | ${r.leafY},${r.leafX} | ${r.heroY},${r.heroX},${r.heroPat}`);
const mx = rows.reduce((a, b) => b.hiddenByLeaf > a.hiddenByLeaf ? b : a);
say(`\nМАКСИМУМ перекрытия: кадр ${mx.i}, скрыто ${mx.hiddenByLeaf} из ${mx.heroTotal} пикселей героя ` +
  `(${(100 * mx.hiddenByLeaf / mx.heroTotal).toFixed(0)}%)\n  ${mx.real}\n  ${mx.noleaf}`);
fs.writeFileSync(`${OUT}/REPORT3.txt`, L.join("\n"));
