#!/usr/bin/env python3
"""spr_sheet.py — PNG-лист «герой и мумия рядом, в одном масштабе»: оригинал против подрезки.

ЗАЧЕМ. Сужение силуэта (задача #44 шаг 2) — вопрос вкуса, а не тактов: владелец смотрит на
СООТНОШЕНИЕ размеров героя и мумии, поэтому обе фигуры должны быть на одном листе и в одном
масштабе. Правило владельца: на сколько пикселей ужимается мумия, на столько же ужимается и
герой — иначе он станет выглядеть непропорционально широким рядом с ней.

ЧТО РИСУЕТ. Строка = набор (мумия, герой без предмета, с ножом, с киркой). Клетка = ОДИН
ВИДИМЫЙ КАДР: у героя это ПАРА спрайтов (одежда + кожа, разные слоты в одной точке), у мумии
одиночный спрайт. Одежда и кожа раскрашены по-разному, чтобы поза читалась.
Слева блок «оригинал», справа — «подрезано на N».

ПОДРЕЗКА — тот же ЗАГИБ, что в momia_squeeze (tools/gfx/spr_unpack.py): биты, вылезшие за
целевое окно, складываются OR-ом в его крайний столбец. Не построчное сжатие (оно дёргало бы
узор между кадрами) и не обрезка (она отняла бы вынесенную руку или ногу целиком).

Запуск: python3 tools/gfx/spr_sheet.py [N=3] [масштаб=6] [выход.png]
"""
import os, sys, zlib, struct

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools/gfx"))
import spr_unpack as SU

NCUT = int(sys.argv[1]) if len(sys.argv) > 1 else 3
SCALE = int(sys.argv[2]) if len(sys.argv) > 2 else 6
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(ROOT, "build/spr_sheet_%d.png" % NCUT)

BG, GRID, CLOTH, SKIN, MOMIA = (24, 24, 32), (48, 48, 64), (216, 72, 72), (240, 208, 160), (200, 200, 208)


def rows(b, o):
    return [(b[o + r] << 8) | b[o + 16 + r] for r in range(16)]


def bbox(rs):
    mn, mx = 99, -1
    for w in rs:
        for i in range(16):
            if w & (0x8000 >> i):
                mn, mx = min(mn, i), max(mx, i)
    return (mn, mx) if mx >= 0 else (0, 0)


def clamp(rs, lo, hi):
    """Загнуть всё левее lo и правее hi на края окна."""
    lmask = (0xFFFF << (16 - lo)) & 0xFFFF if lo else 0
    rmask = 0xFFFF >> (hi + 1)
    lbit, rbit = 0x8000 >> lo, 0x8000 >> hi
    out = []
    for w in rs:
        if w & lmask:
            w = (w & ~lmask) | lbit
        if w & rmask:
            w = (w & ~rmask) | rbit
        out.append(w & 0xFFFF)
    return out


def load_sets():
    blocks = SU.read_blocks(SU.SRC)
    sets = {}
    for name, label, base, length, caption in SU.SETS:
        mem, _ = SU.unrle(blocks[name])
        data = bytes(mem.get(base + k, 0) for k in range(length))
        if name == "GFX_Prota":
            data = SU.fill_prota_tail(blocks, data)
        sets[name] = data
    return sets


def png(path, w, h, px):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw += bytes(px[y][x])
    def ch(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n"
        + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + ch(b"IDAT", zlib.compress(bytes(raw), 9)) + ch(b"IEND", b""))


def main():
    sets = load_sets()
    # (подпись, данные, шаг спрайтов на кадр, цвета слоёв)
    ROWS = [("мумия",        sets["GFX_MOMIA"],      1, [MOMIA]),
            ("герой",        sets["GFX_Prota"],      2, [CLOTH, SKIN]),
            ("герой + нож",  sets["GFX_ProtaKnife"], 2, [CLOTH, SKIN]),
            ("герой + кирка",sets["GFX_ProtaPico"],  2, [CLOTH, SKIN])]
    NF = max(len(d) // (32 * st) for _, d, st, _ in ROWS)
    CELL = 16 * SCALE + 2
    W = 2 * (NF * CELL) + 3 * SCALE
    H = len(ROWS) * CELL
    px = [[BG] * W for _ in range(H)]
    for ri, (name, data, step, cols) in enumerate(ROWS):
        nf = len(data) // (32 * step)
        # окно подрезки — ОДНО на набор: по самому широкому кадру, минус NCUT
        allrs = []
        for f in range(nf):
            u = [0] * 16
            for l in range(step):
                for r, w in enumerate(rows(data, (f * step + l) * 32)):
                    u[r] |= w
            allrs.append(u)
        mn = min(bbox(u)[0] for u in allrs)
        mx = max(bbox(u)[1] for u in allrs)
        lo, hi = mn, max(mn, mx - NCUT)
        for f in range(nf):
            for half in (0, 1):
                x0 = half * (NF * CELL + 3 * SCALE) + f * CELL + 1
                y0 = ri * CELL + 1
                for y in range(16 * SCALE):
                    for x in range(16 * SCALE):
                        px[y0 + y][x0 + x] = GRID if (x % SCALE == 0 or y % SCALE == 0) else BG
                for l in range(step):
                    rs = rows(data, (f * step + l) * 32)
                    if half:
                        rs = clamp(rs, lo, hi)
                    for r, w in enumerate(rs):
                        for c in range(16):
                            if w & (0x8000 >> c):
                                for dy in range(SCALE):
                                    for dx in range(SCALE):
                                        px[y0 + r * SCALE + dy][x0 + c * SCALE + dx] = cols[l]
    png(OUT, W, H, px)
    print("лист: %s  (подрезка -%d пикс, масштаб %dx)" % (OUT, NCUT, SCALE))
    for name, data, step, _ in ROWS:
        nf = len(data) // (32 * step)
        allrs = []
        for f in range(nf):
            u = [0] * 16
            for l in range(step):
                for r, w in enumerate(rows(data, (f * step + l) * 32)):
                    u[r] |= w
            allrs.append(u)
        ws = [bbox(u)[1] - bbox(u)[0] + 1 for u in allrs]
        print("  %-14s кадров %d, ширина %d..%d -> после подрезки %d..%d"
              % (name, nf, min(ws), max(ws), max(1, min(ws) - NCUT), max(1, max(ws) - NCUT)))


if __name__ == "__main__":
    main()
