# King's Valley engine v2 — M2b: нативная физика героя + two-pass спрайты (план)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Нативный i8080-код физики героя (гравитация/ходьба/лестница/прыжок/копание), локстеп-доказанный против v1 потиково, + two-pass XOR-спрайты в драйвере для видимой анимации. Итог — браузерный ROM с движущимся героем, бит-в-бит как v1.

**Architecture:** Слои движка v2. M2b = нативный `v2/hero.asm` (Слой 1, ядро) + two-pass в `v2/driver_vector.asm` (Слой 3). Кормится состоянием живого v1 (паттерн M1/M2a). Спека: docs/superpowers/specs/2026-07-04-kvalley-engine-v2-m2b-hero-physics.md.

**Tech Stack:** i8080 asm (tools/bin/sjasm 0.39, Z80-мнемоники→8080), headless vector06js (node+vm), tools/verify/. check_i8080.js — гейт чистоты.

## Global Constraints

- Цель — ванильный i8080/Вектор: ТОЛЬКО i8080-опкоды (check_i8080.js OK; запрещены Z80-only 08/10/18/20/28/30/38, CB/D9/DD/ED/FD). Весь код в Z80-мнемоническом подмножестве (конвенция scene.inc).
- v1 = золотой эталон; каждый паритет доказывается headless-локстепом/пиксель-компаром, не утверждением.
- Адреса v1 (Вектор-таргет, /tmp/kvv.sym): tickGame=0x10A9, protaStatus=0x6C34, ProtaY=0x6C37, ProtaXdecimal=0x6C38, ProtaX=0x6C39, ProtaRoom=0x6C3A, protaFrame=0x6C3F, MapaRAM=0x7560, GameStatus(GS)=0x6B00, flagPiramideMap=0x6B51.
- Сцена/контракт (scene.inc): scn_prota=0x6600 (Y,X,Frame,Sentido), scn_protaroom=0x6604, scn_tilemap=0x4000, scn_sprites=0x4300, scn_fullrender=0x43D6, set_tile(DE=cell,A=id).
- КОНТРАКТ M2a (ревью): вызывающий взводит scn_fullrender=1 ПЕРЕД build_tilemap.
- Дев-скрипты в tools/verify/, не /tmp. Сборка v1: `python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/kvv.asm --target vector && tools/bin/sjasm -s /tmp/kvv.asm /tmp/kvv.rom /tmp/kvv.sym`.

## Файловая структура

- `v2/hero.asm` — нативная физика героя: `hero_tick` (вход = биты кнопок; читает/пишет prota-состояние; при копании зовёт set_tile). Машинно-независим.
- `v2/driver_vector.asm` — расширить: `input_read` (клава/джойстик→биты), two-pass XOR-спрайты (erase прошлый кадр → draw текущий) в render_frame.
- `tools/verify/hero_lockstep.js` — новый: гоняет v1 один тик на записанном вводе, снимает prota-состояние ДО/ПОСЛЕ; гоняет v2 hero_tick с тем же вводом+стартом; сверяет prota-состояние.
- `tools/verify/record_inputs.js` — новый: генерит записанные вводы, упражняющие ходьбу/падение/лестницу/прыжок/копание (снимает из живого attract-демо или скриптует).
- `v2/hero_harness.asm` — харнесс: кладёт prota-состояние+MapaRAM+ввод в RAM, зовёт hero_tick, hlt; скрипт сверяет.

---

### Task 1: Разведка секции героя + локстеп-харнесс (де-риск, БЕЗ порта)

**Files:** Create `tools/verify/hero_recon.js`, `tools/verify/hero_lockstep.js`; report to `.superpowers/sdd/m2b-task-1-report.md`

**Interfaces:** Produces — карта: (1) границы секции героя в tickGame (какие PC-диапазоны трогают prota-состояние), порядок под-механик; (2) формат байта ввода v1 (какие биты/адрес читаются); (3) ПОЛНЫЙ список байт prota-состояния, меняющихся за тик (не только Y/X/Frame — скорость/фаза прыжка/таймеры); (4) рабочий локстеп-харнесс v1↔v1 (санити).

- [ ] **Step 1: Картировать секцию героя в tickGame**

Прочесть `tickGame` (0x10A9) в msx/kvalley_src.asm целиком; выделить под-механики героя (чтение ввода, гравитация/падение, ходьба влево/вправо, лестницы, прыжок, копание) — их порядок и метки/адреса. Инструментировать headless-прогон (как profile_v1.js): за один геймплейный тик залогировать, какие адреса из [0x6C34..0x6C40] (prota-состояние) и MapaRAM пишутся и в каком порядке. Задокументировать карту в отчёт.

- [ ] **Step 2: Вскрыть формат ввода**

Найти в tickGame чтение клавиатуры/джойстика (порт/рутина), какой байт битов кнопок формируется, где хранится. Задокументировать биты (вверх/вниз/влево/вправо/копать/...).

- [ ] **Step 3: Полный формат prota-состояния**

Просканировать за геймплейный тик ВСЕ байты 0x6C00-0x6D00, которые меняются в секции героя — составить точный список полей prota-состояния для локстепа (адрес, назначение по исходнику).

- [ ] **Step 4: Локстеп-харнесс v1↔v1 (санити)**

`tools/verify/hero_lockstep.js`: снять prota-состояние+MapaRAM+ввод из живого v1 ДО тика, прогнать v1 один тик, снять ПОСЛЕ. САНИТИ: повторный прогон v1 с тем же стартом+вводом даёт то же ПОСЛЕ (детерминизм). Печатать поля prota до/после.
Run: `cd /Users/boris/Projects/kvalley-v06c && python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/kvv.asm --target vector && tools/bin/sjasm -s /tmp/kvv.asm /tmp/kvv.rom /tmp/kvv.sym && node tools/verify/hero_lockstep.js`
Expected: v1↔v1 детерминизм подтверждён; печать полей prota до/после осмысленна.

- [ ] **Step 5: Commit (инструменты разведки + отчёт-карта)**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add tools/verify/hero_recon.js tools/verify/hero_lockstep.js
git commit -m "feat(v2/m2b): hero-physics recon + v1<->v1 lockstep harness (de-risk, no port)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: input_read + формат кнопок

**Files:** Modify `v2/driver_vector.asm`, Create `tools/verify/input_compare.js`

**Interfaces:** Produces — `input_read`: читает клаву/джойстик Вектора → байт битов кнопок в стандартном формате (по карте Task 1). Харнесс подставляет записанный ввод для локстепа.

- [ ] **Step 1: Тест — биты v2 == флаги ввода v1**

`tools/verify/input_compare.js`: для набора состояний клавиатуры Вектора прогнать input_read (в харнессе), сверить полученный байт кнопок с ожидаемым по карте Task 1. Пока input_read нет → FAIL.

- [ ] **Step 2: Реализовать input_read (Вектор клава→биты)**

Портировать чтение ввода в стандартные биты кнопок (формат из Task 1). ТОЛЬКО i8080-опкоды.

- [ ] **Step 3: Прогнать — PASS + i8080-гейт**

Run: `cd /Users/boris/Projects/kvalley-v06c && node tools/verify/input_compare.js` → биты совпадают. i8080-гейт OK.

- [ ] **Step 4: Commit**

```bash
git add v2/driver_vector.asm tools/verify/input_compare.js
git commit -m "feat(v2/m2b): input_read -> standard button bits, i8080-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: hero_tick — гравитация/падение + ходьба (локстеп)

**Files:** Create `v2/hero.asm`, `v2/hero_harness.asm`; Modify `tools/verify/hero_lockstep.js`

**Interfaces:** Produces — `hero_tick(input)`: читает prota-состояние+input, применяет гравитацию/падение и ходьбу влево/вправо, пишет новое prota-состояние. По карте Task 1.

- [ ] **Step 1: Записанный ввод «ходьба+падение» + локстеп-тест — FAIL**

Добавить в hero_lockstep.js прогон v2 hero_tick (харнесс) с тем же стартом+вводом, что v1; сверять поля prota ПОСЛЕ. Ввод: шаги влево/вправо + падение с уступа. Заглушка `hero_tick: ret` → FAIL.

- [ ] **Step 2: Реализовать гравитацию/падение + ходьбу**

Портировать под-механики гравитации/падения и ходьбы из секции героя v1 (адреса/логика из отчёта Task 1) в hero_tick. ТОЛЬКО i8080-опкоды.

- [ ] **Step 3: Прогнать — PASS (потиково N кадров) + i8080**

Run: `cd /Users/boris/Projects/kvalley-v06c && node tools/verify/hero_lockstep.js walk` → prota-состояние v2 == v1 на каждом тике записанной последовательности. i8080-гейт OK.

- [ ] **Step 4: Commit**

```bash
git add v2/hero.asm v2/hero_harness.asm tools/verify/hero_lockstep.js
git commit -m "feat(v2/m2b): hero_tick gravity/fall + walk == v1 (lockstep), i8080-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: hero_tick — лестницы + прыжок (локстеп)

**Files:** Modify `v2/hero.asm`, `tools/verify/hero_lockstep.js`

**Interfaces:** Produces — hero_tick расширен лазаньем по лестницам (вверх/вниз) и прыжком (по карте Task 1).

- [ ] **Step 1: Записанный ввод «лестница+прыжок» + тест — FAIL**

Ввод, упражняющий лазанье по лестнице и прыжок. Пока не реализовано → FAIL на этих под-механиках.

- [ ] **Step 2: Реализовать лестницы + прыжок**

Портировать под-механики лестниц и прыжка из v1 (отчёт Task 1). ТОЛЬКО i8080-опкоды.

- [ ] **Step 3: Прогнать — PASS (walk+ladder+jump) + i8080**

Run: `node tools/verify/hero_lockstep.js ladder && node tools/verify/hero_lockstep.js jump` → v2==v1 потиково; регресс-прогон `walk` всё ещё PASS.

- [ ] **Step 4: Commit**

```bash
git add v2/hero.asm tools/verify/hero_lockstep.js
git commit -m "feat(v2/m2b): hero_tick ladders + jump == v1 (lockstep), i8080-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: hero_tick — копание (set_tile + смена MapaRAM) (локстеп)

**Files:** Modify `v2/hero.asm`, `tools/verify/hero_lockstep.js`

**Interfaces:** Produces — hero_tick расширен копанием: меняет MapaRAM (кирпич→дыра) и зовёт set_tile(cell, дыра); prota-состояние (таймеры копания) == v1.

- [ ] **Step 1: Записанный ввод «копание» + тест — FAIL**

Ввод, упражняющий копание. Сверять и prota-состояние, И изменённую MapaRAM/tilemap (дыра). Пока не реализовано → FAIL.

- [ ] **Step 2: Реализовать копание**

Портировать копание из v1 (отчёт Task 1): смена MapaRAM + set_tile(cell, tile-ID дыры группы 9) + таймеры. ТОЛЬКО i8080-опкоды.

- [ ] **Step 3: Прогнать — PASS (prota+MapaRAM+tilemap) + i8080; регресс walk/ladder/jump**

Run: `node tools/verify/hero_lockstep.js dig` → prota==v1, MapaRAM==v1, scn_tilemap изменённая клетка==v1. Все прежние сценарии PASS.

- [ ] **Step 4: Commit**

```bash
git add v2/hero.asm tools/verify/hero_lockstep.js
git commit -m "feat(v2/m2b): hero_tick dig (set_tile+MapaRAM) == v1 (lockstep), i8080-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Two-pass XOR-спрайты в драйвере (анимация без мусора)

**Files:** Modify `v2/driver_vector.asm`; Create `tools/verify/twopass_compare.js`

**Interfaces:** Produces — render_frame two-pass: драйвер держит копию спрайтов прошлого кадра (в ОЗУ драйвера, адрес задокументировать); каждый кадр XOR-стирает прошлые → XOR-рисует текущие scn_sprites, затем сохраняет текущие как «прошлые». Ядро не знает.

- [ ] **Step 1: Тест многокадровой анимации — FAIL**

`tools/verify/twopass_compare.js`: последовательность из ≥3 кадров, где герой двигается (scn_sprites меняются); после каждого render_frame сверять оба плана с эталоном v1 (soft-VDP v1 на той же анимации). Пока рендер одно-проходный → на кадре 2+ XOR-мусор → FAIL.

- [ ] **Step 2: Реализовать two-pass**

Добавить хранилище «прошлых спрайтов» + erase-проход (XOR прошлых) перед draw-проходом (XOR текущих) + сохранение текущих. Порт проверенного конвейера v1 (erase-all→draw-all). ТОЛЬКО i8080-опкоды.

- [ ] **Step 3: Прогнать — PASS (многокадровая анимация == v1) + i8080; M1-компар не сломан**

Run: `node tools/verify/twopass_compare.js` → каждый кадр планы == v1, мусора нет. `node tools/verify/driver_pixelcompare.js` (одиночный кадр) всё ещё PASS. i8080-гейт OK.

- [ ] **Step 4: Commit**

```bash
git add v2/driver_vector.asm tools/verify/twopass_compare.js
git commit -m "feat(v2/m2b): two-pass XOR sprites — multi-frame animation == v1, no residue

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Демо движущегося героя + фиксация M2b

**Files:** Create `tools/verify/gen_demo_m2b.js`, `v2/demo_m2b.asm`; Modify `v2/README.md`, `docs/JOURNAL.md`

- [ ] **Step 1: Собрать демо с записанным вводом**

`gen_demo_m2b.js`: встроить стартовую сцену (как demo_m2a) + записанный ввод (последовательность кнопок); ROM в цикле: input(из записи) → hero_tick → build_sprites → render_frame(two-pass) с ei/hlt(vblank). Герой ходит/копает по записи.
Run: `cd /Users/boris/Projects/kvalley-v06c && node tools/verify/gen_demo_m2b.js && tools/bin/sjasm v2/demo_m2b.asm /tmp/v2_demo_m2b.rom /tmp/demo_m2b.lst && node tools/verify/check_i8080.js /tmp/demo_m2b.lst`
Expected: собрано, i8080 OK.

- [ ] **Step 2: Headless-проверка + деплой**

Прогнать демо headless N кадров, сверить финальные планы с v1 на той же записи. Задеплоить в vector06js (`cp /tmp/v2_demo_m2b.rom /Users/boris/projects/vector06js/kvv2_m2b.rom`).
Expected: планы == v1; ROM задеплоен (ссылка http://localhost:8000/?kvv2_m2b.rom).

- [ ] **Step 3: README + journal + i8080-гейт всего M2b**

Дописать v2/README.md раздел M2b (нативная физика героя == v1 по локстепу на ходьбе/падении/лестнице/прыжке/копании; two-pass анимация == v1; демо с движущимся героем), честные оговорки покрытия (какие вводы упражнены). check_i8080.js OK на hero+driver харнессах. Дописать docs/JOURNAL.md «## M2b ГОТОВ».

- [ ] **Step 4: Commit майлстоуна M2b**

```bash
git add tools/verify/gen_demo_m2b.js v2/demo_m2b.asm v2/README.md docs/JOURNAL.md
git commit -m "test(v2/m2b): moving-hero demo + M2b done — native physics + two-pass vs v1

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review (при написании)

- **Покрытие спеки:** input_read (Task 2), hero физика по под-механикам (Task 3-5: гравитация/ходьба/лестница/прыжок/копание), two-pass спрайты (Task 6), демо+финал (Task 7); разведка+локстеп-харнесс де-рискуют (Task 1). AI мумий/ножи/двери — вне объёма (спека). ✓
- **Плейсхолдеры:** физика ссылается на секцию героя v1 tickGame + КАРТУ из отчёта Task 1 (адреса вскрываются разведкой, не «TODO») — это осознанная зависимость: Task 1 производит адресную карту, Task 3-5 её потребляют (как M2a Task 2-3 потребляли v1-рутины). Контроллер уточнит Task 3-5 по отчёту Task 1 перед их диспатчем. ✓
- **Согласованность:** адреса prota (0x6C34/37/38/39/3A/3F) и символы сцены едины во всех задачах; локстеп-харнесс (Task 1) — общий инструмент Task 3-5; set_tile/scn_fullrender-контракт из M2a соблюдён в Task 5. ✓
