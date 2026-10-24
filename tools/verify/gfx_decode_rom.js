// gfx_decode_rom.js — декодирует RLE-упакованные GFX-блоки King's Valley прямо из исходника
// (msx/kvalley_src.asm), раскладывает в 16x16 спрайты / 8x8 тайлы, рендерит лист опознания
// с ПОДПИСЯМИ (адрес VRAM + номер паттерна) и пишет именованные bitmaps в JSON.
//
// Формат unpackGFXset/unpackGFX (msx:1391..1475):
//   блок начинается с 2-байт VRAM-адреса (LE), далее токены:
//     0x00        -> конец
//     0x80 lo hi  -> сменить VRAM-адрес
//     N (bit7=0)  -> fill: следующий 1 байт повторить N раз
//     N (bit7=1)  -> literal: скопировать (N&0x7F) следующих байт как есть
// SGT-база спрайтов = 0x1800 (GFX_Prota грузится в 0x1800 = паттерн 0).
const fs = require("fs");
const SRC = "/Users/boris/projects/kvalley-v06c/msx/kvalley_src.asm";
const SGT_BASE = 0x1800;

// --- парсер db-блоков ---
function parseBlock(lines, startIdx) {
  const bytes = [];
  for (let i = startIdx; i < lines.length; i++) {
    let ln = lines[i];
    if (i > startIdx) {
      // продолжение только если строка (после отступа) начинается с db
      if (!/^\s+db\b/i.test(ln)) break;
    }
    // отрезать метку "NAME:" и inline-комментарий
    ln = ln.replace(/^[A-Za-z_]\w*:/, "");
    ln = ln.replace(/;.*/, "");
    const m = ln.match(/\bdb\b(.*)/i);
    if (!m) continue;
    for (let tok of m[1].split(",")) {
      tok = tok.trim();
      if (!tok) continue;
      let v;
      if (/h$/i.test(tok)) v = parseInt(tok.replace(/h$/i, ""), 16);
      else v = parseInt(tok, 10);
      if (!Number.isNaN(v)) bytes.push(v & 0xff);
    }
  }
  return bytes;
}
function findBlock(lines, name) {
  const idx = lines.findIndex((l) => new RegExp("^" + name + ":").test(l));
  if (idx < 0) throw new Error("not found: " + name);
  return parseBlock(lines, idx);
}
function decode(bytes) {
  let i = 0;
  let addr = bytes[i] | (bytes[i + 1] << 8);
  i += 2;
  const vram = addr;
  const mem = {};
  while (i < bytes.length) {
    const n = bytes[i++];
    if (n === 0x00) break;
    if (n === 0x80) {
      addr = bytes[i] | (bytes[i + 1] << 8);
      i += 2;
      continue;
    }
    const cnt = n & 0x7f;
    if (n & 0x80) {
      for (let k = 0; k < cnt; k++) mem[addr++] = bytes[i++];
    } else {
      const v = bytes[i++];
      for (let k = 0; k < cnt; k++) mem[addr++] = v;
    }
  }
  return { vram, mem, end: addr };
}

const lines = fs.readFileSync(SRC, "utf8").split(/\r?\n/);
const BLOCKS = ["GFX_Prota", "GFX_ProtaKnife", "GFX_ProtaPico", "GFX_MOMIA", "GFX_SPRITES2"];
const decoded = {};
for (const b of BLOCKS) decoded[b] = decode(findBlock(lines, b));

// собрать единую SGT-память (последний писавший выигрывает, как в игре при последовательной загрузке)
// но для опознания важнее показать КАЖДЫЙ блок отдельно.

// --- извлечь 16x16 спрайты из блока: 32 байта = 4 квадранта 8 байт ---
// MSX 16x16: q0=TL(rows0-7), q1=BL(rows8-15), q2=TR(rows0-7), q3=BR(rows8-15)
function spritesFromBlock(dec) {
  const { vram, mem, end } = dec;
  const out = [];
  for (let a = vram; a + 32 <= end; a += 32) {
    // пропустить полностью пустые
    const raw = [];
    for (let k = 0; k < 32; k++) raw.push(mem[a + k] || 0);
    const pat = (a - SGT_BASE) / 8;
    out.push({ addr: a, pat, raw });
  }
  return out;
}

// --- мини 3x5 шрифт для подписей (hex + пара букв) ---
const FONT = {
  "0":"111101101101111","1":"010010010010010","2":"111001111100111","3":"111001111001111",
  "4":"101101111001001","5":"111100111001111","6":"111100111101111","7":"111001010010010",
  "8":"111101111101111","9":"111101111001111","A":"111101111101101","B":"110101110101110",
  "C":"111100100100111","D":"110101101101110","E":"111100111100111","F":"111100111100100",
  "x":"000101010101101",":":"000010000010000"," ":"000000000000000","P":"111101111100100",
  "#":"101111101111101","-":"000000111000000","K":"101110100110101","N":"101111111101101",
  "H":"101101111101101","R":"110101110101101","O":"111101101101111","M":"101111101101101",
  "I":"111010010010111","T":"111010010010010","L":"100100100100111","G":"111100101101111",
  "S":"111100111001111","V":"101101101010010","W":"101101101111101","U":"101101101101111",
  "Y":"101101010010010","Z":"111001010100111","J":"001001001101111","Q":"111101101111011",
  "n":"000111101101101",".":"000000000000010","(":"001010010010001",")":"100010010010100",
  "e":"000111111100111","o":"000111101101111","d":"001111101101111","r":"000111100100100",
  "a":"000110101101111","t":"010111010010001","s":"000111100111111","u":"000101101101111",
};

module.exports = { decoded, spritesFromBlock, FONT, SGT_BASE };

// ================= рендер листа =================
if (require.main === module) {
  const zlib = require("zlib");
  const SC = 6, PAD = 2, LBLH = 7;

  // группы для листа
  const groups = [];
  groups.push({ title: "GFX_Prota (герой без предмета)", sprites: spritesFromBlock(decoded.GFX_Prota) });
  groups.push({ title: "GFX_ProtaKnife (герой с ножом)", sprites: spritesFromBlock(decoded.GFX_ProtaKnife) });
  groups.push({ title: "GFX_ProtaPico (герой с киркой)", sprites: spritesFromBlock(decoded.GFX_ProtaPico) });
  groups.push({ title: "GFX_MOMIA (мумия)", sprites: spritesFromBlock(decoded.GFX_MOMIA) });
  groups.push({ title: "GFX_SPRITES2 (искра/муро-дверь/взрыв/нож)", sprites: spritesFromBlock(decoded.GFX_SPRITES2) });

  const cell = 16 * SC + PAD * 2;
  const cols = Math.max(...groups.map((g) => g.sprites.length), 1);
  const rowH = cell + LBLH + 14;
  const SW = 24 + cols * cell + 20;
  const SH = groups.length * rowH + 20;
  const px = new Uint8Array(SW * SH * 3);
  function set(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= SW || y >= SH) return;
    const i = (y * SW + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b;
  }
  function text(str, x, y, r, g, b) {
    let cx = x;
    for (const ch of str) {
      const gl = FONT[ch] || FONT[" "];
      for (let k = 0; k < 15; k++) if (gl[k] === "1") set(cx + (k % 3), y + ((k / 3) | 0), r, g, b);
      cx += 4;
    }
  }
  function drawSpr(raw, ox, oy) {
    for (let q = 0; q < 4; q++) {
      const qx = (q >> 1) * 8, qy = (q & 1) * 8;
      for (let row = 0; row < 8; row++) {
        const byte = raw[q * 8 + row];
        for (let c = 0; c < 8; c++) {
          if ((byte >> (7 - c)) & 1)
            for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++)
              set(ox + (qx + c) * SC + dx, oy + (qy + row) * SC + dy, 220, 220, 220);
        }
      }
    }
  }
  let gy = 8;
  for (const grp of groups) {
    text(grp.title, 4, gy, 120, 200, 120);
    gy += 8;
    let gx = 24;
    for (const s of grp.sprites) {
      // рамка
      for (let x = 0; x < cell; x++) { set(gx + x, gy, 40, 44, 60); set(gx + x, gy + cell - 1, 40, 44, 60); }
      for (let y = 0; y < cell; y++) { set(gx, gy + y, 40, 44, 60); set(gx + cell - 1, gy + y, 40, 44, 60); }
      drawSpr(s.raw, gx + PAD, gy + PAD);
      const patHex = (s.pat & 0xff).toString(16).toUpperCase();
      text("p" + patHex, gx + 2, gy + cell + 1, 230, 200, 90);
      gx += cell;
    }
    gy += rowH - 8;
  }
  // PNG
  function crc(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;}return ~c>>>0;}
  function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt));return Buffer.concat([l,tt,c]);}
  const raw = Buffer.alloc(SH * (SW * 3 + 1));
  for (let y = 0; y < SH; y++) { raw[y * (SW * 3 + 1)] = 0; Buffer.from(px.buffer, y * SW * 3, SW * 3).copy(raw, y * (SW * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SW); ihdr.writeUInt32BE(SH, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  fs.writeFileSync("/tmp/kv_gfx_ident.png", png);

  // dump names JSON (все спрайты по группам)
  const jsonOut = {};
  for (const grp of groups) jsonOut[grp.title.split(" ")[0]] = grp.sprites.map((s) => ({ addr: "0x" + s.addr.toString(16), pat: "0x" + (s.pat & 0xff).toString(16), raw: s.raw }));
  fs.writeFileSync("/tmp/kv_gfx_rom.json", JSON.stringify(jsonOut));
  for (const grp of groups)
    console.error(grp.title, "->", grp.sprites.map((s) => "p" + (s.pat & 0xff).toString(16)).join(" "));
  console.error("ident sheet -> /tmp/kv_gfx_ident.png (" + SW + "x" + SH + ")");
}
