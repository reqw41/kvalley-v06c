#!/usr/bin/env python3
# spr_patch.py — ЗАМЕНА КАДРА СПРАЙТА В ИСХОДНИКЕ src/res/gfx/hero_momia_rle.txt.
#
# ЗАЧЕМ. Спрайты правятся в браузере (tools/gfx/hero_editor.js), но класть результат в
# src/gen/vec_sprdata.asm НЕЛЬЗЯ: он сгенерирован и будет затёрт следующим прогоном
# spr_unpack.py. Правка обязана идти в ИСХОДНИК, а он хранится RLE-потоком
# (токены unpackGFXset), руками такое не редактируют. Этот скрипт распаковывает нужный
# блок, подменяет байты кадра, пакует обратно и переписывает исходник.
#
# ПОЧЕМУ ПЕРЕПАКОВКА БЕЗОПАСНА ПО РАЗМЕРУ: длина РАСПАКОВАННОЙ таблицы фиксирована
# (герой 320 Б), а сам исходник в сборку не входит — он лишь сырьё для генератора.
# Скрипт всё равно проверяет длину после распаковки и падает, если она уехала.
#
# Запуск:
#   python3 tools/gfx/spr_patch.py GFX_ProtaPico 0 A=<32 hex> B=<32 hex>
# где 0 — номер кадра (кадр = два слоя по 4 паттерна: A = 8k..8k+3, B = 8k+4..8k+7),
# A/B — по 32 байта в порядке блоков MSX: левый верх, левый низ, правый верх, правый низ.
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "src/res/gfx/hero_momia_rle.txt")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spr_unpack import read_blocks, unrle, SGT      # тот же распаковщик, что и у генератора


def rle_pack(base_addr, data):
    """Обратное к unrle: адрес + байты -> поток токенов. Fill для повторов >=3, иначе literal."""
    out = [base_addr & 0xFF, (base_addr >> 8) & 0xFF]
    i, n = 0, len(data)
    lit = []
    def flush():
        while lit:
            take = lit[:0x7F]
            del lit[:len(take)]
            out.append(0x80 | len(take))
            out.extend(take)
    while i < n:
        j = i
        while j < n and data[j] == data[i] and j - i < 0x7F:
            j += 1
        run = j - i
        if run >= 3:
            flush()
            out.append(run)          # bit7=0 -> fill
            out.append(data[i])
            i = j
        else:
            lit.append(data[i])
            i += 1
    flush()
    out.append(0x00)                 # конец блока
    return out


def main():
    if len(sys.argv) < 5:
        sys.exit(__doc__ or "см. шапку файла")
    block, frame = sys.argv[1], int(sys.argv[2])
    args = {a.split("=")[0]: a.split("=", 1)[1] for a in sys.argv[3:]}
    A = [int(t, 16) for t in args["A"].replace("|", " ").split()]
    B = [int(t, 16) for t in args["B"].replace("|", " ").split()]
    if len(A) != 32 or len(B) != 32:
        sys.exit("нужно ровно по 32 байта на слой, получено A=%d B=%d" % (len(A), len(B)))

    blocks = read_blocks(SRC)
    if block not in blocks:
        sys.exit("в исходнике нет блока %s; есть: %s" % (block, ", ".join(blocks)))
    mem, _ = unrle(blocks[block])
    lo, hi = min(mem), max(mem)
    data = [mem.get(a, 0) for a in range(lo, hi + 1)]
    print("блок %s: распакован из исходника, адреса 0x%04X-0x%04X (%d Б)" % (block, lo, hi, len(data)))

    off = frame * 64                                  # кадр = 8 паттернов по 8 Б
    if off + 64 > len(data):
        sys.exit("кадр %d выходит за таблицу (%d Б)" % (frame, len(data)))
    old = data[off:off + 64]
    data[off:off + 64] = A + B
    changed = sum(1 for x, y in zip(old, A + B) if x != y)
    print("кадр %d (паттерны 0x%02X-0x%02X): изменено %d байт из 64" % (frame, frame * 8, frame * 8 + 7, changed))

    tokens = rle_pack(lo, data)
    # перезаписываем блок в исходнике, сохранив комментарии и остальные блоки
    lines, out, cur, skipping = open(SRC, encoding="utf-8").read().split("\n"), [], None, False
    for ln in lines:
        s = ln.split("#")[0].strip()
        is_name = s and not all(c in "0123456789ABCDEFabcdef " for c in s)
        if is_name:
            if skipping:                              # закончился наш блок — вываливаем новый
                out.extend(body)
                skipping = False
            cur = s
            out.append(ln)
            if cur == block:
                skipping = True
                body = ["  " + " ".join("%02X" % v for v in tokens[i:i + 16])
                        for i in range(0, len(tokens), 16)]
            continue
        if skipping and s:
            continue                                  # старое тело блока выбрасываем
        if skipping and not s:
            out.extend(body); skipping = False
        out.append(ln)
    if skipping:
        out.extend(body)
    open(SRC, "w", encoding="utf-8").write("\n".join(out))
    print("исходник переписан: %s (%d токенов)" % (SRC, len(tokens)))
    print("теперь: python3 tools/gfx/spr_unpack.py && tools/build_nodeploy.sh")


if __name__ == "__main__":
    main()
