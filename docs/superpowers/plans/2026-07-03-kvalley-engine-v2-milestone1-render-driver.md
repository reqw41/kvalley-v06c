# King's Valley Engine v2 — Milestone 1: нативный Вектор render-драйвер + контракт сцены

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить нативный Вектор-06Ц render-драйвер v2, который рисует экран из абстрактной «сцены» (tilemap + sprite-list) и даёт пиксель-в-пиксель тот же кадр, что soft-VDP v1 — на данных, извлечённых из живого v1. Это де-рискует и переиспользует самый важный слой ДО написания нативного игрового ядра.

**Architecture:** Три слоя из спеки (docs/superpowers/specs/2026-07-03-kvalley-engine-v2-design.md): ядро → сцена (шов) → драйвер машины. Этот майлстоун реализует ТОЛЬКО драйвер (Слой 3) + структуры сцены (Слой 2), кормя их сценой, извлечённой из состояния v1 (name-таблица v1 → tilemap, SAT v1 → sprites). Логика v1 остаётся эталоном; драйвер v2 доказывается против неё пиксель-компаром в headless.

**Tech Stack:** i8080 ассемблер (tools/bin/sjasm, Sjasm 0.39 синтаксис), эмулятор vector06js (headless через node+vm), существующий харнесс tools/verify/. Никакого нового рантайма — только asm + node-скрипты сравнения.

## Global Constraints

- Целевой темп: 50 Гц (1 тик/кадр = 59904 такта). В этом майлстоуне — только рендер; профилировать его такты, но полный 50 Гц — задача поздних майлстоунов.
- Цвет: 4 (2 плоскости, план0=фон/охра, план1=спрайты/бел, оба=красный — как v1 палитра `0,0,0,0,FF×4,36h×4,47h×4`).
- Экран Вектора: планы по адресу (X>>3)*256+(255-Y); план0 базовый hi=0x80+col, план1 hi=0xA0+col.
- Тайл 8×8, 24 строки × 32 столбца = 768 клеток. Паттерны 8 байт/тайл, 3 банка (строки 0-7/8-15/16-23).
- Сборка Вектор-таргета: результат грузится в vector06js с 0x100.
- Правило: НИЧЕГО не сливать, пока пиксель-компар против v1 не зелёный. v1 = золотой эталон.
- Дев-скрипты — в tools/ репозитория, не в /tmp (feedback_dev_tools_in_repo).
- Порядок регистров i8080.js: regs=[b,c,d,e,h,l,m,a].

## Файловая структура (создаётся этим майлстоуном)

- `v2/scene.inc` — определения структур сцены (адреса/раскладка tilemap, sprites, palette в ОЗУ). Единственный источник правды по шву.
- `v2/driver_vector.asm` — Вектор render-драйвер: `render_frame`, `blit_bg_cell`, `draw_sprites` (two-pass XOR), установка палитры. Читает сцену, пишет планы.
- `v2/test_harness.asm` — тестовый ROM: кладёт в ОЗУ заданную сцену + паттерны, зовёт драйвер, halt. Точка входа для headless-прогона одного кадра.
- `tools/verify/scene_extract.js` — извлекает сцену из живого v1 (name-тень→tilemap, SAT-тень→sprites, паттерн-тень→паттерны) в бинарь-снапшот.
- `tools/verify/driver_pixelcompare.js` — грузит test_harness.rom со снапшот-сценой, прогоняет 1 кадр, сравнивает планы 0/1 с эталонными планами v1 из того же снапшота.
- `tools/verify/profile_v1.js` — счётчик тактов v1 по регионам (render vs logic) для бюджета 50 Гц.
- `docs/JOURNAL.md` — дописывать уроки (существует).

---

### Task 1: Профиль тактов v1 (бюджет до 50 Гц)

Знать, куда уходят такты тика, ДО оптимизаций: сколько на рендер (soft-VDP) vs логику (recompiled), чтобы подтвердить осуществимость 50 Гц и приоритет нативизации. Инвестигейт, но с измеримым артефактом.

**Files:**
- Create: `tools/verify/profile_v1.js`

**Interfaces:**
- Produces: скрипт печатает такты/тик по регионам PC-диапазонов: `render` (0x6000-0x60FF драйвер-glue блиттера/compose), `sound` (updateSound/vec_flushvi), `logic` (остальное игровое), в GS5-геймплее.

- [ ] **Step 1: Написать профилировщик**

Создать `tools/verify/profile_v1.js` по образцу существующих headless-скриптов (напр. tools/verify/lockstep_kv.js — оттуда взять загрузку vector06js, `rd()`, символы из .sym). Логика: обернуть `cpu.instruction`, по `cpu.pc` относить такт (vcycles) к региону через .sym-диапазоны меток; дойти до GS5 (rd(0x6B00)===5), собрать 200 тиков (вход tickMain), вывести суммарные такты/тик по регионам render/sound/logic и среднее тактов/тик.

Ключевые метки-границы брать из /tmp/kvv.sym (собрать свежий: `python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/kvv.asm --target vector && tools/bin/sjasm -s /tmp/kvv.asm /tmp/kvv.rom /tmp/kvv.sym`). Регион = ближайшая метка ≤ pc: render если метка начинается на `vec_blit`/`vbt_`/`vec_compose`/`vec_render`/`vw_`/`vcp`; sound если `updateSound`/`vec_flushvi`/`processSndData`/`loc_7C`; иначе logic.

- [ ] **Step 2: Прогнать, убедиться что даёт разбивку**

Run: `cd /Users/boris/Projects/kvalley-v06c && node tools/verify/profile_v1.js`
Expected: печатает 3 числа (render/sound/logic такты/тик) + среднее тактов/тик; среднее ≈100000 (что соответствует ~24 Гц против 59904/кадр). Три региона в сумме ≈ среднему.

- [ ] **Step 3: Зафиксировать вывод в журнал**

Дописать в docs/JOURNAL.md раздел «## ПРОФИЛЬ v1 ДЛЯ v2 (дата)» с числами: сколько тактов на render/sound/logic, вывод — что нативить в первую очередь (та часть, где больше тактов), и запас до 59904.

- [ ] **Step 4: Commit**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add tools/verify/profile_v1.js docs/JOURNAL.md
git commit -m "feat(v2): v1 cycle profiler — render/sound/logic budget toward 50Hz

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Контракт сцены (v2/scene.inc)

Зафиксировать раскладку структур сцены в ОЗУ — единственный источник правды по шву. Пока только определения (equ), без кода.

**Files:**
- Create: `v2/scene.inc`

**Interfaces:**
- Produces: символы (equ) — `scn_tilemap` (768 байт), `scn_sprites` (N×5 байт), `scn_nsprites` (1 байт), `scn_palette` (4 байта), `scn_dirty` (список), `scn_ndirty` (1 байт), `SCN_MAXSPR equ 16`. Формат спрайта: смещения `SPR_Y=0, SPR_X=1, SPR_FRAME=2, SPR_COLOR=3, SPR_FLAGS=4`, шаг `SPR_STRIDE=5`.

- [ ] **Step 1: Написать scene.inc**

Создать `v2/scene.inc`:
```
; --- King's Valley engine v2: контракт сцены (шов логика<->драйвер) ---
; Раскладка в свободном ОЗУ Вектора 0x4000-0x8000 (вне 16КБ-следа кода).
SCN_MAXSPR      equ     16
SPR_Y           equ     0
SPR_X           equ     1
SPR_FRAME       equ     2
SPR_COLOR       equ     3
SPR_FLAGS       equ     4
SPR_STRIDE      equ     5

scn_tilemap     equ     4000h           ; 768 байт: 24*32 id тайлов фона
scn_sprites     equ     4300h           ; SCN_MAXSPR*SPR_STRIDE = 80 байт
scn_nsprites    equ     4350h           ; 1 байт: число активных спрайтов
scn_palette     equ     4351h           ; 4 байта цветов (порт 0x0C)
scn_dirty       equ     4355h           ; список изменённых клеток (2 байта/клетка LE)
scn_ndirty      equ     43D5h           ; 1 байт: длина dirty-списка
; паттерны текущего уровня (распакованные, читает драйвер):
scn_bgpat       equ     4400h           ; 3 банка * 256 тайлов * 8 = переиспользуем
scn_sprpat      equ     4400h           ; (в M1 берём из v1-теней, тут placeholder-equ)
```

- [ ] **Step 2: Проверить, что ассемблируется как include**

Создать временный `v2/_inccheck.asm` с `include "v2/scene.inc"` + `db scn_tilemap>>8` и собрать:
Run: `cd /Users/boris/Projects/kvalley-v06c && printf '\torg 0x100\n\tinclude "v2/scene.inc"\n\tdb scn_tilemap>>8, scn_sprites>>8, SCN_MAXSPR\n' > v2/_inccheck.asm && tools/bin/sjasm v2/_inccheck.asm /tmp/_ic.rom`
Expected: `Errors: 0`.

- [ ] **Step 3: Убрать временный файл, commit**

```bash
cd /Users/boris/Projects/kvalley-v06c
rm v2/_inccheck.asm
git add v2/scene.inc
git commit -m "feat(v2): scene contract (scene.inc) — tilemap/sprites/palette layout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Экстрактор сцены из v1 (scene_extract.js)

Извлечь из живого v1 сцену (tilemap из name-тени, sprites из SAT-тени, паттерны из паттерн-тени) + эталонные планы 0/1 в снапшот-файл — вход для теста драйвера.

**Files:**
- Create: `tools/verify/scene_extract.js`

**Interfaces:**
- Consumes: собранный /tmp/kvv.rom + /tmp/kvv.sym (Вектор-таргет v1).
- Produces: файл `/tmp/v1_scene.bin` формата: [768 tilemap][80 sprites (Y,X,FRAME,COLOR,FLAGS × ≤16)][1 nsprites][4 palette][6144 bgpat из v1-тени 0xC900][эталон план0 8192][эталон план1 8192]. Печатает GS и число спрайтов.

- [ ] **Step 1: Написать экстрактор**

Создать `tools/verify/scene_extract.js` (взять каркас vector06js-загрузки из tools/verify/lockstep_kv.js). Дойти до GS5-геймплея (rd(0x6B00)===5, дать ~250 кадров стабилизации). Извлечь:
- tilemap[768] = rd(vec_name_shadow+i), i=0..767 (vec_name_shadow=0xE100).
- sprites из SAT-тени 0xC880: для каждого из ≤16 (шаг 4: Y,X,pat,color) пока Y!=0xD0 и Y<0xC0 → записать {Y, X=rd(+1), FRAME=rd(+2), COLOR=rd(+3), FLAGS=0}; nsprites=счётчик.
- palette[4]: взять из vec_pal (символ) первые 4 значащих (0, 0xFF, 0x36, 0x47) — прочитать из ROM по адресу vec_pal.
- bgpat: rd(0xC900+i), i=0..6143.
- эталон план0: rd(((0x80+col)<<8)|(255-y)) для col 0..31, y 0..191 → 32*192/8... на самом деле план0 = байты 0x8000..0x9FFF (8КБ): for a=0x8000..0x9FFF: rd(a). план1 = 0xA000..0xBFFF.
Записать всё в /tmp/v1_scene.bin. Печать: `GS=5 nsprites=<n>`.

- [ ] **Step 2: Собрать v1 и прогнать экстрактор**

Run:
```
cd /Users/boris/Projects/kvalley-v06c
python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/kvv.asm --target vector && tools/bin/sjasm -s /tmp/kvv.asm /tmp/kvv.rom /tmp/kvv.sym
node tools/verify/scene_extract.js
```
Expected: печатает `GS=5 nsprites=<n>` где n≥1 (есть герой); создаётся /tmp/v1_scene.bin размером 768+80+1+4+6144+8192+8192 = 23381 байт.

- [ ] **Step 3: Проверить осмысленность tilemap**

Добавить в конец скрипта (или отдельным прогоном) печать: ненулевых клеток tilemap должно быть >100 (уровень нарисован), в sprites[0] Y должен быть <0xC0 (герой на экране).
Run: `node tools/verify/scene_extract.js`
Expected: осмысленные значения (не все нули).

- [ ] **Step 4: Commit**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add tools/verify/scene_extract.js
git commit -m "feat(v2): extract scene (tilemap/sprites/patterns) + reference planes from live v1

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Нативный блит одного тайла фона (driver_vector.asm: blit_bg_cell)

Написать i8080-рутину, кладущую один тайл из паттернов в план0 по (row,col). Это ядро dirty-блита фона. Тест — сравнить план0 для набора клеток с эталоном v1.

**Files:**
- Create: `v2/driver_vector.asm`
- Create: `v2/test_harness.asm`
- Create: `tools/verify/driver_pixelcompare.js`

**Interfaces:**
- Consumes: `v2/scene.inc` (scn_tilemap, scn_bgpat), /tmp/v1_scene.bin.
- Produces: `blit_bg_cell` — вход B=row(0..23), C=col(0..31); читает tile=scn_tilemap[row*32+col], паттерн из scn_bgpat[bank*0x800+tile*8], пишет 8 байт в план0 hi=(0x80+col), low=~(row*8)-r. Bank=row>>3.

- [ ] **Step 1: Написать пиксель-компар (тест) — сначала для фона**

Создать `tools/verify/driver_pixelcompare.js`: грузит /tmp/v2_harness.rom в vector06js headless; ПЕРЕД запуском кладёт в память сцену из /tmp/v1_scene.bin (tilemap→0x4000, sprites→0x4300, nsprites→0x4350, palette→0x4351, bgpat→0x4400 — writeMemory через memory.bytes[tobank]); запускает CPU до halt (pc не меняется / opcode 0x76) с лимитом; сравнивает план0 (0x8000-0x9FFF) с эталоном план0 из снапшота (offset 768+80+1+4+6144 = 6997). Печатает число несовпавших байт плана0.

Ключ: bgpat в снапшоте лежит по offset 768+80+1+4=853, длина 6144. Загрузить его в 0x4400. tilemap offset 0, sprites offset 768, nsprites 848, palette 849.

- [ ] **Step 2: Написать test_harness.asm + заглушку драйвера, собрать, прогнать — ждать FAIL**

Создать `v2/driver_vector.asm` с ПУСТЫМ `blit_bg_cell: ret` и `render_bg` который для всех 768 клеток зовёт blit_bg_cell. Создать `v2/test_harness.asm`:
```
        org     0100h
        include "v2/scene.inc"
        di
        lxi     sp, 0FF00h
        call    render_bg
        hlt
        include "v2/driver_vector.asm"
```
Run:
```
cd /Users/boris/Projects/kvalley-v06c
tools/bin/sjasm v2/test_harness.asm /tmp/v2_harness.rom
node tools/verify/driver_pixelcompare.js
```
Expected: FAIL — план0 не совпадает (много несовпавших байт), т.к. blit_bg_cell пустой.

- [ ] **Step 3: Реализовать blit_bg_cell + render_bg**

В `v2/driver_vector.asm` реализовать (по образцу v1-блиттера vec_blit_tile, но читая scn_tilemap/scn_bgpat напрямую):
```
render_bg:                      ; блит всех 768 клеток
        mvi     d, 0            ; row
rbg_row:
        mvi     e, 0            ; col
rbg_col:
        mov     b, d
        mov     c, e
        call    blit_bg_cell
        inr     e
        mov     a, e
        cpi     32
        jc      rbg_col
        inr     d
        mov     a, d
        cpi     24
        jc      rbg_row
        ret
blit_bg_cell:                   ; B=row C=col
        ; cell = row*32+col ; tile = scn_tilemap[cell]
        mov     a, b
        ... (row*32: rlca*5 в 16-бит через HL) ...
        ; читаем tile, bank=row>>3, паттерн scn_bgpat+bank*0x800+tile*8
        ; план0 адрес: H=0x80+col, L=~(row*8); пишем 8 байт (dec L меж строками)
        ret
```
Точная адресная арифметика — как в v1 vec_blit_tile (tools/kv_z80_to_8080.py, метка vec_blit_tile): tile*8 в HL, bank*8 в hi, low=~(row*8) через `mov a,b; add a,a; add a,a; add a,a; cma; mov l,a`; план0 hi = `mov a,c; adi 80h; mov h,a`. Копировать 8 байт паттерна в план0 по убывающему L.

- [ ] **Step 4: Пересобрать, прогнать — ждать PASS по фону**

Run:
```
cd /Users/boris/Projects/kvalley-v06c
tools/bin/sjasm v2/test_harness.asm /tmp/v2_harness.rom
node tools/verify/driver_pixelcompare.js
```
Expected: PASS — план0 совпадает с эталоном v1 (0 несовпавших байт), т.к. фон рисуется из тех же паттернов той же геометрией.

- [ ] **Step 5: Commit**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add v2/driver_vector.asm v2/test_harness.asm tools/verify/driver_pixelcompare.js
git commit -m "feat(v2): native background tile blit — plane0 pixel-exact vs v1

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Нативные спрайты two-pass XOR (draw_sprites)

Добавить в драйвер отрисовку sprite-list через erase-all→draw-all XOR (мультиплекс-безопасно, как v1). Спрайты 16×16 в план1 (белый) по scn_sprites. Тест — сравнить план1 с эталоном v1.

**Files:**
- Modify: `v2/driver_vector.asm`
- Modify: `v2/test_harness.asm:call render_bg` (добавить call draw_sprites)
- Modify: `tools/verify/driver_pixelcompare.js` (сравнить и план1)

**Interfaces:**
- Consumes: `v2/scene.inc` (scn_sprites, scn_nsprites), спрайт-паттерны (в M1 — из v1-теней 0xC080, положить в снапшот).
- Produces: `draw_sprites` — рисует scn_nsprites спрайтов из scn_sprites в план1 XOR-ом; держит приватную копию «прошлого кадра» для erase-all (в M1 один кадр — erase по нулевой прошлой копии = no-op, только draw).

- [ ] **Step 1: Расширить снапшот спрайт-паттернами + эталон план1**

Modify `tools/verify/scene_extract.js`: дописать в /tmp/v1_scene.bin спрайт-паттерны из v1-тени 0xC080 (2КБ) и убедиться эталон план1 (0xA000-0xBFFF) уже в снапшоте. Перепрогнать экстрактор.
Run: `cd /Users/boris/Projects/kvalley-v06c && node tools/verify/scene_extract.js`
Expected: снапшот вырос на 2048 байт; печать nsprites≥1.

- [ ] **Step 2: Расширить пиксель-компар на план1 — ждать FAIL**

Modify `tools/verify/driver_pixelcompare.js`: после render загрузить спрайт-паттерны в 0x4C00, сравнить план1 (0xA000-0xBFFF) с эталоном. Добавить `call draw_sprites` в test_harness.asm с пустой `draw_sprites: ret`.
Run: пересобрать harness + `node tools/verify/driver_pixelcompare.js`
Expected: план0 PASS, план1 FAIL (спрайты не нарисованы).

- [ ] **Step 3: Реализовать draw_sprites**

В `v2/driver_vector.asm` реализовать 16×16 XOR-блит спрайта в план1 по образцу v1 sprite-рендера (в tools/kv_z80_to_8080.py — vec_render_draw/спрайт-путь): для i=0..scn_nsprites-1 читать Y=scn_sprites[i*5+SPR_Y], X=+SPR_X, FRAME=+SPR_FRAME; адрес план1 hi=0xA0+(X>>3), low from Y; XOR 16 строк × 2 байта из спрайт-паттерна (frame*32). В M1 — только draw (без erase, прошлая копия нулевая).

- [ ] **Step 4: Пересобрать, прогнать — ждать PASS по обоим планам**

Run:
```
cd /Users/boris/Projects/kvalley-v06c
tools/bin/sjasm v2/test_harness.asm /tmp/v2_harness.rom
node tools/verify/driver_pixelcompare.js
```
Expected: план0 PASS И план1 PASS (0 несовпавших байт в обоих) для захваченной сцены.

- [ ] **Step 5: Commit**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add v2/driver_vector.asm v2/test_harness.asm tools/verify/scene_extract.js tools/verify/driver_pixelcompare.js
git commit -m "feat(v2): native two-pass XOR sprites — plane1 pixel-exact vs v1

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: render_frame() + палитра + профиль тактов драйвера

Собрать публичную точку входа `render_frame` (палитра + фон + спрайты) — это шов, который ядро будет звать. Профилировать её такты (сколько из бюджета 59904 забирает рендер).

**Files:**
- Modify: `v2/driver_vector.asm` (render_frame, set_palette)
- Modify: `v2/test_harness.asm` (call render_frame вместо отдельных)
- Create: `tools/verify/driver_profile.js`

**Interfaces:**
- Produces: `render_frame` — устанавливает палитру из scn_palette (порт 0x0C, как v1 vec_setpal), затем render_bg + draw_sprites. Публичный шов для ядра.

- [ ] **Step 1: Реализовать set_palette + render_frame**

В `v2/driver_vector.asm` добавить `set_palette` (по образцу vec_setpal из tools/kv_z80_to_8080.py: out 00h с 88h, цикл out 0Ch из scn_palette) и:
```
render_frame:
        call    set_palette
        call    render_bg
        call    draw_sprites
        ret
```
Изменить test_harness.asm на `call render_frame`.

- [ ] **Step 2: Пересобрать, прогнать пиксель-компар — ждать PASS**

Run: `cd /Users/boris/Projects/kvalley-v06c && tools/bin/sjasm v2/test_harness.asm /tmp/v2_harness.rom && node tools/verify/driver_pixelcompare.js`
Expected: оба плана PASS (палитра не влияет на байты планов, только на цвет; пиксель-компар планов остаётся зелёным).

- [ ] **Step 3: Профилировать такты render_frame**

Создать `tools/verify/driver_profile.js`: грузит harness, считает vcycles от входа render_frame до hlt (обернуть cpu.instruction, суммировать). Печать: такты render_frame и % от 59904.
Run: `node tools/verify/driver_profile.js`
Expected: печатает такты (ориентир: фон-блит всех 768 клеток дорог — в реальном движке будет ТОЛЬКО dirty, тут полный кадр = верхняя граница). Записать число.

- [ ] **Step 4: Дописать журнал + commit**

Дописать в docs/JOURNAL.md: такты render_frame (полный кадр) vs бюджет 59904; вывод — полный блит фона слишком дорог, в M2 фон становится dirty-only (только изменённые клетки), что и даст запас под 50 Гц.
```bash
cd /Users/boris/Projects/kvalley-v06c
git add v2/driver_vector.asm v2/test_harness.asm tools/verify/driver_profile.js docs/JOURNAL.md
git commit -m "feat(v2): render_frame seam + palette; profile render cycles vs 59904 budget

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Валидация на нескольких сценах + фиксация майлстоуна

Доказать драйвер на РАЗНЫХ сценах (разные уровни/кадры), не только одной — чтобы исключить случайное совпадение. Зафиксировать M1.

**Files:**
- Modify: `tools/verify/scene_extract.js` (параметр: на каком кадре/после какого ввода снимать)
- Modify: `docs/JOURNAL.md`
- Create: `v2/README.md`

**Interfaces:**
- Consumes: всё из Task 1-6.

- [ ] **Step 1: Снять 3 разные сцены**

Параметризовать scene_extract.js аргументом (номер кадра/сценарий: старт PYRAMID-01, после хода вправо, после подбора предмета) → сохранять /tmp/v1_scene_1.bin, _2, _3.
Run: `cd /Users/boris/Projects/kvalley-v06c && for i in 1 2 3; do node tools/verify/scene_extract.js $i; done`
Expected: 3 снапшота, разные (разное nsprites/tilemap).

- [ ] **Step 2: Прогнать пиксель-компар на всех трёх — ждать PASS×3**

Параметризовать driver_pixelcompare.js аргументом снапшота.
Run: `cd /Users/boris/Projects/kvalley-v06c && for i in 1 2 3; do echo "scene $i:"; node tools/verify/driver_pixelcompare.js $i; done`
Expected: все три — оба плана PASS (0 несовпавших).

- [ ] **Step 3: Написать v2/README.md**

Создать `v2/README.md` кратко: что такое v2, слои, контракт scene.inc, как тестировать драйвер (scene_extract → driver_pixelcompare), статус M1 (render-драйвер доказан пиксель-в-пиксель против v1 на 3 сценах), что дальше (M2: нативное ядро + dirty-only фон).

- [ ] **Step 4: Journal + commit майлстоуна**

Дописать в docs/JOURNAL.md «## M1 ГОТОВ»: нативный Вектор render-драйвер даёт пиксель-в-пиксель кадр v1 на 3 сценах; render_frame — публичный шов; такты замерены; следующий майлстоун M2 = нативное игровое ядро, кормящее сцену, + dirty-only фон.
```bash
cd /Users/boris/Projects/kvalley-v06c
git add tools/verify/scene_extract.js tools/verify/driver_pixelcompare.js v2/README.md docs/JOURNAL.md
git commit -m "test(v2): M1 render-driver validated pixel-exact vs v1 on 3 scenes; milestone done

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Что дальше (отдельные планы после M1)

- **M2 — нативное игровое ядро:** загрузчик уровня → физика → актёры (по одному), каждый локстеп-доказан против v1; ядро пишет сцену через set_tile/sprites; фон становится dirty-only (запас под 50 Гц).
- **M3 — нативные горячие рутины:** звук ВИ53 + AI мумий нативно; замер прироста Гц.
- **M4 — сжатие (ZX0):** графика/уровни жмутся; добить 16КБ-след.

## Self-Review (выполнено при написании)

- **Покрытие спеки:** контракт сцены (Task 2), драйвер render_frame+bg+sprites (Task 4-6), пошаговая валидация против v1 (Task 3-7), профиль тактов к 50Гц (Task 1,6). Ядро/сжатие — явно вынесены в M2-M4 (спека допускает майлстоуны). ✓
- **Плейсхолдеры:** адресная арифметика в Task 4-5 ссылается на конкретный образец (vec_blit_tile / vec_render_draw в tools/kv_z80_to_8080.py) — не «TODO», а точный референс существующего рабочего кода. ✓
- **Согласованность типов:** символы scene.inc (scn_tilemap/scn_sprites/scn_nsprites/scn_palette, SPR_*) используются одинаково в Task 3-6. Формат снапшота (offsets) согласован между scene_extract (Task 3,5) и driver_pixelcompare (Task 4,5). ✓
