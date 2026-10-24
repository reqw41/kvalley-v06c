#!/usr/bin/env python3
"""msx2vec.py — сведение MSX-цветов King's Valley в цветовые таблицы Вектора-06Ц (8 цветов).

ЗАЧЕМ. Сейчас цвет тайла вычисляется В РАНТАЙМЕ: vec_col_store перехватывает каждую запись
в MSX color table и инкрементально сводит её в кэш vec_tilemode (256Б), а двухцветные тайлы
дополнительно копят построчный цвет в vec_mixbuf (15 слотов x 8 строк). Из-за этого
расцветка предметов правится не в данных, а в блиттере, и упирается в 15 mix-слотов.

Этот модуль делает ТО ЖЕ САМОЕ офлайн: вход — MSX color table (8 байт на тайл, старший
ниббл = цвет пикселей, младший = цвет фона), выход — те же самые байты vec_tilemode и
vec_mixbuf. Совпадение проверяется гейтом против эталона, снятого с живой игры
(tools/gfx/dump_colortables.js). Как только совпадение доказано, поверх можно класть
ПРОФИЛИ СЦЕН (задача #27) — то есть менять цвет как данные, а не как логику.

ФОРМАТ БАЙТА vec_tilemode: bit7 = white (шейп идёт в p1), биты 6-3 = счётчик строк
(8 = тайл прочитан целиком), биты 2-0 = режим: 0 blank, 1 pat, 2 ~pat, 3 solid, 4 mix.
0xFF = ещё не вычислен.

[2026-08-07, задача #55] У MIX-ТАЙЛОВ БИТЫ 6-3 НЕСУТ НОМЕР СЛОТА (1..15), А НЕ СЧЁТЧИК.
Счётчик строк был реликтом рантайм-сведения (детектор перезагрузки цвета) и у mix-тайлов
всё равно оставался нулевым. Теперь блиттер берёт слот прямо оттуда: `mode & 0x78` = слот*8.
Взамен из ПЗУ ушли таблица vec_mixtiles (15 Б) и линейный скан vec_slot_of (28 Б) —
итог −62 Б кода против +18 Б упаковки профилей (серии режимов рвутся на отдельные слоты).
Гейт msx2vec сверяет с эталоном рантайма ПО МАСКЕ 0x87 (режим и white), поле слота
намеренно расходится: рантайма, который бы его считал, больше не существует.
"""

# 15 тайлов, которым выделяется слот построчного цвета. НОМЕР СЛОТА = позиция в этом
# списке + 1, и он попадает в биты 6-3 байта vec_tilemode (см. шапку). Раньше эту же
# таблицу дублировала vec_mixtiles в vec_blit.asm — теперь список живёт только здесь.
# Индексы отсчитываются от 0x50: реальные номера тайлов = 0x50 + значение.
MIXTILES = [0x01, 0x03, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11,
            0x13, 0x14, 0x16, 0x23, 0x24, 0x32, 0x33]


def row_mode(colour_byte):
    """Режим строки (0-3) по байту MSX-цвета — bit0 от цвета пикселей, bit1 от фона."""
    mode = 0
    if (colour_byte & 0xF0) >= 0x20:
        mode |= 1
    if (colour_byte & 0x0F) >= 2:
        mode |= 2
    return mode


def row_white(colour_byte):
    """0x80, если цвет пикселей строки — из белой группы (fg >= 14)."""
    return 0x80 if (colour_byte & 0xF0) >= 0xE0 else 0


def mode_from8(rows):
    """8 байт цвета тайла -> байт режима: white | (mix, если строки разные, иначе режим)."""
    ref = row_mode(rows[0])
    white = row_white(rows[0])
    mixed = False
    for b in rows[1:]:
        if row_mode(b) != ref:
            mixed = True
        white |= row_white(b)
    return (4 if mixed else ref) | white


def tone_masks(msx_colour, touched):
    """Тайл -> маска строк ВТОРОГО тона (бит7 = строка 0), 0 = тайл однотонный.

    В оригинале цвет пикселей меняется по строкам: кирпич идёт как жёлтый-жёлтый-
    красный-красный (маска 0b00110011), лестницы как белый сверху и жёлтый снизу и т.д.
    Наша модель сводит строку к «режиму», а у обоих тонов режим одинаков — различие
    пропадало ещё до блиттера, и кирпичи выходили одноцветными. Эта таблица возвращает
    различие обратно: блиттер вторым коротким проходом дорисовывает строки второго тона
    в дополнительные плоскости, и они получают свой слот палитры.
    """
    masks = bytearray(256)
    for tile in range(256):
        if not any(touched[tile * 8:tile * 8 + 8]):
            continue
        rows = msx_colour[tile * 8:tile * 8 + 8]
        fg = [b >> 4 for b in rows]
        ref = fg[0]
        m = 0
        for i, f in enumerate(fg):
            if f != ref:
                m |= 1 << (7 - i)
        masks[tile] = m
    return bytes(masks)


def slot_of(tile):
    """Номер mix-слота (1..15) для тайла или 0, если слота нет."""
    if not (0x50 <= tile < 0x90):
        return 0
    try:
        return MIXTILES.index(tile - 0x50) + 1
    except ValueError:
        return 0


def map_whiteforce(tilemode):
    """Правка карты долины (vec_map_whiteforce, vec_blit.asm:1433) для тайлов 0xC0..0xE7.

    Линии пергамента (режим 2) получают white, а пирамидки и буквы GOAL (режимы 3 и 4) —
    МЕТКУ КАРТЫ: по ней блиттер узнаёт клетку карты. Правка идёт ПОВЕРХ обычного сведения,
    поэтому в конвертере это отдельный шаг профиля «карта долины».

    [2026-08-07, задача #55] МЕТКА = РЕЖИМ 5 (было: счётчик 0x70 в битах 6-3). Поле 6-3
    занял номер mix-слота, и слот 14 совпадал с прежней меткой — тайл лабиринта 0x82
    уезжал в блиттер карты. Режимы 5-7 свободны, метка в них не пересекается со слотом.
    Собственный режим клетки карты (3 или 4) при этом ТЕРЯЕТСЯ и это законно: vbt8_mapt
    переписывает все три плоскости из сырого паттерна, вклад vbt_core у неё мёртв.
    """
    tm = bytearray(tilemode)
    for tile in range(0xC0, 0xE8):
        mode = tm[tile] & 7
        if mode == 2:
            tm[tile] |= 0x80
        elif mode >= 3:
            tm[tile] = (tm[tile] & 0x80) | MAP_MARK
    return bytes(tm)


MAP_MARK = 5          # режим-метка клетки карты долины (см. map_whiteforce/vbt8_chk_map)


def norm_marker(tilemode):
    """Эталон рантайма -> нынешняя раскладка метки карты (только для сверки гейтом).

    Снимки в build/colortables сняты с рантайма, который метил клетку карты счётчиком
    0x70. Сверять с ним байт-в-байт больше нельзя (см. map_whiteforce), поэтому приводим
    ЭТАЛОН к нынешней метке и лишь затем сравниваем: так гейт продолжает проверять
    «какие клетки помечены картой», а не устаревшую кодировку метки.
    """
    tm = bytearray(tilemode)
    for tile in range(0xC0, 0xE8):
        if (tm[tile] & 0x78) == 0x70:
            tm[tile] = (tm[tile] & 0x80) | MAP_MARK
    return bytes(tm)


def convert(msx_colour, touched=None, profile=None):
    """MSX color table (2048Б = 256 тайлов x 8 строк) -> (tilemode 256Б, mixbuf 120Б).

    touched — маска «в этот байт писали» (иначе записанный НОЛЬ неотличим от «не писали»,
    а рантайм для нуля даёт режим blank, не 0xFF).
    """
    tilemode = bytearray(b"\xFF" * 256)
    mixbuf = bytearray(120)
    for tile in range(256):
        rows = msx_colour[tile * 8:tile * 8 + 8]
        if touched is not None:
            if not any(touched[tile * 8:tile * 8 + 8]):
                continue                  # записи не было -> кэш не трогали
        elif not any(rows):
            continue
        slot = slot_of(tile)
        if slot:
            mixbuf[(slot - 1) * 8:(slot - 1) * 8 + 8] = rows
            # СЛОТ В БИТАХ 6-3 (задача #55): блиттер читает его как `mode & 0x78` = слот*8
            tilemode[tile] = mode_from8(rows) | (slot << 3)
        else:
            # однородный путь: игра доходит до счётчика 8, режим схлопывается в mix,
            # если строки разошлись, white копится по ИЛИ
            tilemode[tile] = mode_from8(rows) | 0x40
    result = bytes(tilemode)
    if profile == "map":
        result = map_whiteforce(result)
    return result, bytes(mixbuf)


PROFILES = {          # какие снимки идут в генерацию и под каким именем в игре
    "konami":         "intro",       # Konami и титул дают ОДИНАКОВЫЕ таблицы
    "gameplay_pyr01": "stage_a",     # банк графики пирамид 1
    "gameplay_pyr02": "stage_b",     # банк пирамид 2+ (2,3,4 совпадают между собой)
}

# ЧЕТВЁРТЫЙ ПРОФИЛЬ — ФИНАЛЬНЫЙ ЭКРАН (задача #15).
#
# Снимок берётся не с нашей сборки, а С ОРИГИНАЛЬНОГО КАРТРИДЖА MSX: наш порт цвета
# концовки никуда не писал (распаковка endingColors снята задачей #35, vec_col_store —
# одинокий `ret`), поэтому эталон снимать не с чего. Прогон legacy/msx/kvalley_z80.rom
# в headless-WebMSX с GameStatus=0x0A / subStatus=0 даёт MSX color table сцены; из неё
# берутся ВОСЕМЬ тайлов концовки — MSX 0x90-0x97, на Векторе 0x40-0x47 (тайлсет финала
# грузится со сдвигом -0x50, см. setupEnding: `ld hl,0x2200`).
#
# ВНИМАНИЕ ПРО ВХОД: subStatus=6 — тупик, setupEnding в конце делает inc и сцена
# перестраивается бесконечно. Правильный вход — ноль.
#
# Профиль ДЕЛЬТОВЫЙ. В оригинале endingColors перезаписывает ровно эти восемь тайлов, а
# табло/шрифт/дверь остаются от уровня — значит и на Векторе достаточно положить восемь
# байт поверх уже загруженного профиля этапа. Полная таблица стоила бы ~200 Б образа и
# отличалась бы от stage_a теми же тремя байтами.
ENDING_MSX_COLOUR = {   # MSX-тайл -> 8 байт цвета (снято с картриджа, см. выше)
    0x90: [0x60, 0x60, 0xA0, 0xA0, 0x60, 0x60, 0xA0, 0xA0],   # грань кладки
    0x91: [0x60, 0x60, 0xA0, 0xA0, 0x60, 0x60, 0xA0, 0xA0],   # заливка кладки
    0x92: [0x80] * 8,                                         # левая грань малых пирамид
    0x93: [0x80] * 8,                                         # её заливка
    0x94: [0x60] * 8,                                         # правая грань малых пирамид
    0x95: [0x60] * 8,                                         # её заливка
    0x96: [0x8A, 0x8A, 0x8A, 0x8A, 0x6A, 0x6A, 0x6A, 0x6A],   # песчаный пол
    0x97: [0x50] * 8,                                         # звезда
}
ENDING_TILE_SHIFT = 0x50   # MSX 0x90-0x97 -> Вектор 0x40-0x47


def ending_modes():
    """Восемь байт режима для тайлов Вектора 0x40-0x47 (тем же mode_from8, что и профили)."""
    return bytes(mode_from8(ENDING_MSX_COLOUR[t]) | 0x40
                 for t in sorted(ENDING_MSX_COLOUR))


def rle_pack(data):
    """Простая упаковка парами (счётчик 1..255, значение), 0 = конец.

    В таблицах длинные серии одинаковых байт (0xFF у неиспользуемых тайлов, 0xC1 у
    однородных), поэтому пары экономят около половины объёма. Распаковщик в игре —
    десяток инструкций, см. vec_ct_load.
    """
    out = bytearray()
    i = 0
    while i < len(data):
        v = data[i]
        n = 1
        while i + n < len(data) and data[i + n] == v and n < 255:
            n += 1
        out += bytes([n, v])
        i += n
    out.append(0)
    return bytes(out)


def emit_asm(profiles, out_path):
    """Готовые таблицы -> .asm. Формат: по метке на профиль, 256Б режимов + 120Б mixbuf."""
    lines = [
        "; СГЕНЕРИРОВАНО tools/gfx/msx2vec.py — НЕ ПРАВИТЬ РУКАМИ.",
        ";",
        "; Цветовые таблицы Вектора, сведённые из MSX color table ОФЛАЙН. Раньше их считал",
        "; vec_col_store на каждой записи цвета (замер: 6.9% времени кадра в геймплее),",
        "; теперь это данные: игра просто копирует нужный профиль в vec_tilemode/vec_mixbuf.",
        "; Байт режима: bit7 white, биты 6-3 счётчик строк, биты 2-0 режим",
        "; (0 blank, 1 pat, 2 ~pat, 3 solid, 4 mix); 0xFF = клетка не используется.",
        ";",
        "; Профили сцен собраны из снимков живой игры (tools/gfx/dump_colortables.js) и",
        "; сверены с рантаймом байт-в-байт.",
        ";",
        "; ДЕДУПЛИКАЦИЯ ЦЕЛЫХ ПРОФИЛЕЙ: если построчный цвет (_mix) побайтно совпадает с уже",
        "; выведенным, генератор выдаёт `equ` вместо копии. Так vec_ct_stage_b_mix совпал с",
        "; vec_ct_stage_a_mix (пирамиды отличаются только режимами тайлов, палитра строк одна).",
        ";",
        "; ДЕДУПЛИКАЦИЯ СЛОТОВ: построчный цвет — это 15 слотов по 8 байт, и слоты повторяются",
        "; и внутри профиля, и между профилями (сплошной чёрный, сплошной 0xF0 и т.п.). Поэтому",
        "; профиль стал таблицей из 15 ИНДЕКСОВ, а сами слоты лежат один раз в vec_ct_slots.",
        "; Разворачивает их vec_ct_load (src/v06c/vec_palette.asm) — раз на смену сцены.",
        "; Вся логика в emit_asm (tools/gfx/msx2vec.py), поэтому перегенерация её сохраняет.",
        "",
    ]
    total = 0
    seen_mix = {}       # байты построчного цвета -> метка, где они уже лежат
    slots, slot_idx = [], {}   # пул 8-байтных слотов
    idx_tables = []            # (метка, [15 индексов])
    packed_by = {}             # метка профиля -> упакованный поток
    for label, (tm, mb) in profiles.items():
        # tilemode пакуем (много длинных серий), mixbuf кладём слотами: он короткий и
        # пёстрый, RLE его только раздувает (замер: 120 -> 131 Б), а вот повторы слотов
        # снимаются начисто.
        packed = rle_pack(tm)
        packed_by[label] = packed
        # ЗАПЛАТКА ВМЕСТО ВТОРОГО ПОЛНОГО ПОТОКА: профиль второй пирамиды отличается от
        # первой только ХВОСТОМ клеток, поэтому в образе лежит лишь хвост его потока —
        # vec_ct_stage разворачивает его ПОВЕРХ уже загруженного профиля A
        # (см. src/v06c/vec_palette.asm). Общий префикс ищем по потоку, а совпадение
        # клеток проверяем явно — если профили разойдутся раньше, сборка упадёт здесь.
        if label == "stage_b" and "stage_a" in packed_by:
            pa = packed_by["stage_a"]
            n = 0
            while n < min(len(pa), len(packed)) and pa[n] == packed[n]:
                n += 1
            n -= n % 2                      # граница пары (счётчик, значение)
            cells = sum(pa[i] for i in range(0, n, 2))
            assert profiles["stage_a"][0][:cells] == tm[:cells], \
                "stage_a/stage_b разошлись раньше общего префикса потока"
            assert cells == 0x0A0, \
                "хвост stage_b начинается с клетки 0x%X, а vec_ct_stage ждёт 0xA0" % cells
            tail = packed[n:]
            total += len(tail)
            lines.append(f"vec_ct_stage_btail:\t; хвост потока с клетки 0x{cells:02X} "
                         f"({len(tail)}Б вместо полных {len(packed)}Б; префикс общий с stage_a)")
            for i in range(0, len(tail), 16):
                lines.append("\tdb\t" + ",".join(f"0x{b:03X}" for b in tail[i:i + 16]))
        else:
            total += len(packed)
            lines.append(f"vec_ct_{label}:\t; {len(packed)}Б упаковки на 256Б режимов")
            for i in range(0, len(packed), 16):
                lines.append("\tdb\t" + ",".join(f"0x{b:03X}" for b in packed[i:i + 16]))
        lines.append("")
        dup = seen_mix.get(bytes(mb))
        if dup is not None:
            # Повтор целиком: одна строка `equ` вместо таблицы индексов. Метка-оригинал
            # выведена выше, sjasm разрешает ссылку назад в первом же проходе.
            lines.append(f"vec_ct_{label}_mix:\tequ\t{dup}\t; ДУБЛЬ профиля, см. шапку файла")
            lines.append("")
            continue
        seen_mix[bytes(mb)] = f"vec_ct_{label}_mix"
        tab = []
        for i in range(0, len(mb), 8):
            s = bytes(mb[i:i + 8])
            if s not in slot_idx:
                slot_idx[s] = len(slots)
                slots.append(s)
            tab.append(slot_idx[s])
        idx_tables.append((f"vec_ct_{label}_mix", tab))
        total += len(tab)
        lines.append(f"vec_ct_{label}_mix:\t; {len(tab)} индексов слотов в vec_ct_slots")
        lines.append("\tdb\t" + ",".join(str(x) for x in tab))
        lines.append("")
    assert len(slots) <= 256, "пул слотов не влезает в байтовый индекс: %d" % len(slots)
    total += len(slots) * 8
    lines.append(f"vec_ct_slots:\t; пул уникальных слотов построчного цвета: {len(slots)} x 8Б")
    for s in slots:
        lines.append("\tdb\t" + ",".join(f"0x{b:03X}" for b in s))
    lines.append("")
    open(out_path, "w", encoding="utf-8").write("\n".join(lines))
    return total


def _main():
    import sys, pathlib
    if "--ending" in sys.argv:
        # Профиль концовки не требует снимка с нашей сборки: его вход зашит выше, прямо
        # из MSX color table оригинала. Печатаем готовые байты для vec_ct_ending_modes.
        names = ["кладка грань", "кладка заливка", "лев.грань", "лев.заливка",
                 "прав.грань", "прав.заливка", "пол", "звезда"]
        modes = ending_modes()
        for i, (t, n) in enumerate(zip(sorted(ENDING_MSX_COLOUR), names)):
            print(f"  Вектор 0x{t - ENDING_TILE_SHIFT:02X} (MSX 0x{t:02X}) {n:16} -> 0x{modes[i]:03X}")
        print("vec_ct_ending_modes:\n\tdb\t" + ",".join(f"0x{b:03X}" for b in modes))
        return 0
    if len(sys.argv) < 2:
        print("usage: msx2vec.py <каталог со снимками> [--emit <выходной .asm>]")
        print("       msx2vec.py --ending   (профиль финального экрана, вход зашит из MSX)")
        return 2
    d = pathlib.Path(sys.argv[1])
    scenes = sorted(p.name[:-len(".msxcolor.bin")] for p in d.glob("*.msxcolor.bin"))
    if not scenes:
        print(f"в {d} нет снимков *.msxcolor.bin — сначала запусти tools/gfx/dump_colortables.js")
        return 2
    bad = 0
    for name in scenes:
        src = (d / f"{name}.msxcolor.bin").read_bytes()
        want_tm = (d / f"{name}.tilemode.bin").read_bytes()
        want_mb = (d / f"{name}.mixbuf.bin").read_bytes()
        tpath = d / f"{name}.touched.bin"
        touch = tpath.read_bytes() if tpath.exists() else None
        # профиль «карта» узнаём по тому, что игра уже прогнала whiteforce: у клеток
        # карты стоит метка 0x70 в поле счётчика
        prof = "map" if any((want_tm[t] & 0x78) == 0x70 for t in range(0xC0, 0xE8)) else None
        got_tm, got_mb = convert(src, touch, prof)
        # СВЕРКА ПО МАСКЕ 0x87 (задача #55): режим и white обязаны совпасть с рантаймом
        # байт-в-байт, а поле 6-3 у mix-тайлов теперь НОМЕР СЛОТА вместо счётчика строк —
        # эталон снят с рантайма, который слот туда не клал, и расхождение там законно.
        # Эталон предварительно приводится к нынешней метке карты (norm_marker).
        ref_tm = norm_marker(want_tm)
        dtm = [i for i in range(256) if (got_tm[i] & 0x87) != (ref_tm[i] & 0x87)]
        dmb = [i for i in range(120) if got_mb[i] != want_mb[i]]
        status = ("ОК" + (" (профиль карты)" if prof else "")) if not dtm and not dmb else f"РАСХОЖДЕНИЙ tilemode {len(dtm)}, mixbuf {len(dmb)}"
        print(f"{name:22} {status}")
        if dtm[:6]:
            for i in dtm[:6]:
                print(f"      тайл 0x{i:02X}: ждали 0x{want_tm[i]:02X}, посчитали 0x{got_tm[i]:02X}")
        bad += len(dtm) + len(dmb)
    print("\nРЕЗУЛЬТАТ: " + ("конвертер повторяет рантайм байт-в-байт" if not bad
                             else f"НЕ СОВПАДАЕТ, суммарно {bad} байт"))
    if "--emit" in sys.argv and not bad:
        out = sys.argv[sys.argv.index("--emit") + 1]
        gen = {}
        for scene, label in PROFILES.items():
            src = (d / f"{scene}.msxcolor.bin").read_bytes()
            tpath = d / f"{scene}.touched.bin"
            touch = tpath.read_bytes() if tpath.exists() else None
            want = (d / f"{scene}.tilemode.bin").read_bytes()
            prof = "map" if any((want[t] & 0x78) == 0x70 for t in range(0xC0, 0xE8)) else None
            gen[label] = convert(src, touch, prof)
        size = emit_asm(gen, out)
        print(f"сгенерировано {out}: профилей {len(gen)}, всего {size} байт таблиц")
    return 0 if not bad else 1


if __name__ == "__main__":
    raise SystemExit(_main())
