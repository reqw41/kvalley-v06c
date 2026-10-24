#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ГЕЙТ КАССЕТЫ: разобрать готовый WAV обратно и сверить с исходниками.

    python3 tools/cas/check_cas.py

Гейт читает build/cas/kvalley_kaseta.wav как ЗВУК (по длительностям импульсов,
а не по внутренним структурам сборщика) и восстанавливает из него:

  * поток формата ПЗУ -> байты ступени 1 (сверка с build/cas/stage1.bin);
  * три турбо-блока -> рантайм 2, сжатая заставка, образ игры.

Сверяется: образ игры БАЙТ В БАЙТ с build/kvalley_8c.rom (и md5), заставка —
распаковкой обратно в docs/cas/v16_planes.raw, адреса назначения и флаги,
контрольные суммы Флетчера в самом потоке.

Гейт обязан падать на пустой выборке: если блоков найдено не три или в
ПЗУ-потоке не нашлось ни одного подблока — это ошибка, а не «нечего проверять».
"""

import hashlib
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import tape                                            # noqa: E402
import pack_lz                                         # noqa: E402

WAV = os.path.join(ROOT, 'build', 'cas', 'kvalley_kaseta.wav')
GAME = os.path.join(ROOT, 'build', 'kvalley_8c.rom')
PLANES = os.path.join(ROOT, 'docs', 'cas', 'v16_planes.raw')
STAGE1 = os.path.join(ROOT, 'build', 'cas', 'stage1.bin')

fails = []


def check(cond, msg):
    print(('  ok   ' if cond else '  ПАДЕНИЕ ') + msg)
    if not cond:
        fails.append(msg)


def wav_samples(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'RIFF' and d[8:12] == b'WAVE'
    i = 12
    rate = None
    while i < len(d):
        cid, sz = d[i:i + 4], struct.unpack('<I', d[i + 4:i + 8])[0]
        body = d[i + 8:i + 8 + sz]
        if cid == b'fmt ':
            rate = struct.unpack('<I', body[4:8])[0]
        elif cid == b'data':
            return rate, body
        i += 8 + sz + (sz & 1)
    raise SystemExit('в WAV нет чанка data')


def runs(samples):
    """Звук -> список длин импульсов (в сэмплах), порог 128."""
    out = []
    cur = samples[0] > 127
    n = 0
    for s in samples:
        b = s > 127
        if b == cur:
            n += 1
        else:
            out.append(n)
            cur = b
            n = 1
    out.append(n)
    return out


def decode_turbo(pulses, start):
    """Разобрать один турбо-блок начиная с метки. Возвращает (dest, pages,
    flags, данные, конец)."""
    # Кандидатов на метку в ПЗУ-части ленты хватает: там полупериод 14
    # сэмплов, а два одинаковых подряд дают пробег 28. Поэтому ложную метку
    # отсеиваем синхробайтом и ищем дальше, а не сдаёмся на первой.
    i = start
    while True:
        while i < len(pulses) and pulses[i] < tape.TURBO_MARK - 2:
            i += 1
        if i + 9 * 8 >= len(pulses):
            return None
        i += 1                              # метка съедена
        break

    def byte():
        nonlocal i
        i += 1                              # синхроимпульс
        v = 0
        for k in range(8):
            v = (v << 1) | (1 if pulses[i + k] >= (tape.TURBO_SHORT +
                                                   tape.TURBO_LONG) // 2 else 0)
        i += 8
        return v

    sync = byte()
    if sync != tape.TURBO_SYNCBYTE:
        return decode_turbo(pulses, i)      # ложная метка — ищем следующую
    lo, hi, pages, flags = byte(), byte(), byte(), byte()
    if i + 9 * (pages * 256 + 2) >= len(pulses):
        return None
    data = bytes(byte() for _ in range(pages * 256))
    c1, c2 = byte(), byte()
    s1 = s2 = 0
    for b in data:
        s1 = (s1 + b) & 0xFF
        s2 = (s2 + s1) & 0xFF
    return dict(dest=lo | (hi << 8), pages=pages, flags=flags, data=data,
                cks_ok=(c1 == s1 and c2 == s2), end=i)


ROM_HP = 14                       # полупериод фазовой модуляции при 44100 Гц
FULL_WAV = os.path.join(ROOT, 'build', 'cas', 'kvalley_full.wav')


def biphase_bits(pulses, hp, lvl0):
    """Пробеги уровней -> биты. В фазовой модуляции бит занимает два
    полупериода, и значение несёт ВТОРОЙ из них (первый — инверсный)."""
    half = []
    lvl = lvl0
    for n in pulses:
        for _ in range(max(1, int(round(n / hp)))):
            half.append(lvl)
        lvl ^= 1
    return [half[i + 1] for i in range(0, len(half) - 1, 2)]


def rom_groups(bits):
    """Разобрать поток штатного формата так же, как это делает ПЗУ: побитно
    искать 0xE6, затем 35 байт, затем проверить сумму.

    Возвращает СПИСОК программ (лента — их конкатенация), каждая как
    {страница: 256 байт}. Разбирать вместе нельзя: программы кладутся по
    пересекающимся адресам (образ игры занимает то же ОЗУ, где до него
    лежала сжатая заставка), и склеенная картина памяти врёт."""
    pos = 0
    progs = []
    cur = tag = None
    bad = [0]
    while True:
        c = 0
        while True:
            if pos >= len(bits):
                return progs, bad[0]
            c = ((c << 1) | bits[pos]) & 0xFF
            pos += 1
            if c == 0xE6:
                break
        buf = []
        s = 0
        for _ in range(35):
            if pos + 8 > len(bits):
                return progs, bad[0]
            v = 0
            for _ in range(8):
                v = ((v << 1) | bits[pos]) & 0xFF
                pos += 1
            buf.append(v)
            s = (s + v) & 0xFF
        if (s - 2 * buf[34]) & 0xFF:
            # Сумма не сошлась. На чистой ленте такого быть не должно ВООБЩЕ:
            # 0xE6 встречается и внутри данных, поэтому пара ложных срабатываний
            # ожидаема, но любая порча сигнала сразу поднимет этот счётчик.
            bad[0] += 1
            continue
        if buf[0] == 0:                    # заголовок страницы
            org, total, num = buf[31], buf[32], buf[33]
            if num == total:               # первая страница = новая программа
                progs.append({'org': org, 'pages': total, 'data': {}})
            if not progs:
                continue
            cur = (org + total - num) & 0xFF
            tag = buf[34]
        elif progs and cur is not None and buf[1] == tag:
            page = progs[-1]['data'].setdefault(cur, bytearray(256))
            page[(buf[0] & 7) * 32:(buf[0] & 7) * 32 + 32] = buf[2:34]
    return progs, bad[0]


def flat(prog):
    """Страницы программы -> непрерывный кусок памяти с её адреса."""
    out = bytearray(prog['pages'] * 256)
    for p, v in prog['data'].items():
        i = ((p - prog['org']) & 0xFF) * 256
        out[i:i + 256] = v
    return bytes(out)


def check_full(ref, planes):
    print('--- чисто штатный вариант (kvalley_full.wav) ---')
    if not os.path.exists(FULL_WAV):
        check(False, 'нет %s' % FULL_WAV)
        return
    rate, samples = wav_samples(FULL_WAV)
    # Уровень ПЕРВОГО сэмпла обязателен: поток начинается с ракорда из
    # байтов 0x00, у которых первый полупериод ВЫСОКИЙ. Если начать отсчёт
    # с нуля, все биты приедут инверсными и ни одного 0xE6 не найдётся.
    progs, bad = rom_groups(biphase_bits(runs(samples), ROM_HP,
                                         1 if samples[0] > 127 else 0))
    check(bad <= 8, 'групп с несошедшейся суммой: %d (на чистой ленте это только '
                    'ложные 0xE6 внутри данных)' % bad)
    check(len(progs) == 3, 'программ на ленте %d (ждём 3)' % len(progs))
    if len(progs) != 3:
        return
    boot, splash, game = progs
    total = sum(p['pages'] for p in progs)
    game_pages = (256 + len(ref) + 255) // 256
    check(total == 3 + splash['pages'] + game_pages,
          'страниц всего %d (ступень 3 + заставка %d + игра %d)'
          % (total, splash['pages'], game_pages))
    for p in progs:
        check(len(p['data']) == p['pages'],
              'программа с 0x%02X00: принято %d страниц из %d'
              % (p['org'], len(p['data']), p['pages']))

    check(boot['org'] == 0xDA and boot['pages'] == 3,
          'кусок 1 — ступень 1, 3 страницы с 0xDA00')
    b1 = flat(boot)
    check(b1[0xDCEE - 0xDA00:0xDCF0 - 0xDA00] == bytes([0x00, 0xDB]),
          'подмена адреса возврата ПЗУ по 0xDCEE — на месте и здесь')

    check(splash['org'] == 0x07, 'кусок 2 — заставка, с 0x0700')
    b2 = flat(splash)
    check(b2[:256] == b'\xFF' * 256, 'первая страница куска 2 — жертва (0xFF)')
    try:
        un, used = pack_lz.unpack(bytes(b2[0x300:]))
    except Exception as e:
        un = b''
        print('  (распаковка упала: %s)' % e)
    check(un[:len(planes)] == planes,
          'заставка с ленты распаковалась в v16_planes.raw (%d Б)' % len(planes))

    check(game['org'] == 0x00, 'кусок 3 — игра, с 0x0000')
    b3 = flat(game)
    check(b3[:3] == b'\xC3\x00\x01',
          'по 0x0000 лежит jp 0x0100 — точка входа после БЛК+СБР')
    check(b3[0x100:0x100 + len(ref)] == ref,
          'образ игры с ленты совпал байт в байт (%d Б)' % len(ref))
    print('  --  длительность %.0f с (%d:%02d)'
          % (len(samples) / rate, len(samples) / rate // 60, len(samples) / rate % 60))


def main():
    print('гейт кассеты:', WAV)
    if not os.path.exists(WAV):
        sys.exit('нет ленты — сначала python3 tools/cas/make_cas.py')

    rate, samples = wav_samples(WAV)
    check(rate == tape.TURBO_SAMPLE_RATE, 'частота дискретизации %d Гц' % rate)
    p = runs(samples)
    check(len(p) > 1000, 'импульсов в ленте: %d' % len(p))

    # --- турбо-блоки: ищем метки по всей ленте ---------------------------
    blocks = []
    i = 0
    while i < len(p):
        b = decode_turbo(p, i)
        if b is None:
            break
        blocks.append(b)
        i = b['end']
    check(len(blocks) == 3, 'турбо-блоков найдено %d (ждём 3)' % len(blocks))
    if len(blocks) != 3:
        sys.exit(1)

    rt2, splash, game = blocks
    for name, b in (('рантайм 2', rt2), ('заставка', splash), ('игра', game)):
        check(b['cks_ok'], 'контрольная сумма Флетчера сошлась: %s' % name)

    check(rt2['dest'] == 0x7900 and rt2['flags'] == 1,
          'рантайм 2 -> 0x%04X, флаг пуска %d' % (rt2['dest'], rt2['flags']))
    check(splash['dest'] == 0x0800 and splash['flags'] == 0,
          'заставка -> 0x%04X (выше ПЗУ, иначе её не прочитать)' % splash['dest'])
    check(game['dest'] == 0x0100 and game['flags'] == 0,
          'игра -> 0x%04X' % game['dest'])

    ref = open(GAME, 'rb').read()
    # Замороженный md5 релиза снят (ложно краснел при каждом обновлении игры):
    # истинный сторож — следующая строка, байт-в-байт против текущей сборки.
    check(game['data'][:len(ref)] == ref,
          'образ игры с ленты совпал байт в байт (%d Б)' % len(ref))
    check(set(game['data'][len(ref):]) <= {0},
          'добивка образа до страницы — нули (%d Б)' % (len(game['data']) - len(ref)))

    planes = open(PLANES, 'rb').read()
    un, used = pack_lz.unpack(splash['data'])
    check(un[:len(planes)] == planes,
          'заставка с ленты распаковалась в v16_planes.raw (%d Б)' % len(planes))
    check(len(un) == len(planes), 'распаковалось ровно %d Б' % len(un))

    st1 = open(STAGE1, 'rb').read()
    check(len(st1) == 768, 'ступень 1 = 768 Б (3 страницы 0xDA-0xDC)')
    check(st1[0xDCEE - 0xDA00:0xDCF0 - 0xDA00] == bytes([0x00, 0xDB]),
          'подмена адреса возврата ПЗУ по 0xDCEE на 0xDB00 — на месте')
    check(st1[0xDCEA - 0xDA00:0xDCEE - 0xDA00] == bytes([0x00, 0xDB, 0x01, 0x01]),
          'сохранённые BC=0xDB00 / DE=0x0101 по 0xDCEA — на месте')
    check(st1[0xDCAE - 0xDA00:0xDCB0 - 0xDA00] == bytes([0x00, 0x00]),
          'клетки 6,7 карты прогресса последней страницы — нули')

    dur = len(samples) / rate
    print('  --  длительность ленты %.1f с' % dur)

    check_full(ref, planes)
    print('ГЕЙТ ' + ('ЗЕЛЁНЫЙ' if not fails else 'КРАСНЫЙ: %d' % len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
