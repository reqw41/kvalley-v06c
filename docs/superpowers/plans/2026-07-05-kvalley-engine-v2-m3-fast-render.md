# King's Valley engine v2 — M3: быстрый рендер (POP-движок) → 50 Гц (план)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Переписать горячий рендер v2 (`v2/driver_vector.asm`: спрайты + restore фона + палитра) на стековый POP-движок (OldTower), чтобы render влезал в окно vblank и весь тик укладывался в 59904 такта (50 Гц) — убрав флик и подёргивание. ИНВАРИАНТ: рендер даёт ТОТ ЖЕ вывод (пиксель-компар держится), только быстрее.

**Architecture:** M3 меняет ТОЛЬКО драйвер (`v2/driver_vector.asm`) + подготовку данных спрайтов (interleaved-раскладка, pre-shifted копии). Контракт сцены (`scene.inc`) и логика (`hero.asm`/`momias.asm`) — НЕ трогаются. Референс техники: docs/reference/OLDTOWER_ANALYSIS.md + исходник /tmp/oldtower (sprites.a80). Спека: docs/superpowers/specs/2026-07-05-kvalley-engine-v2-m3-fast-render.md.

**Tech Stack:** i8080 asm (tools/bin/sjasm 0.39, Z80-мнемоники→8080), headless vector06js (node+vm), tools/verify/. check_i8080.js — гейт чистоты.

## Global Constraints

- **ИНВАРИАНТ КОРРЕКТНОСТИ:** после КАЖДОЙ задачи планы v2 == эталон (v1 soft-VDP) — рендер даёт бит-в-бит тот же вывод. Гейты: `tools/verify/driver_pixelcompare.js` (одиночный кадр, 3 сцены, 0/0 оба плана) И `tools/verify/twopass_compare.js` (многокадровая анимация == чистый композит). Оба ДЕРЖАТСЯ на каждом шаге.
- **ЦЕЛЬ ПЕРФА:** замер тактов render_frame падает на каждом шаге; финал — render < окна vblank (~10-11К тактов) И весь тик (логика+build+render) < 59904.
- Цель — ванильный i8080/Вектор: ТОЛЬКО i8080-опкоды (check_i8080.js OK). POP/PUSH/DI/SPHL/self-mod — ЛЕГАЛЬНЫ на i8080 (не Z80-only); запрещены 08/10/18/20/28/30/38, CB/D9/DD/ED/FD.
- Рендер идёт под DI в vblank (SP занят стек-хаком) — сохранять/восстанавливать SP; не мешать RST7-ISR демо (SP восстановлен до ei;halt).
- Дев-скрипты в tools/verify/, не /tmp. Сборка v1+сцены: `python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/kvv.asm --target vector && tools/bin/sjasm -s /tmp/kvv.asm /tmp/kvv.rom /tmp/kvv.sym && for i in 1 2 3; do node tools/verify/scene_extract.js $i; done`.
- Текущий бюджет (замер сессии): render_frame ~73К (draw_sprites 38К + bg-restore ре-блитом 22К + erase 8К + палитра 2.4К), build_sprites ~25К, логика ~1К. Vector 2-плоскостный 4-цветный (план0=0x8000, план1=0xA000, шаг плоскости +0x20 в старшем байте адреса).

## Файловая структура

- `v2/driver_vector.asm` — переписывается: `render_frame`/`draw_sprites`/`erase_sprites`/`espr_restore_bg` → POP-блит + saved-pixels + pre-shifted + render-list. `set_palette` → multiple-out.
- `v2/spr_data.inc` (новый) — interleaved-раскладка паттернов спрайтов + pre-shifted копии (генерятся конвертером).
- `tools/verify/gen_spr_data.js` (новый) — конвертер: паттерны спрайтов (из v1 shadow) → interleaved 2-плоскостной формат + 8 pre-shifted копий (X&7).
- `tools/verify/render_profile.js` (новый) — профиль render_frame по под-фазам (такты) + весь тик; сравнение с 59904 и окном vblank.
- Гейты (существующие): `tools/verify/driver_pixelcompare.js`, `tools/verify/twopass_compare.js`, `tools/verify/check_i8080.js`.

---

### Task 1: Разведка OldTower + профиль-базлайн + дизайн данных (де-риск, БЕЗ переписи)

**Files:** Create `tools/verify/render_profile.js`; report `.superpowers/sdd/m3-task-1-report.md`. NO changes to driver.

**Interfaces:** Produces — (1) точная POP-блит-техника для НАШЕГО 2-плоскостного формата (из /tmp/oldtower/include/sprites.a80 + coins.a80); (2) базлайн тактов render_frame по под-фазам (профилировщик); (3) дизайн: interleaved-раскладка спрайта, saved-pixels буфер (размер/адрес/порядок), SP-хак план (сохранение SP, DI, восстановление до ei;halt); (4) оценка достижимости render<vblank.

- [ ] **Step 1: Изучить POP-движок OldTower (реальный исходник)**

Прочесть `/tmp/oldtower/include/sprites.a80` (POP-блит тайла/спрайта в 4 плоскости), `coins.a80`/`coinsFAST.a80`, `enemies.a80` — как SP наводится на данные, порядок pop/write, шаг плоскости, computed-entry для обрезки, render-list (putTile/drawSprites). Адаптировать к НАШЕЙ 2-плоскостной 4-цветной схеме Вектора (план0 0x8000 / план1 0xA000, шаг +0x20). Задокументировать конкретный код-скелет для v2.

- [ ] **Step 2: Профилировщик render_frame (базлайн)**

`tools/verify/render_profile.js`: грузит демо-ROM (или harness), меряет такты render_frame по под-фазам (set_palette/erase/bg-restore/draw/save) — атрибуция по диапазонам PC (как делалось в сессии, см. m3-task-1 методику). Печатает базлайн + окно vblank Вектора (вычислить точно: кадр 59904 такта, сколько строк невидимо → цикл гашения).
Run: `cd /Users/boris/Projects/kvalley-v06c && node tools/verify/render_profile.js`
Expected: печатает под-фазы (draw_sprites ~38К, bg-restore ~22К и т.д.), окно vblank в тактах.

- [ ] **Step 3: Дизайн данных + SP-хак**

Спроектировать: (а) interleaved-раскладку паттерна спрайта под POP (2 плоскости, 16 строк); (б) saved-pixels буфер (адрес в свободном ОЗУ, размер = байты фона под спрайтом × N спрайтов, порядок restore обратный draw при перекрытии); (в) SP-хак: где сохранить SP, DI на входе render_frame, восстановить SP перед ret (в демо render_frame зовётся ПОСЛЕ halt, но SP всё равно вернуть для стека). Задокументировать в отчёт.

- [ ] **Step 4: Commit (профилировщик + отчёт-дизайн)**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add tools/verify/render_profile.js
git commit -m "feat(v2/m3): render cycle-profiler + POP-engine recon/design (de-risk, no rewrite)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Saved-pixels restore фона (заменить ~22К ре-блит)

**Files:** Modify `v2/driver_vector.asm`

**Interfaces:** Produces — при draw спрайта: сохранить байты фона (обоих планов) под ним в saved-pixels буфер; erase_sprites/espr_restore_bg → восстановить из буфера (копия), НЕ ре-блит тайлов из паттернов.

- [ ] **Step 1: Реализовать save-under-sprite + restore-from-buffer**

Заменить `espr_restore_bg` (ре-блит фона) на: (а) при draw_sprites — перед XOR-рисованием сохранить фон-байты под спрайтом в буфер; (б) при erase — вернуть их копией. По дизайну Task 1. ТОЛЬКО i8080.

- [ ] **Step 2: Гейты — пиксель-компар держится + такты упали**

Run: `cd /Users/boris/Projects/kvalley-v06c && tools/bin/sjasm v2/test_harness.asm /tmp/v2_harness.rom && for i in 1 2 3; do node tools/verify/driver_pixelcompare.js $i; done && node tools/verify/twopass_compare.js 3 && node tools/verify/render_profile.js`
Expected: driver_pixelcompare 0/0 на 3 сценах; twopass PASS; render_profile — bg-restore фаза упала (было ~22К). i8080-гейт OK.

- [ ] **Step 3: Commit**

```bash
git add v2/driver_vector.asm
git commit -m "perf(v2/m3): saved-pixels bg-restore (no reblit) — pixel-exact, cycles down

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: POP-блит спрайтов (interleaved данные + SP-хак)

**Files:** Modify `v2/driver_vector.asm`; Create `v2/spr_data.inc`, `tools/verify/gen_spr_data.js`

**Interfaces:** Produces — паттерны спрайтов в interleaved 2-плоскостном формате (gen_spr_data.js); `draw_sprites`/erase через POP-блит (SP=данные, pop, write с шагом плоскости), под DI со стек-хаком.

- [ ] **Step 1: Конвертер interleaved-данных**

`tools/verify/gen_spr_data.js`: паттерны спрайтов (из v1 shadow / scn_sprpat) → interleaved формат под POP (по дизайну Task 1) → `v2/spr_data.inc`.

- [ ] **Step 2: Реализовать POP-блит draw/erase**

Переписать draw_sprites (и erase, если через POP) на стек-блит: `di; ld (sp_save),sp; ld sp,<данные>; pop de; ld (hl),e; ...` с шагом плоскости, восстановить SP. Мультиколор-маршрутизация (white/red/ochre) сохранена. ТОЛЬКО i8080.

- [ ] **Step 3: Гейты — пиксель-компар держится + такты draw упали**

Run: `cd /Users/boris/Projects/kvalley-v06c && tools/bin/sjasm v2/test_harness.asm /tmp/v2_harness.rom && for i in 1 2 3; do node tools/verify/driver_pixelcompare.js $i; done && node tools/verify/twopass_compare.js 3 && node tools/verify/render_profile.js`
Expected: пиксель-компар 0/0 + twopass PASS; render_profile — draw_sprites фаза упала (было ~38К). i8080 OK (POP/PUSH/SPHL легальны).

- [ ] **Step 4: Commit**

```bash
git add v2/driver_vector.asm v2/spr_data.inc tools/verify/gen_spr_data.js
git commit -m "perf(v2/m3): POP-blit sprites (interleaved data, SP-hack) — pixel-exact, cycles down

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Pre-shifted спрайты (LUT по X&7 — убрать сдвиг из цикла)

**Files:** Modify `tools/verify/gen_spr_data.js`, `v2/driver_vector.asm`

**Interfaces:** Produces — 8 pre-shifted копий паттерна спрайта (по X&7) в spr_data.inc; draw_sprites выбирает готовую копию по X&7 вместо вычисления сдвига/маски в цикле.

- [ ] **Step 1: Генерить pre-shifted копии**

Расширить gen_spr_data.js: для каждого паттерна — 8 сдвинутых копий (X&7=0..7), уже с межбайтовым переносом. Обрезка по краю — computed-entry (по дизайну Task 1).

- [ ] **Step 2: draw_sprites выбирает копию по X&7**

Убрать вычисление сдвига из горячего цикла — `ld a,(sprX); and 7; ...` → адрес нужной pre-shifted копии, дальше POP-блит. ТОЛЬКО i8080.

- [ ] **Step 3: Гейты — пиксель-компар держится + такты упали**

Run: `cd /Users/boris/Projects/kvalley-v06c && for i in 1 2 3; do node tools/verify/driver_pixelcompare.js $i; done && node tools/verify/twopass_compare.js 3 && node tools/verify/render_profile.js` (+сборка+i8080)
Expected: пиксель-компар 0/0 + twopass PASS; такты draw ещё упали. i8080 OK.

- [ ] **Step 4: Commit**

```bash
git add v2/driver_vector.asm tools/verify/gen_spr_data.js v2/spr_data.inc
git commit -m "perf(v2/m3): pre-shifted sprite LUT by X&7 — shift out of hot loop, pixel-exact

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Render-list + только-сдвинувшиеся + multiple-out палитра + ГЕЙТ 50 Гц

**Files:** Modify `v2/driver_vector.asm`, `tools/verify/gen_demo_m2b.js` (при нужде), `v2/README.md`, `docs/JOURNAL.md`

**Interfaces:** Produces — render-list (готовые адреса), только-изменённые спрайты (мультиплекс-безопасно), set_palette multiple-out по флагу.

- [ ] **Step 1: Multiple-out палитра по флагу**

set_palette: писать каждый индекс 6-8× `out (0Ch)` (надёжность железа); обновлять по флагу palUpdateFlag (не каждый кадр — палитра статична).

- [ ] **Step 2: Render-list + только-сдвинувшиеся спрайты**

build_sprites/render_frame: пометка спрайта → запись render-list с готовым адресом; erase+draw только изменённых (сравнить с прошлым кадром), мультиплекс-безопасно (порядок). Пиксель-компар + twopass ДЕРЖАТСЯ (аккуратно: статичные спрайты не должны исчезать).

- [ ] **Step 3: ГЕЙТ 50 Гц + браузер**

Run: `cd /Users/boris/Projects/kvalley-v06c && for i in 1 2 3; do node tools/verify/driver_pixelcompare.js $i; done && node tools/verify/twopass_compare.js 6 && node tools/verify/render_profile.js && node tools/verify/check_i8080.js /tmp/demo_m2b.lst`
Expected: пиксель-компар 0/0 + twopass PASS; **render_frame < окна vblank И весь тик < 59904** (профиль); i8080 OK. Пересобрать+задеплоить демо `cp /tmp/v2_demo_m2b.rom /Users/boris/projects/vector06js/kvv2_m2b.rom` (URL http://localhost:8087/?kvv2_m2b.rom — флик и подёргивание ушли).

- [ ] **Step 4: README + journal + фиксация M3**

Дописать v2/README.md раздел M3 (POP-движок, saved-pixels, pre-shifted, render-list; render_frame Xтактов < vblank; тик < 59904 = 50 Гц; пиксель-компар держится = тот же вывод). docs/JOURNAL.md «## M3 ГОТОВ». Честные оговорки (реальное железо не проверено; multiple-out палитра).
```bash
git add v2/driver_vector.asm tools/verify/gen_demo_m2b.js v2/README.md docs/JOURNAL.md
git commit -m "perf(v2/m3): render-list + moved-only sprites + multi-out palette; 50Hz gate; M3 done

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review (при написании)

- **Покрытие спеки:** saved-pixels (Task 2), POP-блит (Task 3), pre-shifted (Task 4), render-list+only-moved+multi-out+50Гц-гейт (Task 5); разведка+профиль+дизайн де-рискуют (Task 1). ZX0/Rockman16-уровень — вне объёма (спека). ✓
- **Инвариант держится:** пиксель-компар (driver_pixelcompare 3 сцены + twopass) на КАЖДОЙ задаче — рендер даёт тот же вывод, только быстрее. Не «оптимизировали и сломали вид». ✓
- **Плейсхолдеры:** техника ссылается на конкретный исходник OldTower (/tmp/oldtower/include/sprites.a80) + OLDTOWER_ANALYSIS.md, не «TODO». Дизайн данных/SP-хака — производится Task 1, потребляется Task 2-5 (контроллер уточняет по отчёту Task 1). ✓
- **Согласованность:** адреса планов (0x8000/0xA000, шаг +0x20), гейты (driver_pixelcompare/twopass/render_profile/check_i8080) и бюджет (59904, vblank) едины во всех задачах. Логика/сцена НЕ трогаются — только driver + данные спрайтов. ✓
