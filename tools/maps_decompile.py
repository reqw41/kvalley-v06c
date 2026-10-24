#!/usr/bin/env python3
# ОДНОРАЗОВЫЙ декомпилятор карт пирамид: ROM -> src/res/maps/pyramids.txt
# Формат данных восстановлен из setupStage/unpackMap/getDoors/... (legacy/msx/kvalley_src.asm)
import sys

ROM = open("build/kvalley_8c.rom","rb").read()
def rd(addr): return ROM[addr-0x100]

HALF_BASES = [0x2616, 0x26C6, 0x274A, 0x27CE]   # halfMap1..4
MAPS = {1:0x287E}
# адреса MapStage1..15 из indexPiramides прочитаем прямо из ROM (@0x390C: 15 dw)
IDX = 0x390C
STAGES = []
for n in range(15):
    lo, hi = rd(IDX+2*n), rd(IDX+2*n+1)
    STAGES.append(lo | (hi<<8))

out = []
out.append("# Карты пирамид King's Valley — ИСХОДНИК (редактируемый текст).")
out.append("# Компилируется tools/maps_compile.py в src/res/res_maps.asm (вызывается build.sh).")
out.append("#")
out.append("# ПОЛУЭКРАН (HALF) = половина комнаты: 22 ряда x 16 клеток; '#'=кирпич, '.'=пусто.")
out.append("# Комната = 2 полуэкрана (лево+право), пирамида = 1-2 комнаты (2-4 полуэкрана).")
out.append("# Полуэкраны ОБЩИЕ между пирамидами (правка одного меняет все, где он используется).")
out.append("# Группы = позиция слева направо: A=левый край, B,C=середина, D=ПРАВЫЙ/последний.")
out.append("# ИНВАРИАНТ ДВИЖКА: последний полуэкран пирамиды обязан быть из группы D")
out.append("# (его дескриптор служит терминатором списка), остальные — не из D.")
out.append("")

# --- пул полуэкранов: границы баз -> число слотов ---
ends = HALF_BASES[1:] + [STAGES[0]]
GRP="ABCD"
for bi, base in enumerate(HALF_BASES):
    nslots = (ends[bi]-base)//44
    for s in range(nslots):
        out.append("HALF %s%d" % (GRP[bi], s))
        a = base + s*44
        for row in range(22):
            b0, b1 = rd(a+row*2), rd(a+row*2+1)
            bits = (b0<<8)|b1
            out.append("".join("#" if (bits>>(15-i))&1 else "." for i in range(16)))
        out.append("")

# --- пирамиды ---
for n in range(15):
    a = STAGES[n]
    out.append("PYRAMID %d" % (n+1))
    halves = []
    while True:
        b = rd(a); a += 1
        gi = ((b>>3) & 0x1E)//2
        halves.append("%s%d" % (GRP[gi], b & 0x0F))
        if gi == 3: break          # полуэкран группы D завершает список
        assert len(halves) < 4
    out.append("HALVES " + " ".join(halves))
    for d in range(4):
        y = rd(a)
        if y == 0xFF:
            out.append("DOOR -"); a += 1
        else:
            x = rd(a+1); dd = rd(a+2); a += 3
            out.append("DOOR y=0x%02X x=0x%02X dest=%d dir=%d" % (y, x, dd>>4, dd&0x0F))
    nm = rd(a); a += 1
    for i in range(nm):
        y, xr, tp = rd(a), rd(a+1), rd(a+2); a += 3
        s = "MUMMY y=0x%02X x=0x%02X room=%d type=%d" % (y, xr&0xF8, xr&1, tp)
        if xr & 0x06: s += " xtra=%d" % ((xr>>1)&3)   # don't-care биты 1-2
        out.append(s)
    ng = rd(a); a += 1
    for i in range(ng):
        c, y, x = rd(a), rd(a+1), rd(a+2); a += 3
        lo = c & 0x0F   # лоадер маскирует (and F0h) — don't-care, но храним для байт-точности
        s = "GEM color=%d y=0x%02X x=0x%02X" % (c>>4, y, x)
        if lo: s += " lo=%d" % lo
        out.append(s)
    nk = rd(a); a += 1
    for i in range(nk):
        out.append("KNIFE y=0x%02X x=0x%02X" % (rd(a), rd(a+1))); a += 2
    np_ = rd(a); a += 1
    for i in range(np_):
        out.append("PICK y=0x%02X x=0x%02X" % (rd(a), rd(a+1))); a += 2
    ngir = rd(a); a += 1
    for i in range(ngir):
        h, y, xp = rd(a), rd(a+1), rd(a+2); a += 3
        out.append("ROTDOOR h=%d y=0x%02X x=0x%02X room=%d dir=%d" % (h, y, xp&0xF8, (xp>>2)&1, xp&3))
    nt = rd(a); a += 1
    for i in range(nt):
        out.append("TRAP y=0x%02X x=0x%02X" % (rd(a), rd(a+1))); a += 2
    ns = rd(a); a += 1
    for i in range(ns):
        y, xp = rd(a), rd(a+1); a += 2
        s = "STAIR y=0x%02X x=0x%02X room=%d dir=%s" % (y, xp&0xF8, (xp>>1)&1, "L" if xp&1 else "R")
        if xp & 0x04: s += " xtra=1"   # don't-care бит 2
        out.append(s)
    out.append("")

import os
os.makedirs("src/res/maps", exist_ok=True)
open("src/res/maps/pyramids.txt","w",encoding="utf-8").write("\n".join(out)+"\n")
print("pyramids.txt записан;", len(out), "строк")
