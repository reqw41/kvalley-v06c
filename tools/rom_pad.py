#!/usr/bin/env python3
"""Паддинг ROM: резидент до romCeil."""
import re, sys

sym = open('build/kvalley_8c.sym').read()
top = int(re.search(r'^romCeil:\s*equ\s*0*([0-9A-Fa-f]+)h', sym, re.M).group(1), 16)
n = top - 0x100
p = 'build/kvalley_8c.rom'
d = open(p, 'rb').read()
if len(d) < n:
    d = d + bytes(n - len(d))
    open(p, 'wb').write(d)
    print('  образ: %d Б резидента, паддинг до потолка %d Б (0x0100-0x%04X)'
          % (n, n, top - 1))
elif len(d) == n:
    print('  образ: %d Б (ровно потолок 0x0100-0x%04X)' % (n, top - 1))
else:
    # хвост за romCeil — оверлей в MapaRAM
    print('  образ: %d Б резидента + %d Б оверлея карты (потолок 0x%04X)'
          % (n, len(d) - n, top))
    if 0x100 + len(d) > 0x7800:
        sys.exit('rom_pad: оверлей залез на стартер обложки 0x7800 (конец 0x%04X)' % (0x100 + len(d)))
    # резидент не должен быть короче потолка: sjasm делает ds до MapaRAMRoot
    if len(d) < n:
        sys.exit('rom_pad: внутренний хвост короче потолка')
