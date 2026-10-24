# King's Valley engine v2 — M2a: нативный сборщик сцены + dirty-фон (план)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Нативный i8080-код строит сцену (tilemap+sprites) комнаты King's Valley из MapaRAM+актёр-структур v1, воспроизводя вывод v1 (drawRoom/updateSprites/AI_Cuchillos), + dirty-only фон в render_frame. Доказано пиксель/сцена-в-сцену против v1.

**Architecture:** Слои движка v2 (спека 2026-07-03-...-design.md). M2a = нативный модуль `v2/scene_builder.asm` (Слой 1) + dirty-путь в `v2/driver_vector.asm`. Кормится состоянием живого v1 (паттерн M1). Спека: docs/superpowers/specs/2026-07-03-kvalley-engine-v2-m2a-scene-builder.md.

**Tech Stack:** i8080 asm (tools/bin/sjasm 0.39, Z80-мнемоники→8080-опкоды), headless vector06js (node+vm), tools/verify/. check_i8080.js — гейт чистоты.

## Global Constraints

- Цель — ванильный i8080/Вектор: ТОЛЬКО i8080-опкоды (check_i8080.js должен быть OK; sjasm=Z80 глотает Z80-only 08/10/18/20/28/30/38, CB/D9/DD/ED/FD — запрещены).
- Весь код в Z80-мнемоническом подмножестве (конвенция в v2/scene.inc).
- v1 = золотой эталон; каждый паритет доказывается headless-сравнением, не утверждением.
- Адреса v1 (Вектор-таргет, из /tmp/kvv.sym): drawRoom=0x2622, getTileFromID=0x2646, updateSprites=0x1121, AI_Cuchillos=0x1E59, setAttribProta=0x12CF, getMapOffset=0x1703, MapaRAM=0x7560, ProtaY=0x6C37, ProtaX=0x6C39, ProtaRoom=0x6C3A, numMomias=0x6C64, numKnifes=0x6D63, knifesData=0x6D64, name-тень vec_name_shadow=0xE100, SAT-тень 0xC880.
- Сцена (scene.inc): scn_tilemap=0x4000(768), scn_sprites=0x4300(80,stride5), scn_nsprites=0x4350, scn_palette=0x4351(4), scn_dirty=0x4355(2Б/клетка), scn_ndirty=0x43D5, scn_bgpat=0x4400, scn_sprpat=0x5C00.
- Дев-скрипты в tools/verify/, не /tmp. Сборка v1: `python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/kvv.asm --target vector && tools/bin/sjasm -s /tmp/kvv.asm /tmp/kvv.rom /tmp/kvv.sym`.

## Файловая структура

- `v2/scene_builder.asm` — нативный сборщик: `build_tilemap` (MapaRAM→tilemap), `build_sprites` (актёры→sprites). Машинно-независимый (не трогает планы).
- `v2/driver_vector.asm` — расширить: `set_tile` (tilemap+dirty), dirty-путь в `render_frame` (блит только dirty).
- `v2/scene.inc` — при нужде: флаг full-render, границы.
- `tools/verify/scene_extract.js` — расширить: захватывать ВХОД (MapaRAM-экран комнаты + актёр-структуры) вместе с референсом.
- `tools/verify/scenebuilder_compare.js` — новый: гоняет harness со сборщиком, сверяет scn_tilemap==name-тень v1 и scn_sprites==SAT v1.
- `v2/sb_harness.asm` — harness: кладёт MapaRAM+актёры v1 в RAM, зовёт build_tilemap+build_sprites, hlt; скрипт сверяет сцену.

---

### Task 1: Расширить экстрактор — вход (MapaRAM+актёры) + референс

**Files:** Modify `tools/verify/scene_extract.js`

**Interfaces:** Produces — снапшот /tmp/v1_scene.bin дополнен блоком «ВХОД»: MapaRAM-экран текущей комнаты (768 map-ID) + актёр-структуры (прота: Y,X,room + momiaData N мумий + knifesData N ножей). Печатает ProtaRoom, numMomias, numKnifes.

- [ ] **Step 1: Прочитать формат MapaRAM-экрана + актёров из v1-исходника**

Прочесть в `msx/kvalley_src.asm`: `setupRoom` (как берётся экран комнаты из MapaRAM по ProtaRoom: `ProtaRoom*32 + MapaRAM`, 24 строки?), `drawRoom` (0x2622) — сколько клеток экрана (24×32=768 map-ID). Прочесть структуры: ProtaY/X/Room (0x6C37-0x6C3A), momiaData (numMomias=0x6C64 мумий), knifesData (0x6D64, numKnifes ножей, stride из getKnifeData=17). Задокументировать смещения в комментарии скрипта.

- [ ] **Step 2: Добавить захват ВХОДА в снапшот, прогнать**

В `scene_extract.js` после существующего захвата дописать в /tmp/v1_scene.bin: MapaRAM-экран комнаты ProtaRoom (768 байт map-ID из MapaRAM 0x7560 + ProtaRoom*... — точное смещение по setupRoom), затем актёр-структуры (прота 3Б + numMomias + momiaData + numKnifes + knifesData). Печать: `ProtaRoom=<r> numMomias=<n> numKnifes=<k> вход-блок +<N>байт`.
Run: `cd /Users/boris/Projects/kvalley-v06c && python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/kvv.asm --target vector && tools/bin/sjasm -s /tmp/kvv.asm /tmp/kvv.rom /tmp/kvv.sym && node tools/verify/scene_extract.js`
Expected: печатает ProtaRoom/numMomias/numKnifes (осмысленные, numMomias≥1); снапшот вырос на размер вход-блока.

- [ ] **Step 3: Проверить осмысленность MapaRAM-экрана**

Добавить печать: ненулевых map-ID в захваченном экране >50 (уровень есть).
Run: `node tools/verify/scene_extract.js`
Expected: осмысленно (не нули).

- [ ] **Step 4: Commit**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add tools/verify/scene_extract.js
git commit -m "feat(v2/m2a): extract v1 MapaRAM screen + actor structs as scene-builder input

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Нативный build_tilemap (MapaRAM → tilemap)

**Files:** Create `v2/scene_builder.asm`, `v2/sb_harness.asm`, `tools/verify/scenebuilder_compare.js`

**Interfaces:** Produces — `build_tilemap`: вход HL=указатель на MapaRAM-экран (24×32 map-ID в RAM), заполняет scn_tilemap[0..767] маппингом map-ID→tile-ID по логике v1 drawRoom+getTileFromID.

- [ ] **Step 1: Написать сравниватель сцены (тест) — сначала tilemap**

Создать `tools/verify/scenebuilder_compare.js`: грузит /tmp/sb_harness.rom в vector06js headless (каркас из tools/verify/driver_pixelcompare.js), кладёт в RAM MapaRAM-экран из снапшота (вход-блок) по адресу, где build_tilemap его ждёт (напр. 0x6000 scratch), запускает до hlt, сверяет scn_tilemap (0x4000..0x42FF) с РЕФЕРЕНСОМ v1 name-тень (в снапшоте — блок tilemap@0, он и есть name-тень v1). Печатает число несовпавших клеток.

- [ ] **Step 2: Заглушка build_tilemap + harness, собрать, прогнать — FAIL**

Создать `v2/scene_builder.asm` с `build_tilemap: ret` (пусто). Создать `v2/sb_harness.asm`: `org 0100h / include "scene.inc" / di / ld sp,0FF00h / ld hl, 6000h (MapaRAM-scratch) / call build_tilemap / hlt / include "scene_builder.asm"`.
Run: `cd /Users/boris/Projects/kvalley-v06c && tools/bin/sjasm v2/sb_harness.asm /tmp/sb_harness.rom && node tools/verify/scenebuilder_compare.js`
Expected: FAIL (tilemap не заполнен, много несовпадений).

- [ ] **Step 3: Реализовать build_tilemap (порт v1 drawRoom+getTileFromID)**

Прочесть v1 `drawRoom` (0x2622) и `getTileFromID` (0x2646) в msx/kvalley_src.asm — как map-ID экрана конвертится в tile-ID name-таблицы. Портировать НАТИВНО в build_tilemap: для 24 строк × 32 столбца читать map-ID из (HL), маппить в tile-ID (порт getTileFromID), звать set_tile(cell,id) ИЛИ прямо писать scn_tilemap (в этой задаче можно прямо, dirty — Task 4). ТОЛЬКО i8080-опкоды. Точная логика маппинга — из исходника v1 (getTileFromID), не выдумывать.

- [ ] **Step 4: Пересобрать, прогнать — PASS по tilemap**

Run: `cd /Users/boris/Projects/kvalley-v06c && tools/bin/sjasm v2/sb_harness.asm /tmp/sb_harness.rom && node tools/verify/scenebuilder_compare.js`
Expected: PASS — scn_tilemap == v1 name-тень (0 несовпадений). i8080-гейт: `tools/bin/sjasm v2/sb_harness.asm /tmp/sb_harness.rom /tmp/sb.lst && node tools/verify/check_i8080.js /tmp/sb.lst` → OK.

- [ ] **Step 5: Commit**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add v2/scene_builder.asm v2/sb_harness.asm tools/verify/scenebuilder_compare.js
git commit -m "feat(v2/m2a): native build_tilemap (MapaRAM->tilemap) == v1 name-table, i8080-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Нативный build_sprites (актёры → sprite-list)

**Files:** Modify `v2/scene_builder.asm`, `v2/sb_harness.asm`, `tools/verify/scenebuilder_compare.js`

**Interfaces:** Produces — `build_sprites`: читает актёр-структуры (прота/мумии/ножи) из RAM, заполняет scn_sprites (Y,X,FRAME,COLOR,FLAGS × N) + scn_nsprites, воспроизводя v1 updateSprites+AI_Cuchillos→SAT.

- [ ] **Step 1: Расширить сравниватель на sprites — FAIL**

Modify `scenebuilder_compare.js`: положить актёр-структуры из снапшота в RAM (по адресам, где build_sprites их ждёт), после build_sprites сверить scn_sprites (0x4300..) + scn_nsprites с РЕФЕРЕНСОМ v1 SAT (в снапшоте — блок sprites@768, nsprites@848). Добавить `call build_sprites` в sb_harness (пустой `build_sprites: ret`).
Run: пересобрать + `node tools/verify/scenebuilder_compare.js`
Expected: tilemap PASS, sprites FAIL.

- [ ] **Step 2: Реализовать build_sprites (порт v1 updateSprites+AI_Cuchillos)**

Прочесть v1 `updateSprites` (0x1121), `setAttribProta` (0x12CF), `AI_Cuchillos` (0x1E59) — как прота/мумии/ножи попадают в SAT (Y,X,pattern,color). Портировать НАТИВНО: читать структуры (ProtaY/X, momiaData × numMomias, knifesData × numKnifes), заполнить scn_sprites + scn_nsprites в том же порядке/формате, что v1 SAT. ТОЛЬКО i8080-опкоды.

- [ ] **Step 3: Пересобрать, прогнать — PASS оба**

Run: `cd /Users/boris/Projects/kvalley-v06c && tools/bin/sjasm v2/sb_harness.asm /tmp/sb_harness.rom && node tools/verify/scenebuilder_compare.js`
Expected: tilemap PASS И sprites PASS (scn_sprites==v1 SAT, scn_nsprites совпал). i8080-гейт OK.

- [ ] **Step 4: Commit**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add v2/scene_builder.asm v2/sb_harness.asm tools/verify/scenebuilder_compare.js
git commit -m "feat(v2/m2a): native build_sprites (actors->sprite list) == v1 SAT, i8080-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Dirty-фон (set_tile + dirty-путь render_frame)

**Files:** Modify `v2/driver_vector.asm`, `v2/scene_builder.asm`, Create `tools/verify/dirty_compare.js`

**Interfaces:** Produces — `set_tile(cell,id)`: scn_tilemap[cell]=id; если изменился, cell→scn_dirty (2Б LE) + inc scn_ndirty. `render_frame` dirty-путь: блит только клеток из scn_dirty (+спрайты). Флаг full-render (в scene.inc) для загрузки (все dirty).

- [ ] **Step 1: Тест dirty — FAIL**

Создать `tools/verify/dirty_compare.js`: (а) full-render загрузка сцены (флаг full) → пиксель-компар планов == v1 (как M1). (б) затем один set_tile(изменить клетку) → render_frame → проверить, что перебличена ТОЛЬКО та клетка (scn_ndirty==1 и её 8 план0-байт изменились, остальной план0 == прошлого кадра). Пока dirty-путь не реализован → часть (б) FAIL.

- [ ] **Step 2: Реализовать set_tile + dirty-путь**

В `v2/scene_builder.asm`/`driver_vector.asm`: `set_tile(cell,id)` (сравнить старый tilemap[cell], если ≠ — записать + добавить cell в scn_dirty LE + inc scn_ndirty). `build_tilemap` (Task 2) переключить на вызов set_tile. В `render_frame`: если full-флаг — блит всех 768 (как M1) + сброс full; иначе — цикл по scn_dirty, блит каждой dirty-клетки (blit_bg_cell), затем очистить scn_ndirty. Спрайты как в M1. ТОЛЬКО i8080-опкоды.

- [ ] **Step 3: Пересобрать, прогнать — PASS**

Run: `cd /Users/boris/Projects/kvalley-v06c && node tools/verify/dirty_compare.js`
Expected: (а) full-render == v1 (0 несовпадений); (б) после единичного set_tile перебличена ровно 1 клетка (scn_ndirty==1), экран корректен. i8080-гейт OK.

- [ ] **Step 4: Commit**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add v2/driver_vector.asm v2/scene_builder.asm v2/scene.inc tools/verify/dirty_compare.js
git commit -m "feat(v2/m2a): set_tile + dirty-only bg render — full-load == v1, single change = 1 reblit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Валидация на 3 комнатах + фиксация M2a

**Files:** Modify `tools/verify/scene_extract.js`, `tools/verify/scenebuilder_compare.js`, `v2/README.md`, `docs/JOURNAL.md`

- [ ] **Step 1: Захватить вход+референс для 3 комнат**

Параметризовать scene_extract.js (уже есть арг 1/2/3 из M1) чтобы захватывать и вход-блок (MapaRAM+актёры) для 3 сцен → /tmp/v1_scene_1/2/3.bin.
Run: `cd /Users/boris/Projects/kvalley-v06c && for i in 1 2 3; do node tools/verify/scene_extract.js $i; done`
Expected: 3 снапшота с вход-блоками.

- [ ] **Step 2: Прогнать сборщик на 3 комнатах — PASS×3**

Параметризовать scenebuilder_compare.js аргом снапшота.
Run: `cd /Users/boris/Projects/kvalley-v06c && for i in 1 2 3; do echo "комната $i:"; node tools/verify/scenebuilder_compare.js $i; done`
Expected: tilemap==v1 И sprites==v1 на всех 3.

- [ ] **Step 3: i8080-гейт всего модуля + README**

Run: `tools/bin/sjasm v2/sb_harness.asm /tmp/sb_harness.rom /tmp/sb.lst && node tools/verify/check_i8080.js /tmp/sb.lst` → OK.
Дописать в `v2/README.md` раздел M2a: нативный сборщик сцены (build_tilemap/build_sprites == v1 на 3 комнатах) + dirty-фон (единичный set_tile = 1 переблит), i8080-чист. Что дальше: M2b физика героя.

- [ ] **Step 4: Journal + commit майлстоуна M2a**

Дописать docs/JOURNAL.md «## M2a ГОТОВ»: нативный сборщик сцены доказан против v1 (tilemap+sprites, 3 комнаты), dirty-фон работает, i8080-чист. Следующее: M2b (физика/управление героя, локстеп vs v1).
```bash
cd /Users/boris/Projects/kvalley-v06c
git add tools/verify/scene_extract.js tools/verify/scenebuilder_compare.js v2/README.md docs/JOURNAL.md
git commit -m "test(v2/m2a): scene-builder validated vs v1 on 3 rooms; dirty-bg; M2a done

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review (при написании)

- **Покрытие спеки:** build_tilemap (Task 2), build_sprites (Task 3), dirty-фон+set_tile (Task 4), вход-экстрактор (Task 1), 3-комнатная валидация+i8080-гейт (Task 5). Native-unpack/физика/AI — вне объёма (спека). ✓
- **Плейсхолдеры:** маппинг map-ID→tile-ID и формат структур — ссылки на конкретные рутины v1 (drawRoom 0x2622/getTileFromID 0x2646/updateSprites 0x1121/AI_Cuchillos 0x1E59) в исходнике, не «TODO». ✓
- **Согласованность:** символы scene.inc и адреса v1 из Global Constraints едины во всех задачах; снапшот-блоки (tilemap@0=name-ref, sprites@768=SAT-ref, вход-блок) согласованы между экстрактором (Task 1) и сравнивателями (Task 2-4). ✓
