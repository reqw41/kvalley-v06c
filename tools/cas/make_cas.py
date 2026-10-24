#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собрать кассетную версию King's Valley одной командой.

    python3 tools/cas/make_cas.py

На входе: build/kvalley_8c.rom (собрать заранее: KV_NO_DEPLOY=1 ./build.sh)
          docs/cas/v16_planes.raw, docs/cas/v16_pal.bin
На выходе: build/cas/kvalley_kaseta.wav — одна лента целиком.

СТРУКТУРА ЛЕНТЫ

  1. Ступень 1, формат штатного ПЗУ (v06c-rom, фазовая модуляция 1575 бод).
     Три страницы 0xDA-0xDC: страница-жертва, код переезда, рантайм 1.
     Это единственный кусок, который читает ПЗУ. Дальше — только мы.
  2. Турбо-блок: рантайм 2 -> 0x7900, флаг «пуск».
  3. Турбо-блок: сжатая заставка -> 0x0800.
  4. Турбо-блок: образ игры -> 0x0100.

Турбо в десять раз быстрее штатного формата, поэтому длинным штатным куском
едет только 768 байт, а 48 килобайт полезного груза — быстрым.
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import tape                                            # noqa: E402
import pack_lz                                         # noqa: E402

SJASM = os.path.join(ROOT, 'tools', 'bin', 'sjasm')
BUILD = os.path.join(ROOT, 'build', 'cas')

GAME_ROM = os.path.join(ROOT, 'build', 'kvalley_8c.rom')
# Сторож «кассета не трогает игру» — самосверка: check_cas.py разбирает готовый WAV
# как звук и сравнивает payload с build/kvalley_8c.rom байт-в-байт. Замороженный md5
# релиза здесь ложно краснел при каждом обновлении игры (урок 1.04b).
PLANES = os.path.join(ROOT, 'docs', 'cas', 'v16_planes.raw')

STAGE1_ORG = 0xDA00
RT1_DEST = 0x7800
RT2_DEST = 0x7900
SPLASH_DEST = 0x0800
GAME_DEST = 0x0100
LEADER_GROUPS = 48       # групп по 25 байт в ракорде ступени 1
PILOT_SHORT = 4410       # коротких импульсов = 0.2 с
PILOT_GAME = 66150       # 3.0 с — на распаковку заставки и установку палитры
ROM_HALFPERIOD = 14      # 14 сэмплов при 44100 Гц = те же 1575 бод, что 7 при 22050


def sjasm(src, out, lst):
    r = subprocess.run([SJASM, '-s', src, out, lst], cwd=os.path.dirname(src),
                       capture_output=True, text=True)
    if r.returncode != 0 or 'Errors: 0' not in r.stdout:
        sys.exit('sjasm упал на %s:\n%s%s' % (src, r.stdout, r.stderr))
    return open(out, 'rb').read()


def embed(runtime):
    """Подложить нужный рантайм под incbin ступени 1 (см. stage1_body.asm)."""
    open(os.path.join(BUILD, 'runtime_embed.bin'), 'wb').write(runtime)


def main():
    os.makedirs(BUILD, exist_ok=True)
    src = os.path.join(ROOT, 'src', 'cas')

    game = open(GAME_ROM, 'rb').read()
    import hashlib
    md5 = hashlib.md5(game).hexdigest()
    print('игра: %s (%d Б) — сверку байт-в-байт с WAV делает check_cas.py' % (md5, len(game)))

    # Ступени собираются по цепочке: рантайм 1 вкладывается в ступень 1.
    rt1 = sjasm(os.path.join(src, 'runtime.asm'),
                os.path.join(BUILD, 'runtime.bin'), os.path.join(BUILD, 'runtime.lst'))
    if len(rt1) > 246:
        sys.exit('рантайм 1 %d Б, а в страницу 0xDB влезает 246' % len(rt1))
    embed(rt1)
    st1 = sjasm(os.path.join(src, 'stage1.asm'),
                os.path.join(BUILD, 'stage1.bin'), os.path.join(BUILD, 'stage1.lst'))
    rt2 = sjasm(os.path.join(src, 'runtime2.asm'),
                os.path.join(BUILD, 'runtime2.bin'), os.path.join(BUILD, 'runtime2.lst'))

    planes = open(PLANES, 'rb').read()
    lz, _ = pack_lz.pack(planes)
    open(os.path.join(BUILD, 'v16.lz'), 'wb').write(lz)

    game_end = GAME_DEST + len(game)
    if game_end > RT1_DEST:
        sys.exit('игра/оверлей до 0x%04X заходит на рантайм 1 0x%04X'
                 % (game_end, RT1_DEST))
    if SPLASH_DEST + len(lz) > RT1_DEST:
        sys.exit('сжатая заставка %d Б не влезает между 0x%04X и загрузчиком 0x%04X'
                 % (len(lz), SPLASH_DEST, RT1_DEST))
    if RT2_DEST + len(rt2) > 0x7F00:
        sys.exit('рантайм 2 %d Б налезает на стек' % len(rt2))

    # --- звук -------------------------------------------------------------
    part1 = tape.biphase(tape.v06c_rom(st1, STAGE1_ORG, 'KVALLEY',
                                       leader_groups=LEADER_GROUPS),
                         ROM_HALFPERIOD)[:-tape.END_PADDING]
    # Лента не останавливается, поэтому ПИЛОТ ПЕРЕД БЛОКОМ обязан покрыть всё,
    # что загрузчик делает между блоками, иначе метка раскадровки проедет мимо.
    # Перед образом игры это распаковка 32 КБ заставки и два кадра ожидания
    # гашения под палитру — отсюда PILOT_GAME в три секунды.
    pulses = []
    pulses += tape.turbo_block(RT2_DEST, rt2, jump=True, pilot=PILOT_SHORT)
    pulses += tape.turbo_block(SPLASH_DEST, lz, pilot=PILOT_SHORT)
    pulses += tape.turbo_block(GAME_DEST, game, pilot=PILOT_GAME)
    part2 = tape.turbo_samples(pulses)

    samples = part1 + part2 + bytes([128]) * (tape.TURBO_SAMPLE_RATE // 2)
    out = os.path.join(BUILD, 'kvalley_kaseta.wav')
    open(out, 'wb').write(tape.wav8(samples, tape.TURBO_SAMPLE_RATE))

    sr = tape.TURBO_SAMPLE_RATE
    t1 = len(part1) / sr

    def sec(n, pilot=PILOT_SHORT):
        return tape.turbo_seconds(n, pilot=pilot)

    print('ступень 1  %5d Б -> %5.1f с  (штатный формат ПЗУ, 1575 бод)' % (len(st1), t1))
    print('рантайм 2  %5d Б -> %5.1f с  (турбо)' % (len(rt2), sec(len(rt2))))
    print('заставка   %5d Б -> %5.1f с  (турбо; из %d Б сырых, %.1f%%)'
          % (len(lz), sec(len(lz)), len(planes), 100 * len(lz) / len(planes)))
    print('игра       %5d Б -> %5.1f с  (турбо, пилот 3.0 с на распаковку)'
          % (len(game), sec(len(game), PILOT_GAME)))
    print('-' * 58)
    print('ВСЕГО %.1f с (%d:%02d), %d Б WAV, 44100 Гц 8 бит моно'
          % (len(samples) / sr, len(samples) / sr // 60, len(samples) / sr % 60,
             len(samples) + 44))
    print('картинка появляется на %.1f-й секунде' % (t1 + sec(len(rt2)) + sec(len(lz))))
    print(out)

    build_full(src, game, lz)


# ---------------------------------------------------------------------------
# ВАРИАНТ 2: ЛЕНТА ЦЕЛИКОМ В ШТАТНОМ ФОРМАТЕ (без нашего турбо)
#
# Зачем: чтобы человек мог сам прогнать наши файлы через ЧУЖОЙ конвертер
# (svofski/bin2wav — и его JS-версию, и exe от DDp) и получить WAV.
#
# ПОЧЕМУ ЭТО ТРИ ФАЙЛА, А НЕ ОДИН «.cas». Разведка показала два факта:
#   * общепринятого байтового контейнера «.cas» для ШТАТНОГО формата не
#     существует: .cas у сообщества, у Emu80 и у vector06js — это контейнер
#     БЕЙСИКА (шапка 0xD3 x4 + имя), к ПЗУ-загрузчику отношения не имеющий;
#   * вход всех конвертеров в режиме v06c-rom — СЫРОЙ бинарник, а адрес
#     загрузки задаётся отдельным ключом -s; режима «промодулируй мои уже
#     сформатированные байты» у v06c-rom нет.
# Значит один файл может нести ровно одну непрерывную цепочку страниц с
# одним адресом. Нам нужно три куска по разным адресам — отсюда три файла.
#
# ПОЧЕМУ КУСКОВ ИМЕННО ТРИ, А НЕ ОДИН БОЛЬШОЙ. Сжатая заставка (17832 Б) и
# образ игры (29861 Б) вместе не помещаются в нижнее ОЗУ: под экраном всего
# 0x0100-0x7FFF, то есть 32512 байт. Поэтому заставка живёт в ОЗУ ровно до
# того, как её развернули в экран, а потом её место занимает игра — и это
# обязательно разные куски ленты.
#
# ПРО КАРТУ ПРОГРЕССА ПЗУ (вопрос «не портит ли она грузимый образ»):
#   клетка страницы N лежит по 0xC018 + (N%32)*0x100 + (N/32)*0x18, то есть
#   ВСЕГДА выше 0xC000 — целиком в видеопамяти, в плоскости 2. Образ игры
#   (0x0100-0x75A4) она не задевает ни одним байтом. Зато КАРТИНКУ задевает:
#   для 117-страничного образа это четыре полосы по восемь строк во всю
#   ширину экрана. Поэтому заставку грузит не ПЗУ, а наш разборщик, который
#   карту не рисует; ПЗУ читает только первый кусок, когда на экране всё
#   равно мусор.

FULL_ST1_ORG = 0xDA00     # кусок 1: ступень 1 (его читает ПЗУ по F1)
FULL_RT2_ORG = 0x0700     # кусок 2: страница-жертва, рантайм 2, заставка
FULL_GAME_ORG = 0x0000    # кусок 3: страница-жертва c jp 0x0100, затем игра


def build_full(src, game, lz):
    """Собрать чисто штатный вариант: три сырых бинарника + готовый WAV."""
    rtc = sjasm(os.path.join(src, 'runtime_cas.asm'),
                os.path.join(BUILD, 'runtime_cas.bin'),
                os.path.join(BUILD, 'runtime_cas.lst'))
    if len(rtc) > 246:
        sys.exit('рантайм .cas %d Б, а в страницу 0xDB влезает 246' % len(rtc))
    embed(rtc)
    st1c = sjasm(os.path.join(src, 'stage1_cas.asm'),
                 os.path.join(BUILD, 'stage1_cas.bin'),
                 os.path.join(BUILD, 'stage1_cas.lst'))
    rt2c = sjasm(os.path.join(src, 'runtime2_cas.asm'),
                 os.path.join(BUILD, 'runtime2_cas.bin'),
                 os.path.join(BUILD, 'runtime2_cas.lst'))
    if len(rt2c) != 512:
        sys.exit('рантайм 2 .cas обязан быть ровно 512 Б: заставка начинается '
                 'с 0x0A00, а он %d Б' % len(rt2c))

    # У КАЖДОГО куска первая страница — ЖЕРТВА. ПЗУ и наш разборщик одинаково
    # не успевают к самому началу программы (замерено: первый подблок стабильно
    # пропускается), а между кусками наш код ещё и распаковывает заставку
    # 1.33 с. Страница-жертва стоит 1.9 с ленты и снимает вопрос совсем.
    part2 = b'\xFF' * 256 + rt2c + lz
    part3 = b'\xC3\x00\x01' + b'\x00' * 253 + game

    parts = [('1_boot', FULL_ST1_ORG, st1c, 'KVBOOT'),
             ('2_splash', FULL_RT2_ORG, part2, 'KVSPLASH'),
             ('3_game', FULL_GAME_ORG, part3, 'KVGAME')]

    samples = b''
    print()
    print('--- чисто штатный вариант (для чужого конвертера) ---')
    total_pages = 0
    for name, org, data, tapename in parts:
        fn = os.path.join(BUILD, 'kvalley_full_%s.rom' % name)
        open(fn, 'wb').write(data)
        pages = (len(data) + 255) // 256
        total_pages += pages
        # Первому куску даём длинный ракорд: в эмуляторе лента стартует
        # раньше, чем ПЗУ просыпается. Живой человек жмёт ПУСК сам, поэтому
        # у чужого конвертера хватит и штатных 200 байт.
        lead = LEADER_GROUPS if name == '1_boot' else 8
        stream = tape.v06c_rom(data, org, tapename, leader_groups=lead)
        samples += tape.biphase(stream, ROM_HALFPERIOD)[:-tape.END_PADDING]
        print('  %-9s %6d Б  %3d стр.  -s 0x%04X  -> %s'
              % (name, len(data), pages, org, os.path.basename(fn)))

    samples += bytes([128]) * (tape.TURBO_SAMPLE_RATE // 2)
    out = os.path.join(BUILD, 'kvalley_full.wav')
    open(out, 'wb').write(tape.wav8(samples, tape.TURBO_SAMPLE_RATE))
    sr = tape.TURBO_SAMPLE_RATE
    print('  всего %d страниц, %.0f с (%d:%02d) при 1575 бод'
          % (total_pages, len(samples) / sr, len(samples) / sr // 60,
             len(samples) / sr % 60))
    print('  ' + out)


if __name__ == '__main__':
    main()
