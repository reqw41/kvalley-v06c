#!/usr/bin/env python3
"""spr_bbox.py — габариты силуэтов в клетке 16x16 по СГЕНЕРИРОВАННЫМ таблицам спрайтов.

Печатает для каждого спрайта каждого набора: границы непустых столбцов прямого и
зеркального вида и число непустых строк. Это исходные данные для решения «можно ли
прижать силуэт к левому краю клетки» (задача #44): прижать можно ровно на min(c0) по
ВСЕМ кадрам и ОБОИМ направлениям — компенсация X обязана быть одной константой, иначе
X>>3 менялся бы при смене кадра анимации и объект вылетал бы со слитого пути вывода.

Запуск: python3 tools/gfx/spr_bbox.py [src/gen/vec_sprdata.asm]
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "src/gen/vec_sprdata.asm")
LABELS = ["vec_spr_prota", "vec_spr_knife", "vec_spr_pico", "vec_spr_momia"]


def load(path):
    txt = open(path, encoding="utf-8").read()
    pos = {}
    for l in LABELS:
        m = re.search(r"^%s:\s*$" % l, txt, re.M)
        pos[l] = m.start()
    order = sorted(LABELS, key=lambda l: pos[l])
    out = {}
    for i, l in enumerate(order):
        seg = txt[pos[l]:pos[order[i + 1]]] if i + 1 < len(order) else txt[pos[l]:]
        out[l] = [int(x, 16) for x in re.findall(r"0x([0-9A-Fa-f]{2})", seg)]
    return out


def rows(b):
    """Блок 32 Б = раскладка SGT MSX: [0..15] левая половина строк 0-15, [16..31] правая."""
    return [(b[r] << 8) | b[16 + r] for r in range(16)]


def bbox(rs):
    mn, mx, nrow = 99, -1, 0
    for w in rs:
        if w:
            nrow += 1
        for i in range(16):
            if w & (0x8000 >> i):
                mn = min(mn, i)
                mx = max(mx, i)
    return mn, mx, nrow


def rev16(w):
    r = 0
    for i in range(16):
        if w & (1 << i):
            r |= 1 << (15 - i)
    return r


def main():
    sets = load(SRC)
    for l in LABELS:
        by = sets[l]
        print("=== %s (%d Б, %d спрайтов 16x16)" % (l, len(by), len(by) // 32))
        gmin = 99
        for f in range(len(by) // 32):
            rs = rows(by[f * 32:(f + 1) * 32])
            if not any(rs):
                print("  спрайт %2d (pat 0x%02X): пусто" % (f, f * 4))
                continue
            mn, mx, nr = bbox(rs)
            mn2, mx2, _ = bbox([rev16(w) for w in rs])
            gmin = min(gmin, mn, mn2)
            print("  спрайт %2d (pat 0x%02X): прямой [%2d..%2d] w=%2d | зеркало [%2d..%2d] w=%2d | строк %2d"
                  % (f, f * 4, mn, mx, mx - mn + 1, mn2, mx2, mx2 - mn2 + 1, nr))
        print("  -> прижать влево можно на %d (min c0 по кадрам и направлениям)\n" % gmin)


if __name__ == "__main__":
    main()
