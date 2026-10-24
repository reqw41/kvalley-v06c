#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pack_lz.py — упаковщик заставки кассетной версии King's Valley (32768 Б = 4 плоскости
видеопамяти Вектора-06Ц по 8192 Б, адреса 0x8000/0xA000/0xC000/0xE000).
Пара к распаковщику src/cas/unlz.asm. Формат ОДИН и зафиксирован — это не библиотека.

ПОЧЕМУ НЕ RLE И НЕ ОБЫЧНЫЙ LZSS
  Арт с дизерингом Флойда-Стайнберга: длинных серий нет, RLE раздувает файл. Order-0
  энтропия — 22.9 КБ, то есть без LZ ловить нечего. И без БОЛЬШОГО окна тоже: плоскости
  разнесены на 8192/16384/24576 байт и сильно коррелируют, а окно 4096 обычного LZSS 12/4
  эти ссылки отрезает (замер: окно 4096 -> 22901 Б, окно 32768 -> 21725 Б).

ФОРМАТ "G8"
  Поток БАЙТОВЫЙ с «водохранилищем» бит (приём ZX7/ZX0): распаковщик читает байты подряд,
  а когда нужен бит и буфер пуст — очередной байт потока забирается под биты. Поэтому
  литералы и младшие байты смещений лежат целыми байтами (копируются без сдвигов), и
  сдвигами занят ровно один регистр A.

    бит 0 -> ЛИТЕРАЛ: следом целый байт.
    бит 1 -> МАТЧ:
        gamma(len-1)   длина, len = 2..256          (gamma-значение 1..255)
        gamma(hi+1)    hi = (off-1) >> 8, hi = 0..127 (gamma-значение 1..128)
        байт lo        lo = (off-1) & 255,  off = 1..32768
    КОНЕЦ ПОТОКА: бит 1, затем gamma(65536) в поле длины.

  Порядок полей выбран под регистры i8080, а не «как красивее»: длина уезжает в память
  (ld (lenv),hl) сразу, младший байт смещения читается ПОСЛЕДНИМ — в этот момент поток уже
  можно прятать в стек, а освободившийся D принимает буфер бит. Любой другой порядок
  требует лишнего push/pop или ex (sp),hl.

  gamma — перемежённая гамма Элиаса (как в ZX0), MSB вперёд, значение v >= 1:
    для каждого бита v ниже старшей единицы: [1][бит], в конце [0]; длина 2*floor(log2 v)+1.
    Декодер: hl=1; while bit(): hl = hl*2 + bit();  на i8080 это add hl,hl + inc hl.
  Маркер конца = 65536 именно потому, что переполнение HL взводит перенос от add hl,hl —
  единственная проверка, которая на i8080 БЕСПЛАТНА (регистр A занят буфером бит, а
  сравнить D/B с нулём без A нечем). Цена маркера в потоке — 34 бита, один раз.

  Длина ограничена 256, чтобы счётчик копирования жил в ОДНОМ регистре E: цикл 39 тактов
  на байт вместо 48 с 16-битным счётчиком. По размеру ограничение стоит РОВНО 0 байт
  (замер: cap 256 и без ограничения дают одинаковые 17823 Б).

ПРЕДОБРАЗОВАНИЕ XOR МЕЖДУ ПЛОСКОСТЯМИ
  Плоскости коррелируют не «по-соседски», а по битам цвета. Перебор всех лесов (каждая
  плоскость XOR-ится максимум с одной другой) дал: плоскость1 ^= плоскость3 и
  плоскость2 ^= плоскость0. Готовый файл: 17832 Б против 21731 Б без предобразования,
  то есть −3899 Б за два прохода по 8192 байта (+482647 тактов = +0.16 с при 3 МГц).
  Для ЛЕНТЫ это очевидный размен: байт там стоит порядка 4 мс, такт — 0.33 мкс.
  (в --compare печатаются размеры ЧИСТОГО потока, 17823/21725 Б: там нет ни маркера
  конца в 34 бита, ни пяти байт плана.)
  План проходов лежит В КОНЦЕ сжатого блока парами байт (старший байт приёмника, старший
  байт источника), 0x00 — конец списка. Распаковщик доходит до него тем же указателем.

Применение:
    pack_lz.py --compare [файл]   таблица замеров по схемам (для отчёта)
    pack_lz.py in.raw out.lz      упаковать выбранным форматом G8+XOR
"""
import sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DEFAULT = os.path.join(HERE, "..", "..", "docs", "cas", "v16_planes.raw")

PLANE = 8192                 # размер плоскости
MAXLEN = 256                 # предел длины матча (счётчик в одном регистре)
MAXOFF = 32768               # окно = весь файл
END_GAMMA = 65536            # маркер конца: переполняет HL, перенос от add hl,hl

# План XOR-предобразования: (плоскость-приёмник, плоскость-источник).
# Найден полным перебором лесов, см. --compare.
XOR_PLAN = ((1, 3), (2, 0))


# ---------------------------------------------------------------- поиск матчей

def build_pareto(data, window=MAXOFF, maxlen=MAXLEN, minlen=2):
    """Для каждой позиции — «парето-фронт»: список (макс_длина_на_этом_смещении, смещение),
    длины и смещения растут вместе. Для длины l минимальное смещение — у первого элемента
    с макс_длиной >= l.

    Ищем через bytes.rfind (скорость C): rfind даёт САМОЕ ПРАВОЕ вхождение, то есть как раз
    минимальное смещение. Перекрытие (p+l > i) разрешено — копирование побайтное."""
    n = len(data)
    res = []
    for i in range(n):
        lo = i - window
        if lo < 0:
            lo = 0
        pf = []
        l = minlen
        while True:
            if i + l > n:
                break
            p = data.rfind(data[i:i + l], lo, i + l - 1)
            if p < 0:
                break
            off = i - p
            e = l
            lim = n - i if maxlen is None else min(maxlen, n - i)
            while e < lim and data[p + e] == data[i + e]:
                e += 1
            pf.append((e, off))
            if maxlen is not None and e >= maxlen:
                break
            l = e + 1
        res.append(pf)
    return res


def gamma_bits(v):
    """длина перемежённой гаммы Элиаса в битах, v >= 1"""
    return 2 * (v.bit_length() - 1) + 1


# ---------------------------------------------------------------- разборы

def parse_optimal(data, pareto, lit_cost, match_cost, minlen, maxlen):
    """ОПТИМАЛЬНЫЙ разбор: динамика назад по стоимости в БИТАХ. Жадный разбор на этих
    данных проигрывает 1053 Б (18876 против 17823) — ради этого динамика и написана."""
    n = len(data)
    INF = float("inf")
    cost = [INF] * (n + 1)
    step = [None] * (n + 1)
    cost[n] = 0
    for i in range(n - 1, -1, -1):
        best = lit_cost(data[i]) + cost[i + 1]
        bstep = None
        pf = pareto[i]
        if pf:
            k = 0
            top = pf[-1][0]
            if maxlen is not None and top > maxlen:
                top = maxlen
            for l in range(minlen, top + 1):
                while pf[k][0] < l:
                    k += 1
                mc = match_cost(l, pf[k][1])
                if mc is not None:
                    c = mc + cost[i + l]
                    if c < best:
                        best = c
                        bstep = (l, pf[k][1])
        cost[i] = best
        step[i] = bstep
    out = []
    i = 0
    while i < n:
        s = step[i]
        if s is None:
            out.append(("L", data[i]))
            i += 1
        else:
            out.append(("M", s[0], s[1]))
            i += s[0]
    return out, cost[0]


def parse_greedy(data, pareto, minlen, maxlen, maxoff):
    """ЖАДНЫЙ разбор — самый длинный матч в окне (точка отсчёта для сравнения)."""
    n = len(data)
    out = []
    i = 0
    while i < n:
        bl = bo = 0
        for e, off in pareto[i]:
            if off > maxoff:
                break
            l = e if maxlen is None else min(e, maxlen)
            if l >= minlen and l > bl:
                bl, bo = l, off
        if bl >= minlen:
            out.append(("M", bl, bo))
            i += bl
        else:
            out.append(("L", data[i]))
            i += 1
    return out


# ---------------------------------------------------------------- цены схем (для замера)

def scheme_lzss(maxoff=4096, minlen=3, maxlen=18):
    """(а)/(б) классический LZSS 12/4: флаговый бит, литерал 8 бит, матч 16 бит."""
    return dict(name="LZSS 12/4", minlen=minlen, maxlen=maxlen, maxoff=maxoff,
                lit=lambda b: 9,
                match=lambda l, off: 17 if (off <= maxoff and minlen <= l <= maxlen) else None)


def scheme_zx7():
    """(в) ZX7-подобная: гамма длины, смещение 7 либо 7+4 бита, окно 2048."""
    def m(l, off):
        if off > 2048 or l < 2:
            return None
        return 1 + gamma_bits(l - 1) + (8 if off <= 128 else 12)
    return dict(name="ZX7-подобная", minlen=2, maxlen=None, maxoff=2048,
                lit=lambda b: 9, match=m)


def scheme_g8(maxlen=MAXLEN, maxoff=MAXOFF):
    """G8 — выбранный формат."""
    def m(l, off):
        if off > maxoff or l < 2 or (maxlen is not None and l > maxlen):
            return None
        return 1 + gamma_bits(l - 1) + gamma_bits(((off - 1) >> 8) + 1) + 8
    return dict(name="G8", minlen=2, maxlen=maxlen, maxoff=maxoff,
                lit=lambda b: 9, match=m)


def parse_lz4(data, pareto, maxoff=65535, maxrun=300):
    """(г) LZSS с РАЗДЕЛЬНЫМИ потоками литералов и матчей, байт-ориентированная (LZ4):
    токен = ниббл длины серии литералов + ниббл длины матча, продления по 255, смещение
    2 байта. Флаговых бит нет вообще — за это платим 16 битами смещения ВСЕГДА.
    Динамика двухуровневая: g[j] — лучшая цена матча в позиции j, cost[i] — лучший токен."""
    n = len(data)
    INF = float("inf")

    def ext(v, first):
        v -= first
        return 0 if v < 15 else 8 * ((v - 15) // 255 + 1)

    cost = [INF] * (n + 1)
    g = [INF] * (n + 1)
    # хвост: последний токен — только литералы
    for i in range(n, -1, -1):
        r = n - i
        cost[i] = 8 + ext(r, 0) + 8 * r
    for i in range(n - 1, -1, -1):
        pf = pareto[i]
        bg = INF
        if pf:
            k = 0
            for l in range(4, pf[-1][0] + 1):
                while pf[k][0] < l:
                    k += 1
                if pf[k][1] > maxoff:
                    break
                c = 16 + ext(l, 4) + cost[i + l]
                if c < bg:
                    bg = c
            g[i] = bg
        best = cost[i]          # вариант «дальше только литералы» уже посчитан
        for r in range(0, min(maxrun, n - i) + 1):
            if g[i + r] == INF:
                continue
            c = 8 + ext(r, 0) + 8 * r + g[i + r]
            if c < best:
                best = c
        cost[i] = best
    return cost[0]


# ---------------------------------------------------------------- писатель G8

class Writer:
    """Байтовый поток с «водохранилищем» бит. Байт под биты занимает место в потоке В ТОТ
    МОМЕНТ, когда понадобился первый бит, — ровно так его и читает распаковщик
    (a=0x80 -> первый же add a,a требует подкачки)."""
    def __init__(self):
        self.out = bytearray()
        self.mask = 0
        self.res = 0

    def bit(self, v):
        if self.mask == 0:
            self.res = len(self.out)
            self.out.append(0)
            self.mask = 0x80
        if v:
            self.out[self.res] |= self.mask
        self.mask >>= 1

    def byte(self, b):
        self.out.append(b & 0xFF)

    def gamma(self, v):
        assert v >= 1
        for c in bin(v)[3:]:            # двоичная запись без старшей единицы
            self.bit(1)
            self.bit(c == "1")
        self.bit(0)


def emit_g8(items, plan=()):
    w = Writer()
    # ПЕРВЫЙ элемент всегда литерал (в позиции 0 матч невозможен — истории нет), и
    # флаговый бит для него НЕ пишется. Это нужно не ради бита: так тело литерала в
    # распаковщике ПАДАЕТ в главный цикл, а не прыгает в него (−10 тактов на литерал).
    assert items[0][0] == "L"
    w.byte(items[0][1])
    for it in items[1:]:
        if it[0] == "L":
            w.bit(0)
            w.byte(it[1])
        else:
            _, l, off = it
            assert 2 <= l <= MAXLEN and 1 <= off <= MAXOFF
            w.bit(1)
            w.gamma(l - 1)
            w.gamma(((off - 1) >> 8) + 1)
            w.byte((off - 1) & 0xFF)
    w.bit(1)                            # маркер конца — «матч» с переполняющей длиной
    w.gamma(END_GAMMA)
    for dst, src in plan:               # план XOR-проходов, сразу за потоком
        w.byte(0x80 + dst * 0x20)
        w.byte(0x80 + src * 0x20)
    w.byte(0x00)
    return bytes(w.out)


# ---------------------------------------------------------------- предобразование

def xor_apply(data, plan):
    """plan = ((приёмник, источник), ...); источники берутся из ИСХОДНЫХ плоскостей."""
    out = bytearray(data)
    for dst, src in plan:
        for i in range(PLANE):
            out[dst * PLANE + i] ^= data[src * PLANE + i]
    return bytes(out)


def pack(data, plan=XOR_PLAN):
    """Полный конвейер: XOR-предобразование -> оптимальный разбор -> поток G8 + план."""
    tr = xor_apply(data, plan)
    pf = build_pareto(tr)
    s = scheme_g8()
    items, bits = parse_optimal(tr, pf, s["lit"], s["match"], 2, MAXLEN)
    return emit_g8(items, plan), items


def unpack(blob, size=4 * PLANE):
    """Эталонный распаковщик на Python — им гейт сверяет ещё и сам ПОТОК (до эмулятора).
    Одновременно это исполняемое описание формата."""
    out = bytearray()
    pos = 0
    # точная модель регистра A распаковщика: старший бит уходит в перенос,
    # обнулившийся A => подкачка очередного байта потока под биты
    a = 0x80

    def getbit():
        nonlocal a, pos
        a <<= 1
        cf = (a >> 8) & 1
        a &= 0xFF
        if a == 0:
            b = blob[pos]
            pos += 1
            a = ((b << 1) | cf) & 0xFF
            cf = (b >> 7) & 1
        return cf

    def getgamma():
        v = 1
        while getbit():
            v = v * 2 + getbit()
            if v > 0xFFFF:
                return None          # маркер конца
        return v

    out.append(blob[pos])               # первый элемент — литерал без флагового бита
    pos += 1
    while True:
        if getbit() == 0:
            out.append(blob[pos])
            pos += 1
            continue
        ln = getgamma()
        if ln is None:
            break
        ln += 1
        hi = getgamma() - 1
        lo = blob[pos]
        pos += 1
        off = (hi << 8) + lo + 1
        p = len(out) - off
        if p < 0:
            raise ValueError("смещение за начало выхода")
        for _ in range(ln):
            out.append(out[p])
            p += 1
    plan = []
    while blob[pos]:
        plan.append((blob[pos], blob[pos + 1]))
        pos += 2
    pos += 1
    if len(out) != size:
        raise ValueError("распаковано %d Б, ждали %d" % (len(out), size))
    for dsthi, srchi in plan:          # обратное XOR-предобразование
        d = (dsthi - 0x80) * 256
        s = (srchi - 0x80) * 256
        for i in range(PLANE):
            out[d + i] ^= out[s + i]
    return bytes(out), pos


# ---------------------------------------------------------------- замеры

def stats(items):
    lit = sum(1 for it in items if it[0] == "L")
    return lit, len(items) - lit, sum(it[1] for it in items if it[0] == "M")


def compare(data):
    import zlib
    print("вход: %d Б, ориентир zlib -9: %d Б" % (len(data), len(zlib.compress(data, 9))))
    print()
    pf_small = build_pareto(data, 4096, 18, 3)
    pf_zx7 = build_pareto(data, 2048, None, 2)
    pf_full = build_pareto(data, MAXOFF, MAXLEN, 2)
    rows = []

    s = scheme_lzss()
    it = parse_greedy(data, pf_small, 3, 18, 4096)
    b = sum(s["lit"](0) if x[0] == "L" else s["match"](x[1], x[2]) for x in it)
    rows.append(("(а) LZSS 12/4, жадный", (b + 7) // 8, stats(it)))
    it, b = parse_optimal(data, pf_small, s["lit"], s["match"], 3, 18)
    rows.append(("(б) LZSS 12/4, оптимальный", (b + 7) // 8, stats(it)))

    s = scheme_zx7()
    it, b = parse_optimal(data, pf_zx7, s["lit"], s["match"], 2, None)
    rows.append(("(в) ZX7-подобная, окно 2048", (b + 7) // 8, stats(it)))

    b = parse_lz4(data, build_pareto(data, 65535, None, 4))
    rows.append(("(г) LZ4: раздельные потоки, байтовая", (b + 7) // 8, None))

    s = scheme_g8()
    it = parse_greedy(data, pf_full, 2, MAXLEN, MAXOFF)
    b = sum(s["lit"](0) if x[0] == "L" else s["match"](x[1], x[2]) for x in it)
    rows.append(("(д) G8, жадный", (b + 7) // 8, stats(it)))
    it, b = parse_optimal(data, pf_full, s["lit"], s["match"], 2, MAXLEN)
    rows.append(("(д) G8, оптимальный", (b + 7) // 8, stats(it)))

    tr = xor_apply(data, XOR_PLAN)
    it, b = parse_optimal(tr, build_pareto(tr), s["lit"], s["match"], 2, MAXLEN)
    rows.append(("(е) G8 + XOR-предобразование  <= ВЫБРАНО", (b + 7) // 8, stats(it)))
    print("zlib -9 поверх того же XOR-предобразования: %d Б" %
          len(zlib.compress(tr, 9)))
    print()
    print("%-40s %7s %7s %7s %8s" % ("схема", "размер", "лит.", "матчей", "в матчах"))
    for name, n, st in rows:
        if st:
            print("%-40s %7d %7d %7d %8d" % (name, n, st[0], st[1], st[2]))
        else:
            print("%-40s %7d %7s %7s %8s" % (name, n, "-", "-", "-"))
    print()
    print("--- перебор лесов XOR-предобразования (G8, оптимальный разбор) ---")
    res = []
    for p1 in (None, 0, 2, 3):
        for p2 in (None, 0, 1, 3):
            for p3 in (None, 0, 1, 2):
                par = {1: p1, 2: p2, 3: p3}
                plan = [(k, v) for k, v in par.items() if v is not None]
                if any(par.get(v) is not None for _, v in plan):
                    continue          # источник сам преобразуется — не рассматриваем
                tr = xor_apply(data, plan)
                it, b = parse_optimal(tr, build_pareto(tr), s["lit"], s["match"], 2, MAXLEN)
                res.append(((b + 7) // 8, len(plan), plan))
    res.sort()
    for n, np_, plan in res[:8]:
        print("%7d  проходов %d  %s" % (n, np_, plan or "нет"))


def main():
    args = sys.argv[1:]
    if args and args[0] == "--compare":
        compare(open(args[1] if len(args) > 1 else RAW_DEFAULT, "rb").read())
        return 0
    if len(args) != 2:
        print(__doc__)
        return 2
    data = open(args[0], "rb").read()
    blob, items = pack(data)
    back, used = unpack(blob)
    if back != data:
        raise SystemExit("САМОПРОВЕРКА: эталонная распаковка не совпала с входом")
    if used != len(blob):
        raise SystemExit("САМОПРОВЕРКА: прочитано %d из %d байт блока" % (used, len(blob)))
    open(args[1], "wb").write(blob)
    lit, mt, mb = stats(items)
    print("%s: %d Б -> %d Б (%.1f%%); литералов %d, матчей %d, байт в матчах %d" %
          (args[1], len(data), len(blob), 100.0 * len(blob) / len(data), lit, mt, mb))
    return 0


if __name__ == "__main__":
    sys.exit(main())
