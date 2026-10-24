# Полное выпиливание soft-VDP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать все остатки soft-VDP из порта King's Valley на Вектор-06Ц — нативный блит прямо во фреймбуфер везде, снести диспетчер и теневые буферы, освободить 2КБ p2.

**Architecture:** Инкрементально, подход A (спека `docs/superpowers/specs/2026-07-22-softvdp-full-removal-design.md`): потребители нативизируются по одному (скролл → титул → бонус), затем рискованный загрузочный funnel, затем снос диспетчера/теней. Каждая нативная конверсия — под `_8COLOR` + свой `KV_NO_*` откат, чтобы OFF-билд оставался байт-эталоном.

**Tech Stack:** Python-транслятор `tools/kv_z80_to_8080.py` (Z80→i8080, генерит sjasm-ассемблер), sjasm (`tools/bin/sjasm`), headless-рендер `tools/verify/vecrender.js` (vector06js-ядро), MiSTer (реальное железо, эталон).

## Global Constraints

- **Единственный редактируемый файл кода:** `tools/kv_z80_to_8080.py`. Всё остальное — `tools/verify/*` (гейты) и `docs/*`.
- **OFF-инвариант (Стадии 1–4):** `KV_8COLOR` не задан → ROM байт-в-байт с `/Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon.rom`. Проверка: `cmp -s <rom> $BASE`. Нарушение = стадия сломала MSX-рекомпиляцию.
- **Гейтинг:** каждая нативная конверсия под `_<FLAG> = _8COLOR and not _os_pv.environ.get('KV_NO_<FLAG>')`. Дефолт — включено в 8C, откат через `KV_NO_<FLAG>=1`.
- **Сборка OFF:** `python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/off.asm --target vector && tools/bin/sjasm /tmp/off.asm /tmp/off.rom` — ожидание `Errors: 0`.
- **Сборка 8C:** `KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/8c.asm --target vector && tools/bin/sjasm /tmp/8c.asm /tmp/8c.rom` — `Errors: 0`, доходит до GS5.
- **GS5-достижимость:** `node tools/verify/vecrender.js /tmp/8c.rom /tmp/x.png 1200` не падает; `GS==5` к кадру ~1117 (скан: `tools/verify/` gsscan-паттерн, читать `memory.read(0x6B00)`).
- **Деплой MiSTer (после каждой успешной стадии):** `cp /tmp/8c.rom /Users/boris/Projects/vector06js/kvv_r3_ef.rom` + `/opt/homebrew/bin/sshpass -p '1' scp /tmp/8c.rom "root@192.168.1.109:/media/fat/games/VECTOR06/King's Valley.rom"` + md5-сверка. Затем `cp /tmp/8c.rom .../base_canon_8c.rom`.
- **Кадры экранов (аттракт без ввода):** Konami 0–485, титул KING'S VALLEY 485–741, карта 741, загрузка 742, демо GS5 1117+.
- **Нельзя** сравнивать framebuffer/game-state между билдами (frame-drop-coupling reseed). Гейты: OFF==база, `softvdp_cache_gate.js` (кэши в точках загрузки), пер-экранный визуал PNG, MiSTer.
- **Шаблоны нативного блита в файле:** `vec_nat_room:` (py~2623, нативная комната из MapaRAM), `vec_text_blit:` (py~2308, тайл→fb, сохраняет HL/DE/BC), `vec_blit_rect:` (py~2338, прямоуг. тайлов), `vec_spr_load:` (py~1834, RLE→кэш без VDP).

---

### Task 1: Стадия 1 — нативный `drawRoom` (скролл GS=9)

**Files:**
- Modify: `tools/kv_z80_to_8080.py` (флаг рядом с `_BRICK2`/`_MUMCOL` ~py196; правка `_apply_vector_glue` drawRoom3-цикла ~py3182)
- Test: `tools/verify/vecrender.js` (визуал), gsscan-паттерн (GS-достижимость)

**Interfaces:**
- Consumes: `vec_text_blit` (HL=name addr, A=tile → блит p0/p1; сохраняет HL,DE,BC), `getTileFromID` (A=tile-ID → A=pattern-tile).
- Produces: флаг `_NATSCROLL`; поведение drawRoom3 — прямой блит без `vec_vram_write`.

- [ ] **Step 1: Зафиксировать текущее (baseline-гейт).** Собрать 8C, отрендерить переход и демо, сохранить эталонные PNG до правки.

```bash
cd /Users/boris/projects/kvalley-v06c
KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/8c.asm --target vector && tools/bin/sjasm /tmp/8c.asm /tmp/8c.rom
node tools/verify/vecrender.js /tmp/8c.rom /tmp/s1_before_demo.png 1400
```
Expected: `Errors: 0`, PNG создан (демо GS5).

- [ ] **Step 2: Расследовать вызов drawRoom на скролл-пути.** Найти, кто входит в drawRoom при GS=9 (`tickScroll`?), и как поддерживается name-addr.

```bash
grep -anE "drawRoom\b|tickScroll|setVDPWrite" /tmp/8c.asm | head -20
sed -n '/^tickScroll:/,/ret/p' /tmp/8c.asm | head -40
```
Expected: увидеть, что drawRoom ставит VDP-ptr `ld hl,3820h; call setVDPWrite`, цикл drawRoom3 = `ld a,(de); call getTileFromID; call vec_vram_write; inc de`. Записать, откуда берётся стартовый name-addr (0x3820) и шаг строки (+0x60).

- [ ] **Step 3: Добавить флаг `_NATSCROLL`.** Рядом с `_MUMCOL` (~py196):

```python
_NATSCROLL = _8COLOR and not _os_pv.environ.get('KV_NO_NATSCROLL')
```

- [ ] **Step 4: Нативизировать drawRoom3 (под флагом, в `_apply_vector_glue`).** Заменить в drawRoom per-tile `call vec_vram_write` на прямой блит `vec_text_blit`, ведя name-addr в HL локально (как геймплейные писатели, py2299). Контракт: HL=текущий name-addr, drawRoom3 пишет тайл и `inc hl`; drawRoom2 после строки делает HL += (0x20 - 0x20 пройдено) уже учтено инкрементами + переход к 0x3820+row*0x20. Шаблон — `vec_nat_room` (py2623) — читает MapaRAM-окно и блитит через тот же `vec_text_blit`. Правка встраивается новым `src.replace(...)` в `_apply_vector_glue`, gated `if _NATSCROLL:`. Точную форму замены вывести из тела drawRoom (Step 2) + шаблона vec_nat_room; сохранить `_COOPSND` coop-тик (он уже в drawRoom2, останется валиден — блит под DI).

- [ ] **Step 5: Гейт OFF==база.** Нативизация только под `_8COLOR`, OFF не тронут.

```bash
python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/off.asm --target vector && tools/bin/sjasm /tmp/off.asm /tmp/off.rom
cmp -s /tmp/off.rom /Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon.rom && echo "OFF==база OK" || echo "СЛОМАЛ OFF"
```
Expected: `OFF==база OK`.

- [ ] **Step 6: Гейт 8C сборка + GS5 + демо.** Собрать, проверить достижимость GS5 и что демо НЕ обрывается раньше базового.

```bash
KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/8c.asm --target vector && tools/bin/sjasm /tmp/8c.asm /tmp/8c.rom
node tools/verify/vecrender.js /tmp/8c.rom /tmp/s1_after_demo.png 1400
```
Expected: `Errors: 0`, PNG демо создан; открыть `/tmp/s1_after_demo.png` — комната отрисована, герой на месте (демо живёт дольше/так же как before).

- [ ] **Step 7: Визуал перехода.** Отрендерить кадр(ы) вокруг перехода между комнатами и убедиться, что комната рисуется целиком (не рвётся).

```bash
for fr in 1120 1160 1200 1400; do node tools/verify/vecrender.js /tmp/8c.rom /tmp/s1_room_$fr.png $fr; done
```
Expected: открыть PNG — фон комнаты полный, HUD цел, спрайты на месте.

- [ ] **Step 8: Откат-флаг работает.** `KV_NO_NATSCROLL=1` даёт прежнее поведение (сборка OK).

```bash
KV_NO_NATSCROLL=1 KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/rb.asm --target vector && tools/bin/sjasm /tmp/rb.asm /tmp/rb.rom && echo "откат OK"
```
Expected: `Errors: 0`, `откат OK`.

- [ ] **Step 9: Деплой на MiSTer + снапшот.**

```bash
cp /tmp/8c.rom /Users/boris/Projects/vector06js/kvv_r3_ef.rom
/opt/homebrew/bin/sshpass -p '1' scp -o ConnectTimeout=8 /tmp/8c.rom "root@192.168.1.109:/media/fat/games/VECTOR06/King's Valley.rom"
L=$(md5 -q /tmp/8c.rom); R=$(/opt/homebrew/bin/sshpass -p '1' ssh -o ConnectTimeout=8 root@192.168.1.109 "md5sum \"/media/fat/games/VECTOR06/King's Valley.rom\"" | cut -d' ' -f1); echo "match=$([ "$L" = "$R" ]&&echo ДА||echo НЕТ)"
```
Expected: `match=ДА`. Пользователь проверяет на железе: скролл плавный, демо не рвётся.

- [ ] **Step 10: Commit** (снапшот `base_canon_8c` обновить ТОЛЬКО после подтверждения на MiSTer).

```bash
cp /tmp/8c.rom /Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon_8c.rom
git add tools/kv_z80_to_8080.py && git commit -m "softvdp Стадия 1: нативный drawRoom-скролл (KV_NO_NATSCROLL)"
```

---

### Task 2: Стадия 2 — нативный титул + раскраска под оригинал

**Files:**
- Modify: `tools/kv_z80_to_8080.py` (флаг ~py196; правка титул-логотипа в `_apply_vector_glue`; палитра титра ~py1482/2502)
- Test: `tools/verify/vecrender.js` (титул кадр 600), `tools/verify/title_idx_probe.js`

**Interfaces:**
- Consumes: `vec_text_blit`; палитра — idx4/idx6/idx14 логотипа (замер `title_idx_probe.js`: idx4=красн, idx6=светлый, idx14=зелён-пирамида).
- Produces: флаг `_NATLOGO`; титул без диспетчера, раскраска под COLORES_LOGO.

- [ ] **Step 1: Замер текущего титра (baseline).**

```bash
node tools/verify/vecrender.js /tmp/8c.rom /tmp/s2_title_before.png 600
node tools/verify/title_idx_probe.js /tmp/8c.rom 600
```
Expected: гистограмма idx4/idx6/idx14; PNG титра.

- [ ] **Step 2: Найти титул-писатели.** Контекст 4 вызовов WRTVRM титула (L1208/1220/2170/2595 = буквы KING'S + drawLogoRow2) и drawGameLogo.

```bash
grep -anE "drawGameLogo|drawLogoRow|WRTVRM" /tmp/8c.asm | sed -n '1,20p'
```
Expected: локализовать `drawLogoRow`/`drawGameLogo` тело.

- [ ] **Step 3: Флаг `_NATLOGO`** (~py196):

```python
_NATLOGO = _8COLOR and not _os_pv.environ.get('KV_NO_NATLOGO')
```

- [ ] **Step 4: Нативизировать drawGameLogo/drawLogoRow.** Заменить `call WRTVRM` в титул-путях на прямой `vec_text_blit` с локальным name-addr (шаблон — уже нативный Konami-логотип `_KONAMI_LOGO` py1086 + `vec_text_blit`). Gated `if _NATLOGO:` в `_apply_vector_glue`. Форму вывести из тела drawLogoRow (Step 2).

- [ ] **Step 5: Раскраска титра под оригинал (данные-палитра).** Логотип кодирует idx4/idx6/idx14 (Step 1). По COLORES_LOGO (тёпл.красн→золото→зелён): на GS=1 держать idx4=красн `05Fh`, idx6=золото `0BFh` (2-тон тёпл.градиент вместо бел.), idx14=золото/зелён пирамида. Применить в титул-палитре (найти активную на GS=1 — `vbp_static`/boot-палитра, ~py2502), НЕ трогая геймплей (vec_pal idx6=бел. остаётся для мумий/гем). Механизм: пер-GS палитра титра или патч idx6 в титул-фазе. Gated `if _NATLOGO:`.

- [ ] **Step 6: Гейт OFF==база.**

```bash
python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/off.asm --target vector && tools/bin/sjasm /tmp/off.asm /tmp/off.rom
cmp -s /tmp/off.rom /Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon.rom && echo "OFF==база OK" || echo "СЛОМАЛ OFF"
```
Expected: `OFF==база OK`.

- [ ] **Step 7: Гейт визуал титра.**

```bash
KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/8c.asm --target vector && tools/bin/sjasm /tmp/8c.asm /tmp/8c.rom
node tools/verify/vecrender.js /tmp/8c.rom /tmp/s2_title_after.png 600
node tools/verify/title_idx_probe.js /tmp/8c.rom 600
```
Expected: открыть PNG — буквы KING'S VALLEY целые, цвет красн+золото (ближе к оригиналу); idx6 теперь золото на титре.

- [ ] **Step 8: Откат.** `KV_NO_NATLOGO=1` собирается.

```bash
KV_NO_NATLOGO=1 KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/rb.asm --target vector && tools/bin/sjasm /tmp/rb.asm /tmp/rb.rom && echo "откат OK"
```
Expected: `откат OK`.

- [ ] **Step 9: Деплой на MiSTer** (команды как Task 1 Step 9). Пользователь смотрит титр на железе.

- [ ] **Step 10: Commit** (после MiSTer-подтверждения).

```bash
cp /tmp/8c.rom /Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon_8c.rom
git add tools/kv_z80_to_8080.py && git commit -m "softvdp Стадия 2: нативный титул + раскраска KING'S VALLEY под оригинал (KV_NO_NATLOGO)"
```

---

### Task 3: Стадия 3 — нативный бонус-экран (межуровневый)

**Files:**
- Modify: `tools/kv_z80_to_8080.py` (флаг ~py196; правки бонус-путей в `_apply_vector_glue`)
- Test: `tools/verify/vecrender.js` (кадр бонус-экрана)

**Interfaces:**
- Consumes: `vec_text_blit`, `vec_blit_rect` (HL=name addr, DE=tile data, B=rows, C=cols).
- Produces: флаг `_NATBONUS`; бонус-экран без диспетчера.

- [ ] **Step 1: Найти когда показывается бонус-экран (GS/кадр).** Бонус = межуровневый reward (дверь `DEtoVRAM_NXNY` L11835 + звезда/пирамида L11851/11893/11929).

```bash
grep -anE "drawHalfPiram|tilesEndDoor|estrella|piramide.*relleno|DEtoVRAM_NXNY|Bonus|bonus" /tmp/8c.asm | head
```
Expected: локализовать бонус-рутину и её GS/триггер (для визуал-кадра).

- [ ] **Step 2: Флаг `_NATBONUS`** (~py196):

```python
_NATBONUS = _8COLOR and not _os_pv.environ.get('KV_NO_NATBONUS')
```

- [ ] **Step 3: Нативизировать бонус.** Дверь `DEtoVRAM_NXNY`→`vec_blit_rect` (тот же контракт: HL=name, DE=tiles, B=rows, C=cols); звезда/пирамида/диагональ `WRTVRM`→`vec_text_blit` с локальным name-addr. Gated `if _NATBONUS:` в `_apply_vector_glue`. Формы — из Step 1 + контрактов vec_blit_rect/vec_text_blit.

- [ ] **Step 4: Гейт OFF==база.**

```bash
python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/off.asm --target vector && tools/bin/sjasm /tmp/off.asm /tmp/off.rom
cmp -s /tmp/off.rom /Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon.rom && echo "OFF==база OK" || echo "СЛОМАЛ OFF"
```
Expected: `OFF==база OK`.

- [ ] **Step 5: Гейт визуал бонуса.** Дойти до бонус-экрана (нужен ввод/прохождение уровня — использовать `gfx_dump.js`-паттерн доведения до геймплея, затем проиграть уровень, ИЛИ трап GS бонуса). Отрендерить кадр.

```bash
KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/8c.asm --target vector && tools/bin/sjasm /tmp/8c.asm /tmp/8c.rom
# кадр бонуса определить в Step 1; отрендерить и открыть PNG
```
Expected: бонус-экран (пирамида/звезда/дверь) рисуется как раньше.

- [ ] **Step 6: Откат.** `KV_NO_NATBONUS=1` собирается.

```bash
KV_NO_NATBONUS=1 KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/rb.asm --target vector && tools/bin/sjasm /tmp/rb.asm /tmp/rb.rom && echo "откат OK"
```
Expected: `откат OK`.

- [ ] **Step 7: Деплой на MiSTer** (команды как Task 1 Step 9).

- [ ] **Step 8: Commit.**

```bash
cp /tmp/8c.rom /Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon_8c.rom
git add tools/kv_z80_to_8080.py && git commit -m "softvdp Стадия 3: нативный бонус-экран (KV_NO_NATBONUS)"
```

---

### Task 4: Стадия 4 — нативный загрузочный funnel [РИСК: mixbuf]

**Files:**
- Modify: `tools/kv_z80_to_8080.py` (флаг ~py196; нативная распаковка паттернов/цветов; reroute unpackGFX)
- Test: `tools/verify/softvdp_cache_gate.js`, `tools/verify/vecrender.js`

**Interfaces:**
- Consumes: `vec_spr_load` (шаблон RLE→кэш, py1834); RLE-формат (count&0x7F=длина, bit7=1 literal / 0 fill, 0x80=смена адреса, 0x00=конец).
- Produces: флаг `_NATLOAD`; паттерны/цвета грузятся без диспетчера; `pat_shadow` эвакуирован из p2.

- [ ] **Step 1: Расширить cache-гейт под mixbuf/pat.** Убедиться, что `softvdp_cache_gate.js` сравнивает `vec_pat_shadow`, `pat_maze`, `pat_font`, `vec_mixbuf`, `vec_spr_buf` gold vs cand в точках загрузки. Собрать gold = текущий 8C.

```bash
cp /tmp/8c.rom /tmp/kv_gold.rom
node tools/verify/softvdp_cache_gate.js /tmp/kv_gold.rom /tmp/kv_gold.rom
```
Expected: гейт зелёный (gold vs себя = 0 diffs) — гейт работает.

- [ ] **Step 2: Флаг `_NATLOAD`** (~py196):

```python
_NATLOAD = _8COLOR and not _os_pv.environ.get('KV_NO_NATLOAD')
```

- [ ] **Step 3: Написать нативную распаковку паттернов (по шаблону vec_spr_load).** Метка `vec_pat_load`: RLE GFX_* паттернов → кэш паттернов напрямую (fold банка `and 7` + pat_base range-базы, 1 проход), БЕЗ VDP/funnel. Байт в B (не vw_byte). Взять из прежней Stage-3-попытки (память: код был написан, паттерны грузились КОРРЕКТНО).

- [ ] **Step 4: НЕ включать reroute — сначала отладить mixbuf (systematic-debugging).** Прежде чем перенаправлять unpackGFX, воспроизвести баг: собрать с reroute-в-тесте, трап записей в `mixbuf` (0x7E85) gold vs cand, лог PC.

```bash
# инструмент-трап (создать в tools/verify/mixbuf_trap.js по образцу softvdp_cache_gate.js):
# перехватывать memory.write в [0x7E85,0x7EFD), логировать PC+value на gold и cand до точки загрузки титула
node tools/verify/mixbuf_trap.js /tmp/kv_gold.rom /tmp/8c.rom
```
Expected: список PC-писателей mixbuf, где cand расходится с gold — корень порчи (гипотеза: `vec_col_store` зависит от состояния/порядка, что ставил ОРИГ pat-путь vw_wcol).

- [ ] **Step 5: Фикс корня mixbuf** (по находке Step 4). Обеспечить, что цвет-путь (`vec_col_store`/mode-накопитель) не зависит от состояния, которое ставил снятый pat-путь. Минимальная правка под `_NATLOAD`.

- [ ] **Step 6: Включить reroute unpackGFX→vec_pat_load** (gated `if _NATLOAD:`). Эвакуировать `pat_shadow` из p2 (кэш паттернов в свободную область / p3, как Фаза S сделала для остальных кэшей).

- [ ] **Step 7: Cache-гейт.** Кэши байт-идентичны на титуле И уровне.

```bash
KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/8c.asm --target vector && tools/bin/sjasm /tmp/8c.asm /tmp/8c.rom
node tools/verify/softvdp_cache_gate.js /tmp/kv_gold.rom /tmp/8c.rom
```
Expected: 0 diffs в pat/mixbuf/spr на точках загрузки.

- [ ] **Step 8: Гейт OFF==база + визуал всех экранов.**

```bash
python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/off.asm --target vector && tools/bin/sjasm /tmp/off.asm /tmp/off.rom
cmp -s /tmp/off.rom /Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon.rom && echo "OFF==база OK" || echo "СЛОМАЛ OFF"
for fr in 300 600 1160 1400; do node tools/verify/vecrender.js /tmp/8c.rom /tmp/s4_$fr.png $fr; done
```
Expected: `OFF==база OK`; PNG Konami/титул/геймплей — тайлы НЕ распадаются (fg!=bg), лабиринт целый.

- [ ] **Step 9: Откат.** `KV_NO_NATLOAD=1` собирается и рендерит корректно.

```bash
KV_NO_NATLOAD=1 KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/rb.asm --target vector && tools/bin/sjasm /tmp/rb.asm /tmp/rb.rom && echo "откат OK"
```
Expected: `откат OK`.

- [ ] **Step 10: Деплой на MiSTer** (команды как Task 1 Step 9). Пользователь: тайлы целые, ничего не распадается.

- [ ] **Step 11: Commit.**

```bash
cp /tmp/8c.rom /Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon_8c.rom
git add tools/kv_z80_to_8080.py tools/verify/mixbuf_trap.js && git commit -m "softvdp Стадия 4: нативный загрузочный funnel + эвакуация pat_shadow из p2 (KV_NO_NATLOAD)"
```

---

### Task 5: Стадия 5 — снос диспетчера + теней [ФИНАЛ]

**Files:**
- Modify: `tools/kv_z80_to_8080.py` (удаление меток диспетчера/примитивов; удаление теневых буферов; сужение HideSprites)
- Test: визуал всех экранов, z80 logic-gate, MiSTer

**Interfaces:**
- Consumes: подтверждение, что все потребители нативны (Стадии 1–4 задеплоены).
- Produces: ноль soft-VDP; 2КБ p2 + 120Б + ~180Б свободны.

- [ ] **Step 1: Подтвердить ноль оставшихся вызовов диспетчера.** С включёнными всеми `_NAT*` собрать 8C, проверить, что WRTVRM/RDVRM/DEtoVRAM/fillVRAM/unpackGFX/vec_vram_write больше не ЗОВУТСЯ.

```bash
KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/8c.asm --target vector
for sym in WRTVRM RDVRM DEtoVRAM_NXNY fillVRAM unpackGFX vec_vram_write; do echo "$sym callers=$(grep -acE '(call|jp|jr)[[:space:]]+'$sym'\b' /tmp/8c.asm)"; done
```
Expected: все `callers=0` (иначе стадия 1–4 не покрыла путь — вернуться).

- [ ] **Step 2: Удалить диспетчер и примитивы** (под `_8COLOR`, т.к. OFF ещё их использует — ИЛИ финально в обоих, если решено). Убрать метки `vec_vram_write`, `RDVRM`, `WRTVRM`, `vw_*`, `rv_*`, `SETWR`, `SETRD`, `DEtoVRAM(_NXNY)`, `fillVRAM`, out-редирект (py~1014/3176), `vec_vdp_ptr`, `InviertePatron`-путь. NB: OFF-инвариант тут меняется — ре-баселайн.

- [ ] **Step 3: Удалить теневые буферы.** Снять `vec_pat_shadow` (2КБ p2), `vec_mixbuf` (120Б). Сузить `HideSprites` (не чистить регион pat_shadow). Проверить, что нет читателей.

```bash
grep -anE "pat_shadow|vec_mixbuf" /tmp/8c.asm | grep -avE "^\s*;" | head
```
Expected: после удаления — 0 живых ссылок.

- [ ] **Step 4: Собрать + GS5.**

```bash
KV_8COLOR=1 python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/8c.asm --target vector && tools/bin/sjasm /tmp/8c.asm /tmp/8c.rom
node tools/verify/vecrender.js /tmp/8c.rom /tmp/s5_gs5.png 1200
```
Expected: `Errors: 0`, GS5 достигнут.

- [ ] **Step 5: Визуал ВСЕХ экранов + logic-gate.**

```bash
for fr in 300 600 1160 1400; do node tools/verify/vecrender.js /tmp/8c.rom /tmp/s5_$fr.png $fr; done
# z80 logic-gate: тик расхождения с MSX (по образцу существующих logic-гейтов в tools/verify/)
```
Expected: все экраны (Konami/титул/геймплей/переход) корректны; logic-gate — расхождение ожидаемо-переходное (frame-drop reseed уходит при полной нативности).

- [ ] **Step 6: Замер освобождённой памяти.** Подтвердить 2КБ p2 (0xC900+) + 120Б + код диспетчера свободны.

```bash
grep -anE "vec_pat_shadow|vec_mixbuf|vec_vdp_ptr" /tmp/8c.asm | head
```
Expected: символы отсутствуют; регион p2 0xC900–0xD0FF свободен.

- [ ] **Step 7: Деплой на MiSTer + полный прогон** (команды как Task 1 Step 9). Пользователь: полный прогон уровня — всё нативно, ничего не сломано.

- [ ] **Step 8: Обновить снапшоты + память + Commit.**

```bash
cp /tmp/8c.rom /Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon_8c.rom
cp /tmp/off.rom /Users/boris/.claude/jobs/e2a1cb58/tmp/base_canon.rom   # ре-баселайн OFF
git add tools/kv_z80_to_8080.py && git commit -m "softvdp Стадия 5: снос диспетчера + теней, ноль soft-VDP, 2КБ p2 свободны"
```

- [ ] **Step 9: Обновить память проекта.** `project_kv_softvdp_removal` (все стадии закрыты, soft-VDP = 0), `project_kvalley_v06c` (2КБ p2 свободны под цвет A+/pre-shift).

---

## Self-Review (проведён)

**Покрытие спеки:** Стадия 0 (гейты) → Global Constraints; Стадия 1 → Task 1; Стадия 2 (+раскраска титра) → Task 2; Стадия 3 → Task 3; Стадия 4 (funnel+mixbuf-отладка+эвакуация pat_shadow) → Task 4; Стадия 5 (снос+ре-баселайн) → Task 5. Диагностика обрыва демо → Task 1 Step 6/7. Освобождение памяти → Task 5 Step 6. Пробелов нет.

**Плейсхолдеры:** нативные asm-блоки выводятся из именованных шаблонов (`vec_nat_room`/`vec_text_blit`/`vec_blit_rect`/`vec_spr_load`) + контракта + расследования тела рутины (Step «расследовать»); это осознанная граница reverse-engineering-задачи, а не «TODO». Все гейт-команды — точные и исполнимые.

**Согласованность типов:** флаги `_NATSCROLL/_NATLOGO/_NATBONUS/_NATLOAD` + откаты `KV_NO_*` единообразны; контракты `vec_text_blit`(HL,A)/`vec_blit_rect`(HL,DE,B,C)/`vec_spr_load`(RLE) совпадают между задачами.
