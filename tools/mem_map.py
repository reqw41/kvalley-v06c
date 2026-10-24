#!/usr/bin/env python3
"""Карта памяти собранного ROM: где кончается код, сколько свободно до переменных,
где зазоры от .align.

Запускается из build.sh. Падает, если код залез в игровые переменные.

ПОТОЛОК БЕРЁТСЯ ИЗ .sym, А НЕ ИЗ КОНСТАНТЫ В ЭТОМ ФАЙЛЕ (задача #37): база переменных
переезжает при каждом уплотнении нижней ОЗУ, и зашитый здесь адрес молча устаревал —
гейт либо пропускал перехлёст, либо резал сборку раньше времени. Потолок = символ romCeil
из kvalley_vars.asm, то есть первая ЗАНЯТАЯ ячейка нижней ОЗУ.

ЗАДАЧА#48 (2026-08-04): раньше здесь стоял GameStatus. Он перестал быть потолком, когда
блок игровых переменных и стек уехали в свободные зоны p3 (0x0FD38 и 0x0F6A5): GameStatus
теперь ВЫШЕ 0x8000, и потолок по нему выродился бы в «код может расти до 0xFD38», то есть
поверх карты и стека. Ставь romCeil, а не конкретное имя переменной.

ЗАЗОРЫ СЧИТАЮТСЯ ПО ЛИСТИНГУ, А НЕ ПО НУЛЯМ В ОБРАЗЕ (задача #37). Прежняя эвристика
«сколько нулей лежит перед page-aligned меткой» ВРАЛА: она показывала «16 Б зазора перед
vec_setpal_menu» (на самом деле там данные vec_pal_zero — 16 нулей чёрной палитры) и
дыры по 36-39 Б внутри vec_font_rom (пустые глифы шрифта). Отличить нулевые ДАННЫЕ от
паддинга по одному образу нельзя, а по листингу — можно: настоящий зазор бывает только
от .align, и там адрес следующей строки уходит вперёд без эмиссии байт.
"""
import re, sys

ROM = 'build/kvalley_8c.rom'
SYM = 'build/kvalley_8c.sym'
LST = 'build/kvalley_8c.lst'
TOP_SYM = 'romCeil'           # первая занятая ячейка нижней ОЗУ = потолок кода и данных

d = open(ROM, 'rb').read()
syms = {m.group(1): int(m.group(2), 16)
        for m in re.finditer(r'(\S+):\s*equ\s*0*([0-9A-Fa-f]+)h', open(SYM).read())}
if TOP_SYM not in syms:
    sys.exit('mem_map: в .sym нет символа %s — потолок брать неоткуда' % TOP_SYM)
VARS_START = syms[TOP_SYM]
resident = d[:VARS_START - 0x100] if len(d) > VARS_START - 0x100 else d
end = len(resident)
while end > 0 and resident[end - 1] == 0:
    end -= 1
end += 0x100
free = VARS_START - end

print('  карта памяти: код+данные 0x0100-0x%04X, потолок %s=0x%04X, свободно %d Б'
      % (end, TOP_SYM, VARS_START, free))

# Зазоры от .align: адрес строки с директивой и адрес ближайшей следующей строки листинга.
try:
    lines = open(LST, encoding='latin-1').read().split('\n')
except FileNotFoundError:
    lines = []
addr_re = re.compile(r'^\s*\d+[+\s]\s*([0-9A-Fa-f]{4})\s')
pending = None
total = 0
for line in lines:
    m = addr_re.match(line)
    if not m:
        continue
    a = int(m.group(1), 16)
    if pending is not None:
        gap = a - pending[0]
        if gap > 0:
            total += gap
            what = [n for n, v in syms.items() if v == a]
            print('    зазор %3d Б от .align: 0x%04X-0x%04X (перед %s) — можно занять '
                  'переносом процедуры ЦЕЛИКОМ' % (gap, pending[0], a - 1, what[0] if what else '?'))
        pending = None
    if re.search(r'\.align\b', line):
        pending = (a, line)
if total:
    print('    итого в паддинге выравнивания: %d Б' % total)

if end > VARS_START:
    sys.exit('ПЕРЕПОЛНЕНИЕ: код залез в игровые переменные на %d Б' % (end - VARS_START))
