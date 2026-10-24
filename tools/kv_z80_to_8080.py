#!/usr/bin/env python3
"""
kv_z80_to_8080.py — SOURCE-LEVEL Z80 -> i8080 translation of the annotated
King's Valley disassembly (kvalley.asm, Sjasm syntax).

Replaces every Z80-only instruction with an i8080-equivalent sequence in the SAME
Sjasm/Z80 syntax. Labels, equ, db/dw, MAP fields and the i8080 instruction subset
pass through unchanged, so Sjasm handles ALL relocation/symbols. The assembled ROM
then contains ONLY i8080 opcodes (i8080 is a subset of Z80), so it runs on the MSX
Z80 (openMSX) AND on a vanilla i8080 Vector.

Shadow registers (IX/IY/AF'/BC'/DE'/HL') live in fixed RAM cells appended to the
game's work-RAM MAP block. Operands are symbolic (e.g. (ix+ACTOR_Y)); the assembler
computes displacements, so no address arithmetic here.

Usage: python3 tools/kv_z80_to_8080.py <in.asm> <out.asm>
"""
import sys
import re
import os as _os_pv
# Палитра Вектора защёлкивается по ЦВЕТУ, выводимому в момент out(0Ch) (RTL ядра MiSTer
# video.sv: palette[color_idx]<=din). => полную палитру (смена экрана) писать ТОЛЬКО в
# VBlank-ISR, а не mid-frame из setupStage/setupPergamino. KV_NO_PALVBL=1 -> старое поведение.
# PALVBL ОТКАЧЕН (по умолчанию OFF): отложенная палитра (vec_pal_pending) внесла латентный баг
# (pending 0x6C28 в зоне заливки sprAttrib -> hideSprAttrib затирал в 0xE1) И не применялась под DI
# в переходах (setupPergamino). Реально палитру на железе чинит MODE256 (PB=выход), не PALVBL. Синхронный
# путь (vec_setpal_a/_menu прямо в setupStage/Pergamino) применяет вовремя. KV_PALVBL=1 -> вернуть.
_PALVBL = bool(_os_pv.environ.get('KV_PALVBL'))
# ДИАГНОСТ: KV_NO_BRILLO=1 отключает покадровый крутёж idx4 (блеск гемов) — тест на MiSTer,
# виноват ли per-frame палитра-write блеска в мерцании (out 02h,4 -> протечка в активный кадр).
_BRILLO = not _os_pv.environ.get('KV_NO_BRILLO')
# ФИКС ПОЛОС (mode512): держать 8255 PB=ВЫХОД (mode512=0 driven на видимой части кадра), а вход
# ставить лишь на миг чтения клавы в VBlank (модель Tank Battalion). KV_NO_MODE256=1 -> старое (PB
# вечно вход -> mode512 всплывает в 1 -> вертикальные полосы на реальном железе).
_MODE256 = not _os_pv.environ.get('KV_NO_MODE256')
# Пакет 2 ЦВЕТА (2026-07-20): idx8 синий->ЗОЛОТО (0x77), кирпичи 0x40-0x44 двухцветные
# по строкам (per-row p1: idx8 золото / idx12 белый по маске ColoresPiedra scheme0), нож
# (спрайт-слоты 15-18) БЕЛЫЙ через dual-plane (p2+p3 -> idx15=0xFF). KV_NO_COLOR2=1 -> откат
# к base (синий idx8, однобитный white-флаг кирпича, одноплоскостной нож). Изоляция байт-в-байт.
_COLOR2 = not _os_pv.environ.get('KV_NO_COLOR2')
# ФИКС ЗАВИСАНИЯ МУЗЫКИ при рендере комнаты (2026-07-20): и вход в комнату (vec_nat_room,
# GS=4/5, весь цикл 704 тайла под ОДНИМ di) и скролл (drawRoom, GS=9, ~704 тайла внутри
# одного tickMain-тика) держат прерывания ВЫКЛ на весь рендер -> нет вложенных VBlank ->
# updateSound не тикает ~25 кадров -> ВИ53-регистры замирают, музыка зависает. ФИКС A
# (кооп-тик): в ПОСТРОЧНЫЙ цикл рендера вставлен тик звука БЕЗ ei (как vec_isr_nested:
# сохранить vec_sndb / call updateSound / call vec_flushvi / восстановить vec_sndb),
# ~22 тика/комнату. KV_NO_COOPSND=1 -> откат к base (изоляция байт-в-байт).
_COOPSND = not _os_pv.environ.get('KV_NO_COOPSND')
# ФИКС ПОЛОСЫ КАРТЫ (2026-07-20): паттерны карты пирамид (pergamino «PYRAMID'S MAP», тайлы
# 0xC0-0xE7, gfxMap -> VDP 0x2600) раньше распаковывались в vec_pat_shadow @0xC900 = ВИДИМАЯ
# плоскость p2 (folded 0x600-0x73F -> pb_p2), давая паразитную серую полосу в центре карты И
# занимая ~320Б p2. ФИКС: pat_base роутит folded 0x600-0x73F в НЕВИДИМЫЙ low-RAM (переиспольз.
# буфер pat_maze_cell, свободен во время карты — лабиринт не показан) вместо p2. Блит читает
# паттерн ОТТУДА -> тот же p0/p1, но p2 shadow чист. Номера тайлов НЕ ремапятся (0xC0-0xE7 вне
# brick 0x40-0x44 / brillo 0x51-0x53 / mix-слотов => vbt_core рисует их как обычные тайлы).
# В геймплее folded 0x600-0x73F не пишется/не читается (тайлы 0xC0-0xE7 = только карта) =>
# ветка неактивна, рендер байт-идентичен. KV_NO_MAPDIRECT=1 -> откат (сборка == base_canon).
_MAPDIRECT = not _os_pv.environ.get('KV_NO_MAPDIRECT')
# ПУЛЬС КАРТЫ (2026-07-20): на экране «PYRAMID'S MAP» силуэт текущей пирамиды + стрелка
# выхода (спрайт-план p3 -> палитр-индексы 1,5,9,13) должны ПУЛЬСИРОВАТЬ цветом, как в
# оригинале (tickPergamino каждый кадр пишет colorPiramidMap = coloresFlecha[timer&7],
# цикл MSX 1/6/10 -> Vector 0x00/0x56/0x76). Дискриминатор «карта на экране» =
# flagPiramideMap(@0x6B51)==2 (меню=0, карта=2, геймплей=1). Пульс живёт ТОЛЬКО в
# не-игровой ветке vec_brillo_pal (хвост раздвоен: геймплей -> vbp_game БЕЗ пульса,
# байт-в-байт по тактам как база => honest_diff=0; карта/меню -> vbp_out С пульсом,
# её тайминг косметический). KV_NO_MAPPULSE=1 -> хвост НЕ раздваивается, сборка ==
# base_canon (пульса нет).
_MAPPULSE = not _os_pv.environ.get('KV_NO_MAPPULSE')
# POP-БЛИТ СТАТИЧНОГО ФОНА (2026-07-21, Фаза 1 OldTower-плана): в vec_nat_room блит тайла
# фона (68-инстр mode-диспетчер + отдельный p1-проход) заменяется POP-блитом interleaved
# данных [p0|p1] тайла, когда тайл СОВПАДАЕТ с предыдущей клеткой (last-tile кэш). Замер:
# в комнате 704 клетки, лишь 32 различных тайла, 478/704 — подряд-повторы => 68% клеток
# идут быстрым POP-путём. interleaved-байты кэша СНИМАЮТСЯ ОБРАТНО из framebuffer после
# полного блита первого экземпляра тайла (readback) => POP-путь пишет БАЙТ-В-БАЙТ те же
# байты (вывод тайла позиционно-независим: паттерн/цвет зависят лишь от номера тайла) =>
# honest_diff=0 по построению — ДЛЯ ФОНА (плоскости p0/p1). ОДНАКО полнокадровый honest_diff
# сравнивает и СПРАЙТ-плоскости p2/p3: vec_nat_room рисуется под ОДНИМ непрерывным DI, длящимся
# ~24.7 кадра (1.48М тактов; oneInterrupt=1 кадр растра, DI не прерывается). POP делает эту
# одноразовую отрисовку на ~98К тактов (~1.6 кадра) КОРОЧЕ -> пост-отрисовочный игро-тик
# попадает на кадр раньше -> фаза ИИ мумий сдвигается -> p2/p3 расходятся (ФОН p0/p1 = 0 расх.).
# Это frame-drop coupling эмулятора (не баг блита): подтверждено — pad-калибровка НЕ сводит к 0
# (хаотично уводит в иную валидную траекторию). Свести к 0 можно лишь ТОЧНЫМ совпадением тактов
# (= отказ от ускорения). Поэтому ПО УМОЛЧАНИЮ POP ВЫКЛ (сборка == base_canon, honest_diff=0);
# KV_POPBG=1 включает POP (для замера per-tile ускорения / Фазы 2). Кэш = 19Б zero-page (0x40-
# 0x52), НЕ трогает упакованный low-RAM и НЕ пишет в отображаемые плоскости.
_POPBG = bool(_os_pv.environ.get('KV_POPBG'))   # opt-in; default OFF => byte-identical base_canon
# zero-page scratch для POP-кэша фона (эмитит 0 байт — только equ; безопасно при любом флаге)
_POPBG_EQU = [
    "pop_bg_il:   equ 00040h",   # 16B interleaved вывод тайла: [p0 row0..7][p1 row0..7]
    "pop_bg_tile: equ 00050h",   # 1B номер закэшированного тайла (0xFF = пусто)
    "pbg_save:    equ 00051h",   # 2B сохранённый SP на время POP-хайджека
]
# POP-БЛИТ СПРАЙТОВ (2026-07-21, Фаза 2 OldTower-плана): горячий путь RENDER = 53% кадра.
# Профиль (tools/verify/sprite_blit_cost.js) разложил RENDER: shift-петли рисования 55%,
# vec_nsx_clear (стирание prev footprint) 24%, зеркало ~0. Стирание = запись 0 в 16 строк
# x 2-3 столбца — НЕ зависит от X-сдвига => чистая цель для UNROLL (POP-стиль «SP-fill»,
# но БЕЗ SP-хайджека: тик выполняется с ПЕРЕ-включёнными прерываниями (nested sound-ISR),
# именно поэтому vec_nat_sprites намеренно избегает хайджека; см. коммент vec_nat_sprites).
# _POPSPR разворачивает внутренний 16-строчный цикл vnce_row в 16 прямых mov m,a (A=0):
# ld (hl),a=7т < ld (hl),0=10т, и убирает счётчик dec b + jp nz (15т/строку). Записывает
# ТЕ ЖЕ нули в ТЕ ЖЕ ячейки в том же порядке => БАЙТ-ИДЕНТИЧНЫЙ вывод стирания (гейт 2).
# Меняется лишь число тактов => frame-drop coupling эмулятора сдвигает позиции мумий (benign,
# как _POPBG). БАЙТ-ИДЕНТИЧЕН вывод стирания (spr_blit_equiv 58/58=0) -> ВКЛ по умолчанию
# (пользователь 2026-07-21: вариант A). KV_NO_POP_SPR=1 -> откат к неразвёрнутому циклу.
_POPSPR = not _os_pv.environ.get('KV_NO_POP_SPR')
# ЦВЕТ КИРПИЧЕЙ ПО УРОВНЯМ (2026-07-21, Часть 1): оригинал ChgStoneColor меняет цвет камней
# по пирамиде scheme=((piramideActual-1)>>2)&3 (4 схемы каждые 4 пирамиды). Порт хардкодил
# золото (scheme0) во всём геймплее. ФИКС: в геймплее (flagPiramideMap==1) idx8 = цвет схемы
# текущей пирамиды из таблицы kv_stone_scheme (077h золото/0D2h синий/056h красн/01Ch зелён),
# scheme читается из piramideActual в VBlank (vec_brillo_pal, idx8-ветка). Меню (fpm==0) синий,
# карта (fpm==2) золото — как раньше. ЭТО ТОЛЬКО ПАЛИТРА (idx8), игровая логика не тронута.
# KV_NO_LEVELCOLOR=1 -> откат к всегда-золоту (idx8-ветка байт-в-байт как COLOR2-база).
_LEVELCOLOR = _COLOR2 and not _os_pv.environ.get('KV_NO_LEVELCOLOR')
# РАСКРАСКА КАРТЫ «PYRAMID'S MAP» (2026-07-21, Часть 2): honor colorTableMap per-tile при блите
# тайлов карты (оранж пирамиды / чёрн линии / бел папирус / син GOAL) через 3-плоскостную
# раскладку p0/p1/p2. KV_NO_MAPCOLOR=1 -> откат.
_MAPCOLOR = not _os_pv.environ.get('KV_NO_MAPCOLOR')
# ===================================================================================
# ФАЗА 1 ДВИЖКА: 8 ЦВЕТОВ на 3 плоскостях p0/p1/p2, p3 СХЛОПНУТ (2026-07-21).
# KV_8COLOR=1 -> новый 8-цветный путь: idx=(p0<<3)|(p1<<2)|(p2<<1)|p3, палитра
# color[idx]==color[idx|1] (p3 не влияет на цвет => 8 цветов от p0,p1,p2 на ЧЁТНЫХ
# индексах 0,2,4,6,8,10,12,14). Фон рисуется КОМПОЗИТОМ в 3 плоскости (шейп тайла из
# vbt_core -> p0; цвет тайла (3 бита p0/p1/p2) из vec_col8[tile] распределяет шейп по
# плоскостям), давая до 8 цветов фона. p3 (0xE000-0xFFFF) освобождён под pre-shift
# (СЛЕД. фаза). Дефолт OFF => сборка БАЙТ-ИДЕНТИЧНА base_canon (весь _8COLOR-код под
# `if _8COLOR`, текущий A+/COLOR2 путь не тронут). Correctness-first: медленнее допустимо.
_8COLOR = bool(_os_pv.environ.get('KV_8COLOR'))
# КОМПОЗИТ-СПРАЙТЫ (XOR в p1/p2, 2-цв герой) — ОПТ-ИН, ДЕФОЛТ OFF. Код написан (XOR-само-
# стирание + маршрут по col&8 в p1/p2), НО НЕ ВЕРИФИЦИРОВАН: (1) меняет пер-кадровый тайминг ->
# хрупкий attract-демо реседится в pir1 и застревает/дерейлит (тот же frame-drop coupling, что
# ловил brillo-mirror); (2) прямой inject-тест vec_nat_sprites даёт петлю ~1.9М инстр + мусор в
# p2 => есть баг в композит-пути (адресация/петля). Требует: render-list-стирание (перерисовка
# bg-тайлов под footprint) вместо XOR + не-attract тест-харнесс. При OFF спрайты идут прежним
# COLOR2-путём (p2/p3), фон 8-цв РАБОТАЕТ и достигает чистого геймплея (pir5) без краха.
_8C_SPRITES = _8COLOR and bool(_os_pv.environ.get('KV_8C_SPRITES'))
# RENDER-LIST СПРАЙТЫ (2026-07-21, БАГ1-фикс): в 8-цв движке спрайты КОМПОЗИТЯТСЯ в p1/p2
# (те же плоскости, что фон+HUD). Прежнее стирание = clear_box (пишет 0 в footprint) РУШИТ
# фон под спрайтом: герой над HUD (idx12=p0+p1) -> clear_box p1 стирает белый текст -> HUD
# перекрашивается; над лестницей (idx10=p0+p2) -> clear_box p2 -> фантом. ФИКС = классика
# «save-under»: перед отрисовкой СОХРАНЯЕМ байты фона под footprint спрайта в приватный буфер
# (vec_spr_save, 21 слот x 64Б в СВОБОДНОЙ p3 0xE000+, невидимой при схлопнутом p3), а стираем
# = ВОССТАНАВЛИВАЕМ эти байты (не 0). Фон (HUD/лестницы/цветные тайлы) под спрайтом целостен.
# Слот: [valid, hi0(plane+col0), lo0(255-Y), ncols, data(48Б=3 стб x16 строк)]. Дефолт ВКЛ в
# 8-цв (KV_8COLOR). KV_NO_8C_RLIST=1 -> откат к clear_box (баг возвращается). Вне 8-цв (base_
# canon) НЕ активен => OFF байт-в-байт с каноном. Не нужен flush-по-паттерну (restore берёт
# сохранённый фон, а не паттерн => смена паттерна при подборе не даёт остатка).
# ✅ ДЕФОЛТ ON в 8-цв (2026-07-22). Фаза S (коммит 74428d5) эвакуировала кэши в p3 и ДОКАЗАЛА
# гейт S4: сдвиг кода в vec-рантайме БОЛЬШЕ НЕ дерейлит старт (было: +8Б=derail; стало: +16Б
# доходит до GS5). Это сняло ЕДИНСТВЕННЫЙ блокер интеграции — код save-under (~180Б) теперь
# встаёт, а буфер vec_spr_save живёт в СВОБОДНОЙ p3 (0xE000-0xE53F, НЕ пересекается с кэшами
# Фазы S @0xE600+). Верификация 2026-07-22: сборка Errors:0; ON доходит до GS5 (hold 500/575/650,
# идентично base_canon_8c); при clear_box (KV_NO_8C_RLIST) цветной фон ЭРОДИРУЕТ по мере прохода
# спрайтов (white 6054->4568 к hold 1500, gold растёт — фантомы в лестницах/HUD idx12), при ON
# white СТАБИЛЕН ~6020 (фон восстанавливается точно). KV_NO_8C_RLIST=1 -> откат к clear_box (баг
# возвращается). Вне 8-цв (base_canon) НЕ активен => OFF байт-в-байт с каноном. См. отчёт 2026-07-22.
_8C_RLIST = _8COLOR and not _os_pv.environ.get('KV_NO_8C_RLIST')
# ДВУХФАЗНЫЙ RENDER-LIST + FIXUP (2026-07-27, фикс ПРОТУХШЕГО save-under). Доказанный корень
# двух глюков (см. память project_kv_8c_glitches): (а) подбор гема — save-слот героя хранит фон
# С ГЕМОМ, gemaCogida стирает клетки, restore ВОСКРЕШАЕТ гем из снапшота; (б) пересечение
# спрайтов — save одного захватывает пиксели другого, restore рисует «обрывки» (мумии у входной
# лестницы). ФИКС: (1) Pass-R — restore ВСЕХ подлежащих перерисовке спрайтов ОБРАТНЫМ порядком
# слотов ПЕРЕД save+draw (снапшоты вложены как стек: save 0->20, restore 20->0 => точная
# раскрутка, чужие пиксели не переживают кадр); (2) vec_spr_flush тоже reverse; (3) vec_su_fixup —
# каждый фоновый тайл-блит (vec_blit_tile) обновляет пересекающиеся валидные save-слоты свежим
# фоном из fb (стирание гема/копка/двери под живым спрайтом попадает и в снапшот). Гейт-условие
# Pass-R ОБЯЗАНО совпадать с change-detection основного цикла (данные не меняются: рендер в ISR).
# KV_NO_RL2PHASE=1 -> откат к однофазному (баги возвращаются). Вне 8-цв не активен (OFF==база).
_8C_RL2 = _8C_RLIST and not _os_pv.environ.get('KV_NO_RL2PHASE')
# РЕ-ДИЗАЙН ПАЛИТРОВЫХ СЛОТОВ ПОД АУРУ (2026-07-27, выбор Бориса): вернуть лучам ауры гемов
# ОРИГИНАЛЬНОЕ мигание coloresBrillo (чёрн/бел/жёлт). Блокер был: idx4 (p1) делили кожа героя,
# красные ряды кирпичей (_BRICK2) и лучи — мигать нельзя. РЕШЕНИЕ: p1-СПРАЙТЫ (кожа, двери,
# карта-стрелка; маршрут vnc_pbase==0xA0) рисуются DUAL p1+p2 => idx6 (красный 05Fh, был белый
# оверлап); красные ряды кирпичей => p1+p2 (тот же idx6); лучи ауры остаются ЕДИНСТВЕННЫМ
# жителем idx4 => vec_brillo_cols возвращается к оригиналу 00/FF/3F/3F (мигает только GS5,
# vbp_static вне игры как раньше). Save-under слот расширен до 128Б с опциональной 2-й
# плоскостью ([4]=hi0b, 0=нет; dataB сразу за dataA): save/restore/fixup обрабатывают обе.
# Кэши Фазы S переупакованы выше (слоты 0xE000-0xEA7F). Видимые сдвиги: оверлап кожа×одежда
# и мумия×красн-ряд белый->красный (естественнее). KV_NO_8C_AURA=1 -> откат целиком.
_8C_AURA = _8C_RL2 and not _os_pv.environ.get('KV_NO_8C_AURA')
# ГРУППОВАЯ ПЕРЕРИСОВКА ПЕРЕСЕКАЮЩИХСЯ СПРАЙТОВ (2026-07-27, фикс остаточного мусора после
# перепрыгивания серой мумии). КОРЕНЬ: change-detection ломает LIFO save-under — слот героя
# сейвится, когда мумия УЖЕ нарисована (захватывает её p2-пиксели); мумия двигается/стирается
# в ДРУГОМ кадре; restore героя воскрешает кусок мумии, стирать который больше некому.
# ФИКС: (1) фаза F — флаг «перерисовать» на слот (= старый гейт cur/prev); (2) фаза P —
# распространение: видимый спрайт, чей bbox (16x16) пересекает cur ИЛИ prev bbox флагового,
# тоже флагуется (2 прохода с early-exit); (3) Pass-R restore ПО ФЛАГАМ 20->0; (4) forward
# save+draw ПО ФЛАГАМ => ВСЕ сейвы группы снимают ЧИСТЫЙ фон (спрайты группы сняты) => в
# слотах НИКОГДА нет чужих спрайт-пикселей => остаточный мусор невозможен структурно.
# KV_NO_RLGROUP=1 -> откат к пере-сравнению без группировки (мусор возвращается).
_8C_RLG = _8C_RL2 and not _os_pv.environ.get('KV_NO_RLGROUP')
# MASKED-СПРАЙТЫ (2026-07-27, прототип на створках ворот). КОРЕНЬ цветовых миксов: спрайт
# рисуется OR-ом и НЕ вытесняет фон -> idx пикселя = СУММА битов фона и спрайта (створка p1+p2
# над кирпичом p0 = idx14 = слот ГЕМОВ = зелёный; кожа над белым полом — то же). Палитрой не
# лечится (все 8 комбинаций заняты 8-цветным фоном). ФИКС: спрайт НЕПРОЗРАЧЕН — в своих пикселях
# ставит свои плоскости и ГАСИТ чужие (ANDN-проход по маске паттерна). Требует хранить гасимую
# плоскость в save-under -> слот 256Б (3 плоскости: hi0/hi0b/hi0c). ПРОТОТИП: masked включён
# ТОЛЬКО для створок ворот (слоты 0-3, setSprDoorProta) — они и дали видимый баг; раскатка на
# все спрайты после замера. KV_NO_MASKSPR=1 -> откат (слот снова 128Б, миксы возвращаются).
_8C_MASK = _8C_AURA and not _os_pv.environ.get('KV_NO_MASKSPR')
# Шаг слота save-under: 256Б при masked (3 плоскости), иначе 128Б (dual) / 64Б (одиночный).
_SU_STEP = 256 if _8C_MASK else (128 if _8C_AURA else 64)
# Скретч групповой фазы: 21Б флагов + рабочие ячейки (в AURA-зоне p3 либо хвосте 64Б-зоны).
_RLG_BASE = 0xFDC0 if _8C_MASK else (0xF3B0 if _8C_AURA else 0xE547)
# База скретча save-under/fixup/masked (одна страница, перед _RLG_BASE).
_SCR_BASE = 0xFDA0 if _8C_MASK else (0xF3A0 if _8C_AURA else 0xE540)
def _SCR(i): return _SCR_BASE + i
# === ЗАДАЧА #1: СТРИМ ШРИФТА ИЗ ROM (2026-07-22, ТОЛЬКО _8COLOR; OFF байт-в-байт) ==========
# КОРЕНЬ ПРИЗРАКОВ ШРИФТА: Фаза S посадила кэш паттернов шрифта (pat_font_cell, тайлы HUD
# 0x10-0x3f = 384Б) в p3 @0xED60. Замер (mode_map=0, банкинга нет): шрифт РЕЗИДЕНТЕН в
# ОТОБРАЖАЕМОЙ плоскости p3 (269 ненулевых байт), грузится РАЗ в loadFont(intro) и НЕ чистится
# (HideSprites не трогает 0xED60) => присутствует на ВСЕХ экранах. На геймплее/меню невидим
# (палитра зеркалит пары color[2k]==color[2k+1]), НО на КАРТЕ пирамид (vec_pal_menu РАСЗЕРКАЛЕНА:
# пары 0/1,4/5,8/9,12/13 = 0x5F красный, чтобы показать спрайты карты в p3) сырые битмапы шрифта
# ПРОСВЕЧИВАЮТ КРАСНЫМ = «призрачные тайлы» из репорта. ФИКС (директива «стрими шрифт»): шрифт
# БОЛЬШЕ НЕ резидентится в p3. GFX_Font (RLE) декодируется в build-time в ROM-таблицу vec_font_rom
# (384Б, read-only), pat_font_base -> ROM, а loadFont НЕ пишет паттерн в p3 (цвет-таблицу оставляем).
# vbt_core читает глиф ПРЯМО из ROM при отрисовке HUD (стрим), p3-плоскость шрифта = ПУСТА =>
# призрак невозможен на ЛЮБОМ экране, НЕЗАВИСИМО от палитры. Байты vec_font_rom == текущий декод
# 0xED60 (CPU-вид сверен байт-в-байт) => HUD рисуется ИДЕНТИЧНО. Вне 8-цв не активен (OFF==base).
# KV_NO_FONTSTREAM=1 -> откат к резидентному кэшу шрифта в p3 (Фаза S).
_FONTSTREAM = _8COLOR and not _os_pv.environ.get('KV_NO_FONTSTREAM')

# === ЗАДАЧА #2: НАТИВНЫЙ ТИТУЛ KING'S VALLEY + РАСКРАСКА ПОД ОРИГИНАЛ (2026-07-22, ТОЛЬКО
# _8COLOR; OFF байт-в-байт) ===================================================================
# Титул KING'S VALLEY (drawGameLogo, тайлы букв 0x9B-0xC6) — последний писатель soft-VDP на
# GS=1: рисовал буквы через call WRTVRM -> vec_col_store -> компоситор. Нативизируем: те же
# два call WRTVRM (drawGameLogo3 loop + нижняя часть G) -> vec_text_blit (drop-in: HL=name
# addr, A=tile, сохраняет HL/DE/BC как WRTVRM, прямой блит p0/p1 в framebuffer). ТОЛЬКО под
# _NATLOGO: в БАЗЕ титул остаётся на WRTVRM => OFF байт-в-байт с каноном. Раскраска (данные-
# палитра) под COLORES_LOGO: истинный замер (title_trueidx_probe.js, identity-палитра) показал,
# что логотип кодирует idx4/idx8/idx12 (тело букв=idx8, хайлайты+текст=idx12), а НЕ idx4/idx6/idx14
# (прежний nearest-color зонд путал слоты). На GS=1 красим idx8->красн 05Fh (тело), idx12->золото
# 0BFh (хайлайты; текст ©KONAMI/PUSH SPACE KEY делит idx12 => тоже золото, принято пользователем),
# пирамида idx14 (тёпл. градиент красн+золото ближе к оригиналу). Гейт GS==1 в конце vec_brillo_pal
# (после _COLOR2) => НЕ трогает геймплей (vec_pal перельётся vec_setpal_a при входе на этап).
# KV_NO_NATLOGO=1 -> откат к WRTVRM+старой палитре.
_NATLOGO = _8COLOR and not _os_pv.environ.get('KV_NO_NATLOGO')

# === ЗАДАЧА #3 (_NATBONUS): НАТИВНЫЙ БОНУС/ФИНАЛ-ЭКРАН (пирамиды+звёзды+дверь) ==========
# Межуровневый reward «escenario final» (setupEnding, StartGame status 4->ending): рисует
# 3 полу-пирамиды (drawHalfPiram: диагональ+заливка через call WRTVRM), дверь большой
# пирамиды (tilesEndDoor rect 3x2 через call DEtoVRAM_NXNY) и 6 звёзд (call WRTVRM). Это
# ПОСЛЕДНИЕ soft-VDP-писатели бонус-экрана. Нативизируем те же вызовы в прямой блит:
#   * WRTVRM(HL=name,A=tile) -> vec_text_blit (drop-in: сохраняет HL,DE,BC; A=результат
#     как у WRTVRM; в drawHalfPiram A после блита свопается назад через IX-шим alt-AF =>
#     потеря A безопасна). Звезда/заливка/вершина.
#   * DEtoVRAM_NXNY(HL=name,DE=tiles,B=alto,C=ancho) -> vec_blit_rect (тождеств. контракт).
# ТОЛЬКО под _NATBONUS: в БАЗЕ (не _8COLOR) бонус остаётся на WRTVRM/DEtoVRAM_NXNY => OFF
# байт-в-байт с каноном. Правки — уникальными якорями в _apply_vector_glue (по испанским
# комментариям estrella/relleno/Vertice/puerta, не задевают титул/геймплей).
# KV_NO_NATBONUS=1 -> откат к soft-VDP бонус-экрану.
_NATBONUS = _8COLOR and not _os_pv.environ.get('KV_NO_NATBONUS')

# === Фаза S (релокация-толерантность, ТОЛЬКО _8COLOR) ==========================
# КОРЕНЬ хрупкости: 8-цв кэши с ФИКС-адресами (vec_spr_buf@0x6598 + mirror-cache
# @0x63F8) упакованы ВПЛОТНУЮ за хвостом кода в low-RAM. Любой рост кода толкает
# rot-петли/vec_nsx В буфер спрайтов -> распаковка спрайтов затирает КОД -> derail
# старта (GS4 не доходит до GS5). Решение: эвакуировать ВСЕ 8-цв кэши в СВОБОДНУЮ
# p3 (0xE000-0xFFFF, 8КБ; p3 СХЛОПНУТА в 8-цв => невидима, но CPU читает RAM норм).
# Освобождает low-RAM 0x63F8-0x7E85 (~2.2КБ) под код => сдвиг кода больше НЕ роняет
# старт (кэши физически отделены от хвоста кода). Код читает по МЕТКАМ -> смена equ
# релоцирует символьно. В БАЗЕ (не _8COLOR) p3 ВИДИМА => кэши остаются в low-RAM
# (старые адреса) => OFF байт-в-байт с каноном.
# Раскладка p3 (без пересечений; 0xE000-0xE541 зарезервирован под _8C_RLIST slots):
#   spr_buf_mir 0xE600 (416B->0xE7A0) | spr_buf 0xE800 (768B->0xEB00)
#   maze 0xEB00 (608B->0xED60) | font 0xED60 (384B->0xEEE0)
#   vnsx_revbuf 0xEEE0 (16B) | vnsx_mir 0xEEF0 (1B)
_CACHE_P3 = _8COLOR and not _os_pv.environ.get('KV_S_LOWRAM')
if _CACHE_P3:
    if _8C_MASK:
        # Слоты save-under 256Б (3 плоскости, H=0xE0+idx / L=0): 21*256 -> 0xE000-0xF4FF.
        # mir 0xF500(416) | spr_buf 0xF6A0(768) | maze 0xF9A0(608) | font 0xFC00(384) |
        # vnsx 0xFD80/FD90 | vsu/vfx-скретч 0xFDA0+ | vfl-скретч 0xFDC0+ (< 0xFFC0 z80-scratch).
        _SPRBUF_ADDR, _SPRMIR_ADDR = 0xF6A0, 0xF500
        _MAZE_ADDR, _FONT_ADDR = 0xF9A0, 0xFC00
        _VNSXREV_ADDR, _VNSXMIR_ADDR = 0xFD80, 0xFD90
    elif _8C_AURA:
        # Слоты save-under 128Б (dual-plane): 21*128=0xA80 -> 0xE000-0xEA7F; пад 0xEA80-0xEAFF
        # МЁРТВ (hsClrSU чистит слоты ПО СТРАНИЦАМ до 0xEB00 — кэши начинаются с границы!).
        # mir 0xEB00(416) | spr_buf 0xECA0(768) | maze 0xEFA0(608) | font 0xF200(384) |
        # vnsx 0xF380/F390 | vsu/vfx-скретч 0xF3A0+ (всё < z80-scratch 0xFFC0).
        _SPRBUF_ADDR, _SPRMIR_ADDR = 0xECA0, 0xEB00
        _MAZE_ADDR, _FONT_ADDR = 0xEFA0, 0xF200
        _VNSXREV_ADDR, _VNSXMIR_ADDR = 0xF380, 0xF390
    else:
        _SPRBUF_ADDR, _SPRMIR_ADDR = 0xE800, 0xE600
        _MAZE_ADDR, _FONT_ADDR = 0xEB00, 0xED60
        _VNSXREV_ADDR, _VNSXMIR_ADDR = 0xEEE0, 0xEEF0
else:
    _SPRBUF_ADDR, _SPRMIR_ADDR = 0x6598, 0x63F8
    _MAZE_ADDR, _FONT_ADDR = 0x6898, 0x7D05
    _VNSXREV_ADDR, _VNSXMIR_ADDR = 0x6B67, 0x6B77
_SPRBUF_EQU = "vec_spr_buf:    equ 0%04Xh" % _SPRBUF_ADDR
_SPRMIR_EQU = "vec_spr_buf_mir: equ 0%04Xh" % _SPRMIR_ADDR
# КЭШ В p3 ТРЕБУЕТ зеркала палитры idx4->idx5 (и idx8->idx9): p3 — ОТОБРАЖАЕМАЯ плоскость,
# и хотя игра держит p3=0 (нечёт.idx не показываются), Palette[5]!=Palette[4] (латч мерцания
# гемов) => данные кэша в p3 «просвечивали» бы цветом нечёт.idx. Зеркало (в VBlank, vec_brillo_pal)
# держит пары равными => p3-содержимое ВИЗУАЛЬНО НЕВИДИМО. Замер: hold 575/650 == base_canon_8c
# байт-в-байт. Раньше опт-ин KV_8C_BRMIRROR; теперь авто при кэшах в p3. KV_S_LOWRAM снимает.
_8C_PALMIR = (_CACHE_P3 or bool(_os_pv.environ.get('KV_8C_BRMIRROR'))) and not _os_pv.environ.get('KV_NO_PALMIR')

# === ЗАДАЧА #2: три цветовые доделки (ТОЛЬКО _8COLOR; OFF байт-в-байт) ==========
# 2a КИРПИЧИ 2-ТОН: кирпич-тайлы 0x40-0x44 per-row золото(idx8)/тёмн-красн(idx4) по маске
#    строк 033h (ColoresPiedra scheme0 = 2 жёлт / 2 красн / 2 жёлт / 2 красн). Золото =
#    p0=шейп (idx8, слот1 0BF); красн-строка = p0 очищен + p1=шейп -> idx4 (05F, ТОТ ЖЕ
#    красный что кожа героя — 8-цв бюджет исчерпан, свободного фон-idx под красн-кирпич нет;
#    честный компромисс). Только p0/p1 => совместимо с POP-кэшем (p0+p1). KV_NO_BRICK2 -> откат.
_BRICK2 = _8COLOR and not _os_pv.environ.get('KV_NO_BRICK2')
# 2b АУРА ГЕМ: idx14 (тело гема, slot6 038h зелён) МЕРЦАЕТ покадрово в VBlank (vec_brillo_pal,
#    только GS5-геймплей) зелён 038h <-> циан 0F8h по (timer&4). Зеркалим idx14->idx15 (p3-схлопка).
#    Только палитра (не пиксели). KV_NO_GEMAURA -> откат.
#    _8C_AURA: мигание ТЕЛА гема было суррогатом невозможного мигания лучей; теперь лучи
#    мигают по-оригиналу (idx4) => тело статично зелёное (Борис: «одно из сокровищ мигает» —
#    убрано). KV_GEMAURA=1 вернёт мигание тела поверх ауры.
_GEMAURA = _8COLOR and not _os_pv.environ.get('KV_NO_GEMAURA') and (
    not _8C_AURA or bool(_os_pv.environ.get('KV_GEMAURA')))
# 2c ЦВЕТ МУМИЙ ПО ТИПУ: мумии (слоты 6-13, enemyAttrib) маршрутизируются по цвет-нибблу
#    (tiposMomia: F/9/4/8/A) в 3 КОМПОЗИТ-плоскости: p1->idx4 красн, p2->idx2 серый, p0->idx8
#    золото (над чёрным коридором). 3 различимых цвета (8-цв: композит даёт лишь idx2/4/6, а
#    idx6 бел требует dual-plane, что не влезает в 64Б render-list слот -> вместо белого исп.
#    p0=золото над чёрным). render-list save-under держит фон чистым. KV_NO_MUMCOL -> откат.
_MUMCOL = _8COLOR and not _os_pv.environ.get('KV_NO_MUMCOL')
# СТАДИЯ 1 soft-VDP: НАТИВНЫЙ drawRoom-скролл (GS=9, ScrollPantalla). drawRoom рисует
# 22x32=704 тайла per-tile через диспетчер vec_vram_write (soft-VDP). Нативизируем цикл
# drawRoom3: блит напрямую через vec_text_blit (HL=name, A=tile), ведя name-addr в HL
# локально (стартует 0x3820, +1/тайл, name-таблица непрерывна 0x20/строка => естественно
# перетекает на след. строку). name-addr сохраняется в vec_nr_ptr на границе строки (тот же
# cell, что у vec_nat_room; конфликта нет — vec_nat_room=setupRoom, drawRoom=скролл, не
# одновременно). Только под _8COLOR (OFF байт-в-байт с каноном). KV_NO_NATSCROLL -> откат.
_NATSCROLL = _8COLOR and not _os_pv.environ.get('KV_NO_NATSCROLL')
# СТАДИЯ 4 soft-VDP: НАТИВНЫЙ загрузочный funnel. UnpackPatterns = GENERIC RLE-распаковщик
# (unpackGFX 3 банка), зовётся И для ПАТТЕРНОВ (HL=0x2080/0x2200/0x2430/0x2480), И для ЦВЕТА
# (HL=0x8/0x228/0x3B8/0x430/0x480/0x4D8 -> цвет-таблица 0x0000-0x17FF). Маршрут решает адрес.
# Нативизируем UnpackPatterns -> vec_pat_load (1 проход, fold банка) с vec_pat_wr как ПОЛНЫМ
# addr-роутером (как funnel vec_vram_write): цвет<0x1800 -> vec_col_store (mixbuf), паттерн
# 0x2000-0x37FF -> pat-кэш, спрайт 0x1800-0x1FFF -> vec_spr_buf. Цель: увести pat_shadow из p2.
# KV_NO_NATLOAD -> откат к soft-VDP funnel (vec_vram_write).
_NATLOAD = _8COLOR and not _os_pv.environ.get('KV_NO_NATLOAD')
# СТАДИЯ 6 soft-VDP (ФИНАЛ, ЛИТЕРАЛЬНЫЙ НОЛЬ): последние ЖИВЫЕ потребители диспетчера
# vec_vram_write — InviertePatron (генерация зеркальных тайлов лестниц, 720 поп.) и VRAM_write2
# (bulk-заливка fillVRAM-slow, 2256 поп.) — переводятся на ПРЯМУЮ запись в нативные кэши через
# vec_cache_wr (range-роутер: цвет->vec_col_store, спрайт->vec_spr_buf, паттерн->vec_pat_wr) БЕЗ
# vec_vdp_ptr-латча/WRTVRM/RDVRM/vw_*/rv_*. После этого ВЕСЬ диспетчер (WRTVRM..rv_done) имеет 0
# ссылок -> его ЭМИССИЯ гейтится под `if not _NATVDP`. OFF (не-8C) и откат KV_NO_NATVDP=1
# сохраняют soft-VDP диспетчер => OFF байт-в-байт с каноном. KV_NO_NATVDP=1 -> откат.
_NATVDP = _8COLOR and not _os_pv.environ.get('KV_NO_NATVDP')

# vec_col8[tile] — 256B page-aligned ROM LUT, ЦВЕТ-ОСЬ фона в 8-цв движке (только KV_8COLOR).
# Байт: бит0 = писать ШЕЙП в p2 (idx8->idx10 стены+p2 / idx12->idx14 белый+p2); бит1 = очистить
# p0 (увести цвет с p0: idx8->idx0/4, idx2/6 если и p2). p1 берётся из runtime white-флага.
# Итоговый idx пикселя-шейпа = (p0<<3)|(white<<2)|(p2<<1). Дефолт 0 => фон = базовая 2-цв
# структура (стены idx8 gold / белый idx12) на 8-цв палитре — сразу корректно. Ниже — правки
# по тайл-диапазонам для доп. цветов (лестницы св.синий, декор зелёный). Тайл-нумерация нашего
# движка (vw_byte): подобрана эмпирически по honest_render (PYRAMID-05).
def _decode_gfx_font(src):
    """ЗАДАЧА#1: извлечь GFX_Font (RLE) из исходника и декодировать в 384Б (тайлы 0x10-0x3f).
    Формат unpackGFX (msx:1415): байт N с bit7=0 -> залить СЛЕДУЮЩИЙ 1 байт N раз; bit7=1 ->
    скопировать (N&0x7F) следующих байт как есть; 0x00 -> конец. Возвращает 384 байта (декод
    ~352Б для 44 тайлов 0x10-0x3b + паддинг нулями до 48 тайлов 0x3c-0x3f). Сверено байт-в-байт
    с CPU-видом 0xED60 в эмуляторе (mode_map=0)."""
    i = src.find('GFX_Font:')
    assert i >= 0, "GFX_Font not found in source"
    # собрать db-байты от метки до первой строки без 'db'
    packed = []
    for ln in src[i:].split('\n'):
        body = ln.split(';')[0]
        if 'db' not in body:
            if body.strip() == '' or ':' in body:
                break
            break
        for tok in body.split('db', 1)[1].split(','):
            tok = tok.strip()
            if not tok:
                continue
            packed.append(int(tok[:-1], 16) if tok[-1] in 'hH' else int(tok, 10))
    # RLE-декод
    out = []
    p = 0
    while p < len(packed):
        n = packed[p]; c = n & 0x7F; p += 1
        if n == 0:
            break
        if n & 0x80:                       # literal: copy c bytes
            out += packed[p:p + c]; p += c
        else:                              # fill: repeat next byte c times
            out += [packed[p]] * c; p += 1
    if len(out) > 384:
        out = out[:384]
    out += [0] * (384 - len(out))          # pad tiles 0x3c-0x3f
    return out


def _gen_col8():
    t = [0] * 256
    # Лестницы / диагональные «ходы» = св.синий idx10 (p0=шейп + p2): cc=1 (ТОЛЬКО p2, БЕЗ
    # p0-clear). Паттерны лестниц 0x76-0x85. idx10 (p0=1,p2=1) = ФОН-пространство (p0=1) => НЕ
    # конфликтует с КОМПОЗИТ-СПРАЙТАМИ (p0=0 -> idx2/4/6). Раньше cc=3 клал лестницы в idx2/6
    # (p0=0) — то же место, что спрайты => конфликт. Теперь bg строго p0=1, спрайты p0=0.
    # ЛЕСТНИЦЫ 0x76-0x85 -> cc=0 (белый idx12): раскладка юзера = лестницы БЕЛЫЕ. Тайлы
    # белофлажны (vec_tilemode bit7) -> cc=0 кладёт их в idx12 (p0=1,p1=1). (Было cc=1 -> idx14.)
    for tile in range(0x76, 0x86):
        t[tile] = 0
    # ГЕМЫ 0x86-0x8B + КЛЮЧ-анх 0x5C -> cc=1 (p2): белофлажные -> idx14 (зелён slot6),
    # не-белые -> idx10. Раскладка юзера = гемы/ключ ЗЕЛЁНЫЕ. (Гем-СПРАЙТ/destello идёт
    # своим путём idx4/6 и НЕ управляется vec_col8 — там цвет остаётся red/white, отмечено.)
    for tile in range(0x86, 0x8C):
        t[tile] = 1
    t[0x5C] = 1
    # ВРАЩ.ДВЕРЬ 0x50 -> cc=1: не-белая -> idx10 (синий slot5). Раскладка юзера = дверь СИНЯЯ.
    t[0x50] = 1
    lines = []
    for r in range(0, 256, 16):
        lines.append("\tdb\t" + ",".join("0%02Xh" % t[r + c] for c in range(16)))
    return lines

# Z80-only mnemonics we expand.
JR_CC = {'nz': 'nz', 'z': 'z', 'nc': 'nc', 'c': 'c'}

# scratch cell names (defined as MAP fields appended to the work area)
SCRATCH = ['z80_ix', 'z80_iy', 'z80_af_alt', 'z80_bc_alt', 'z80_de_alt',
           'z80_hl_alt', 'il_tmp', 'il_tmp2', 'il_a']
SCRATCH_DEFS = "\n".join(f"{n}:\t# 2" for n in SCRATCH) + "\nil_outstub:\t# 3"


def split_line(line):
    """Return (label, body, comment). label includes trailing ':' if present."""
    # comment
    comment = ''
    # find ';' not inside quotes (rare in this source); simple split is fine
    if ';' in line:
        i = line.index(';')
        comment = line[i:]
        line = line[:i]
    # label: leading token at col 0 ending with ':' (or a bare label at col0)
    label = ''
    m = re.match(r'^([A-Za-z_@?.][\w@?.$]*:)\s*(.*)$', line)
    if m:
        label = m.group(1)
        body = m.group(2)
    else:
        body = line.strip() if line.strip() else ''
        if line and not line[0].isspace():
            # bare label at col0 without colon (Sjasm MAP fields use this) -> leave as-is
            return (line.rstrip(), '', comment)
    return (label, body.strip(), comment)


def operands(body):
    """mnemonic, [op1, op2]"""
    parts = body.split(None, 1)
    mn = parts[0].lower()
    ops = [x.strip() for x in parts[1].split(',')] if len(parts) > 1 else []
    return mn, ops


def reg8(r):
    """normalize an 8-bit register token; (ix+d)/(iy+d) handled separately."""
    return r.strip().lower()


# ----- IX/IY effective-address helper: HL = ix/iy + disp -----
def _idx_addr(idxcell, disp):
    """Build effective address (idx+disp) into HL, clobbering A ONLY (caller saves
    A+flags via push af where needed). disp is symbolic; the assembler splits it into
    low/high bytes (handles negative via two's complement masks). HL is overwritten;
    caller must have saved the original HL (il_tmp2)."""
    out = [f"ld hl,({idxcell})"]
    d = disp.strip()
    if d and d not in ('0', '+0'):
        d = d.lstrip('+')
        out += ["ld a,l", f"add a,({d})&255", "ld l,a",
                "ld a,h", f"adc a,(({d})>>8)&255", "ld h,a"]
    return out


def expand(mn, ops, idxinfo):
    """Return list of i8080 asm lines (no label/comment) for a Z80-only instruction,
    or None if not Z80-only (pass through)."""
    # --- JR / DJNZ ---
    if mn == 'jr':
        if len(ops) == 1:
            return [f"jp {ops[0]}"]
        cc = ops[0].lower()
        return [f"jp {cc},{ops[1]}"]
    if mn == 'djnz':
        return ["dec b", f"jp nz,{ops[0]}"]
    # --- EXX / EX AF,AF' ---
    # exx approach-B: a PRE-PASS (_classify_exx) retags provably paired-temporary
    # exx into exxo (opening) / exxc (closing) -> a 3-byte push/pop instead of the
    # 33-byte per-pair RAM swap. Order is mirrored (LIFO): push bc/de/hl ... pop
    # hl/de/bc, so the two OTHER pairs and all flags are preserved. Only the main
    # bank is touched; the z80_*_alt cells are NOT written (safe iff the alt-bank
    # residue is dead - guaranteed by the classifier's rules, see _classify_exx).
    if mn == 'exxo':
        return ["push bc", "push de", "push hl"]
    if mn == 'exxc':
        return ["pop hl", "pop de", "pop bc"]
    if mn == 'exx':
        return _exx()
    if mn == 'ex' and ops and ops[0].lower() == 'af' and ops[1].replace(' ', '').lower() == "af'":
        return _exaf()
    # --- IX/IY (detected via idxinfo: (cell, regtoken/None)) ---
    if idxinfo is not None:
        return _ixiy(mn, ops, idxinfo)
    # --- Z80-only LD A,I / LD A,R (ED 57 / ED 5F) ---
    # The i8080 has no I/R register AND no ED prefix: passed through verbatim, the
    # ED byte is an UNDOCUMENTED 3-byte CALL on the 8080, so `ld a,i` (ED 57) plus
    # the following opcode byte become `CALL <next>57h` -> a wild jump into random
    # code (here momiaDecide7's ld a,i CALLed into lanzaCuchillo, corrupting MapaRAM
    # with 0x14 solid cells). KV uses `ld a,i` once (momiaDecide7, "valor aleatorio"):
    # on the MSX the BIOS runs IM 1 and never writes I, so I stays 0 (Z80 reset) ->
    # the "random" read is always 0. Emit A=0 via MVI A (LD A,n leaves flags intact,
    # matching Z80 ld a,i which preserves CY - the very next op is RRA and needs it).
    if mn == 'ld' and len(ops) == 2 and ops[0].lower() == 'a' \
            and ops[1].lower() in ('i', 'r'):
        return [f"ld a, 0\t; Z80 'ld a,{ops[1].lower()}' -> I/R=0 on MSX "
                "(no I/R reg on i8080; MVI preserves flags)"]
    # --- Z80-only 16-bit memory loads: ld bc/de,(nn) and ld (nn),bc/de ---
    # (i8080 has LHLD/SHLD for HL only; ED 4B/5B/43/53 are Z80-only opcodes that
    #  would execute as garbage on the vanilla i8080 Vector -> wrong BC/DE.)
    if mn == 'ld':
        r = _ld16(ops)
        if r is not None:
            return r
        return None
    # --- CB: bit/res/set/shifts on registers ---
    if mn == 'bit':
        return _bit(ops[0], ops[1])
    if mn in ('res', 'set'):
        return _resset(mn, ops[0], ops[1])
    if mn in ('sla', 'sra', 'srl', 'sll', 'rl', 'rr', 'rlc', 'rrc'):
        return _shift(mn, ops[0])
    # --- ED block / 16-bit / misc ---
    if mn == 'ldir':
        return _ldir(+1)
    if mn == 'lddr':
        return _ldir(-1)
    if mn == 'ldi':
        return _ldi(+1)
    if mn == 'ldd':
        return _ldi(-1)
    if mn in ('adc', 'sbc') and len(ops) == 2 and ops[0].lower() == 'hl':
        return _adcsbc_hl(mn, ops[1])
    if mn == 'neg':
        return ["cpl", "inc a"]
    if mn == 'im':
        # i8080 has no IM; but the MSX C-BIOS interrupt dispatch requires IM 1.
        # Pass the real Z80 opcode through for openMSX(Z80) validation. On the
        # vanilla Vector-06C target the interrupt setup is replaced (RST 7), so
        # this line is stripped/adapted there.
        return [f"im {ops[0]}\t; keep for MSX C-BIOS (IM 1); replace on Vector"]
    if mn in ('reti', 'retn'):
        return ["ret"]
    if mn == 'out' and ops and ops[0].lower() == '(c)':
        return _out_c(ops[1])
    if mn == 'in' and len(ops) == 2 and ops[1].lower() == '(c)':
        return _in_c(ops[0])
    return None


def _ld16(ops):
    """Translate Z80-only 16-bit memory loads to i8080 via HL (preserving HL and
    flags). Returns None for i8080-native ld forms (pass through unchanged)."""
    if len(ops) != 2:
        return None
    dst, src = ops[0].strip(), ops[1].strip()
    dl, sl = dst.lower(), src.lower()
    mem = lambda t: t.startswith('(') and t.endswith(')')
    # ld bc,(nn) / ld de,(nn)  -> LHLD then move to rp
    if dl in ('bc', 'de') and mem(src):
        nn = src[1:-1].strip()
        hi, lo = dl[0], dl[1]
        return ["push hl", f"ld hl,({nn})", f"ld {hi},h", f"ld {lo},l", "pop hl"]
    # ld (nn),bc / ld (nn),de  -> move rp to HL then SHLD
    if sl in ('bc', 'de') and mem(dst):
        nn = dst[1:-1].strip()
        hi, lo = sl[0], sl[1]
        return ["push hl", f"ld h,{hi}", f"ld l,{lo}", f"ld ({nn}),hl", "pop hl"]
    return None


def _exx():
    out = []
    for rp, cell in (('bc', 'z80_bc_alt'), ('de', 'z80_de_alt'), ('hl', 'z80_hl_alt')):
        out += _swap_rp(rp, cell)
    return out


def _swap_rp(rp, cell):
    # Compact stack-based swap of a register pair with its alt RAM cell.
    # Semantics identical to exx per-pair: rp <-> (cell). No flag/A effects
    # (push/pop/ld/mov/xthl leave flags untouched). Only HL is used as scratch
    # and is always restored, so the OTHER two pairs are preserved.
    if rp == 'hl':
        # HL <-> (cell): 5 insns / 9 bytes (was 6 / 18).
        return ["push hl", f"ld hl,({cell})", "ex (sp),hl",
                f"ld ({cell}),hl", "pop hl"]
    hi, lo = rp[0], rp[1]
    # BC/DE <-> (cell): 8 insns / 12 bytes (was 10 / 22), HL preserved.
    return ["push hl", f"ld hl,({cell})", f"push {rp}",
            f"ld {lo},l", f"ld {hi},h", "pop hl",
            f"ld ({cell}),hl", "pop hl"]


def _exaf():
    return ["ld (il_tmp2),hl", "push af", "pop hl", "ld (il_tmp),hl",
            "ld hl,(z80_af_alt)", "push hl", "pop af", "ld hl,(il_tmp)",
            "ld (z80_af_alt),hl", "ld hl,(il_tmp2)"]


# ---------------------------------------------------------------------------
# EXX approach-B: paired-temporary exx -> push/pop (6 bytes/pair vs 66).
# ---------------------------------------------------------------------------
# The default exx expansion (_swap_rp x3) swaps each register pair with a RAM
# cell (z80_bc/de/hl_alt) = 33 bytes/exx. When a matched `exx ... exx` pair is
# used purely as "give me scratch registers" (the alt bank is FRESH scratch, not
# carrying data between pairs), the whole swap is unnecessary: the opening exx
# can just `push bc/de/hl` (preserve the main bank on the stack) and the closing
# exx `pop hl/de/bc` (restore it) = 3 bytes each, 6 bytes/pair vs 66.
#
# A pre-pass classifies the ROLE of every standalone `exx` and retags the safe
# ones to `exxo`/`exxc`; the rest stay `exx` (RAM swap). A pair (open i, its very
# next exx j) is a SAFE temporary iff ALL hold in the body between them:
#   1. no label (a jump-in target) and no branch leaving the pair
#      (jr/jp/djnz/ret/rst/reti/retn). call/ldir/lddr are stack-balanced and act
#      as a write-barrier (a subroutine defines its outputs) -> allowed.
#   2. no alt register b/c/d/e/h/l is READ before it is WRITTEN. A read-before-
#      write means the alt reg carries a value produced by a PRIOR exx pair =
#      long-lived data (e.g. an alt-bank loop counter, or a caller-passed alt
#      pointer) -> the swap must stay so the value is read from the RAM cell.
#   3. the body's observable effect is a MEMORY write (its purpose is to poke
#      memory using the alt bank as scratch). If the sole effect is loading an
#      alt REGISTER (e.g. setVDPWrite: `ld c,a` sets the VDP data port that a
#      later `exx / out(c),a / exx` consumes), push/pop would NOT reproduce that
#      alt-register residue -> exclude, keep the swap.
# Rules 1-3 are LOCAL and sound for the observable memory effect; the z80 logic
# gate is the backstop for any cross-routine alt residue.

_R8 = ('b', 'c', 'd', 'e', 'h', 'l')
_RP = {'bc': ('b', 'c'), 'de': ('d', 'e'), 'hl': ('h', 'l')}


def _tok_regs(tok):
    """Return (regset, is_mem) for an operand token: which of b/c/d/e/h/l it
    references and whether it is a memory reference via a register pair."""
    t = tok.strip().lower()
    if t in _RP:
        return set(_RP[t]), False
    if t in _R8:
        return {t}, False
    if t.startswith('(') and t.endswith(')'):
        inner = t[1:-1].strip().lower()
        if inner == 'hl':
            return {'h', 'l'}, True
        if inner in ('bc', 'de'):
            return set(_RP[inner]), True
        return set(), True          # (nn) immediate address
    return set(), False


def _exx_regs(mn, ops):
    """Effect of one instruction on the tracked 8-bit regs.
    Returns (reads, writes, mem_write, is_branch, ok). ok=False => unparseable
    (caller must treat the pair as unsafe)."""
    if mn in ('jr', 'jp', 'djnz', 'ret', 'rst', 'reti', 'retn'):
        return set(), set(), False, True, True
    if mn in ('call', 'ldir', 'lddr'):
        # stack-balanced; treat as a write-barrier for all tracked regs so a
        # subsequent (hl)/reg read is not flagged read-before-write.
        return set(), set(_R8), mn in ('ldir', 'lddr'), False, True
    if mn == 'ld' and len(ops) == 2:
        reads, _ = _tok_regs(ops[1])
        writes, mem_write = set(), False
        dl = ops[0].strip().lower()
        if dl in _RP:
            writes |= set(_RP[dl])
        elif dl in _R8:
            writes.add(dl)
        elif dl.startswith('(') and dl.endswith(')'):
            r, _m = _tok_regs(ops[0])
            reads |= r               # addr regs are READ to form the pointer
            mem_write = True
        return reads, writes, mem_write, False, True
    if mn in ('inc', 'dec') and len(ops) == 1:
        t = ops[0].strip().lower()
        if t in _RP:
            return set(_RP[t]), set(_RP[t]), False, False, True
        if t in _R8:
            return {t}, {t}, False, False, True
        if t == '(hl)':
            return {'h', 'l'}, set(), True, False, True
        return set(), set(), False, False, False
    if mn == 'push' and ops:
        t = ops[0].strip().lower()
        if t in _RP:
            return set(_RP[t]), set(), False, False, True
        if t == 'af':
            return set(), set(), False, False, True
        return set(), set(), False, False, False
    if mn == 'pop' and ops:
        t = ops[0].strip().lower()
        if t in _RP:
            return set(), set(_RP[t]), False, False, True
        if t == 'af':
            return set(), set(), False, False, True
        return set(), set(), False, False, False
    if mn in ('add', 'adc') and len(ops) == 2 and ops[0].strip().lower() == 'hl':
        r, _ = _tok_regs(ops[1])
        return {'h', 'l'} | r, {'h', 'l'}, False, False, True
    if mn == 'ex' and len(ops) == 2:
        s = set()
        for t in (ops[0].strip().lower(), ops[1].strip().lower()):
            if t in _RP:
                s |= set(_RP[t])
            elif t != '(sp)':
                return set(), set(), False, False, False
        return s, s, False, False, True
    if mn in ('add', 'adc', 'sub', 'sbc', 'and', 'or', 'xor', 'cp') and ops:
        r, _ = _tok_regs(ops[-1])    # `op a,x` or `op x`; A is untracked
        return r, set(), False, False, True
    if mn in ('rra', 'rla', 'rrca', 'rlca', 'cpl', 'scf', 'ccf', 'daa', 'neg',
              'nop', 'ei', 'di', 'halt') and not ops:
        return set(), set(), False, False, True
    if mn in ('add', 'adc', 'sub', 'sbc', 'and', 'or', 'xor', 'cp') and not ops:
        return set(), set(), False, False, True
    return set(), set(), False, False, False   # unknown -> unsafe


def _classify_exx(src):
    """Retag provably paired-temporary `exx` into `exxo`/`exxc`. Returns
    (new_src, n_pairs_converted). Long-lived exx are left untouched."""
    lines = src.split('\n')
    exx_idx = []
    for i, l in enumerate(lines):
        lbl, body, _ = split_line(l)
        if not lbl and body.strip().lower() == 'exx':
            exx_idx.append(i)
    roles = {}
    conv = 0
    k = 0
    while k + 1 < len(exx_idx):
        oi, ci = exx_idx[k], exx_idx[k + 1]
        written, membw, safe = set(), False, True
        for j in range(oi + 1, ci):
            lbl, body, _ = split_line(lines[j])
            if lbl:                      # label = possible jump-in target
                safe = False
                break
            if not body:
                continue
            mn, ops = operands(body)
            reads, writes, mw, branch, ok = _exx_regs(mn, ops)
            if not ok or branch:
                safe = False
                break
            if reads - written:          # read-before-write of an alt reg
                safe = False
                break
            written |= writes
            membw = membw or mw
        if safe and membw:
            roles[oi], roles[ci] = 'exxo', 'exxc'
            conv += 1
            k += 2
        else:
            k += 1
    for i, newmn in roles.items():
        line = lines[i]
        indent = line[:len(line) - len(line.lstrip())]
        _, _, cmt = split_line(line)
        lines[i] = indent + newmn + (('\t' + cmt) if cmt else '')
    return '\n'.join(lines), conv


def _bit(n, reg):
    mask = f"1<<{n}"
    if reg == 'a':
        return ["ld (il_a),a", f"and {mask}", "ld a,(il_a)"]
    if reg in ('(hl)',):
        return ["ld (il_a),a", "ld a,(hl)", f"and {mask}", "ld a,(il_a)"]
    return ["ld (il_a),a", f"ld a,{reg}", f"and {mask}", "ld a,(il_a)"]


def _resset(op, n, reg):
    # Sjasm computes the mask constant. RES/SET must preserve ALL flags (Z80 does).
    alu = f"and (~(1<<{n}))&255" if op == 'res' else f"or 1<<{n}"
    if reg == 'a':
        return ["push af", alu, "ld (il_a),a", "pop af", "ld a,(il_a)"]
    if reg == '(hl)':
        return ["push af", "ld a,(hl)", alu, "ld (hl),a", "pop af"]
    return ["push af", f"ld a,{reg}", alu, f"ld {reg},a", "pop af"]


def _shift_body(op):
    if op == 'sla':
        return ["add a,a"]
    if op == 'sll':
        return ["add a,a", "or 1"]
    if op == 'rlc':
        return ["rlca"]
    if op == 'rrc':
        return ["rrca"]
    if op == 'rl':
        return ["rla"]
    if op == 'rr':
        return ["rra"]
    if op == 'srl':
        return ["or a", "rra"]
    if op == 'sra':
        return ["ld (il_tmp),a", "add a,a", "ld a,(il_tmp)", "rra"]
    return [f"; UNHANDLED SHIFT {op}"]


def _shift(op, reg):
    body = _shift_body(op)
    if reg == 'a':
        return body
    if reg == '(hl)':
        return ["ld (il_a),a", "ld a,(hl)", *body, "ld (hl),a", "ld a,(il_a)"]
    return ["ld (il_a),a", f"ld a,{reg}", *body, f"ld {reg},a", "ld a,(il_a)"]


_LD_UID = [0]


def _uniq(stem):
    _LD_UID[0] += 1
    return f".il_{stem}{_LD_UID[0]}"


def _ldir(step):
    # Deflation: fold the 8-instruction inline copy loop into a shared subroutine
    # (vec_ldir_fwd for ldir/+1, vec_ldir_bwd for lddr/-1). Params already in the
    # right regs (HL=src, DE=dst, BC=count). Semantics identical: copies BC bytes,
    # leaves BC=0 and HL/DE past the range, Z set (from the final `or c`). call/ret
    # touch only the stack + PC, so flags/regs on return match the inline form.
    return ["call vec_ldir_fwd" if step > 0 else "call vec_ldir_bwd"]


def _ldi(step):
    s = "inc" if step > 0 else "dec"
    return ["ld a,(hl)", "ld (de),a", f"{s} hl", f"{s} de", "dec bc"]


# Shared ldir/lddr copy loops (deflation): each Z80 ldir/lddr becomes a single
# `call` to one of these instead of an 8-instruction inline expansion. Injected in
# a code region just before the MAP block, so they exist for BOTH targets (the
# `call` is emitted target-independently by _ldir). All-i8080 (passes through
# translate untouched). vec_ldir_fwd = ldir (inc), vec_ldir_bwd = lddr (dec).
#
# STACK-SAFE: a plain call/ret would leave the return address on the stack DURING
# the copy. KV's boot variable-fill (`ld (hl),0` + ldir over GameStatus..+0x6FF)
# has the stack sitting INSIDE that range on MSX (SP=stackTop 0xE700, fill hits
# 0xE6FE/FF = the pushed return slot) -> the fill zeroes the return address ->
# ret to 0x0000 -> reboot loop. The inline loop never touched the stack, so it was
# immune. Fix: at entry stash the return address in il_tmp2 (a scratch cell OUTSIDE
# any fill region on both targets: MSX 0xF00E, Vector 0xDFCE) and pop it off the
# stack, so the copy can never clobber it; at exit restore it and jump back while
# leaving HL/DE/BC exactly as ldir does (HL/DE past range, BC=0). il_tmp2 is saved/
# restored by BOTH ISRs (vec_isr + tickMainISR), so an interrupt mid-copy (or a
# nested ldir inside tickMain) preserves the stashed return address.
_LDIR_LOOP_FWD = ("\tld\ta,(hl)\n\tld\t(de),a\n\tinc\thl\n\tinc\tde\n"
                  "\tdec\tbc\n\tld\ta,b\n\tor\tc\n\tjp\tnz,{lp}\n")
_LDIR_LOOP_BWD = ("\tld\ta,(hl)\n\tld\t(de),a\n\tdec\thl\n\tdec\tde\n"
                  "\tdec\tbc\n\tld\ta,b\n\tor\tc\n\tjp\tnz,{lp}\n")


def _ldir_helper(name, loop_tmpl):
    lp = name + "_lp"
    return (
        f"{name}:\n"
        "\tex\t(sp),hl\n\tld\t(il_tmp2),hl\n\tpop\thl\n"   # stash ret addr, restore HL=src
        f"{lp}:\n" + loop_tmpl.format(lp=lp) +
        "\tpush\thl\n\tld\thl,(il_tmp2)\n\tex\t(sp),hl\n\tret\n")  # restore ret, keep final HL


_LDIR_HELPERS = (
    "\n; ===== ldir/lddr deflation: shared stack-safe copy loops (call, not inline) =====\n"
    "; Copy BC bytes (HL)->(DE); on return BC=0, HL/DE past the range. Return addr is\n"
    "; kept in il_tmp2 (not on the stack) so a fill whose dest overlaps SP is safe.\n"
    + _ldir_helper("vec_ldir_fwd", _LDIR_LOOP_FWD)
    + _ldir_helper("vec_ldir_bwd", _LDIR_LOOP_BWD)
)


def _adcsbc_hl(op, rp):
    # Value and carry come from the byte-wise adc/sbc chain. Z must reflect the FULL
    # 16-bit result (Z80 semantics) - KV branches on it (e.g. `sbc hl,bc / ret nz`
    # trap X-coincidence check). A naive chain leaves Z = (high byte == 0), so a
    # difference of 1..255 would read as "equal". Fix-up: when the high byte is 0,
    # recompute Z from L; restore carry via SCF (STC touches ONLY CY on 8080).
    # Clobbers A (Z80 clobbers only F); S reflects L's bit7 in the fix-up path -
    # fine for KV (only z/nz/c/nc used after 16-bit adc/sbc).
    rp = rp.lower()
    hi, lo = rp[0], rp[1]
    a = 'adc' if op == 'adc' else 'sbc'
    done = _uniq('AS16')
    cset = _uniq('AS16C')
    return ["ld a,l", f"{a} a,{lo}", "ld l,a",
            "ld a,h", f"{a} a,{hi}", "ld h,a",
            f"jp nz,{done}",                 # high!=0: Z=0 and C already correct
            f"jp c,{cset}",
            "ld a,l", "or a",                # C was 0: Z=(L==0), C stays 0
            f"jp {done}",
            f"{cset}:", "ld a,l", "or a", "scf",   # C was 1: fix Z, then restore C
            f"{done}:"]


# MSX fixed I/O ports for OUT (C),r / IN r,(C): the only out(c) sites are PSG (port
# A0/A1 via C). On MSX the value of C at these sites is the PSG register port. We
# keep C-as-port via a self-modified OUT (rare, 3 sites).
def _guniq(stem):
    _LD_UID[0] += 1
    return f"IL_{stem}{_LD_UID[0]}"          # GLOBAL label (self-mod target)


def _out_c(reg):
    pre = [] if reg == 'a' else [f"ld a,{reg}"]
    # i8080 has no variable-port OUT. The code lives in ROM (cartridge), so we
    # cannot self-modify it. Build an `out (port),a ; ret` stub in RAM (il_outstub)
    # and CALL it. Interrupt-safe: the ISR wrapper preserves il_a, and out(c) is
    # not used on any nested-interrupt path (updateSound uses BIOS PSG calls).
    return pre + ["ld (il_a),a", "ld a,c", "ld (il_outstub+1),a",
                  "ld a,0D3h", "ld (il_outstub),a",
                  "ld a,0C9h", "ld (il_outstub+2),a",
                  "ld a,(il_a)", "call il_outstub"]


def _in_c(reg):
    lbl = _guniq("INC")
    seq = ["ld a,c", f"ld ({lbl}+1),a", f"{lbl}:", "in a,(0)"]
    if reg != 'a':
        seq += [f"ld {reg},a"]
    return seq


def _ixiy(mn, ops, idxinfo):
    cell, _ = idxinfo
    full = (mn + ' ' + ','.join(ops)).lower()

    # push/pop ix
    if mn == 'push':
        return ["ld (il_tmp),hl", f"ld hl,({cell})", "push hl", "ld hl,(il_tmp)"]
    if mn == 'pop':
        return ["ld (il_tmp),hl", "pop hl", f"ld ({cell}),hl", "ld hl,(il_tmp)"]
    # ld ix,nn
    if mn == 'ld' and ops[0].lower() in ('ix', 'iy'):
        nn = ops[1]
        return ["ld (il_tmp),hl", f"ld hl,{nn}", f"ld ({cell}),hl", "ld hl,(il_tmp)"]
    # ld ix,(nn) / ld (nn),ix
    if mn == 'ld' and ops[0].lower() in ('ix', 'iy') and ops[1].startswith('('):
        nn = ops[1][1:-1]
        return [f"ld hl,({nn})", f"ld ({cell}),hl"]
    if mn == 'ld' and ops[1].lower() in ('ix', 'iy') and ops[0].startswith('('):
        nn = ops[0][1:-1]
        return ["ld (il_tmp),hl", f"ld hl,({cell})", f"ld ({nn}),hl", "ld hl,(il_tmp)"]
    # inc/dec ix
    if mn in ('inc', 'dec') and ops[0].lower() in ('ix', 'iy'):
        s = 'inc' if mn == 'inc' else 'dec'
        return ["ld (il_tmp),hl", f"ld hl,({cell})", f"{s} hl", f"ld ({cell}),hl", "ld hl,(il_tmp)"]
    # add ix,rp
    if mn == 'add' and ops[0].lower() in ('ix', 'iy'):
        rp = ops[1].lower()
        rp = cell if rp in ('ix', 'iy') else rp
        if rp == cell:
            return ["ld (il_tmp),hl", f"ld hl,({cell})", "add hl,hl", f"ld ({cell}),hl", "ld hl,(il_tmp)"]
        return ["ld (il_tmp),hl", f"ld hl,({cell})", f"add hl,{rp}", f"ld ({cell}),hl", "ld hl,(il_tmp)"]
    # jp (ix)
    if mn == 'jp' and ops[0].lower() in ('(ix)', '(iy)'):
        return [f"ld hl,({cell})", "jp (hl)"]
    # (ix+d) memory operand forms: parse which op is the memory ref
    midx = None
    for i, o in enumerate(ops):
        if '(ix' in o.lower() or '(iy' in o.lower():
            midx = i
    if midx is None:
        return [f"; UNHANDLED IX/IY {full}"]
    inner = ops[midx]
    disp = re.sub(r'^\((ix|iy)', '', inner, flags=re.I)[:-1]   # strip "(ix" and ")"
    addr = _idx_addr(cell, disp)

    if mn == 'ld':
        if midx == 1:                      # ld r,(ix+d)
            r = ops[0].lower()
            if r == 'a':
                # ld a,(ix+d): Z80 leaves FLAGS unchanged, but the addr build's
                # add/adc clobber them. Save incoming A+F, load the target, then
                # restore F while keeping the loaded value (stashed in il_a).
                # (Was: no push af -> flags leaked, breaking e.g.
                #  `dec (ix+TIMER); ld a,(ix+TIMER); jr z,...` -> jr never taken.)
                return (["push af", "ld (il_tmp2),hl"] + addr
                        + ["ld a,(hl)", "ld hl,(il_tmp2)", "ld (il_a),a",
                           "pop af", "ld a,(il_a)"])
            seq = ["push af", "ld (il_tmp2),hl"] + addr + ["ld a,(hl)",
                   "ld hl,(il_tmp2)", f"ld {r},a", "pop af"]
            return seq
        else:                              # ld (ix+d),r  or  ld (ix+d),n
            src = ops[1]
            s = src.lower()
            if s == 'a':
                # Source is A, but the addr build clobbers A (it computes idx+disp via
                # ld a,l/add/ld a,h/adc). `ld a,a` cannot recover it -> stash A in il_a
                # first, build addr, then write the stashed value. (Was: wrote the
                # clobbered A = high byte of the pointer -> corrupted every actor field.)
                return (["push af", "ld (il_a),a", "ld (il_tmp2),hl"] + addr
                        + ["ld a,(il_a)", "ld (hl),a", "ld hl,(il_tmp2)", "pop af"])
            seq = ["push af", "ld (il_tmp2),hl"] + addr
            if s in ('b', 'c', 'd', 'e'):
                seq += [f"ld a,{src}", "ld (hl),a"]
            elif s in ('h', 'l'):
                # h/l were clobbered by addr build; read from saved il_tmp2
                byte = "(il_tmp2)" if s == 'l' else "(il_tmp2+1)"
                seq += [f"ld a,{byte}", "ld (hl),a"]
            else:                          # immediate n
                seq += [f"ld a,{src}", "ld (hl),a"]
            seq += ["ld hl,(il_tmp2)", "pop af"]
            return seq
    if mn in ('inc', 'dec'):
        # inc/dec (ix+d) sets flags from the result -> preserve A via il_a (ld doesn't
        # touch flags), NOT push/pop af (which would restore old flags).
        s = 'inc' if mn == 'inc' else 'dec'
        return ["ld (il_a),a", "ld (il_tmp2),hl"] + addr + [f"{s} (hl)",
                "ld hl,(il_tmp2)", "ld a,(il_a)"]
    if mn == 'bit':
        # BIT n,(ix+d): set Z = (bit==0). Consumed flag is Z only. Preserve A.
        n = ops[0]
        return ["ld (il_a),a", "ld (il_tmp2),hl"] + addr + ["ld a,(hl)",
                f"and 1<<{n}", "ld hl,(il_tmp2)", "ld a,(il_a)"]
    if mn in ('res', 'set'):
        n = ops[0]
        alu = f"and (~(1<<{n}))&255" if mn == 'res' else f"or 1<<{n}"
        return ["push af", "ld (il_tmp2),hl"] + addr + ["ld a,(hl)", alu, "ld (hl),a",
                "ld hl,(il_tmp2)", "pop af"]
    if mn in ('add', 'adc', 'sub', 'sbc', 'and', 'xor', 'or', 'cp'):
        # alu a,(ix+d): A is the operand, but the addr build clobbers A -> save A in
        # il_a, build addr, restore A, then operate on (hl). Flags = the alu result.
        alu = {'add': 'add a,', 'adc': 'adc a,', 'sub': 'sub ', 'sbc': 'sbc a,',
               'and': 'and ', 'xor': 'xor ', 'or': 'or ', 'cp': 'cp '}[mn]
        return ["ld (il_a),a", "ld (il_tmp2),hl"] + addr + ["ld a,(il_a)",
                f"{alu}(hl)", "ld hl,(il_tmp2)"]
    return [f"; UNHANDLED IX/IY {full}"]


def has_idx(body):
    """Detect IX/IY usage; return (cell, None) or None."""
    b = body.lower()
    if re.search(r'\(ix', b) or re.search(r'\bix\b', b):
        return ('z80_ix', None)
    if re.search(r'\(iy', b) or re.search(r'\biy\b', b):
        return ('z80_iy', None)
    return None


def translate(src):
    out = []
    inserted_scratch = False
    for line in src.split('\n'):
        label, body, comment = split_line(line)
        if not body:
            out.append(line)
            continue
        mn, ops = operands(body)
        idx = has_idx(body)
        seq = expand(mn, ops, idx)
        if seq is None:
            out.append(line)              # pass through (i8080 / directive)
            continue
        # emit: source label on its own line, then the i8080 sequence (tab-indented;
        # sub-labels at col0). Attach the source comment to the first emitted line.
        if label:
            out.append(label)
        emitted_comment = False
        for s in seq:
            is_label = s.endswith(':')
            ln = s if is_label else ('\t' + s)
            if not emitted_comment and comment:
                ln += '\t' + comment
                emitted_comment = True
            out.append(ln)
    return "\n".join(out)


def _apply_msx_glue(src):
    """Inject MSX-target glue into the PRISTINE GuillianSeed disassembly so a clean
    build reproduces the working ROM (no manual source edits). Idempotent — safe to run
    on already-glued source. Three pieces (see docs/JOURNAL.md for the why):
      1) startCode: enable cartridge page 2 (0x8000-0xBFFF) in the cart's own slot. The
         i8080 expansion grows the ROM past 16K into page 2, which a 16K cart never maps
         -> code there reads 0xFF = RST 38h storm. Read PPI slot reg (port 0xA8), copy
         page-1's slot into the page-2 field, write back.
      2) Retarget the H.TIMI hook to a tickMainISR wrapper that push/pop ALL shadow +
         scratch RAM cells around `call tickMain`. C-BIOS saves real regs but NOT our
         cells; a mid-macro interrupt would corrupt the interrupted code's shadow state
         (exx/ex af,af' via cells) -> e.g. the VRAM-fill counter, hanging init.
      3) The 3 VRAM output loops `exx / out (c),a / exx` -> direct `out (98h),a` (VDP
         data port is always 0x98 on MSX1). Removes ~52 instr/byte. Keeps the wrapping
         `ex af,af'` (it also paces VDP writes; TMS9918 needs ~29 cyc between accesses).
    """
    lines = src.split('\n')

    # (1) page-2 slot enable, right after startCode's `di`
    #     guard on the distinctive slot-select OUT (robust to comment wording)
    if not re.search(r'out\s*\(0A8h\)', src):
        for i, l in enumerate(lines):
            if l.startswith('startCode:'):
                di = i + 1
                while lines[di].strip() == '':
                    di += 1
                assert lines[di].strip() == 'di', f"expected di after startCode, got {lines[di]!r}"
                lines[di + 1:di + 1] = [
                    "; KV_MSX page2 slot enable: map 0x8000-0xBFFF to the cartridge slot",
                    "\t\tin\ta, (0A8h)", "\t\tld\tc, a", "\t\tand\t0Ch",
                    "\t\tadd\ta, a", "\t\tadd\ta, a", "\t\tld\tb, a",
                    "\t\tld\ta, c", "\t\tand\t0CFh", "\t\tor\tb", "\t\tout\t(0A8h), a"]
                break

    # (2) H.TIMI hook -> tickMainISR wrapper
    if 'tickMainISR:' not in src:
        for i, l in enumerate(lines):
            if 'hl, tickMain' in l and i + 1 < len(lines) and 'H_TIMI' in lines[i + 1]:
                lines[i] = l.replace('hl, tickMain', 'hl, tickMainISR')
                break
        wrap = ["", "; KV_MSX interrupt wrapper: preserve shadow/scratch RAM cells", "tickMainISR:"]
        for c in SCRATCH:
            wrap += [f"\t\tld\thl, ({c})", "\t\tpush\thl"]
        wrap += ["\t\tcall\ttickMain"]
        for c in reversed(SCRATCH):
            wrap += ["\t\tpop\thl", f"\t\tld\t({c}), hl"]
        wrap += ["\t\tret", ""]
        for i, l in enumerate(lines):
            if l.startswith('tickMain:'):
                lines[i:i] = wrap
                break

    # (3) VRAM `exx / out (c),a / exx` -> direct out(98h),a  (naturally idempotent)
    i = 1
    while i < len(lines) - 1:
        s = lines[i].strip().replace('\t', ' ').split(';')[0].strip()
        if s in ('out (c), a', 'out (c),a') and lines[i - 1].strip() == 'exx' and lines[i + 1].strip() == 'exx':
            lines[i - 1:i + 2] = ["\t\tout\t(98h), a\t; KV_MSX: direct VDP data port 0x98 (was exx/out(c)/exx)"]
        else:
            i += 1
    return '\n'.join(lines)


def _gen_blit_loops():
    """БЛИТТЕР v3: 8 row-петель, специализированных по X&7-сдвигу. Каждая — с КОНСТАНТНЫМИ
    масками (0xFF>>s / ~) и ИНЛАЙН-ротацией (s подряд rrca, без jp/цикла), убирает per-row
    чтения ld a,(vnc_mask) (13т ×2/ряд) и jp-накладные v2. Диспатч раз на полустолбец через
    rot_tab (jump-table). Пиксель-в-пиксель как v2/база (та же операция: s rrca + маска+spill)."""
    out = ["; ===== BLITTER v3: 8 shift-specialized row loops (const masks, inline rot) =====",
           "rot_tab:",
           "\tdw\trot0_loop, rot1_loop, rot2_loop, rot3_loop",
           "\tdw\trot4_loop, rot5_loop, rot6_loop, rot7_loop"]
    # MASKED-петля (ANDN): ОДНА универсальная (сдвиг из ячейки, маски из таблицы) вместо
    # 8 специализированных — те заняли бы 455Б и перелезли в зону переменных (запас 231Б).
    # Спрайт становится НЕПРОЗРАЧНЫМ: в своих пикселях гасит чужую плоскость (p &= ~s), иначе
    # биты складываются с фоном (створка p1+p2 над кирпичом p0 = idx14 «гем-зелёный»).
    # Медленнее специализированных, но masked идёт только по створкам ворот (статичны, редки).
    if _8C_MASK:
        out += ["rotm_masks:", "\tdb\t0FFh, 07Fh, 03Fh, 01Fh, 00Fh, 007h, 003h, 001h",
                "rotm_loop:",
                "\tld\tde, (vnc_patc)",
                "\tld\ta, (vw_spry)", "\tcpl", "\tld\tl, a",
                "\tld\ta, (vnc_hi)", "\tld\th, a",
                "\tld\ta, 16", "\tld\t(vnm_rows), a",
                "rotm_row:",
                "\tld\ta, (de)", "\tinc\tde",
                "\tor\ta", "\tjp\tz, rotm_next",
                "\tld\tc, a", "\tld\ta, (vnm_shift)", "\tld\tb, a", "\tld\ta, c",
                "\tinc\tb", "\tjp\trotm_shc",
                "rotm_sh:", "\trrca",
                "rotm_shc:", "\tdec\tb", "\tjp\tnz, rotm_sh",
                "\tld\tb, a",                                   # B = сдвинутый байт
                "\tld\ta, (vnm_mask)", "\tand\tb",            # текущий столбец
                "\tcpl", "\tand\t(hl)", "\tld\t(hl), a",     # p &= ~s
                "\tld\ta, (vnm_nmask)", "\tand\tb",           # spill в следующий столбец
                "\tor\ta", "\tjp\tz, rotm_next",
                "\tld\tc, a",
                "\tld\ta, h", "\tand\t1Fh", "\tcp\t1Fh", "\tjp\tz, rotm_next",  # столбец 31
                "\tinc\th", "\tld\ta, c", "\tcpl", "\tand\t(hl)", "\tld\t(hl), a", "\tdec\th",
                "rotm_next:",
                "\tdec\tl",
                "\tld\ta, (vnm_rows)", "\tdec\ta", "\tld\t(vnm_rows), a",
                "\tjp\tnz, rotm_row", "\tret"]
    for s in range(8):
        mask = 0xFF >> s
        nmask = (~mask) & 0xFF
        out.append(f"rot{s}_loop:")
        out += ["\tld\tde, (vnc_patc)",                       # DE = pattern ptr
                "\tld\ta, (vw_spry)", "\tcpl", "\tld\tl, a",   # L = 255-Y
                "\tld\ta, (vnc_hi)", "\tld\th, a",             # HL = VRAM
                "\tld\tb, 16"]
        out.append(f"rot{s}_row:")
        out += ["\tld\ta, (de)", "\tinc\tde",
                "\tor\ta", f"\tjp\tz, rot{s}_next"]
        # инлайн-ротация вправо на s. Для s>=5 rot-right-s == rot-left-(8-s): rlca×(8-s)
        # ДЕШЕВЛЕ (s=5:3, s=6:2, s=7:1 rlca вместо 5/6/7 rrca). Байт бит-в-бит тот же;
        # CY (rlca меняет иначе) не используется — следующий `and mask` его сбрасывает.
        out += (["\trlca"] * (8 - s)) if s >= 5 else (["\trrca"] * s)
        # 8-цв композит: XOR-draw (обратимо -> самостирание восстанавливает фон);
        # A+/COLOR2/8цв-без-спрайтов: OR-draw (спрайт в отдельной плоскости, стирание=clear_box).
        _dop = "xor" if _8C_SPRITES else "or"
        if s == 0:
            out += [f"\t{_dop}\t(hl)", "\tld\t(hl), a"]        # draw, маска 0xFF
        else:
            out += ["\tld\tc, a",                              # C = rotated
                    f"\tand\t{mask}",                          # текущий столбец (const)
                    f"\t{_dop}\t(hl)", "\tld\t(hl), a",        # draw
                    "\tld\ta, c", f"\tand\t{nmask}", "\tld\tc, a",  # spill (const)
                    "\tor\ta", f"\tjp\tz, rot{s}_next",
                    # ПРАВЫЙ КРАЙ (плоскостно-независимо, ФИКС 2026-07-15): спилл в col+1
                    # НЕ рисуем, если текущий столбец = 31. Индекс столбца = h&0x1F
                    # (hi = plane_base|col). Раньше `cp 0FFh` ловил край ТОЛЬКО для p3
                    # (0xE0|0x1F=0xFF); для p2 (0xC0|0x1F=0xDF) спилл делал inc h->0xE0 и
                    # УТЕКАЛ в p3 col0 (0xE000)=ЛЕВЫЙ край -> мумия (col&8->p2) у правого
                    # края появлялась слева. `and 1Fh; cp 1Fh` покрывает ОБЕ плоскости.
                    "\tld\ta, h", "\tand\t1Fh", "\tcp\t1Fh", f"\tjp\tz, rot{s}_next",  # столбец 31 -> без спилла
                    "\tinc\th", "\tld\ta, c", f"\t{_dop}\t(hl)", "\tld\t(hl), a", "\tdec\th"]  # draw (spill)
        out.append(f"rot{s}_next:")
        out += ["\tdec\tl", "\tdec\tb", f"\tjp\tnz, rot{s}_row", "\tret"]
    return out


# ===================== Konami-logo direct bitmap renderer =====================
# The MSX intro draws the stylised "KONAMI(R)" wordmark by unpacking GFX_KonamiLogo
# into VDP pattern slots 0x60-0x7a and writing name codes 0x60-0x79 in a 3/11/12
# layout that rises up the screen. On the Vector build the KV-title tileset (shifted
# to 0x40-0x78) clobbers the shared pattern-shadow slots 0x60-0x78, so the soft-VDP
# path renders the logo as garbage. This module bypasses the VDP/name/soft-VDP path
# entirely: the 26 logo tiles (+ the 0x7a underline) are decoded once at build time
# and blitted DIRECTLY into framebuffer planes 0+1 (white) at the animated position.
#
# Compositor coherency: the name-cell compositor blits name_shadow[cell] through
# pattern_shadow. To keep it from ever drawing garbage over our direct blit we point
# name_shadow[logo cell] at a BLANK MARKER tile 0x7b (its pattern-shadow is zeroed in
# native loadKonamiLogo, and 0x7b is above the KV-title range so nothing reloads it).
# A stray compositor drain then blits BLANK (never garbage); dibujaLogo re-blits the
# clean logo every 2 frames; and the sub2 clearScreen (marker!=0 -> write 0) properly
# erases the logo when transitioning to the KING'S VALLEY title.
_KL_MARKER = 0x7b
_KONAMI_LOGO = "\n".join([
    "; ===== Streaming RLE decoder (unpackGFX format) -> DIRECT to framebuffer =====",
    "; The packed logo (GFX_KonamiLogo, unpackGFX RLE) is decoded STRAIGHT into the",
    "; framebuffer (planes 0+1) with NO transient RAM image: no decoded ROM copy AND no",
    "; sprite-shadow scratch. The one concession to the fact that RLE fill/copy runs cross",
    "; 8-byte tile boundaries is an 8-BYTE one-tile scratch (vec_kl_scr, in real work RAM,",
    "; NOT the sprite pattern shadow): the stream is pulled one byte at a time, a full tile",
    "; is assembled in those 8 bytes, then blitted to its FB cell; repeat for the next tile.",
    "; The logo is a non-hot intro screen, so re-decoding the ~151 packed bytes on every",
    "; rise frame (vec_konami_logo, ~14 times) is cheap and needs no persistent buffer.",
    ";",
    "; Stream grammar (each token): +0 = count N.",
    ";   (N&7F)!=0, bit7=0 -> FILL: emit (N&7F) copies of the next byte.",
    ";   (N&7F)!=0, bit7=1 -> COPY: emit (N&7F) following literal bytes.",
    ";   N==0            -> TERMINATOR (end of stream; not reached before the 26 rise tiles).",
    "; State: vec_kl_src = packed cursor, vec_kl_rem = bytes left in run, vec_kl_mode",
    ";   (0=fill,1=copy), vec_kl_val = fill byte. Init: src=data, rem=0 (see vec_konami_logo).",
    "; vec_kl_next: return the next decoded stream byte in A. clobbers A,C,HL.",
    "vec_kl_next:",
    "\tld\ta, (vec_kl_rem)", "\tor\ta", "\tjp\tnz, vkn_have",   # still inside current run
    "\tld\thl, (vec_kl_src)",                            # fetch a fresh token
    "\tld\ta, (hl)", "\tand\t7Fh", "\tld\tc, a",         # C = N&7F, Z if 0
    "\tjp\tz, vkn_zero",                                 # N&7F==0 -> terminator (return 0)
    "\tld\ta, (hl)", "\tinc\thl",                        # A = full N, HL -> data
    "\tand\t80h", "\tjp\tz, vkn_fill_setup",             # bit7=0 -> fill
    "\tld\ta, 1", "\tld\t(vec_kl_mode), a", "\tjp\tvkn_store",   # copy
    "vkn_fill_setup:",
    "\txor\ta", "\tld\t(vec_kl_mode), a",
    "\tld\ta, (hl)", "\tinc\thl", "\tld\t(vec_kl_val), a",      # capture fill value
    "vkn_store:",
    "\tld\ta, c", "\tld\t(vec_kl_rem), a", "\tld\t(vec_kl_src), hl",
    "vkn_have:",
    "\tld\ta, (vec_kl_mode)", "\tor\ta", "\tjp\tnz, vkn_copy_byte",
    "\tld\ta, (vec_kl_val)", "\tjp\tvkn_dec",            # fill: A = value
    "vkn_copy_byte:",
    "\tld\thl, (vec_kl_src)", "\tld\ta, (hl)", "\tinc\thl", "\tld\t(vec_kl_src), hl",
    "vkn_dec:",
    "\tld\tc, a", "\tld\ta, (vec_kl_rem)", "\tdec\ta", "\tld\t(vec_kl_rem), a", "\tld\ta, c",
    "\tret",
    "vkn_zero:", "\txor\ta", "\tret",                    # end of stream -> 0
    "; vec_kl_decode_tile: pull 8 bytes from the stream into vec_kl_scr; HL=scratch on exit.",
    ";   preserves the caller's C (tile col). clobbers A,B,D,E,HL. vec_kl_next touches only",
    ";   A,C,HL, so B (loop count) and DE (dest cursor) survive it -> no per-byte push/pop.",
    "vec_kl_decode_tile:",
    "\tld\ta, c", "\tpush\taf",                          # save col (C) cheaply
    "\tld\tde, vec_kl_scr", "\tld\tb, 8",
    "vkdt2:",
    "\tcall\tvec_kl_next", "\tld\t(de), a", "\tinc\tde",
    "\tdec\tb", "\tjp\tnz, vkdt2",
    "\tpop\taf", "\tld\tc, a",                           # restore col
    "\tld\thl, vec_kl_scr", "\tret",
    "",
    "; ---- Konami logo: direct bitmap render (bypasses VDP patterns/name/soft-VDP) ----",
    "; blit one 8-row tile to planes 0+1 (white). in: C=col, (vec_kl_low)=top fb low byte,",
    ";   HL=src pattern (advances by 8). clobbers A,B,D,E.",
    "vec_kl_tile:",
    "\tld\ta, c", "\tadd\ta, 80h", "\tld\td, a",        # D = plane0 hi (0x80+col)
    "\tld\ta, (vec_kl_low)", "\tld\te, a",              # E = top row low byte
    "\tld\tb, 8",
    "vklt2:",
    "\tld\ta, (hl)", "\tld\t(de), a",                   # plane0
    "\tld\ta, d", "\tadd\ta, 20h", "\tpush\tde", "\tld\td, a",
    "\tld\ta, (hl)", "\tld\t(de), a", "\tpop\tde",       # plane1 (white)
    "\tinc\thl", "\tdec\te", "\tdec\tb", "\tjp\tnz, vklt2",
    "\tret",
    "; draw a run of B consecutive tiles by STREAM-DECODING each straight to the FB.",
    ";   Each tile is decoded from the packed stream into vec_kl_scr, then blitted; the",
    ";   stream cursor advances across the run (and across the 3 rows of the logo).",
    ";   in: B=count, (vec_kl_row),(vec_kl_col),(vec_kl_tn), stream state pre-inited.",
    "vec_kl_run:",
    "\tld\ta, (vec_kl_row)", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl",  # 255-row*8
    "\tld\t(vec_kl_low), a",
    "\tld\ta, (vec_kl_col)", "\tld\tc, a",
    "vklr2:",
    "\tpush\tbc", "\tcall\tvec_kl_decode_tile",          # HL=vec_kl_scr (next tile), B,C kept
    "\tcall\tvec_kl_tile", "\tpop\tbc",
    "\tinc\tc", "\tdec\tb", "\tjp\tnz, vklr2",
    "\tret",
    "; draw B copies of the SAME tile (HL fixed) - used for the underline row.",
    "vec_kl_fillrun:",
    "\tld\ta, (vec_kl_row)", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl",
    "\tld\t(vec_kl_low), a",
    "\tld\ta, (vec_kl_col)", "\tld\tc, a",
    "vklf2:",
    "\tpush\tbc", "\tpush\thl", "\tcall\tvec_kl_tile", "\tpop\thl", "\tpop\tbc",
    "\tinc\tc", "\tdec\tb", "\tjp\tnz, vklf2",
    "\tret",
    "; clear B tiles: framebuffer p0+p1 = 0 and name_shadow = 0 (honest for dedup).",
    "vec_kl_clear:",
    "\tld\ta, (vec_kl_row)", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl",
    "\tld\t(vec_kl_low), a",
    "\tld\ta, (vec_kl_col)", "\tld\tc, a",
    "vklc2:",
    "\tpush\tbc",
    "\tld\ta, c", "\tadd\ta, 80h", "\tld\td, a",
    "\tld\ta, (vec_kl_low)", "\tld\te, a",
    "\tld\tb, 8",
    "vklc3:",
    "\txor\ta", "\tld\t(de), a",
    "\tld\ta, d", "\tadd\ta, 20h", "\tpush\tde", "\tld\td, a", "\txor\ta", "\tld\t(de), a", "\tpop\tde",
    "\tdec\te", "\tdec\tb", "\tjp\tnz, vklc3",
    "\tpop\tbc",
    "\tinc\tc", "\tdec\tb", "\tjp\tnz, vklc2",
    "\tret",
    "; ---- dibujaLogo replacement: rise one row, blit 3 logo rows, clear trailing row.",
    ";   returns Z when gameLogoCnt hits 0 (contract: caller does `ret nz`).",
    "vec_konami_logo:",
    "\tld\thl, (CoordKonamiLogo)", "\tld\tde, 0-20h", "\tadd\thl, de", "\tld\t(CoordKonamiLogo), hl",
    "\tld\tde, 0-3800h", "\tadd\thl, de",               # HL = cell (0..767)
    "\tld\ta, l", "\tand\t1Fh", "\tld\t(vec_kl_col), a",       # col
    "\tld\ta, l", "\tand\t0E0h", "\trlca", "\trlca", "\trlca", "\tld\tc, a",  # L>>5
    "\tld\ta, h", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tor\tc",     # H*8 | L>>5
    "\tld\t(vec_kl_row), a",                            # top tile row
    "\tld\ta, " + hex(_KL_MARKER).replace("0x", "0") + "h", "\tld\t(vec_kl_tn), a",  # blank marker
    "\tld\thl, GFX_KonamiLogo", "\tld\t(vec_kl_src), hl",  # init streaming RLE decoder cursor
    "\txor\ta", "\tld\t(vec_kl_rem), a",                # rem=0 -> first vec_kl_next fetches a token
    "\tld\tb, 3", "\tcall\tvec_kl_run",                 # row0: tiles 0x60-0x62 (stream-decoded)
    "\tld\ta, (vec_kl_row)", "\tinc\ta", "\tld\t(vec_kl_row), a",
    "\tld\tb, 0Bh", "\tcall\tvec_kl_run",              # row1: tiles 0x63-0x6d (11)
    "\tld\ta, (vec_kl_row)", "\tinc\ta", "\tld\t(vec_kl_row), a",
    "\tld\tb, 0Ch", "\tcall\tvec_kl_run",              # row2: tiles 0x6e-0x79 (12)
    "\tld\ta, (vec_kl_row)", "\tinc\ta", "\tld\t(vec_kl_row), a",
    "\tld\tb, 0Ch", "\tcall\tvec_kl_clear",            # clear trailing row below the logo
    "\tld\thl, gameLogoCnt", "\tdec\t(hl)",             # Z when the rise is complete
    "\tret",
    "; ---- underline + SOFTWARE (replaces `ld de,TXT_Sofware / call unpackGFXset`).",
    ";   underline: 0x7a bitmap, direct. SOFTWARE: font tiles via vec_blit_tile (native,",
    ";   like the HUD) wrapped in di + forced isr-depth (SP-hijack blitter -> atomic).",
    "vec_konami_text:",
    "\tld\ta, 0Ah", "\tld\t(vec_kl_row), a",           # underline row 10
    "\tld\ta, 0Ah", "\tld\t(vec_kl_col), a",           # cols 10..21
    "\tld\ta, " + hex(_KL_MARKER).replace("0x", "0") + "h", "\tld\t(vec_kl_tn), a",
    "\tld\thl, vec_kl_underline",                       # tile 0x7a (underline) bitmap, inline
    "\tld\tb, 0Ch", "\tcall\tvec_kl_fillrun",
    "\tld\ta, (vec_isr_depth)", "\tpush\taf",           # SOFTWARE via vec_blit_tile
    "\tld\ta, 1", "\tld\t(vec_isr_depth), a",           # force !=0 so vbt_row keeps DI
    "\tdi",
    "\tld\thl, vec_konami_sw",
    "\tld\ta, 0Ch", "\tld\t(vec_kl_col), a",            # SOFTWARE at col 12, row 11
    "vkst2:",
    "\tld\ta, (vec_kl_col)", "\tcp\t14h", "\tjp\tnc, vkst_done",  # cols 12..19
    "\tpush\thl",
    "\tld\ta, (hl)", "\tld\t(vw_byte), a",              # font tile
    "\tld\ta, 0Bh", "\tld\t(vec_kl_row), a",
    "\tld\ta, (vec_kl_col)", "\tld\tc, a",
    "\tld\tb, 0Bh",                                     # row 11
    "\tld\ta, (vec_kl_col)", "\tld\tc, a",              # col
    "\tcall\tvec_blit_tile",
    "\tpop\thl", "\tinc\thl",
    "\tld\ta, (vec_kl_col)", "\tinc\ta", "\tld\t(vec_kl_col), a",
    "\tjp\tvkst2",
    "vkst_done:",
    "\tpop\taf", "\tld\t(vec_isr_depth), a", "\tor\ta", "\tjp\tnz, vkst_di", "\tei",
    "vkst_di:",
    "\tret",
    "vec_konami_sw:",
    "\tdb\t33h, 2Fh, 26h, 34h, 37h, 21h, 32h, 25h",    # "SOFTWARE" font tiles
    "vec_kl_underline:",                                # tile 0x7a: single horizontal rule
    "\tdb\t00h, 00h, 00h, 0FFh, 00h, 00h, 00h, 00h",
    "; (No decoded logo bitmap in ROM: the 26 rise tiles are stream-decoded straight to the",
    ";  framebuffer from the packed GFX_KonamiLogo on each frame - see vec_kl_next/run.)",
])

# ===================== Vector-06C target glue =====================
# Step 1 (boot + sound): rebase to a flat Vector image (game at 0x0100, vector page
# at 0, RST7 vblank -> the game's H.TIMI hook), relocate work RAM off the framebuffer
# (0xE000 -> 0x6800), redirect the MSX BIOS video/PSG calls to Vector routines. Video
# routines are STUBS for now (VRAM writes vanish, no rendering); PSG -> AY 0x14/0x15.
_VECTOR_RUNTIME = "\n".join([
    "",
    "; ===== Vector-06C runtime (target=vector) - Step 1: boot + AY sound =====",
    "; Video RAM 0x8000-0xFFFF (4 planes). AY 0x14/0x15. RST7 vblank @0x38.",
    "; Video BIOS are STUBS here (VRAM writes vanish) - no rendering yet.",
    # ALL soft-VDP shadows now live ENTIRELY in plane 2 (0xC000-0xDFFF, 8K) - plane 3
    # (0xE000-0xFFFF) is fully vacated for future sprites. This fits because the bg
    # pattern AND colour tables are COMPRESSED from 3 SCREEN2 banks (6K) to a single
    # bank (2K): verified that for every tile actually used in gameplay the pattern
    # AND colour bytes are IDENTICAL across all 3 banks (40/40 tiles checked) - the
    # game loads the same tileset into all 3 banks (fillVRAM3Bank), so the per-bank
    # copies are redundant. Access sites drop the bank term (see vw_wcol/vw_colw/
    # vec_blit_tile/vec_calc_mode/rv_patn/rv_col/vec_de_ok/vec_de_col: `and 7` folds
    # the incoming bank-relative hi-byte onto the single 2K copy).
    # vec_sat_shadow УДАЛЁН (Stage1 soft-VDP: 0 записей/чтений, SAT-тень мёртвая)
    # ШАГ4b/c: тень спрайт-паттернов СЖАТА 2К->768Б и переселена из 0xC080 (ВИДИМАЯ p2, целевой
    # регион под цветные спрайты) в МЁРТВЫЙ хвост pat-тени 0xCD00-0xD000 (был свободен, см. ниже
    # «pat-тень 0xCD60-0xD100 мёртвая» + full-VRAM заливка стоп на 0xCD00). Живой набор спрайтов
    # = hero(VRAM 0x1800-0x193F) + momia(0x1940-0x199F) + sprites2(0x1EA0-0x1FFF) = 320+96+352=768Б;
    # зеркала (0x60+) генерятся на лету (шаг4a), gaps (0x19A0-0x1EA0) НЕ хранятся. Компактная
    # раскладка vec_spr_buf: hero+momia -> buf+(pat&0xFC)*8 (0..0x1A0); sprites2 -> buf+(pat-0xA0)*8
    # (0x1A0..0x300). ЭФФЕКТ: 0xC080-0xC87F (2К ВИДИМОЙ p2) ПОЛНОСТЬЮ свободен; потрачено 768Б в
    # ранее-свободном 0xCD00 -> ЧИСТЫЙ выигрыш ~1.25К p2. (Запечь в НИЖНИЙ 32K-образ невозможно:
    # образ полон, код кончается ~0x6866, до pat_maze_cell 0x6880 ~26Б; распакованные спрайты
    # 2x упакованных -> нетто +214Б >> 26Б, даже с реклеймом packed-GFX 1066Б. См. отчёт/49cd6c0.)
    # Фаза A+ шаг5: spr-буфер ВЫНЕСЕН из p2 (0xCD00) в low-RAM дыру1 (после кода, перед maze),
    # чтобы ОСВОБОДИТЬ ВСЮ видимую p2 под ЦВЕТНЫЕ спрайты. Код кончается на 0x6597 (ret vec_ldir_bwd,
    # см. .lst), maze-кэш вплотную за буфером. 768Б (=0x300): 0x6598..0x6897. pat_maze_cell при этом
    # сдвинут 0x6880->0x6898 (+24Б), т.к. деинфляция ldir/exx освободила лишь 744Б (0x6598-0x6880) —
    # на 24Б меньше буфера; сдвиг съедает 24Б из 32Б запаса над maze (0x6AE0-0x6B00), maze теперь
    # 0x6898-0x6AF8 (< 0x6B00 game vars, 8Б запас). ЭФФЕКТ: p2 0xCD00-0xD000 (768Б) ПОЛНОСТЬЮ свободен.
    _SPRBUF_EQU,     # compact sprite pattern buffer (768B). base: low-RAM hole1; _8COLOR: p3 0xE800
    # vec_sat_drawn УДАЛЁН (Stage1 soft-VDP: 0 пользователей)
    # ЗАДАЧА #5: vec_pat_shadow @0xC900 (2КБ p2) — МЁРТВ под _MAPDIRECT (pb_p2 целит в
    # pat_menu_base low-RAM, 0 живых ссылок на этот equ). Эмитим ТОЛЬКО при NO_MAPDIRECT
    # (единственный юзер — ветка pb_p2 без mapdirect). Итог: регион p2 0xC900-0xD0FF свободен.
    *((["vec_pat_shadow: equ 0C900h"]) if not _MAPDIRECT else ()),  # bg pattern shadow (p2, invisible) — dead under MAPDIRECT
    # Фаза A+ шаг3: компактный фон-кэш паттернов ПЕРЕНЕСЁН из p2 в work-RAM дыры (освобождает
    # p2 под будущие спрайты). Индексация блиттером ПРЯМАЯ base+tile*8 с РАЗНЫМИ базами по
    # диапазону tile (развилка pat_base): лабиринт 0x40-0x8b -> дыра1 @0x6810 (608Б); шрифт
    # HUD 0x10-0x3f -> дыра2 @0x7CFF (384Б). Тайлы 0x8c-0xff (диапазон меню) фолдятся в pb_p2,
    # НО их pat-тень 0xCD60-0xD100 теперь МЁРТВАЯ: тайлсеты ВСЕХ неигровых экранов (меню/титул
    # KING'S VALLEY/пирамида/финал setupEnding) уже эвакуированы прошлой фазой в тайлы 0x40-0x78
    # (VDP -0x280, см. remap в _apply_vector_glue), поэтому в 0x8c-0xff НИЧЕГО не грузится
    # (nonzero maxWrite=none) и НИЧЕГО не читается (maxRead=none) — проверено во всех экранах.
    # Хвост выведен и из full-VRAM заливки (vec_fa_sh стоп на 0xCD00, как и для прочих free-
    # хвостов p2) => свободен под будущие спрайты (одноразовое boot-зануление vec_init_clr его
    # ещё касается, как и все free-зоны p2; scratch уже НЕ в p2 — унесён в low-RAM).
    # base = cell - firstTile*8 (виртуальная база; реально адресуется только tile своего диапазона).
    # ШАГ4a: pat_maze_cell СДВИНУТ 0x6810->0x6880 (+112Б). Причина: код НАРАСТИЛ хвост
    # (on-the-fly зеркало vec_nsx: mirror-detect + vnsx_rev16) — блиттер+блит-петли теперь
    # кончаются ~0x6867 (было 0x680F в base, упаковано БАЙТ-в-БАЙТ до 0x6810). Без сдвига
    # maze-буфер (UnpackPatterns в pat_maze_cell при загрузке уровня) ЗАТИРАЛ бы код rot-петель
    # -> спрайты-мусор/derail -> StartGame(GS4) висел. Сдвиг съедает верхний резерв дыры1
    # (было свободно 0x6A70-0x6B00=144Б): maze 0x6880-0x6AE0 (608Б) < 0x6B00 (game vars),
    # код 0x6810-0x687F (~0x19 резерв). base=cell-0x200=0x6680.
    # ШАГ5: pat_maze_cell СДВИНУТ 0x6880->0x6898 (+24Б), чтобы освободить 768Б (0x6598-0x6898) под
    # vec_spr_buf вплотную к коду (кончается 0x6597). maze 0x6898-0x6AF8 (< 0x6B00, запас 8Б).
    "pat_maze_cell: equ 0%04Xh" % _MAZE_ADDR,     # дыра1: maze pat, tiles 0x40-0x8b = 608Б; _8COLOR: p3 0xEB00
    "pat_maze_base: equ pat_maze_cell-0200h",  # 0x40*8=0x200 => base=0x6698 (адресуется лишь tile>=0x40)
    # MAPDIRECT: база low-RAM для pb_p2-диапазона (тайлы 0x8c-0xff = folded 0x460-0x7FF). Реально
    # адресуется ТОЛЬКО картой: тайлы 0xC0-0xE7 = folded 0x600-0x73F -> pat_maze_cell..+0x140Б (40
    # тайлов*8=320Б, в пределах 608Б pat_maze_cell, свободного во время карты — лабиринт не показан).
    # base=cell-0x600 => folded 0x600 -> pat_maze_cell (0x6898), 0x73F -> 0x69D7. Мёртвые folded
    # 0x460-0x5FF/0x740-0x7FF не пишутся/не читаются ни в одном экране. Виртуальная база, equ, 0 байт.
    *((["pat_menu_base: equ pat_maze_cell-0600h"]) if _MAPDIRECT else ()),
    "pat_font_cell: equ 0%04Xh" % _FONT_ADDR,     # дыра2: font pat, tiles 0x10-0x3f = 384Б; base 0x7D05; _8COLOR: p3 0xED60
    # ЗАДАЧА#1 СТРИМ ШРИФТА: pat_font_base -> ROM-таблица vec_font_rom (декод GFX_Font, эмитится
    # в _apply_vector_glue перед MAP-блоком). vbt_core читает глиф из ROM => шрифт НЕ в p3 =>
    # призрак невозможен. KV_NO_FONTSTREAM -> резидентный кэш в p3 (pat_font_cell).
    ("pat_font_base: equ vec_font_rom-080h" if _FONTSTREAM else
     "pat_font_base: equ pat_font_cell-080h"),   # 0x10*8=0x80 => base адресуется лишь tile 0x10-0x3f
    # tilecnt is GONE: its gate is fully subsumed by the reverse-map cache
    # (rmap hit with count=0 == "tile not on screen"). Its 768B now hold the
    # NAME-TABLE SHADOW - which as a MAP cell had grown past 0x8000 INTO THE
    # FRAMEBUFFER (bottom-left garbage lines + trash cells near (c)KONAMI).
    # 0xD100-0xD3FF СВОБОДНО в плане 2: тень name_shadow УДАЛЕНА (Фаза B: 0 чтений в
    # геймплее — dedup через name не работал, никто не читал; см. отчёт). 768Б под спрайты.
    # Фаза C1: vec_col_shadow (2К colour-table shadow @0xD400) СНЯТА из p2. render-mode
    # считается инкрементально при загрузке цвета (vec_col_store, фрагменто-безопасно).
    # P2-ЧИСТКА: построчный цвет mixed-тайлов держим SLOT-компактно. Реальных mixed-тайлов
    # всего 15 (лестницы/переходы, замер tilemode_dump.js) -> vec_mixslot[tile-0x50]=slot(1..15)
    # (page-база 0xD100, индекс tile-0x50, читается лишь для tile в [0x50,0x90) => занято
    # 0xD100-0xD13F=64Б; 0=не mixed из vec_init_clr, 15 слотов заполняются в vec_init из
    # vec_mixtiles), а построчный цвет только для 15 слотов: vec_mixbuf, 15*8=120Б @0xD400.
    # Было 256Б revlut + 512Б mixcol = 768Б, стало 64Б mixslot + 120Б mixbuf = 184Б => -584Б p2.
    # P2-ФИНАЛ: vec_mixslot LUT (64Б @0xD100) УДАЛЁН. slot тайла берётся ЛИНЕЙНЫМ сканом
    # 15-байтной ROM-таблицы vec_mixtiles (vec_slot_of): нет page-aligned/≥52Б дыры в low-RAM
    # под LUT, а скан дёшев (once/tile в vbt_mix, редко в vec_col_store). => -64Б p2, +0Б low-RAM.
    # P2-ФИНАЛ: vec_mixbuf вынесен из p2 в ХВОСТ-ДЫРУ low-RAM после шрифта (pat_font кончается
    # 0x7E7F, vec_tilemode 0x7F00 => дыра 129Б). 120Б: 0x7E7F-0x7EF7 (< 0x7F00, запас 9Б).
    # dad-индексируется (ld de,vec_mixbuf-8; add hl,de) => адрес свободный, только equ.
    "vec_mixbuf:     equ 07E85h",    # per-row colour of 15 mixed tiles, 15 slots x8 = 120B (0x7E85-0x7EFD, СДВИГ +6; il_tmp2 0x7EFE)
    # vec_tilemode: render-mode кэш в work-RAM. Байт: bit7=white, биты6-3=mix-слот(0-15,
    # для mode4), биты2-0=mode(0=blank 1=pat 2=~pat 3=solid 4=mix). FF=не вычислен(dirty).
    "vec_tilemode:   equ 07F00h",    # per-tile render mode, 256B work-RAM (см. формат байта выше)
    *_POPBG_EQU,                     # POP-кэш фона zero-page (0x40-0x52, 0 байт кода — только equ)
    # ФАЗА 1 8-ЦВЕТ scratch (zero-page 0x53-0x54, свободна; только equ, 0 байт кода):
    *((["vbt8_e:      equ 00053h",    # 1B Etop = 255-row*8 (low-байт адреса плоскости)
        "vbt8_c8:     equ 00054h",    # 1B цвет-код тайла cc = vec_col8[tile]
        "vbt8_wf:     equ 00055h"]) if _8COLOR else ()),  # 1B white-флаг (p1)
    # RENDER-LIST save-under буфер: 21 слот x 64Б в СВОБОДНОЙ p3 (схлопнута => невидима;
    # спрайты в 8-цв идут в p1/p2, p3 не рисуется => 0xE000+ чист под приватный кэш).
    # Слот=64Б: [0]=valid [1]=hi0 [2]=lo0 [3]=ncols [4..] data(48Б). 21*64=0x540 -> 0xE000-0xE53F.
    # Занулён на boot (vec_init_clr чистит все 4 плоскости) => valid=0=пусто. HideSprites (смена
    # комнаты) чистит 0xC000-0xFFFF => слоты инвалидируются на переходе (фон перерисуется заново).
    *((["vec_spr_save:  equ 0E000h",   # слоты save-under (64Б; 128Б dual при _8C_AURA)
        "vsu_hi:        equ 0%04Xh" % _SCR(0),  # 1B: текущий hi (plane+col)
        "vsu_lo:        equ 0%04Xh" % _SCR(1)]) if _8C_RLIST else ()),  # 1B: lo0
    # _8C_RL2 fixup-скретч (хвост p3 за слотами, до z80-scratch 0xFFC0):
    *((["vsu_any:       equ 0%04Xh" % _SCR(2),  # 1B: 1=есть валидные слоты
        "vfx_idx:       equ 0%04Xh" % _SCR(3),  # 1B: индекс слота fixup
        "vfx_ytop:      equ 0%04Xh" % _SCR(4),  # 1B: верхний y клетки
        "vfx_col:       equ 0%04Xh" % _SCR(5),  # 1B: столбец клетки
        "vfx_t:         equ 0%04Xh" % _SCR(6)]) if _8C_RL2 else ()),  # 1B
    # _8C_AURA dual-plane скретч (save: копия ncols/hi0b; fixup: реплей 2-й плоскости):
    *((["vsu_nc:        equ 0%04Xh" % _SCR(7),   # 1B: ncols для 2-го прохода save/restore
        "vsu_hib:       equ 0%04Xh" % _SCR(8),   # 1B: hi0b (0=нет 2-й плоскости), гейт прохода
        "vfx_hib:       equ 0%04Xh" % _SCR(9),   # 1B: hi0b слота в fixup
        "vfx_n16:       equ 0%04Xh" % _SCR(10),   # 1B: ncols*16 (смещение dataB)
        "vfx_dst:       equ 0%04Xh" % _SCR(11),   # 2B: старт dst planeA в данных слота
        "vfx_cnt:       equ 0%04Xh" % _SCR(13),   # 1B: count строк копии
        "vfx_tt:        equ 0%04Xh" % _SCR(14)]) if _8C_AURA else []),  # 1B: верхний y копии
    # MASKED: 3-я (гасимая) плоскость в слоте + режим блиттера (0=OR draw, 1=ANDN гашение).
    *((["vsu_hic:       equ 0%04Xh" % _SCR(15),   # 1B: hi0c (0=нет 3-й плоскости)
        "vfx_hic:       equ 0%04Xh" % _SCR(16),   # 1B: hi0c слота в fixup
        "vnc_mode:      equ 0%04Xh" % _SCR(17),   # 1B: 0=OR (draw), 1=ANDN (гашение по маске)
        "vnc_maskon:    equ 0%04Xh" % _SCR(18),   # 1B: текущий спрайт masked?
        "vnm_shift:     equ 0%04Xh" % _SCR(19),   # 1B: X&7 для универсальной masked-петли
        "vnm_mask:      equ 0%04Xh" % _SCR(20),   # 1B: 0FFh>>shift
        "vnm_nmask:     equ 0%04Xh" % _SCR(21),   # 1B: ~mask (spill)
        "vnm_rows:      equ 0%04Xh" % _SCR(22),   # 1B: счётчик строк
        "vsu_sp:        equ 0%04Xh" % _SCR(24),   # 2B: настоящий SP на время POP-хайджека
        "vsu_rchl:      equ 0%04Xh" % _SCR(26)]) if _8C_MASK else []),  # 2B: врем. HL
    # _8C_RLG: флаги групповой перерисовки (21Б, ОДНА страница) + рабочие ячейки фазы P.
    *((["vfl_flags:     equ 0%04Xh" % _RLG_BASE,        # 21B: 1=перерисовать слот
        "vfl_chg:       equ 0%04Xh" % (_RLG_BASE+21),   # 1B: были новые флаги в проходе
        "vfa_yc:        equ 0%04Xh" % (_RLG_BASE+22),   # 1B: cur Y флагового
        "vfa_xc:        equ 0%04Xh" % (_RLG_BASE+23),   # 1B: cur X флагового
        "vfa_yp:        equ 0%04Xh" % (_RLG_BASE+24),   # 1B: prev Y флагового
        "vfa_xp:        equ 0%04Xh" % (_RLG_BASE+25),   # 1B: prev X флагового
        "vfl_pass:      equ 0%04Xh" % (_RLG_BASE+26),   # 1B: счётчик проходов P
        "vfl_ai:        equ 0%04Xh" % (_RLG_BASE+27),   # 1B: внешний индекс
        # STICKY «фон переписан под спрайтом» (21Б): ставит vec_su_fixup, читает+сбрасывает
        # фаза F. Без него статичный спрайт, затёртый фон-блитом (отрисовка комнаты/шторка/
        # копка), НЕ перерисовывается — герой невидим после выхода из ворот до первого шага.
        "vfl_dirty:     equ 0%04Xh" % (_RLG_BASE+28),   # 21B
        # Последний виденный GameStatus: смена фазы игры (4->5 старт, 5->6 смерть, шторка) =
        # рендер спрайтов простаивал (тик отрисовки комнаты длиннее кадра), экран переписан
        # фоном -> ФОРС полной перерисовки. Иначе статичный герой после выхода из ворот
        # остаётся невидимым до первого шага (он не «изменился» -> не флагуется).
        "vfl_lastgs:    equ 0%04Xh" % (_RLG_BASE+49)]) if _8C_RLG else ()),  # 1B
    # prev-снапшот спрайтов (21x3=63Б) -> p3: в low-RAM он упирался в vec_tilemode@0x7F00
    # (при подъёме базы game-vars наезжал на кэш режимов => пропадали тайлы лестниц/букв).
    *((["vec_nsp_prev:  equ 0%04Xh" % (_RLG_BASE+80)]) if _8C_MASK else ()),  # 63B
    # P2-ЧИСТКА: 256Б LUT бит-реверса (vec_revlut @0xD100) УДАЛЁН. vnsx_rev16 теперь
    # реверсит байт БИТОВО на лету (8× rrca/rla, см. код) — LUT не нужен, 0xD100-0xD1FF
    # свободно в p2. Зеркальные спрайты чуть медленнее (реверс вместо lookup), но не горячи.
    # ШАГ4a on-the-fly зеркало-скрэтч (в свободной p2 0xD100-0xD3FF, НЕ в упакованном
    # work-RAM cells-блоке): vnsx_revbuf=16Б под бит-реверснутую половину (одна за раз,
    # blit её потребляет до след. вызова), vnsx_mir=флаг зеркала (pat>=0x60). Занулены
    # vec_init_clr; vnsx_mir пишется до чтения каждый вызов vec_nsx, revbuf — тоже.
    # P2-ФИНАЛ: vnsx-скрэтч вынесен из p2 в low-RAM padding dummy_9 (0x6B67-0x6B80, 25Б, мёртвый
    # фактор между mapPaused и keyPressDemo; 0 обращений в геймплее). 17Б: revbuf 0x6B67-0x6B77,
    # mir 0x6B77. Оба write-before-read каждый вызов vec_nsx => зануление не нужно.
    "vnsx_revbuf:    equ 0%04Xh" % _VNSXREV_ADDR,    # 16B reversed-half scratch; base low-RAM; _8COLOR: p3 0xEEE0
    "vnsx_mir:       equ 0%04Xh" % _VNSXMIR_ADDR,    # 1B mirror flag; _8COLOR: p3 0xEEF0
    # P2-ФИНАЛ: план 2 (0xC000-0xDFFF) БЕЗ soft-VDP shadow-буферов — все 3 (mixslot/vnsx/mixbuf,
    # 201Б) эвакуированы в low-RAM. Фаза A+ HUD-fix: и CPU-эмул-scratch (z80 alt/index-регистры,
    # il_tmp/il_tmp2/il_a/il_outstub) УБРАН из p2 в невидимую low-RAM (dummy_10 + vec_tilemode-2,
    # см. блок equ в конце main). В геймплее p2 трогают ЛИШЬ спрайт-блиты/clear — 0 scratch.
    "vec_init:",                     # entry @0x100 (.rom). Install RST7 vector, then init.
    "\tld\tsp, stackTop",            # boot SP=0xC300 is INSIDE the framebuffer!
    "\tld\thl, 8000h",
    # Фаза A+: clear ALL 4 planes (0x8000-0xFFFF). p3 (0xE000-0xFFFF) is NOW a sprite
    # plane (colour sprites use p2+p3), so its boot garbage would show as sprite-colour
    # pixels -> must be zeroed once at boot. Loop until HL wraps 0xFFFF->0x0000.
    "vec_init_clr:", "\tld\t(hl), 0", "\tinc\thl", "\tld\ta, h", "\tor\tl", "\tjp\tnz, vec_init_clr",
    # SAT stop-marker removed: sat_shadow/sat_drawn are DEAD (native sprites draw from
    # sprAttrib/enemyAttrib; SAT shadow never read on render). nsp_prev primes erase.
    "\tld\ta, 0C3h", "\tld\t(0038h), a",          # 0x0038 = JP vec_isr (RST7 vblank)
    "\tld\thl, vec_isr", "\tld\t(0039h), hl",
    "\txor\ta", "\tld\t(vec_isr_depth), a",
    "\tld\ta, 0FFh",
    "\tld\t(vec_kb8), a", "\tld\t(vec_joy), a",   # idle (active-low: nothing pressed)
    "\tcall\tvec_setpal",
    "\tld\ta, 8Ah", "\tout\t(00h), a",            # port mode: 02=input (keyboard scan)
    "\tld\ta, 0FFh", "\tld\t(vec_ayregs+7), a",   # ВИ53-конвертер: все каналы выкл
    "\txor\ta",
    "\tld\t(vec_vch+0), a", "\tld\t(vec_vch+1), a", "\tld\t(vec_vch+2), a",
    "\tld\t(vec_name_gen), a", "\tld\t(vec_td_slot), a",   # A=0 из xor выше
    "\tld\t(vec_spr_parity), a",
    "\tld\t(vec_sat_dl), a", "\tld\t(vec_fr_par), a",
    "\tld\t(vec_mu_n), a",
    *((["\tld\t(vec_pal_pending), a"]) if _PALVBL else ()),   # PALVBL: init pending=0 (иначе мусор->случ.палитра)
    # prime render-mode cache (256B work-RAM) to FF=recompute (было в plane-2 fill; кэш
    # теперь вне плана 2 -> init_clr его не трогает, праймим явно до первого блита).
    "\tld\thl, vec_tilemode", "\tld\tb, 0",
    "vini_tm:", "\tld\t(hl), 0FFh", "\tinc\thl", "\tdec\tb", "\tjp\tnz, vini_tm",
    # 2.4: mark the native-sprite prev-frame snapshot all-hidden (Y=0xD0) so the
    # first vec_nat_sprites call erases nothing (garbage RAM would XOR phantom junk).
    "\tld\thl, vec_nsp_prev", "\tld\tb, 21",
    "vini_nsp:", "\tld\t(hl), 0D0h", "\tinc\thl", "\tinc\thl", "\tinc\thl", "\tdec\tb", "\tjp\tnz, vini_nsp",
    "\tld\ta, 1", "\tld\t(vec_sat_dirty), a",
    "\tld\ta, 36h", "\tout\t(08h), a",            # заглушить ВИ53
    "\tld\ta, 76h", "\tout\t(08h), a",
    "\tld\ta, 0B6h", "\tout\t(08h), a",
    # P2-ЧИСТКА: генератор LUT бит-реверса УДАЛЁН (vnsx_rev16 реверсит битово на лету).
    # P2-ФИНАЛ: vini_ms (построение vec_mixslot LUT) УДАЛЁН — slot теперь линейный скан
    # vec_mixtiles на лету (vec_slot_of). Init mixslot больше не нужен.
    "\tjp\tstartCode",
    # (данные vec_mixtiles вынесены в хвост post-align — экономят pre-align padding до revtab)
    "vec_setpal:",                   # BOOT: PPI-конфиг(out 00h=0x88) + A+ палитра. Donor Gorodetsky 0x10D8
    "\tld\ta, 88h", "\tout\t(00h), a",   # 8255 PPI mode — ТОЛЬКО на boot (переконфиг mid-game = чёрный экран!)
    "\tld\thl, vec_pal+15", "\tjp\tvsp_load",
    "vec_setpal_menu:",              # PER-SCREEN: ТОЛЬКО палитра (БЕЗ PPI). p2/p3-НЕВИДИМАЯ (карта/пергамент):
                                     # для каждого (p0,p1) все 4 (p2,p3)=один цвет фона -> pat_shadow(p2)/
                                     # остатки спрайтов(p3) невидимы -> нет серой полосы на карте.
    "\tld\thl, vec_pal_menu+15", "\tjp\tvsp_load",
    "vec_setpal_a:",                 # PER-SCREEN: A+ палитра. idx8 (золото геймплей / синий меню)
    # даёт vec_brillo_pal в VBlank по flagPiramideMap. НЕ писать idx8 здесь mid-frame: на железе
    # запись палитры вне VBlank латчится в индекс пикселя под растром → золото утекало в idx0 (фон).
    "\tld\thl, vec_pal+15",
    "vsp_load:",
    "\tld\tde, 100Fh",
    "vec_setpal2:",
    "\tld\ta, e", "\tout\t(02h), a",
    "\tld\ta, (hl)",
    "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
    "\tout\t(0Ch), a", "\tdec\thl", "\tout\t(0Ch), a", "\tdec\te",
    "\tout\t(0Ch), a", "\tdec\td", "\tout\t(0Ch), a",
    "\tjp\tnz, vec_setpal2", "\tret",
    "vec_pal:",                      # entry0..15 (read reversed by the routine)
    # Задача 2.4 layout (spec 0.3): idx=(p0<<3)|(p1<<2)|(p2<<1)|p3. p3=1 -> sprite
    # colour, PRIORITY over background (every odd index, regardless of p0/p1/p2).
    # p3=0 -> background colour from (p0,p1) (4 slots); p2 stays invariant (hidden
    # plane-2 RAM). fon0/fon1/fon2/fon3 = the SAME 4 values the background already
    # used (unchanged, so the maze/HUD keep their exact colours) - only fon1/fon3
    # (p1=1) are currently unreachable (vec_nat_room/vec_blit_tile only ever write
    # plane 0), kept for when the background gains its 2nd colour bit.
    # 2026-07-14 Фаза A+ (ЦВЕТНЫЕ СПРАЙТЫ): p2 СТАНОВИТСЯ ВИДИМОЙ. idx=(p0<<3)|(p1<<2)|(p2<<1)|p3.
    # ПРИОРИТЕТ-БИТЫ p2,p3 (Городецкий-раскладка) — любой idx с p2 или p3 = ЦВЕТ СПРАЙТА,
    # НЕЗАВИСИМО от фона (p0,p1). 4 группы по 4 idx:
    #   p2=0,p3=0 (idx 0,4,8,12)  = ФОН (4 цвета из p0,p1): void/гемы/стены/лестницы.
    #   p2=0,p3=1 (idx 1,5,9,13)  = спрайт-цвет-1 = КОЖА героя, тёмно-красный 0x5F.
    #   p2=1,p3=0 (idx 2,6,10,14) = спрайт-цвет-2 = ОДЕЖДА героя, серый 0xF6.
    #   p2=1,p3=1 (idx 3,7,11,15) = спрайт-цвет-3 = МУМИЯ/overlap, белый 0xFF.
    # ФОН: idx0=void чёрный; idx4=гемы (мерцает vec_brillo_pal, стартовое 0); idx8=стены
    # СИНИЙ 0xD2 (MSX light-blue, валидировано); idx12=БЕЛЫЙ (лестницы/текст, MSX 14/15).
    # p2 БОЛЬШЕ НЕ инвариант — z80-scratch (был @0xDF00 p2, угол HUD) вынесен в low-RAM (иначе мусор).
    # Пакет 2: idx8 в vec_pal ВСЕГДА синий 0xD2 (меню/лого/Konami «King's» синие). Золото 0x77
    # применяется ТОЛЬКО в геймплее через vec_brillo_pal (по GameStatus, в VBlank) — иначе idx8
    # золотил бы и логотип титула (он на idx8). См. per-frame idx8 в vec_brillo_pal под _COLOR2.
    # === ФАЗА 1 8-ЦВЕТ (KV_8COLOR): p3 СХЛОПНУТ -> color[2k]==color[2k+1]. idx=(p0<<3)|(p1<<2)|(p2<<1)|p3.
    # 8 цветов от (p0,p1,p2) на чётных idx (slot cc = p0*4|p1*2|p2, idx=cc*2):
    #   idx0/1  void 0x00        (cc000)             idx8/9   gold-стены 0x77   (cc100)
    #   idx2/3  лестн.син 0xD2   (cc001)             idx10/11 т.красн 0x54     (cc101, кирпич-B/акцент)
    #   idx4/5  гемы 0x00        (cc010, мерцает)    idx12/13 белый 0xFF       (cc110, текст/лестн-верх)
    #   idx6/7  зелён 0x38       (cc011, декор)      idx14/15 серый 0xF6       (cc111, декор/мумия)
    # Каждая чёт/нечёт пара РАВНА => бит p3 невидим (проверка io.Palette[idx]==io.Palette[idx|1]).
    # 8-цв раскладка (p0=шейп-фон / p0=0=композит-спрайт):
    #   ФОН (p0=1): idx8 стены (level scheme, vbp) 077h; idx10 дверь/сундук синий 0D2h; idx12
    #   текст/пол белый 0FFh; idx14 ЛЕСТНИЦЫ св.синий 0DAh (COLOR_MAP §2.1 t15-22 = TMS5).
    #   СПРАЙТ (p0=0): idx2 ОДЕЖДА/каска героя серый 0F6h (p2, col&8) + мумии; idx4 КОЖА героя
    #   т.красн 05Fh (p1, col&8=0; brillo держит красным) + гем-глинт; idx6 dual (мумия/нож) серый.
    #   COLOR_MAP §3.1: кожа=6 (т.красн 05Fh), одежда=14 (серый 0F6h) -> idx4 красн / idx2 серый.
    # === РАСКЛАДКА ПОЛЬЗОВАТЕЛЯ 2026-07-21 (8 слотов, data-only) ===
    # idx движка=(p0<<3)|(p1<<2)|(p2<<1)|p3, p3 схлопнут -> 8 цветов на чётных idx.
    # Маршрутизация (замерено honest_render, diag-палитра):
    #   idx0  void/бордюр      -> 000h чёрн (slot0)
    #   idx2  герой ОДЕЖДА(p2) -> 0F6h серый (slot3)
    #   idx4  герой КОЖА(p1)+гем-глинт -> 05Fh т.красн (slot2, brillo держит красн)
    #   idx6  МУМИЯ/НОЖ dual + гем-фаза -> 0FFh белый (slot4)
    #   idx8  КИРПИЧИ/СТЕНЫ/КИРКА -> 0BFh золото (slot1; gameplay=kv_stone_scheme)
    #   idx10 ВРАЩ.ДВЕРЬ/сундук -> 0DAh синий (slot5)
    #   idx12 HUD/ТЕКСТ/пол/ЛЕСТНИЦЫ -> 0FFh белый (slot4)
    #   idx14 ГЕМЫ/КЛЮЧ (vec_col8 route) -> 038h зелён (slot6)
    # _8C_AURA: idx6 БЕЛЫЙ->КРАСНЫЙ 05Fh (теперь = кожа героя/двери dual p1+p2 + красн-ряды
    # кирпичей + оверлапы); idx4 остаётся 05Fh стартово, но в GS5 мигает vec_brillo_cols
    # (лучи ауры — единственный житель), вне GS5 vbp_static как раньше.
    ("\tdb\t000h,000h,0F6h,0F6h, 05Fh,05Fh,05Fh,05Fh, 0BFh,0BFh,0DAh,0DAh, 0FFh,0FFh,038h,038h"
     if (_8COLOR and _8C_AURA) else
     "\tdb\t000h,000h,0F6h,0F6h, 05Fh,05Fh,0FFh,0FFh, 0BFh,0BFh,0DAh,0DAh, 0FFh,0FFh,038h,038h"
     if _8COLOR else
     "\tdb\t000h,05Fh,0F6h,0FFh, 000h,05Fh,0F6h,0FFh, 0D2h,05Fh,0F6h,0FFh, 0FFh,05Fh,0F6h,0FFh"),
    # Палитра карты/пергамента. ФОН (p2=0,p3=0 -> idx0/4/8/12) сохранён: void/void/D2-синий/FF-белый.
    # ФИКС КАРТА-СПРАЙТЫ 2026-07-15: p2/p3-комбинации (idx с p2 или p3) = ЦВЕТ СПРАЙТА 0x5F (красный,
    # как кожа героя/MSX-glow) -> силуэт пирамиды (attrPiramidMap) + стрелка выхода (attrFlechaMap)
    # ВИДНЫ. Призрак-полоса НЕ возвращается: setupPergamino вызывает HideSprites (чистит p2/p3
    # 0xC000-0xFFFF) ПОСЛЕ распаковки паттернов -> pat_shadow в p2 занулён (замер: n2=0 на карте,
    # кроме самих спрайтов). Т.е. p2/p3 на карте = ТОЛЬКО карта-спрайты, показывать их безопасно.
    # НЕ трогает геймплей (vec_pal отдельно) и др.экраны (vec_setpal_menu зовётся лишь в setupPergamino).
    "vec_pal_menu:",
    # СИЛУЭТ пирамиды = спрайт в ПЛОСКОСТИ p2 (idx 2,6,10,14), стрелка выхода = p3 (idx 1,5,9,13).
    # СТАРЫЙ стоп-фикс полосы ставил p2-only idx (2,6,10,14) в ЦВЕТ ФОНА (000/000/0D2/0FF) — силуэт
    # сливался с фоном (ЧЁРНЫЕ КВАДРАТЫ). Теперь _MAPDIRECT увёл pat_shadow с видимой p2 (p2sh=0 на
    # карте => полосы нет БЕЗ этого хака), поэтому под _MAPDIRECT ВОЗВРАЩАЕМ все idx с p2 или p3 в
    # 0x5F (красный) — силуэт (p2) СНОВА ВИДЕН, стрелка (p3) красная. Без _MAPDIRECT — старые
    # безопасные значения (полоса иначе вернётся). idx: (p0<<3)|(p1<<2)|(p2<<1)|p3.
    ("\tdb\t000h,05Fh,05Fh,05Fh, 000h,05Fh,05Fh,05Fh, 0D2h,05Fh,05Fh,05Fh, 0FFh,05Fh,05Fh,05Fh"
     if _MAPDIRECT else
     "\tdb\t000h,05Fh,000h,05Fh, 000h,05Fh,000h,05Fh, 0D2h,05Fh,0D2h,05Fh, 0FFh,05Fh,0FFh,05Fh"),
    # 8-цв: палитра KONAMI-экрана. Буквы лого рисуются в p0+p1 -> idx12 = 0FFh БЕЛЫЙ (максимум
    # Вектора = c0e0e0). ЗАДАЧА#4 (спека COLORES_LOGO): фон (idx0/1) = СВ-ГОЛУБОЙ 0DAh (было 0D2h
    # средне-синий) => белый на св-голубом, как оригинал MSX (backdrop reg7=0E4h ~ TMS light-blue).
    # Грузится vsp_load в loadKonamiLogo; setColor вернёт vec_pal (idx0 чёрн). KV_NO_KONAMICOLOR ->
    # откат к 0D2h. Пары зеркалены (p3 невидим). idx: (p0<<3)|(p1<<2)|(p2<<1)|p3.
    *((["vec_pal_konami:",
        ("\tdb\t0DAh,0DAh,0F6h,0F6h, 05Fh,05Fh,0F6h,0F6h, 077h,077h,0D2h,0D2h, 0FFh,0FFh,0DAh,0DAh"
         if not _os_pv.environ.get('KV_NO_KONAMICOLOR') else
         "\tdb\t0D2h,0D2h,0F6h,0F6h, 05Fh,05Fh,0F6h,0F6h, 077h,077h,0D2h,0D2h, 0FFh,0FFh,0DAh,0DAh")]) if _8COLOR else ()),
    "vec_isr:",                      # RST7 -> call the game's installed H.TIMI hook
    # Interrupt-nesting depth cap. On the (slow) Vector a long runGame runs with
    # interrupts re-enabled (tickMain's `ei`), and each ISR is itself slow, so vblank
    # interrupts can nest faster than they return -> unbounded stack growth into the
    # game variables -> derail. Allow up to 3 concurrent levels (enough for the sound
    # driver to keep ticking) and skip any interrupt beyond that.
    "\tpush\taf",
    "\tld\ta, (vec_isr_depth)", "\tcp\t3", "\tjp\tnc, vec_isr_skip",  # cap nesting at 3
    "\tinc\ta", "\tld\t(vec_isr_depth), a",
    "\tpop\taf",
    "\tpush\taf", "\tpush\tbc", "\tpush\tde", "\tpush\thl",
    ]
    # Save ALL shadow/scratch cells: the interrupt is async and the interrupted
    # game code may be mid-macro (exx/ex af,af' via these RAM cells). C-BIOS did
    # this implicitly on MSX; here the ISR must, or a mid-fill interrupt corrupts
    # the interrupted code's counter -> runGame hangs -> tickInProgress stuck.
    + [ln for c in SCRATCH for ln in (f"\tld\thl, ({c})", "\tpush\thl")]
    + [
    # NB: vec_vdp_ptr / vw_* are NOT saved around H_TIMI. On MSX the VDP address is
    # GLOBAL hardware state that the game's ISR-driven drawing legitimately advances
    # across frames (the logo effect streams bytes relying on it). Snapshot/restore
    # here rewound the stream -> the game wrote "blind" and the pointer sprayed the
    # whole address space (vertical-stripe corruption). Concurrency is resolved the
    # same way the real MSX resolves it: init fills run under DI, and nested ticks
    # (depth>=2) run ONLY the sound driver below - they never draw.
    "\tld\ta, (vec_isr_depth)", "\tcp\t1", "\tjp\tnz, vec_isr_nested",
    # Protect the interrupted MAIN thread's write-path temps (vw_byte/vw_tmp/vw_lowbase):
    # our compositor/blitter (and the game tick's own writes) reuse these cells.
    # NB: vec_vdp_ptr is deliberately NOT saved - it is global "hardware" state.
    "\tld\ta, (vw_byte)", "\tpush\taf",
    "\tld\ta, (vw_tmp)", "\tpush\taf",
    "\tld\ta, (vw_lowbase)", "\tpush\taf",
    "\tld\ta, (vw_col)", "\tpush\taf",       # blit budget: main drain vs ISR drain
    # Render EVERY frame: alternate-frame rendering strobed against the game's
    # sprite multiplexing (2-3 frame object juggling -> aliasing residue) and
    # against the continuous treasure-flash pipeline (phase looked frozen).
    *((["\tcall\tvec_pal_apply"]) if _PALVBL else ()),   # PALVBL: полная палитра смены экрана — в VBlank
    *((["\tcall\tvec_brillo_pal"]) if _BRILLO else ()),  # блеск idx4 покадрово (KV_NO_BRILLO=1 -> заморозить)
    "\tcall\tvec_scan_keys",        # real Vector keyboard -> MSX SNSMAT row 8 image
    "\tcall\tvec_flushvi",          # AY-регистры -> штатный ВИ53 (звук на любом Векторе)
    # Render every OTHER frame (25 fps): safe now - two-pass sprites are XOR-exact
    # under any sampling, and the dirty-cell queue drains instantly (the old
    # pipeline lag that strobed the flash is gone).
    "\tld\ta, (vec_fr_par)", "\txor\t1", "\tld\t(vec_fr_par), a",
    # 2026-07-11: рендер КАЖДЫЙ кадр (50fps) — фикс флика от 25fps-гейта.
    # Задача 2.4: старый soft-VDP спрайт-конвейер (vec_render_erase/draw) УДАЛЁН -
    # спрайты теперь рисует vec_nat_sprites (вызывается из updateSprites, глюe
    # ниже), а не отдельным проходом ISR. vec_compose остаётся no-op stub'ом
    # (HUD/name-cell drain у него Phase 2 - vcp_cells, вызывается из dummyLoop).
    "\tcall\tvec_compose",
    "vec_isr_nr:",
    "\tcall\tH_TIMI",               # then the game tick ('jp tickMain' lives here)
    "\tpop\taf", "\tld\t(vw_col), a",
    "\tpop\taf", "\tld\t(vw_lowbase), a",
    "\tpop\taf", "\tld\t(vw_tmp), a",
    "\tpop\taf", "\tld\t(vw_byte), a",
    "\tjp\tvec_isr_done",
    "vec_isr_nested:",              # depth>=2: sound only; nested runGame would draw
    "\tld\ta, (vec_sndb)", "\tpush\taf",   # channel counter is NOT in SCRATCH
    "\tcall\tupdateSound",          #  concurrently with the interrupted tick's stream
    "\tpop\taf", "\tld\t(vec_sndb), a",
    # flush AY->VI53 on nested frames too: a multi-frame loading tick (end of the
    # jingle = phase switch!) otherwise leaves the VI53 stuck on the last note.
    "\tcall\tvec_flushvi",
    "vec_isr_done:",
    ]
    + [ln for c in reversed(SCRATCH) for ln in ("\tpop\thl", f"\tld\t({c}), hl")]
    + [
    "\tld\ta, (vec_isr_depth)", "\tdec\ta", "\tld\t(vec_isr_depth), a",  # release level
    "\tpop\thl", "\tpop\tde", "\tpop\tbc", "\tpop\taf",
    "\tei", "\tret",
    "vec_isr_skip:", "\tpop\taf", "\tei", "\tret",
    "WRTPSG:",                      # A=reg E=data -> AY. Vector AY ports (vector06js):
    # 0x15 = register-select, 0x14 = data (NOT the other way round).
    "\tout\t(15h), a",             # AY (эмулятор/AY-мод)
    "\tpush\thl",
    "\tand\t0Fh",                  # регистр 0-15 -> зеркало для ВИ53-конвертера
    "\tld\thl, vec_ayregs",
    "\tadd\ta, l", "\tld\tl, a", "\tld\ta, h", "\tadc\ta, 0", "\tld\th, a",
    "\tld\t(hl), e",
    "\tpop\thl",
    "\tld\ta, e", "\tout\t(14h), a", "\tret",
    # --- AY->ВИ53 конвертер (по мотивам psgVector Дениса Грачёва) ---
    # Каждый кадр: канал ВИ53 включён, если tone-бит R7=0 И громкость R8+n>0;
    # делитель = AY-период * 13.5 (перекос тактовых частот), дедуп по vec_vfreq.
    # Порты Вектора: 0x08=управление ВИ53, счётчики A/B/C = 0x0B/0x0A/0x09.
    "vec_flushvi:",
    # -------- канал A --------
    "\tld\ta, (vec_ayregs+7)", "\tand\t1", "\tjp\tnz, fvA_off",
    "\tld\ta, (vec_ayregs+8)", "\tand\t0Fh", "\tcp\t6", "\tjp\tc, fvA_off",
    "\tld\thl, (vec_ayregs+0)", "\tcall\tvec_ay2vi",
    "\tld\ta, (vec_vch+0)", "\tor\ta", "\tjp\tnz, fvA_f",
    "\tld\ta, 36h", "\tout\t(08h), a",                # канал был выкл: режим 3 LSB+MSB
    "\tld\ta, 1", "\tld\t(vec_vch+0), a",
    "fvA_f:",
    "\tld\tde, (vec_vfreq+0)",
    "\tld\ta, l", "\tcp\te", "\tjp\tnz, fvA_w",
    "\tld\ta, h", "\tcp\td", "\tjp\tz, fvB",        # частота не изменилась
    "fvA_w:",
    "\tld\t(vec_vfreq+0), hl",
    "\tld\ta, l", "\tout\t(0Bh), a", "\tld\ta, h", "\tout\t(0Bh), a",
    "\tjp\tfvB",
    "fvA_off:",
    "\tld\ta, (vec_vch+0)", "\tor\ta", "\tjp\tz, fvB",
    "\txor\ta", "\tld\t(vec_vch+0), a",
    "\tld\ta, 36h", "\tout\t(08h), a",                # ctrl-word глушит до перезагрузки
    # -------- канал B --------
    "fvB:",
    "\tld\ta, (vec_ayregs+7)", "\tand\t2", "\tjp\tnz, fvB_off",
    "\tld\ta, (vec_ayregs+9)", "\tand\t0Fh", "\tcp\t6", "\tjp\tc, fvB_off",
    "\tld\thl, (vec_ayregs+2)", "\tcall\tvec_ay2vi",
    "\tld\ta, (vec_vch+1)", "\tor\ta", "\tjp\tnz, fvB_f",
    "\tld\ta, 76h", "\tout\t(08h), a",
    "\tld\ta, 1", "\tld\t(vec_vch+1), a",
    "fvB_f:",
    "\tld\tde, (vec_vfreq+2)",
    "\tld\ta, l", "\tcp\te", "\tjp\tnz, fvB_w",
    "\tld\ta, h", "\tcp\td", "\tjp\tz, fvC",
    "fvB_w:",
    "\tld\t(vec_vfreq+2), hl",
    "\tld\ta, l", "\tout\t(0Ah), a", "\tld\ta, h", "\tout\t(0Ah), a",
    "\tjp\tfvC",
    "fvB_off:",
    "\tld\ta, (vec_vch+1)", "\tor\ta", "\tjp\tz, fvC",
    "\txor\ta", "\tld\t(vec_vch+1), a",
    "\tld\ta, 76h", "\tout\t(08h), a",
    # -------- канал C --------
    "fvC:",
    "\tld\ta, (vec_ayregs+7)", "\tand\t4", "\tjp\tnz, fvC_off",
    "\tld\ta, (vec_ayregs+10)", "\tand\t0Fh", "\tcp\t6", "\tjp\tc, fvC_off",
    "\tld\thl, (vec_ayregs+4)", "\tcall\tvec_ay2vi",
    "\tld\ta, (vec_vch+2)", "\tor\ta", "\tjp\tnz, fvC_f",
    "\tld\ta, 0B6h", "\tout\t(08h), a",
    "\tld\ta, 1", "\tld\t(vec_vch+2), a",
    "fvC_f:",
    "\tld\tde, (vec_vfreq+4)",
    "\tld\ta, l", "\tcp\te", "\tjp\tnz, fvC_w",
    "\tld\ta, h", "\tcp\td", "\tjp\tz, fv_done",
    "fvC_w:",
    "\tld\t(vec_vfreq+4), hl",
    "\tld\ta, l", "\tout\t(09h), a", "\tld\ta, h", "\tout\t(09h), a",
    "\tjp\tfv_done",
    "fvC_off:",
    "\tld\ta, (vec_vch+2)", "\tor\ta", "\tjp\tz, fv_done",
    "\txor\ta", "\tld\t(vec_vch+2), a",
    "\tld\ta, 0B6h", "\tout\t(08h), a",
    "fv_done:", "\tret",
    "vec_ay2vi:",                   # HL = AY-период (12 бит) -> делитель ВИ53 (*13.5)
    "\tld\ta, h", "\tand\t0Fh", "\tld\th, a",
    "\tld\tb, h", "\tld\tc, l",                       # BC = P
    "\tadd\thl, hl",
    "\tld\te, l", "\tld\td, h",                       # DE = 2P
    "\tadd\thl, hl", "\tadd\thl, de", "\tadd\thl, hl",  # 12P
    "\tadd\thl, bc",                                    # 13P
    "\tld\ta, b", "\tor\ta", "\trra", "\tld\tb, a",
    "\tld\ta, c", "\trra", "\tld\tc, a",
    "\tadd\thl, bc",                                    # 13.5P
    "\tret",
    "RDPSG:",                       # A=14 (joystick). Читаем РЕАЛЬНЫЙ порт джойстика Вектор-06Ц 0x0E
    # (RTL MiSTer Vector-06C.sv:294/635 io_data=joyA_o, active-low байт: b0=RIGHT b1=LEFT b2=UP
    # b3=DOWN b6=FIRE1 b7=FIRE2, idle b4/5=1; отд.чип, PPI-инициализация не нужна). Переставляем в
    # MSX-формат RDPSG(14) active-low: b0=Up b1=Down b2=Left b3=Right b4=trigA b5=trigB (ReadKeys cpl).
    "\tin\ta, (0Eh)",               # active-low Vector
    "\tcpl",                        # active-high: b0=R b1=L b2=U b3=D b6=F1 b7=F2 (1=нажато)
    "\tld\tb, a",
    "\trrca", "\trrca", "\tand\t33h", "\tld\tc, a",   # ror2: U->b0 D->b1 F1->b4 F2->b5 (маска 33h)
    "\tld\ta, b", "\trlca", "\tand\t04h", "\tor\tc", "\tld\tc, a",   # L: Vp b1 -> Mp b2
    "\tld\ta, b", "\trlca", "\trlca", "\trlca", "\tand\t08h", "\tor\tc",  # R: Vp b0 -> Mp b3
    "\tcpl",                        # Mp active-high -> vec_joy active-low (idle b6/7=1)
    "\tret",
    "WRTVDP:", "\tret",             # B=data C=reg : ignore (fixed SCREEN2 tables)
    "SETWR:", "\tld\t(vec_vdp_ptr), hl", "\tret",
    "SETRD:", "\tld\t(vec_vdp_ptr), hl", "\tret",
    # --- Phase 3: route VRAM writes to shadow (bank-0 pattern+color) & name->blit ---
    # WRTVRM colour fast-path: the treasure flash rewrites a handful of colour
    # bytes per tick through per-byte WRTVRM (~90 instr each = ~26% of gameplay
    # CPU with the scans). Colour writes only need shadow+dedup+tile-dirty (~30).
    # === СТАДИЯ 6 (ЛИТЕРАЛЬНЫЙ НОЛЬ): весь soft-VDP диспетчер (WRTVRM/vec_vram_write/vw_*/RDVRM/
    # rv_*) эмитится ТОЛЬКО когда _NATVDP ВЫКЛ (OFF-билд или откат KV_NO_NATVDP=1). При _NATVDP
    # его потребители (InviertePatron/VRAM_write2/vec_de_slow) нативны -> 0 ссылок -> метки убраны.
    # SETWR/SETRD/vec_vdp_ptr НЕ здесь (нужны нативным fill-путям vec_fill_col/name — оставлены). ===
    *(([
    "WRTVRM:",                      # HL=addr A=data; preserves ALL regs
    "\tpush\tbc",
    "\tld\tb, a",
    "\tld\ta, h", "\tand\t3Fh", "\tcp\t18h", "\tjp\tnc, wrtvrm_slow",
    # Фаза C1: per-byte WRTVRM colour -> vec_col_store (инкрем. mode + диапаз. mixcol).
    # Часть тайлсетного цвета грузится именно так (напр. зеркальные лестницы 0x77-0x85),
    # поэтому кормим ВЕСЬ цвет (как baseline кормил col_shadow). Указатель двигаем по
    # ОРИГИНАЛЬНОМу HL (VDP-семантика). vec_col_store сохраняет BC,DE,HL.
    "\tpush\thl",
    "\tld\ta, h", "\tand\t7", "\tld\th, a",             # H = folded (0x00-0x07); L без изменений
    "\tld\ta, b", "\tcall\tvec_col_store",              # A=data, HL=folded colour addr
    "\tpop\thl",                                        # HL = оригинальный addr
    "\tpush\thl", "\tinc\thl", "\tld\t(vec_vdp_ptr), hl", "\tpop\thl",  # ptr = HL+1 (VDP semantics)
    "\tld\ta, b", "\tpop\tbc",
    "\tret",
    "wrtvrm_slow:",
    "\tcp\t3Bh", "\tjp\tnz, wrtvrm_slow2",           # A = masked H; SAT page?
    "\tld\ta, 1", "\tld\t(vec_sat_dirty), a",           # SAT byte: shadow copy DROPPED (dead) - flags only
    "\tld\ta, l", "\tcp\t18h", "\tjp\tnc, wrtvrm_s6",   # entry>=6 (sparkles)
    "\tld\ta, 1", "\tld\t(vec_sat_dl), a",
    "wrtvrm_s6:",
    "\tpush\thl", "\tinc\thl", "\tld\t(vec_vdp_ptr), hl", "\tpop\thl",
    "\tld\ta, b", "\tpop\tbc",
    "\tret",
    "wrtvrm_slow2:",
    "\tld\ta, b", "\tpop\tbc",
    "\tld\t(vec_vdp_ptr), hl",      # fall into vec_vram_write
    "vec_vram_write:",              # A=data at vec_vdp_ptr; increments ptr; preserves all
    "\tld\t(vw_byte), a",
    "\tpush\taf", "\tpush\tbc", "\tpush\tde", "\tpush\thl",
    "\tld\thl, (vec_vdp_ptr)",
    "\tinc\thl", "\tld\t(vec_vdp_ptr), hl", "\tdec\thl",   # hl = current addr
    "\tld\ta, h", "\tand\t3Fh", "\tld\th, a",   # strip VDP mode bits (0x4000 write / 0x8000) -> true VRAM
    "\tld\ta, h",
    "\tcp\t18h", "\tjp\tc, vw_colw",       # 0x0000-0x17FF colour table -> shadow + tile mode
    "\tcp\t20h", "\tjp\tc, vw_spr",        # 0x1800-0x1FFF sprite patterns -> shadow
    "\tcp\t38h", "\tjp\tc, vw_wcol",       # 0x2000-0x37FF ALL 3 pattern banks -> shadow (6K)
    "\tcp\t3Bh", "\tjp\tc, vw_name",       # 0x3800-0x3AFF name table -> blit
    # SAT (0x3B00-0x3BFF): vw_sat УДАЛЁН (0 записей, тень мёртвая) -> fall to vw_end (no-op)
    "\tjp\tvw_end",
    # Pattern-generator write: update shadow AND re-blit every on-screen cell that
    # uses this tile in this bank. On real MSX the VDP renders from the pattern
    # table live, so rewriting a pattern changes the picture instantly (this is
    # how KV flashes the treasures). Without the re-blit the screen keeps stale
    # pixels. Dedup (unchanged byte -> skip) keeps the 256-cell scan off hot paths.
    "vw_wcol:",			# HL = masked addr 0x2000-0x37FF (3 banks x 2K)
    "\tpush\thl",
    "\tld\ta, h", "\tand\t7", "\tld\th, a",           # fold bank -> single compressed 2K copy
    "\tcall\tpat_base", "\tadd\thl, de",              # DE=база по диапазону tile (шаг3)
    "\tld\ta, (vw_byte)", "\tcp\t(hl)", "\tjp\tz, vw_wcol_same",
    "\tld\t(hl), a",
    "\tpop\thl",
    "\tld\ta, l",                                     # tile = (addr>>3) & 0xFF
    "\trrca", "\trrca", "\trrca", "\tand\t1Fh", "\tld\te, a",
    "\tld\ta, h",
    "\trrca", "\trrca", "\trrca", "\tand\t0E0h", "\tor\te",
    "\tld\t(vw_byte), a",                             # vw_byte := tile (blitter input)
    "\tld\ta, h",                                     # bank = (h>>3)&3 (h=20-37 -> 0,1,2)
    "\trrca", "\trrca", "\trrca", "\tand\t3",
    "\tld\t(vw_lowbase), a",
    # Mark the TILE dirty (2nd bitmap) instead of scanning 256 name cells per BYTE:
    # the game flashes treasures by rewriting 8 pattern bytes - that used to cost
    # 8 x ~2700-instr scans (46% of ALL CPU in gameplay, ticks stretched to ~10
    # frames = slow-motion game). The compositor resolves tile->cells once per frame.
    "vw_reblit:",                   # entry: vw_byte=tile, vw_lowbase=bank
    # The flash rewrites 8 pattern bytes of the SAME tile back-to-back: dedup by
    # remembering the last marked (bank,tile) - 7 of 8 td_mark calls vanish.
    "\tld\ta, (vw_byte)", "\tld\te, a",
    "\tld\ta, (vw_lowbase)", "\tld\td, a",
    "\tld\thl, (vw_rb_last)",
    "\tld\ta, l", "\tcp\te", "\tjp\tnz, vwrb_1",
    "\tld\ta, h", "\tcp\td", "\tjp\tz, vw_end",              # same tile: already marked
    "vwrb_1:",
    "\tex\tde, hl", "\tld\t(vw_rb_last), hl",                  # L=tile H=bank
    # HL = bank*0x800 | tile*8  (rmap gate replaces the old tilecnt gate)
    "\tld\ta, l", "\tld\th, 0",
    "\tadd\ta, a", "\tjp\tnc, vwrb_2", "\tld\th, 1",
    "vwrb_2:", "\tadd\ta, a", "\tld\tl, a", "\tld\ta, h", "\tadc\ta, a", "\tld\th, a",
    "\tld\ta, l", "\tadd\ta, a", "\tld\tl, a", "\tld\ta, h", "\tadc\ta, a", "\tld\th, a",  # tile*8
    "\tld\ta, (vw_lowbase)", "\trlca", "\trlca", "\trlca",
    "\tor\th", "\tld\th, a",
    "\tcall\tvec_td_mark",
    "\tjp\tvw_end",
    "vw_wcol_same:", "\tpop\thl", "\tjp\tvw_end",
    # Colour-table write: update shadow, invalidate the tile's render mode, re-blit
    # its on-screen cells (colour change alters how the tile looks - e.g. fg==bg
    # tiles are invisible on MSX even though their pattern has bits set).
    "vw_colw:",			# HL = addr 0x0000-0x17FF (3 banks x 2K)
    # gem-colour filter (per-byte путь): destellos/паланка flash -> отбросить
    "\tld\ta, l", "\trrca", "\trrca", "\trrca", "\tand\t1Fh", "\tld\te, a",
    "\tld\ta, h", "\trrca", "\trrca", "\trrca", "\tand\t0E0h", "\tor\te",
    "\tcall\tvec_is_gem_col", "\tjp\tz, vw_end",       # ptr уже сдвинут в vec_vram_write
    # Фаза C1: тень col_shadow снята. Байт цвета -> vec_col_store (накопитель тайла
    # + эагерный пересчёт render-mode на строке 7). Заголовочный тайл (0x10-0x3f)
    # грузится ровно по 8 байт/тайл, так что mode получается корректным. (td_mark
    # был stub, дедуп/re-blit сняты вместе с тенью.)
    "\tld\ta, h", "\tand\t7", "\tld\th, a",           # fold bank -> HL = folded colour addr
    "\tld\ta, (vw_byte)",                             # A = colour byte
    "\tcall\tvec_col_store",
    "\tjp\tvw_end",
    "vw_spr:",			# 0x1800-0x1FFF sprite pattern generator -> compact vec_spr_buf (768B)
    # ШАГ4b: VRAM sprite-addr -> компактный vec_spr_buf. hero+momia (0x1800-0x199F, h=0x18/0x19)
    # -> buf+(addr-0x1800); sprites2 (0x1EA0-0x1FFF, h>=0x1E) -> buf+(addr-0x1D00) [сжатие: gap
    # 0x19A0-0x1EA0 пропущен]. Зеркала (0x1B10/0x1C50, h=0x1A/0x1C) НЕ пишутся (flipSprites=no-op).
    "\tld\ta, h", "\tld\tde, vec_spr_buf-1800h", "\tcp\t1Eh", "\tjp\tc, vw_spr_w",
    "\tld\tde, vec_spr_buf-1D00h",                          # h>=0x1E -> sprites2 (сжатие -0x500)
    "vw_spr_w:", "\tadd\thl, de",
    "\tld\ta, (vw_byte)", "\tld\t(hl), a", "\tjp\tvw_end",
    "vw_name:",                     # HL=0x3800..0x3AFF name addr; tile=vw_byte -> DIRECT blit
    # Фаза B: name_shadow-dedup + rmap-инвалидация + dirty-очередь УДАЛЕНЫ (0 чтений
    # name_shadow, компоситор снят). Оставшиеся писатели name-таблицы через soft-VDP
    # (титул ©KONAMI 1985 / финал: drawMenuEnd/setupEnding DEtoVRAM_NXNY, НЕ нативные)
    # раньше клали клетку в dirty -> компоситор блитил. Теперь блитим ПРЯМО в
    # framebuffer через vec_text_blit (HL=name addr, сохраняет HL/DE/BC; атомарно di).
    "\tld\ta, (vw_byte)",
    "\tcall\tvec_text_blit",                            # HL=name addr -> прямой блит p0/p1
    "vw_end:",
    "\tpop\thl", "\tpop\tde", "\tpop\tbc", "\tpop\taf", "\tret",
    # RDVRM: HL=addr -> A (read from the shadows). MSX BIOS RDVRM PRESERVES all
    # registers but A - and callers rely on it: FlipPatrones loops
    # `call InviertePatron / inc hl / inc de` to mirror-generate the stair tiles
    # (0x77-0x85 from 0x68-0x76). Clobbering HL/DE here broke the loop -> mirrored
    # tiles stayed zero -> "half the stairs missing".
    "RDVRM:",
    "\tpush\tde", "\tpush\thl",
    "\tld\ta, h",
    "\tcp\t18h", "\tjp\tc, rv_col",        # 0x0000-0x17FF colour shadow
    "\tcp\t20h", "\tjp\tc, rv_spr",        # 0x1800-0x1FFF sprite pattern shadow
    "\tcp\t38h", "\tjp\tc, rv_patn",       # 0x2000-0x37FF bg pattern shadow
    "\tcp\t3Bh", "\tjp\tc, rv_zero",       # 0x3800-0x3AFF name shadow REMOVED -> read 0
    # SAT (0x3B00+): rv_sat УДАЛЁН (0 чтений) -> fall to rv_zero (read 0)
    "rv_zero:", "\txor\ta", "\tjp\trv_done",
    "rv_col:", "\txor\ta", "\tjp\trv_done",           # Фаза C1: col_shadow снята -> RDVRM цвета читает 0
                                                       # (аудит: 0 чтений цвета логикой; logic-гейт цел)
    "rv_spr:",  "\tld\tde, vec_spr_buf-1800h",  "\tjp\trv_rd",   # ШАГ4b: RDVRM спрайтов — только
    # hero/momia (h<0x1E); sprites2 (двери) НЕ читаются через RDVRM (flipSprites=no-op шаг4a).
    "rv_patn:",                                       # pattern shadow: fold bank (3x2K -> 2K)
    "\tld\ta, h", "\tand\t7", "\tld\th, a",
    "\tcall\tpat_base",                            "\tjp\trv_rd",  # DE=база по диапазону tile (шаг3)
    "rv_rd:", "\tadd\thl, de", "\tld\ta, (hl)",
    "rv_done:", "\tpop\thl", "\tpop\tde", "\tret",
    ]) if not _NATVDP else ()),   # === КОНЕЦ soft-VDP диспетчера (гейт _NATVDP) ===
    # --- НАТИВНЫЙ загрузчик спрайтов (soft-VDP removal Stage2): DE=ptr GFX
    # (первое слово = VRAM-адрес, далее RLE) -> ПРЯМО в vec_spr_buf, БЕЗ VDP/funnel/vec_vram_write.
    # RLE: count байт & 0x7F = длина; bit7=1 -> literal-копир, bit7=0 -> fill; 0x80 -> смена
    # адреса (новое слово); 0x00 -> конец. Спрайт-диапазон 0x1800-0x1DFF мапится линейно
    # (dst = vec_spr_buf + addr-0x1800). Клоббер: A/BC/DE/HL (как оригинальный unpackGFXset).
    "vec_spr_load:",
    "vsl_newaddr:",
    "\tld\ta, (de)", "\tinc\tde", "\tld\tl, a",
    "\tld\ta, (de)", "\tinc\tde", "\tld\th, a",         # HL = VRAM addr
    "\tld\tbc, vec_spr_buf-1800h", "\tadd\thl, bc",     # HL = dst в vec_spr_buf
    "vsl_2:",
    "\tld\ta, (de)", "\tand\t7Fh", "\tld\tc, a",        # C = count&0x7F (Z=count7f==0)
    "\tld\ta, (de)", "\tinc\tde",                        # A = count байт (INX de флаги не трогает)
    "\tjp\tnz, vsl_3",                                   # count7f != 0 -> обработка
    "\tcp\tc",                                           # count7f==0: A=0x00(конец)/0x80(смена адреса)
    "\tjp\tnz, vsl_newaddr",
    "\tret",
    "vsl_3:",
    "\tcp\tc",                                           # A(count) vs C(count7f): z=fill, nz=literal
    "\tjp\tz, vsl_fill",
    "vsl_copy:",
    "\tld\ta, (de)", "\tld\t(hl), a", "\tinc\tde", "\tinc\thl", "\tdec\tc", "\tjp\tnz, vsl_copy",
    "\tjp\tvsl_2",
    "vsl_fill:",
    "\tld\ta, (de)", "\tinc\tde",
    "vsl_fillp:",
    "\tld\t(hl), a", "\tinc\thl", "\tdec\tc", "\tjp\tnz, vsl_fillp",
    "\tjp\tvsl_2",
    # --- НАТИВНЫЙ загрузчик ПАТТЕРНОВ (soft-VDP removal Stage3): HL=VDP addr (0x2000+),
    # DE=RLE (без ведущего слова — unpackGFX берёт addr из HL). Пишет в pat-кэш ПРЯМО:
    # fold (H&7) + pat_base range-базы, БЕЗ VDP/funnel/vec_vram_write. Заменяет UnpackPatterns
    # (3 избыточных банка сворачиваются в 1 -> 1 проход). Re-blit НЕ нужен (загрузка до отрисовки).
    # База пересчитывается на смену адреса (0x80). Клоббер: A/BC/DE/HL (вызыватели не зависят).
    "vec_pat_load:",                                    # HL=VDP addr, DE=RLE. HL отслеживает VDP-адрес.
    "vpl_2:",
    "\tld\ta, (de)", "\tand\t7Fh", "\tld\tc, a",
    "\tld\ta, (de)", "\tinc\tde",
    "\tjp\tnz, vpl_3",
    "\tcp\tc",                                          # count7f==0: 0x00 конец / 0x80 смена адреса
    "\tjp\tnz, vpl_newaddr",
    "\tret",
    "vpl_3:",
    "\tcp\tc", "\tjp\tz, vpl_fill",
    "vpl_copy:",                                        # literal: C байт (DE)->VDP addr HL
    "\tld\ta, (de)", "\tinc\tde", "\tcall\tvec_pat_wr", "\tinc\thl", "\tdec\tc", "\tjp\tnz, vpl_copy",
    "\tjp\tvpl_2",
    "vpl_fill:",
    "\tld\ta, (de)", "\tinc\tde",                        # A = значение заливки (vec_pat_wr его бережёт)
    "vpl_fillp:",
    "\tcall\tvec_pat_wr", "\tinc\thl", "\tdec\tc", "\tjp\tnz, vpl_fillp",
    "\tjp\tvpl_2",
    "vpl_newaddr:",                                     # 0x80: новый VDP addr из данных
    "\tld\ta, (de)", "\tinc\tde", "\tld\tl, a",
    "\tld\ta, (de)", "\tinc\tde", "\tld\th, a",
    "\tjp\tvpl_2",
    # vec_pat_wr: A=байт, HL=VDP addr -> пишет в pat-кэш (fold+pat_base ПЕР-БАЙТ, корректно
    # через range-границы). Сохраняет HL/DE/BC/A (pat_base бережёт BC; DE/HL на стеке; A=байт).
    "vec_pat_wr:",
    "\tld\tb, a",                                       # байт в B (pat_base бережёт BC; НЕ vw_byte —
                                                        # иначе ISR во время загрузки перезатрёт ячейку)
    "\tpush\thl", "\tpush\tde",
    "\tld\ta, h", "\tand\t7", "\tld\th, a",             # fold VDP addr
    "\tcall\tpat_base", "\tadd\thl, de",                # HL = dst (base+folded)
    "\tld\ta, b", "\tld\t(hl), a",                      # запись байта из B
    "\tpop\tde", "\tpop\thl", "\tret",                  # восстановить VDP addr + RLE source (A=байт)
    # === СТАДИЯ 6 (_NATVDP): vec_cache_wr — ПРЯМОЙ range-роутер записи в нативные кэши, БЕЗ
    # vec_vdp_ptr-латча/диспетчера. Вход: A=байт, HL=VDP addr (mode-биты 0x4000/0x8000 допустимы).
    # Маршрут по H&0x3F: <0x18 цвет->vec_col_store (gem-фильтр+fold, как vw_colw); 0x18-0x1F
    # спрайт->vec_spr_buf (как vw_spr); 0x20-0x37 паттерн->vec_pat_wr (fold+pat_base, как vw_wcol
    # МИНУС re-blit — загрузка идёт ДО отрисовки, td_mark не нужен); 0x38+ name/SAT -> skip (bulk-
    # писатели туда не пишут во время загрузки, histogram name=0). Сохраняет BC/DE/HL. Клоббер: A.
    # Байт-в-байт эквивалент кэш-эффекта vec_vram_write на путях InviertePatron/VRAM_write2/vec_de_slow.
    *(([
    "vec_cache_wr:",
    "\tpush\tbc", "\tpush\tde", "\tpush\thl",
    "\tld\tc, a",                                       # C = данные
    "\tld\ta, h", "\tand\t3Fh", "\tld\th, a",           # снять VDP mode-биты
    "\tcp\t18h", "\tjp\tc, vcw_col",
    "\tcp\t20h", "\tjp\tc, vcw_spr",
    "\tcp\t38h", "\tjp\tc, vcw_pat",
    "\tjp\tvcw_end",                                    # name/SAT: skip
    "vcw_pat:",
    "\tld\ta, c", "\tcall\tvec_pat_wr",                 # A=байт, HL=addr -> pat-кэш (fold внутри)
    "\tjp\tvcw_end",
    "vcw_spr:",
    "\tld\ta, h", "\tld\tde, vec_spr_buf-1800h", "\tcp\t1Eh", "\tjp\tc, vcw_spr_w",
    "\tld\tde, vec_spr_buf-1D00h",                      # h>=0x1E -> sprites2 (сжатие -0x500)
    "vcw_spr_w:", "\tadd\thl, de", "\tld\ta, c", "\tld\t(hl), a", "\tjp\tvcw_end",
    "vcw_col:",                                         # gem-фильтр + fold + vec_col_store (как vw_colw)
    "\tld\ta, l", "\trrca", "\trrca", "\trrca", "\tand\t1Fh", "\tld\te, a",
    "\tld\ta, h", "\trrca", "\trrca", "\trrca", "\tand\t0E0h", "\tor\te",
    "\tcall\tvec_is_gem_col", "\tjp\tz, vcw_end",
    "\tld\ta, h", "\tand\t7", "\tld\th, a",             # fold bank -> folded colour addr
    "\tld\ta, c", "\tcall\tvec_col_store",
    "vcw_end:",
    "\tpop\thl", "\tpop\tde", "\tpop\tbc", "\tret",
    ]) if _NATVDP else ()),
    # pat_base: развилка баз фон-кэша паттернов (Фаза A+ шаг3). Вход HL=folded pat-адрес
    # (tile*8+row, 0..0x7FF, банк уже свёрнут). Выход DE=база (phys=DE+HL). Клоббер: только A
    # (сохраняет HL,BC,C). Границы по folded: <0x200 tiles<0x40 ; 0x200-0x45F tiles 0x40-0x8b
    # (maze); >=0x460 tiles>=0x8c (меню, p2). Шаг3a: только maze в work-RAM, шрифт пока в p2.
    "pat_base:",
    "\tld\ta, h", "\tcp\t2", "\tjp\tc, pb_lo",         # HL<0x200 (tiles<0x40): шрифт 0x10-0x3f или p2
    "\tcp\t4", "\tjp\tc, pb_maze",                     # 0x200-0x3FF (tiles 0x40-0x7f) -> maze
    "\tjp\tnz, pb_p2",                                 # HL>=0x500 (tiles>=0xa0) -> p2
    "\tld\ta, l", "\tcp\t60h", "\tjp\tc, pb_maze",     # H==4: 0x400-0x45F (tiles 0x80-0x8b) -> maze
    # MAPDIRECT: pb_p2 (folded 0x460-0x7FF, тайлы 0x8c-0xff) целит в НЕВИДИМЫЙ low-RAM вместо
    # видимой p2 vec_pat_shadow. Единств. реальный писатель/читатель этого диапазона — КАРТА
    # (тайлы 0xC0-0xE7 = folded 0x600-0x73F); прочие 0x8c-0xff мёртвы во всех экранах (меню/титул/
    # финал эвакуированы в 0x40-0x78, см. remap ниже; nonzero maxWrite/maxRead=none). Смена ТОЛЬКО
    # КОНСТАНТЫ базы => 0 добавленных инструкций => тайминг байт-в-байт (гейт 4 честного рендера).
    "pb_p2:",   *((["\tld\tde, pat_menu_base"]) if _MAPDIRECT else (["\tld\tde, vec_pat_shadow"])), "\tret",
    "pb_maze:", "\tld\tde, pat_maze_base", "\tret",
    "pb_lo:",                                          # HL<0x200: шрифт HUD 0x10-0x3f (folded 0x80-0x1FF)
    "\tld\ta, h", "\tor\ta", "\tjp\tnz, pb_font",      # H==1 (folded 0x100-0x1FF) -> шрифт
    "\tld\ta, l", "\tcp\t80h", "\tjp\tc, pb_p2",       # H==0,L<0x80 (tiles 0x00-0x0f) -> p2
    "pb_font:", "\tld\tde, pat_font_base", "\tret",    # tiles 0x10-0x3f -> дыра2 work-RAM
    # --- SCREEN2 8x8 tile blitter (TWO-PLANE: background -> plane 0 ONLY, 2-colour) ---
    # In: A=tile, B=row(0-23), C=col(0-31). Writes only bit-plane 0 (0x8000) so the
    # background is 2-colour (index 0=black, index 1=grey). 4x fewer writes than the
    # old 4-plane monochrome blitter. Sprites live in plane 1 (XOR), so they never
    # touch the background here.
    # --- Задача 2цв-фон (2026-07-12): обёртка. vbt_core рисует p0; затем p1 пишется
    # по флагу "белый тайл" (bit7 mode-таблицы, calc_mode): белый -> копия паттерна p0
    # в p1 (idx12=БЕЛЫЙ: лестницы/текст); иначе p1=0 (idx8=синие стены / idx0 чёрный).
    # p1(0xA000) свободна (спрайты в p3). Не трогает SP-хайджек ядра (p1-проход после
    # возврата vbt_core, только память). Вызывается из vec_nat_room и vcp_cells.
    # (Весь этот A+/COLOR2 путь эмитится ТОЛЬКО при KV_8COLOR OFF; при ON — 8-цветный ниже.)
    *(([
    "vec_blit_tile:",
    # brillo-тайлы гем (0x51-0x53): мерцание сокровищ через ПАЛИТРУ, а не через
    # перезапись цвета/плоскостей. Рисуем паттерн блёстки в план1, план0 чистим ->
    # пиксели получают idx4 (p0=0,p1=1) — комбинация НИГДЕ больше не используется
    # (проверено сканом плоскостей title/menu/gameplay). Цвет idx4/idx6 крутится
    # покадрово в ISR (vec_brillo_pal) чёрн/бел/жёлт как оригинал coloresBrillo:
    # 0 записей в col_shadow, 0 перерисовки fb (пиксели статичны, меняется лишь
    # палитра-регистр -> защёлкивается по кадру, идеально для мерцания).
    "\tld\ta, (vw_byte)", "\tcp\t51h", "\tjp\tc, vbt_norm",
    "\tcp\t54h", "\tjp\tc, vec_blit_brillo",
    "vbt_norm:",
    "\tpush\tbc",                                          # save row(B), col(C)
    "\tcall\tvbt_core",                                    # plane 0 (unchanged blitter)
    "\tpop\tbc",
    "\tld\th, (vec_tilemode>>8)&255",                     # bank-agnostic 1x256 mode cache
    "\tld\ta, (vw_byte)", "\tld\tl, a",                    # HL = &mode[tile]
    "\tld\ta, (hl)", "\tand\t80h", "\tld\tl, a",           # L = white flag (0 / 0x80)
    # Часть 2 (_MAPCOLOR): линиям карты (тайлы 0xC0-0xE7, mode2=inverted) white-бит взводится ОДИН РАЗ
    # в setupPergamino (vec_map_whiteforce) -> здесь читается штатно, БЕЗ доп. тактов на геймплейный
    # блит (иначе frame-drop coupling сдвигал бы p2). Линия -> p1=копия p0 (idx12 бел фон + idx0 чёрн).
    "\tld\ta, c", "\tadd\ta, 0A0h", "\tld\td, a",          # D = plane1 hi (0xA0+col)
    "\tld\ta, b", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl", "\tld\te, a",  # E = 255-row*8
    # Пакет 2: кирпичи 0x40-0x44 = ДВУХЦВЕТНЫЕ по строкам (per-row p1) вместо однобитного
    # white-флага. C=col ещё валиден; D=0xA0+col, E=255-row*8 уже готовы -> в vbt_brick.
    *((["\tld\ta, (vw_byte)", "\tsub\t40h", "\tcp\t5", "\tjp\tc, vbt_brick"]) if _COLOR2 else ()),
    "\tld\ta, l", "\tor\ta", "\tjp\tz, vbt_p1clr",
    "\tld\ta, c", "\tadd\ta, 80h", "\tld\th, a", "\tld\tl, e",  # HL = plane0 src (0x80+col : E)
    "\tld\tb, 8",
    "vbt_p1cp:",                                           # white tile: copy p0 -> p1 (8 rows)
    "\tld\ta, (hl)", "\tld\t(de), a", "\tdec\tl", "\tdec\te", "\tdec\tb", "\tjp\tnz, vbt_p1cp",
    "\tret",
    "vbt_p1clr:",                                          # non-white: clear p1 (8 rows)
    "\txor\ta", "\tld\tb, 8",
    "vbt_p1cl:",
    "\tld\t(de), a", "\tdec\te", "\tdec\tb", "\tjp\tnz, vbt_p1cl",
    "\tret",
    # --- Пакет 2: кирпич 0x40-0x44, двухцветный по строкам (per-row p1 маска) ----------
    # ColoresPiedra scheme0 (msx:7724) = 2,A0h 2,60h 2,A0h 2,60h -> сверху вниз 2 строки
    # fg10(dark-yellow=ЗОЛОТО) / 2 fg6 / 2 fg10 / 2 fg6. У нас: золото->idx8(p1=0),
    # второй->idx12(p1=1=белый). Маска строк 0..7 (MSB=строка0, 0=idx8 золото, 1=idx12
    # белый) = 00110011b = 33h. p0 уже нарисован vbt_core; здесь пишем ТОЛЬКО p1(0xA0+col).
    # D=0xA0+col, E=255-row*8 подготовлены в vbt_norm. (Смена схемы по piramideActual —
    # TODO: захардкожен scheme0; ChgStoneColor крутит 4 схемы каждые 4 пирамиды.)
    *((["vbt_brick:",
        "\tld\ta, c", "\tadd\ta, 80h", "\tld\th, a", "\tld\tl, e",   # HL = plane0 src (0x80+col : E)
        "\tld\tc, 033h",                                             # маска строк (MSB=строка0)
        "\tld\tb, 8",
        "vbt_brk_l:",
        "\tld\ta, c", "\tadd\ta, a", "\tld\tc, a",                   # carry = бит строки (idx12 если 1)
        "\tld\ta, (hl)", "\tjp\tc, vbt_brk_w",                       # 1 -> p1=паттерн (idx12 белый)
        "\txor\ta",                                                  # 0 -> p1=0 (idx8 золото)
        "vbt_brk_w:",
        "\tld\t(de), a", "\tdec\tl", "\tdec\te", "\tdec\tb", "\tjp\tnz, vbt_brk_l",
        "\tret"]) if _COLOR2 else ()),
    ]) if not _8COLOR else ()),
    # ================= ФАЗА 1: 8-ЦВЕТНЫЙ КОМПОЗИТ-ФОН (3 плоскости p0/p1/p2) =================
    # vec_blit_tile под KV_8COLOR: vbt_core рисует ШЕЙП тайла в p0 (все режимы: blank/pattern/
    # inverted/solid/mixed). Затем ЦВЕТ через 3 плоскости:
    #   p1 = ШЕЙП если тайл БЕЛЫЙ (runtime white-бит vec_tilemode, как в базе: текст/лестн-верх),
    #        иначе 0. => БЕЗ vec_col8-правок фон = базовый 2-цв (idx8 стены / idx12 белый), но на
    #        8-цв палитре -> сразу КОРРЕКТНЫЙ рендер без мусора.
    #   p2 = ШЕЙП если vec_col8[tile] бит0 (доп. цвет-ось: idx8->idx10, idx12->idx14).
    #   p0 = ОЧИСТИТЬ если vec_col8[tile] бит1 (увести цвет с p0: idx8->idx0/idx4, +p2 -> idx2/idx6).
    # Пиксель шейпа -> idx=(p0<<3)|(p1<<2)|(p2<<1) (чёт => p3-схлопка); void (нет шейпа) => idx0.
    # Порядок КРИТИЧЕН: p1/p2 копируют p0-шейп ДО очистки p0. brillo гем (0x51-0x53) -> свой путь.
    # Медленнее (до 24 memops/тайл) — correctness-first; скорость (pre-shift p3) = след. фаза.
    *(([
    "vec_blit_tile:",
    # _8C_RL2: обёртка — после блита обновить пересекающиеся save-слоты СВЕЖИМ фоном
    # (vec_su_fixup, B=row/C=col). Иначе restore спрайта воскрешал бы стёртый гем/копку.
    *((["\tpush\tbc", "\tcall\tvbt8_ent", "\tpop\tbc", "\tjp\tvec_su_fixup",
        # vec_su_fixup: B=row(0-23), C=col(0-31) свежеблитнутой клетки. Для каждого валидного
        # слота: пересечение по столбцу (col в [c0,c0+ncols)) и строкам (клетка [ytop-7,ytop],
        # слот [lo0-15,lo0], y убывает вверх) -> копировать fb(плоскость слота)->данные слота.
        # Быстрый выход по vsu_any (0 => слотов нет: bulk-отрисовка комнаты почти бесплатна).
        # Клоб A,B,C,D,E,H,L (как сам vec_blit_tile).
        "vec_su_fixup:",
        "\tld\ta, (vsu_any)", "\tor\ta", "\tret\tz",
        "\tld\ta, b", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl", "\tld\t(vfx_ytop), a",
        "\tld\ta, c", "\tld\t(vfx_col), a",
        "\txor\ta", "\tld\t(vfx_idx), a",
        "vfx_loop:"]
       + ((["\tld\ta, (vfx_idx)", "\tld\tl, 0"])                # слот 256Б: H=0xE0+idx, L=0
          if _8C_MASK else
          (["\tld\ta, (vfx_idx)", "\tld\tb, a"]
           + ((["\tand\t1", "\trrca", "\tld\tl, a",            # L=(idx&1)*128 (слот 128Б)
                "\tld\ta, b", "\tor\ta", "\trra"]) if _8C_AURA else
              (["\tand\t3", "\trrca", "\trrca", "\tld\tl, a",  # L=(idx&3)*64
                "\tld\ta, b", "\tor\ta", "\trra", "\tor\ta", "\trra"]))))  # A=idx>>2
       + ["\tadd\ta, 0E0h", "\tld\th, a",                      # HL=слот
        "\tld\ta, (hl)", "\tor\ta", "\tjp\tz, vfx_next",       # invalid
        "\tinc\thl", "\tld\ta, (hl)", "\tld\td, a",            # D=hi0
        "\tinc\thl", "\tld\ta, (hl)", "\tld\te, a",            # E=lo0
        "\tinc\thl", "\tld\ta, (hl)", "\tld\tc, a"]            # C=ncols
       + ((["\tinc\thl", "\tld\ta, (hl)", "\tld\t(vfx_hib), a",  # hi0b (0=одна плоскость)
            "\tld\ta, c", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a",
            "\tld\t(vfx_n16), a"]) if _8C_AURA else [])        # ncols*16 = смещение dataB
       + ["\tinc\thl",                                          # HL=data
        "\tld\ta, d", "\tand\t1Fh", "\tld\tb, a",              # B=c0
        "\tld\ta, (vfx_col)", "\tsub\tb", "\tjp\tc, vfx_next", # col<c0
        "\tcp\tc", "\tjp\tnc, vfx_next",                       # off>=ncols
        "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a",  # off*16 (off<=2)
        "\tadd\ta, l", "\tld\tl, a", "\tld\ta, h", "\tadc\ta, 0", "\tld\th, a",
        # ФОРМАТ POP (низ-вверх): E = lo_b (НИЗ столбца), данные слота идут по росту y.
        "\tld\ta, (vfx_ytop)", "\tld\tb, a",                   # B=ytop (верх клетки)
        "\tld\ta, e", "\tadd\ta, 15",                          # A=lo_top=lo_b+15
        "\tcp\tb", "\tjp\tnc, vfx_t1",                         # lo_top>=ytop -> t=ytop
        "\tjp\tvfx_t2",
        "vfx_t1:", "\tld\ta, b",
        "vfx_t2:",
        "\tld\t(vfx_t), a",                                    # t=min(ytop,lo_top)
        "\tld\ta, b", "\tsub\t7", "\tld\tb, a",                # B=ytop-7 (низ клетки)
        "\tld\ta, e",                                          # A=lo_b (низ столбца)
        "\tcp\tb", "\tjp\tnc, vfx_b1",
        "\tld\ta, b",
        "vfx_b1:",
        "\tld\tc, a",                                          # C=bottom=max(ytop-7,lo_b)
        "\tld\ta, (vfx_t)", "\tcp\tc", "\tjp\tc, vfx_next",    # t<bottom -> нет пересечения
        "\tsub\tc", "\tinc\ta", "\tld\tb, a",                  # B=count (1..8)
        "\tld\ta, c", "\tsub\te",                              # bottom - lo_b = смещение в данных
        "\tld\te, c",                                          # E=bottom (старт y, идём ВВЕРХ)
        "\tadd\ta, l", "\tld\tl, a", "\tld\ta, h", "\tadc\ta, 0", "\tld\th, a",
        "\tld\ta, d", "\tand\t0E0h", "\tld\tc, a",             # плоскость слота
        "\tld\ta, (vfx_col)", "\tadd\ta, c", "\tld\td, a"]     # D=плоскость+col (fb src hi)
       + ((["\tld\t(vfx_dst), hl",                             # реплей-параметры для 2-й плоскости
            "\tld\ta, b", "\tld\t(vfx_cnt), a",
            "\tld\ta, e", "\tld\t(vfx_tt), a"]) if _8C_AURA else [])
       # Пересечение подтверждено: слот получает свежий фон И помечается sticky-dirty ->
       # фаза F следующего кадра перерисует спрайт (иначе фон-блит «съел» бы статичный спрайт).
       + ((["\tpush\thl", "\tld\ta, (vfx_idx)", "\tadd\ta, vfl_dirty&255", "\tld\tl, a",
            "\tld\th, (vfl_dirty>>8)&255", "\tld\t(hl), 1", "\tpop\thl"]) if _8C_RLG else [])
       + ["vfx_row:",
        "\tld\ta, (de)", "\tld\t(hl), a",                      # слот <- свежий fb
        "\tinc\thl", "\tinc\te", "\tdec\tb", "\tjp\tnz, vfx_row"]
       + ((["\tld\ta, (vfx_hib)", "\tor\ta", "\tjp\tz, vfx_next",  # dual: та же геометрия, плоскость B
            "\tand\t0E0h", "\tld\tc, a",
            "\txor\ta", "\tld\t(vfx_hib), a",                  # гейт: один реплей
            "\tld\ta, (vfx_col)", "\tadd\ta, c", "\tld\td, a", # fb src hi плоскости B
            "\tld\thl, (vfx_dst)",
            "\tld\ta, (vfx_n16)", "\tadd\ta, l", "\tld\tl, a", "\tld\ta, h", "\tadc\ta, 0", "\tld\th, a",
            "\tld\ta, (vfx_tt)", "\tld\te, a",
            "\tld\ta, (vfx_cnt)", "\tld\tb, a",
            "\tjp\tvfx_row"]) if _8C_AURA else [])
       + ["vfx_next:",
        "\tld\ta, (vfx_idx)", "\tinc\ta", "\tld\t(vfx_idx), a",
        "\tcp\t21", "\tjp\tc, vfx_loop",
        "\tret",
        "vbt8_ent:"]) if _8C_RL2 else ()),
    "\tld\ta, (vw_byte)", "\tcp\t51h", "\tjp\tc, vbt8_norm",
    "\tcp\t54h", "\tjp\tc, vec_blit_brillo",
    "vbt8_norm:",
    "\tpush\tbc", "\tcall\tvbt_core", "\tpop\tbc",         # p0 = ШЕЙП (B=row, C=col сохранены)
    "\tld\ta, b", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl", "\tld\t(vbt8_e), a",  # Etop=255-row*8
    "\tld\th, (vec_tilemode>>8)&255", "\tld\ta, (vw_byte)", "\tld\tl, a", "\tld\ta, (hl)",
    "\tand\t80h", "\tld\t(vbt8_wf), a",                    # white-флаг (0 / 0x80) для p1
    "\tld\th, (vec_col8>>8)&255", "\tld\ta, (vw_byte)", "\tld\tl, a", "\tld\ta, (hl)",  # cc = vec_col8[tile]
    "\tld\t(vbt8_c8), a",
    # 2a КИРПИЧИ 2-ТОН: тайлы 0x40-0x44 -> per-row золото(idx8)/красн(idx4), НЕ через p1/p2/cc.
    *((["\tld\ta, (vw_byte)", "\tsub\t40h", "\tcp\t5", "\tjp\tc, vbt8_brick"]) if _BRICK2 else ()),
    # --- p1 = шейп если тайл белый, иначе 0 ---
    "\tld\ta, c", "\tadd\ta, 80h", "\tld\th, a", "\tld\ta, (vbt8_e)", "\tld\tl, a",       # HL = p0 src top
    "\tld\ta, c", "\tadd\ta, 0A0h", "\tld\td, a", "\tld\ta, (vbt8_e)", "\tld\te, a",     # DE = p1 dst top
    "\tld\ta, (vbt8_wf)", "\tcall\tvbt8_wrow",
    # --- p2 = шейп если cc бит0, иначе 0 ---
    "\tld\ta, c", "\tadd\ta, 80h", "\tld\th, a", "\tld\ta, (vbt8_e)", "\tld\tl, a",     # HL = p0 src top
    "\tld\ta, c", "\tadd\ta, 0C0h", "\tld\td, a", "\tld\ta, (vbt8_e)", "\tld\te, a",     # DE = p2 dst top
    "\tld\ta, (vbt8_c8)", "\tand\t1", "\tcall\tvbt8_wrow",
    # --- p0: очистить если cc бит1 ---
    "\tld\ta, (vbt8_c8)", "\tand\t2", "\tret\tz",                                        # бит1=0 -> p0 хранит шейп
    "\tld\ta, c", "\tadd\ta, 80h", "\tld\td, a", "\tld\ta, (vbt8_e)", "\tld\te, a",     # DE = p0 dst top
    "\txor\ta", "\tcall\tvbt8_wrow",
    "\tret",
    # vbt8_wrow: A=флаг (0 -> очистить 8 строк нулём; !=0 -> копировать HL(p0 src)->DE, 8 строк).
    # dec l/dec e построчно (low-байт адреса = Y). Клоб. A,B,HL,DE.
    "vbt8_wrow:",
    "\tor\ta", "\tjp\tz, vbt8_clr",
    "\tld\tb, 8",
    "vbt8_cp:",
    "\tld\ta, (hl)", "\tld\t(de), a", "\tdec\tl", "\tdec\te", "\tdec\tb", "\tjp\tnz, vbt8_cp",
    "\tret",
    "vbt8_clr:",
    "\tld\tb, 8", "\txor\ta",
    "vbt8_cl:",
    "\tld\t(de), a", "\tdec\te", "\tdec\tb", "\tjp\tnz, vbt8_cl",
    "\tret",
    # 2a vbt8_brick: кирпич 0x40-0x44 двухцветный по строкам. p0 уже = шейп (vbt_core). Маска
    # 033h (MSB=строка0): бит0 -> золото (p0=шейп, p1=0 -> idx8); бит1 -> красн (p0=0, p1=шейп
    # -> idx4). p2 не трогаем (=0). C=col, vbt8_e=255-row*8 на входе. Клоб A,B,C,D,E,H,L.
    *((["vbt8_brick:",
        "\tld\ta, c", "\tadd\ta, 80h", "\tld\th, a", "\tld\ta, (vbt8_e)", "\tld\tl, a",   # HL = p0 (0x80+col : E)
        "\tld\ta, c", "\tadd\ta, 0A0h", "\tld\td, a", "\tld\ta, (vbt8_e)", "\tld\te, a",   # DE = p1 (0xA0+col : E)
        "\tld\tc, 033h",                                                # маска строк (MSB=строка0)
        "\tld\tb, 8",
        "vbt8_brk_l:",
        "\tld\ta, c", "\tadd\ta, a", "\tld\tc, a",                      # carry = бит строки (1 -> красн)
        "\tjp\tc, vbt8_brk_red",
        "\txor\ta", "\tld\t(de), a"]                                    # золото-строка: p1=0
       + ((["\tld\ta, d", "\tadd\ta, 20h", "\tld\td, a",                # AURA: p2=0 тоже
            "\txor\ta", "\tld\t(de), a",
            "\tld\ta, d", "\tsub\t20h", "\tld\td, a"]) if _8C_AURA else [])
       + ["\tjp\tvbt8_brk_nx",
        "vbt8_brk_red:",
        "\tld\ta, (hl)", "\tld\t(de), a"]                              # красн-строка: p1=шейп
       + ((["\tld\ta, d", "\tadd\ta, 20h", "\tld\td, a",                # AURA: p2=шейп -> idx6 красный
            "\tld\ta, (hl)", "\tld\t(de), a",
            "\tld\ta, d", "\tsub\t20h", "\tld\td, a"]) if _8C_AURA else [])
       + ["\txor\ta", "\tld\t(hl), a",                                  #               p0=0
        "vbt8_brk_nx:",
        "\tdec\tl", "\tdec\te", "\tdec\tb", "\tjp\tnz, vbt8_brk_l",
        "\tret"]) if _BRICK2 else ()),
    ]) if _8COLOR else ()),
    "vbt_core:",
    # tile render mode from vec_tilemode (предвычислен эагерно при загрузке цвета,
    # Фаза C1): байт = white(bit7) | mix-slot(биты6-3) | mode(биты2-0). mode: 0=blank
    # 1=pattern 2=inverted 3=solid 4=mixed. FF (не вычислен) -> рисуем blank (как
    # baseline на пустом col_shadow); в геймплее не встречается (тайлсет грузится до блита).
    "\tld\th, (vec_tilemode>>8)&255",                     # 1x256 mode cache (work-RAM)
    "\tld\ta, (vw_byte)", "\tld\tl, a",                    # HL = &mode[tile]
    "\tld\ta, (hl)", "\tcp\t0FFh", "\tjp\tnz, vbtc_ok",
    "\txor\ta",                                            # FF -> mode 0 (blank)
    "vbtc_ok:",
    "\tand\t07h",                                          # strip white(bit7)+slot(6-3) -> mode 0-4
    "\tld\t(vw_tmp), a",
    "\tld\ta, (vw_byte)", "\tld\tl, a", "\tld\th, 0",
    "\tadd\thl, hl", "\tadd\thl, hl", "\tadd\thl, hl",     # tile*8
    "\tcall\tpat_base", "\tadd\thl, de",                   # DE=база по диапазону tile (шаг3): maze/font
                                                            # -> work-RAM, меню -> p2 vec_pat_shadow
                                                            # (3 SCREEN2 банка байт-идентичны в геймплее)
    "\tld\ta, c", "\tadd\ta, 80h", "\tld\td, a",           # D = plane0 hi (0x80+col)
    "\tld\ta, b", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl", "\tld\te, a",  # E = 255-row*8 (low)
    "\tld\tb, 8",
    "\tld\ta, (vw_tmp)",                                   # dispatch on mode
    "\tor\ta", "\tjp\tz, vbt_blank",
    "\tcp\t2", "\tjp\tc, vbt_row",                         # 1 -> normal
    "\tjp\tz, vbt_inv",                                    # 2 -> inverted
    "\tcp\t3", "\tjp\tnz, vbt_mix",                        # 4 -> per-row mixed; 3 -> solid
    "vbt_solid:",
    "\tld\ta, 0FFh", "\tjp\tvbt_fill8",
    "vbt_blank:",
    "\txor\ta",
    "vbt_fill8:",                                          # unrolled 8-row constant fill
    "\tld\t(de), a", "\tdec\te", "\tld\t(de), a", "\tdec\te",
    "\tld\t(de), a", "\tdec\te", "\tld\t(de), a", "\tdec\te",
    "\tld\t(de), a", "\tdec\te", "\tld\t(de), a", "\tdec\te",
    "\tld\t(de), a", "\tdec\te", "\tld\t(de), a",
    "\tret",
    "vbt_inv:",
    "\tld\ta, (hl)", "\tcpl", "\tinc\thl", "\tld\t(de), a", "\tdec\te", "\tdec\tb", "\tjp\tnz, vbt_inv", "\tret",
    # POP-blitter (OldTower technique): SP = pattern data, POP reads 2 rows per
    # 11 clk. Safe: the blitter runs ONLY from the compositor (ISR, interrupts off).
    "vbt_row:",                                            # DE=fb addr, HL=pat ptr
    "\tdi",                                                 # the WHOLE prologue must be atomic:
    "\tld\t(vbt_pp), hl",                                  # an ISR-drain blit would overwrite
    "\tld\thl, 0", "\tadd\thl, sp", "\tld\t(vw_paddr), hl",  # vbt_pp/vw_paddr (main blitted
    "\tld\thl, (vbt_pp)", "\tld\tsp, hl",                # a cell with a FOREIGN pattern)
    "\tex\tde, hl",                                        # HL = fb addr
    "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d", "\tdec\tl",  # rows 0,1
    "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d", "\tdec\tl",  # rows 2,3
    "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d", "\tdec\tl",  # rows 4,5
    "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d",              # rows 6,7
    "\tld\thl, (vw_paddr)", "\tld\tsp, hl",                # restore SP
    "\tld\ta, (vec_isr_depth)", "\tor\ta", "\tjp\tnz, vbt_noei",  # inside the ISR: keep DI
    "\tei",
    "vbt_noei:",
    "\tret",
    # Mixed tile (rows differ in colour, e.g. the stairs: top rows black, rest white):
    # per row fetch the colour byte (shadow layout is parallel: colour = pattern + 0x1B00)
    # and compose out = (fg visible ? pat : 0) | (bg visible ? ~pat : 0).
    "vbt_mix:",
    # P2-ФИНАЛ: построчный цвет mixed-тайла берём из SLOT-компактной vec_mixbuf. slot =
    # vec_slot_of(tile-0x50) (линейный скан vec_mixtiles); база = vec_mixbuf + slot*8. vbt_mix
    # достигается ТОЛЬКО при mode==4 (mixed) -> tile всегда один из 15 слотированных -> slot
    # валиден (1..15). vbt_mc = построчный 16-битный указатель (инкремент по строкам).
    "\tpush\thl",
    "\tpush\tde",                                                  # C1-fix: DE = dest ptr в p0 framebuffer; ld de,vec_mixbuf ниже его затирает
    "\tld\ta, (vw_byte)", "\tsub\t50h", "\tcall\tvec_slot_of",     # A=slot(1..15); сохр. BC/DE, клоб. HL
    "\tld\tl, a", "\tld\th, 0", "\tadd\thl, hl", "\tadd\thl, hl", "\tadd\thl, hl",  # slot*8
    "\tld\tde, vec_mixbuf-8", "\tadd\thl, de", "\tld\t(vbt_mc), hl", # HL = &mixbuf[(slot-1)*8] (база-8)
    "\tpop\tde",                                                   # C1-fix: восстановить dest-указатель p0 (иначе vbt_mix_l пишет в 0xD400)
    "\tpop\thl",
    "vbt_mix_l:",
    "\tpush\thl", "\tld\thl, (vbt_mc)", "\tld\tc, (hl)", "\tinc\thl", "\tld\t(vbt_mc), hl", "\tpop\thl",
    "\tld\ta, (hl)", "\tinc\thl", "\tld\t(vw_tmp), a",     # pattern byte
    "\tld\ta, c", "\tand\t0F0h", "\tcp\t20h",              # fg visible?
    "\tld\ta, (vw_tmp)", "\tjp\tnc, vbt_mx1",
    "\txor\ta",
    "vbt_mx1:", "\tld\t(vbt_fg), a",                       # fg contribution
    "\tld\ta, c", "\tand\t0Fh", "\tcp\t2",                 # bg visible?
    "\tld\ta, (vw_tmp)", "\tjp\tc, vbt_mx2",
    "\tcpl", "\tjp\tvbt_mx3",
    "vbt_mx2:", "\txor\ta",
    "vbt_mx3:", "\tld\tc, a", "\tld\ta, (vbt_fg)", "\tor\tc",
    "\tld\t(de), a", "\tdec\te",
    "\tdec\tb", "\tjp\tnz, vbt_mix_l",
    "\tret",
    # P2-ФИНАЛ: vec_slot_of — линейный скан 15-байтной vec_mixtiles (заменяет vec_mixslot LUT).
    # Вход: A = tile-0x50 (индекс). Выход: A = slot(1..15) или 0 если не mixed. Сохр. BC,DE; клоб. HL,A.
    "vec_slot_of:",
    "\tpush\tbc",
    "\tld\thl, vec_mixtiles", "\tld\tc, a", "\tld\tb, 0",  # C=искомый индекс, B=позиция(0-based)
    "vslo_l:",
    "\tld\ta, (hl)", "\tcp\tc", "\tjp\tz, vslo_hit",
    "\tinc\thl", "\tinc\tb", "\tld\ta, b", "\tcp\t15", "\tjp\tnz, vslo_l",
    "\txor\ta", "\tpop\tbc", "\tret",                      # не найден -> 0
    "vslo_hit:",
    "\tld\ta, b", "\tinc\ta", "\tpop\tbc", "\tret",        # slot = позиция+1
    # === Фаза C1: render-mode считается при загрузке цвета (заменяет lazy vec_calc_mode,
    # === читавший снятую 2К col_shadow). P2-ЧИСТКА: сырой цвет ТОЛЬКО для 15 реальных mixed-
    # === тайлов (vec_mixslot[tile]!=0xFF -> slot 0..14). Для них mode+white пересчитываем
    # === ПОЛНОСТЬЮ из 8 строк vec_mixbuf[slot] (позиционно перезаписывается => БАЙТ-В-БАЙТ как
    # === baseline и устойчиво к фрагментации/перезагрузке). Не-slotted тайлы НИКОГДА не mixed
    # === (замер: все лестницы в 15 slot) => дешёвый инкрементальный uniform-mode+white
    # === с детектором перезагрузки (count в битах6-3). vbt_core: mode=байт&7; white=байт&80.
    # vec_col_store: HL = folded masked colour addr (0x0000-0x07FF), A = байт. Сохр. BC,DE,HL.
    "vec_col_store:",
    "\tpush\thl", "\tpush\tde", "\tpush\tbc",
    "\tld\tc, a",                                          # C = colour byte
    "\tld\ta, l", "\tand\t7", "\tld\tb, a",                # B = row = addr&7
    "\tld\ta, l", "\trrca", "\trrca", "\trrca", "\tand\t1Fh", "\tld\te, a",       # L>>3
    "\tld\ta, h", "\tand\t7", "\trlca", "\trlca", "\trlca", "\trlca", "\trlca", "\tor\te",  # (H&7)<<5|L>>3
    "\tld\t(vec_curtile), a",                              # = tile (A=tile)
    # range-гейт: индекс (tile-0x50), проверяем ТОЛЬКО для tile в [0x50,0x90) (mixtiles тут).
    "\tsub\t50h", "\tjp\tc, vcs_oor",                     # tile<0x50 -> uniform incremental path
    "\tcp\t40h", "\tjp\tnc, vcs_oor",                     # tile>=0x90 -> uniform incremental path
    "\tcall\tvec_slot_of",                               # A = slot(1..15) или 0 (сохр. BC/DE, клоб. HL)
    "\tor\ta", "\tjp\tz, vcs_oor",                        # 0 = в диапазоне, но не один из 15 -> uniform
    # --- mixed (slot 1..15): store byte to mixbuf, then FULL recompute mode+white ---
    "\tld\tl, a", "\tld\th, 0", "\tadd\thl, hl", "\tadd\thl, hl", "\tadd\thl, hl",  # slot*8
    "\tld\tde, vec_mixbuf-8", "\tadd\thl, de",            # HL = &mixbuf[(slot-1)*8] (база-8 => без dec)
    "\tld\td, 0", "\tld\te, b", "\tpush\thl", "\tadd\thl, de", "\tld\t(hl), c", "\tpop\thl",  # mixbuf[+row]=byte
    "\tcall\tvec_mode_from8",                             # HL=&8 colour bytes -> A = white|mode(0-4)
    "\tld\te, a",
    "\tld\ta, (vec_curtile)", "\tld\tl, a", "\tld\th, (vec_tilemode>>8)&255", "\tld\t(hl), e",
    "\tjp\tvcs_done",
    "vcs_oor:",
    # rowmode(0-3) -> E; whitebit(0/0x80) -> D (для инкрементального uniform-пути)
    "\tld\ta, c", "\tand\t0F0h", "\tcp\t20h", "\tld\te, 0", "\tjp\tc, vcs_fg0", "\tld\te, 1",
    "vcs_fg0:",
    "\tld\ta, c", "\tand\t0Fh", "\tcp\t2", "\tjp\tc, vcs_bg0", "\tld\ta, e", "\tor\t2", "\tld\te, a",
    "vcs_bg0:",
    "\tld\ta, c", "\tand\t0F0h", "\tcp\t0E0h", "\tld\td, 0", "\tjp\tc, vcs_nw", "\tld\td, 80h",
    "vcs_nw:",
    # инкрементальный uniform-mode + детектор перезагрузки. Байт: white(7)|count(6-3,1..8)|
    # mode(2-0). count>=8 или FF => новая загрузка (title->game/комната/банк) -> с нуля.
    "\tld\ta, (vec_curtile)", "\tld\tl, a", "\tld\th, (vec_tilemode>>8)&255",  # HL=&mode[tile]
    "\tld\tb, (hl)",                                      # B = cur
    "\tld\ta, b", "\tcp\t0FFh", "\tjp\tz, vcs_fresh",     # не вычислен -> свежий
    "\tld\ta, b", "\trrca", "\trrca", "\trrca", "\tand\t0Fh", "\tcp\t08h", "\tjp\tnc, vcs_fresh",  # count>=8 -> reload
    # merge (вне диапазона тайл всегда uniform: ref==rowmode; отличие теоретически -> 4,
    # но такого тут нет). B=cur, D=white, E=rowmode
    "\tld\ta, b", "\tand\t07h",
    "\tcp\t04h", "\tjp\tz, vcs_m4",
    "\tcp\te", "\tjp\tz, vcs_mcompose",
    "\tld\te, 04h", "\tjp\tvcs_mcompose",
    "vcs_m4:", "\tld\te, 04h",
    "vcs_mcompose:",
    "\tld\ta, b", "\tand\t0F8h", "\tadd\ta, 08h", "\tor\td", "\tor\te",  # count++ | white | mode
    "\tld\t(hl), a", "\tjp\tvcs_done",
    "vcs_fresh:",
    "\tld\ta, d", "\tor\t08h", "\tor\te", "\tld\t(hl), a",  # white | count=1 | rowmode
    "vcs_done:",
    "\tpop\tbc", "\tpop\tde", "\tpop\thl", "\tret",
    # vec_mode_from8: HL = &8 colour bytes -> A = white(0x80) | mode(0-4). Полный пересчёт
    # (ref=mode строки0; любая отличная строка -> mode4; white = OR fg>=14). БАЙТ-В-БАЙТ
    # как прежний vec_calc_mode. Сохраняет BC, DE, HL.
    "vec_mode_from8:",
    "\tpush\tbc", "\tpush\tde", "\tpush\thl",
    "\tld\td, 0",                                          # D = white accum
    "\tld\ta, (hl)", "\tcall\tvmf_row", "\tld\tc, e",      # C = ref (row0 mode)
    "\tld\tb, 7",
    "vmf_l:",
    "\tinc\thl", "\tld\ta, (hl)", "\tcall\tvmf_row",
    "\tld\ta, e", "\tcp\tc", "\tjp\tnz, vmf_mixed",
    "\tdec\tb", "\tjp\tnz, vmf_l",
    "\tld\ta, c", "\tjp\tvmf_done",                        # uniform: mode=ref
    "vmf_mixed:", "\tld\ta, 4",
    "vmf_done:",
    "\tor\td",                                             # | white
    "\tpop\thl", "\tpop\tde", "\tpop\tbc", "\tret",
    # vmf_row: A = colour byte -> E = rowmode(0-3); D |= white(0x80 if fg>=14). Сохр. B,C,HL.
    "vmf_row:",
    "\tld\te, 0",
    "\tpush\taf", "\tand\t0F0h", "\tcp\t20h", "\tjp\tc, vmf_r1", "\tld\te, 1",
    "vmf_r1:",
    "\tpop\taf", "\tpush\taf", "\tand\t0Fh", "\tcp\t2", "\tjp\tc, vmf_r2", "\tld\ta, e", "\tor\t2", "\tld\te, a",
    "vmf_r2:",
    "\tpop\taf", "\tand\t0F0h", "\tcp\t0E0h", "\tjp\tc, vmf_r3", "\tld\ta, d", "\tor\t80h", "\tld\td, a",
    "vmf_r3:", "\tret",
    # vnsx_rev16: HL=src (16 подряд байт) -> HL=vnsx_revbuf, каждый байт бит-реверснут
    # (bit0<->bit7) для ЗЕРКАЛЬНЫХ (left-facing) спрайтов. ОПТИМИЗАЦИЯ 2026-07-15: реверс
    # через готовый LUT vec_revtab (256Б, ALIGN 256, уже в ROM для invierteByte) вместо
    # побитового 8× rrca/rla цикла. Профиль показал: старый путь (vnr16b) = ~25% кадра —
    # крупнейший хотспот. Lookup ~4× быстрее (реверс зеркала ~25%->~6% кадра). Код КОРОЧЕ
    # -> адресный сдвиг не грозит (rot-петли остаются < vec_spr_buf 0x6598). Сохраняет BC
    # (C=экранный X для vec_nsx_col). Клоббер A,DE,HL. Одна половина за раз — blit её
    # потребляет до след. вызова. Размещён ЗДЕСЬ (до ALIGN 256, padding перед revtab).
    "vnsx_rev16:",
    "\tpush\tbc",
    "\tld\tde, vnsx_revbuf", "\tld\tb, 16",
    "vnr16:",
    "\tld\ta, (hl)", "\tinc\thl",                   # A = src byte; advance src ptr
    "\tpush\thl",                                    # save src ptr (HL нужен под LUT-индекс)
    "\tld\tl, a", "\tld\th, vec_revtab>>8",          # HL = vec_revtab + byte
    "\tld\ta, (hl)",                                 # A = bit-reverse(byte) по LUT (1 обращение)
    "\tpop\thl",                                     # restore src ptr
    "\tld\t(de), a", "\tinc\tde",
    "\tdec\tb", "\tjp\tnz, vnr16",
    "\tpop\tbc",
    "\tld\thl, vnsx_revbuf", "\tret",
    # === Фаза A+: clear_box — стирает footprint спрайта (16 строк x 3 столбца) в ПЛОСКОСТИ
    # === из vnc_pbase. Заменяет XOR-самостирание (overwrite/OR-блиттер не самостирается).
    # === Вход: HL -> [Y,X,...]; Y>=0xD0 -> скрыт, no-op. Клоб. A,BC,DE,HL. 3 столбца
    # === покрывают 16px спрайта + суб-пиксельный spill; guard col<32 (правый край).
    # === Размещён ЗДЕСЬ (до ALIGN 256), чтобы код поглотился padding'ом перед revtab и
    # === НЕ толкал блит-петли в vec_spr_buf (0x6598).
    "vec_nsx_clear:",                                      # HL->[Y,X,..]; плоскость в vnc_pbase
    "\tld\ta, (hl)", "\tcp\t0D0h", "\tret\tnc",           # скрыт -> стирать нечего
    "\tcpl", "\tld\t(vnce_lo), a",                        # 255-Y (верхняя строка)
    "\tinc\thl", "\tld\ta, (hl)",                         # X
    "\tld\tc, 3",                                          # по умолч. 3 столбца (16px + суб-пикс. spill)
    "\tand\t7", "\tjp\tnz, vnce_c3",                      # X&7 != 0 -> spill в 3-й столбец
    "\tdec\tc",                                            # X&7 == 0 -> ровно 2 столбца (нет spill, меньше over-clear)
    "vnce_c3:",
    "\tld\ta, (hl)",                                      # перечитать X (A затёрт and 7)
    "\trrca", "\trrca", "\trrca", "\tand\t1Fh", "\tld\td, a",  # D = col0 = X>>3
    "vnce_col:",
    "\tld\ta, d", "\tcp\t32", "\tjp\tnc, vnce_done",      # столбец за экраном -> стоп
    "\tld\ta, (vnc_pbase)", "\tadd\ta, d", "\tld\th, a",  # hi = plane-base + col
    "\tld\ta, (vnce_lo)", "\tld\tl, a",                   # lo = 255-Y
    # _POPSPR: развёрнутый 16-строчный стирающий проход (mov m,a, A=0) вместо dec-b цикла.
    # Пишет ТЕ ЖЕ 16 нулей в L=255-Y..255-Y-15 (H фикс) => байт-идентично vnce_row.
    *((["\txor\ta"] + [ln for _ in range(16) for ln in ("\tld\t(hl), a", "\tdec\tl")]
       + ["\tinc\td", "\tdec\tc", "\tjp\tnz, vnce_col"]) if _POPSPR else
      (["\tld\tb, 16",
        "vnce_row:",
        "\tld\t(hl), 0", "\tdec\tl", "\tdec\tb", "\tjp\tnz, vnce_row",
        "\tinc\td", "\tdec\tc", "\tjp\tnz, vnce_col"])),
    "vnce_done:", "\tret",
    # vec_mixtiles перенесён СЮДА (pre-align padding, освободившееся после сжатия clear_box)
    # из хвоста — иначе блит-петли толкались бы в vec_spr_buf (0x6598). 15 mixed-тайлов.
    "vec_mixtiles:",
    "\tdb\t001h,003h,00Ch,00Dh,00Eh,00Fh,010h,011h,013h,014h,016h,023h,024h,032h,033h",
    # --- UNIFIED TEXT SEAM: direct-blit helper for ALL text/digits ---------------
    # Единый шов для ВСЕГО текста игры (буквы + цифры шрифта). WriteDataVRAM (все
    # надписи HUD/меню/GAME OVER/финал) и renderNumber3/drawDigit (счёт/HI/жизни/
    # пирамида) раньше писали тайлы в name-таблицу через WRTVRM -> vw_name ->
    # vec_dirty_set -> компоситор (vcp_cells). Теперь оба зовут vec_text_blit,
    # который рисует тайл ПРЯМО в framebuffer через vec_blit_tile (как drawTile для
    # одной клетки), минуя soft-VDP name/dirty путь. Это снимает ВЕСЬ текст с
    # dirty-очереди (0 dirty от текста) и обобщает прежний точечный HUD-подход.
    #  Вход: HL = name addr (0x3800..0x3AFF), A = тайл (уже с маской для ClearData).
    #  Сохраняет HL, DE, BC (петля WriteDataVRAM держит HL=name/DE=data/C=mask;
    #  renderNumber3 держит HL=name/C=младший ниббл/DE=BCD-указатель между двумя
    #  цифрами). row/col из name-addr как в drawTile: col=L&1F, row=(H&3F-38)*8+L>>5.
    #  Обновляет vec_name_shadow[cell] для когерентности dedup (shadow отражает то,
    #  что реально на экране). Атомарность как в drawTile: di + сохранить/форсить
    #  vec_isr_depth=1 (vbt_row держит DI сквозь SP-хайджек) + ei ТОЛЬКО если были
    #  на depth 0 (main; из ISR игрового тика depth уже 1 -> keep DI).
    # ЕДИНЫЙ ШОВ / ГЕЙМПЛЕЙ-ПРЯМОЙ (=точка входа vec_put_tile(tile=A, name=HL)): ВСЕ
    # геймплейные писатели тайлов зовут vec_text_blit НАПРЯМУЮ вместо call WRTVRM -> НОЛЬ
    # soft-VDP (WRTVRM/vec_vram_write/vw_name-диспетчер) на геймплей-путях. Уже переведены
    # (см. _apply_vector_glue): drawTile-копка/ямы (inline, шаг «7»), шторка drawCortinilla
    # («7b»), двери drawPuerta + HUD renderNumber + текст WriteDataVRAM («7c/7d»), нож
    # movKnife/knifeRestaura (kn1..kn4), стирание брилло гемы (_gemtop); DEtoVRAM_NXNY ->
    # vec_blit_rect; комната setupRoom -> vec_nat_room. Через WRTVRM->vw_name остаются ТОЛЬКО
    # неигровые/загрузка (титул drawGameLogo/drawLogoRow, звёзды drawStars, пирамида-бонус,
    # InviertePatron-паттерн) + drawRoom (лишь скролл-переход ScrollPantalla, GS=9).
    # Сохраняет HL,DE,BC; A/флаги НЕ сохраняет — вызыватели их не переиспользуют после записи.
    "vec_text_blit:",               # HL=name addr, A=tile -> direct blit; preserves HL,DE,BC
    "\tpush\thl",
    "\tpush\tde",
    "\tpush\tbc",
    "\tdi",
    "\tld\t(vw_byte), a",           # blitter tile input (set under DI: no race with ISR blit)
    "\tld\ta, l", "\tand\t1Fh", "\tld\tc, a",           # C = col = L & 31
    "\tld\ta, l", "\tand\t0E0h", "\trlca", "\trlca", "\trlca", "\tld\te, a",  # E = L>>5
    "\tld\ta, h", "\tand\t3Fh", "\tsub\t38h",           # cellhi 0..2
    "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a",         # cellhi*8
    "\tadd\ta, e", "\tld\tb, a",                         # B = row = cellhi*8 + L>>5
    # (Фаза B: запись в name_shadow снята — тень удалена, 0 читателей.)
    "\tld\ta, (vec_isr_depth)", "\tpush\taf",           # save real ISR depth
    "\tld\ta, 1", "\tld\t(vec_isr_depth), a",           # force !=0: vbt_row keeps DI
    "\tcall\tvec_blit_tile",                             # B=row C=col vw_byte=tile -> p0/p1
    "\tpop\taf", "\tld\t(vec_isr_depth), a",            # restore real depth
    "\tor\ta", "\tjr\tnz, vtb_keepdi",                 # was in ISR -> keep DI (ISR will ei)
    "\tei",
    "vtb_keepdi:",
    "\tpop\tbc", "\tpop\tde", "\tpop\thl",
    "\tret",
    # NATIVE RECT BLIT: reemplaza DEtoVRAM_NXNY para los objetos dinamicos del
    # laberinto (puertas giratorias draw/erase, borrado del brillo de la gema).
    # DEtoVRAM_NXNY dibuja un rectangulo B(filas) x C(cols) de tile-IDs crudos
    # (tilesGiroDoor / eraseData) escribiendo por byte via out -> vec_vram_write ->
    # vw_name -> dirty. Aqui bliteamos cada tile DIRECTO al framebuffer via
    # vec_text_blit (que preserva HL,DE,BC y actualiza name_shadow), sin pasar por
    # soft-VDP. Contrato identico a DEtoVRAM_NXNY: HL=name addr (esq. sup-izq),
    # DE=puntero a tile-IDs (avanza continuo por todo el rect), B=filas, C=cols;
    # HL avanza +0x20 por fila. Camino FRIO (event-driven): blit directo cada vez.
    "vec_blit_rect:",              # HL=name addr, DE=tile data, B=rows, C=cols
    "\tld\ta, b", "\tor\ta", "\tret\tz",              # 0 filas -> nada
    "vbr_row:",
    "\tpush\tbc",                                     # save rows(B)/cols(C)
    "\tpush\thl",                                     # save row-start name addr
    "vbr_col:",
    "\tld\ta, (de)",                                  # source tile-ID
    "\tcall\tvec_text_blit",                          # HL=name A=tile -> blit; preserves HL,DE,BC
    "\tinc\thl", "\tinc\tde",
    "\tdec\tc", "\tjr\tnz, vbr_col",                  # C tiles per row
    "\tpop\thl",                                      # row-start name addr
    "\tpush\tde",                                     # keep advanced source ptr
    "\tld\tde, 20h", "\tadd\thl, de",                 # next row (HL += 0x20)
    "\tpop\tde",
    "\tpop\tbc",                                      # restore rows(B)/cols(C)
    "\tdjnz\tvbr_row",
    "\tret",
    # (Фаза B: DIRTY-TILE COMPOSITOR / vec_dirty_set / vec_masktab УДАЛЕНЫ — dirty-очередь
    #  снята: ~0 реальных писателей в геймплее, все динамич. пути блитят прямо в fb.)
    "\tALIGN\t256",
    "vec_revtab:",                   # bit-reverse LUT (invierteByte: ~45 instr -> 6)
    "\tdb\t000h,080h,040h,0C0h,020h,0A0h,060h,0E0h,010h,090h,050h,0D0h,030h,0B0h,070h,0F0h",
    "\tdb\t008h,088h,048h,0C8h,028h,0A8h,068h,0E8h,018h,098h,058h,0D8h,038h,0B8h,078h,0F8h",
    "\tdb\t004h,084h,044h,0C4h,024h,0A4h,064h,0E4h,014h,094h,054h,0D4h,034h,0B4h,074h,0F4h",
    "\tdb\t00Ch,08Ch,04Ch,0CCh,02Ch,0ACh,06Ch,0ECh,01Ch,09Ch,05Ch,0DCh,03Ch,0BCh,07Ch,0FCh",
    "\tdb\t002h,082h,042h,0C2h,022h,0A2h,062h,0E2h,012h,092h,052h,0D2h,032h,0B2h,072h,0F2h",
    "\tdb\t00Ah,08Ah,04Ah,0CAh,02Ah,0AAh,06Ah,0EAh,01Ah,09Ah,05Ah,0DAh,03Ah,0BAh,07Ah,0FAh",
    "\tdb\t006h,086h,046h,0C6h,026h,0A6h,066h,0E6h,016h,096h,056h,0D6h,036h,0B6h,076h,0F6h",
    "\tdb\t00Eh,08Eh,04Eh,0CEh,02Eh,0AEh,06Eh,0EEh,01Eh,09Eh,05Eh,0DEh,03Eh,0BEh,07Eh,0FEh",
    "\tdb\t001h,081h,041h,0C1h,021h,0A1h,061h,0E1h,011h,091h,051h,0D1h,031h,0B1h,071h,0F1h",
    "\tdb\t009h,089h,049h,0C9h,029h,0A9h,069h,0E9h,019h,099h,059h,0D9h,039h,0B9h,079h,0F9h",
    "\tdb\t005h,085h,045h,0C5h,025h,0A5h,065h,0E5h,015h,095h,055h,0D5h,035h,0B5h,075h,0F5h",
    "\tdb\t00Dh,08Dh,04Dh,0CDh,02Dh,0ADh,06Dh,0EDh,01Dh,09Dh,05Dh,0DDh,03Dh,0BDh,07Dh,0FDh",
    "\tdb\t003h,083h,043h,0C3h,023h,0A3h,063h,0E3h,013h,093h,053h,0D3h,033h,0B3h,073h,0F3h",
    "\tdb\t00Bh,08Bh,04Bh,0CBh,02Bh,0ABh,06Bh,0EBh,01Bh,09Bh,05Bh,0DBh,03Bh,0BBh,07Bh,0FBh",
    "\tdb\t007h,087h,047h,0C7h,027h,0A7h,067h,0E7h,017h,097h,057h,0D7h,037h,0B7h,077h,0F7h",
    "\tdb\t00Fh,08Fh,04Fh,0CFh,02Fh,0AFh,06Fh,0EFh,01Fh,09Fh,05Fh,0DFh,03Fh,0BFh,07Fh,0FFh",
    # ФАЗА 1 8-ЦВЕТ: vec_col8 LUT (256Б, page-aligned сразу за vec_revtab; ROM). Только KV_8COLOR.
    *((["vec_col8:"] + _gen_col8()) if _8COLOR else ()),
    # MSX colour -> plane mode: 0=white(p1) 1=red(both planes) 2=ochre(p0)
    "vec_cmap:", "\tdb\t0,0,0,0,0,0,1,0,1,1,2,2,0,1,0,0",
    # ЭВАКУАЦИЯ p2: tiledirty-БИТМАП удалён (был мёртв - его читал ТОЛЬКО vec_compose
    # Phase-1, а он = stub; см. STAGE-2.2 ниже). vec_td_range теперь инвалидирует
    # ТОЛЬКО render-mode кэш (vec_tilemode, ЖИВОЙ: читается vec_calc_mode) для тайлов,
    # чьи pattern/colour байты изменились bulk-путём (vec_de_slow0/vec_de_col). Набор
    # инвалидируемых mode-блоков i in [i1 .. i2-1] (при i1==i2 -> {i1}) БАЙТ-В-БАЙТ как
    # раньше. vec_td_flag (тоже мёртвый) убран. Освобождено 0xDF60-0xDFFF в плане 2.
    "vec_td_range:",                # HL=masked start (colour 0x0-0x17FF or pattern 0x2000+), BC=len
    "\tpush\thl", "\tpush\tde",   # invalidate mode over tile-block range [start>>6 .. end>>6]
    "\tld\ta, l", "\tadd\ta, c", "\tld\te, a",
    "\tld\ta, h", "\tadc\ta, b", "\tld\td, a",
    "\tdec\tde",                   # DE = end
    "\tld\ta, d", "\tcp\t20h", "\tjp\tc, vtr_1", "\tsub\t20h", "\tld\td, a",  # pattern base
    "vtr_1:",
    "\tld\ta, d", "\tand\t7", "\tld\td, a",       # fold bank: end hi 0x00-0x17 -> 0x00-0x07 (1x256)
    "\tld\ta, h", "\tcp\t20h", "\tjp\tc, vtr_2", "\tsub\t20h", "\tld\th, a",
    "vtr_2:",
    "\tld\ta, h", "\tand\t7", "\tld\th, a",       # fold bank: start hi -> single-bank (i in 0..31)
    "\tld\ta, l", "\trlca", "\trlca", "\tand\t3", "\tld\tl, a",
    "\tld\ta, h", "\tadd\ta, a", "\tadd\ta, a", "\tor\tl",         # i1 = start>>6
    "\tld\tl, a",                                                        # L = i1
    "\tld\ta, e", "\trlca", "\trlca", "\tand\t3", "\tld\te, a",
    "\tld\ta, d", "\tadd\ta, a", "\tadd\ta, a", "\tor\te",         # i2 = end>>6
    "\tld\te, a",                                                        # E = i2
    "\tld\ta, l",                                                        # A = i (from i1)
    "vtr_l:",
    # invalidate the 8 mode bytes of tile-block i (mode addr = vec_tilemode + i*8)
    "\tpush\tde",
    "\tld\te, a",
    "\tand\t1Fh", "\trlca", "\trlca", "\trlca", "\tld\tl, a",       # (i&31)*8
    "\tld\ta, e", "\trrca", "\trrca", "\trrca", "\trrca", "\trrca", "\tand\t7",
    "\tadd\ta, (vec_tilemode>>8)&255", "\tld\th, a",
    "\tld\ta, 0FFh",
    "\tld\t(hl), a", "\tinc\tl", "\tld\t(hl), a", "\tinc\tl",
    "\tld\t(hl), a", "\tinc\tl", "\tld\t(hl), a", "\tinc\tl",
    "\tld\t(hl), a", "\tinc\tl", "\tld\t(hl), a", "\tinc\tl",
    "\tld\t(hl), a", "\tinc\tl", "\tld\t(hl), a",
    "\tld\ta, e",                                                        # A = i
    "\tpop\tde",
    "\tinc\ta",
    "\tcp\te", "\tjp\tc, vtr_l",                                       # i+1 < i2 -> next block
    "\tpop\tde", "\tpop\thl",                                          # i+1 >= i2 -> done
    "\tret",
    # STAGE 2.2 (native fon): the treasure-flash re-blit-on-write machinery is REMOVED
    # (vtdm_skip/vtm_fall/vtm_ch + vec_compose Phase-1 vtd_scan/vtd_nb*/vtd_bit* - a
    # 256-cell-per-dirty-tile scan). It existed ONLY to re-blit cells ALREADY on screen
    # when their tile's pattern/colour bytes changed later (the treasure flash / stair
    # mirroring). The native room renderer (vec_nat_room below) draws the WHOLE maze
    # from MapaRAM + the CURRENT pattern/colour shadows exactly ONCE per room entry and
    # never re-blits in response to a VDP write, so this dynamic-update path is dead
    # weight here. KNOWN LOSS: treasure/gem colour flicker no longer animates (tiles
    # render with whatever colour was in the shadow at room-draw time) - accepted
    # to reclaim ~380B of code space (see КРИТ-НАХОДКА CODE-SPACE: only ~50B were free
    # between the end of code (0x6ACE) and GameStatus at 0x6B00). vec_td_mark is kept
    # as a stub so callers elsewhere (WRTVRM colour fast-path, vw_wcol/vw_colw via
    # vw_reblit, vec_fill_col) still assemble/link without touching every call site.
    # Phase 2 of vec_compose (vcp_cells below, unindented) is UNTOUCHED: it drains the
    # dirty-CELL queue that vw_name enqueues directly via vec_dirty_set - that is how
    # the HUD (row 0/23, drawn through the name table) still renders.
    "vec_td_mark:", "\tret",
    "vec_compose:", "\tret",
    # === Мерцание сокровищ через ПАЛИТРУ (размещено ПОСЛЕ ALIGN 256/revtab, чтобы не ===
    # === сдвигать pre-align код через границу страницы). ===============================
    # brillo-блёстка (0x51-0x53): паттерн -> план1, план0=0 => пиксели idx4 (p0=0,p1=1) —
    # комбинация НИГДЕ больше не используется (скан плоскостей title/menu/gameplay = 0).
    # Рисуется РАЗ в vec_nat_room и больше не трогается; мерцание = смена ЦВЕТА idx4/idx6
    # в палитре (vec_brillo_pal), не пикселей => 0 записей col_shadow, 0 перерисовки fb.
    # Вход: vw_byte=тайл, B=row(0-23), C=col(0-31).
    "vec_blit_brillo:",
    "\tld\ta, (vw_byte)", "\tld\tl, a", "\tld\th, 0",
    "\tadd\thl, hl", "\tadd\thl, hl", "\tadd\thl, hl",     # tile*8
    "\tcall\tpat_base", "\tadd\thl, de",                   # DE=база по диапазону tile (шаг3): гемы 0x51-0x53
                                                            # (>=0x40) -> maze_base work-RAM
    "\tld\ta, b", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl", "\tld\te, a",  # E = 255-row*8
    "\tld\ta, c", "\tadd\ta, 0A0h", "\tld\td, a",          # D = 0xA0+col (plane1 hi)
    "\tld\tb, 8",
    "vbb_l:",
    "\tld\ta, (hl)", "\tld\t(de), a",                      # p1 <- pattern (star pixels -> idx4)
    "\tld\ta, d", "\tsub\t20h", "\tpush\tde", "\tld\td, a", "\txor\ta", "\tld\t(de), a", "\tpop\tde",  # p0 <- 0
    "\tinc\thl", "\tdec\te", "\tdec\tb", "\tjp\tnz, vbb_l",
    "\tret",
    # Каждый кадр (ISR depth==1) крутим ЦВЕТ слота idx4 и p2-близнеца idx6 (p2=скрытая
    # тень => idx==idx^2) по последовательности оригинала coloresBrillo, фаза=(timer>>1)&3
    # (точь-в-точь drawBrilloGemas). Палитра защёлкивается по кадру: out 0x02=индекс,
    # out 0x0C=цвет %BBGGGRRR; бордюр возвращаем в idx0. Пиксели НЕ трогаем.
    # ГЕЙТ ПО GameStatus: idx4 (p0=0,p1=1) — это НЕ только блёстки гем. Часть пикселей
    # надписи «King's» на титуле (drawGameLogo) тоже попадает в idx4 (baseline: idx4=0=
    # чёрный => буквы неполные «Ki g's» — давний баг Vector-порта). Крутить idx4 покадрово
    # МОЖНО только в геймплее (GameStatus==5, где idx4 = ТОЛЬКО блёстки). Вне геймплея
    # (Konami GS=0, титул GS=1, финал/переходы) ставим СТАТИЧНЫЙ ДЕТЕРМИНИРОВАННЫЙ цвет
    # idx4=idx6 = синий 0xD2 (= idx8, тело букв King's) => надпись «King's Valley» ПОЛНАЯ,
    # одноцветная (синяя), одинаковая КАЖДЫЙ запуск (не остаточная фаза от прошлого
    # геймплея), НЕ мерцает. idx4==idx6 при ЛЮБОМ GS => p2-инвариант держится (тень
    # soft-VDP невидима нигде). Konami-лого idx4 не использует => цвет ему безразличен.
    # PALVBL: применить отложенную полную палитру В VBlank (вызывается из vec_isr ДО brillo).
    # vec_pal_pending: 0=нет, 1=A+ (vec_pal), 2=меню (vec_pal_menu). Латч Вектора требует
    # писать палитру в бордюр/бланк — setupStage/Pergamino теперь лишь взводят флаг.
    *((["vec_pal_apply:",
        "\tld\ta, (vec_pal_pending)", "\tor\ta", "\tret\tz",
        "\tcp\t2", "\tld\thl, vec_pal_menu+15", "\tjp\tz, vpa_load",
        "\tld\thl, vec_pal+15",
        "vpa_load:", "\tcall\tvsp_load",
        "\txor\ta", "\tld\t(vec_pal_pending), a", "\tret"]) if _PALVBL else ()),
    "vec_brillo_pal:",
    # _MAPPULSE: САМОМОДИФИКАЦИЯ. Первые 3 байта (`ld a,(GameStatus)` = 3A LL HH) на КАРТЕ патчатся
    # на `jp vbp_map` (C3 LL HH) glue-кодом в setupPergamino (вход в карту) и восстанавливаются в
    # setupStage (вход в этап). Геймплей/меню НИКОГДА не патчат -> исполняют ПРИСТИННЫЙ базовый код
    # -> ISR побайтно/потактово = база -> honest_diff=0. Пульс живёт только на карте (VBlank-safe,
    # т.к. карта под GS=5 тоже гонит vec_brillo_pal в VBlank). Карту honest_diff не рендерит.
    "\tld\ta, (GameStatus)", "\tcp\t5", "\tjp\tnz, vbp_static",       # (патч-сайт: 3 байта ld a,(GameStatus))
    "\tld\ta, (timer)", "\trra", "\tand\t3", "\tld\te, a", "\tld\td, 0",
    "\tld\thl, vec_brillo_cols", "\tadd\thl, de", "\tld\tc, (hl)",   # C = Vector-цвет фазы
    # 2b АУРА ГЕМ: idx14 (тело гема) мерцает зелён 038h <-> циан 0F8h по (timer&4), 8-кадр цикл.
    # Зеркалим idx14->idx15 (p3-схлопка). Только GS5-геймплей (карта уходит в vbp_map патчем).
    # Сохраняет C (цвет idx4). Клоб A,B.
    *((["\tld\ta, (timer)", "\tand\t4", "\tld\ta, 038h", "\tjp\tz, vbp_gemw",   # bit2=0 -> зелён
        "\tld\ta, 0F8h",                                                        # bit2=1 -> циан
        "vbp_gemw:",
        "\tld\tb, a",
        "\tld\ta, 14", "\tout\t(02h), a", "\tld\ta, b",
        "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
        "\tld\ta, 15", "\tout\t(02h), a", "\tld\ta, b",
        "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a"]) if _GEMAURA else ()),
    "\tjp\tvbp_out",
    "vbp_static:", "\tld\tc, 0D2h",                                   # вне игры: синий idx4
    "vbp_out:",
    "\tld\ta, 4", "\tout\t(02h), a", "\tld\ta, c",                    # слот idx4 <- цвет
    "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
    # 8-цв: p3-схлопка -> зеркалим idx4 в idx5 (иначе Palette[4]!=Palette[5] при мерцании гем).
    *((["\tld\ta, 5", "\tout\t(02h), a", "\tld\ta, c",
        "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a"]) if _8C_PALMIR else ()),   # зеркало idx4->5 (авто при кэшах в p3; было опт-ин KV_8C_BRMIRROR)
    # COLOR2: idx8 (стены/кирпичи) — золото если ВНУТРИ пирамиды (flagPiramideMap=1: геймплей, смерть,
    # скролл), синий на карте/меню/лого (=0). По flagPiramideMap, а НЕ GameStatus — иначе вспышка
    # синий→золото при отрисовке лабиринта (GS=4) и золото→синий при смерти (GS=6). idx8 стабилен весь
    # заход в пирамиду. (vec_setpal_a тоже ставит золото ДО отрисовки, чтоб лабиринт сразу золотой.)
    *((["\tld\ta, (flagPiramideMap)", "\tor\ta", "\tld\tb, 0D2h", "\tjp\tz, vbp_i8w"]
       + (
           # Часть 1: fpm==2 (карта) -> золото (оранж под _MAPCOLOR); fpm==1 (геймплей) -> цвет схемы.
           ["\tcp\t2", ("\tld\tb, 01Fh" if _MAPCOLOR else "\tld\tb, 077h"), "\tjp\tz, vbp_i8w",
            "\tld\ta, (piramideActual)", "\tdec\ta", "\trrca", "\trrca", "\tand\t3",
            "\tld\te, a", "\tld\td, 0", "\tld\thl, kv_stone_scheme", "\tadd\thl, de",
            "\tld\tb, (hl)"]
           if _LEVELCOLOR else
           # база COLOR2: fpm!=0 -> всегда золото.
           ["\tld\tb, 077h"]
         )
       + ["vbp_i8w:", "\tld\ta, 8", "\tout\t(02h), a", "\tld\ta, b",
          "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a"]
       # 8-цв: зеркалим idx8 в idx9 (p3-схлопка; иначе Palette[8]!=Palette[9] после idx8-override).
       + (["\tld\ta, 9", "\tout\t(02h), a", "\tld\ta, b",
           "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a"] if _8C_PALMIR else [])) if _COLOR2 else ()),
    # Фаза A+: idx6 БОЛЬШЕ НЕ крутим — p2 стала видимой, idx6 (p2=1,p1=1) = спрайт-цвет-2
    # (серый одежды), НЕ p2-близнец гема. Гем-блёстки = только idx4 (p2=0). idx6 статичен.
    # === ЗАДАЧА #2 (_NATLOGO): РАСКРАСКА ТИТУЛА KING'S VALLEY под COLORES_LOGO ===============
    # ЗАМЕР истинных idx логотипа (tools/verify/title_trueidx_probe.js, identity-палитра): тело
    # букв = idx8 (~1186px, было синее 0D2h — _COLOR2 ставит idx8 по flagPiramideMap), хайлайты
    # = idx12 (~1388px, статичный белый 0FFh из vec_pal), + акценты idx4 (~298px), контур idx1
    # (чёрн), пирамида idx14 (зелён). nearest-color probe путал idx4<->idx8 и idx6<->idx12
    # (одинак. цвет) => премиса «idx4/idx6» была ложной. КРАСКА (тёпл. красн+золото под ориг.):
    # idx4/8 -> красн 05Fh (тело+акценты), idx12 -> золото 0BFh (хайлайты). idx14 зелён и idx1
    # чёрн НЕ трогаем. ТОЛЬКО GS=1 (титул): idx8=blue/gold геймплея/карты не тронут (GS!=1),
    # idx12=бел. восстанавливается per-screen. Идёт ПОСЛЕ _COLOR2 -> перекрывает его idx8.
    # Зеркалим чёт->нечёт (p3-схлопка: единичные odd-стрэглеры idx5/9/13). A=клоб (перезагружаем
    # GameStatus). Прочие GS -> jp мимо. Стоимость ~только на титуле (не критично по тактам).
    *((["\tld\ta, (GameStatus)", "\tcp\t1", "\tjp\tnz, vbp_titdone",  # solo titulo (GS=1)
        "\tld\ta, 4", "\tout\t(02h), a", "\tld\ta, 05Fh",            # idx4 acentos -> rojo
        "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
        "\tld\ta, 5", "\tout\t(02h), a", "\tld\ta, 05Fh",            # mirror idx5
        "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
        "\tld\ta, 8", "\tout\t(02h), a", "\tld\ta, 05Fh",            # idx8 cuerpo letras -> rojo
        "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
        "\tld\ta, 9", "\tout\t(02h), a", "\tld\ta, 05Fh",            # mirror idx9
        "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
        "\tld\ta, 12", "\tout\t(02h), a", "\tld\ta, 0BFh",           # idx12 highlights -> oro
        "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
        "\tld\ta, 13", "\tout\t(02h), a", "\tld\ta, 0BFh",           # mirror idx13
        "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
        "vbp_titdone:"]) if _NATLOGO else ()),
    "\txor\ta", "\tout\t(02h), a",                                    # бордюр обратно в idx0 (БЕЗ записи цвета!)
    "\tret",
    *((["vbp_map:",
        # ФИКС ЖЁЛТОЙ КОЖИ: пульс крутит спрайт-индексы кожи(1/5/9/13)+одежды(2/6/10/14). При выходе
        # с карты (flagPiramideMap!=2) vec_setpal_a (mid-frame) НЕнадёжно восстанавливает их (латч
        # палитры вне VBlank) -> кожа/одежда застревают в цвете пульса. Здесь (в VBlank, надёжно)
        # САМИ восстанавливаем спрайт-палитру в игровые значения (кожа 0x5F / одежда 0xF6) + снимаем
        # патч диспетчера -> самолечение, не зависит от mid-frame. На карте (fpm==2) -> пульс.
        "\tld\ta, (flagPiramideMap)", "\tcp\t2", "\tjp\tz, vbp_dopulse",
        "\tld\thl, vbp_pidx", "\tld\tde, vbp_pval", "\tld\tb, 8",
        "vbp_rl:",
        "\tld\ta, (hl)", "\tout\t(02h), a", "\tld\ta, (de)",
        "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
        "\tinc\thl", "\tinc\tde", "\tdec\tb", "\tjp\tnz, vbp_rl",
        "\txor\ta", "\tout\t(02h), a",
        "\tld\ta, 03Ah", "\tld\t(vec_brillo_pal), a",
        "\tld\thl, GameStatus", "\tld\t(vec_brillo_pal+1), hl",
        "\tret",
        "vbp_dopulse:"]
       # idx8 на карте: золото 077h, ИЛИ оранж 01Fh под _MAPCOLOR (пирамиды карты = оранж).
       + (["\tld\ta, 8", "\tout\t(02h), a", ("\tld\ta, 01Fh" if _MAPCOLOR else "\tld\ta, 077h"),
           "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a"] if _COLOR2 else [])
       + ["\tld\ta, (colorPiramidMap)",
          "\tcp\t1", "\tjp\tnz, vbp_p6", "\tld\tc, 000h", "\tjp\tvbp_pw",
          "vbp_p6:", "\tcp\t6", "\tjp\tnz, vbp_p10", "\tld\tc, 056h", "\tjp\tvbp_pw",
          "vbp_p10:", "\tld\tc, 076h",
          "vbp_pw:",
          "\tld\thl, vbp_pidx", "\tld\tb, 8",
          "vbp_pl:",
          "\tld\ta, (hl)", "\tout\t(02h), a",
          "\tld\ta, c",
          "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a", "\tout\t(0Ch), a",
          "\tinc\thl", "\tdec\tb", "\tjp\tnz, vbp_pl",
          "\txor\ta", "\tout\t(02h), a",
          "\tret"]) if _MAPPULSE else ()),
    # Vector-цвета блёсток (=MSX coloresBrillo 10h/F0h/A0h/A0h): чёрн=00, бел=FF, жёлт=3F (R+G).
    # 8-цв: idx4 = КОЖА героя (p1) + МУМИИ + гемы. Держим idx4 СТАТИЧНЫМ белым (все фазы 0FFh) =>
    # кожа/мумии/гемы = стабильный белый (НЕ мерцают как гем-искра idx4). ДАННЫЕ-only (тот же
    # размер таблицы/такты) => attract не реседится. Герой = одежда idx2 красн + кожа idx4 белый = 2цв.
    # 8-цв: idx4 = КОЖА героя (p1) + гем-глинт. COLOR_MAP §3.1 кожа=т.красн(6)=05Fh. Держим idx4
    # красным во все фазы -> кожа героя стабильно красная (гем-глинт тоже красн; сокровищ-искра
    # бел/жёлт принесена в жертву ради корректного 2-цв героя, см. §4.4 бюджет). ДАННЫЕ-only.
    # _8C_AURA: idx4 освобождён от кожи героя -> ОРИГИНАЛЬНОЕ мигание лучей coloresBrillo
    # (чёрн/бел/жёлт/жёлт, фаза (timer>>1)&3, точь-в-точь drawBrilloGemas).
    *(["vec_brillo_cols:", "\tdb\t000h, 0FFh, 03Fh, 03Fh"] if (_8C_AURA or not _8COLOR) else
      ["vec_brillo_cols:", "\tdb\t05Fh, 05Fh, 05Fh, 05Fh"]),
    # Часть 1: цвет idx8 (кирпичи/стены) по scheme=((piramideActual-1)>>2)&3. MSX ColoresPiedra
    # -> ближайший Вектор %BBGGGRRR: scheme0 тёмн.жёлтый=077h (R+G), scheme1 тёмн.синий=0D2h (B),
    # scheme2 тёмн.красный=056h (R средн), scheme3 тёмн.зелёный=01Ch (G высокий, R/B низкие).
    # 8-цв раскладка: кирпичи ЗОЛОТО (slot1 0BFh) на всех уровнях (2-тон жёлт/красн по строкам =
    # нужен код vbt_brick, под _8COLOR не эмитится -> speed-этап). Вне 8-цв: базовые схемы (OFF байт-в-байт).
    *((["kv_stone_scheme:",
        ("\tdb\t0BFh, 0BFh, 0BFh, 0BFh" if _8COLOR else "\tdb\t077h, 0D2h, 056h, 01Ch")]) if _LEVELCOLOR else ()),
    # Часть 2 (_MAPCOLOR): взвести white-бит в vec_tilemode для тайлов-ЛИНИЙ карты (0xC0-0xE7,
    # mode2=inverted). Вызывается ОДИН РАЗ из setupPergamino ПОСЛЕ загрузки colorTableMap (tilemode
    # заполнен). Штатный блит потом делает p1=копия p0 -> фон линии idx12 БЕЛЫЙ, линия idx0 ЧЁРН.
    # Геймплей НИКОГДА не зовёт setupPergamino -> геймплейные tilemode/блит байт-идентичны.
    *((["vec_map_whiteforce:",
        "\tld\thl, vec_tilemode+0C0h", "\tld\tb, 28h",           # тайлы 0xC0..0xE7 (40 шт)
        "vmwf_l:",
        "\tld\ta, (hl)", "\tand\t7", "\tcp\t2", "\tjp\tnz, vmwf_n",   # mode2 (линия)?
        "\tld\ta, (hl)", "\tor\t80h", "\tld\t(hl), a",            # -> взвести white
        "vmwf_n:",
        "\tinc\thl", "\tdec\tb", "\tjp\tnz, vmwf_l",
        "\tret"]) if _MAPCOLOR else ()),
    # _MAPPULSE: 8 палитр-индексов силуэта(p2)+стрелки(p3) карты, крутятся colorPiramidMap.
    *((["vbp_pidx:", "\tdb\t1, 5, 9, 13, 2, 6, 10, 14",
        "vbp_pval:", "\tdb\t05Fh,05Fh,05Fh,05Fh, 0F6h,0F6h,0F6h,0F6h"]) if _MAPPULSE else ()),  # игровые: кожа/одежда
    # --- Эвакуация p2, шаг 1: фильтр гем-ЦВЕТА (мерцание сокровищ) ---------------------
    # drawBrilloGemas (msx src) каждый игровой тик перезаписывает ЦВЕТ destellos гем
    # (colour-table тайлы 0x51,0x52,0x53 @VDP 0x288) и паланки двери (0x5c @VDP 0x2E5)
    # через fillVRAM3Bank->setFillVRAM->vec_fill_col. Рендер это ИГНОРИРУЕТ (re-blit
    # снят, vec_nat_room рисует комнату раз при входе; KNOWN LOSS: мерцание не видно).
    # => col_shadow для этих тайлов НЕ НУЖНА резидентно после входа в комнату: базовый
    # цвет грузится РАЗ через bulk (UnpackPatterns/COLOR_GEMAS -> vec_de_col), а flash
    # можно отбрасывать. ВНИМАНИЕ: фильтр ТОЛЬКО в ЦВЕТ-путях. В ПАТТЕРН-таблице тайлы
    # 0x51-0x53 = НЕ гемы (паттерны гем = 0x86-0x8b, лестницы = 0x77-0x85) -> паттерн
    # НЕ трогаем, иначе рушим фон. Bulk-пути (vec_de_col) НЕ трогаем -> базовый цвет цел.
    "vec_is_gem_col:",              # in: A = colour-table tile#; out: Z set если гем (0x51-53/0x5c)
    "\tcp\t5Ch", "\tjp\tz, vigc_yes",       # паланка двери
    "\tcp\t51h", "\tjp\tc, vigc_no",        # tile<0x51
    "\tcp\t54h", "\tjp\tc, vigc_yes",       # 0x51..0x53 destellos
    "vigc_no:", "\tor\t1", "\tret",         # NZ = не гем
    "vigc_yes:", "\txor\ta", "\tret",       # Z = гем
    # --- Задача 2.2: нативный фон комнаты из MapaRAM (заменяет softVDP drawRoom path). ---
    # Рисует комнату ProtaRoom целиком (22 ряда x 32 стб, экран-ряды 1..22) в план0,
    # переиспользуя vec_blit_tile НЕИЗМЕННЫМ (читает vec_pat_shadow/vec_col_shadow
    # bank0, как и раньше). Тайл-код -> тайл# идёт через ROM'ную getTileFromID (msx
    # source), byte-identical алгоритму drawRoom/drawRoom3. Вызывается РАЗ на комнату
    # (glue: setupRoom вызывает vec_nat_room вместо drawRoom).
    # КРИТ: vec_blit_tile - POP-блиттер (SP-хайджек, vbt_row): безопасен ТОЛЬКО под DI
    # и когда vec_isr_depth!=0 (иначе blit сам делает `ei`, что рвёт хайджек при
    # вложенном прерывании). setupRoom работает в главном потоке (interrupts ON) ->
    # весь проход оборачиваем di/force-depth/ei, как остальные ISR-only блиттеры.
    "vec_nat_room:",
    "\tdi",
    "\tld\ta, (vec_isr_depth)", "\tpush\taf",       # save real depth (DI: push/pop is safe)
    "\tld\ta, 1", "\tld\t(vec_isr_depth), a",         # force !=0: vbt_row keeps DI throughout
    "\tld\ta, (ProtaRoom)",
    "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a",  # x32
    "\tld\thl, MapaRAM",
    "\tcall\tADD_A_HL",                               # HL = window row-0 base (ProtaRoom*32)
    "\tld\t(vec_nr_ptr), hl",
    "\tld\ta, 1", "\tld\t(vec_nr_srow), a",           # screen row 1..22 (row0 = HUD, untouched)
    # POP-кэш: пометить «нет закэшированного тайла» (0xFF никогда не тайл комнаты 0x00-0x8b)
    # -> первая клетка каждой комнаты гарантированно идёт полным блитом+readback.
    *((["\tld\ta, 0FFh", "\tld\t(pop_bg_tile), a"]) if _POPBG else ()),
    "vec_nr_row:",
    # _COOPSND: кооп-тик звука на КАЖДУЮ строку (под DI, БЕЗ ei — как vec_isr_nested).
    # На метке vec_nr_row живых регистров нет: вся состояние цикла в RAM (vec_nr_ptr/
    # vec_nr_srow/vec_nr_col), cloop перезагружает HL из vec_nr_ptr. updateSound/vec_flushvi
    # клоббят A/BC/DE/HL — все мертвы здесь (A ниже перезаписывается xor a). vec_sndb НЕ в
    # SCRATCH -> сохраняем его сами (иначе штатный ISR-звук прочтёт битый счётчик каналов).
    *((["\tld\ta, (vec_sndb)", "\tpush\taf",
       "\tcall\tupdateSound", "\tcall\tvec_flushvi",
       "\tpop\taf", "\tld\t(vec_sndb), a"]) if _COOPSND else ()),
    "\txor\ta", "\tld\t(vec_nr_col), a",
    "vec_nr_cloop:",
    "\tld\thl, (vec_nr_ptr)",
    "\tld\ta, (vec_nr_col)", "\tcall\tADD_A_HL",     # HL = &MapaRAM[row-base + col]
    "\tld\ta, (hl)",                                   # A = map cell ID
    "\tcall\tgetTileFromID",                          # A = tile# (preserves HL, clobbers C)
    "\tld\t(vw_byte), a",
    "\tld\ta, (vec_nr_srow)", "\tld\tb, a",
    "\tld\ta, (vec_nr_col)", "\tld\tc, a",
    # Фаза B: name_shadow-когерентность снята — vw_name больше не дедупит (всегда блитит
    # прямо в fb), поэтому «пусто» в маз-клетки (очистка/гем/предмет) не ложно-дедупится.
    # POP-кэш фона (Фаза 1): тайл == предыдущий -> быстрый POP-блит interleaved [p0|p1]
    # (снятых readback'ом при первом блите этого тайла); иначе полный vec_blit_tile + снять
    # 16Б вывода из fb в кэш. Вывод тайла позиционно-независим => POP пишет байт-в-байт.
    *((["\tld\ta, (vw_byte)", "\tld\thl, pop_bg_tile", "\tcp\t(hl)", "\tjp\tz, vnr_pop",
        "\tcall\tvec_blit_tile", "\tcall\tvec_popbg_cap", "\tjp\tvnr_blitted",
        "vnr_pop:", "\tcall\tvec_popbg",
        "vnr_blitted:"]) if _POPBG else
      (["\tcall\tvec_blit_tile"])),                   # B=row C=col vw_byte=tile -> plane0
    "\tld\ta, (vec_nr_col)", "\tinc\ta", "\tld\t(vec_nr_col), a",
    "\tcp\t32", "\tjp\tc, vec_nr_cloop",
    "\tld\thl, (vec_nr_ptr)", "\tld\ta, 96", "\tcall\tADD_A_HL",  # next row: +96 (3 rooms x 32)
    "\tld\t(vec_nr_ptr), hl",
    "\tld\ta, (vec_nr_srow)", "\tinc\ta", "\tld\t(vec_nr_srow), a",
    "\tcp\t23", "\tjp\tc, vec_nr_row",                # rows 1..22 inclusive
    "\tpop\taf", "\tld\t(vec_isr_depth), a",          # restore real depth
    "\tei",
    "\tret",
    # --- Фаза 1 POP-блит фона: vec_popbg / vec_popbg_cap / pbg_cap8 (только под _POPBG) ---
    # vec_popbg: POP-блит закэшированного тайла в текущую клетку (row=vec_nr_srow, col=
    # vec_nr_col). SP хайджекнут на pop_bg_il (16Б: [p0 row0..7][p1 row0..7]); pop de = 2
    # строки/pop (OldTower-трюк, как vbt_row). Вызывается ТОЛЬКО из vec_nat_room (под DI,
    # vec_isr_depth форсирован !=0) -> без ei в конце (финальный ei делает vec_nat_room).
    *((["vec_popbg:",
        "\tdi",
        "\tld\thl, 0", "\tadd\thl, sp", "\tld\t(pbg_save), hl",   # сохранить SP вызывателя
        "\tld\ta, (vec_nr_srow)", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl", "\tld\tl, a",  # L=E=255-row*8
        "\tld\ta, (vec_nr_col)", "\tadd\ta, 80h", "\tld\th, a",   # HL = p0 top (0x80+col : E)
        "\tld\tsp, pop_bg_il",                                    # SP -> interleaved данные
        "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d", "\tdec\tl",   # p0 rows 0,1
        "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d", "\tdec\tl",   # p0 rows 2,3
        "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d", "\tdec\tl",   # p0 rows 4,5
        "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d",               # p0 rows 6,7
        "\tld\ta, (vec_nr_srow)", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl", "\tld\tl, a",  # L=E снова
        "\tld\ta, (vec_nr_col)", "\tadd\ta, 0A0h", "\tld\th, a",  # HL = p1 top (0xA0+col : E)
        "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d", "\tdec\tl",   # p1 rows 0,1
        "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d", "\tdec\tl",   # p1 rows 2,3
        "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d", "\tdec\tl",   # p1 rows 4,5
        "\tpop\tde", "\tld\t(hl), e", "\tdec\tl", "\tld\t(hl), d",               # p1 rows 6,7
        "\tld\thl, (pbg_save)", "\tld\tsp, hl",                   # восстановить SP
        "\tret",
        # vec_popbg_cap: снять 16Б вывода тайла из fb в pop_bg_il + запомнить тайл. Обычный
        # стек (без хайджека) -> push/pop безопасны. p0-строки из (0x80+col:E..E-7),
        # p1-строки из (0xA0+col:E..E-7) — ровно туда пишет vec_blit_tile/brillo.
        "vec_popbg_cap:",
        "\tld\ta, (vec_nr_srow)", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl", "\tld\tl, a",  # L=E
        "\tld\ta, (vec_nr_col)", "\tadd\ta, 80h", "\tld\th, a",   # HL = p0 src top
        "\tld\tde, pop_bg_il", "\tcall\tpbg_cap8",
        "\tld\ta, (vec_nr_srow)", "\tadd\ta, a", "\tadd\ta, a", "\tadd\ta, a", "\tcpl", "\tld\tl, a",
        "\tld\ta, (vec_nr_col)", "\tadd\ta, 0A0h", "\tld\th, a",  # HL = p1 src top
        "\tld\tde, pop_bg_il+8", "\tcall\tpbg_cap8",
        "\tld\ta, (vw_byte)", "\tld\t(pop_bg_tile), a",           # запомнить закэшированный тайл
        "\tret",
        "pbg_cap8:",                                             # HL=src fb (dec l), DE=dst (inc), 8Б
        "\tld\tb, 8",
        "pbg_c8l:",
        "\tld\ta, (hl)", "\tld\t(de), a", "\tdec\tl", "\tinc\tde", "\tdec\tb", "\tjp\tnz, pbg_c8l",
        "\tret"]) if _POPBG else ()),
    # --- Задача 2.4: нативные МОНО-спрайты в plane 3, flicker-free (XOR self-erase). ---
    # Reads sprAttrib(6 entries)+enemyAttrib(8 entries) DIRECTLY from game RAM (same
    # contiguous 4B-stride table, sprAttrib..sprAttrib+0x37) - the validated JS
    # prototype (tools/verify/native_spr_proto.js) reads the identical 14 entries.
    # Erase-then-draw each frame via a PRIVATE prev-frame snapshot (vec_nsp_prev,
    # 14 x [Y,X,pat]): XOR is its own inverse, so re-XORing the OLD sprite first
    # removes it with zero residue, then XORing the NEW sprite draws it - a sprite
    # that hasn't moved cancels out exactly (XOR twice = no-op). Sprites live ONLY
    # in plane 3 (0xE000-0xFFFF, freed by the shadow relocation) - they never touch
    # the background planes 0/1, so there is nothing to cut/restore -> no flicker.
    # Runs from the game tick (H_TIMI, vec_isr_depth==1, interrupts already off per
    # vec_isr's own DI-until-`ei` structure) - no extra di/ei guard needed here (no
    # SP-hijack is used, so the routine is safely re-entrant-interruptible; nested
    # vblanks (depth>=2) only run the sound driver, never the tick, so it can never
    # be called concurrently with itself).
    "vec_nat_sprites:",
    # ОПТ обхода (2026-07-12): в ОБЩЕМ (частом) пути — детекция стоящих спрайтов и
    # advance — указатели cur (HL, шаг 4) и prev (DE, шаг 3) держим в РЕГИСТРАХ, без
    # per-iter LHLD/SHLD (было ~150т/спрайт только на перезагрузку/advance). Счётчик в
    # ПАМЯТИ (vec_nsp_idx): caller рассчитывает на сохранность BC (оригинал BC не трогал).
    # + ранний skip невидимых: cur Y>=0xD0 и prev Y>=0xD0 -> спрайт мимо (erase+draw были
    # бы no-op'ами vec_nsx; prev нужен лишь для erase, скрытый prev => erase no-op, значит
    # устаревание prev при обоюдном скрытии визуально безопасно).
    # ВАЖНО про СТЕК: в РЕДКОМ draw-пути НЕ спиллим регистры в стек (это углубляло бы стек
    # на 4 байта и оставляло иной "мусор" под SP, который читается => дрейф игры). Вместо
    # этого спиллим cur/prev в память vec_nsp_ptr/pptr (SHLD, без push) и рисуем/копируем/
    # advance ровно как оригинал — стек-футпринт draw идентичен оригиналу. change-detection
    # (стоящий => erase+draw XOR'ом сокращаются) СОХРАНЕНА в точности.
    # _8C_RLG: Фаза F (флаги = гейт cur/prev) -> Фаза P (распространение по пересечениям
    # bbox 16x16, cur И prev флагового, до 2 проходов c early-exit) -> Pass-R restore ПО
    # ФЛАГАМ 20->0. Все сейвы группы дальше снимают ЧИСТЫЙ фон => в слотах не бывает чужих
    # спрайт-пикселей (см. коммент у _8C_RLG).
    *((["\tld\ta, (GameStatus)", "\tld\thl, vfl_lastgs",      # смена фазы -> форс всех
        "\tcp\t(hl)", "\tjp\tz, vflf_nofc",
        "\tld\t(hl), a",
        "\tld\thl, vfl_dirty", "\tld\tb, 21",
        "vflf_fc:",
        "\tld\t(hl), 1", "\tinc\tl", "\tdec\tb", "\tjp\tnz, vflf_fc",
        "vflf_nofc:",
        "\tld\thl, sprAttrib", "\tld\tde, vec_nsp_prev",       # === Фаза F ===
        "\tld\tbc, vfl_flags",
        "vflf_loop:",
        "\tld\ta, (hl)", "\tcp\t0D0h", "\tjp\tc, vflf_vis",
        "\tld\ta, (de)", "\tcp\t0D0h", "\tjp\tnc, vflf_f0",     # оба скрыты
        "\tjp\tvflf_f1",                                         # cur скрыт, prev видим
        "vflf_vis:",
        "\tld\ta, (de)", "\tcp\t(hl)", "\tjp\tnz, vflf_f1",
        "\tinc\thl", "\tinc\tde",
        "\tld\ta, (de)", "\tcp\t(hl)", "\tjp\tnz, vflf_f1r1",
        "\tinc\thl", "\tinc\tde",
        "\tld\ta, (de)", "\tcp\t(hl)", "\tjp\tnz, vflf_f1r2",
        "\tdec\thl", "\tdec\tde", "\tdec\thl", "\tdec\tde",
        "vflf_f0:",
        "\txor\ta", "\tjp\tvflf_wr",
        "vflf_f1r2:", "\tdec\thl", "\tdec\tde",
        "vflf_f1r1:", "\tdec\thl", "\tdec\tde",
        "vflf_f1:",
        "\tld\ta, 1",
        "vflf_wr:",
        "\tld\t(bc), a", "\tinc\tc",                             # флаги в одной странице
        "\tinc\thl", "\tinc\thl", "\tinc\thl", "\tinc\thl",
        "\tinc\tde", "\tinc\tde", "\tinc\tde",
        "\tld\ta, c", "\tcp\t(vfl_flags+21)&255", "\tjp\tnz, vflf_loop",
        # Слияние sticky-dirty (фон переписан под спрайтом) в флаги + сброс sticky.
        "\tld\thl, vfl_dirty", "\tld\tbc, vfl_flags", "\tld\td, 21",
        "vflm_loop:",
        "\tld\ta, (hl)", "\tor\ta", "\tjp\tz, vflm_next",
        "\tld\t(hl), 0", "\tld\ta, 1", "\tld\t(bc), a",
        "vflm_next:",
        "\tinc\tl", "\tinc\tc", "\tdec\td", "\tjp\tnz, vflm_loop",
        # === Фаза P: распространение ===
        "\tld\ta, 2", "\tld\t(vfl_pass), a",
        "vflp_pass:",
        "\txor\ta", "\tld\t(vfl_chg), a", "\tld\t(vfl_ai), a",
        "vflp_aloop:",
        "\tld\ta, (vfl_ai)", "\tadd\ta, vfl_flags&255", "\tld\tc, a",
        "\tld\tb, (vfl_flags>>8)&255",
        "\tld\ta, (bc)", "\tor\ta", "\tjp\tz, vflp_anext",       # не флагован -> дальше
        "\tld\ta, (vfl_ai)", "\tld\tl, a", "\tld\th, 0",         # координаты флагового a
        "\tadd\thl, hl", "\tadd\thl, hl", "\tld\tde, sprAttrib", "\tadd\thl, de",
        "\tld\ta, (hl)", "\tld\t(vfa_yc), a", "\tinc\thl", "\tld\ta, (hl)", "\tld\t(vfa_xc), a",
        "\tld\ta, (vfl_ai)", "\tld\tl, a", "\tld\th, 0", "\tld\td, h", "\tld\te, a",
        "\tadd\thl, hl", "\tadd\thl, de", "\tld\tde, vec_nsp_prev", "\tadd\thl, de",
        "\tld\ta, (hl)", "\tld\t(vfa_yp), a", "\tinc\thl", "\tld\ta, (hl)", "\tld\t(vfa_xp), a",
        "\tld\thl, sprAttrib",                                   # внутренний цикл по b
        "\tld\tc, vfl_flags&255",
        "vflp_bloop:",
        "\tld\ta, (bc)", "\tor\ta", "\tjp\tnz, vflp_bnext",      # уже флагован
        "\tld\ta, (hl)", "\tcp\t0D0h", "\tjp\tnc, vflp_bnext",   # скрыт
        "\tld\te, a",                                            # E = Yb
        # Y: спрайт ровно 16 строк -> |dY|<16. X: футпринт до 3 СТОЛБЦОВ (суб-пиксельный
        # сдвиг) -> соседство по столбцам достигает 23px -> |dX|<24 (16px пропускал
        # «соседей по столбцу» — 608 пар/20К кадров, источник следов мумий).
        "\tld\ta, (vfa_yc)", "\tsub\te", "\tadd\ta, 15", "\tcp\t31", "\tjp\tnc, vflp_tryp",
        "\tinc\thl", "\tld\ta, (hl)", "\tdec\thl", "\tld\te, a", # E = Xb
        "\tld\ta, (vfa_xc)", "\tsub\te", "\tadd\ta, 23", "\tcp\t47", "\tjp\tc, vflp_hit",
        "\tld\ta, (hl)", "\tld\te, a",                           # E = Yb (восстановить)
        "vflp_tryp:",
        "\tld\ta, (vfa_yp)", "\tsub\te", "\tadd\ta, 15", "\tcp\t31", "\tjp\tnc, vflp_bnext",
        "\tinc\thl", "\tld\ta, (hl)", "\tdec\thl", "\tld\te, a",
        "\tld\ta, (vfa_xp)", "\tsub\te", "\tadd\ta, 23", "\tcp\t47", "\tjp\tnc, vflp_bnext",
        "vflp_hit:",
        "\tld\ta, 1", "\tld\t(bc), a", "\tld\t(vfl_chg), a",
        "vflp_bnext:",
        "\tinc\tc",
        "\tinc\thl", "\tinc\thl", "\tinc\thl", "\tinc\thl",
        "\tld\ta, c", "\tcp\t(vfl_flags+21)&255", "\tjp\tnz, vflp_bloop",
        "vflp_anext:",
        "\tld\ta, (vfl_ai)", "\tinc\ta", "\tld\t(vfl_ai), a", "\tcp\t21", "\tjp\tnz, vflp_aloop",
        "\tld\ta, (vfl_chg)", "\tor\ta", "\tjp\tz, vflp_done",   # ничего нового -> хватит
        "\tld\ta, (vfl_pass)", "\tdec\ta", "\tld\t(vfl_pass), a", "\tjp\tnz, vflp_pass",
        "vflp_done:",
        # === Pass-R по флагам, 20->0 ===
        "\tld\ta, 20", "\tld\t(vec_nsp_idx), a",
        "vnsr_loop:",
        "\tld\ta, (vec_nsp_idx)", "\tadd\ta, vfl_flags&255", "\tld\tc, a",
        "\tld\tb, (vfl_flags>>8)&255",
        "\tld\ta, (bc)", "\tor\ta", "\tjp\tz, vnsr_next",
        "\tcall\tvec_su_restore",
        "vnsr_next:",
        "\tld\ta, (vec_nsp_idx)", "\tdec\ta", "\tld\t(vec_nsp_idx), a",
        "\tjp\tp, vnsr_loop"]) if _8C_RLG else
    # _8C_RL2 (без RLG): прежний Pass-R с пере-сравнением (без группировки).
      (["\tld\ta, 20", "\tld\t(vec_nsp_idx), a",
        "\tld\thl, sprAttrib+80", "\tld\tde, vec_nsp_prev+60",
        "vnsr_loop:",
        "\tld\ta, (hl)", "\tcp\t0D0h", "\tjp\tc, vnsr_vis",
        "\tld\ta, (de)", "\tcp\t0D0h", "\tjp\tnc, vnsr_next",
        "\tjp\tvnsr_rest",
        "vnsr_vis:",
        "\tld\ta, (de)", "\tcp\t(hl)", "\tjp\tnz, vnsr_rest",
        "\tinc\thl", "\tinc\tde",
        "\tld\ta, (de)", "\tcp\t(hl)", "\tjp\tnz, vnsr_r1",
        "\tinc\thl", "\tinc\tde",
        "\tld\ta, (de)", "\tcp\t(hl)", "\tjp\tnz, vnsr_r2",
        "\tdec\thl", "\tdec\tde", "\tdec\thl", "\tdec\tde",
        "\tjp\tvnsr_next",
        "vnsr_r2:", "\tdec\thl", "\tdec\tde",
        "vnsr_r1:", "\tdec\thl", "\tdec\tde",
        "vnsr_rest:",
        "\tpush\thl", "\tpush\tde", "\tcall\tvec_su_restore", "\tpop\tde", "\tpop\thl",
        "vnsr_next:",
        "\tld\ta, l", "\tsub\t4", "\tld\tl, a", "\tld\ta, h", "\tsbc\ta, 0", "\tld\th, a",
        "\tld\ta, e", "\tsub\t3", "\tld\te, a", "\tld\ta, d", "\tsbc\ta, 0", "\tld\td, a",
        "\tld\ta, (vec_nsp_idx)", "\tdec\ta", "\tld\t(vec_nsp_idx), a",
        "\tjp\tp, vnsr_loop"]) if _8C_RL2 else ()),
    "\txor\ta", "\tld\t(vec_nsp_idx), a",
    "\tld\thl, sprAttrib", "\tld\tde, vec_nsp_prev",
    "vns_loop:",   # HL=cur база, DE=prev база
    # _8C_RLG: гейт = флаг из Фазы F/P (группа пересечений). Компары не нужны.
    *((["\tld\ta, (vec_nsp_idx)", "\tadd\ta, vfl_flags&255", "\tld\tc, a",
        "\tld\tb, (vfl_flags>>8)&255",
        "\tld\ta, (bc)", "\tor\ta", "\tjp\tz, vns_next",
        "\tjp\tvns_draw"]) if _8C_RLG else
      (["\tld\ta, (hl)", "\tcp\t0D0h", "\tjp\tc, vns_vis",     # cur видим -> обычная детекция
        # cur скрыт: если prev тоже скрыт -> пропуск целиком; иначе надо стереть prev
        "\tld\ta, (de)", "\tcp\t0D0h", "\tjp\tnc, vns_next",
        "\tjp\tvns_draw",
        "vns_vis:",
        # change-detection. HL=cur, DE=prev; инкрементим оба синхронно, при diff откат к базе.
        "\tld\ta, (de)", "\tcp\t(hl)", "\tjp\tnz, vns_draw",   # Y изменился (база)
        "\tinc\thl", "\tinc\tde",
        "\tld\ta, (de)", "\tcp\t(hl)", "\tjp\tnz, vns_draw1",  # X изменился (+1)
        "\tinc\thl", "\tinc\tde",
        "\tld\ta, (de)", "\tcp\t(hl)", "\tjp\tz, vns_stat",    # pat совпал -> статичен (+2)
        "\tdec\thl", "\tdec\tde",                                # pat отличается: +2 -> +1
        "vns_draw1:",
        "\tdec\thl", "\tdec\tde"])),                             # +1 -> база
    "vns_draw:",   # HL=cur база, DE=prev база; спилл в память (SHLD, без стека)
    "\tld\t(vec_nsp_ptr), hl",                               # cur -> mem
    "\tld\th, d", "\tld\tl, e", "\tld\t(vec_nsp_pptr), hl",  # prev -> mem (через HL, без DE-мем-опа)
    # ===== 8-ЦВЕТ: КОМПОЗИТ-СПРАЙТЫ (XOR в p1/p2, p3 схлопнут/свободен) =====
    # Стирание = XOR prev-паттерна (rot-петли под _8COLOR = XOR => обратимо => восстанавливает
    # фон-пиксели точно, БЕЗ фантомов и БЕЗ отдельной clear-плоскости). Маршрут:
    #   col&8 (одежда/мумии) -> DUAL p1+p2 => idx6 (серый); иначе (кожа/двери) -> p2 => idx2 (красный);
    #   нож (слоты 15-18) -> DUAL p1+p2 => idx6. Над чёрным фоном цвет точный; над цв.фоном XOR-микс
    #   (самостирается). Герой = кожа(idx2 красн)+одежда(idx6 серый) = ДВУХЦВЕТНЫЙ.
    *(([
    "\tld\ta, (vec_nsp_idx)", "\tcp\t15", "\tjp\tc, vns8_obj", "\tcp\t19", "\tjp\tc, vns8_dual",
    "vns8_obj:",
    "\tld\thl, (vec_nsp_ptr)", "\tinc\thl", "\tinc\thl", "\tinc\thl", "\tld\ta, (hl)",  # col
    "\tand\t8", "\tjp\tnz, vns8_dual",                       # col&8 -> одежда/мумия -> dual (idx6)
    "\tld\ta, 0C0h", "\tld\t(vnc_pbase), a",                 # кожа/двери -> p2 (idx2)
    "\tld\thl, (vec_nsp_pptr)", "\tcall\tvec_nsx",           # XOR erase prev
    "\tld\thl, (vec_nsp_ptr)", "\tcall\tvec_nsx",            # XOR draw cur
    "\tjp\tvns_drawn",
    "vns8_dual:",                                            # p1+p2 -> idx6 (серый одежда/мумия/нож)
    "\tld\ta, 0A0h", "\tld\t(vnc_pbase), a",
    "\tld\thl, (vec_nsp_pptr)", "\tcall\tvec_nsx",
    "\tld\thl, (vec_nsp_ptr)", "\tcall\tvec_nsx",
    "\tld\ta, 0C0h", "\tld\t(vnc_pbase), a",
    "\tld\thl, (vec_nsp_pptr)", "\tcall\tvec_nsx",
    "\tld\thl, (vec_nsp_ptr)", "\tcall\tvec_nsx",
    "\tjp\tvns_drawn",
    ]) if _8C_SPRITES else ()),
    # Фаза A+: маршрут плоскости по col-байту (cur+3): бит3 (col&8) -> p2(0xC0 серый одежда/
    # мумии), иначе -> p3(0xE0 красный кожа/двери). vnc_pbase используется И erase(prev) И
    # draw(cur): одна плоскость на объект, цвет стабилен. hideSprAttrib пишет только Y=0xE1
    # (col сохраняется) -> скрытие объекта стирается той же плоскостью, следа не остаётся.
    # Два спрайта героя (одежда p2 / кожа p3) чистят каждый свою плоскость -> не конфликтуют.
    # Пакет 2: нож = спрайт-слоты 15-18 (паттерны 0xF0-0xFC, MSX цвет 0Fh=белый). Белый idx15
    # требует ОБЕ плоскости p2+p3 -> dual-plane: стираем и рисуем нож в p2(0xC0) И p3(0xE0).
    # Остальные слоты (герой/мумии/двери/карта) — как раньше, одна плоскость по col&8.
    # S2 (_8COLOR): нож 2-й проход в БАЗЕ идёт в p3 (0xE0). Но в 8-цв p3 СХЛОПНУТ (палитра
    # color[idx]==color[idx|1]) => p3-проход ВИЗУАЛЬНО МЁРТВ, а его записи затирали бы кэши в
    # p3 (0xE600+). Под _8COLOR перенаправляем 2-й проход на p2 (0xC0): такт-в-такт тот же
    # immediate, а clear(prev)+OR-draw(cur) ИДЕМПОТЕНТЕН => p2 (видимый) идентичен, p3 не тронут.
    *((["\tld\ta, (vec_nsp_idx)", "\tcp\t15", "\tjp\tc, vns_pbcol", "\tcp\t19", "\tjp\tnc, vns_pbcol",
        "\tld\ta, 0C0h", "\tld\t(vnc_pbase), a",                        # нож p2-проход
        "\tld\thl, (vec_nsp_pptr)", "\tcall\tvec_nsx_clear",
        "\tld\thl, (vec_nsp_ptr)", "\tcall\tvec_nsx",
        ("\tld\ta, 0C0h" if _8COLOR else "\tld\ta, 0E0h"), "\tld\t(vnc_pbase), a",  # нож 2-й проход (базе p3; 8-цв p2, p3-кэш цел)
        "\tld\thl, (vec_nsp_pptr)", "\tcall\tvec_nsx_clear",
        "\tld\thl, (vec_nsp_ptr)", "\tcall\tvec_nsx",
        "\tjp\tvns_drawn"]) if _COLOR2 and not _8C_SPRITES and not _8C_RLIST else ()),
    "vns_pbcol:",
    "\tld\thl, (vec_nsp_ptr)", "\tinc\thl", "\tinc\thl", "\tinc\thl", "\tld\ta, (hl)",  # col
    # A+/COLOR2: col&8 -> p2(0xC0 одежда) иначе p3(0xE0 кожа). 8-цв (без _8C_SPRITES): кожа-плоскость
    # p3->p1(0xA0), т.к. p3 СХЛОПНУТ (невидим) => кожа была бы невидима. p1 => кожа = idx4 (видима),
    # одежда = idx2 (красный) => ГЕРОЙ ДВУХЦВЕТНЫЙ. НУЛЕВОЕ изменение тактов (иной immediate) =>
    # attract не реседится. Стирание clear_box p1: фантом-дыры на idx12(белый текст/лестн-верх, p1=1)
    # там, где герой прошёл (принято; чистое стирание = render-list, опция _8C_SPRITES).
    # 2c ЦВЕТ МУМИЙ ПО ТИПУ: слоты 6-13 (enemyAttrib) -> плоскость по цвет-нибблу (tiposMomia).
    # 8-цв композит-спрайт даёт лишь idx2(серый p2)/idx4(красн p1)/idx8(золото p0 над чёрн).
    # idx4 красн сливается с красн-рядами кирпичей -> НЕ используем. Тёплые {8,9,A}(ср/св.красн+
    # жёлт) -> p0 idx8 ЗОЛОТО; холодные {F,4,проч}(бел/син) -> p2 idx2 СЕРЫЙ. 2 различимых цвета,
    # оба контрастны против кирпичей и чёрн коридоров. Герой/нож/карта (проч. слоты) -> col&8.
    *((["\tld\tb, a",
        "\tld\ta, (vec_nsp_idx)", "\tcp\t6", "\tjp\tc, vns_pbher", "\tcp\t14", "\tjp\tnc, vns_pbher",
        "\tld\ta, b", "\tand\t0Fh",
        "\tcp\t8", "\tjp\tz, vns_mgold", "\tcp\t9", "\tjp\tz, vns_mgold", "\tcp\t0Ah", "\tjp\tz, vns_mgold",
        "\tld\ta, 0C0h", "\tjp\tvns_pbset",                                # бел/син/проч -> p2 серый
        "vns_mgold:", "\tld\ta, 080h", "\tjp\tvns_pbset",                  # тёпл -> p0 золото (над чёрн)
        "vns_pbher:", "\tld\ta, b", "\tand\t8", "\tld\ta, 0A0h", "\tjp\tz, vns_pbset", "\tld\ta, 0C0h"]
       if _MUMCOL else
       ["\tand\t8", "\tld\ta, 0A0h", "\tjp\tz, vns_pbset", "\tld\ta, 0C0h"]) if _8COLOR else
      ["\tand\t8", "\tld\ta, 0E0h", "\tjp\tz, vns_pbset", "\tld\ta, 0C0h"]),
    "vns_pbset:",
    "\tld\t(vnc_pbase), a",
    # _8C_RLIST: restore prev фон -> save фон под cur -> draw cur (save-under, БАГ1-фикс).
    # Иначе (A+/COLOR2 или 8-цв без RLIST): деструктивное clear_box + OR-draw.
    *((([] if _8C_RL2 else ["\tcall\tvec_su_restore"])    # RL2: restore уже сделан Pass-R
        # MASKED (прототип): створки ворот = слоты 0-3 (setSprDoorProta). Метим ДО save,
        # чтобы vec_su_save сохранил и гасимую плоскость p0 (hi0c).
        + (["\txor\ta", "\tld\t(vnc_maskon), a",
             "\tld\ta, (vec_nsp_idx)", "\tcp\t4", "\tjp\tnc, vns_nomask",
             "\tld\ta, 1", "\tld\t(vnc_maskon), a",
             "vns_nomask:"] if _8C_MASK else [])
        + ["\tld\thl, (vec_nsp_ptr)", "\tcall\tvec_su_save",  # сохранить фон под cur (vnc_pbase, cur Y/X)
           "\tld\thl, (vec_nsp_ptr)", "\tcall\tvec_nsx"]      # нарисовать cur (OR)
        + ((["\tld\ta, (vnc_pbase)", "\tcp\t0A0h", ("\tjp\tnz, vns_mchk" if _8C_MASK else "\tjp\tnz, vns_drawn"),  # AURA: p1-спрайт -> dual
            "\tld\ta, 0C0h", "\tld\t(vnc_pbase), a",          # 2-я плоскость p2 => idx6 (красный)
            "\tld\thl, (vec_nsp_ptr)", "\tcall\tvec_nsx",
            ]
           + (["vns_mchk:"] if _8C_MASK else [])) if _8C_AURA else [])
        # MASKED: 3-й проход — ГАШЕНИЕ фона p0 по маске спрайта (спрайт непрозрачен: его биты
        # не складываются с фоном; створка над кирпичом = idx6 красный, не idx14 зелёный).
        + (["\tld\ta, (vnc_maskon)", "\tor\ta", "\tjp\tz, vns_drawn",
             "\tld\ta, (vnc_pbase)", "\tand\t1Fh", "\tadd\ta, 80h", "\tld\t(vnc_pbase), a",
             "\tld\ta, 1", "\tld\t(vnc_mode), a",
             "\tld\thl, (vec_nsp_ptr)", "\tcall\tvec_nsx",
             "\txor\ta", "\tld\t(vnc_mode), a"] if _8C_MASK else [])
       if _8C_RLIST else
      ["\tld\thl, (vec_nsp_pptr)", "\tcall\tvec_nsx_clear",   # erase: prev footprint (та же плоскость)
       "\tld\thl, (vec_nsp_ptr)", "\tcall\tvec_nsx"])),       # draw: current [Y,X,pat,col]
    "vns_drawn:",
    "\tld\thl, (vec_nsp_ptr)", "\tld\ta, (hl)",
    "\tld\thl, (vec_nsp_pptr)", "\tld\t(hl), a",
    "\tld\thl, (vec_nsp_ptr)", "\tinc\thl", "\tld\ta, (hl)",
    "\tld\thl, (vec_nsp_pptr)", "\tinc\thl", "\tld\t(hl), a",
    "\tld\thl, (vec_nsp_ptr)", "\tinc\thl", "\tinc\thl", "\tld\ta, (hl)",
    "\tld\thl, (vec_nsp_pptr)", "\tinc\thl", "\tinc\thl", "\tld\t(hl), a",
    # advance vec_nsp_pptr+=3 -> DE, vec_nsp_ptr+=4 -> HL (следующий спрайт в регистрах)
    "\tld\thl, (vec_nsp_pptr)",
    "\tld\ta, l", "\tadd\ta, 3", "\tld\te, a", "\tld\ta, h", "\tadc\ta, 0", "\tld\td, a",
    "\tld\thl, (vec_nsp_ptr)",
    "\tld\ta, l", "\tadd\ta, 4", "\tld\tl, a", "\tld\ta, h", "\tadc\ta, 0", "\tld\th, a",
    "\tjp\tvns_bottom",
    "vns_stat:",   # статичен: HL,DE на +2 -> cur+4, prev+3
    "\tinc\thl", "\tinc\thl", "\tinc\tde",
    "\tjp\tvns_bottom",
    "vns_next:",   # оба скрыты: HL,DE на базе -> cur+4, prev+3
    "\tinc\thl", "\tinc\thl", "\tinc\thl", "\tinc\thl",
    "\tinc\tde", "\tinc\tde", "\tinc\tde",
    "vns_bottom:",   # HL=след.cur, DE=след.prev; счётчик спрайтов в памяти (BC не трогаем)
    "\tld\ta, (vec_nsp_idx)", "\tinc\ta", "\tld\t(vec_nsp_idx), a",
    "\tcp\t21", "\tjp\tc, vns_loop",   # ФИКС 2026-07-15: 14->19->21 слотов — нож (15-18) + карта-спрайты (attrPiramidMap 19, attrFlechaMap 20)
    "\tret",
    # ---- ФИКС ПОДБОРА (2026-07-13): стереть живые спрайты СТАРЫМ паттерном ----
    # loadAnimation (подбор/сброс предмета pico/knife, cogeObjeto) перегенерирует
    # hero-спрайт-паттерн в vec_spr_shadow. Блиттер vec_nsx стирает спрайт по ЖИВОМУ
    # shadow, поэтому erase следующего кадра XOR'ит НОВЫЙ паттерн поверх пикселей,
    # нарисованных СТАРЫМ -> (old XOR new) остаётся мусор-хвостом у героя (никогда не
    # стирается). vec_spr_flush (Vector-only, вызывается из cogeObjeto ДО jp loadAnimation,
    # пока shadow ещё СТАРЫЙ) XOR-стирает все нарисованные спрайты (vec_nsp_prev) -> plane3
    # чист, и метит prev скрытым (Y=0xD0) -> следующий updateSprites не стирает (no-op) и
    # рисует героя заново новым паттерном. Чистый подбор без хвоста. Тот же ISR-контекст,
    # что и vec_nat_sprites (не реентерабельно): vec_nsx безопасен. Клоббер A/BC/HL/DE — ок
    # (loadAnimation читает objetoCogido из RAM, не из A).
    "vec_spr_flush:",
    # _8C_RLIST: restore-under ВСЕ слоты (снять спрайты, вернув сохранённый фон), инвалидировать
    # слоты и пометить prev скрытым. Т.к. restore берёт СОХРАНЁННЫЙ ФОН (не паттерн), смена
    # hero-паттерна в loadAnimation не оставляет хвоста; следующий updateSprites рисует заново.
    *(((["\tld\ta, 20"] if _8C_RL2 else ["\txor\ta"]) +      # RL2: reverse 20->0 (стек-раскрутка)
       ["\tld\t(vec_nsp_idx), a",
        "vsf_loop:",
        "\tcall\tvec_su_restore",                              # вернуть фон под слотом idx
        "\tcall\tvec_su_ptr", "\txor\ta", "\tld\t(hl), a",     # invalidate slot
        "\tld\ta, (vec_nsp_idx)", "\tld\tl, a", "\tld\th, 0", "\tld\td, h", "\tld\te, l",
        "\tadd\thl, hl", "\tadd\thl, de",                      # HL = idx*3
        "\tld\tde, vec_nsp_prev", "\tadd\thl, de",
        "\tld\t(hl), 0D0h"]                                    # prev[idx].Y = hidden
       + ((["\tld\ta, (vec_nsp_idx)", "\tdec\ta", "\tld\t(vec_nsp_idx), a",
            "\tjp\tp, vsf_loop",
            "\txor\ta", "\tld\t(vsu_any), a",                  # все слоты сняты
            "\tret"]) if _8C_RL2 else
          (["\tld\ta, (vec_nsp_idx)", "\tinc\ta", "\tld\t(vec_nsp_idx), a",
            "\tcp\t21", "\tjp\tc, vsf_loop",
            "\tret"])) +
       [
        # === RENDER-LIST save-under/restore-under (post-align: pre-align padding занят
        # === text_blit/blit_rect, поэтому весь новый код здесь, в хвостовом запасе < 0x6598).
        # vec_su_ptr: HL = адрес слота для vec_nsp_idx (=0xE000 + idx*64). Клоб A,B; сохр C,D,E.
        "vec_su_ptr:"]
       + ((["\tld\ta, (vec_nsp_idx)", "\tld\tl, 0"])          # слот 256Б: H=0xE0+idx, L=0
          if _8C_MASK else
          (["\tld\ta, (vec_nsp_idx)", "\tld\tb, a"]
           + ((["\tand\t1", "\trrca", "\tld\tl, a",           # L=(idx&1)*128 (слот 128Б dual)
                "\tld\ta, b", "\tor\ta", "\trra"]) if _8C_AURA else
              (["\tand\t3", "\trrca", "\trrca", "\tld\tl, a", # L=(idx&3)*64
                "\tld\ta, b", "\tor\ta", "\trra", "\tor\ta", "\trra"]))))  # A=idx>>2
       + ["\tadd\ta, 0E0h", "\tld\th, a",                     # H=0xE0+idx>>N (=vec_spr_save>>8)
        "\tret",
        # vec_su_restore: слот -> фон в fb (стирание спрайта БЕЗ порчи HUD/лестниц).
        "vec_su_restore:",
        "\tcall\tvec_su_ptr",
        "\tld\ta, (hl)", "\tor\ta", "\tret\tz",               # invalid -> nothing
        "\tinc\thl", "\tld\ta, (hl)", "\tld\t(vsu_hi), a",    # hi0
        "\tinc\thl", "\tld\ta, (hl)", "\tld\t(vsu_lo), a",    # lo0
        "\tinc\thl", "\tld\ta, (hl)", "\tld\tc, a"]           # ncols
       + ((["\tld\t(vsu_nc), a",                              # копия ncols для 2-го прохода
            "\tinc\thl", "\tld\ta, (hl)", "\tld\t(vsu_hib), a"]) if _8C_AURA else [])  # hi0b
       + ((["\tinc\thl", "\tld\ta, (hl)", "\tld\t(vsu_hic), a"]) if _8C_MASK else [])  # hi0c
       + ["\tinc\thl",
        # === POP-хайджек (2026-07-27): SP = данные слота (последовательны через все
        # плоскости), fb пишется СНИЗУ ВВЕРХ (vsu_lo хранит НИЗ столбца, формат слота
        # развёрнут). ~17.5т/байт против 26. DI на весь хайджек; ЗАПРЕТ call/push внутри;
        # ei-протокол vbt_row (в ISR остаёмся DI).
        "\tdi",
        "\tld\t(vsu_rchl), hl",
        "\tld\thl, 0", "\tadd\thl, sp", "\tld\t(vsu_sp), hl",
        "\tld\thl, (vsu_rchl)", "\tld\tsp, hl",            # SP = данные слота
        "vsu_rcol:",
        "\tld\ta, (vsu_hi)", "\tld\th, a", "\tld\ta, (vsu_lo)", "\tld\tl, a",  # HL=fb НИЗ
        "vsu_rrow:"]
       + sum([["\tpop\tde", "\tld\t(hl), e", "\tinc\tl", "\tld\t(hl), d", "\tinc\tl"] for _ in range(8)], [])
       + [
        "\tld\ta, (vsu_hi)", "\tinc\ta", "\tld\t(vsu_hi), a",
        "\tdec\tc", "\tjp\tnz, vsu_rcol"]
       + ((["\tld\ta, (vsu_hib)", "\tor\ta", ("\tjp\tz, vsu_r3" if _8C_MASK else "\tjp\tz, vsu_rdone"),  # dual: 2-я плоскость
            "\tld\t(vsu_hi), a",
            "\txor\ta", "\tld\t(vsu_hib), a",                 # гейт: после 2-го прохода дальше
            "\tld\ta, (vsu_nc)", "\tld\tc, a",
            "\tjp\tvsu_rcol",
            ]
           + (["vsu_r3:"] if _8C_MASK else [])) if _8C_AURA else [])
       + ((["\tld\ta, (vsu_hic)", "\tor\ta", "\tjp\tz, vsu_rdone",  # masked: 3-я (гасимая) плоскость
            "\tld\t(vsu_hi), a",
            "\txor\ta", "\tld\t(vsu_hic), a",
            "\tld\ta, (vsu_nc)", "\tld\tc, a",
            "\tjp\tvsu_rcol"]) if _8C_MASK else [])
       + ["vsu_rdone:",
        "\tld\thl, (vsu_sp)", "\tld\tsp, hl",              # вернуть настоящий SP
        "\tld\ta, (vec_isr_depth)", "\tor\ta", "\tjp\tnz, vsu_rkdi",
        "\tei",
        "vsu_rkdi:",
        "\tret",
        # vec_su_save: HL->cur[Y,X], vnc_pbase=плоскость -> сохранить фон под footprint + вернуть.
        "vec_su_save:",                                       # HL->cur[Y,X]; vnc_pbase=plane
        "\tld\ta, (hl)", "\tcp\t0D0h", "\tjp\tnc, vsu_hide",  # скрыт -> инвалидировать слот
        "\tcpl", "\tsub\t15", "\tld\t(vsu_lo), a",          # lo_b = НИЗ столбца = 240-Y (формат POP)
        "\tinc\thl", "\tld\ta, (hl)",                         # X
        "\tld\tc, 3", "\tand\t7", "\tjp\tnz, vsu_sc3", "\tdec\tc",  # X&7==0 -> 2 стб
        "vsu_sc3:",
        "\tld\ta, (hl)", "\trrca", "\trrca", "\trrca", "\tand\t1Fh", "\tld\tb, a",  # B=col0=X>>3
        "\tadd\ta, c", "\tcp\t33", "\tjp\tc, vsu_snc",        # col0+ncols<=32?
        "\tld\ta, 32", "\tsub\tb", "\tld\tc, a",              # клип ncols=32-col0 (правый край)
        "vsu_snc:",
        "\tld\ta, (vnc_pbase)", "\tadd\ta, b", "\tld\t(vsu_hi), a",  # hi0 = plane + col0
        "\tcall\tvec_su_ptr",                                 # HL=slot (C=ncols сохранён)
        "\tld\t(hl), 1", "\tinc\thl",                         # valid=1
        *((["\tld\ta, 1", "\tld\t(vsu_any), a"]) if _8C_RL2 else ()),  # гейт fixup: есть слоты
        "\tld\ta, (vsu_hi)", "\tld\t(hl), a", "\tinc\thl",    # hi0
        "\tld\ta, (vsu_lo)", "\tld\t(hl), a", "\tinc\thl",    # lo0
        "\tld\t(hl), c", "\tinc\thl"]                         # ncols
       + ((["\tld\ta, c", "\tld\t(vsu_nc), a",                # dual-заголовок: hi0b
            "\tld\ta, (vnc_pbase)", "\tcp\t0A0h", "\tjp\tz, vsu_sdual",
            "\txor\ta", "\tjp\tvsu_shw",                      # не-p1 спрайт: hi0b=0
            "vsu_sdual:",
            "\tld\ta, (vsu_hi)", "\tadd\ta, 20h",             # p1(0xA0+col) -> p2(0xC0+col)
            "vsu_shw:",
            "\tld\t(vsu_hib), a", "\tld\t(hl), a", "\tinc\thl"]) if _8C_AURA else [])
       # MASKED: hi0c = ГАСИМАЯ плоскость p0 (0x80+col) у masked-спрайта, иначе 0.
       + ((["\tld\ta, (vnc_maskon)", "\tor\ta", "\tjp\tz, vsu_snoc",
            "\tld\ta, (vsu_hi)", "\tand\t1Fh", "\tadd\ta, 80h", "\tjp\tvsu_shwc",
            "vsu_snoc:", "\txor\ta",
            "vsu_shwc:",
            "\tld\t(vsu_hic), a", "\tld\t(hl), a", "\tinc\thl"]) if _8C_MASK else [])
       + [
        # POP-хайджек save: SP = fb-столбец (НИЗ, адреса растут вверх), приёмник-слот в HL
        # (данные подряд через плоскости). Между столбцами SP переставляется (колонки fb
        # разрывны). DI на весь хайджек; запрет call/push; ei-протокол vbt_row.
        "\tdi",
        "\tld\t(vsu_rchl), hl",
        "\tld\thl, 0", "\tadd\thl, sp", "\tld\t(vsu_sp), hl",
        "\tld\thl, (vsu_rchl)",                              # HL = слот (data)
        "vsu_scol:",
        "\tld\ta, (vsu_hi)", "\tld\td, a", "\tld\ta, (vsu_lo)", "\tld\te, a",
        "\tex\tde, hl", "\tld\tsp, hl", "\tex\tde, hl",  # SP = fb низ столбца
        "vsu_srow:"]
       + sum([["\tpop\tde", "\tld\t(hl), e", "\tinc\tl", "\tld\t(hl), d", "\tinc\tl"] for _ in range(8)], [])
       + ["\tld\ta, (vsu_hi)", "\tinc\ta", "\tld\t(vsu_hi), a", # next col
        "\tdec\tc", "\tjp\tnz, vsu_scol"]
       + ((["\tld\ta, (vsu_hib)", "\tor\ta", ("\tjp\tz, vsu_s3" if _8C_MASK else "\tret\tz"),  # dual: сохранить и p2
            "\tld\t(vsu_hi), a",
            "\txor\ta", "\tld\t(vsu_hib), a",
            "\tld\ta, (vsu_nc)", "\tld\tc, a",
            "\tjp\tvsu_scol",
            ]
           + (["vsu_s3:"] if _8C_MASK else [])) if _8C_AURA else ())
       + ((["\tld\ta, (vsu_hic)", "\tor\ta", "\tjp\tz, vsu_sdone",  # masked: сохранить гасимую p0
            "\tld\t(vsu_hi), a",
            "\txor\ta", "\tld\t(vsu_hic), a",
            "\tld\ta, (vsu_nc)", "\tld\tc, a",
            "\tjp\tvsu_scol"]) if _8C_MASK else [])
       + ["vsu_sdone:",
        "\tld\thl, (vsu_sp)", "\tld\tsp, hl",
        "\tld\ta, (vec_isr_depth)", "\tor\ta", "\tjp\tnz, vsu_skdi",
        "\tei",
        "vsu_skdi:",
        "\tret",
        "vsu_hide:",
        "\tcall\tvec_su_ptr", "\txor\ta", "\tld\t(hl), a", "\tret"]) if _8C_RLIST else
      (["\tld\thl, vec_nsp_prev", "\tld\tb, 19",
        "vsf_loop:",
        "\tld\ta, (hl)", "\tcp\t0D0h", "\tjp\tnc, vsf_hide",   # уже скрыт -> стирать нечего
        "\tpush\tbc",
        "\tld\ta, 0C0h", "\tld\t(vnc_pbase), a", "\tpush\thl", "\tcall\tvec_nsx_clear", "\tpop\thl",  # p2
        "\tld\ta, 0E0h", "\tld\t(vnc_pbase), a", "\tpush\thl", "\tcall\tvec_nsx_clear", "\tpop\thl",  # p3
        "\tpop\tbc",
        "vsf_hide:",
        "\tld\t(hl), 0D0h",                                    # пометить prev скрытым (Y=0xD0)
        "\tinc\thl", "\tinc\thl", "\tinc\thl",                 # шаг 3 -> следующая запись
        "\tdec\tb", "\tjp\tnz, vsf_loop",
        "\tret"])),
    # HL -> [Y,X,pat] (or [Y,X,pat,col], only the first 3 bytes are read): draws (via
    # XOR) a mono 16x16 sprite into plane 3 at (X,Y). Y>=0xD0 -> hidden, no-op (Y is
    # used RAW, matching the validated JS prototype - sprAttrib/enemyAttrib are the
    # game's OWN pre-VDP RAM table, not the MSX SAT, so the classic "+1" VDP-Y quirk
    # does not apply here).
    # S4-GATE (env KV_S4PAD): +16 dead bytes before rot-loops/vec_nsx to PROVE
    # relocation-tolerance. With the caches moved to p3 (S2) this shift no longer
    # derails the start. Only under _8COLOR; removed after the gate is demonstrated.
    *((["vec_s4pad: defs 16, 0"]) if (_8COLOR and _os_pv.environ.get('KV_S4PAD')) else ()),
    "vec_nsx:",
    "\tld\ta, (hl)", "\tcp\t0D0h", "\tret\tnc",
    "\tld\t(vw_spry), a",
    "\tinc\thl", "\tld\ta, (hl)", "\tld\t(vnsx_x), a",
    "\tinc\thl", "\tld\ta, (hl)",                          # A = pat
    # ШАГ4a: зеркало «влево» ТОЛЬКО для pat в [0x60,0x94) — это ровно диапазон, куда
    # flipSprites клал горизонт-копии hero(0x60-0x87)+momia(0x88-0x93). setAttribProta
    # сделал add a,60h (ВЫБРАЛ зеркало); тут читаем БАЗУ (pat-0x60) и генерим флип НА ЛЕТУ
    # (реверс L<->R половин + бит-реверс байтов) — байт-в-байт как РАНЬШЕ хранил flipSprites.
    # Зеркала БОЛЬШЕ НЕ ХРАНЯТСЯ (spr_shadow 0xC380+ свободен). B=флаг зеркала.
    # ВАЖНО: pat>=0x94 — ЭТО НЕ зеркала, а РЕАЛЬНЫЕ спрайты (двери входа attribDoor
    # 0xD8/0xDC/0xE0/0xE4 и пр.); их рисуем НАПРЯМУЮ (без flip), иначе читался бы мусор
    # из hero-зеркал -> двери битые -> StartGame(GS4) не доходит до геймплея.
    "\tld\tb, 0",
    "\tcp\t60h", "\tjp\tc, vnsx_hp",                       # pat<0x60 -> обычный
    "\tcp\t94h", "\tjp\tnc, vnsx_hp",                      # pat>=0x94 -> обычный (двери и т.п.)
    "\tsub\t60h", "\tld\tb, 1",                            # база = pat-0x60; B=1 (зеркало)
    "vnsx_hp:",
    "\tand\t0FCh",                                         # 16x16 pattern base (low 2 bits ignored)
    # ШАГ4b: компактный vec_spr_buf. hero+momia base_pat<0xA0 -> off=base_pat*8 (0..0x1A0);
    # sprites2 base_pat>=0xA0 (реально 0xD4-0xFF) -> off=(base_pat-0xA0)*8 (0x1A0..0x300).
    # base_pat 0xA0-0xD3 не встречается (нет резидентных спрайтов). B (флаг зеркала) не тронут.
    "\tcp\t0A0h", "\tjp\tc, vnsx_pm", "\tsub\t0A0h",
    "vnsx_pm:",
    "\tld\tl, a", "\tld\th, 0",
    "\tadd\thl, hl", "\tadd\thl, hl", "\tadd\thl, hl",     # *8
    "\tld\tde, vec_spr_buf", "\tadd\thl, de",              # HL = БАЗА паттерна (32B: L0-15,R0-15)
    "\tld\t(vnsx_pat), hl",
    "\tld\ta, b", "\tld\t(vnsx_mir), a",                   # флаг зеркала (B пережил and/add hl)
    # Фаза A+: OVERWRITE(OR)-блиттер пишет спрайт в ОДНУ плоскость (vnc_pbase = 0xC0 p2 серый
    # ИЛИ 0xE0 p3 красный), выбранную caller'ом (vns_draw) по col-байту. Герой = 2 спрайта
    # (одежда p2 + кожа p3) в одной точке -> их перекрытие даёт p2+p3 = idx с обоими битами
    # = цвет-3 белый. Стирание — clear_box (не самостирается OR). Fall-through в vnsx_halves.
    "vnsx_halves:",
    # --- левая половина экрана (X) ---
    "\tld\ta, (vnsx_mir)", "\tor\ta", "\tjp\tz, vnsx_ln",
    "\tld\thl, (vnsx_pat)",                                # зеркало: слева = ПРАВАЯ половина базы (+16), реверс
    "\tld\ta, l", "\tadd\ta, 16", "\tld\tl, a", "\tld\ta, h", "\tadc\ta, 0", "\tld\th, a",
    "\tcall\tvnsx_rev16",                                  # HL = revbuf (бит-реверс 16Б)
    "\tjp\tvnsx_lg",
    "vnsx_ln:", "\tld\thl, (vnsx_pat)",                    # обычный: слева = ЛЕВАЯ половина базы (+0)
    "vnsx_lg:",
    "\tld\ta, (vnsx_x)", "\tld\tc, a",
    "\tcall\tvec_nsx_col",                                  # left half (X)
    # КЛИП по X (2026-07-13): правая половина 16px-спрайта = экранные X+8..X+15, её левый
    # пиксель = X+8. Если X+8 > 255 (add переносит CY), вся правая половина за ПРАВЫМ краем
    # экрана. Раньше C=X+8 заворачивался в 8-битном C -> col=(X+8)>>3 попадал в НАЧАЛО строки
    # (0..7) -> половина мумии рисовалась у ЛЕВОГО края (wrap-around по X). Как на MSX (VDP
    # клипит пиксели X>255, БЕЗ wrap): просто НЕ блитим эту половину. Левую половину (C=X,
    # 0..255 -> col 0..31) клипить не надо; её spill в col+1 уже режется в rot-петле (H==0FFh).
    # erase(prev) и draw(cur) клипят одинаково (клип — чистая функция X, prev.X = X, которым
    # спрайт был нарисован) -> XOR-самостирание остаётся когерентным.
    "\tld\ta, (vnsx_x)", "\tadd\ta, 8", "\tret\tc",        # правая половина за правым краем -> клип (skip)
    "\tld\tc, a",                                           # C = X+8 (экранный X правой половины)
    # --- правая половина экрана (X+8) ---
    "\tld\ta, (vnsx_mir)", "\tor\ta", "\tjp\tnz, vnsx_rm",
    "\tld\thl, (vnsx_pat)",                                # обычный: справа = ПРАВАЯ половина базы (+16)
    "\tld\ta, l", "\tadd\ta, 16", "\tld\tl, a", "\tld\ta, h", "\tadc\ta, 0", "\tld\th, a",
    "\tjp\tvnsx_rg",
    "vnsx_rm:", "\tld\thl, (vnsx_pat)", "\tcall\tvnsx_rev16",  # зеркало: справа = ЛЕВАЯ половина базы (+0), реверс
    "vnsx_rg:",
    "\tcall\tvec_nsx_col",                                  # right half (X+8), on-screen only
    "\tret",
    # vnsx_rev16 перенесён ПЕРЕД ALIGN 256 (в padding-зону перед vec_revtab), чтобы его
    # +12Б от битового реверса поглотились выравниванием и НЕ толкали хвост кода в
    # vec_spr_buf (0x6598). См. определение рядом с vec_mode_from8.
    # vec_mixtiles перенесён в pre-align padding (рядом с vec_nsx_clear) — освобождает хвост.
    # C=screen X (0-255) of this 8px half; HL=pattern ptr (16B, rows 0-15, bit7=
    # leftmost pixel). Rotates each row's byte right by X&7 (plain RRCA loop - no
    # self-modified jump table, simpler/safer than the retired vxqr/vxql) and XORs
    # the masked halves into the current column (0xE0+col) and, if the shift spills
    # bits into the next column, into (col+1) too (skipped at the right screen edge,
    # col==0x1F). mask = 0xFF>>shift (zero-filled, via `or a`/`rra` which clears carry
    # every iteration) - identical value to the retired vec_shrtab for the same
    # shift, just computed on the fly (also correct for shift 5-7: FF>>n == (1<<(8-n))-1
    # == the retired vec_shltab entry for m=8-n, so one formula covers the whole range).
    # БЛИТТЕР v2 (2026-07-12): ротация паттерна по X&7 O(1) вместо цикла vnc_rot O(shift).
    # Раньше `shift` итераций RRCA-цикла (~7 инстр/бит, 18.4% всех тактов). Теперь: раз на
    # полустолбец self-mod'им операнд `jp` (vnc_rjp) на вход rrca-цепочки vnc_r{shift} —
    # per-row `jp` исполняет ровно `shift` инлайн-rrca без счётчика/ветвлений. Безопасно:
    # операнд правится раз на полустолбец, блиттер НЕ реентерабелен (вложенный ISR=только
    # звук, vec_nat_sprites оттуда не вызывается). Маски (0xFF>>shift) — как раньше, раз/полуст.
    # БЛИТТЕР v3 (2026-07-12): диспатч на 8 shift-спец row-петель (rot0..rot7_loop,
    # см. _gen_blit_loops). Убирает per-row чтения масок (ld a,(vnc_mask) 13т ×2/ряд) и
    # jp-накладные v2 — маски КОНСТАНТНЫ в каждой петле, ротация ИНЛАЙН. Диспатч раз на
    # полустолбец через rot_tab. C=X(вход), HL=паттерн(вход) -> vnc_patc.
    "vec_nsx_col:",
    "\tld\t(vnc_patc), hl",                               # сохранить паттерн-ptr (освобождает HL)
    "\tld\ta, c", "\trrca", "\trrca", "\trrca", "\tand\t1Fh",
    "\tld\thl, vnc_pbase", "\tadd\ta, (hl)",              # VRAM hi = plane-base(0xC0/0xE0) + (X>>3)
    "\tld\t(vnc_hi), a",
    *((["\tld\ta, (vnc_mode)", "\tor\ta", "\tjp\tz, vnsc_or",   # masked-режим -> универсальная петля
        "\tld\ta, c", "\tand\t7", "\tld\t(vnm_shift), a",
        "\tld\tl, a", "\tld\th, 0", "\tld\tde, rotm_masks", "\tadd\thl, de",
        "\tld\ta, (hl)", "\tld\t(vnm_mask), a", "\tcpl", "\tld\t(vnm_nmask), a",
        "\tjp\trotm_loop",
        "vnsc_or:"]) if _8C_MASK else ()),
    "\tld\ta, c", "\tand\t7", "\tadd\ta, a",              # shift*2 (индекс в word-таблице)
    "\tld\tl, a", "\tld\th, 0"]
    + ["\tld\tde, rot_tab", "\tadd\thl, de",
    "\tld\te, (hl)", "\tinc\thl", "\tld\td, (hl)",        # DE = rot{shift}_loop
    "\tex\tde, hl", "\tjp\t(hl)",                         # -> специализированная петля
    # (Фаза B: dirty-очередь + компоситор-drain УДАЛЕНЫ. Раньше vcp_cells/vcp_scan
    #  дренировали dirty-очередь из name_shadow (vw_name enqueue). Теперь все пути текста/
    #  динамики блитят прямо в framebuffer (vec_text_blit/vec_blit_rect/vw_name-direct);
    #  name_shadow снят -> дренировать нечего. dummyLoop = чистый ei/halt idle.)
    # --- Задача 2.4: старый soft-VDP спрайт-конвейер УДАЛЁН (vec_render_erase/draw,
    # vec_sprpat_touch, vec_mark_under/mu_list, vec_xor_one/vec_xor_col, vxq0/vxqr/
    # vxql/vxq_wr2, vec_shrtab/vec_shltab) - масштаб ~370 строк, заменён на
    # vec_nat_sprites/vec_nsx/vec_nsx_col (см. выше, рисуют МОНО в plane 3 напрямую
    # из sprAttrib/enemyAttrib, без VDP SAT/shadow вообще). Оставшиеся потребители
    # (vec_isr, HideSprites-glue, vw_spr) обновлены на no-op/упрощены.
"RDVDP:", "\txor\ta", "\tret",
    "SNSMAT:",                      # A=row -> keys. Row 8 = vec_kb8 (SPACE/cursor);
    "\tcp\t8", "\tjp\tz, vec_snsmat8",     # other rows: no keys (0xFF)
    "\tld\ta, 0FFh", "\tret",
    "vec_snsmat8:", "\tld\ta, (vec_kb8)", "\tret",
    # Scan the real Vector-06C keyboard (rows via port 03, bits via port 02, both
    # active-low; port mode 8Ah set at init) and build the MSX SNSMAT row 8 image:
    # MSX row8: bit0=SPACE bit4=LEFT bit5=UP bit6=DOWN bit7=RIGHT.
    # Vector: row0 bits 4..7 = LEFT,UP,RIGHT,DOWN; row7 bit7 = SPACE.
    "vec_scan_keys:",
    *((["\tld\ta, 8Ah", "\tout\t(00h), a"]) if _MODE256 else ()),   # KV_MODE256: PB->вход только на чтение клавы (в VBlank)
    "\tld\ta, 0FEh", "\tout\t(03h), a",           # select Vector row 0 (cursors)
    "\tin\ta, (02h)", "\tcpl",                    # active-high pressed bits
    "\tld\tb, a",
    "\tand\t30h", "\tld\tc, a",                   # LEFT,UP map 1:1 (bits 4,5)
    "\tld\ta, b", "\tand\t40h", "\tadd\ta, a", "\tor\tc", "\tld\tc, a",   # RIGHT: 6->7
    "\tld\ta, b", "\tand\t80h", "\trrca", "\tor\tc", "\tld\tc, a",        # DOWN: 7->6
    "\tld\ta, 7Fh", "\tout\t(03h), a",            # select Vector row 7 (SPACE)
    "\tin\ta, (02h)", "\tcpl", "\tand\t80h",
    "\trlca", "\tor\tc",                          # SPACE: 7 -> 0 (циклический сдвиг)
    "\tcpl", "\tld\t(vec_kb8), a",                # back to MSX active-low
    "\tld\ta, 0FFh", "\tout\t(03h), a",          # PORT 3 = HW VSCROLL TOO! restore 0xFF
    # KV_MODE256: PB обратно на ВЫХОД -> mode512=0 driven всю видимую часть кадра (нет полос).
    # 8255 mode-word сбрасывает защёлки портов A/C -> переустанавливаем (как tankbat: out 1,2 / out 3 / out 2,0).
    *((["\tld\ta, 88h", "\tout\t(00h), a",
       "\tld\ta, 2", "\tout\t(01h), a",           # port C
       "\tld\ta, 0FFh", "\tout\t(03h), a",        # scroll (порт A)
       "\txor\ta", "\tout\t(02h), a"]) if _MODE256 else ()),  # бордюр 0 + mode512=0 (256-режим)
    "\tret",
    "",
    _KONAMI_LOGO,
    "",
] + _gen_blit_loops())


def _apply_vector_glue(src):
    # DEBUG-переключатели IX-deemu (диагностика регрессий): KVIXOFF=1 отключает ВСЕ
    # переписи IX этой сессии (Шаги 0-3) -> pre-IX baseline. KV_NO_S3=1 отключает только Шаг 3.
    import os as _osg
    _IXOFF = bool(_osg.environ.get('KVIXOFF'))
    _S3ON = (not _IXOFF) and (not _osg.environ.get('KV_NO_S3'))
    # 1) flat Vector image: vector page @0, RST7 @0x38, game body @0x100
    src = src.replace("\t\tSIZE    16 * 1024       ; ROM de 16K",
                      "\t\tSIZE    28 * 1024       ; Vector .rom (0x100..0x70FF, below framebuffer)")
    hdr_old = ("\t\torg\t#4000\n\n\t\tdw\t4241h\n\t\tdw\tstartCode\n"
               "\t\tdw\t0\n\t\tdw\t0\n\t\tdw\t0\n\t\tdw\t0\n\t\tdw\t0")
    # NOTE: Sjasm `org` sets the label PC but does NOT pad the flat output file, so
    # a later `org` would place bytes contiguously (jp vec_isr landing at file 0x03
    # instead of 0x38). Use `ds` to zero-fill the gap so file-offset == address.
    hdr_new = ("\t\torg\t#100\n\t\tjp\tvec_init\t; Vector .rom entry @0x100 "
               "(loads at 0x100; vec_init installs the RST7 vector)")
    assert hdr_old in src, "MSX cartridge header not found for Vector rebase"
    src = src.replace(hdr_old, hdr_new)

    # 2) remove MSX BIOS equs; the names are (re)defined as labels on the Vector
    #    routines in the runtime block (avoids Sjasm forward-equ pass mismatch).
    for name in ('WRTVDP', 'RDVRM', 'WRTVRM', 'SETRD', 'SETWR',
                 'WRTPSG', 'RDPSG', 'RDVDP', 'SNSMAT'):
        src = re.sub(rf'^{name}:\s*equ\s*#[0-9A-Fa-f]+[^\n]*\n', '', src, flags=re.M)
    # H_TIMI stops being a BIOS address; becomes a RAM cell (defined in MAP below)
    src = re.sub(r'^H_TIMI:\s*equ\s*#[0-9A-Fa-f]+[^\n]*\n', '', src, flags=re.M)

    # 3) drop `im 1` (no interrupt mode on i8080; Vector IRQ is fixed RST7)
    src = re.sub(r'\n[ \t]*im[ \t]+1\b[^\n]*', '', src, count=1)

    # 4) relocate work-RAM MAP low (0xE000 -> 0x5E00) so the 4K tile shadow fits
    #    below the framebuffer (code ends ~0x5D15; shadow+work must stay < 0x8000).
    # MASKED (2026-07-27): universal masked-loop сдвинула хвост кода за 0x6B00 (rot7_loop
    # 0x6B06). Поднимаем базу game-vars 0x6B00 -> 0x6C00: стек-резерв 1024Б при РЕАЛЬНОЙ
    # глубине ~120Б (замер 2026-07-15) поглощает 256Б без риска. Вне masked база прежняя
    # => OFF/откаты байт-в-байт.
    _VARBASE = "#6C80" if _8C_MASK else "#6B00"
    src = src.replace("\t\tMAP     #e000", "\t\tMAP     " + _VARBASE)
    # BorraMapaRAM does `ld (hl),14h; ld bc,8A0h; ldir` = fills MapaRAM..MapaRAM+8A0h
    # INCLUSIVE (0x8A1 bytes) — one past MapaRAM's declared 8A0h size. On MSX that spilled
    # into other RAM harmlessly; here H_TIMI sat exactly at MapaRAM+8A0h and got clobbered
    # -> `call H_TIMI` ran garbage -> derail. Pad absorbs this (and any similar) overrun.
    cells = ("vec_ovpad:\t# 10h\n"
             "H_TIMI:\t# 3\nvec_vdp_ptr:\t# 2\nvec_kb8:\t# 1\nvec_joy:\t# 1\n"
             "vw_byte:\t# 1\nvw_col:\t# 1\nvw_lowbase:\t# 1\nvw_t8:\t# 2\nvw_idx:\t# 2\n"
             "vw_py:\t# 1\nvw_low:\t# 1\nvw_paddr:\t# 2\nvw_tmp:\t# 1\nvw_pcnt:\t# 1\n"
             "vec_isr_save:\t# 11h\nvec_isr_depth:\t# 1\n"
             "vw_spry:\t# 1\nvw_sprx:\t# 1\nvw_shift:\t# 1\nvw_colhi:\t# 1\nvec_fill_val:\t# 1\n"
             "vec_spr_parity:\t# 1\n"
             "vec_ayregs:\t# 10h\nvec_vch:\t# 3\nvec_vfreq:\t# 6\nvec_td_pos:\t# 1\nvec_td_iter:\t# 1\nvec_spt_flag:\t# 1\nvec_sat_dirty:\t# 1\nvec_name_gen:\t# 1\nvec_td_slot:\t# 1\nvec_td_ent:\t# 2\nvw_dual:\t# 1\nvw_erase:\t# 1\nvec_rd_flag:\t# 1\nvec_sat_dl:\t# 1\nvw_rb_last:\t# 2\nvec_fr_par:\t# 1\nvw_mhi:\t# 1\nvbt_pp:\t# 2\nvbt_fg:\t# 1\nvec_sndb:\t# 1\nvec_mu_list:\t# 30h\nvec_mu_n:\t# 1\n"
             "vec_nr_ptr:\t# 2\nvec_nr_srow:\t# 1\nvec_nr_col:\t# 1\nvbt_wf:\t# 1\n"
             # Фаза C1: col_shadow (2К в p2) снята. render-mode считается ИНКРЕМЕНТАЛЬНО
             # и ФРАГМЕНТО-БЕЗОПАСНО прямо в vec_tilemode при каждом байте цвета
             # (vec_col_store, порядок-независимо), БЕЗ буфера цвета. vec_curtile=текущий
             # тайл; vbt_mc=построчный указатель в vec_mixcol (диапазонная mixed-палитра).
             "vec_curtile:\t# 1\nvbt_mc:\t# 2\n"
             # Задача 2.4 native mono-sprite renderer (plane 3, XOR self-erase):
             "vec_nsp_idx:\t# 1\nvec_nsp_ptr:\t# 2\nvec_nsp_pptr:\t# 2\n"
             "vnsx_x:\t# 1\nvnsx_pat:\t# 2\n"
             # ШАГ4a: vnsx_mir/vnsx_revbuf НЕ здесь — этот cells-блок упакован байт-в-байт до
             # pat_font_cell(0x7CFF); 17 лишних байт затирали шрифт. Они в свободной p2 (equ,
             # рядом с vec_revlut) — см. vnsx_revbuf/vnsx_mir выше.
             "vnc_hi:\t# 1\nvnc_shift:\t# 1\nvnc_mask:\t# 1\nvnc_nmask:\t# 1\nvnc_rc:\t# 1\nvnc_patc:\t# 2\n"
             # Фаза A+: цветные спрайты (одноплоскостной overwrite+clear_box):
             "vnc_pbase:\t# 1\nvnce_lo:\t# 1\n"
             + ("" if _8C_MASK else "vec_nsp_prev:\t# 3Fh\n")   # ФИКС 2026-07-15: 21 slots x [Y,X,pat] = 0x3F bytes (было 19/0x39);
                                        # +2 слота под карта-спрайты (attrPiramidMap 19, attrFlechaMap 20).
                                        # end 0x7CC6+0x3F=0x7D05; pat_font_cell/vec_mixbuf СДВИНУТЫ +6 (0x7CFF->0x7D05,
                                        # 0x7E7F->0x7E85), чтобы освободить место (mixbuf кончается 0x7EFD, il_tmp2 0x7EFE).
             # ФИКС 2026-07-14: vec_kl_* (Konami-logo decoder scratch, 17Б) ВЫНЕСЕНЫ из этого
             # упакованного cells-блока в dummy_10 (equ, см. конец main). Раньше они утыкались
             # в pat_font_cell(0x7CFF) -> декодер лого затирал паттерн цифры '0' (тайл 0x10,
             # байты 0x7CFF/0x7D00) -> битые цифры в HUD. Теперь блок кончается на vec_nsp_prev.
             + "")   # vec_pat_shadow + vec_name_shadow moved to plane 2 (equ)
    src = re.sub(r'(MapaRAM:\s*#\s*8A0h[^\n]*)', r'\1\n' + cells.replace('\\', '\\\\'), src)

    # 5) route the 3 VRAM output loops `exx / out (c),a / exx` -> call vec_vram_write
    lines = src.split('\n')
    i = 1
    while i < len(lines) - 1:
        s = lines[i].strip().replace('\t', ' ').split(';')[0].strip()
        if s in ('out (c), a', 'out (c),a') and lines[i-1].strip() == 'exx' and lines[i+1].strip() == 'exx':
            lines[i-1:i+2] = ["\t\tcall\tvec_vram_write\t; Vector: write to VRAM shadow / blit tile"]
        else:
            i += 1
    src = '\n'.join(lines)

    # 5a-coop) ФИКС ЗАВИСАНИЯ МУЗЫКИ на СКРОЛЛЕ (GS=9). drawRoom рисует ~704 тайла (22x32)
    # внутри одного tickMain-тика (после `ei`, но vec_vram_write/blit держат DI на весь
    # проход) -> вложенный VBlank со звук-драйвером не тикает -> музыка зависает как при
    # входе в комнату. vec_nat_room-фикс НЕ покрывает GS=9 (скролл рисует ПРОМЕЖУТОЧНОЕ
    # окно MapaRAM+offset, а vec_nat_room берёт окно ProtaRoom -> перевод на vec_nat_room
    # сломал бы анимацию). Поэтому тот же кооп-тик (updateSound+vec_flushvi, под DI без ei)
    # в построчный цикл drawRoom2 — на границе строки (после `pop bc`). Живые регистры там:
    # BC (счётчик строк) и DE (указатель на след. строку карты) -> сохраняем; HL/A мертвы.
    # vec_sndb сохраняем (не в SCRATCH). ~22 тика на кадр скролла.
    if _COOPSND:
        src = src.replace(
            "\t\tpop\tbc\n\t\tdjnz\tdrawRoom2\t; Dibuja siguiente fila",
            "\t\tpop\tbc\n"
            "\t\tpush\tbc\t\t; _COOPSND: coop sound tick per row (under DI, no ei)\n"
            "\t\tpush\tde\n"
            "\t\tld\ta, (vec_sndb)\n"
            "\t\tpush\taf\n"
            "\t\tcall\tupdateSound\n"
            "\t\tcall\tvec_flushvi\n"
            "\t\tpop\taf\n"
            "\t\tld\t(vec_sndb), a\n"
            "\t\tpop\tde\n"
            "\t\tpop\tbc\n"
            "\t\tdjnz\tdrawRoom2\t; Dibuja siguiente fila", 1)

    # 5a-nat) СТАДИЯ 1 soft-VDP: нативный drawRoom-скролл (GS=9). Заменяет per-tile
    # диспетчер vec_vram_write (704 вызова) на прямой блит vec_text_blit. name-addr ведём
    # в HL (старт 0x3820 = экран-строка 1, кол 0; name-таблица непрерывна 0x20/строка =>
    # inc hl естественно перетекает на след. строку). setVDPWrite снят (soft-VDP ptr больше
    # не нужен). HL сохраняем в vec_nr_ptr на границе строки (updateSound/ADD_A_DE клоббят HL);
    # перезагружаем в drawRoom2. _COOPSND-блок (pop bc/djnz drawRoom2) НЕ трогаем — HL там мёртв.
    # Только под _8COLOR: OFF-путь остаётся байт-в-байт с каноном.
    if _NATSCROLL:
        # (1) снять setVDPWrite, вместо него сохранить стартовый name-addr (HL=0x3820)
        src = src.replace(
            "\t\tcall\tsetVDPWrite\n\t\tld\tb, 16h",
            "\t\tld\t(vec_nr_ptr), hl\t; NATSCROLL: name ptr (setVDPWrite removed)\n"
            "\t\tld\tb, 16h", 1)
        # (2) на входе строки загрузить текущий name-addr в HL
        src = src.replace(
            "drawRoom2:\n\t\tpush\tbc\n\t\tpush\tde\n\t\tld\tb, 20h",
            "drawRoom2:\n\t\tpush\tbc\n\t\tpush\tde\n"
            "\t\tld\thl, (vec_nr_ptr)\t; NATSCROLL: name addr this row\n"
            "\t\tld\tb, 20h", 1)
        # (3) прямой блит + инкремент name-addr; после строки сохранить продвинутый HL
        src = src.replace(
            "\t\tcall\tgetTileFromID\n"
            "\t\tcall\tvec_vram_write\t; Vector: write to VRAM shadow / blit tile\n"
            "\t\tinc\tde\n"
            "\t\tdjnz\tdrawRoom3\n"
            "\n"
            "\t\tpop\tde",
            "\t\tcall\tgetTileFromID\t; A=tile#, preserves HL\n"
            "\t\tcall\tvec_text_blit\t; NATSCROLL: direct blit p0/p1 (HL=name,A=tile; preserves HL,DE,BC)\n"
            "\t\tinc\thl\t; NATSCROLL: advance name addr\n"
            "\t\tinc\tde\n"
            "\t\tdjnz\tdrawRoom3\n"
            "\n"
            "\t\tld\t(vec_nr_ptr), hl\t; NATSCROLL: save advanced name addr (next row start)\n"
            "\t\tpop\tde", 1)

    # 5b) setFillVRAM head. TWO jobs:
    #     (a) The BC-size gate MUST NOT clobber A - A is the FILL VALUE. The init
    #         full-VRAM clear is `ld bc,4000h / xor a / call VRAM_writeAC->setFillVRAM`;
    #         a naive `ld a,b / or c` gate turned the fill value into 0x40 (=B!) and
    #         sprayed 16K of 0x40 over every shadow -> the vertical-stripe corruption.
    #     (b) BC>=0x4000 (full-VRAM fill, value 0 in practice) -> fast memset of the
    #         framebuffer + all shadows instead of 16K trips through vec_vram_write
    #         (that per-byte crawl was the minute-long black screen at boot).
    # NB: the original setFillVRAM PRESERVES HL (callers like fillVRAM3Bank rely on
    # it: they do `add hl,800h` between banks) - so the fast path must too.
    fast = ("\t\tld\t(vec_fill_val), a\n"                     # preserve the fill value!
            "\t\tld\ta, b\n\t\tcp\t40h\n\t\tjp\tnc, vec_fill_all\n"
            # name-table full-screen clear (clearScreen: HL masked=0x3800, BC=0x300, val 0):
            # native memset of name_shadow + framebuffer planes 0/1, bypassing the 768
            # soft-VDP vw_name writes (each old!=new -> vec_dirty_set -> compositor blit).
            # The room background is already native (vec_nat_room); this catches ONLY the
            # logo/menu screen wipe. Exact clearScreen signature -> else normal gating.
            "\t\tld\ta, h\n\t\tand\t3Fh\n\t\tcp\t38h\n\t\tjp\tnz, vfn_no\n"
            "\t\tld\ta, l\n\t\tor\ta\n\t\tjp\tnz, vfn_no\n"        # start at cell 0
            "\t\tld\ta, b\n\t\tcp\t3\n\t\tjp\tnz, vfn_no\n"        # BC high == 3
            "\t\tld\ta, c\n\t\tor\ta\n\t\tjp\tnz, vfn_no\n"        # BC low == 0 -> BC==0x300
            "\t\tjp\tvec_fill_name\n"
            "vfn_no:\n\t\tld\ta, b\n"                              # restore A=b for gating
            "\t\tor\ta\n\t\tjp\tnz, vec_fill_sl0\n"       # small colour fill fast path:
            "\t\tld\ta, c\n\t\tcp\t41h\n\t\tjp\tnc, vec_fill_sl0\n"  # BC<=16
            "\t\tld\ta, h\n\t\tand\t3Fh\n\t\tcp\t18h\n\t\tjp\tnc, vec_fill_sl0\n"
            "\t\tld\t(vec_vdp_ptr), hl\n\t\tjp\tvec_fill_col\n"
            "vec_fill_sl0:\n"
            "\t\tld\ta, (vec_fill_val)\n"                     # -> slow path, A restored
            "\t\tjp\tvec_fill_slow\n"
            # Small colour fill (the treasure flash: ~10 x 8-byte fills per tick used to
            # crawl through the per-byte stack at ~85 instr/byte = ~7K instr/tick).
            # shadow-copy СОХРАНЁН (vec_col_shadow нужен нативному фон-рендеру для ВСЕХ
            # тайлов, не только гемов). Убран ТОЛЬКО мёртвый vfc_mk-цикл: он метил
            # тайлы через vec_td_mark (=stub, re-blit удалён нативным vec_nat_room) —
            # чистый мусор ~1294cy/кадр. Гем-flash мигание всё равно не видно (KNOWN
            # LOSS, будет через палитру); shadow обновляется, но re-blit нет.
            "vec_fill_col:\n"                              # count BC<=16, val vec_fill_val, addr vec_vdp_ptr
            "\t\tpush\thl\n\t\tpush\tde\n\t\tpush\tbc\n"
            "\t\tld\thl, (vec_vdp_ptr)\n"
            "\t\tld\ta, h\n\t\tand\t3Fh\n\t\tld\th, a\n"
            "\t\tpush\thl\n"                                  # сохранить masked start
            "\t\tld\ta, l\n\t\tadd\ta, c\n\t\tld\tl, a\n"
            "\t\tld\ta, h\n\t\tadc\ta, b\n\t\tld\th, a\n"
            "\t\tld\t(vec_vdp_ptr), hl\n"                     # ptr advances as the real fill would
            "\t\tpop\thl\n"                                  # masked start обратно
            # gem-colour filter: destellos(0x51-53)/паланка(0x5c) -> отбросить flash
            # (shadow не пишем; ptr уже сдвинут -> VDP-семантика цела; рендер игнорирует)
            "\t\tld\ta, l\n\t\trrca\n\t\trrca\n\t\trrca\n\t\tand\t1Fh\n\t\tld\te, a\n"
            "\t\tld\ta, h\n\t\trrca\n\t\trrca\n\t\trrca\n\t\tand\t0E0h\n\t\tor\te\n"
            "\t\tcall\tvec_is_gem_col\n\t\tjp\tz, vfc_me\n"
            # Фаза C1: non-gem colour fill -> vec_col_store (часть тайлсетного цвета
            # грузится setFillVRAM'ом, как baseline кормил col_shadow). Гемы отброшены
            # выше (мигание = палитра, KNOWN LOSS). vec_col_store сохраняет BC,DE,HL.
            "\t\tld\ta, h\n\t\tand\t7\n\t\tld\th, a\n"           # fold bank -> folded colour addr
            "vfc_l:\n"
            "\t\tld\ta, (vec_fill_val)\n\t\tcall\tvec_col_store\n"
            "\t\tinc\thl\n\t\tdec\tbc\n\t\tld\ta, b\n\t\tor\tc\n\t\tjp\tnz, vfc_l\n"
            "vfc_me:\n"
            "\t\tpop\tbc\n\t\tpop\tde\n\t\tpop\thl\n"
            "\t\tld\ta, (vec_fill_val)\n"
            "\t\tret\n"
            "vec_fill_all:\n"                                 # full-VRAM fill (A=0 caller)
            "\t\tpush\thl\n"
            "\t\tld\thl, 8000h\n"                             # planes 0+1 (visible) -> 0
            "vec_fa_fb:\n\t\txor\ta\n\t\tld\t(hl), a\n\t\tinc\thl\n\t\tld\ta, h\n\t\tcp\t0C0h\n\t\tjp\tc, vec_fa_fb\n"
            "\t\tld\thl, 0C000h\n"                            # SAT+sprite pat+bg pat shadows -> val
            # Фаза B: 0xD100-0xD3FF (name_shadow) и 0xDC00-0xDFBF (tilemode+dirty) сняты ->
            # НЕ трогаем эти p2-хвосты (verifiably free под будущие спрайты, как plane 3).
            # sat+spr+sat_drawn+pat(тайлы 0x00-0x7f). Стоп на 0xCD00 (было 0xD1): pat-хвост
            # тайлов 0x80-0xff мёртв (неигровые тайлсеты remap->0x40-0x78 work-RAM; 0x80-0x8b
            # тоже work-RAM) => его НЕ обнуляем -> 0xCD00-0xD100 free под спрайты. Только
            # immediate 0xD1->0xCD (размер кода тот же => адреса/тайминг демо не сдвигаются).
            "vec_fa_sh:\n\t\tld\ta, (vec_fill_val)\n\t\tld\t(hl), a\n\t\tinc\thl\n\t\tld\ta, h\n\t\tcp\t0CDh\n\t\tjp\tc, vec_fa_sh\n"
            # P2-ЧИСТКА: col_shadow (2К) снята, mixcol range-512Б -> SLOT-компактный
            # vec_mixbuf (120Б = 15 слотов x8 @0xD400-0xD477). Обнуляем ровно 120Б;
            # 0xD478-0xDBFF verifiably free под будущие спрайты (как plane 3).
            "\t\tld\thl, vec_mixbuf\n\t\tld\tb, 120\n"
            "vec_fa_col:\n\t\tld\ta, (vec_fill_val)\n\t\tld\t(hl), a\n\t\tinc\thl\n\t\tdec\tb\n\t\tjp\tnz, vec_fa_col\n"  # vec_mixbuf(120B) -> val
            # render-mode кэш вне p2 (work-RAM 0x7F00, 256B) -> FF=recompute
            "\t\tld\thl, vec_tilemode\n\t\tld\tb, 0\n"
            "vec_fa_md:\n\t\tld\t(hl), 0FFh\n\t\tinc\thl\n\t\tdec\tb\n\t\tjp\tnz, vec_fa_md\n"  # tile modes -> dirty
            # SAT stop-markers removed: sat_shadow/sat_drawn are DEAD (never read on render)
            "\t\tpop\thl\n"
            "\t\txor\ta\n\t\tret\n"
            "vec_fill_name:\n"                                # clearScreen native full-screen wipe
            "\t\tpush\thl\n\t\tpush\tde\n"                     # preserve HL (contract) + DE
            "\t\tld\ta, l\n\t\tadd\ta, c\n\t\tld\tl, a\n"      # HL += BC (VDP ptr advance)
            "\t\tld\ta, h\n\t\tadc\ta, b\n\t\tld\th, a\n"
            "\t\tld\t(vec_vdp_ptr), hl\n"                      # ptr past name table (VDP semantics)
            "\t\tld\thl, 8000h\n"                             # framebuffer planes 0+1 (visible) -> 0
            "vfn_fb:\n\t\txor\ta\n\t\tld\t(hl), a\n\t\tinc\thl\n\t\tld\ta, h\n\t\tcp\t0C0h\n\t\tjp\tc, vfn_fb\n"
            # Фаза B: memset name_shadow снят (тень удалена). Очистки fb планов 0/1 хватает.
            "\t\tpop\tde\n\t\tpop\thl\n"
            "\t\tld\ta, (vec_fill_val)\n\t\tret\n"
            "vec_fill_slow:\n\t\tcall\tsetVDPWrite")
    src = src.replace("setFillVRAM:\n\t\tcall\tsetVDPWrite",
                      "setFillVRAM:\n" + fast, 1)

    # 5c) BULK-COPY fast path for DEtoVRAM: the tileset load copies pattern data to
    #     VRAM 0x2000-0x37FF byte-by-byte through vec_vram_write (~30 instr/byte,
    #     plus the pattern-change re-blit scan) and stalls the game. All 3 SCREEN2
    #     pattern banks -> memcpy to the 6K shadow (no re-blit: the name table is
    #     redrawn after a tileset load anyway); anything else -> per-byte slow path.
    #     NB: vec_vdp_ptr carries the VDP mode bits (0x4000 = write) - mask them.
    #     NB: the original DEtoVRAM PRESERVES HL (UnpackPatterns does `add hl,800h`
    #     between the 3 bank passes) - clobbering it corrupted banks 1/2.
    de_fast = (
        "\t\tpush\thl\n"
        "\t\tld\thl, (vec_vdp_ptr)\n"
        "\t\tld\ta, h\n\t\tand\t3Fh\n\t\tld\th, a\n"
        "\t\tcp\t18h\n\t\tjp\tc, vec_de_col\n"          # colour table bulk
        "\t\tcp\t20h\n\t\tjp\tc, vec_de_sprb\n"         # sprite patterns bulk
        "\t\tcp\t38h\n\t\tjp\tc, vec_de_ok\n"           # bg patterns bulk
        "\t\tcp\t3Bh\n\t\tjp\tc, vec_de_slow0\n"        # name table -> slow (dedup/dirty)
        "\t\tcp\t3Ch\n\t\tjp\tc, vec_de_satb\n"         # SAT bulk (hot: sprite attrs!)
        "\t\tjp\tvec_de_slow0\n"
        "vec_de_ok:\n"
        "\t\tpush\thl\n"                                 # pattern bulk
        "\t\tld\ta, l\n\t\tadd\ta, c\n\t\tld\tl, a\n"
        "\t\tld\ta, h\n\t\tadc\ta, b\n\t\tld\th, a\n"
        "\t\tld\t(vec_vdp_ptr), hl\n"
        "\t\tpop\thl\n"
        "\t\tpush\tde\n"
        # Фаза A+ шаг3: развилка базы фон-кэша по диапазону tile (pat_base) -> maze/font в
        # work-RAM, меню в p2. База вычисляется ОДИН раз по СТАРТОВОМУ folded-адресу: загрузки
        # тайлсета регион-выровнены по вызову (loadFont->0x080 шрифт; GFX_InGame->0x200 лаб;
        # гемы 0x86-0x8b; GFX_Menu->0x480 меню), так что один DEtoVRAM не пересекает границу.
        # Копи-цикл БЫСТРЫЙ (исходный развёрнутый x8) -> нет тайминг-дрейфа при загрузке.
        # Так p2 pat[0x40-0x8b] БОЛЬШЕ НЕ ПИШЕТСЯ (аудит освобождения p2).
        "\t\tld\ta, h\n\t\tand\t7\n\t\tld\th, a\n"     # HL = folded pat addr (tile*8+row)
        "\t\tcall\tpat_base\n\t\tadd\thl, de\n"        # HL = &кэш[folded] (база по диапазону)
        "\t\tpop\tde\n"
        # Обычная bulk-копия (HL=назначение, DE=источник, BC=счётчик), развёрнутая x8. Делится
        # с vec_de_sprb (спрайт-паттерны в spr_shadow, свой HL=назначение) — обоим нужен один
        # generic-цикл HL<-DE.
        "vec_de_cpy:\n"
        "\t\tld\ta, b\n\t\tor\ta\n\t\tjp\tnz, vdcp_8\n"
        "\t\tld\ta, c\n\t\tcp\t8\n\t\tjp\tc, vdcp_1\n"
        "vdcp_8:\n"
        + ("\t\tld\ta, (de)\n\t\tld\t(hl), a\n\t\tinc\tde\n\t\tinc\thl\n" * 8) +
        "\t\tld\ta, c\n\t\tsub\t8\n\t\tld\tc, a\n\t\tld\ta, b\n\t\tsbc\ta, 0\n\t\tld\tb, a\n"
        "\t\tjp\tvec_de_cpy\n"
        "vdcp_1:\n\t\tld\ta, c\n\t\tor\ta\n\t\tjp\tz, vdcp_e\n"
        "\t\tld\ta, (de)\n\t\tld\t(hl), a\n\t\tinc\tde\n\t\tinc\thl\n"
        "\t\tdec\tc\n\t\tjp\tvdcp_1\n"
        "vdcp_e:\n"
        "\t\tpop\thl\n"
        "\t\tret\n"
        "vec_de_col:\n"                                  # bulk colour -> эагерный mode+mixcol (C1)
        # Фаза C1: col_shadow снята. Каждый байт цвета -> vec_col_store (накопитель тайла
        # + пересчёт mode на строке 7). Тайлсет грузится по 8 байт/тайл подряд -> mode
        # корректен для ВСЕХ загруженных тайлов (важно для restore под ножом — «джокер»).
        "\t\tpush\thl\n"                                 # advance VDP ptr past the range
        "\t\tld\ta, l\n\t\tadd\ta, c\n\t\tld\tl, a\n"
        "\t\tld\ta, h\n\t\tadc\ta, b\n\t\tld\th, a\n"
        "\t\tld\t(vec_vdp_ptr), hl\n"
        "\t\tpop\thl\n"                                  # HL = masked start
        "\t\tld\ta, h\n\t\tand\t7\n\t\tld\th, a\n"     # fold bank -> HL = folded colour addr
        "vec_de_ccpy:\n"
        "\t\tld\ta, (de)\n\t\tcall\tvec_col_store\n"    # HL=folded addr, A=byte (preserves BC,DE,HL)
        "\t\tinc\tde\n\t\tinc\thl\n"
        "\t\tdec\tbc\n\t\tld\ta, b\n\t\tor\tc\n\t\tjp\tnz, vec_de_ccpy\n"
        "\t\tpop\thl\n"                                 # restore caller HL (P0 from de_fast head)
        "\t\tret\n"
        "vec_de_sprb:\n"                                # bulk sprite patterns -> compact vec_spr_buf
        # 2.4: erase-before-write guard removed - vec_nat_sprites re-reads the shadow
        # fresh every frame (no stale "last-drawn" copy that this used to protect).
        # ШАГ4b: одна bulk-копия не пересекает границу региона (loadAnimation->hero 0x1800;
        # GFX_MOMIA->0x1940; GFX_SPRITES2->0x1EA0), поэтому смещение выбирается по СТАРТ h.
        "\t\tpush\thl\n"
        "\t\tld\ta, l\n\t\tadd\ta, c\n\t\tld\tl, a\n"
        "\t\tld\ta, h\n\t\tadc\ta, b\n\t\tld\th, a\n"
        "\t\tld\t(vec_vdp_ptr), hl\n"
        "\t\tpop\thl\n"
        "\t\tpush\tde\n"
        "\t\tld\ta, h\n\t\tld\tde, vec_spr_buf-1800h\n\t\tcp\t1Eh\n\t\tjp\tc, vec_de_sprb_w\n"
        "\t\tld\tde, vec_spr_buf-1D00h\n"                 # h>=0x1E -> sprites2 (сжатие -0x500)
        "vec_de_sprb_w:\n\t\tadd\thl, de\n"
        "\t\tpop\tde\n"
        "\t\tjp\tvec_de_cpy\n"
        "vec_de_satb:\n"                                # bulk SAT: shadow copy DROPPED (dead) - consume only
        "\t\tld\ta, 1\n\t\tld\t(vec_sat_dirty), a\n\t\tld\t(vec_sat_dl), a\n"
        "\t\tld\ta, l\n\t\tadd\ta, c\n\t\tld\tl, a\n"    # vec_vdp_ptr = start + BC
        "\t\tld\ta, h\n\t\tadc\ta, b\n\t\tld\th, a\n"
        "\t\tld\t(vec_vdp_ptr), hl\n"
        "\t\tld\ta, e\n\t\tadd\ta, c\n\t\tld\te, a\n"    # DE (source) += BC (DEtoVRAM leaves DE past src)
        "\t\tld\ta, d\n\t\tadc\ta, b\n\t\tld\td, a\n"
        "\t\tld\tbc, 0\n"                                # BC consumed
        "\t\tpop\thl\n"                                  # restore caller HL (unchanged: MSX VDP semantics)
        "\t\tret\n"
        "vec_de_slow0:\n"
        "\t\tpop\thl\n"
        "vec_de_slow:")
    src = src.replace("DEtoVRAM:\n\t\tld\ta, (de)",
                      "DEtoVRAM:\n" + de_fast + "\n\t\tld\ta, (de)", 1)
    src = src.replace("\t\tjr\tnz, DEtoVRAM", "\t\tjr\tnz, vec_de_slow", 1)
    # СТАДИЯ 6 (_NATVDP): vec_de_slow (DEtoVRAM slow-path, name/SAT-диапазоны; РАНТАЙМ-МЁРТВ,
    # 0 поп. в трапе) переводится с vec_vram_write на нативный vec_cache_wr (адрес в HL). HL
    # сохраняется (push/pop) — исходный vec_de_slow оставлял caller-HL нетронутым. DE (src) и
    # BC ведёт цикл; vec_cache_wr бережёт DE/BC/HL. Нужно, чтобы vec_vram_write имел 0 ссылок.
    if _NATVDP:
        src = src.replace(
            "vec_de_slow:\n\t\tld\ta, (de)\n"
            "\t\tcall\tvec_vram_write\t; Vector: write to VRAM shadow / blit tile\n"
            "\t\tinc\tde\n\t\tdec\tbc\n\t\tld\ta, b\n\t\tor\tc\n"
            "\t\tjr\tnz, vec_de_slow\n\t\tret",
            "vec_de_slow:\n"
            "\t\tpush\thl\n\t\tld\thl, (vec_vdp_ptr)\n"
            "vds_nl:\n"
            "\t\tld\ta, (de)\n\t\tcall\tvec_cache_wr\n\t\tinc\thl\n\t\tinc\tde\n"
            "\t\tdec\tbc\n\t\tld\ta, b\n\t\tor\tc\n\t\tjp\tnz, vds_nl\n"
            "\t\tld\t(vec_vdp_ptr), hl\n\t\tpop\thl\n\t\tret",
            1)

    # 5m) nextMomia: the original wraps the momia-pointer read in a pair of exx.
    #     getMomiaProcDat leaves the momia pointer in alt-DE'; the block does
    #     `exx / ld h,d / ld l,e / ld b,(hl)=status / inc hl / ld a,(hl)=sentido /
    #      srl a; srl a / inc hl / ld (hl),a=controles / ld a,b=status / exx`.
    #     Net register effect of the exx-pair on the i8080 target (each exx =
    #     ~27-instr RAM-cell swap, so this cost ~54 instr/call):
    #       * main BC/DE/HL restored unchanged (the block's edits happen in the
    #         swapped-in alt copy and get swapped back out);
    #       * A = status (exx does NOT touch AF, so `ld a,b` survives);
    #       * [pointer+2] (controles) = sentido>>2;
    #       * alt-DE' unchanged (=pointer); alt-BC' hi := status (lo kept);
    #         alt-HL' := pointer+2.
    #     Reproduce that state DIRECTLY with a temporary in HL (push/pop keeps main
    #     HL intact); stash status in z80_bc_alt+1 so it doubles as the alt-BC' hi
    #     update AND the reload source for the final A. No il_tmp/il_tmp2 needed:
    #     nothing between here and jumpIndex reads them (they're write-before-read
    #     scratch, unlike getMomiaDat where the mid-exx code consumed them).
    src = src.replace(
        "\t\texx\n"
        "\t\tld\th, d\n"
        "\t\tld\tl, e\n"
        "\t\tld\tb, (hl)\t\t; Status de la momia\n"
        "\t\tinc\thl\n"
        "\t\tld\ta, (hl)\t\t; Sentido (1 = izquierda, 2 = derecha)\n"
        "\t\tsrl\ta\n"
        "\t\tsrl\ta\n"
        "\t\tinc\thl\n"
        "\t\tld\t(hl), a\t\t; Controles. Dependiendo del sentido \"aprieta\" DERECHA o IZQUIERDA\n"
        "\t\tld\ta, b\t\t; Estado de la momia\n"
        "\t\texx\n",
        "\t\t; --- KV_native: 2x exx removed (replicates the exx-pair net effect) ---\n"
        "\t\tpush\thl\t\t; save main HL (main BC/DE left untouched)\n"
        "\t\tld\thl, (z80_de_alt)\t; HL = momia pointer (alt-DE')\n"
        "\t\tld\ta, (hl)\t\t; A = status\n"
        "\t\tld\t(z80_bc_alt+1), a\t; alt-BC' hi := status (net effect + stash A)\n"
        "\t\tinc\thl\n"
        "\t\tld\ta, (hl)\t\t; A = sentido\n"
        "\t\tor\ta\n\t\trra\n\t\tor\ta\n\t\trra\t\t; A = sentido>>2 (srl a; srl a)\n"
        "\t\tinc\thl\n"
        "\t\tld\t(hl), a\t\t; controles = sentido>>2\n"
        "\t\tld\t(z80_hl_alt), hl\t; alt-HL' := pointer+2 (net effect)\n"
        "\t\tld\ta, (z80_bc_alt+1)\t; A = status (restore into main.A)\n"
        "\t\tpop\thl\t\t; restore main HL; alt-DE' stays = pointer\n",
        1)

    # 5s) updateSound channel loop: the original juggles the loop counter through
    #     exx (B/DE in the alternate set) - on the i8080 every exx expands to a
    #     ~26-instruction RAM-cell swap, twice per channel per frame. Rewrite the
    #     loop without exx (counter in a RAM cell, DE reloaded); read MUSIC_ID
    #     directly through the ix cell (disp 2). Also fuse the hot
    #     `ld l,(ix+ADD_LOW) / ld h,(ix+ADD_HIGH)` pointer idioms into direct
    #     sequences (2 full ix macros ~30 instr -> ~10).
    src = src.replace(
        "\t\tld\tc, 1\n\t\tld\tix, MusicChanData\n\t\texx\n"
        "\t\tld\tb, 3\t\t; Numero de canales\n\t\tld\tde, 0Eh\t\t; Channel data size\n\n"
        "updateSound2:\n\t\texx\n"
        "\t\tld\ta, (ix+MUSIC_ID) ; Musica que esta reproduciendo el canal\n",
        "\t\tld\tc, 1\n"
        "\t\tld\thl, MusicChanData\n\t\tld\t(z80_ix), hl\n"
        "\t\tld\ta, 3\n\t\tld\t(vec_sndb), a\n\n"
        "updateSound2:\n"
        "\t\tld\thl, (z80_ix)\n\t\tinc\thl\n\t\tinc\thl\n"
        "\t\tld\ta, (hl)\t\t; (ix+MUSIC_ID)\n", 1)
    src = src.replace(
        "\t\tinc\tc\n\t\tinc\tc\t\t; Siguiente canal\n\t\texx\n"
        "\t\tadd\tix, de\t\t; Apunta a los datos del siguiente canal\n"
        "\t\tdjnz\tupdateSound2\t; Reproduce siguiente canal\n\t\tret\n",
        "\t\tinc\tc\n\t\tinc\tc\t\t; Siguiente canal\n"
        "\t\tld\thl, (z80_ix)\n\t\tld\tde, 0Eh\n\t\tadd\thl, de\n\t\tld\t(z80_ix), hl\n"
        "\t\tld\ta, (vec_sndb)\n\t\tdec\ta\n\t\tld\t(vec_sndb), a\n"
        "\t\tjp\tnz, updateSound2\t; Reproduce siguiente canal\n\t\tret\n", 1)
    # fused pointer reads/writes (MUSIC_ADD_LOW=3, HIGH=4; flags preserved)
    src = src.replace(
        "\t\tld\tl, (ix+MUSIC_ADD_LOW)\n\t\tld\th, (ix+MUSIC_ADD_HIGH) ; Puntero a los datos de\tla musica",
        "\t\tld\thl, (z80_ix)\n\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\n"
        "\t\tld\ta, (hl)\n\t\tinc\thl\n\t\tld\th, (hl)\n\t\tld\tl, a ; fused ADD_LOW/HIGH read", 1)
    src = src.replace(
        "\t\tld\t(ix+MUSIC_ADD_LOW), l\n\t\tld\t(ix+MUSIC_ADD_HIGH), h",
        "\t\tpush\tde\n\t\tex\tde, hl\n\t\tld\thl, (z80_ix)\n\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\n"
        "\t\tld\t(hl), e\n\t\tinc\thl\n\t\tld\t(hl), d\n\t\tex\tde, hl\n\t\tpop\tde ; fused ADD write")
    # 5s2) processSndData HOT HEAD (runs every frame per active channel): fuse the
    #     two leading ix macros; dec (ix+0) collapses to ld hl,(cell)/dec (hl)
    #     (DCR M sets Z for the fast "note still playing" exit).
    src = src.replace(
        "\t\tld\ta, (ix+MUSIC_ID)\n\t\tor\ta\n\t\tjp\tm, loc_7C2D\n\n"
        "\t\tdec\t(ix+MUSIC_CNT_NOTA) ; Decrementa contador duracion nota\n"
        "\t\tret\tnz\t\t; No hay que actualizar\tla nota, sigue sonando la anterior\n",
        "\t\tld\thl, (z80_ix)\n\t\tinc\thl\n\t\tinc\thl\n\t\tld\ta, (hl)\t; MUSIC_ID\n"
        "\t\tor\ta\n\t\tjp\tm, loc_7C2D\n\n"
        "\t\tld\thl, (z80_ix)\n\t\tdec\t(hl)\t; MUSIC_CNT_NOTA\n"
        "\t\tret\tnz\n", 1)
    #     bit 7,(ix+MUSIC_ID) / bit 6,(ix+MUSIC_ID): HL (music data ptr) is live -
    #     swap it away, read the ID, AND with the mask (flags set as bit would).
    # bit n,(ix+ID) must PRESERVE A (the following and 0F0h parses the melody byte
    # held in A!): stash A in il_a, test the bit, reload A - LD does not touch
    # flags, so the AND result survives to the branch.
    src = src.replace(
        "\t\tbit\t7, (ix+MUSIC_ID)\n\t\tjp\tnz, setNote\n",
        "\t\tld\t(il_a), a\n"
        "\t\tex\tde, hl\n\t\tld\thl, (z80_ix)\n\t\tinc\thl\n\t\tinc\thl\n"
        "\t\tld\ta, (hl)\n\t\tex\tde, hl\n\t\tand\t80h\n"
        "\t\tld\ta, (il_a)\n"
        "\t\tjp\tnz, setNote\n", 1)
    src = src.replace(
        "\t\tbit\t6, (ix+MUSIC_ID)\n\t\tjr\tz, loc_7BF7\n",
        "\t\tld\t(il_a), a\n"
        "\t\tex\tde, hl\n\t\tld\thl, (z80_ix)\n\t\tinc\thl\n\t\tinc\thl\n"
        "\t\tld\ta, (hl)\n\t\tex\tde, hl\n\t\tand\t40h\n"
        "\t\tld\ta, (il_a)\n"
        "\t\tjr\tz, loc_7BF7\n", 1)
    # 5i) invierteByte: bit-reverse via a page-aligned LUT (the rr c/rla/djnz loop
    #     translated to ~45 i8080 instructions and burned 366 instr/heavy-tick in
    #     the sprite mirroring path).
    src = src.replace(
        "invierteByte:\n\t\tpush\tbc\n\t\tld\tc, a\n\t\tld\tb, 8\n\n"
        "invierteByte2:\n\t\trr\tc\n\t\trla\n\t\tdjnz\tinvierteByte2\n\t\tpop\tbc\n\t\tret\n",
        "invierteByte:\n\t\tpush\thl\n"
        "\t\tld\th, vec_revtab>>8\n\t\tld\tl, a\n\t\tld\ta, (hl)\n"
        "\t\tpop\thl\n\t\tret\n", 1)
    # 5i-nat) СТАДИЯ 6 (_NATVDP): нативный InviertePatron — читает байт паттерна из pat-кэша
    # (fold+pat_base, как rv_patn), бит-реверсит через vec_revtab LUT, пишет в pat-кэш dst
    # (vec_pat_wr), БЕЗ RDVRM/WRTVRM/vec_vram_write. HL=src VDP addr, DE=dst VDP addr; оба
    # СОХРАНЯЮТСЯ (FlipPatrones делает inc hl/inc de). BC сохранён (B = счётчик flipPatron4).
    # Клоббер: A. Кэш-эффект байт-в-байт как WRTVRM->vw_wcol (минус re-blit — загрузка ДО отрисовки).
    if _NATVDP:
        src = src.replace(
            "InviertePatron:\n\t\tcall\tRDVRM\n\t\tcall\tinvierteByte\n"
            "\t\tex\tde, hl\n\t\tcall\tWRTVRM\n\t\tex\tde, hl\n\t\tret\n",
            "InviertePatron:\n"
            "\t\tpush\tbc\n\t\tpush\tde\n\t\tpush\thl\n"           # save BC, dst, src
            "\t\tld\ta, h\n\t\tand\t7\n\t\tld\th, a\n"            # fold src bank
            "\t\tcall\tpat_base\n\t\tadd\thl, de\n"               # HL = phys src (DE=srcbase)
            "\t\tld\ta, (hl)\n"                                   # A = байт паттерна src
            "\t\tld\th, vec_revtab>>8\n\t\tld\tl, a\n\t\tld\ta, (hl)\n"  # A = реверс
            "\t\tpop\thl\n\t\tld\tb, a\n"                         # HL=src; B = реверс-байт
            "\t\tpop\tde\n"                                       # DE = dst
            "\t\tpush\thl\n\t\tpush\tde\n"                        # save src, dst
            "\t\tld\ta, d\n\t\tand\t7\n\t\tld\th, a\n\t\tld\tl, e\n"  # HL = folded dst addr
            "\t\tcall\tpat_base\n\t\tadd\thl, de\n"               # HL = phys dst
            "\t\tld\ta, b\n\t\tld\t(hl), a\n"                     # запись реверс-байта
            "\t\tpop\tde\n\t\tpop\thl\n\t\tpop\tbc\n\t\tret\n",   # DE=dst, HL=src, BC restored
            1)
        # drawLogoRow: МЁРТВ (0 поп.; dibujaLogo начинается с jp vec_konami_logo). Единственная
        # оставшаяся ссылка на WRTVRM. Под _NATVDP (диспетчер снесён) стабим тело в ret, чтобы
        # WRTVRM имел 0 ссылок и метка убиралась без undefined. 3 мёртвых вызывателя зовут ret.
        src = src.replace(
            "drawLogoRow:\n\t\tpush\thl\n\ndrawLogoRow2:\n\t\tcall\tWRTVRM\n"
            "\t\tinc\thl\n\t\tinc\ta\n\t\tdjnz\tdrawLogoRow2\n\t\tpop\tde\n"
            "\t\tld\thl, 20h\n\t\tadd\thl, de\t\t; Siguiente fila del logo\n\t\tret\n",
            "drawLogoRow:\t\t; Stage6: dead soft-VDP logo drawer stubbed to ret\n"
            "\t\tret\n",
            1)
    # 5j) Inline ADD_A_HL (HL+=A; A=low(HL); ret nc/inc h) into its HOT callers to
    #     shed the ~27-cy call/ret per invocation. Body inlined:
    #        add a,l / ld l,a / jp nc,<uniq> / inc h / <uniq>:
    #     Contract preserved: A=low(HL), HL=HL+A, flags from add a,l/inc h. Where
    #     the caller follows with ld a,(hl) the net effect is identical.
    src = src.replace(
        "getIndexHL_A:\n\t\tcall\tADD_A_HL\n"
        "\t\tld\ta, (hl)\n\t\tinc\thl\n\t\tld\th, (hl)\n\t\tld\tl, a\n\t\tret\n",
        "getIndexHL_A:\n"
        "\t\tadd\ta, l\n\t\tld\tl, a\n\t\tjp\tnc, vec_aah_hla\n\t\tinc\th\n"
        "vec_aah_hla:\n"
        "\t\tld\ta, (hl)\n\t\tinc\thl\n\t\tld\th, (hl)\n\t\tld\tl, a\n\t\tret\n", 1)
    src = src.replace(
        "getIndexX4_masB:\n\t\tadd\ta, a\n\t\tadd\ta, a\n\t\tadd\ta, b\n"
        "\t\tcall\tADD_A_HL\n\t\tld\ta, (hl)\n\t\tret\n",
        "getIndexX4_masB:\n\t\tadd\ta, a\n\t\tadd\ta, a\n\t\tadd\ta, b\n"
        "\t\tadd\ta, l\n\t\tld\tl, a\n\t\tjp\tnc, vec_aah_x4\n\t\tinc\th\n"
        "vec_aah_x4:\n\t\tld\ta, (hl)\n\t\tret\n", 1)
    src = src.replace(
        "\t\tsla\tb\n\t\tadd\ta, b\n\t\tcall\tADD_A_HL\n\t\tld\ta, (hl)\n\t\tret\n",
        "\t\tsla\tb\n\t\tadd\ta, b\n"
        "\t\tadd\ta, l\n\t\tld\tl, a\n\t\tjp\tnc, vec_aah_x7\n\t\tinc\th\n"
        "vec_aah_x7:\n\t\tld\ta, (hl)\n\t\tret\n", 1)

    # 5k) SHIFT-опт getHL_Ax7 (A*7 = A*8-A, без il_a-спилла). ВЫПОЛНЯЕТСЯ ПОСЛЕ 5j:
    # 5j инлайнит call ADD_A_HL (не трогая sla), этот блок заменяет sla-цепочку.
    _ax7_old = ("\t\tsla\tb\n\t\tadd\ta, b\n\t\tsla\tb\n\t\tadd\ta, b\n")
    _ax7_new = ("\t\tadd\ta, a\n\t\tadd\ta, a\n\t\tadd\ta, a\n\t\tsub\tb\t\t"
                "; A*7 = A*8-A (native i8080, no il_a spill)\n")
    assert _ax7_old in src, "getHL_Ax7 shape changed - shift opt not applied"
    src = src.replace(_ax7_old, _ax7_new, 1)

    # 5l) SHIFT-опт getMapOff2 (HL>>3 = 32*H + L>>3, регистровое, без il_a-спилла).
    _mo2_old = ("\t\tld\ta, l\n\t\tpop\tbc\n"
                "\t\tsrl\th\n\t\trra\n\t\tsrl\th\n\t\trra\n\t\tsrl\th\n\t\trra\n"
                "\t\tld\tl, a\t\t; Divide HL entre 8 para ajustar a patrones\n")
    _mo2_new = ("\t\tpop\tbc\n"
                "\t\tld\ta, l\n\t\trrca\n\t\trrca\n\t\trrca\n\t\tand\t1Fh\n"
                "\t\tld\tl, a\n"
                "\t\tld\ta, h\n\t\trrca\n\t\trrca\n\t\trrca\n\t\tld\th, a\n"
                "\t\tand\t0E0h\n\t\tor\tl\n\t\tld\tl, a\n"
                "\t\tld\ta, h\n\t\tand\t1Fh\n\t\tld\th, a\t\t"
                "; HL := HL >> 3 (native i8080, 32*H+L/8, no il_a spill)\n")
    assert _mo2_old in src, "getMapOff2 shape changed - shift opt not applied"
    src = src.replace(_mo2_old, _mo2_new, 1)
    # 5s3) loc_7C2D (SFX volume path, every frame per active SFX): fuse all 7 ix
    #     macros into direct cell arithmetic. HL is dead on entry (jp m from the
    #     fused head); decVolume falls into setVolume with H=volume as before.
    src = src.replace(
        "loc_7C2D:\n"
        "\t\tdec\t(ix+MUSIC_CNT_NOTA) ; Decrementa duracion contador nota\n"
        "\t\tjp\tz, nextNote\t; Fin nota\n\n"
        "\t\tdec\t(ix+8)\n"
        "\t\tld\ta, (ix+8)\n"
        "\t\tcp\t(ix+MUSIC_CNT_NOTA)\n"
        "\t\tjr\tnz, loc_7C47\n\n"
        "\t\tld\te, a\n"
        "\t\tld\ta, (ix+0Dh)\n"
        "\t\tcp\te\n"
        "\t\tld\ta, e\n"
        "\t\tjr\tnc, decVolume\n"
        "\t\tret\n\n"
        "loc_7C47:\n"
        "\t\tdec\t(ix+8)\n\n"
        "decVolume:\n"
        "\t\tld\ta, (ix+MUSIC_VOLUME)\n"
        "\t\tdec\ta\n"
        "\t\tret\tm\t\t; El volumen era 0\n"
        "\t\tld\t(ix+MUSIC_VOLUME), a\n"
        "\t\tld\th, a\n",
        "loc_7C2D:\n"
        "\t\tld\thl, (z80_ix)\n"
        "\t\tdec\t(hl)\t\t; MUSIC_CNT_NOTA\n"
        "\t\tjp\tz, nextNote\t; Fin nota\n"
        "\t\tld\ta, l\n\t\tadd\ta, 8\n\t\tld\tl, a\n\t\tld\ta, h\n\t\tadc\ta, 0\n\t\tld\th, a\n"
        "\t\tdec\t(hl)\t\t; (ix+8)\n"
        "\t\tld\ta, (hl)\n"
        "\t\tpush\thl\n"
        "\t\tld\thl, (z80_ix)\n\t\tcp\t(hl)\t; vs CNT_NOTA\n"
        "\t\tpop\thl\n"
        "\t\tjr\tnz, loc_7C47\n"
        "\t\tld\te, a\n"
        "\t\tld\ta, l\n\t\tadd\ta, 5\n\t\tld\tl, a\n\t\tld\ta, h\n\t\tadc\ta, 0\n\t\tld\th, a\n"
        "\t\tld\ta, (hl)\t\t; (ix+0Dh)\n"
        "\t\tcp\te\n"
        "\t\tld\ta, e\n"
        "\t\tjr\tnc, decVolume\n"
        "\t\tret\n\n"
        "loc_7C47:\n"
        "\t\tdec\t(hl)\t\t; (ix+8), HL still points there\n\n"
        "decVolume:\n"
        "\t\tld\thl, (z80_ix)\n"
        "\t\tld\ta, l\n\t\tadd\ta, 7\n\t\tld\tl, a\n\t\tld\ta, h\n\t\tadc\ta, 0\n\t\tld\th, a\n"
        "\t\tld\ta, (hl)\t\t; MUSIC_VOLUME\n"
        "\t\tdec\ta\n"
        "\t\tret\tm\t\t; El volumen era 0\n"
        "\t\tld\t(hl), a\n"
        "\t\tld\th, a\n", 1)
    # 5h) HideSprites: the original fills the MSX VDP SAT with the 0xC3 stop-marker
    #     byte-by-byte - it exists only to hide sprites on the (now retired) soft-
    #     VDP path. Задача 2.4: vec_nat_sprites reads sprAttrib/enemyAttrib RAM
    #     directly (never the VDP SAT shadow), and the RAM-side hide is done by
    #     hideSprAttrib (writes Y=0xE1 straight into sprAttrib/enemyAttrib) - always
    #     called right after HideSprites at every call site. So HideSprites itself
    #     has nothing left to do; make it a no-op (matches its own `xor a` return).
    src = src.replace(
        "HideSprites:\n"
        "\t\tld\thl, 3B00h\t; Sprite attribute area\n"
        "\t\tld\tbc, 80h\t\t; Numero de bytes a rellenar (32 sprites * 4 bytes)\n"
        "\t\tld\ta, 0C3h\t\t; Valor\ta rellenar\n"
        "\t\tcall\tsetFillVRAM\n"
        "\t\txor\ta\n"
        "\t\tret\n",
        "HideSprites:\n"
        # Фикс 2026-07-12: спрайты XOR-рисуются в plane 3 и стираются ТОЛЬКО следующим
        # vec_nat_sprites, который в негеймплее НЕ вызывается -> при выходе из геймплея
        # (clearScreen, scroll) замороженные мумии/герой остаются в p3 поверх лого/меню.
        # HideSprites (idiom «убрать все спрайты», вызывается на этих переходах) теперь
        # чистит p2+p3 (0xC000-0xFFFF) + сбрасывает prev-снапшот в скрытый (Y=0xD0) -> следующий
        # erase = no-op, а draw в геймплее восстановит живые спрайты (само-heal). i8080-safe
        # (без ldir): цикл до wrap H=0. Вызывается на переходах, не покадрово -> дёшево.
        # Фаза A+: спрайты в p2 (одежда серая) И p3 (кожа красная) -> чистим ОБЕ, иначе после
        # смерти/перехода p2-слой (одежда) не стирается (заказчик: «один слой не стирается»).
        # p2 теперь чистая спрайт-плоскость (scratch/mixbuf уехали в low-RAM).
        # Фаза A+: clear p2+p3 (16К) с UNROLL x16 (~13т/байт против 31т у 1x-цикла) — вдвое
        # меньше лага при смерти/переходе (заказчик: «подтормаживает при стирании лабиринта»).
        # БЕЗ SP-hijack/di/ei (те ломали раннюю логику: HideSprites зовётся при старте, ei
        # рассинхронил прерывания с MSX-эталоном). Семантика = MSX (ld(hl),0), только развёрнуто.
        # S2 (_8COLOR): 8-цв кэши живут в p3 (0xE000+) => HideSprites НЕ должен чистить
        # p3 (иначе стёр бы spr_buf/mir/maze/font на смене комнаты — замер: 6.5К мусора).
        # НО простое сужение (clear 8К p2 вместо 16К) МЕНЯЕТ длительность => сдвиг фазы
        # анимации на 1 кадр (виден только на hold=500, элемент у сундука мерцает и в базе).
        # ЦИКЛО-НЕЙТРАЛЬНО: чистим p2 (0xC000-0xDFFF) ДВАЖДЫ = те же 1024 итерации, что база
        # чистила 0xC000-0xFFFF (16К). CMP E (E=0xE0) = 4т = ORA A базы => такт-в-такт тело
        # цикла. p3-кэш НЕ тронут (обе развёртки в p2, идемпотентный ноль). Спрайты в 8-цв
        # идут в p1/p2 (нож перенаправлен в p2), p3 не рисуется => чистить p3 не нужно.
        + (("\t\tld\te, 0E0h\n"
            "\t\tld\thl, 0C000h\n"
            "hsClrP3:\n" + "\t\tld\t(hl), 0\n\t\tinc\thl\n" * 16 +
            "\t\tld\ta, h\n\t\tcp\te\n\t\tjp\tnz, hsClrP3\n"
            "\t\tld\thl, 0C000h\n"
            "hsClrP3b:\n" + "\t\tld\t(hl), 0\n\t\tinc\thl\n" * 16 +
            "\t\tld\ta, h\n\t\tcp\te\n\t\tjp\tnz, hsClrP3b\n")
           if (_8COLOR and not _os_pv.environ.get('KV_S_HIDEFULL')) else
           ("\t\tld\thl, 0C000h\n"
            "hsClrP3:\n" + "\t\tld\t(hl), 0\n\t\tinc\thl\n" * 16 +
            "\t\tld\ta, h\n\t\tor\ta\n\t\tjp\tnz, hsClrP3\n")) +
        # _8C_RLIST: ИНВАЛИДАЦИЯ save-under слотов на смене комнаты. Фаза S сузила очистку
        # HideSprites до p2 (0xC000-0xDFFF), чтобы СОХРАНИТЬ кэши в p3 (0xE600+). Но буфер
        # save-under (vec_spr_save @0xE000-0xE53F) ХРАНИТ фон СТАРОЙ комнаты (позиции=экранные
        # координаты, валидны лишь для текущей раскладки); если слоты остаются valid после
        # перехода, первый пост-transition кадр вызовет vec_su_restore (restore-до-save) и
        # ВПЕЧАТАЕТ старый фон в НОВУЮ комнату (фантом). Зануляем ТОЛЬКО заголовки/данные
        # save-under (0xE000-0xE5FF, valid=0=пусто), НЕ трогая кэши Фазы S (0xE600+). Дёшево
        # (вызов на переходах, не покадрово). Совпадает с прежним инвариантом (кэш-коммент:
        # "HideSprites => слоты инвалидируются на переходе"), который Фаза S нарушила.
        (("\t\tld\thl, vec_spr_save\n"
          "hsClrSU:\n\t\tld\t(hl), 0\n\t\tinc\thl\n\t\tld\ta, h\n\t\tcp\t%s\n\t\tjp\tnz, hsClrSU\n" % ("0EBh" if _8C_AURA else "0E6h"))
         if _8C_RLIST else "") +
        "\t\tld\thl, vec_nsp_prev\n"
        "\t\tld\tb, 19\n"
        "hsRstPrev:\n"
        "\t\tld\t(hl), 0D0h\n"
        "\t\tinc\thl\n"
        "\t\tinc\thl\n"
        "\t\tinc\thl\n"
        "\t\tdec\tb\n"
        "\t\tjp\tnz, hsRstPrev\n"
        "\t\txor\ta\n"
        "\t\tret\n", 1)
    # 5c2) fillVRAM hot loop: the original keeps the fill value in AF' - on the
    #     i8080 target every `ex af,af'` becomes a ~10-instruction RAM-cell macro,
    #     so the per-byte loop paid TWO of them per write (plus vec_vram_write).
    #     Keep the value in a RAM cell instead: ~1.5x faster on ALL fills. The
    #     original returns with A = fill value (final ex af,af') - replicated.
    src = src.replace(
        "fillVRAM:\n\t\tex\taf, af'\n\nVRAM_write2:\n\t\tex\taf, af'\n"
        "\t\tcall\tvec_vram_write\t; Vector: write to VRAM shadow / blit tile\n"
        "\t\tex\taf, af'\n"
        "\t\tdec\tbc\n\t\tld\ta, b\n\t\tor\tc\n\t\tjr\tnz, VRAM_write2\n"
        "\t\tex\taf, af'\n\t\tret",
        "fillVRAM:\n\t\tld\t(vec_fill_val), a\n"
        "\t\tld\ta, b\n\t\tor\ta\n\t\tjp\tnz, VRAM_write2\n"    # big -> slow
        "\t\tld\ta, c\n\t\tor\ta\n\t\tjp\tz, VRAM_write2\n"     # BC=0 (=65536) -> slow
        "\t\tcp\t41h\n\t\tjp\tnc, VRAM_write2\n"                    # >16 -> slow
        "\t\tld\ta, (vec_vdp_ptr+1)\n\t\tand\t3Fh\n\t\tcp\t18h\n\t\tjp\tnc, VRAM_write2\n"
        "\t\tjp\tvec_fill_col\n"                                        # small colour fill -> fast
        # СТАДИЯ 6 (_NATVDP): slow-path VRAM_write2 льёт ПРЯМО в кэши через vec_cache_wr (адрес
        # в HL, а не через vec_vdp_ptr-латч/vec_vram_write). Иначе (OFF/откат) — soft-VDP диспетчер.
        + ("VRAM_write2:\n"
           "\t\tld\thl, (vec_vdp_ptr)\n"
           "vw2_nl:\n"
           "\t\tld\ta, (vec_fill_val)\n\t\tcall\tvec_cache_wr\n\t\tinc\thl\n"
           "\t\tdec\tbc\n\t\tld\ta, b\n\t\tor\tc\n\t\tjp\tnz, vw2_nl\n"
           "\t\tld\t(vec_vdp_ptr), hl\n"
           "\t\tld\ta, (vec_fill_val)\n\t\tret"
           if _NATVDP else
           "VRAM_write2:\n"
           "\t\tld\ta, (vec_fill_val)\n\t\tcall\tvec_vram_write\n"
           "\t\tdec\tbc\n\t\tld\ta, b\n\t\tor\tc\n\t\tjr\tnz, VRAM_write2\n"
           "\t\tld\ta, (vec_fill_val)\n\t\tret"), 1)

    # 5d) i8080 idle: the game's main loop is `ei` then `dummyLoop: jr $` (spin,
    #     letting the vblank interrupt run all game logic via H_TIMI/tickMain). On
    #     the i8080 (vector06js) EI has a 1-instruction delay and a tight `jr $`
    #     self-loop deadlocks interrupt latching -> the ISR never fires -> the game
    #     never advances. HALT properly parks the CPU until the next interrupt
    #     (vector06js checkInterrupt wakes it), so use ei/hlt idle instead.
    src = src.replace("dummyLoop:\n\t\tjr\t$",
                      "dummyLoop:\n\t\tei\n"      # Фаза B: dirty-drain снят -> чистый idle
                      "\t\thalt\n\t\tjr\tdummyLoop", 1)

    # 5e) DEFEAT anti-copy self-modification. The game (designed for cartridge ROM)
    #     WRITES to its own code to break itself if the writes take effect (i.e. it
    #     is running from RAM). On the Vector everything is RAM, so those writes
    #     actually corrupt the code: ReadKeys_AC clobbers KonamiLogo2 (dec b/jp nz ->
    #     pop hl/ret, freezing the logo at SubStatus 2) and VRAM_writeAC rewrites the
    #     jump target inside copyProtect_ (breaks the KING'S VALLEY menu). On ROM
    #     these writes are no-ops, so stripping them == the intended cartridge path.
    src = re.sub(
        r'ReadKeys_AC:\s*\n'
        r'\s*ld\s+hl,\s*KonamiLogo2[^\n]*\n'
        r'\s*ld\s+a,\s*\(JumpIndex2\)[^\n]*\n'
        r'\s*ld\s+\(hl\),\s*a[^\n]*\n'
        r'\s*inc\s+hl[^\n]*\n'
        r'\s*ld\s+\(hl\),\s*0C9h[^\n]*\n',
        'ReadKeys_AC:\t\t; anti-copy self-mod stripped (runs from RAM on Vector)\n',
        src, count=1, flags=re.I)
    src = re.sub(
        r'(VRAM_writeAC:\s*\n)\s*ld\s+\(copyProtect_\+1\),\s*de[^\n]*\n',
        r'\1\t\t; anti-copy self-mod stripped\n',
        src, count=1, flags=re.I)

    # 5f) SIZE the game stack. History: i8080 translation uses more stack than native
    #     Z80 (exx/ex-af/ix spill via push/pop; VRAM writes call vec_vram_write which
    #     pushes af/bc/de/hl). The OLD soft-VDP drawRoom (GS=4) reached the region
    #     bottom and a vblank ISR (9 shadow-reg pushes) overflowed into variables ->
    #     GameStatus derail; fixed by growing 2EDh->5EDh (1517B).
    #     Фаза P/A+ (2026-07-14): drawRoom заменён нативным vec_nat_room -> тот глубокий
    #     soft-VDP путь ИСЧЕЗ. Замер реальной max-глубины (tmp/stack_depth.js, разнообразный
    #     прогон boot/титул/GS4-загрузка/движение/лестницы/копка/смерть/переход, включая ISR)
    #     = 120Б (глубочайшая точка WRTPSG, звук из тика). Урезаем 5EDh->400h (1024Б, 8.5x
    #     запас, > MSX-оригинала 749Б) -> освобождает 493Б @0x6F13-0x7100 под A+ фон-кэш.
    #     NB (2026-07-15): пробовал усадку до 200h (512Б) по аудиту памяти — сдвигает
    #     MapaRAM вниз, но ЛОМАЕТ logic_gate (все game-vars расходятся: vec-билд отстаёт по
    #     стадии на том же тике; MapaRAM/boot-fill раскладка меняется). Откачено. Усадка
    #     стека требует согласовать boot-fill/MapaRAM раскладку в ОБОИХ таргетах — отложено.
    src = re.sub(r'(stackArea:\s*#\s*)2edh', r'\g<1>400h', src, count=1, flags=re.I)

    # 5g) KONAMI LOGO -> direct bitmap render (vec_konami_logo/vec_konami_text above).
    #   (a) loadKonamiLogo: keep gameLogoCnt/CoordKonamiLogo init but DO NOT unpack the
    #       Konami patterns into the VDP (frees pattern slots 0x60-0x7a -> no conflict
    #       with the shifted KV-title 0x40-0x78). Instead zero the blank-marker tile
    #       0x7b in pattern-shadow (see module header). Replace from the GFX unpack
    #       through the colour fill with the marker-zeroing loop + ret.
    n = len(src)
    src = re.sub(
        r'\t\tld\tde, GFX_KonamiLogo\n.*?jp\tfillVRAM3Bank[^\n]*\n',
        "\t\t; Vector: Konami patterns NOT loaded into the VDP (direct bitmap render frees\n"
        "\t\t; 0x60-0x7a). The packed logo is STREAM-decoded straight to the framebuffer on\n"
        "\t\t; each rise frame (vec_konami_logo -> vec_kl_next); nothing to preload here.\n"
        "\t\tld\thl, 0CCD8h\t; pattern_shadow[0x7b*8] = blank marker tile\n"
        "\t\txor\ta\n\t\tld\tb, 8\n"
        "vec_klz:\n\t\tld\t(hl), a\n\t\tinc\thl\n\t\tdec\tb\n\t\tjp\tnz, vec_klz\n"
        "\t\tret\n",
        src, count=1, flags=re.S)
    assert len(src) != n, "loadKonamiLogo Konami-pattern block not found"
    #   (b) dibujaLogo -> native riser (label redirect; original body becomes dead).
    assert "dibujaLogo:\n" in src, "dibujaLogo label not found"
    src = src.replace("dibujaLogo:\n", "dibujaLogo:\n\t\tjp\tvec_konami_logo\n", 1)
    #   (d) 8-ЦВ KONAMI-ФОН: оригинал MSX показывает лого Konami на СИНЕМ backdrop (VDP_InitData
    #       reg7=0E4h=4), затем setColor (reg7=0E0h=0) гасит фон в ЧЁРНЫЙ перед титулом. Повторяем
    #       на Вектор палитрой idx0: loadKonamiLogo (один раз, НЕ ISR) ставит idx0/1=свет-син 0D2h;
    #       setColor (переход Konami->титул И вход в геймплей, msx:376/1771, НЕ per-frame) -> чёрный.
    #       vec_setpal_a на входе в этап всё равно перельёт idx0 из vec_pal (=0) => геймплей чёрн.
    #       Механизм: ПОЛНАЯ 16-слот загрузка (vsp_load) — тот же путь, что рабочий vec_setpal_a
    #       (латч Вектора требует полного паттерна записи; частичный idx0-write латчился в случайные
    #       слоты по растру -> чёрный экран). Konami-таблица = vec_pal с idx0=0D2 (фон свет-синий).
    if _8COLOR:
        assert "loadKonamiLogo:\n" in src, "loadKonamiLogo label not found"
        _kpal = lambda tab: ("\t\tpush\taf\n\t\tpush\tde\n\t\tpush\thl\n"
                             "\t\tld\thl, %s+15\n\t\tcall\tvsp_load\n"
                             "\t\tpop\thl\n\t\tpop\tde\n\t\tpop\taf\n" % tab)
        src = src.replace("loadKonamiLogo:\n",
                          "loadKonamiLogo:\n" + _kpal("vec_pal_konami") + "\t\t; 8col: Konami bg light-blue (reg-transparent)\n", 1)
        assert "setColor:\n" in src, "setColor label not found"
        src = src.replace("setColor:\n",
                          "setColor:\n" + _kpal("vec_pal") + "\t\t; 8col: backdrop idx0 -> black (title/menu, reg-transparent)\n", 1)
    #   (c) SOFTWARE + Konami underline: native (font tiles + direct bitmap) instead of
    #       the soft-VDP unpackGFXset name path.
    assert "\t\tld\tde, TXT_Sofware\n\t\tcall\tunpackGFXset" in src, "TXT_Sofware call not found"
    src = src.replace(
        "\t\tld\tde, TXT_Sofware\n\t\tcall\tunpackGFXset",
        "\t\tcall\tvec_konami_text", 1)

    # 6-FONT) ЗАДАЧА#1 СТРИМ ШРИФТА: (a) НЕ декодировать GFX_Font в p3 (loadFont пишет паттерн в
    # отображаемую p3 @0xED60 => призрак на карте); (b) эмитить декодированный шрифт в ROM-таблицу
    # vec_font_rom, откуда vbt_core читает глиф напрямую (pat_font_base -> ROM, см. equ). Цвет-
    # таблицу шрифта (fillVRAM3Bank после декода) ОСТАВЛЯЕМ — она задаёт white-флаг тайлов HUD.
    # vec_font_rom эмитится ПЕРЕД _VECTOR_RUNTIME (где стоит `pat_font_base equ vec_font_rom-080h`),
    # чтобы метка была известна как backward-ссылка (иначе sjasm: forward-equ != в pass2).
    _font_prefix = ""
    if _FONTSTREAM:
        _lf_old = ("loadFont:\n\t\tld\tde, GFX_Font\n\t\tld\thl, 2080h"
                   "\t; Pattern generator table addres (pattern 16)\n\t\tcall\tUnpackPatterns\n")
        assert src.count(_lf_old) == 1, "loadFont shape changed: %d" % src.count(_lf_old)
        # шрифт теперь в ROM => пропускаем декод в p3, но сохраняем цвет-заливку ниже
        src = src.replace(_lf_old, "loadFont:\t\t; 8col: font streamed from ROM (vec_font_rom), no p3 decode\n", 1)
        _font_bytes = _decode_gfx_font(src)
        _font_prefix = "vec_font_rom:\t; TASK1: decoded GFX_Font (RLE) in ROM, 48 tiles 0x10-0x3f x8=384B\n"
        for r in range(0, 384, 16):
            _font_prefix += "\t\tdb\t" + ",".join("0%02Xh" % b for b in _font_bytes[r:r + 16]) + "\n"

    # 6) place the Vector runtime (with the font ROM table prepended) just before the MAP block
    src = src.replace("\t\tMAP     " + _VARBASE, _font_prefix + _VECTOR_RUNTIME + "\n\t\tMAP     " + _VARBASE, 1)

    # 6-MIR) MIRROR-CACHE (RENDER-опт): left-facing спрайты (hero/momia) РАНЬШЕ зеркалились
    # НА ЛЕТУ в vec_nsx (call vnsx_rev16 на 2×16Б/спрайт — профиль: MIRROR = ~17% кадра в пике
    # 4 мумии влево). Теперь зеркала ПРЕД-считаны ОДИН РАЗ после vec_spr_load (смена анимации)
    # в vec_spr_buf_mir; vec_nsx для зеркал читает готовый буфер ВМЕСТО vnsx_rev16.
    # ПИКСЕЛЬ-ИДЕНТИЧНО: mir[off+0..15]=rev(buf[off+16..31]); mir[off+16..31]=rev(buf[off+0..15])
    # — ровно то, что vnsx_rev16 давал на лету (LUT vec_revtab тот же). Откат: env KV_NO_MIRCACHE.
    _MIRON = not _osg.environ.get('KV_NO_MIRCACHE')
    if _MIRON:
        # (a) резерв 416Б под пред-зеркалённый hero/momia кэш. Off диапазон зеркал: base_pat
        #     (pat-0x60)&0xFC ∈ [0,0x30] -> off=base_pat*8 ∈ [0,0x180], блок 0x180..0x19F =>
        #     нужно 0x1A0=416Б. Размещён 0x63F8..0x6597 ВПЛОТНУЮ под vec_spr_buf(0x6598); код
        #     кончается 0x62A3 => зазор 0x62A4..0x63F7 (340Б) под рост кода. НЕ коллизия.
        assert _SPRBUF_EQU in src, "vec_spr_buf equ shape changed"
        src = src.replace(
            _SPRBUF_EQU,
            _SPRMIR_EQU + "\t; pre-mirrored hero/momia cache (416B); base 0x63F8; _8COLOR: p3 0xE600\n"
            + _SPRBUF_EQU, 1)
        # (b) vec_nsx: для зеркала (B=1) читать из vec_spr_buf_mir и ГАСИТЬ флаг зеркала (B=0),
        #     чтобы обе половины пошли ОБЫЧНЫМ путём (без on-the-fly vnsx_rev16). Кэш уже
        #     содержит swap-half+bit-reverse, поэтому normal-path над ним == старый mirror-path.
        _nsx_old = "\tld\tde, vec_spr_buf\n\tadd\thl, de\n\tld\t(vnsx_pat), hl"
        assert src.count(_nsx_old) == 1, "vec_nsx base-select shape changed: %d" % src.count(_nsx_old)
        src = src.replace(
            _nsx_old,
            "\tld\tde, vec_spr_buf\n"
            "\tld\ta, b\n\tor\ta\n\tjp\tz, vnsx_nb\t; B=0 -> normal (vec_spr_buf)\n"
            "\tld\tde, vec_spr_buf_mir\t; mirror -> pre-mirrored cache\n"
            "\tld\tb, 0\t; clear flag: both halves take normal path over mir buffer\n"
            "vnsx_nb:\n\tadd\thl, de\n\tld\t(vnsx_pat), hl", 1)
        # (c) routine vec_spr_mkmir: пройти hero/momia (13 блоков ×32Б) в vec_spr_buf, зеркаля
        #     каждый в vec_spr_buf_mir тем же преобразованием, что vnsx_rev16 (LUT vec_revtab).
        #     Размещён в хвосте кода (перед MAP, рядом с ldir-хелперами) — 0 взаимодействия с
        #     ALIGN 256. Клоббер A/BC/DE/HL (зовётся сразу после vec_spr_load, тот же контракт).
        _mkmir = (
            "\n; ===== MIRROR-CACHE builder (RENDER-opt): pre-mirror hero/momia sprites ====="
            "\n; vec_spr_buf(off) -> vec_spr_buf_mir(off): swap 16B halves + bit-reverse (LUT)."
            "\n; Once after vec_spr_load (loadAnimation). 13 blocks = hero+momia (off 0..0x180)."
            "\nvec_spr_mkmir:\n"
            "\tld\thl, vec_spr_buf\n"
            "\tld\tde, vec_spr_buf_mir\n"
            "\tld\tb, 13\n"
            "smk_blk:\n"
            "\tpush\thl\t\t; save src block base\n"
            "\tld\ta, l\n\tadd\ta, 16\n\tld\tl, a\n\tld\ta, h\n\tadc\ta, 0\n\tld\th, a\t; HL = src+16\n"
            "\tld\tc, 16\n"
            "smk_lo:\t\t; mir[0..15] = revtab[ src[16..31] ]\n"
            "\tld\ta, (hl)\n\tinc\thl\n"
            "\tpush\thl\n\tld\tl, a\n\tld\th, vec_revtab>>8\n\tld\ta, (hl)\n\tpop\thl\n"
            "\tld\t(de), a\n\tinc\tde\n"
            "\tdec\tc\n\tjp\tnz, smk_lo\n"
            "\tpop\thl\t\t; HL = src block base\n"
            "\tld\tc, 16\n"
            "smk_hi:\t\t; mir[16..31] = revtab[ src[0..15] ]\n"
            "\tld\ta, (hl)\n\tinc\thl\n"
            "\tpush\thl\n\tld\tl, a\n\tld\th, vec_revtab>>8\n\tld\ta, (hl)\n\tpop\thl\n"
            "\tld\t(de), a\n\tinc\tde\n"
            "\tdec\tc\n\tjp\tnz, smk_hi\n"
            "\tld\ta, l\n\tadd\ta, 16\n\tld\tl, a\n\tld\ta, h\n\tadc\ta, 0\n\tld\th, a\t; HL = src+32\n"
            "\tdec\tb\n\tjp\tnz, smk_blk\n"
            "\tret\n")
        src = src.replace("\t\tMAP     " + _VARBASE, _mkmir + "\t\tMAP     " + _VARBASE, 1)

    # 6b) Задача 2.2: setupRoom's `call drawRoom` (the ONLY call site - drawRoom itself
    #     stays in the source, unreferenced/dead, harmless) -> native vec_nat_room. The
    #     soft-VDP name-table path (drawRoom/drawRoom2/drawRoom3) is bypassed entirely
    #     for the maze; HUD (rows 0/23, written via a different path - renderMarcador/
    #     drawPyramidNumber straight into the name table) is unaffected.
    assert src.count("\t\tcall\tdrawRoom") == 1, "expected exactly one drawRoom call site"
    src = src.replace("\t\tcall\tdrawRoom", "\t\tcall\tvec_nat_room", 1)

    # 6b2) Мерцание сокровищ ТЕПЕРЬ через ПАЛИТРУ (vec_blit_brillo idx4 + vec_brillo_pal
    #      в ISR), НЕ через soft-VDP. drawBrilloGemas (msx:2235) каждый тик перезаписывает
    #      ЦВЕТ блёсток гем 0x51-0x53 @0x288 и паланки 0x5c @0x2E5 через fillVRAM3Bank ->
    #      vec_fill_col, НО гем-цвет там уже отбрасывается фильтром vec_is_gem_col (vfc_me)
    #      => 0 записей в col_shadow от гем-flash (замерено: 0 за 600 кадров). Рутину НЕ
    #      трогаем: редирект ЛЕЙБЛА в ret ломает логику на тике 614 (сдвиг кода на 1 байт
    #      + сайд-эффект desync демо; baseline расходится ровно на 824) и не нужен — трафик
    #      уже 0. Мерцание рисует палитра, drawBrilloGemas работает вхолостую (фильтр).

    # 6c) Задача 2.4: updateSprites (RAM sprAttrib/enemyAttrib -> MSX VDP SAT, 6 call
    #     sites) -> native mono-sprite renderer. Redirecting the LABEL (not each call
    #     site) means every caller's `call updateSprites` naturally lands on the stub
    #     and `ret`s back to them - same pattern as the drawRoom swap. The original
    #     body (plane-rotation flicker trick `offsetPlanoSpr` included - not needed
    #     natively) stays right after, unreferenced/dead/harmless.
    # --- ЛОГИКА-ОПТ #1: нативный getMomiaDat (behaviorally-identical) ---
    # Оригинал считает указатель momiaDat+idx*22 в АЛЬТ-банке (2×exx=656т + call
    # ADD_A_HL + sla-эмуляция + IX) = ~1318т/вызов. КРИТИЧНО: exx тут НЕ лишний —
    # он оставляет указатель в АЛЬТ-регистре DE' (и HL'=старый DE'), а код ИИ мумий
    # (nextMomia: `exx; ld h,d; ld l,e`) читает DE' как указатель мумии МЕЖДУ вызовами.
    # Нативно реплицируем ТОЧНО ВСЕ наблюдаемые эффекты через прямые записи вместо
    # свопа 3 пар. ~250т (5× быстрее). ГЕЙТ: tools/verify/logic_diff.js == 0.
    # Точная реплика (проверено побайтово vs оригинал):
    #  - x22 как оригинал (sla b == add b,b): A=22*idx, B=16*idx (НЕ 2*idx!);
    #  - ADD_A_HL: add a,l / ld l,a / (nc? : inc h) — A=low(ptr) НА ВЫХОДЕ, флаги add a,l;
    #  - alt-копирование DE'->HL' через HL+стек (НЕ через A — иначе A испорчен);
    #  - main.HL восстановлен (push/pop), main.DE не тронут (как два exx).
    _native_gmd = (
        "\ngetMomiaDat:\n"
        "\t\tld\tb, a\n\t\tsla\tb\n\t\tld\ta, b\n\t\tsla\tb\n\t\tadd\ta, b\n"
        "\t\tsla\tb\n\t\tsla\tb\n\t\tadd\ta, b\t; A=22*idx B=16*idx (== orig, sla->translate)\n"
        "\t\tpush\thl\n\t\tld\thl, momiaDat\n"
        "\t\tadd\ta, l\n\t\tld\tl, a\n\t\tjp\tnc, gmd_nc\n\t\tinc\th\n"  # ADD_A_HL: A=low(ptr), флаги
        "gmd_nc:\n"
        "\t\tld\t(pMomiaProceso), hl\n\t\tpush\thl\n\t\tpop\tix\t; IX = ptr\n"
        # replicate ex-de-hl in alt-bank: HL'=old DE'; DE'=ptr. Через HL+стек, A не трогаем.
        "\t\tpush\thl\n\t\tld\thl, (z80_de_alt)\n\t\tld\t(z80_hl_alt), hl\n"
        # exx-трансляция оставляет il_tmp2 = ВХОДНОЙ z80_de_alt (old DE'), HL сейчас = он
        "\t\tld\t(il_tmp2), hl\n"
        "\t\tpop\thl\n\t\tld\t(z80_de_alt), hl\n"
        "\t\tpop\thl\n"
        # exx-трансляция оставляет il_tmp = ВХОДНОЙ main.HL — код между вызовами
        # читает эти scratch-ячейки без записи (баг-совместимость эмуляции exx).
        "\t\tld\t(il_tmp), hl\n"
        "\t\tret")
    _n0 = src.count("\ngetMomiaDat:")
    assert _n0 == 1, f"expected 1 getMomiaDat label, got {_n0}"
    src = re.sub(r'\ngetMomiaDat:.*?\n\t\tret', _native_gmd, src, count=1, flags=re.DOTALL)

    assert src.count("\nupdateSprites:\n") == 1, "expected exactly one updateSprites label"
    # updateSprites -> нативный спрайт-рендер (как в base). Flicker-fix (updateSprites
    # в no-op + рендер на старте кадра) ОТКАЧЕН: Z80-гейт доказал, что он менял
    # игровое состояние (updateSprites имеет побочный эффект на MAP). Флик — отдельно
    # через гонку луча, не через перенос updateSprites.
    # ОПТИМ 2026-07-15: не просто вставляем jp, а ВЫРЕЗАЕМ мёртвое тело updateSprites
    # (74Б, строки asm ~2157-2196: setSprAttrib2/3 + DEtoVRAMset-хвост flicker-плоскостей —
    # setSprAttrib2/3 внутренние, не зовутся извне; тело недостижимо из-за jp). Освобождает
    # ~74Б -> margin перед vec_spr_buf 0x6598 (сдвиг rot-петель ВНИЗ, дальше от буфера).
    src = re.sub(r'\nupdateSprites:\n.*?(?=\nchkScroll:)',
                 "\nupdateSprites:\n\t\tjp\tvec_nat_sprites\n",
                 src, count=1, flags=re.DOTALL)

    # 7) ЭВАКУАЦИЯ p2 (шаг: динамика лабиринта): drawTile теперь рисует НАПРЯМУЮ в
    #    framebuffer через vec_blit_tile (как vec_nat_room для комнаты, но для ОДНОЙ
    #    динамической клетки), минуя soft-VDP name-путь (WRTVRM->vw_name->vec_dirty_set
    #    ->vcp_cells). drawTile = ХОЛОДНЫЙ путь (нож/пико/ловушки/анимация ямы; ~1
    #    вызов/200 кадров покоя, копание/нож - событийно) -> прямой блит КАЖДЫЙ раз
    #    дёшев, dedup не нужен. Это снимает поток drawTile с dirty-очереди.
    #    Клетка: coordVRAM_DE даёт HL=0x3800+cell; col=L&31, row=(H-0x38)*8+(L>>5)
    #    (то же вычисление, что vw_name). name_shadow[cell] обновляется для когерентности
    #    (dedup name-пути честен: shadow отражает то, что на экране) - как vec_nat_room.
    #  GUARD (ТОЛЬКО row 0): row 0 = зона маркера (SCORE/HI), рисуется renderMarcador
    #    отдельным путём; drawRoom стартует с name-row 1 (0x3820), т.е. ИГРОВОЕ поле =
    #    rows 1..22 (Y>>3 = 1..22; getMapOffset: MapaRAMRoot=row-маркер лежит ДО MapaRAM,
    #    объект с Y>>3=1 -> MapaRAM row 0 -> screen name-row 1). При смене экрана
    #    background-restore может дойти до drawTile со stale MAP-указателем (Y=0,X=0,
    #    room=ProtaRoom) -> гейт проходит и тайл (0x10) сел бы в r0c0 = артефакт "01".
    #    Пропускаем ТОЛЬКО row 0 (Y>>3=0 = никогда не легитимная клетка, это MapaRAMRoot).
    #    ПРЕЖДЕ пропускались rows 0-2 (ошибочно приняты за HUD) -> кирка/нож/анимация ямы
    #    в верхних игровых рядах 1-2 НЕ стирались с экрана (латентный баг). Возвращаем NZ
    #    (как off-room) при скипе, чтобы вызыватели тоже пропустили (movKnife second-tile).
    #  DI/depth: drawTile исполняется в игровом тике (H_TIMI ISR, vec_isr_depth==1,
    #    прерывания уже off). Но некоторые вызыватели (initCuchillo) МОГУТ идти из main
    #    (setupRoom). Универсальная защита: di; force depth=1 (vbt_row держит DI сквозь
    #    SP-хайджек); restore real depth; ei ТОЛЬКО если были на depth 0 (main). vw_byte
    #    ставим ПОД DI -> нет гонки с ISR-блитом. Контракт возврата (VERSION2): Z=нарисовано.
    _dt_old = ("drawTile:\n"
               "\t\tcall\tgetLocationDE\n"
               "\t\tret\tnz\t\t; No esta en la\thabitacion visible\n"
               "\n"
               "\t\tcall\tcoordVRAM_DE\t; Pasa coordenadas en DE a direccion de\tVRAM\n"
               "\tIF\t(VERSION2)\n"
               "\t\tcall\tWRTVRM\n"
               "\t\tld\tb,1\n"
               "\t\tdec\tb\n"
               "\t\tret\n"
               "\tELSE\n"
               "\t\tjp\tWRTVRM\t\t; Escribe un dato en la\tVRAM\n"
               "\tENDIF\n")
    _dt_new = ("drawTile:\n"
               "\t\tcall\tgetLocationDE\n"
               "\t\tret\tnz\t\t; No esta en la\thabitacion visible\n"
               "\n"
               "\t\tcall\tcoordVRAM_DE\t; HL = 0x3800+cell (name addr); A = tile\n"
               "\t\tpush\taf\t\t; SAVE tile byte in A - the guard reads H into A!\n"
               "\t\tld\ta, h\n"
               "\t\tand\t3Fh\n"
               "\t\tcp\t38h\n"
               "\t\tjr\tnz, dt_vec_draw\t; not bank-0 -> below HUD, draw\n"
               "\t\tld\ta, l\n"
               "\t\tcp\t20h\n"
               "\t\tjr\tnc, dt_vec_draw\t; rows 1+ (cell>=32) -> playfield, draw\n"
               "\t\tpop\taf\t\t; row 0 (cell<32) = HUD marker: garbage, skip\n"
               "\t\tor\t1\t\t; return NZ (like off-room) so callers skip too\n"
               "\t\tret\n"
               "dt_vec_draw:\n"
               "\t\tpop\taf\t\t; A = tile\n"
               "\t\tdi\t\t; close IRQ window (game-tick already DI)\n"
               "\t\tld\t(vw_byte), a\t; blitter tile input\n"
               "\t\tld\ta, l\n"
               "\t\tand\t1Fh\n"
               "\t\tld\tc, a\t\t; C = col = L & 31\n"
               "\t\tld\ta, l\n"
               "\t\tand\t0E0h\n"
               "\t\trlca\n"
               "\t\trlca\n"
               "\t\trlca\n"
               "\t\tld\te, a\t\t; E = L>>5\n"
               "\t\tld\ta, h\n"
               "\t\tsub\t38h\t\t; cellhi (0..2)\n"
               "\t\tadd\ta, a\n"
               "\t\tadd\ta, a\n"
               "\t\tadd\ta, a\t\t; cellhi*8\n"
               "\t\tadd\ta, e\n"
               "\t\tld\tb, a\t\t; B = row = cellhi*8 + L>>5\n"
               # Фаза B: запись name_shadow[cell] снята (тень удалена). HL=name addr цел.
               "\t\tld\ta, (vec_isr_depth)\n"
               "\t\tpush\taf\t\t; save real ISR depth\n"
               "\t\tld\ta, 1\n"
               "\t\tld\t(vec_isr_depth), a ; force !=0: vbt_row keeps DI\n"
               "\t\tpush\thl\t\t; save name addr across blit (vec_blit_tile clobbers HL)\n"
               "\t\tcall\tvec_blit_tile\t; B=row C=col vw_byte=tile -> p0/p1\n"
               "\t\tpop\thl\t\t; HL = name addr (drop-in for MSX drawTile)\n"
               "\t\tpop\taf\n"
               "\t\tld\t(vec_isr_depth), a ; restore real depth\n"
               "\t\tor\ta\n"
               "\t\tjr\tnz, dt_keepdi\t; was in ISR -> keep DI (ISR will ei)\n"
               "\t\tei\n"
               "dt_keepdi:\n"
               # MSX drawTile (VERSION2) returns A=tile (WRTVRM preserves A), HL=name addr,
               # Z=drawn (via dec b). Match all three: knife (movKnife 4101 inc a / 4139 inc hl)
               # relies on A=tile AND HL=name addr. ei/di do NOT touch A or flags.
               "\t\tld\ta, (vw_byte)\t; A = tile (as MSX WRTVRM preserves A=data)\n"
               "\t\tld\tb, 1\n"
               "\t\tdec\tb\t\t; Z = drawn (VERSION2 contract), A untouched\n"
               "\t\tret\t\t; HL=name addr, A=tile, Z\n")
    assert _dt_old in src, "drawTile source shape changed - guard not applied"
    src = src.replace(_dt_old, _dt_new, 1)

    # 7b) drawCortinilla (шторка перехода между комнатами / после потери жизни): пишет
    #     tile 0 (пусто) в целую КОЛОНКУ из 24 клеток (rows 0..23) через WRTVRM->vw_name
    #     ->dirty. Перенаправляем на прямой блит tile 0 в framebuffer (то же вычисление
    #     row/col, что drawTile). Это снимает поток шторки с dirty-очереди (768 dirty-
    #     enqueue за переход -> 0). name_shadow[cell]=0 для когерентности (HUD/фон
    #     перерисовываются name-путём после шторки и НЕ дедупятся ложно). Оборачиваем
    #     весь 24-блитовый цикл в di/force-depth/conditional-ei (как vec_nat_room):
    #     шторка идёт из substatus-обработчиков (InitStage/doCortinilla/setupEnding),
    #     контекст ISR vs main неоднозначен -> универсальная защита. КРИТ: оригинал
    #     ПАДАЕТ сквозь (fall-through) в HideSprites -> НЕ добавляем ret в конце.
    _cort_old = ("drawCortinilla:\n"
                 "\t\tld\thl, timer\n"
                 "\t\tdec\t(hl)\n"
                 "\t\tinc\thl\n"
                 "\t\tdec\t(hl)\n"
                 "\t\tret\tm\n"
                 "\t\t\n"
                 "\t\tld\ta, (hl)\n"
                 "\t\tld\th, 38h\t\t; #3800\tes el area del BG map\n"
                 "\t\txor\t1Fh\n"
                 "\t\tld\tl, a\n"
                 "\t\tld\tb, 18h\t\t; Numero de patrones a escribir\tverticales\n"
                 "\t\txor\ta\n"
                 "\n"
                 "drawCortinilla2:\n"
                 "\t\tcall\tWRTVRM\n"
                 "\t\tld\tde, 20h\n"
                 "\t\tadd\thl, de\t\t; Siguiente columna\n"
                 "\t\tdjnz\tdrawCortinilla2\n")
    # ФИКС ЛАГА (2026-07-14, компактный): раньше drawCortinilla ПРОВАЛИВАЛСЯ в HideSprites
    # (16К-очистка p2+p3 ~213K тактов) на КАЖДОМ из ~32 кадров шторки => стойкий лаг
    # (заказчик: «стирает медленнее чем отрисовывает лабиринт»). ФИКС: 16К-очистку делаем
    # ОДИН раз — на финишном кадре шторки (timer_hi<0), а не 32×. Кадры рисования только
    # быстро блитят фон (24 тайла), лага при развёртке нет; единственная 16К-очистка
    # приходится на финишный кадр, который И ТАК тяжёлый (загрузка комнаты) — незаметна.
    # КРИТ: изменение МИНИМАЛЬНО по байтам (+11Б, влезает в ALIGN-padding перед vec_revtab)
    # — иначе код сдвигается за ALIGN-границу и rot-блит-петли наезжают на vec_spr_buf
    # 0x6598 -> паттерны героя затирают КОД петель -> «каша» после первой демки.
    _cort_new = ("drawCortinilla:\n"
                 "\t\tld\thl, timer\n"
                 "\t\tdec\t(hl)\n"
                 "\t\tinc\thl\n"
                 "\t\tdec\t(hl)\n"
                 "\t\tjp\tm, cort_done\t; timer_hi<0 -> 16K clear ONCE + SIGN=M\n"
                 "\t\tld\ta, (hl)\n"
                 "\t\tld\th, 38h\t\t; HL = 0x3800 + col (name addr), como original\n"
                 "\t\txor\t1Fh\n"
                 "\t\tld\tl, a\n"
                 "\t\tdi\t\t; blit-loop atomico (24 celdas)\n"
                 "\t\tld\ta, (vec_isr_depth)\n"
                 "\t\tpush\taf\t\t; save real depth\n"
                 "\t\tld\ta, 1\n"
                 "\t\tld\t(vec_isr_depth), a ; force !=0: vbt_row keeps DI\n"
                 "\t\tld\tb, 18h\t\t; 24 filas\n"
                 "drawCortinilla2:\n"
                 "\t\tpush\tbc\t\t; save row-counter B\n"
                 "\t\txor\ta\n"
                 "\t\tld\t(vw_byte), a\t; tile 0 = blank\n"
                 "\t\tld\ta, l\n"
                 "\t\tand\t1Fh\n"
                 "\t\tld\tc, a\t\t; col\n"
                 "\t\tld\ta, l\n"
                 "\t\tand\t0E0h\n"
                 "\t\trlca\n"
                 "\t\trlca\n"
                 "\t\trlca\n"
                 "\t\tld\te, a\n"
                 "\t\tld\ta, h\n"
                 "\t\tsub\t38h\n"
                 "\t\tadd\ta, a\n"
                 "\t\tadd\ta, a\n"
                 "\t\tadd\ta, a\n"
                 "\t\tadd\ta, e\n"
                 "\t\tld\tb, a\t\t; row\n"
                 # Фаза B: запись name_shadow[cell]=0 снята (тень удалена).
                 "\t\tpush\thl\t\t; KRIT: vec_blit_tile does NOT preserve HL -> keep on stack\n"
                 "\t\tcall\tvec_blit_tile\t; B=row C=col vw_byte=0\n"
                 "\t\tpop\thl\t\t; HL = name addr (else rows 1..23 blit to garbage)\n"
                 "\t\tld\tde, 20h\n"
                 "\t\tadd\thl, de\t\t; Siguiente fila\n"
                 "\t\tpop\tbc\n"
                 "\t\tdjnz\tdrawCortinilla2\n"
                 "\t\tpop\taf\n"
                 "\t\tld\t(vec_isr_depth), a ; restore real depth\n"
                 "\t\tor\ta\n"
                 "\t\tjr\tnz, dt_cort_keepdi\t; ISR -> keep DI\n"
                 "\t\tei\n"
                 "dt_cort_keepdi:\n"
                 # Путь рисования: НЕ проваливаемся в HideSprites (был лаг 16K/кадр). SIGN=P.
                 "\t\txor\ta\t\t; SIGN=P (caller keeps wiping)\n"
                 "\t\tret\n"
                 # Финиш шторки: 16K-очистка p2+p3 ОДИН раз (HideSprites = clear + prev-reset),
                 # затем SIGN=M -> вызыватель (InitStage/doCortinilla) грузит комнату.
                 "cort_done:\n"
                 "\t\tcall\tHideSprites\t; 16K clear p2+p3 + prev-reset (ONCE, not per-frame)\n"
                 "\t\tld\ta, 0FFh\n"
                 "\t\tor\ta\t\t; SIGN=M (curtain done)\n"
                 "\t\tret\n")
    assert _cort_old in src, "drawCortinilla source shape changed - not applied"
    src = src.replace(_cort_old, _cort_new, 1)

    # 7c) ЕДИНЫЙ ТЕКСТОВЫЙ ШОВ: WriteDataVRAM (ВЕСЬ текст: HUD-метки REST/SCORE/HI,
    #     ©KONAMI/PYRAMID, титул ©KONAMI 1985 / PUSH SPACE KEY, SOFTWARE, GAME OVER,
    #     PLAY START, финал) и renderNumber3/drawDigit (цифры: счёт/HI/жизни/пирамида)
    #     писали тайлы шрифта в name-таблицу через WRTVRM -> vw_name -> dirty ->
    #     компоситор. Перенаправляем оба на прямой vec_text_blit (direct blit в
    #     framebuffer, обновляет name_shadow, атомарно). Один helper покрывает текст
    #     И цифры везде -> 0 dirty от текста, HUD-хук (перехват row 0/23) не нужен.
    #     WRTVRM сохраняет ВСЕ регистры; vec_text_blit сохраняет HL,DE,BC (A=результат,
    #     как у WRTVRM). Петли обеих функций держат нужные регистры (HL=name addr,
    #     DE=data/BCD ptr, C=mask/младший ниббл) -> контракт сохранён.
    #  WriteDataVRAM: единственная запись тайла в петле (writeDataVRAM3, уникальна
    #     благодаря `jr writeDataVRAM3`). Маску (`and c`) оставляем -> A уже с маской
    #     (ClearDataVRAM: c=0 -> тайл 0 = пусто).
    _wdv_old = ("\t\tand\tc\t\t; Aplica mascara AND al\tdato a escribir\ten la VRAM\n"
                "\t\tcall\tWRTVRM\n"
                "\t\tinc\thl\n"
                "\t\tjr\twriteDataVRAM3\n")
    _wdv_new = ("\t\tand\tc\t\t; Aplica mascara AND al\tdato a escribir\ten la VRAM\n"
                "\t\tcall\tvec_text_blit\t; NAT: direct blit tile -> framebuffer (was WRTVRM->dirty)\n"
                "\t\tinc\thl\n"
                "\t\tjr\twriteDataVRAM3\n")
    assert _wdv_old in src, "WriteDataVRAM inner-write shape changed - text seam not applied"
    src = src.replace(_wdv_old, _wdv_new, 1)

    #  renderNumber3: два одинаковых WRTVRM (старший/младший ниббл цифры), оба после
    #     `add a, 10h` (тайл '0'+digit). replace_all покрывает обе цифры пары.
    _num_old = ("\t\tadd\ta, 10h\t\t; Numero de patron que corresponde con el '0'\n"
                "\t\tcall\tWRTVRM\n")
    _num_new = ("\t\tadd\ta, 10h\t\t; Numero de patron que corresponde con el '0'\n"
                "\t\tcall\tvec_text_blit\t; NAT: direct blit digit tile -> framebuffer\n")
    assert _num_old in src, "renderNumber3 digit-write shape changed - text seam not applied"
    assert src.count(_num_old) == 2, "renderNumber3 must have exactly 2 digit WRTVRM writes"
    src = src.replace(_num_old, _num_new)

    # 7c-2) TITULO KING'S VALLEY (ЗАДАЧА #2, solo _NATLOGO): drawGameLogo pinta las letras
    #   (tiles 0x9B-0xC6) con 2 x call WRTVRM -> soft-VDP. Ultimo escritor soft-VDP del titulo.
    #   -> vec_text_blit (HL=name addr, A=tile; preserva HL,DE,BC como WRTVRM; blit directo).
    #   (1) drawGameLogo3 loop (A=c=tile del logo, tras el WRTVRM se recarga A=20h).
    #   (2) parte baja de la G (A=l-0ECh+77h). En la BASE (sin _NATLOGO) queda en WRTVRM =>
    #   OFF byte-identico con el canon.
    if _NATLOGO:
        _tlogo1_old = ("\t\tld\ta, c\n"
                       "\t\tcall\tWRTVRM\n"
                       "\t\tld\ta, 20h\t\t; Incrementa la\tcoordenada Y (siguiente\tfila de\tpatrones)\n")
        _tlogo1_new = ("\t\tld\ta, c\n"
                       "\t\tcall\tvec_text_blit\t; NATLOGO: letra KING'S VALLEY -> framebuffer (era WRTVRM->dirty)\n"
                       "\t\tld\ta, 20h\t\t; Incrementa la\tcoordenada Y (siguiente\tfila de\tpatrones)\n")
        assert _tlogo1_old in src, "drawGameLogo3 WRTVRM shape changed - title seam not applied"
        src = src.replace(_tlogo1_old, _tlogo1_new, 1)

        # NB: la remap de tile 0C7h->77h ocurre mas abajo en esta funcion (~py4931), aqui el
        # valor sigue siendo 0C7h (source original). Solo tocamos el call WRTVRM.
        _tlogo2_old = ("\t\tadd\ta, 0C7h\t\t; Patron parte de abajo\tde la G\tde KING'S\n"
                       "\t\tcall\tWRTVRM\n")
        _tlogo2_new = ("\t\tadd\ta, 0C7h\t\t; Patron parte de abajo\tde la G\tde KING'S\n"
                       "\t\tcall\tvec_text_blit\t; NATLOGO: parte baja G KING'S -> framebuffer (era WRTVRM->dirty)\n")
        assert _tlogo2_old in src, "drawGameLogo bottom-G WRTVRM shape changed - title seam not applied"
        src = src.replace(_tlogo2_old, _tlogo2_new, 1)

        # ЗАДАЧА #5: PIRAMIDE del titulo (drawMenuEnd 0x3892): DEtoVRAM_NXNY(HL=3892h,
        #   DE=GFX_PiramidLogo, B=3 filas, C=6 cols) -> vec_blit_rect (contrato identico:
        #   HL=name, DE=tile data, B=filas, C=cols). Es el ULTIMO escritor soft-VDP del
        #   titulo (drawMenuEnd), antes exceptuado (ver 7d "NO se toca DEtoVRAM_NXNY del
        #   titulo"). Ancla por `ld hl, 3892h` (unico). Solo _NATLOGO => OFF byte-identico.
        _tpir_old = ("\t\tld\thl, 3892h\t; Coordenadas\n"
                     "\t\tld\tbc, 306h\t; Alto x ancho\n"
                     "\t\tcall\tDEtoVRAM_NXNY\n")
        _tpir_new = ("\t\tld\thl, 3892h\t; Coordenadas\n"
                     "\t\tld\tbc, 306h\t; Alto x ancho\n"
                     "\t\tcall\tvec_blit_rect\t; NATLOGO(t5): piramide titulo -> framebuffer (era DEtoVRAM_NXNY)\n")
        assert src.count(_tpir_old) == 1, "drawMenuEnd pyramid DEtoVRAM_NXNY anchor not unique"
        src = src.replace(_tpir_old, _tpir_new, 1)

    # 7c-3) BONUS/FINAL-EXCLUSIVO (ЗАДАЧА #3, solo _NATBONUS): setupEnding pinta el
    #   escenario final (3 semi-piramides + puerta grande + 6 estrellas) con los ULTIMOS
    #   escritores soft-VDP del juego: 3 x WRTVRM (estrella / relleno / vertice-diagonal)
    #   y 1 x DEtoVRAM_NXNY (puerta rect 3x2). -> vec_text_blit / vec_blit_rect (mismo
    #   contrato). Anclas por comentario ES unico (estrella/relleno/Vertice/puerta) -> NO
    #   tocan titulo (drawMenuEnd) ni gameplay. En la BASE queda en soft-VDP => OFF byte-a-
    #   byte con canon. En drawHalfPiram el IX-shim (alt-AF) swapea A tras el blit, por eso
    #   que vec_text_blit no preserve A (WRTVRM si) es inocuo (A se restaura del alt-AF).
    if _NATBONUS:
        #  PUERTA de la piramide grande (setupEnding): DEtoVRAM_NXNY(HL=3A1Eh, DE=tilesEndDoor,
        #  B=3 alto, C=2 ancho) -> vec_blit_rect (contrato identico).
        _bdoor_old = "\t\tcall\tDEtoVRAM_NXNY\t; Dibuja la puerta en pantalla"
        _bdoor_new = "\t\tcall\tvec_blit_rect\t; NATBONUS: puerta piramide grande -> framebuffer (era DEtoVRAM_NXNY)"
        assert src.count(_bdoor_old) == 1, "setupEnding door DEtoVRAM_NXNY anchor not unique"
        src = src.replace(_bdoor_old, _bdoor_new, 1)

        #  ESTRELLA del cielo (drawStars loop): WRTVRM(HL=39xx, A=47h) -> vec_text_blit.
        #  El loop usa DE (puntero starsLocations) y B (contador); vec_text_blit los preserva.
        _bstar_old = "\t\tcall\tWRTVRM\t\t; Dibuja la estrella"
        _bstar_new = "\t\tcall\tvec_text_blit\t; NATBONUS: estrella del cielo -> framebuffer (era WRTVRM)"
        assert src.count(_bstar_old) == 1, "drawStars WRTVRM anchor not unique"
        src = src.replace(_bstar_old, _bstar_new, 1)

        #  RELLENO de la piramide (drawHalfPiram): WRTVRM(HL=name, A=c+1 tile relleno).
        _bfill_old = "\t\tcall\tWRTVRM\t\t; Tile de relleno de la\tpiramide"
        _bfill_new = "\t\tcall\tvec_text_blit\t; NATBONUS: relleno piramide -> framebuffer (era WRTVRM)"
        assert src.count(_bfill_old) == 1, "drawHalfPiram relleno WRTVRM anchor not unique"
        src = src.replace(_bfill_old, _bfill_new, 1)

        #  VERTICE/DIAGONAL de la piramide (drawHalfPiram): WRTVRM(HL=name, A=c tile diagonal).
        #  Ancla incluye el `ld a, c ; Vertice...` previo (unico) para no depender del
        #  comentario del call (que podria repetirse).
        _bvert_old = ("\t\tld\ta, c\t\t; Vertice de la\tpiramide / patron diagonal\n"
                      "\t\tcall\tWRTVRM\t\t; Dibuja el patron en pantalla")
        _bvert_new = ("\t\tld\ta, c\t\t; Vertice de la\tpiramide / patron diagonal\n"
                      "\t\tcall\tvec_text_blit\t; NATBONUS: vertice/diagonal piramide -> framebuffer (era WRTVRM)")
        assert src.count(_bvert_old) == 1, "drawHalfPiram vertice WRTVRM anchor not unique"
        src = src.replace(_bvert_old, _bvert_new, 1)

    # 7d) OBJETOS DINAMICOS DEL LABERINTO -> RENDER NATIVO (fuera de soft-VDP).
    #     Ultimos escritores de vw_name en gameplay/intro. Todos calculan la celda
    #     via coordVRAM_DE/HL (-> HL=0x3800+cell) y luego escriben tile(s):
    #       * WRTVRM (1 tile, HL=name addr, A=tile) -> vec_text_blit (drop-in:
    #         preserva HL,DE,BC, actualiza name_shadow, atomico como drawTile).
    #       * DEtoVRAM_NXNY (rect B filas x C cols de tile-IDs) -> vec_blit_rect.
    #     PRECONDICION: drawTile (VERSION2) ya devuelve HL=name addr, A=tile, Z
    #     (fix arriba) -> el segundo tile del cuchillo (inc a / inc hl) es correcto.
    #     NO se toca DEtoVRAM_NXNY del titulo (drawMenuEnd 0x3892). El final
    #     (setupEnding 0x3A1E) YA fue nativizado por _NATBONUS (Stage 3, ver abajo).

    #  PUERTAS de entrada/salida de la piramide (drawPuerta4): rect 3x5 tile-a-tile
    #  via WRTVRM (HL=name addr, A=tile de getTileFromID). Visible en intro-piramide
    #  y gameplay. -> vec_text_blit (preserva HL,DE,BC; el loop hace inc hl/inc de).
    _door_old = ("\t\tcall\tgetTileFromID\t; Obtiene patron que le\tcorresponde\n"
                 "\t\tcall\tWRTVRM\t\t; Lo dibuja en pantalla\n")
    _door_new = ("\t\tcall\tgetTileFromID\t; Obtiene patron que le\tcorresponde\n"
                 "\t\tcall\tvec_text_blit\t; NAT: blit directo puerta -> framebuffer (era WRTVRM->dirty)\n")
    assert _door_old in src, "drawPuerta4 WRTVRM shape changed"
    src = src.replace(_door_old, _door_new, 1)

    #  PUERTAS GIRATORIAS - dibujo (spiningDoor4): coordVRAM_HL -> jp DEtoVRAM_NXNY
    #  con B=altura, C=2, DE=tilesGiroDoor+frame. -> jp vec_blit_rect.
    _spin_old = ("\t\tcall\tcoordVRAM_HL\t; Obtiene direccion VRAM de la tabla de\tnombres\ta donde\tapunta HL\n"
                 "\t\tjp\tDEtoVRAM_NXNY\t; Dibuja puerta\ten la pantalla\n")
    _spin_new = ("\t\tcall\tcoordVRAM_HL\t; Obtiene direccion VRAM de la tabla de\tnombres\ta donde\tapunta HL\n"
                 "\t\tjp\tvec_blit_rect\t; NAT: blit directo puerta giratoria -> framebuffer\n")
    assert _spin_old in src, "spiningDoor4 DEtoVRAM_NXNY shape changed"
    src = src.replace(_spin_old, _spin_new, 1)

    #  PUERTAS GIRATORIAS - borrado (quitaGiratoria2): coordVRAM_DE; DE=eraseData;
    #  DEtoVRAM_NXNY (B=altura, C=2). -> vec_blit_rect.
    _spinerase_old = ("\t\tld\tde, eraseData\n"
                      "\t\tcall\tDEtoVRAM_NXNY\t; Borra\tla puerta de la\tpantalla\n")
    _spinerase_new = ("\t\tld\tde, eraseData\n"
                      "\t\tcall\tvec_blit_rect\t; NAT: borra puerta giratoria -> framebuffer\n")
    assert _spinerase_old in src, "quitaGiratoria2 DEtoVRAM_NXNY shape changed"
    src = src.replace(_spinerase_old, _spinerase_new, 1)

    #  GEMA cogida (gemaCogida): borra el brillo superior (WRTVRM 1 tile vacio) y el
    #  rect 1x3 (brillo-izq/gema/brillo-der) via DEtoVRAM_NXNY(eraseData). El gema en
    #  si se dibuja como tile del mapa (lo pinta el render de fondo), no via soft-VDP.
    _gemtop_old = ("\t\txor\ta\t\t; Tile vacio\n"
                   "\t\tcall\tWRTVRM\t\t; Borra\tel brillo superior\n")
    _gemtop_new = ("\t\txor\ta\t\t; Tile vacio\n"
                   "\t\tcall\tvec_text_blit\t; NAT: borra brillo superior gema -> framebuffer\n")
    assert _gemtop_old in src, "gemaCogida top-brillo WRTVRM shape changed"
    src = src.replace(_gemtop_old, _gemtop_new, 1)

    _gemrect_old = ("\t\tld\tde, eraseData\t; Tiles\tvacios\n"
                    "\t\tld\tbc, 103h\t; Ancho\tde 3 tiles\n"
                    "\t\tcall\tDEtoVRAM_NXNY\t; Borra\tde la pantalla el brillo de la izquierda, la gema y el brillo de la derecha\n")
    _gemrect_new = ("\t\tld\tde, eraseData\t; Tiles\tvacios\n"
                    "\t\tld\tbc, 103h\t; Ancho\tde 3 tiles\n"
                    "\t\tcall\tvec_blit_rect\t; NAT: borra brillo/gema/brillo -> framebuffer\n")
    assert _gemrect_old in src, "gemaCogida erase-rect DEtoVRAM_NXNY shape changed"
    src = src.replace(_gemrect_old, _gemrect_new, 1)

    #  CUCHILLO (movKnife): 4 escrituras de 1 tile via WRTVRM/jp WRTVRM. Cada una con
    #  HL=name addr (post-drawTile / coordVRAM_DE +/- inc) y A=tile. -> vec_text_blit.
    #  (1) segundo tile del cuchillo (HL=name addr de drawTile+inc hl, A=tile+1).
    _kn1_old = ("\t\tinc\ta\n"
                "\t\tinc\thl\n"
                "\t\tcall\tWRTVRM\t\t; segundo tile del cuchillo\n")
    _kn1_new = ("\t\tinc\ta\n"
                "\t\tinc\thl\n"
                "\t\tcall\tvec_text_blit\t; NAT: 2do tile cuchillo -> framebuffer\n")
    assert _kn1_old in src, "movKnife second-tile WRTVRM shape changed"
    src = src.replace(_kn1_old, _kn1_new, 1)

    #  (2) restaura fondo tras chocar contra puerta (jp WRTVRM tras getTileFromID).
    _kn2_old = ("\t\tcall\tgetTileFromID\t; Identifica tile que le corresponde\n"
                "\t\tjp\tWRTVRM\t\t; Lo pinta\n")
    _kn2_new = ("\t\tcall\tgetTileFromID\t; Identifica tile que le corresponde\n"
                "\t\tjp\tvec_text_blit\t; NAT: restaura fondo puerta cuchillo -> framebuffer\n")
    assert _kn2_old in src, "movKnife door-restore WRTVRM shape changed"
    src = src.replace(_kn2_old, _kn2_new, 1)

    #  (3) restaura fondo bajo el cuchillo en movimiento (call WRTVRM, HL ya ajustado).
    _kn3_old = ("\t\tpop\taf\n"
                "\t\tcall\tWRTVRM\t\t; Restaura fondo\n")
    _kn3_new = ("\t\tpop\taf\n"
                "\t\tcall\tvec_text_blit\t; NAT: restaura fondo cuchillo -> framebuffer\n")
    assert _kn3_old in src, "movKnife background-restore WRTVRM shape changed"
    src = src.replace(_kn3_old, _kn3_new, 1)

    #  (4) knifeRestaura: coordVRAM_DE -> jp WRTVRM (restaura fondo al chocar).
    _kn4_old = ("\t\tcall\tcoordVRAM_DE\t; D = Y, E = X\n"
                "\t\tjp\tWRTVRM\t\t; Pinta\tel patron en pantalla\n")
    _kn4_new = ("\t\tcall\tcoordVRAM_DE\t; D = Y, E = X\n"
                "\t\tjp\tvec_text_blit\t; NAT: restaura fondo cuchillo (choca) -> framebuffer\n")
    assert _kn4_old in src, "knifeRestaura WRTVRM shape changed"
    src = src.replace(_kn4_old, _kn4_new, 1)

    #  COGER/QUITAR OBJETO (cogeObjeto): al coger/soltar un pico o cuchillo, loadAnimation
    #  REGENERA los patrones del sprite del prota en vec_spr_shadow. El blitter XOR
    #  (vec_nsx) borra por el shadow VIVO, asi que el borrado del frame siguiente aplica el
    #  patron NUEVO sobre pixeles dibujados con el VIEJO -> cola de basura junto al heroe
    #  (bug antiguo del pickup). FIX (solo Vector): antes de jp loadAnimation, vec_spr_flush
    #  borra los sprites dibujados con el patron VIEJO y marca prev oculto -> pickup limpio.
    _coge_old = ("cogeObjeto:\n"
                 "\t\tld\t(objetoCogido),\ta ; #10\t= Cuchillo, #20\t= Pico\n"
                 "\t\tjp\tloadAnimation\t; Actualiza los\tsprites\tdel prota\n")
    _coge_new = ("cogeObjeto:\n"
                 "\t\tld\t(objetoCogido),\ta ; #10\t= Cuchillo, #20\t= Pico\n"
                 "\t\tcall\tvec_spr_flush\t; NAT: borra sprites con patron VIEJO antes de regenerar\n"
                 "\t\tjp\tloadAnimation\t; Actualiza los\tsprites\tdel prota\n")
    assert _coge_old in src, "cogeObjeto shape changed"
    src = src.replace(_coge_old, _coge_new, 1)

    # --- ШАГ4a: убрать ГЕНЕРАЦИЮ зеркальных спрайтов (flipSprites) ---
    # flipSprites горизонтально-зеркалит hero/momia-спрайты в vec_spr_shadow по pat-индексам
    # 0x60+ (зеркало = база+0x60). Теперь vec_nsx генерит зеркало НА ЛЕТУ (pat>=0x60 -> база
    # pat-0x60 + реверс половин L<->R + бит-реверс байтов через vec_revlut), поэтому ХРАНИТЬ
    # зеркала не нужно. Нейтрализуем flipSprites в `ret` (метка нужна вызывающим: setup momia
    # `call flipSprites`, loadAnimation `jp flipSprites`). spr_shadow 0xC380-0xC51F (13 зеркал
    # x32Б = 416Б) больше НЕ пишется -> свободен (подготовка к выносу spr_shadow, шаги 4b/4c).
    # InviertePatron/invierteByte ОСТАЮТСЯ: FlipPatrones (тайлы-лестницы 0x77-0x85) их зовёт.
    _flip_old = (
        "flipSprites:\n\t\tpush\tde\n\nflipSprite2:\n\t\tld\tb, 10h\n\n"
        "flipSprite3:\n\t\tcall\tInviertePatron\n\t\tinc\thl\n\t\tinc\te\n\t\tdjnz\tflipSprite3\n\n"
        "\t\tld\ta, e\n\t\tsub\t20h\n\t\tld\te, a\n\t\tbit\t4, e\n\t\tjr\tz, flipSprite2\n\n"
        "\t\tpop\tde\n\t\tld\ta, 20h\n\t\tcall\tADD_A_DE\n\t\tdec\tc\n\t\tjr\tnz, flipSprites\n\t\tret\n")
    _flip_new = (
        "flipSprites:\n\t\tret\t; STEP4a: mirror generated on-the-fly in vec_nsx "
        "(spr_shadow 0x60+ no longer stored)\n")
    assert _flip_old in src, "flipSprites shape changed"
    src = src.replace(_flip_old, _flip_new, 1)

    # --- ЛОГИКА-ОПТ #2: momiaAparece IX->HL ---
    # momiaAparece (state-5 handler, dispatched by jumpIndex; ret -> updateMomiaAtr
    # which re-reads ALL state from z80_ix/momiaEnProceso -> НЕТ выходного контракта
    # по регистрам/флагам). 5 обращений (ix+n) -> прямой HL по образцу getMomiaDat.
    # z80_ix — scratch-ячейка = pMomiaProceso. Читаем поля через (hl)+inc/add hl,de.
    # ВНУТР-метки setMomiaViva/momiaOpenLegs/setMomiaFrame ссылаются ТОЛЬКО отсюда.
    # Контракт-инварианты сохранены: dec (hl) даёт Z для jp z; A=timer после ld a,(hl);
    # LHLD/ld de/add hl/ld (hl),a НЕ трогают A (frame сохраняется в setMomiaFrame).
    _ma_head_old = (
        "momiaAparece:\n"
        "\t\tld\t(ix+ACTOR_CONTROL), 8 ;\tMirando\ta la derecha\n"
        "\t\tdec\t(ix+ACTOR_TIMER) ; Decrementa el tiempo\tde aparicion\n"
        "\t\tjp\tz, setMomiaViva\t; Ha llegado al\tfinal\n"
        "\n"
        "\t\tld\ta, (ix+ACTOR_TIMER)")
    _ma_head_new = (
        "momiaAparece:\n"
        "\t\tld\thl, (z80_ix)\t; NAT IX->HL: mummy struct ptr\n"
        "\t\tinc\thl\t\t; ->ACTOR_CONTROL (+1)\n"
        "\t\tld\t(hl), 8\t; Mirando a la derecha\n"
        "\t\tld\tde, 10h\n"
        "\t\tadd\thl, de\t; ->ACTOR_TIMER (+17)\n"
        "\t\tdec\t(hl)\t; Decrementa tiempo aparicion; set Z\n"
        "\t\tjp\tz, setMomiaViva\n"
        "\t\tld\ta, (hl)\t; A = ACTOR_TIMER")
    assert _ma_head_old in src, "momiaAparece head shape changed"
    src = src.replace(_ma_head_old, _ma_head_new, 1)

    _ma_smf_old = (
        "setMomiaFrame:\n"
        "\t\tld\t(ix+ACTOR_FRAME), a\n"
        "\t\tret")
    _ma_smf_new = (
        "setMomiaFrame:\n"
        "\t\tld\thl, (z80_ix)\t; NAT IX->HL\n"
        "\t\tld\tde, 0Bh\n"
        "\t\tadd\thl, de\t; ->ACTOR_FRAME (+11)\n"
        "\t\tld\t(hl), a\n"
        "\t\tret")
    assert _ma_smf_old in src, "setMomiaFrame shape changed"
    src = src.replace(_ma_smf_old, _ma_smf_new, 1)

    _ma_mol_old = (
        "momiaOpenLegs:\n"
        "\t\tld\t(ix+ACTOR_FRAME), 2 ; Piernas separadas\n"
        "\t\tret")
    _ma_mol_new = (
        "momiaOpenLegs:\n"
        "\t\tld\thl, (z80_ix)\t; NAT IX->HL\n"
        "\t\tld\tde, 0Bh\n"
        "\t\tadd\thl, de\t; ->ACTOR_FRAME (+11)\n"
        "\t\tld\t(hl), 2\t; Piernas separadas\n"
        "\t\tret")
    assert _ma_mol_old in src, "momiaOpenLegs shape changed"
    src = src.replace(_ma_mol_old, _ma_mol_new, 1)

    # --- IX-DEEMU Шаг 0: momiaSetSalta idiom push ix/pop hl -> ld hl,(z80_ix) ---
    # Эмуляция push ix эмитит il_tmp-роундтрип (сохранить HL, залить z80_ix, push),
    # но следующий pop hl всё равно затирает HL -> весь блок эквивалентен LHLD z80_ix.
    # z80_ix здесь = указатель структуры мумии (ставится getMomiaProcDat перед jumpIndex).
    # Тривиально-безопасно: и до, и после HL := z80_ix; A/флаги/прочие рег не трогаются.
    _ss_old = (
        "momiaSetSalta:\n"
        "\t\tpush\tix\n"
        "\t\tpop\thl\t\t; Datos\tmomia\n")
    _ss_new = (
        "momiaSetSalta:\n"
        "\t\tld\thl, (z80_ix)\t; NAT IX->HL Step0: puntero estructura momia\n")
    assert _ss_old in src, "momiaSetSalta shape changed"
    if not _IXOFF:
        src = src.replace(_ss_old, _ss_new, 1)

    # --- IX-DEEMU Шаг 1: однополевые мумия-сеттеры (хвостовые, HL после не нужен) ---
    # Все — tail-setters (достигаются jr, заканчиваются ret/fall-through). Хранимое
    # значение в A сохраняется; HL затирается безопасно (перезагружается/идёт call);
    # флаги: где вызыватель зависит — учтено (momiaSetControl: ret z ИДЁТ ПЕРВЫМ;
    # buscaProta3: вызыватель momiaDecide делает `and a` сразу; add hl,de CY безвреден
    # т.к. далее call/xor a). Смещения ACTOR: STATUS+0 CONTROL+1 POS_RELAT+16 TIMER+17.
    _s1 = [
        # setMomiaStatus: STATUS(+0)=A. HL на входе ЖИВОЙ у вызывателя (эмуляция
        # берегла) -> push/pop hl (доказано бисектом: без сохранения HL AI расходится).
        ("setMomiaStatus:\n\t\tld\t(ix+ACTOR_STATUS), a\n\t\tret",
         "setMomiaStatus:\n\t\tpush\thl\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S1\n\t\tld\t(hl), a\t; ACTOR_STATUS +0\n\t\tpop\thl\n\t\tret"),
        # momiaSetControl: ret z; CONTROL(+1)=A. HL на входе = ЖИВОЙ указатель
        # (ordenBajar/ordenSubir) -> ОБЯЗАН сохраниться (эмуляция (ix+d) его берегла).
        # push/pop hl не трогают A/флаги; ret z остаётся первым.
        ("momiaSetControl:\n\t\tret\tz\n\t\tld\t(ix+ACTOR_CONTROL), a",
         "momiaSetControl:\n\t\tret\tz\n\t\tpush\thl\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S1\n\t\tinc\thl\t; ->ACTOR_CONTROL +1\n\t\tld\t(hl), a\n\t\tpop\thl"),
        # buscaProta3: A=b; POS_RELAT(+16)=A
        ("buscaProta3:\n\t\tld\ta, b\n\t\tld\t(ix+ACTOR_POS_RELAT), a",
         "buscaProta3:\n\t\tld\ta, b\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S1\n\t\tld\tde, 10h\n\t\tadd\thl, de\t; ->ACTOR_POS_RELAT +16\n\t\tld\t(hl), a"),
        # setMomiaPensar: TIMER(+17)=0, затем fall-through в setMomiaAndar (xor a)
        ("setMomiaPensar:\n\t\tld\t(ix+ACTOR_TIMER), 0",
         "setMomiaPensar:\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S1\n\t\tld\tde, 11h\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n\t\tld\t(hl), 0"),
        # momiaDecide: A=5; TIMER(+17)=A (A=5 сохраняется в buscaCercanias как в оригинале)
        ("momiaDecide:\n\t\tld\ta, 5\n\t\tld\t(ix+ACTOR_TIMER), a",
         "momiaDecide:\n\t\tld\ta, 5\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S1\n\t\tld\tde, 11h\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n\t\tld\t(hl), a"),
        # quitaACTOR_: TIMER(+17)=0FFh между call quitaMomia и call initMomia
        ("\t\tld\t(ix+ACTOR_TIMER), 0FFh\n\t\tcall\tinitMomia",
         "\t\tld\thl, (z80_ix)\t; NAT IX->HL S1 quitaACTOR_\n\t\tld\tde, 11h\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n\t\tld\t(hl), 0FFh\n\t\tcall\tinitMomia"),
    ]
    for _o, _n in (_s1 if not _IXOFF else []):
        assert _o in src, "IX-deemu S1 shape changed: " + _o[:24]
        src = src.replace(_o, _n, 1)

    # --- IX-DEEMU Шаг 2: multi-access мумия-хендлеры ---
    # Эмуляция (ix+d) бережёт HL/A/флаги (push af + il_tmp2), DE/BC не трогает.
    # Multi-access: грузим z80_ix в HL ОДИН раз, обращаемся многократно -> крупная
    # экономия. Консервативно повторяем контракт эмуляции.
    _s2 = [
        # momiaVanish: 3 записи (STATUS+0=8, CONTROL+1=4, TIMER+17=22h), НЕТ возврата
        # -> беречь HL/DE/A/флаги полностью (провабельно тождественно, 0 анализа).
        ("momiaVanish:\n\t\tld\t(ix+ACTOR_STATUS), 8 ; Estado: momia explota y desaparece\n"
         "\t\tld\t(ix+ACTOR_CONTROL), 4 ;\tVa a la\tizquierda\n"
         "\t\tld\t(ix+ACTOR_TIMER), 22h\n\t\tret",
         "momiaVanish:\n\t\tpush\taf\n\t\tpush\tde\n\t\tpush\thl\n"
         "\t\tld\thl, (z80_ix)\t; NAT IX->HL S2\n"
         "\t\tld\t(hl), 8\t; ACTOR_STATUS +0\n\t\tinc\thl\n\t\tld\t(hl), 4\t; ACTOR_CONTROL +1\n"
         "\t\tld\tde, 10h\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n\t\tld\t(hl), 22h\n"
         "\t\tpop\thl\n\t\tpop\tde\n\t\tpop\taf\n\t\tret"),
        # daLaVuelta: RMW CONTROL(+1) ^= 0Ch. Возвращает A=результат, флаги от xor.
        # -> беречь HL (push/pop). inc hl (не add hl,de) -> CY/флаги как в оригинале.
        ("daLaVuelta:\n\t\tld\ta, (ix+ACTOR_CONTROL) ;\t1 = Arriba, 2 =\tAbajo, 4 = Izquierda, 8\t= Derecha\n"
         "\t\txor\t0Ch\t\t; Cambia de direccion\n\t\tld\t(ix+ACTOR_CONTROL), a",
         "daLaVuelta:\n\t\tpush\thl\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S2\n\t\tinc\thl\t; ->ACTOR_CONTROL +1\n"
         "\t\tld\ta, (hl)\n\t\txor\t0Ch\t\t; Cambia de direccion\n\t\tld\t(hl), a\n\t\tpop\thl"),
    ]
    for _o, _n in (_s2 if not _IXOFF else []):
        assert _o in src, "IX-deemu S2 shape changed: " + _o[:24]
        src = src.replace(_o, _n, 1)

    # --- IX-DEEMU Шаг 2b: малые хендлеры (2-3 доступа) ---
    _s2b = [
        # ОТЛОЖЕНО в Шаг 4 (взаимодействие с mueveElemento, который переопределяет
        # z80_ix через push ix/pop ix): momiaUpdate. Натив DE верен, но связка расходится.
        # momiaUnknown: RMW CONTROL(+1)^=0Ch, rra/rra/and3 -> SENTIDO(+2). HL мёртв (call getYMomia).
        ("momiaUnknown:\n\t\tld\ta, (ix+ACTOR_CONTROL) ;\t1 = Arriba, 2 =\tAbajo, 4 = Izquierda, 8\t= Derecha\n\t\txor\t1100b\n\t\tld\t(ix+ACTOR_CONTROL), a ;\tInvierte el sentido de la momia\n\t\trra\n\t\trra\n\t\tand\t3\n\t\tld\t(ix+ACTOR_SENTIDO), a",
         "momiaUnknown:\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S2b\n\t\tinc\thl\t; ->ACTOR_CONTROL +1\n\t\tld\ta, (hl)\n\t\txor\t1100b\n\t\tld\t(hl), a\n\t\trra\n\t\trra\n\t\tand\t3\n\t\tinc\thl\t; ->ACTOR_SENTIDO +2\n\t\tld\t(hl), a"),
        # momiaSinSuelo: чтение TIPO(+20). `and a` следом сбрасывает флаги (CY от add безвреден).
        ("momiaSinSuelo:\n\t\tld\ta, (ix+ACTOR_TIPO)",
         "momiaSinSuelo:\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S2b\n\t\tld\tde, 14h\n\t\tadd\thl, de\t; ->ACTOR_TIPO +20\n\t\tld\ta, (hl)"),
        # momiaSinSuelo: чтение POS_RELAT(+16). `cp 1` следом сбрасывает флаги. HL перезагружен.
        ("\t\tld\ta, (ix+ACTOR_POS_RELAT)",
         "\t\tld\thl, (z80_ix)\t; NAT S2b POS_RELAT\n\t\tld\tde, 10h\n\t\tadd\thl, de\t; ->ACTOR_POS_RELAT +16\n\t\tld\ta, (hl)"),
        # momiaLimbo: dec TIMER(+17)[jp nz по Z], inc STATUS(+0), TIMER(+17)=82h.
        ("\t\tdec\t(ix+ACTOR_TIMER)\n\t\tjp\tnz, chkLastMomia ; Aun falta tiempo para que aparezca\n\n\t\tinc\t(ix+ACTOR_STATUS) ; Siguiente estado de\tla momia: Aparece\n\t\tld\t(ix+ACTOR_TIMER), 82h",
         "\t\tld\thl, (z80_ix)\t; NAT IX->HL S2b\n\t\tld\tde, 11h\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n\t\tdec\t(hl)\n\t\tjp\tnz, chkLastMomia ; Aun falta tiempo para que aparezca\n\t\tld\thl, (z80_ix)\n\t\tinc\t(hl)\t; ACTOR_STATUS +0\n\t\tld\tde, 11h\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n\t\tld\t(hl), 82h"),
    ]
    for _o, _n in (_s2b if not _IXOFF else []):
        assert _o in src, "IX-deemu S2b shape changed: " + _o[:24]
        src = src.replace(_o, _n, 1)

    # --- IX-DEEMU Шаг 3b: чистые AI-state хендлеры (НЕ пишут спрайты) ---
    # По аналогии со Шагами 0-2b: чистая AI-логика (не movement/sprite-пайплайн) НЕ
    # цикло-чувствительна. quitaMomia/updateMomiaAtr (пишут enemyAttrib) ИСКЛЮЧЕНЫ.
    _s3b = [
        # momiaSuicida: CONTROL(+1)=8, dec TIMER(+17)[Z], read TIMER->A, FRAME(+11)=A.
        # HL свободен (state-хендлер). dec(hl) ставит Z; ld a,(hl)/ld b,a его берегут -> jr z.
        ("momiaSuicida:\n\t\tld\t(ix+ACTOR_CONTROL), 8 ;\t1 = Arriba, 2 =\tAbajo, 4 = Izquierda, 8\t= Derecha\n\t\tdec\t(ix+ACTOR_TIMER)\n\t\tld\ta, (ix+ACTOR_TIMER)",
         "momiaSuicida:\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S3b\n\t\tinc\thl\t; ->ACTOR_CONTROL +1\n\t\tld\t(hl), 8\n\t\tld\tde, 10h\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n\t\tdec\t(hl)\n\t\tld\ta, (hl)"),
        ("\t\tld\ta, 0Ah\t\t; Frame\tdestello desaparecer\n\t\tld\t(ix+ACTOR_FRAME), a",
         "\t\tld\ta, 0Ah\t\t; Frame\tdestello desaparecer\n\t\tld\thl, (z80_ix)\n\t\tld\tde, 0Bh\n\t\tadd\thl, de\t; ->ACTOR_FRAME +11\n\t\tld\t(hl), a"),
        # momiaDesaparece: близнец momiaSuicida (CONTROL+1=8, dec TIMER+17[Z], read, FRAME+11=0Ah imm).
        ("momiaDesaparece:\n\t\tld\t(ix+ACTOR_CONTROL), 8 ;\tAnda a la derecha\n\n\t\tdec\t(ix+ACTOR_TIMER) ; Decrementa el tiempo\tde exploxion\n\n\t\tld\ta, (ix+ACTOR_TIMER)",
         "momiaDesaparece:\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S3b\n\t\tinc\thl\t; ->ACTOR_CONTROL +1\n\t\tld\t(hl), 8\n\t\tld\tde, 10h\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n\t\tdec\t(hl)\n\t\tld\ta, (hl)"),
        ("\t\tld\t(ix+ACTOR_FRAME), 0Ah ;\tDestello desaparece",
         "\t\tld\thl, (z80_ix)\n\t\tld\tde, 0Bh\n\t\tadd\thl, de\t; ->ACTOR_FRAME +11\n\t\tld\t(hl), 0Ah\t; Destello desaparece"),
        # momiaPiensa ИСКЛЮЧЁН: piensa_timer (ld a,(ix+TIMER)) НЕ цикло-чувствителен (NOP-тест
        # чист), но его нативная перепись расходится даже при сохранении HL+DE ИЛИ il_a+il_tmp2
        # по отдельности (флаги пересоздаёт `or a`, но всё равно ломает) — нужна полная
        # эмуляция-эквивалентная сохранность = ноль экономии. Механизм не пойман; не стоит.
    ]
    for _o, _n in (_s3b if not _IXOFF else []):
        assert _o in src, "IX-deemu S3b shape changed: " + _o[:24]
        src = src.replace(_o, _n, 1)

    # --- IX-DEEMU Шаг 4: setSentEsc + momiaDecide2/4 (чистая AI-логика) ---
    # setSentEsc: ловля лестницы (read CONTROL+1, write SENT_ESC+0F, write CONTROL+1). HL
    #   мёртв: ret -> updateMomiaAtr (первая инстр. ld c,(ix+Y) не читает HL); rra берёт
    #   только бит0 CONTROL (входной CY -> бит7 A, затирается ld a,c).
    # momiaDecide2: cp ROOM+6 / cp X+5 (cmp m пересоздаёт ВСЕ флаги; A=Prota* сохранён;
    #   HL мёртв — buscaProta затирает до, ld hl,ProtaY перегружает после). Класс momiaDecide.
    # momiaDecide4: write CONTROL+1, далее ld c,a; ld hl,ProtaY (HL мёртв). A сохранён.
    _S4_SS_OLD = 'setSentEsc:\n\t\tld\ta, (ix+ACTOR_CONTROL) ;\t1 = Arriba, 2 =\tAbajo, 4 = Izquierda, 8\t= Derecha\n\t\trra\t\t\t; Pasa control ARRIBA al carry\n\t\tld\ta, c\n\t\tld\tb, 8\t\t; Control: DERECHA\n\t\tjr\tnc, setSentEsc2\t; No tiene ARRIBA apretado\n\n\t\tld\tb, 4\t\t; Control: IZQUIERDA\n\t\txor\t1\n\nsetSentEsc2:\n\t\tand\t1\n\t\tld\t(ix+ACTOR_SENT_ESC), a ; Sentido en el que van las escaleras. 0\t= \\  1 = /\n\t\tand\ta\n\t\tld\ta, b\n\t\tjr\tz, setSentEsc3\n\t\txor\t0Ch\t\t; Cambia sentido del movimiento\n\nsetSentEsc3:\n\t\tld\t(ix+ACTOR_CONTROL), a ;\t1 = Arriba, 2 =\tAbajo, 4 = Izquierda, 8\t= Derecha\n\t\tret'
    _S4_SS_NEW = 'setSentEsc:\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S4 setSentEsc\n\t\tinc\thl\t\t; ->ACTOR_CONTROL +1\n\t\tld\ta, (hl)\n\t\trra\t\t\t; Pasa control ARRIBA al carry\n\t\tld\ta, c\n\t\tld\tb, 8\t\t; Control: DERECHA\n\t\tjr\tnc, setSentEsc2\t; No tiene ARRIBA apretado\n\n\t\tld\tb, 4\t\t; Control: IZQUIERDA\n\t\txor\t1\n\nsetSentEsc2:\n\t\tand\t1\n\t\tld\thl, (z80_ix)\t; NAT S4\n\t\tld\tde, 0Fh\n\t\tadd\thl, de\t\t; ->ACTOR_SENT_ESC +15\n\t\tld\t(hl), a\t\t; Sentido escaleras 0=\\ 1=/\n\t\tand\ta\n\t\tld\ta, b\n\t\tjr\tz, setSentEsc3\n\t\txor\t0Ch\t\t; Cambia sentido del movimiento\n\nsetSentEsc3:\n\t\tld\thl, (z80_ix)\t; NAT S4\n\t\tinc\thl\t\t; ->ACTOR_CONTROL +1\n\t\tld\t(hl), a\n\t\tret'
    _S4_D2_OLD = 'momiaDecide2:\n\t\tld\ta, (ProtaRoom)\t; Parte\talta de\tla coordenada X. Indica\tla habitacion de la piramide\n\t\tcp\t(ix+ACTOR_ROOM)\n\t\tjr\tnz, momiaDecide3 ; estan en habitaciones distintas\n\n\t\tld\ta, (ProtaX)\n\t\tcp\t(ix+ACTOR_X)\t; Compara la X del prota con la\tX de la\tmomia\n\n'
    _S4_D2_NEW = 'momiaDecide2:\n\t\tld\ta, (ProtaRoom)\t; habitacion piramide\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S4\n\t\tld\tde, 6\n\t\tadd\thl, de\t\t; ->ACTOR_ROOM +6\n\t\tcp\t(hl)\t\t; cmp m: flags=cp, A conservado\n\t\tjr\tnz, momiaDecide3 ; estan en habitaciones distintas\n\n\t\tld\ta, (ProtaX)\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S4\n\t\tld\tde, 5\n\t\tadd\thl, de\t\t; ->ACTOR_X +5\n\t\tcp\t(hl)\t\t; Compara X prota con X momia\n\n'
    _S4_D4_OLD = '\t\tld\t(ix+ACTOR_CONTROL), a ;\tFija la\tdireccion que debe seguir la momia para\tacercarse al prota'
    _S4_D4_NEW = '\t\tld\thl, (z80_ix)\t; NAT IX->HL S4 momiaDecide4\n\t\tinc\thl\t\t; ->ACTOR_CONTROL +1\n\t\tld\t(hl), a\t\t; direccion hacia el prota'
    _S4ON = (not _IXOFF) and (not _osg.environ.get('KV_NO_S4'))
    _s4 = [
        (_S4_SS_OLD, _S4_SS_NEW),
        (_S4_D2_OLD, _S4_D2_NEW),
        (_S4_D4_OLD, _S4_D4_NEW),
    ]
    for _o, _n in (_s4 if _S4ON else []):
        assert _o in src, "IX-deemu S4 shape changed: " + _o[:24]
        src = src.replace(_o, _n, 1)

    # --- IX-DEEMU Шаг 8: momiaAnda/momiaAnda2/momiaAnda3 НАТИВНЫЙ (env KV_NO_ANDA) ---
    # momiaAnda — state-0 хендлер главной ветки движения (dispatched jumpIndex, feeds
    # chkCae/mueveElemento/updateMomiaAtr). РАНЬШЕ отвергался whole-game гейтом как
    # «цикло-чувствительный» (одиночный nop в любой точке двигал game-state) — но это
    # ЛОЖНЫЙ блокер: расхождение = benign timing-reseed детерминир. игры, а НЕ логич.
    # ошибка (класс updateMomiaAtr, Шаг 7). Верификация — ЛОГИЧЕСКОЙ эквивалентностью
    # tools/verify/block_equiv.js (инъекция game-state в эмул./натив, прогон до RET,
    # сравнение персист. game-RAM) => 0 расхождений => конверсия КОРРЕКТНА.
    #
    # multi-entry: momiaAnda2/momiaAnda3 — НЕ независимые dispatch-точки, только внутренние
    # jr-цели (dw-таблица содержит лишь momiaAnda). Цепочка momiaAnda→(nz)momiaAnda2→
    # (nz)momiaAnda3. 6 доступов (ix+d), ВСЕ в контексте МЁРТВЫХ HL/DE:
    #   HL: перезагружается pop hl @momiaAnda3, либо push ix/pop hl (fall-through) / getYMomia
    #       (tryToJump) — значение регистра HL на входе никогда не читается до перезаписи.
    #   DE: перезагружается ld de,vecesDudaMomia (ветка timer==0); в ветке anda2/3 не читается
    #       (evitaSorpresa работает в alt-DE через exx; push ix/pop hl не трогает DE) до
    #       перезаписи -> клобберим свободно. BC не трогаем. A грузится заново каждый доступ.
    #   Читаемые/пишемые поля: TIMER(0x11 read/RMW/write), STATUS(0 write), TIPO(0x14 read),
    #   CONTROL(1 read). Флаги пересоздаются след. инстр. (or a / bit 4,a) -> carry-in безразличен.
    _ANDA_OLD = ('momiaAnda:\n\t\tld\ta, (ix+ACTOR_TIMER)\n\t\tor\ta\t\t; Esta andando?\n'
                 '\t\tjr\tnz, momiaAnda2\t; si\n\n'
                 '\t\tld\t(ix+ACTOR_STATUS), 7 ; Estado: Pensando\n'
                 '\t\tld\ta, (ix+ACTOR_TIPO) ; Tipo de momia\n\t\tld\tde, vecesDudaMomia\n'
                 '\t\tcall\tADD_A_DE\n\t\tld\ta, (de)\t\t; Segun\tel tipo\tde momia, duda o mira mas tiempo a los lados\n'
                 '\t\tld\t(ix+ACTOR_TIMER), a ; Veces que\tmira a los lados\n\t\tret\n\n'
                 'momiaAnda2:\n\t\tld\ta, (timer)\n\t\tand\t0Fh\n\t\tjr\tnz, momiaAnda3\n\n'
                 '\t\tdec\t(ix+ACTOR_TIMER) ; Cada\t16 iteraciones decrementa el tiempo de andar\n\n'
                 'momiaAnda3:\n\t\tpop\thl\t\t; Saca de la pila la rutina que\tactualiza los atributos\tde la momia\n'
                 '\t\tcall\tevitaSorpresa\t; Evita\tque una\tmomia aparezca por un lateral cuando el\tprota esta cerca\n\n'
                 '\t\tld\thl, updateMomiaAtr ; Funcion que actualiza los atributos RAM del sprite\tde la momia\n'
                 '\t\tpush\thl\t\t; Guarda la funcion en la pila para ejecutar al\tterminar el proceso\n\n'
                 '\t\tld\ta, (ix+ACTOR_CONTROL) ;\t1 = Arriba, 2 =\tAbajo, 4 = Izquierda, 8\t= Derecha\n'
                 '\t\tbit\t4, a\t\t; Boton\tA:Orden\tde saltar\n'
                 '\t\tjp\tnz, tryToJump\t; Salta\tsi no hay obstaculos\n')
    _ANDA_NEW = ('momiaAnda:\n'
                 '\t\tld\thl, (z80_ix)\t; NAT ANDA IX->HL (HL muerto: pop hl @anda3 / push ix)\n'
                 '\t\tld\tde, ACTOR_TIMER\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n'
                 '\t\tld\ta, (hl)\n\t\tor\ta\t\t; Esta andando?\n'
                 '\t\tjr\tnz, momiaAnda2\t; si\n\n'
                 '\t\tld\thl, (z80_ix)\t; NAT ANDA\n\t\tld\t(hl), 7\t; ACTOR_STATUS = Pensando\n'
                 '\t\tld\thl, (z80_ix)\t; NAT ANDA\n\t\tld\tde, ACTOR_TIPO\n\t\tadd\thl, de\t; ->ACTOR_TIPO +20\n'
                 '\t\tld\ta, (hl)\t; Tipo de momia\n\t\tld\tde, vecesDudaMomia\n'
                 '\t\tcall\tADD_A_DE\n\t\tld\ta, (de)\t\t; Segun el tipo de momia\n'
                 '\t\tld\thl, (z80_ix)\t; NAT ANDA (A conservado)\n\t\tld\tde, ACTOR_TIMER\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n'
                 '\t\tld\t(hl), a\t\t; Veces que mira a los lados\n\t\tret\n\n'
                 'momiaAnda2:\n\t\tld\ta, (timer)\n\t\tand\t0Fh\n\t\tjr\tnz, momiaAnda3\n\n'
                 '\t\tld\thl, (z80_ix)\t; NAT ANDA\n\t\tld\tde, ACTOR_TIMER\n\t\tadd\thl, de\t; ->ACTOR_TIMER +17\n'
                 '\t\tdec\t(hl)\t\t; Cada 16 iteraciones decrementa el tiempo de andar\n\n'
                 'momiaAnda3:\n\t\tpop\thl\t\t; Saca de la pila la rutina updateMomiaAtr\n'
                 '\t\tcall\tevitaSorpresa\t; Evita que una momia aparezca por un lateral\n\n'
                 '\t\tld\thl, updateMomiaAtr ; Funcion que actualiza los atributos RAM\n'
                 '\t\tpush\thl\t\t; Guarda la funcion en la pila\n\n'
                 '\t\tld\thl, (z80_ix)\t; NAT ANDA\n\t\tinc\thl\t\t; ->ACTOR_CONTROL +1\n'
                 '\t\tld\ta, (hl)\t; 1=Arriba 2=Abajo 4=Izq 8=Der\n'
                 '\t\tbit\t4, a\t\t; Boton\tA:Orden\tde saltar\n'
                 '\t\tjp\tnz, tryToJump\t; Salta\tsi no hay obstaculos\n')
    _ANDAON = (not _IXOFF) and (not _osg.environ.get('KV_NO_ANDA'))
    if _ANDAON:
        assert _ANDA_OLD in src, "IX-deemu ANDA momiaAnda shape changed"
        src = src.replace(_ANDA_OLD, _ANDA_NEW, 1)

    # --- IX-DEEMU Шаг 6: saltoUpdate3 (физика прыжка, но НЕ цикло-чувствительна) ---
    # NOP-тест saltoUpdate3 head = 0 расхождений (не такт-зависима), при этом РЕАЛЬНО
    # исполняется (порча ACTOR_STATUS в ней -> 34 байт-кадра расхождения). Три записи
    # jump-указателя: (ix+0Ah)=E, (ix+0Bh)=D, (ix+0Ch)=1. Регистры на входе:
    #   HL МЁРТВ — вызыватель momiaSaltando восстанавливает HL из стека (pop hl 8416)
    #     после ret из doSalto; регистровый HL здесь = мусор Y-указателя saltoUpdateY.
    #   DE ЖИВОЙ (=указатель таблицы valoresSalto) — нужен для ld a,(de) и петли
    #     saltoUpdate2 (dec de). НЕ трогать DE -> идём по HL через inc (не add hl,de).
    #   A/флаги мёртвы (ld a,(de)+cp пересоздают). BC не трогаем.
    # Идём HL от z80_ix: +0Ah=10*inc, пишем E; inc->+0Bh пишем D; после ret nz HL
    # уцелел на +0Bh -> inc ->+0Ch пишем 1. Значения-указатели попадают в benign-маску
    # гейта (сдвиг valoresSalto), а сам факт исполнения/поле 0Ch верифицируются движением.
    _s6_old = ('saltoUpdate3:\n\t\tld\t(ix+0Ah), e\n\t\tld\t(ix+0Bh), d\t; Guarda puntero a los desplazamientos del salto\n'
               '\t\tld\ta, (de)\n\t\tcp\t0FEh\t\t; Ha llegado al\tfinal de la tabla? (Punto mas alto del salto)\n'
               '\t\tret\tnz\t\t; No\n\n\t\tld\t(ix+0Ch), 1\t; Cambia el sentido del\tsalto. Comienza\ta caer')
    _s6_new = ('saltoUpdate3:\n\t\tld\thl, (z80_ix)\t; NAT IX->HL S6 (HL muerto: caller lo restaura de pila)\n'
               '\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\t; ->+0Ah (MOV_CNT/puntero salto low)\n'
               '\t\tld\t(hl), e\t; +0Ah\n\t\tinc\thl\n\t\tld\t(hl), d\t; +0Bh puntero salto high\n'
               '\t\tld\ta, (de)\n\t\tcp\t0FEh\t\t; Ha llegado al\tfinal de la tabla? (Punto mas alto del salto)\n'
               '\t\tret\tnz\t\t; No\n\n\t\tinc\thl\t; +0Bh->+0Ch (HL ucelo tras ret nz)\n\t\tld\t(hl), 1\t; Cambia el sentido del salto. Comienza a caer')
    _S6ON = (not _IXOFF) and (not _osg.environ.get('KV_NO_S6'))
    if _S6ON:
        assert _s6_old in src, "IX-deemu S6 saltoUpdate3 shape changed"
        src = src.replace(_s6_old, _s6_new, 1)

    # --- SOFT-VDP Stage2: loadAnimation -> нативный vec_spr_load (спрайты в vec_spr_buf,
    # без VDP/funnel/vec_vram_write). ex de,hl оставляем (DE=GFX ptr). ---
    _spr_old = "\t\tld\thl, 1800h\n\t\tpush\thl\n\t\tcall\tunpackGFXset\n\t\tpop\thl"
    assert src.count(_spr_old) == 1, "loadAnimation sprite-load shape changed: %d" % src.count(_spr_old)
    # MIRCACHE: пересобираем зеркальный кэш СРАЗУ после (пере)загрузки спрайтов. loadAnimation
    # всегда исполняется после GFX_MOMIA (fall-through на старте уровня) и при КАЖДОЙ смене
    # анимации героя -> mir всегда свеж (hero+momia) до отрисовки. Клоббер тот же (A/BC/DE/HL).
    _spr_new = "\t\tcall\tvec_spr_load\n\t\tcall\tvec_spr_mkmir" if _MIRON else "\t\tcall\tvec_spr_load"
    src = src.replace(_spr_old, _spr_new, 1)

    # --- ФИКС ПОЛОСЫ на экране карты (p2-невидимая палитра): pat_shadow сидит в ВИДИМОЙ p2,
    # на карте (нет спрайтов) светится серым (idx 2/6/10/14=цвет-A). setupPergamino ставит
    # p2/p3-невидимую палитру -> полоса не видна; setupStage возвращает A+ (p2 видима для спрайтов). ---
    _perg_old = "setupPergamino:\n\t\tcall\thideSprAttrib"
    assert src.count(_perg_old) == 1, "setupPergamino shape changed"
    # PALVBL: взвести флаг (палитра меню применится в VBlank-ISR), а не звать mid-frame.
    _perg_pal = "\t\tld\ta, 2\n\t\tld\t(vec_pal_pending), a" if _PALVBL else "\t\tcall\tvec_setpal_menu"
    # MAPPULSE: на входе в карту ПАТЧИМ первые 3 байта vec_brillo_pal (`ld a,(GameStatus)` = 3A LL HH)
    # на `jp vbp_map` (C3 LL HH) -> ISR на карте гонит пульс силуэта/стрелки. di вокруг патча (иначе
    # VBlank мог бы исполнить полу-патченный jp). Восстанавливается в setupStage (см. ниже).
    _perg_patch = ("\n\t\tdi\n\t\tld\ta, 0C3h\n\t\tld\t(vec_brillo_pal), a"
                   "\n\t\tld\thl, vbp_map\n\t\tld\t(vec_brillo_pal+1), hl\n\t\tei") if _MAPPULSE else ""
    src = src.replace(_perg_old, "setupPergamino:\n" + _perg_pal + _perg_patch + "\n\t\tcall\thideSprAttrib", 1)
    # Часть 2 (_MAPCOLOR): после загрузки colorTableMap (tilemode карты заполнен) — взвести white-бит
    # тайлам-линиям (mode2), чтобы штатный блит красил их чёрным-на-белом. Один раз на входе в карту.
    if _MAPCOLOR:
        _mwf_old = ("\t\tld\thl, 600h\t; VRAM address color table pattern #C0\n"
                    "\t\tcall\tUnpackPatterns\t; Descomprime tabla de colores")
        assert src.count(_mwf_old) == 1, "setupPergamino colour-load shape changed: %d" % src.count(_mwf_old)
        src = src.replace(_mwf_old, _mwf_old + "\n\t\tcall\tvec_map_whiteforce", 1)
    _stg_old = "setupStage:\n\t\txor\ta"
    assert src.count(_stg_old) == 1, "setupStage shape changed"
    _stg_pal = "\t\tld\ta, 1\n\t\tld\t(vec_pal_pending), a" if _PALVBL else "\t\tcall\tvec_setpal_a"
    # MAPPULSE: на входе в этап ВОССТАНАВЛИВАЕМ пристинные 3 байта vec_brillo_pal -> геймплейный ISR
    # снова байт-в-байт база (honest_diff=0). Выполняется ДО первого геймплейного кадра.
    _stg_unpatch = ("\t\tdi\n\t\tld\ta, 03Ah\n\t\tld\t(vec_brillo_pal), a"
                    "\n\t\tld\thl, GameStatus\n\t\tld\t(vec_brillo_pal+1), hl\n\t\tei\n") if _MAPPULSE else ""
    src = src.replace(_stg_old, "setupStage:\n" + _stg_unpatch + _stg_pal + "\n\t\txor\ta", 1)

    # --- SOFT-VDP Stage3: UnpackPatterns -> нативный vec_pat_load (паттерны в pat-кэш,
    # без VDP/funnel). jp-префикс (старое тело 3-банк.цикла становится мёртвым). ---
    _pat_old = "UnpackPatterns:\n\t\tld\tb, 3"
    assert src.count(_pat_old) == 1, "UnpackPatterns shape changed: %d" % src.count(_pat_old)
    # СТАДИЯ 4 soft-VDP (загрузочный funnel). ВЫВОД РАССЛЕДОВАНИЯ (task-4-report):
    #  1) Загрузчик УЖЕ нативен: UnpackPatterns -> unpackGFX -> DEtoVRAM/fillVRAM_DE попадают в
    #     BULK-роутеры de_fast/vec_fill_col, которые пишут ПРЯМО в кэши (vec_col_store->mixbuf для
    #     цвета, pat_base для паттернов), БЕЗ per-byte soft-VDP диспетчера vec_vram_write.
    #  2) pat_shadow УЖЕ эвакуирован из p2: под _MAPDIRECT pat_base->pb_p2->pat_menu_base (work-RAM);
    #     0xC900 = видеопамять плоскости 2 (пишет только рендерер/очистка, доказано mixbuf_trap/0xC900).
    #  Единственное, что осталось нативизировать — ИЗБЫТОЧНЫЕ 3 банк-прохода UnpackPatterns: кэши
    #  сворачивают банк (H&7), поэтому банки 1,2 переписывают те же адреса. Урезаем 3->1 проход:
    #  БАЙТ-ИДЕНТИЧНЫЙ кэш (cache-гейт: 0 diffs титул+геймплей), переиспользует верифицированные
    #  bulk-роутеры (нулевой риск порчи mixbuf), экономит load-time. РИСКОВАННЫЙ reroute к новому
    #  vec_pat_wr (простой) ЛОМАЛ mixbuf (корень: цвет-потоки COLOR_InGame/ATTRIB_Menu/... шли в
    #  pat-кэш вместо vec_col_store; трап: 294 записи/98 адресов vec_col_store пропадали = 98 diffs).
    #  KV_NATLOAD_REPRO — диагностика: включить именно этот сломанный reroute (для mixbuf_trap.js).
    #  ЭТО ЗАВЕДОМО БИТЫЙ ПУТЬ (ломает цвет/mixbuf) — НЕ рабочая ветка, только для воспроизведения
    #  бага. В обычной сборке НЕ выставлять. Предупреждаем на stderr, чтобы случайная активация
    #  не прошла незамеченной (тихий битый mixbuf в бинарнике).
    if _os_pv.environ.get('KV_NATLOAD_REPRO'):
        sys.stderr.write("WARNING: KV_NATLOAD_REPRO=1 -> ЗАВЕДОМО БИТЫЙ reroute vec_pat_wr "
                         "(mixbuf/цвет порча), только для mixbuf_trap.js диагностики, НЕ для релиза\n")
        src = src.replace(_pat_old, "UnpackPatterns:\n\t\tjp\tvec_pat_load\n\t\tld\tb, 3", 1)
    elif _NATLOAD:
        src = src.replace(_pat_old, "UnpackPatterns:\n\t\tld\tb, 1", 1)

    # --- IX-DEEMU Шаг 7: updateMomiaAtr НАТИВНЫЙ (env KV_NO_UMA для отката) ---
    # ГОРЯЧАЯ точка: 5 доступов (ix+d) каждый кадр на каждую мумию, пишет enemyAttrib.
    # РАНЬШЕ отвергался whole-game гейтом как «цикло-чувствительный» (nop-тест давал
    # расхождение game-state). НО это ЛОЖНЫЙ блокер: whole-game расхождение = benign
    # timing-reseed детерминированной игры, а НЕ логическая ошибка. Верификация —
    # ЛОГИЧЕСКОЙ эквивалентностью (tools/verify/block_equiv.js): инъекция одинакового
    # game-state в эмул./натив, прогон до RET, сравнение персистентной game-RAM =>
    # 0 расхождений на 120 снимках => конверсия КОРРЕКТНА.
    #
    # Читаемые поля: ACTOR_Y+3, ACTOR_X+5, ACTOR_ROOM+6, ACTOR_FRAME+0Bh, ACTOR_SENTIDO+2.
    # z80_ix = указатель структуры мумии (стабилен в теле хендлера). Контракт (ix+d)
    # эмуляции (бережёт HL/A/флаги, DE/BC не трогает) воспроизведён ПОФАЗНО:
    #   [1][2] Y->C, X->B на входе: HL мёртв (getMomiaAtrib сразу перегружает HL из
    #     enemyAttrib), DE мёртв (перегружается ld de,framesMomia) -> inc hl x5, DE не трогаем.
    #     getMomiaAtrib/ADD_A_HL НЕ трогают BC/DE -> C,B доживают до ld (hl),c/b.
    #   [3] cp ROOM: HL=enemyAttrib ЖИВ -> push/pop hl; cmp m даёт флаги cp, A сохранён;
    #     pop hl НЕ трогает флаги (i8080 POP rp) -> jr nz корректен. DE мёртв -> ld de,6.
    #   [4] read FRAME: HL=enemyAttrib ЖИВ -> push/pop hl; ld a,(hl) не трогает флаги
    #     (push af ниже сохраняет A; восстановленные флаги мертвы — ADD_A_DE их пересоздаёт).
    #     DE мёртв -> ld de,0Bh.
    #   [5] read SENTIDO: HL=enemyAttrib+2 ЖИВ (ld (hl),a ниже) -> push/pop hl; D=frame
    #     ЖИВ (ld a,d ниже) -> НЕ трогаем DE, идём inc hl x2. rra после берёт только бит0
    #     SENTIDO в carry (A тут же затирается ld a,d) -> carry-in безразличен.
    _UMA_OLD = ('updateMomiaAtr:\n\t\tld\tc, (ix+ACTOR_Y)\n\t\tld\tb, (ix+ACTOR_X)\n'
                '\t\tcall\tgetMomiaAtrib\n\n'
                '\t\tld\ta, (ProtaRoom)\t; Parte\talta de\tla coordenada X. Indica\tla habitacion de la piramide\n'
                '\t\tcp\t(ix+ACTOR_ROOM)\n\t\tjr\tnz, hideMomia\t; No estan en la misma habitacion\n\n'
                '\t\tdec\tc\n\t\tdec\tc\t\t; Y = Y\t- 2\n'
                '\t\tld\ta, (ix+ACTOR_FRAME)\n\t\tpush\taf\n'
                '\t\trra\t\t\t; Si el\tframe es par, mueve la momia un\tpoco hacia arriba\n'
                '\t\tjr\tc, updateMomiaAt2\n\t\tinc\tc\n\n'
                'updateMomiaAt2:\n\t\tpop\taf\n\t\tld\tde, framesMomia\n\t\tcall\tADD_A_DE\n'
                '\t\tld\ta, (de)\n\t\tld\td, a\t\t; Frame\n'
                '\t\tld\t(hl), c\t\t; Coordenada Y\n\t\tinc\thl\n\t\tld\t(hl), b\t\t; Coordenada X\n\t\tinc\thl\n'
                '\t\tld\ta, (ix+ACTOR_SENTIDO) ;\t1 = Izquierda, 2 = Derecha\n'
                '\t\trra\n\t\tld\ta, d\n\t\tjr\tnc, setFrameMomia\n'
                '\t\tadd\ta, 60h\t\t; Desplazamiento a sprites invertidos\n')
    _UMA_NEW = ('updateMomiaAtr:\n'
                '\t\tld\thl, (z80_ix)\t; NAT UMA IX->HL: puntero estructura momia\n'
                '\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\t; ->ACTOR_Y +3\n'
                '\t\tld\tc, (hl)\t\t; C = Coordenada Y\n'
                '\t\tinc\thl\n\t\tinc\thl\t; ->ACTOR_X +5\n'
                '\t\tld\tb, (hl)\t\t; B = Coordenada X\n'
                '\t\tcall\tgetMomiaAtrib\n\n'
                '\t\tld\ta, (ProtaRoom)\t; habitacion piramide\n'
                '\t\tpush\thl\t\t; NAT UMA: preserva puntero enemyAttrib\n'
                '\t\tld\thl, (z80_ix)\n\t\tld\tde, 6\n\t\tadd\thl, de\t; ->ACTOR_ROOM +6\n'
                '\t\tcp\t(hl)\t\t; cmp m: flags=cp ROOM, A conservado\n'
                '\t\tpop\thl\n\t\tjr\tnz, hideMomia\t; No estan en la misma habitacion\n\n'
                '\t\tdec\tc\n\t\tdec\tc\t\t; Y = Y\t- 2\n'
                '\t\tpush\thl\t\t; NAT UMA: preserva enemyAttrib\n'
                '\t\tld\thl, (z80_ix)\n\t\tld\tde, 0Bh\n\t\tadd\thl, de\t; ->ACTOR_FRAME +11\n'
                '\t\tld\ta, (hl)\t; A = Frame\n\t\tpop\thl\n'
                '\t\tpush\taf\n'
                '\t\trra\t\t\t; Si el\tframe es par, mueve la momia un\tpoco hacia arriba\n'
                '\t\tjr\tc, updateMomiaAt2\n\t\tinc\tc\n\n'
                'updateMomiaAt2:\n\t\tpop\taf\n\t\tld\tde, framesMomia\n\t\tcall\tADD_A_DE\n'
                '\t\tld\ta, (de)\n\t\tld\td, a\t\t; Frame\n'
                '\t\tld\t(hl), c\t\t; Coordenada Y\n\t\tinc\thl\n\t\tld\t(hl), b\t\t; Coordenada X\n\t\tinc\thl\n'
                '\t\tpush\thl\t\t; NAT UMA: preserva enemyAttrib+2 (D=frame vivo)\n'
                '\t\tld\thl, (z80_ix)\n\t\tinc\thl\n\t\tinc\thl\t; ->ACTOR_SENTIDO +2\n'
                '\t\tld\ta, (hl)\t; A = Sentido (1=Izq 2=Der)\n\t\tpop\thl\n'
                '\t\trra\n\t\tld\ta, d\n\t\tjr\tnc, setFrameMomia\n'
                '\t\tadd\ta, 60h\t\t; Desplazamiento a sprites invertidos\n')
    _UMAON = (not _IXOFF) and (not _osg.environ.get('KV_NO_UMA'))
    if _UMAON:
        assert _UMA_OLD in src, "IX-deemu UMA updateMomiaAtr shape changed"
        src = src.replace(_UMA_OLD, _UMA_NEW, 1)

    # --- IX-DEEMU Шаг 8: momiaUpdate НАТИВНЫЙ (env KV_NO_MU для отката) ---
    # ГОРЯЧАЯ точка: вызывается каждый кадр на каждую мумию; питает mueveElemento
    # (через ЕДИНСТВЕННЫЙ общий mueveElemento — тот сам делает push ix/pop ix и читает
    # (ix±d) относительно z80_ix, но momiaUpdate z80_ix НЕ трогает -> downstream цел).
    # РАНЬШЕ отвергался whole-game гейтом как «цикло-чувствительный» (натив DE верен,
    # но связка расходилась). Это ЛОЖНЫЙ блокер: whole-game расхождение = benign
    # timing-reseed детерминированной игры, а НЕ логическая ошибка. Верификация —
    # ЛОГИЧЕСКОЙ эквивалентностью (tools/verify/block_equiv.js): прогон momiaUpdate до RET
    # (включая вложенный mueveElemento/momiaCalcFrame) на идентичном game-state в
    # эмул./натив, сравнение персистентной game-RAM => 0 расхождений => конверсия верна.
    #
    # Тело: 2 доступа (ix+d) — ld e,(ix+7)=SPEEDXDEC, ld d,(ix+8)=SPEED_X (DE=скорость).
    # Далее ld a,4; call getVariableMomia (перегружает HL из pMomiaProceso, A); call
    # mueveElemento; call momiaCalcFrame; ret. Контракт эмуляции (ix+d) — бережёт HL/A/
    # флаги, DE/BC не трогает — здесь НЕ требует push/pop:
    #   HL МЁРТВ на входе (был указатель ACTOR_STRESS; getVariableMomia сразу перегружает
    #     HL из pMomiaProceso) -> свободно walk'аем HL от z80_ix.
    #   A МЁРТВ (был stress; ld a,4 затирает до любого чтения) -> не трогаем.
    #   Флаги МЁРТВЫ (getVariableMomia: ld hl,(pMomiaProceso) не читает флаги; ld a,4
    #     не меняет; между входом и ld a,4 флаги не читаются) -> add hl,de безвреден.
    #   DE ЗАГРУЖАЕТСЯ здесь же (velocity) -> ld de,7 как scratch для add, затем
    #     ld e,(hl)/ld d,(hl) перекрывают -> итог DE=velocity, идентично эмуляции.
    #   z80_ix НЕ модифицируется (только чтение) -> mueveElemento видит тот же z80_ix.
    _MU_OLD = ('momiaUpdate:\n\t\tld\te, (ix+ACTOR_SPEEDXDEC)\n'
               '\t\tld\td, (ix+ACTOR_SPEED_X) ;\tDE = Velocidad de la momia\n')
    _MU_NEW = ('momiaUpdate:\n'
               '\t\tld\thl, (z80_ix)\t; NAT MU IX->HL: puntero estructura momia\n'
               '\t\tld\tde, ACTOR_SPEEDXDEC\t; +7\n'
               '\t\tadd\thl, de\t\t; ->ACTOR_SPEEDXDEC +7\n'
               '\t\tld\te, (hl)\t; E = SPEEDXDEC\n'
               '\t\tinc\thl\t\t; ->ACTOR_SPEED_X +8\n'
               '\t\tld\td, (hl)\t; D = SPEED_X  DE = Velocidad de la momia\n')
    _MUON = (not _IXOFF) and (not _osg.environ.get('KV_NO_MU'))
    if _MUON:
        assert _MU_OLD in src, "IX-deemu MU momiaUpdate shape changed"
        src = src.replace(_MU_OLD, _MU_NEW, 1)

    # --- IX-DEEMU Шаг 9: mueveElemento НАТИВНЫЙ (env KV_NO_ME для отката) ---
    # САМЫЙ сложный физ-хендлер: движение элемента (сумма скорости к позиции). Общий для
    # ТРЁХ путей — mueveProta (fall-through), momiaUpdate (мумия) и movKnife (нож). В КАЖДОМ
    # вызыватель ставит HL = P (указатель на поле ACTOR_X_DECIMAL структуры актёра, +4) и
    # DE = скорость (E=децимали, D=целое). z80_ix у вызывателя РАЗНЫЙ (мумия/нож/прота), НО
    # это НЕ важно: оригинал делает `push ix / <load word[HL] into HL> / pop ix` — pop ix
    # ЗАГРУЖАЕТ IX = ИСХОДНЫЙ HL (=P), т.е. переопределяет IX значением P, а НЕ z80_ix
    # вызывателя. Все (ix±d) в теле = P±d (P-2=SENTIDO, P+2=ROOM, P+5=SPEEDROOM, P+1=X[мёртв]).
    # В конце `pop ix` восстанавливает z80_ix вызывателя (net-zero к z80_ix).
    # СЛЕДСТВИЕ: тело зависит ТОЛЬКО от регистров HL(=P) и DE(=скорость); z80_ix только
    # сохраняется/восстанавливается (net-zero). Натив НЕ трогает z80_ix вообще -> он остаётся
    # значением вызывателя всё время (== финальное состояние эмуляции; промежуточное P
    # никогда не наблюдается downstream, т.к. тело прямолинейно, без call). Поэтому ОДИН
    # нативный код корректен для ВСЕХ трёх путей по построению (управляется HL/DE вызывателя).
    #
    # Контракт на выход: DE = новая позиция (D=X, E=децималь). ПУТЬ НОЖА (movKnife) читает
    # `ld a,d` сразу после call -> D=X ОБЯЗАН быть верным (обеспечено: ex de,hl -> DE=newpos,
    # DE далее не трогается). Пути мумии/проты не читают регистры возврата (перезагружают).
    # HL/A/BC на выходе не важны ни одному вызывателю. Мёртвый `ld a,(ix+1)` опущен.
    # Порядок чтений полей переставлен (все чистые чтения, единственная запись — в конце),
    # rra стоит НЕПОСРЕДСТВЕННО перед jr nc (inc hl/ld r,(hl) не трогают флаги в i8080) ->
    # carry (=SENTIDO бит0) доживает до ветвления. Стек сбалансирован на ОБЕИХ ветках.
    _ME_OLD = ('mueveElemento:\n\t\tpush\tix\n\t\tpush\thl\n\t\tpush\thl\n\t\tld\ta, (hl)\n'
               '\t\tinc\thl\n\t\tld\th, (hl)\n\t\tld\tl, a\n\t\tpop\tix\n'
               '\t\tld\tb, (ix+2)\t; Habitacion\n\t\tld\tc, (ix+5)\t; Desplazamiento habitacion\n'
               '\t\tld\ta, (ix-2)\t; Sentido del movimiento\n\t\trra\n'
               '\t\tjr\tnc, mueveElemento2 ; Va\thacia la derecha\n'
               '\t\tld\ta, c\n\t\tcpl\n\t\tld\tc, a\n\t\tld\ta, d\n\t\tcpl\n\t\tld\td, a\n'
               '\t\tld\ta, e\n\t\tcpl\n\t\tld\te, a\n\t\tinc\tde\n\n'
               'mueveElemento2:\n\t\tadd\thl, de\t\t; Suma desplazamiento\n'
               '\t\tld\ta, b\t\t; Habitacion actual\n'
               '\t\tadc\ta, c\t\t; Suma desplazamiento X\talto, por si ha\tcambiado de habitacion\n'
               '\t\tld\tb, a\n\t\tld\ta, (ix+1)\t; Coordenada X\n\t\tex\tde, hl\n\t\tpop\thl\n'
               '\t\tld\t(hl), e\t\t; X decimales\n\t\tinc\thl\n\t\tld\t(hl), d\t\t; X\n'
               '\t\tld\t(ix+2),\tb\t; Room\n\t\tpop\tix\n\t\tret')
    _ME_NEW = ('mueveElemento:\n'
               '\t\tpush\thl\t\t; NAT ME S9: P = puntero ACTOR_X_DECIMAL (+4) para stores\n'
               '\t\tinc\thl\n\t\tinc\thl\t\t; ->P+2 (ACTOR_ROOM)\n'
               '\t\tld\tb, (hl)\t\t; B = Habitacion\n'
               '\t\tinc\thl\n\t\tinc\thl\n\t\tinc\thl\t; ->P+5 (ACTOR_SPEEDROOM)\n'
               '\t\tld\tc, (hl)\t\t; C = Desplazamiento habitacion\n'
               '\t\tpop\thl\n\t\tpush\thl\t\t; HL = P (conserva P en pila)\n'
               '\t\tdec\thl\n\t\tdec\thl\t\t; ->P-2 (ACTOR_SENTIDO)\n'
               '\t\tld\ta, (hl)\t; A = Sentido del movimiento\n'
               '\t\trra\t\t\t; CY = sentido bit0\n'
               '\t\tjr\tnc, mueveElemento2 ; Va\thacia la derecha\n'
               '\t\tld\ta, c\n\t\tcpl\n\t\tld\tc, a\n\t\tld\ta, d\n\t\tcpl\n\t\tld\td, a\n'
               '\t\tld\ta, e\n\t\tcpl\n\t\tld\te, a\n\t\tinc\tde\n\n'
               'mueveElemento2:\n'
               '\t\tpop\thl\n\t\tpush\thl\t\t; HL = P (conserva P para stores)\n'
               '\t\tld\ta, (hl)\t; posword low  = [P]\n'
               '\t\tinc\thl\n\t\tld\th, (hl)\t; posword high = [P+1]\n\t\tld\tl, a\t; HL = posicion actual\n'
               '\t\tadd\thl, de\t\t; Suma desplazamiento\n'
               '\t\tld\ta, b\t\t; Habitacion actual\n'
               '\t\tadc\ta, c\t\t; Suma desplazamiento X\talto, cambio de habitacion\n'
               '\t\tld\tb, a\n'
               '\t\tex\tde, hl\t\t; DE = nueva posicion (E=dec, D=X) contrato cuchillo\n'
               '\t\tpop\thl\t\t; HL = P\n'
               '\t\tld\t(hl), e\t\t; X decimales\n'
               '\t\tinc\thl\n\t\tld\t(hl), d\t\t; X\n'
               '\t\tinc\thl\n\t\tld\t(hl), b\t\t; Room (ACTOR_ROOM = P+2)\n\t\tret')
    _MEON = (not _IXOFF) and (not _osg.environ.get('KV_NO_ME'))
    if _MEON:
        assert _ME_OLD in src, "IX-deemu ME mueveElemento shape changed"
        src = src.replace(_ME_OLD, _ME_NEW, 1)

    # --- Эвакуация p2: тайлсет ТИТУЛА из хвоста теней (0x90-0xC8 -> 0x40-0x78) ---
    # ФАКТ: титул (лого King's Valley + пирамида) грузит свой тайлсет в тайлы 0x90-0xC8,
    # занимая хвост pat/col-теней (0x8c-0xFF, ~1.8К). Игровой лабиринт использует 0x40-0x8b,
    # причём титул и геймплей НЕ показываются одновременно. Сдвигаем тайлсет титула вниз на
    # 0x50 тайлов (VDP-адрес -0x280, tile# -0x50): титул селится в 0x40-0x78 (свободно во
    # время титула — лабиринт не загружен), хвост 0x8c-0xFF в геймплее И в титуле становится
    # мёртвым (пишется только нулевой очисткой initHardware). ТОЛЬКО Vector — MSX pristine.
    # (а) загрузка паттернов титула: VDP 0x2480 (тайл 0x90) -> 0x2200 (тайл 0x40)
    assert "ld\thl, 2480h\t; BG char" in src, "setGfxMenu pattern load shape changed"
    src = src.replace("ld\thl, 2480h\t; BG char",
                      "ld\thl, 2200h\t; BG char (Vector: title tileset 0x90->0x40, p2 tail freed)", 1)
    # (б) загрузка цвета пирамиды титула: VDP 0x480 (тайл 0x90) -> 0x200 (тайл 0x40)
    assert "ld\thl, 480h\t; BG Attrib" in src, "setGfxMenu colour load shape changed"
    src = src.replace("ld\thl, 480h\t; BG Attrib",
                      "ld\thl, 200h\t; BG Attrib (Vector: -0x50 tiles)", 1)
    # (в) таблица цвета лого KING'S VALLEY: 0x44D8 (тайл 0x9B, +write-flag) -> 0x4258 (тайл 0x4B)
    assert "ld\thl, 44D8h" in src, "coloreaLogo colour-table load shape changed"
    src = src.replace("ld\thl, 44D8h", "ld\thl, 4258h", 1)
    # (г) name-table: базовый паттерн лого 0x9B -> 0x4B (KING'S 0x4B-.., VALLEY ..-0x76)
    assert "add\ta, 9Bh" in src, "drawGameLogo base pattern shape changed"
    src = src.replace("add\ta, 9Bh", "add\ta, 4Bh", 1)
    # (д) name-table: нижняя часть буквы G (0xC7 -> 0x77)
    assert "add\ta, 0C7h" in src, "drawGameLogo bottom-of-G shape changed"
    src = src.replace("add\ta, 0C7h", "add\ta, 77h", 1)
    # (е) name-таблица пирамиды титула: тайлы 0x90-0x9A -> 0x40-0x4A
    _piram_old = ("GFX_PiramidLogo:db    0,   0, 93h, 96h,\t  0,   0\n"
                  "\t\tdb    0, 90h, 94h, 97h,\t98h,   0\n"
                  "\t\tdb  91h, 92h, 95h, 99h,\t99h, 9Ah")
    _piram_new = ("GFX_PiramidLogo:db    0,   0, 43h, 46h,\t  0,   0\n"
                  "\t\tdb    0, 40h, 44h, 47h,\t48h,   0\n"
                  "\t\tdb  41h, 42h, 45h, 49h,\t49h, 4Ah")
    assert _piram_old in src, "GFX_PiramidLogo data shape changed"
    src = src.replace(_piram_old, _piram_new, 1)

    # --- Эвакуация p2: тайлсет ЭКРАНА ФИНАЛА (setupEnding, GS=10) тоже из хвоста ---
    # Финальный экран (пирамиды/пол/звезда) — ВТОРОЙ неигровой со-пользователь хвоста:
    # грузит endingTiles/endingColors в тайлы 0x90-0x97 (VDP 0x2480/0x480) и рисует name-
    # таблицу тайлами 0x90-0x97. Сдвигаем ТЕМ ЖЕ -0x50 -> 0x40-0x47 (свободно на финале —
    # лабиринт не загружен), чтобы весь хвост 0x8c-0xFF стал мёртвым во ВСЕХ экранах.
    # Дверь пирамиды (tilesEndDoor 0x63-0x67) НЕ в хвосте — не трогаем. Данные endingTiles/
    # endingColors — это байты паттернов (не tile#), от сдвига адреса загрузки не меняются.
    assert "ld\thl, 2480h\t; VRAM address pattern" in src, "setupEnding pattern load shape changed"
    src = src.replace("ld\thl, 2480h\t; VRAM address pattern",
                      "ld\thl, 2200h\t; VRAM address pattern (Vector: ending tileset 0x90->0x40)", 1)
    assert "ld\thl, 480h\t; VRAM address color" in src, "setupEnding colour load shape changed"
    src = src.replace("ld\thl, 480h\t; VRAM address color",
                      "ld\thl, 200h\t; VRAM address color (Vector: -0x50 tiles)", 1)
    # name-таблица пирамид финала: диагональ/заполнение (drawHalfPiram c и c+1)
    assert "ld\tc, 90h" in src, "setupEnding pyramid tile 0x90 shape changed"
    src = src.replace("ld\tc, 90h", "ld\tc, 40h", 1)
    assert "ld\tc, 92h" in src, "setupEnding pyramid tile 0x92 shape changed"
    src = src.replace("ld\tc, 92h", "ld\tc, 42h", 1)
    assert "ld\tc, 94h" in src, "setupEnding pyramid tile 0x94 shape changed"
    src = src.replace("ld\tc, 94h", "ld\tc, 44h", 1)
    # пол арены (0x96) и звезда (0x97) — сдвиг с якорем по комментарию (0x97 неоднозначен)
    assert "ld\ta, 96h\t\t; Patron suelo de arena" in src, "setupEnding floor tile shape changed"
    src = src.replace("ld\ta, 96h\t\t; Patron suelo de arena",
                      "ld\ta, 46h\t\t; Patron suelo de arena (Vector: -0x50)", 1)
    assert "ld\ta, 97h\t\t; Patron estrella" in src, "setupEnding star tile shape changed"
    src = src.replace("ld\ta, 97h\t\t; Patron estrella",
                      "ld\ta, 47h\t\t; Patron estrella (Vector: -0x50)", 1)

    return src


def main():
    argv = sys.argv[1:]
    target = 'msx'
    pos = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--target':
            target = argv[i + 1]; i += 2; continue
        if a.startswith('--target='):
            target = a.split('=', 1)[1]; i += 1; continue
        pos.append(a); i += 1
    inp, outp = pos[0], pos[1]
    src = open(inp, encoding='latin-1').read()
    if target == 'vector':
        src = _apply_vector_glue(src)
    else:
        # the translated ROM is larger (i8080 expansion) -> 32K cartridge.
        src = src.replace('SIZE    16 * 1024', 'SIZE    32 * 1024')
        src = _apply_msx_glue(src)    # slot-switch + ISR wrapper + VRAM out(98h)
    # ldir/lddr deflation: place the shared copy-loop subroutines in the last code
    # region before the MAP block (RAM fields, no bytes). One MAP directive exists
    # per target (vector: #6B00 after glue; msx: #e000) -> insert before the first.
    src = re.sub(r'(\n\t\tMAP\s+#[0-9A-Fa-f]+)', _LDIR_HELPERS + r'\1', src, count=1)
    # exx approach-B: retag paired-temporary exx into push/pop (exxo/exxc).
    src, _exx_pairs = _classify_exx(src)
    src = translate(src)
    if target == 'vector':
        # i8080-эмуляции scratch (z80 alt/index-регистры + il_tmp/il_tmp2/il_a/il_outstub).
        # РАНЬШЕ жил на 0xDF00 = ПЛОСКОСТЬ 2, col31 (X248-255), y0-15 (offset=col*256+row:
        # hi 0x1F=col31, lo=Y) = ПРАВЫЙ ВЕРХНИЙ УГОЛ HUD. Фаза A+ сделала p2 ВИДИМОЙ (цветные
        # спрайты) -> постоянные scratch-записи (exx/IX-эмуляция) = мерцающий МУСОР в углу HUD.
        # (Прошлый комментарий про «нижний бордюр y=235-255» был ОШИБОЧЕН: low-байт адреса =
        # Y-строка НАПРЯМУЮ, 0x00-0x14 = ВЕРХ экрана = HUD, а не низ.)
        # РЕШЕНИЕ: унести весь scratch в НЕВИДИМУЮ low-RAM (<0x8000).
        #  * il_tmp2 — САМЫЙ хрупкий: ldir-stack-safe-helper (коммит 8114f29) стэшит в него
        #    return-addr во ВРЕМЯ ldir; если заливка накрывает его адрес -> self-clobber ->
        #    derail. Кладём в 0x7EFE (vec_tilemode-2, свободный зазор над vec_mixbuf [конец
        #    0x7EF6] под vec_tilemode [0x7F00]) — ВНЕ boot-fill (GameStatus..+0x6FF =
        #    0x6B00-0x71FF) И ВНЕ MapaRAM-fill (0x7373-0x7C13). write-before-read всегда.
        #  * остальные 8 (z80_ix/iy/af_alt/bc_alt/de_alt/hl_alt/il_tmp/il_a = 16Б) + il_outstub
        #    (3Б) = 19Б -> в dummy_10 (неиспользуемый game-var padding 0x2C=44Б @0x6C04, 0
        #    обращений в источнике). Внутри boot-fill => зануляются раз на boot (безвредно,
        #    все write-before-read; ровно как раньше 0xDF00 зануляла vec_init_clr).
        eqs = ["il_tmp2:\tequ vec_tilemode-2"]   # fill-safe зазор (0x7EFE)
        off = 0
        for n in SCRATCH:
            if n == 'il_tmp2':
                continue
            eqs.append(f"{n}:\tequ dummy_10+{off}")
            off += 2
        eqs.append(f"il_outstub:\tequ dummy_10+{off}")   # 3Б стуб, dummy_10+16..+18
        # ФИКС 2026-07-14: vec_kl_* (Konami-logo decoder scratch, 17Б) — в dummy_10+19..+35
        # (после z80-scratch, в тех же 44Б мёртвого padding). Раньше они лежали в упакованном
        # cells-блоке и утыкались в pat_font_cell(0x7CFF) -> лого затирало паттерн цифры '0'.
        # dummy_10 мёртв в источнике (0 обращений) => не конфликтует ни с игрой, ни с z80-scratch.
        klo = off + 3   # dummy_10+19
        eqs += [
            f"vec_kl_row:\tequ dummy_10+{klo}",
            f"vec_kl_col:\tequ dummy_10+{klo+1}",
            f"vec_kl_low:\tequ dummy_10+{klo+2}",
            f"vec_kl_tn:\tequ dummy_10+{klo+3}",
            f"vec_kl_scr:\tequ dummy_10+{klo+4}",     # 8 bytes -> +4..+11
            f"vec_kl_src:\tequ dummy_10+{klo+12}",    # 2 bytes -> +12..+13
            f"vec_kl_rem:\tequ dummy_10+{klo+14}",
            f"vec_kl_mode:\tequ dummy_10+{klo+15}",
            f"vec_kl_val:\tequ dummy_10+{klo+16}",    # dummy_10+35, конец = +36 (<44)
        ]
        if _PALVBL:
            eqs.append("vec_pal_pending:\tequ dummy_10+36")   # свободный слак dummy_10 (+36..+43), PALVBL
        src += "\n; --- i8080 translation scratch (invisible low-RAM) ---\n" + "\n".join(eqs) + "\n"
    else:
        src += "\n; --- i8080 translation scratch (shadow regs) ---\n" + SCRATCH_DEFS + "\n"
    open(outp, 'w', encoding='latin-1').write(src)
    print(f"translated {inp} -> {outp} (target={target}); "
          f"exx-B push/pop pairs={_exx_pairs}")


if __name__ == '__main__':
    main()
