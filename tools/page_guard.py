#!/usr/bin/env python3
"""[mummy-zx] Гейт страниц: таблицы, которые индексируются `add a,l / ld l,a` (без переноса в H),
обязаны лежать в одной странице 256 Б. Падение сборки, если нет. Пополнять при новых таблицах."""
import re, sys
syms = {m.group(1): int(m.group(2), 16)
        for m in re.finditer(r'(\S+):\s*equ\s*0*([0-9A-Fa-f]+)h', open('build/kvalley_8c.sym').read())}
TABLES = {'gmo_tab': 64, 'gmd_tab': 8, 'vns_mumslo': 8, 'vec_rev4': 16}
bad = []
for name, size in TABLES.items():
    if name not in syms:
        continue
    a = syms[name]
    if (a >> 8) != ((a + size - 1) >> 8):
        bad.append('%s 0x%04X..0x%04X' % (name, a, a + size - 1))
if 'kv_res_end' in syms and syms['kv_res_end'] > syms['romCeil']:
    bad.append('РЕЗИДЕНТ ЗА romCeil: конец 0x%04X > 0x%04X (на %d Б)' % (syms['kv_res_end'], syms['romCeil'], syms['kv_res_end'] - syms['romCeil']))
if bad:
    sys.exit('PAGE GUARD: таблица пересекает страницу: ' + ', '.join(bad))
print('  страницы таблиц ок: ' + ', '.join(TABLES) + ('; резидент до 0x%04X, свободно до romCeil %d Б' % (syms['kv_res_end'], syms['romCeil'] - syms['kv_res_end']) if 'kv_res_end' in syms else ''))
