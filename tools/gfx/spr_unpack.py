#!/usr/bin/env python3
# ЗАДАЧА #12 + фаза 2 shared-pool: спрайты героя/мумии в образе.
#
#   src/res/gfx/hero_momia_rle.txt  ->  src/gen/vec_sprdata.asm
#
# Герой (prota/knife/pico): общий пул уникальных 8-байтовых ячеек + карта
# паттерн→индекс. Мумия — по-прежнему линейная таблица.
#
# Перегенерация (в конвейер сборки НЕ включена):
#   python3 tools/gfx/spr_unpack.py
# Результат обязан совпасть с закоммиченным src/gen/vec_sprdata.asm байт-в-байт.
import os, sys
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "src/res/gfx/hero_momia_rle.txt")
OUT = os.path.join(ROOT, "src/gen/vec_sprdata.asm")

SGT = 0x1800
HERO_LEN = 0x140        # 10 спрайтов 16x16 = 320 Б (паттерны 0x00-0x27)
MOMIA_AT = 0x1940
MOMIA_LEN = 0x60
N_PAT = HERO_LEN // 8   # 40 ячеек на набор
MOMIA_LSHIFT = 3

# Совместимость со spr_sheet / spr_patch (имя, метка asm, база VRAM-тени, длина, подпись)
SETS = (
    ("GFX_Prota", "prota", SGT, HERO_LEN, "герой без предмета"),
    ("GFX_ProtaKnife", "knife", SGT, HERO_LEN, "герой с ножом"),
    ("GFX_ProtaPico", "pico", SGT, HERO_LEN, "герой с киркой"),
    ("GFX_MOMIA", "momia", MOMIA_AT, MOMIA_LEN, "мумия"),
)


def fill_prota_tail(blocks, prota_data):
    """Хвост 0x18-0x27 у «пусто» = хвост ножа (как в карте vec_spr_prota)."""
    mem, _ = unrle(blocks["GFX_ProtaKnife"])
    knife = bytes(mem.get(SGT + k, 0) for k in range(HERO_LEN))
    return bytes(prota_data[:0xC0]) + knife[0xC0:]


def read_blocks(path):
    blocks, cur = {}, None
    for ln in open(path, encoding="utf-8"):
        ln = ln.split("#")[0].strip()
        if not ln:
            continue
        if not ln[0].isdigit() and not all(c in "0123456789ABCDEFabcdef " for c in ln):
            cur = ln
            blocks[cur] = []
            continue
        blocks[cur] += [int(t, 16) for t in ln.split()]
    return blocks


def unrle(b):
    i = 0
    addr = b[0] | (b[1] << 8)
    i = 2
    mem = {}
    while i < len(b):
        n = b[i]
        i += 1
        if n == 0x00:
            break
        if n == 0x80:
            addr = b[i] | (b[i + 1] << 8)
            i += 2
            continue
        cnt = n & 0x7F
        if n & 0x80:
            for _ in range(cnt):
                mem[addr] = b[i]
                addr += 1
                i += 1
        else:
            v = b[i]
            i += 1
            for _ in range(cnt):
                mem[addr] = v
                addr += 1
    return mem, i


def momia_push_left(data, k):
    out = bytearray(data)
    for blk in range(0, len(data), 32):
        for r in range(16):
            w = (data[blk + r] << 8) | data[blk + 16 + r]
            if w & ~(0xFFFF >> k) & 0xFFFF:
                sys.exit("мумия: сдвиг на %d теряет биты (блок %d, строка %d)" % (k, blk // 32, r))
            w = (w << k) & 0xFFFF
            out[blk + r] = w >> 8
            out[blk + 16 + r] = w & 0xFF
    return bytes(out)


def momia_cap8(data):
    """Загнуть биты 8..15 в пиксель 7. Восемь точек в [0..7] при X&7=0..7
    не достают до 3-го столбца fb (сейв ≤ 16 px). Не обрезка: вынесенный
    бит OR-ится в край окна, как clamp в spr_sheet.py."""
    out = bytearray(data)
    n = 0
    for blk in range(0, len(data), 32):
        for r in range(16):
            right = data[blk + 16 + r]
            if not right:
                continue
            n += 1
            out[blk + r] = data[blk + r] | 0x01
            out[blk + 16 + r] = 0
    return bytes(out), n


def cells_of(data):
    return [data[i:i + 8] for i in range(0, len(data), 8)]


def emit_db(out, data, width=16):
    for i in range(0, len(data), width):
        chunk = data[i:i + width]
        if isinstance(chunk[0], int):
            out.append("\tdb\t" + ", ".join("0x%02X" % x for x in chunk))
        else:
            # list of ints already
            out.append("\tdb\t" + ", ".join("0x%02X" % x for x in chunk))


def main():
    blocks = read_blocks(SRC)
    hero_raw = {}
    for key, label in (("GFX_Prota", "prota"), ("GFX_ProtaKnife", "knife"),
                       ("GFX_ProtaPico", "pico")):
        raw = blocks[key]
        mem, used = unrle(raw)
        if used != len(raw):
            sys.exit("%s: RLE len" % key)
        data = bytes(mem.get(SGT + k, 0) for k in range(HERO_LEN))
        hero_raw[label] = (data, len(raw))

    # Full 40 cells each; prota tail 0x18-0x27 = knife (задача #51)
    knife_cells = cells_of(hero_raw["knife"][0])
    pico_cells = cells_of(hero_raw["pico"][0])
    prota_cells = cells_of(hero_raw["prota"][0][:0xC0]) + knife_cells[24:]

    pool = list(OrderedDict.fromkeys(prota_cells + knife_cells + pico_cells))
    if len(pool) > 256:
        sys.exit("pool > 256 cells")
    idx = {c: i for i, c in enumerate(pool)}
    map_prota = [idx[c] for c in prota_cells]
    map_knife = [idx[c] for c in knife_cells]
    map_pico = [idx[c] for c in pico_cells]

    # Momia
    raw = blocks["GFX_MOMIA"]
    mem, used = unrle(raw)
    if used != len(raw):
        sys.exit("MOMIA RLE")
    momia = momia_push_left(bytes(mem.get(MOMIA_AT + k, 0) for k in range(MOMIA_LEN)), MOMIA_LSHIFT)
    momia, nfold = momia_cap8(momia)

    out = []
    out.append("; СГЕНЕРИРОВАНО tools/gfx/spr_unpack.py — НЕ ПРАВИТЬ РУКАМИ.")
    out.append(";")
    out.append("; Shared-pool героя (фаза 2): уникальные 8Б-ячейки + карта паттерн→индекс.")
    out.append("; vsp_pat собирает 32Б кадр в vec_spr_asml; мумия — линейная таблица.")
    out.append("; Метки vec_spr_prota/knife/pico = КАРТЫ (IndexSprites / vsp_hbase).")
    out.append("; Исходник RLE: src/res/gfx/hero_momia_rle.txt")
    out.append(";")
    out.append("; --- vec_spr_pool: %d ячеек x 8 = %d Б ---" % (len(pool), len(pool) * 8))
    out.append("vec_spr_pool:")
    for c in pool:
        out.append("\tdb\t" + ", ".join("0x%02X" % x for x in c))

    def emit_map(label, caption, mp, rle_len):
        out.append("")
        out.append("; --- %s: карта %s, %d индексов (RLE было %d Б)."
                   % (label, caption, len(mp), rle_len))
        out.append("%s:" % label)
        for i in range(0, len(mp), 16):
            out.append("\tdb\t" + ", ".join("0x%02X" % x for x in mp[i:i + 16]))

    emit_map("vec_spr_prota", "герой без предмета (хвост 0x18-0x27 = knife)",
             map_prota, hero_raw["prota"][1])
    emit_map("vec_spr_knife", "герой с ножом", map_knife, hero_raw["knife"][1])
    emit_map("vec_spr_pico", "герой с киркой", map_pico, hero_raw["pico"][1])

    out.append("")
    out.append("; --- vec_spr_momia: мумия. Паттерны 0x28-0x33, %d Б." % len(momia))
    out.append("; ЗАДАЧА #44: силуэт прижат влево на %d пикс (momia_push_left)." % MOMIA_LSHIFT)
    out.append("; 2026-09-19: загиб в 8 px (momia_cap8) — правый байт пуст, сейв ≤ 16.")
    out.append("vec_spr_momia:")
    for i in range(0, len(momia), 16):
        out.append("\tdb\t" + ", ".join("0x%02X" % x for x in momia[i:i + 16]))
    out.append("")

    open(OUT, "w", encoding="utf-8").write("\n".join(out) + "\n")
    old = 192 + 320 + 320 + 96
    new = len(pool) * 8 + 40 * 3 + len(momia)
    print("spr_unpack: %s" % OUT)
    print("  pool %d cells (%d Б), maps 3x40, momia %d, cap8 загиб %d строк" %
          (len(pool), len(pool) * 8, len(momia), nfold))
    print("  было %d Б таблиц героя+мумия, стало %d Б, дельта %+d Б" % (old, new, new - old))
    # self-check: rebuild frames
    def frame(mp, fi):
        base = fi * 4
        return b"".join(pool[mp[base + k]] for k in range(4))
    for name, cells, mp in (("prota", prota_cells, map_prota),
                            ("knife", knife_cells, map_knife),
                            ("pico", pico_cells, map_pico)):
        for fi in range(len(cells) // 4):
            want = b"".join(cells[fi * 4:fi * 4 + 4])
            got = frame(mp, fi)
            if want != got:
                sys.exit("roundtrip fail %s frame %d" % (name, fi))
    if any(momia[blk + 16 + r] for blk in range(0, len(momia), 32) for r in range(16)):
        sys.exit("cap8: правый байт мумии не пуст")
    print("  roundtrip OK")


if __name__ == "__main__":
    main()
