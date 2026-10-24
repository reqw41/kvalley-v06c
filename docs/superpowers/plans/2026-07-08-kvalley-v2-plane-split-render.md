# KV v2 план-разделённый рендер 2+2 — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНАЯ СУБ-СКИЛЛ: superpowers:subagent-driven-development —
> исполнять по задачам. Шаги — чекбоксы `- [ ]`.

**Цель:** переписать рендер v2 на схему 2+2 (фон→планы 0,1; спрайты→планы 2,3), flicker-free
архитектурно, порт метода Monty (~/projects/monty-recomp/src/vdp_shim.asm).

**Архитектура:** 4 плана Вектора (32КБ фреймбуфер 0x8000-0xFFFF). Фон в 0,1 (не трогается
спрайтами). Спрайты в 2,3 через blit2/clear_box (перезапись, прозрачн.=0, БЕЗ RMW). Палитра
16 слотов, программируется раз. Спрайт-паттерны в 2+2 формате (64Б/спрайт).

**Стек:** i8080 (Z80-мнемоники sjasm 0.39). Референс: docs/reference/SOFT_VDP_VECTOR.md,
Monty src/vdp_shim.asm (blit2:2167, clear_box:2229, program_palette:2277).

## Global Constraints
- Только i8080-опкоды (check_i8080.js; без Z80-only 08/10/18/20/28/30/38, CB/D9/DD/ED/FD).
- Мнемоники Z80 (i8080-подмножество), комменты КОРОТКИЕ (sjasm -s лимит длины строки).
- Планы: 0=$8000,1=$A000,2=$C000,3=$E000; planeH шаг +$20 в старшем байте.
- Новый рендер — в НОВЫХ файлах v2/r2/*.asm; старый driver_vector.asm НЕ трогать (референс).
- Валидация: headless чтение планов из памяти (0x8000/A000/C000/E000) + браузер vector06js.
- Код+данные < 32КБ (0x0100-0x7FFF); фреймбуфер 0x8000-0xFFFF.
- Каждая задача: собирается 0 ошибок, check_i8080 OK, headless-проверка своей цели, коммит.

---

### Task 1: Палитра 2+2 + очистка 4 планов + цветной пустой экран

**Files:**
- Create: `v2/r2/palette.asm` (program_palette2 + palette_data 16Б)
- Create: `v2/r2/clear.asm` (clear_planes: обнулить 0x8000-0xFFFF)
- Create: `v2/scene2.inc` (адреса 2+2: планы, palette_data-src, sprite-list, sprpat2)
- Create: `v2/r2/demo1.asm` (харнесс: init → clear → palette → halt-loop)
- Create: `tools/verify/gen_palette_2plus2.js` (генерит palette_data: 4 фон + 3 спрайт цвета)
- Create: `tools/verify/read_planes.js` (headless: читает планы 0,1,2,3 из памяти + io.Palette)

**Interfaces:**
- Produces: `program_palette2` (di, порт $02=индекс, $0C=цвет ×8, 16 слотов из palette_data);
  `clear_planes` (обнулить 4 плана); `PAL0..PAL15` в palette_data.

- [ ] **Step 1:** gen_palette_2plus2.js — палитра: слот i, где (i>>2)&3==0 → цвет фона[i&3]
  (4 базовых), иначе → цвет спрайта[(i>>2)&3] (3). Формат байта Вектора `(b<<6)|(g3<<3)|r3`.
  Задать заметные цвета (фон: чёрный/кирпич/жёлтый/белый; спрайт: красн/жёлт/белый).
  ⚠ порядок бит планов в индексе палитры Вектора — сверить с Monty hw.inc; если неясно —
  headless-эмпирика (записать план2=1 в пиксель, посмотреть какой io.Palette слот горит).
- [ ] **Step 2:** palette.asm — program_palette2 (Saboteur-стиль как Monty:2277).
- [ ] **Step 3:** clear.asm — clear_planes (обнулить 0x8000-0xFFFF; можно PUSH-стеком, DI).
- [ ] **Step 4:** demo1.asm — di; sp; clear_planes; program_palette2; вписать тест-пиксели
  в каждый план (по одному в 0,1,2,3) для проверки палитры; ei;halt loop.
- [ ] **Step 5:** read_planes.js — headless: прогнать demo1, прочитать io.Palette (16 цветов
  ненулевых?) + тест-пиксели в планах. Вывод: палитра запрограммирована, планы очищены.
- [ ] **Step 6:** сборка (`tools/bin/sjasm v2/r2/demo1.asm ...`), check_i8080, headless-чек, коммит.
  Деплой demo1 → vector06js (kvv2_r2_1.rom), браузер-ссылка: цветные тест-пиксели видны.

---

### Task 2: Фон → планы 0,1 (2-плановый цветной тайл-блит)

**Files:**
- Create: `v2/r2/bg.asm` (blit_bg2: тайл → планы 0,1 по bgmap-цвету; render_bg2: все клетки)
- Create: `tools/verify/gen_bgpat_2plane.js` (bgpat в 2 плана + bgmap-LUT из данных сцены)
- Modify: `v2/scene2.inc` (scn2_bgpat 2-плановый, scn2_bgmap LUT, scn2_tilemap)
- Modify: `v2/r2/demo1.asm` → `v2/r2/demo2.asm` (+ build_tilemap2 + render_bg2)

**Interfaces:**
- Consumes: scn2_tilemap, scn2_bgpat (2 плана), scn2_bgmap.
- Produces: `blit_bg2(B=row,C=col)` пишет тайл в планы 0,1 (H=$80+col плана0, +$20 план1),
  цвет тайла из bgmap; `render_bg2` — все 768 клеток.

- [ ] **Step 1:** изучить как текущий build_tilemap/bgpat кодируют тайл+цвет (bank=треть).
  gen_bgpat_2plane.js: раскладка тайлов в 2 плана (паттерн→pl0/pl1 по цвету фона из bgmap).
- [ ] **Step 2:** bg.asm — blit_bg2: паттерн тайла → планы 0,1 (colonar/column как blit_bg_cell,
  но 2 плана вместо совмещённого); адрес планов $80+col/$A0+col.
- [ ] **Step 3:** demo2: clear+palette+render_bg2(сцена 1). Тест: лабиринт в цвете в планах 0,1.
- [ ] **Step 4:** headless (read_planes): планы 0,1 после render_bg2 == ожидаемая композиция
  фона (реконструировать индекс = pl0|pl1<<1 по пикселям, сверить с тайлмапом/паттернами).
- [ ] **Step 5:** сборка, check_i8080, headless, коммит. Деплой (kvv2_r2_2.rom): цветной
  лабиринт БЕЗ спрайтов виден в браузере.

---

### Task 3: Спрайт-паттерны → формат 2+2 + цвет-LUT

**Files:**
- Create: `tools/verify/gen_sprpat_2plane.js` (MSX sprpat → 2+2: 64Б/спрайт, план2+план3)
- Create: `tools/verify/sprcol_lut.js` или таблица в scene2.inc (MSX-цвет спрайта → 2бит)
- Modify: `v2/scene2.inc` (scn2_sprpat = 2+2 паттерны, sprcol_lut)

**Interfaces:**
- Produces: scn2_sprpat (спрайт N = 64Б: 16 строк×2Б план2, затем 16×2 план3, как читает blit2),
  sprcol_lut[16].

- [ ] **Step 1:** разобрать MSX-раскладку sprpat (квадранты TL,BL,TR,BR × 8Б) + как blit2
  читает sp_src (2Б/строку, 16 строк на план). Определить порядок сборки 16×16 → 2 плана.
- [ ] **Step 2:** sprcol_lut: MSX-цвет спрайта (tiposMomia/цвета прота) → 2-битное значение
  план2/3 (1/2/3). Свериться с conv_engine.py Monty (аналог sprcol_lut).
- [ ] **Step 3:** gen_sprpat_2plane.js: для каждого спрайт-кадра разложить пиксели по план2/3
  согласно цвету (2бит). Прозрачные=0.
- [ ] **Step 4:** headless-проверка: реконструировать спрайт из 2+2 данных == исходный
  пиксель-паттерн (форма+цвет). Коммит (данные+конвертер).

---

### Task 4: Порт blit2/clear_box → один статичный спрайт поверх фона

**Files:**
- Create: `v2/r2/sprites.asm` (blit2 + clear_box, порт Monty:2167/2229; scratch-ячейки)
- Modify: `v2/r2/demo2.asm` → `v2/r2/demo3.asm` (+ 1 спрайт через blit2)

**Interfaces:**
- Consumes: sp_src (адрес 2+2 паттерна), sp_shift(X&7), sp_lbase(~(Y+32)), planeH($C0+X>>3),
  sp_nrows(16).
- Produces: `blit2` (спрайт→планы 2,3, перезапись), `clear_box` (обнулить регион 2,3).

- [ ] **Step 1:** sprites.asm — портировать blit2/clear_box ДОСЛОВНО (Monty:2167/2229),
  адаптировать имена ячеек (planeH/sp_lbase/sp_src/sp_shift/sp_nrows/sp_rows/dp_plane).
  i8080-чистота (Z80-мнемоники → i8080, проверить каждую инструкцию).
- [ ] **Step 2:** demo3: render_bg2 + один спрайт (герой-кадр) через blit2 в планы 2,3 поверх.
- [ ] **Step 3:** headless: планы 2,3 после blit2 == ожидаемый спрайт на позиции; планы 0,1
  (фон) НЕ изменились (ключевая проверка: blit2 фон не трогает!).
- [ ] **Step 4:** сборка, check_i8080, headless, коммит. Деплой (kvv2_r2_3.rom): цветной
  спрайт поверх цветного фона в браузере, СТАТИЧНО.

---

### Task 5: Спрайт-цикл (clear старых → blit текущих) + движущиеся герой/мумии

**Files:**
- Create: `v2/r2/render.asm` (render_frame2: clear_box прошлых спрайтов → blit2 текущих;
  spr_prev теневой список)
- Modify: `v2/r2/demo3.asm` → `v2/r2/demo4.asm` (движущиеся спрайты, spr_prev)

**Interfaces:**
- Consumes: список спрайтов (Y,X,pat,color) + spr_prev (прошлый кадр).
- Produces: `render_frame2` — clear всех spr_prev (планы 2,3), blit всех текущих (порядок:
  старший номер первым, младший поверх = приоритет MSX), сохранить текущие в spr_prev.

- [ ] **Step 1:** render.asm — render_frame2: цикл clear_box по spr_prev → цикл blit2 по
  текущим → копировать текущие в spr_prev. Терминатор списка (y==$D0 MSX или счётчик).
- [ ] **Step 2:** demo4: цикл ei;halt → двигать тестовые спрайты (герой+мумии по простому
  закону) → render_frame2. БЕЗ игровой логики (просто движение для теста флика).
- [ ] **Step 3:** headless: за N кадров планы 0,1 (фон) НЕИЗМЕННЫ; планы 2,3 меняются только
  под спрайтами; макс изменение = размер спрайтов, не весь экран.
- [ ] **Step 4:** сборка, check_i8080, headless, коммит. Деплой (kvv2_r2_4.rom): 4 спрайта
  двигаются в браузере — ПРОВЕРКА ФЛИКА (должно быть стабильно, фон не мигает).

---

### Task 6: Гемы = искра-спрайт (планы 2,3) над гемом

**Files:**
- Modify: `v2/r2/render.asm` (гем-искра как обычный спрайт в списке, мигает по каденции)
- Modify: `v2/scene2.inc` (гем-список + искра-паттерн из sprpat)

**Interfaces:**
- Гем = статичный спрайт/тайл (алмаз); искра = спрайт (index искры из Task 3), появляется/
  пропадает в списке спрайтов по каденции (раз в N кадров).

- [ ] **Step 1:** найти алмаз+искру в sprpat (нашли: искра ~index 53/54); добавить искру
  в 2+2 sprpat. Гем-центр — статичный (фон-тайл алмаз ИЛИ спрайт).
- [ ] **Step 2:** гем-логика: раз в GEM_BLINK_PERIOD кадров добавлять/убирать искра-спрайты
  из списка спрайтов (над каждым видимым гемом) → render_frame2 их clear/blit.
- [ ] **Step 3:** headless: искра появляется/пропадает (планы 2,3 у гема меняются по каденции),
  фон+другие спрайты не затронуты. Коммит. Деплой: искры мигают над гемами БЕЗ флика экрана.

---

### Task 7: Интеграция игровой логики → играбельно, flicker-free

**Files:**
- Create: `tools/verify/gen_demo_r2.js` (боевое демо: hero_tick/ai_momias → build_sprites2 →
  render_frame2, сцена+данные 2+2)
- Create: `v2/r2/build_sprites2.asm` (актёры → список спрайтов 2+2, цвет через sprcol_lut)

**Interfaces:**
- Consumes: scn_prota/scn_momiadat (та же игровая логика), sprcol_lut.
- Produces: `build_sprites2` (прота 2 слоя + мумии + ножи + гем-искры → sprite-list для render_frame2).

- [ ] **Step 1:** build_sprites2 — как текущий build_sprites, но выход = 2+2 sprite-list
  (Y,X,pat,color→sprcol_lut), герой=2 слоя, приоритет MSX.
- [ ] **Step 2:** gen_demo_r2: цикл input_read → ai_momias → hero_tick → glue → build_sprites2
  → render_frame2 (+ гем-искры). Реальный ввод.
- [ ] **Step 3:** headless: играбельно (герой двигается по вводу, мумии гоняются); фон
  стабилен; спрайты в планах 2,3. Тик < 59904.
- [ ] **Step 4:** сборка, check_i8080, headless, коммит. Деплой (kvv2_r2.rom).

---

### Task 8: Финальный гейт + деплой

- [ ] **Step 1:** Браузерная проверка: герой/мумии/сияние гемов СТАБИЛЬНЫ при движении 2+
  объектов (нет флика фона/спрайтов); 16 цветов видны; играется.
- [ ] **Step 2:** Профиль тика < 59904 (запас); код+данные < 32КБ.
- [ ] **Step 3:** Финальное whole-branch ревью (opus). Обновить прогресс/память.
- [ ] **Step 4:** Тег/финал. Старый driver_vector.asm архивировать (или удалить после подтверждения).

---

## Self-Review заметки
- Валидация НЕ через прежний pixel-compare (2+2 ≠ 2-план); новый эталон = плановая композиция
  (headless read_planes) + визуал.
- Порядок бит планов Вектора в палитре — риск №1, разрешить эмпирически в Task 1 до всего.
- Конверсия sprpat (Task 3) — сверить порядок чтения blit2 (sp_src: 2Б/строку, план2 потом план3).
- Приоритет спрайтов (герой 2 слоя) — порядок blit (старший первым).
- Бюджет памяти — контролировать после Task 2 (2-плановый bgpat) и Task 3 (2+2 sprpat).
