# King's Valley engine v2 — M2c: нативное AI мумий (план)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Нативный i8080 AI мумий (`v2/momias.asm`, порт AI_Momias), локстеп-доказанный против v1 потиково; мумии ходят/думают/решают/преследуют/прыгают/лезут/падают. Переиспользует M2b-примитивы. Итог — демо с живыми мумиями.

**Architecture:** Слои движка v2. M2c = `v2/momias.asm` (Слой 1, ядро), переиспользует параметризованные примитивы из `v2/hero.asm` (M2b) с actor-указателем на мумию. Кормится состоянием живого v1 (паттерн M1/M2a/M2b). Спека: docs/superpowers/specs/2026-07-05-kvalley-engine-v2-m2c-mummy-ai.md.

**Tech Stack:** i8080 asm (tools/bin/sjasm 0.39, Z80-мнемоники→8080), headless vector06js (node+vm), tools/verify/. check_i8080.js — гейт чистоты.

## Global Constraints

- Цель — ванильный i8080/Вектор: ТОЛЬКО i8080-опкоды (check_i8080.js OK; запрещены Z80-only 08/10/18/20/28/30/38, CB/D9/DD/ED/FD). Весь код в Z80-мнемоническом подмножестве (конвенция scene.inc).
- v1 = золотой эталон; каждый паритет доказывается headless-локстепом, не утверждением.
- Адреса v1 (Вектор-таргет, /tmp/kvv.sym): AI_Momias=0x3DEA, momiaAnda=0x3E92, tryToJump=0x41C2, momiaSaltando=0x41F3, momiaPiensa=0x44E3, momiaDecide=0x4773, getMomiaDat=0x4A25, initMomia=0x3B40, numMomias=0x6C64, momiaEnProceso=0x6C65, momiaData (структуры мумий, ACTOR-формат 22Б; адрес/смещения вскрыть разведкой). ACTOR-смещения — в msx/kvalley_src.asm:45-64.
- M2b-примитивы (v2/hero.asm, параметризованы, actor-ptr): mueveElemento/cayendo/chkPisaSuelo/chkTocaMuro/andaEscalera/doSalto/chkChocaSalto/getMapOffset — точки входа вскрыть чтением hero.asm + m2b-task-*-report.md.
- КОНТРАКТ (ревью M2b): scratch-globals примитивов (hero_mv_ptr/hero_actor_ptr/hero_xmod) ОДНОЭКЗЕМПЛЯРНЫ → вызовы строго последовательны, AI_Momias и hero_tick НЕ чередовать.
- Разделяемые scratch мумий (momiaEnProceso 0x6C65, modoSentEsc) писать как v1 (закрывает M2b-гэп).
- Дев-скрипты в tools/verify/, не /tmp. Сборка v1: `python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/kvv.asm --target vector && tools/bin/sjasm -s /tmp/kvv.asm /tmp/kvv.rom /tmp/kvv.sym`.

## Файловая структура

- `v2/momias.asm` — нативный AI мумий: `ai_momias` (цикл+диспетчер), `momia_anda`/`momia_saltando`/`momia_piensa`/`momia_decide`/`try_to_jump`/`get_momia_dat`. Переиспользует M2b-примитивы.
- `tools/verify/momias_lockstep.js` — адаптация hero_lockstep.js: снимает momiaData+MapaRAM+hero-pos из v1 ДО/ПОСЛЕ тика, гоняет v2 ai_momias, сверяет momiaData.
- `v2/momias_harness.asm` — харнесс: momiaData+MapaRAM+hero-pos в RAM, зовёт ai_momias, hlt; линкует momias.asm + hero.asm (примитивы) + driver (при нужде).

---

### Task 1: Разведка AI_Momias + momias-локстеп-харнесс (де-риск, БЕЗ порта)

**Files:** Create `tools/verify/momias_recon.js`, `tools/verify/momias_lockstep.js`; report `.superpowers/sdd/m2c-task-1-report.md`

**Interfaces:** Produces — карта: (1) диспетчер AI_Momias (jumpIndex-таблица по ACTOR_STATUS, порядок под-состояний), (2) логика momiaPiensa/momiaDecide (как позиция героя → направление; vecesDudaMomia по типу), (3) полный формат momiaData (ACTOR 22Б: адрес, поля, что AI меняет), (4) рабочий momias-локстеп v1↔v1 (санити).

- [ ] **Step 1: Картировать AI_Momias + под-состояния**

Прочесть `AI_Momias` (0x3DEA), `getMomiaProcDat`/`getMomiaDat`, диспетчер jumpIndex (таблица `dw momiaAnda/momiaSaltando/...`) в msx/kvalley_src.asm. Выделить статусы мумий и их рутины, порядок. Инструментировать headless (как profile_v1.js): за геймплейный тик залогировать, какие байты momiaData-структур пишутся и в каком порядке.

- [ ] **Step 2: Вскрыть AI-мозг (momiaPiensa/momiaDecide)**

Прочесть `momiaPiensa` (0x44E3) и `momiaDecide` (0x4773): как таймер раздумья (тип мумии → vecesDudaMomia), как позиция героя (ProtaX/Y) сравнивается для выбора направления/лестницы/прыжка. Задокументировать алгоритм решения.

- [ ] **Step 3: Полный формат momiaData + какие M2b-примитивы зовёт**

Найти адрес momiaData и ACTOR-смещения (Status/Sentido/Timer/Tipo/координаты/фаза прыжка/указатель-дуги). Сопоставить, какие M2b-примитивы (hero.asm точки входа) реально общие с мумиями (по исходнику AI_Momias) и как передаётся actor-ptr.

- [ ] **Step 4: momias-локстеп v1↔v1 (санити)**

`tools/verify/momias_lockstep.js`: снять momiaData+MapaRAM+hero-pos из живого v1 ДО тика, прогнать v1 один тик, снять ПОСЛЕ. САНИТИ: повторный прогон = тот же результат (детерминизм). Печать momiaData до/после.
Run: `cd /Users/boris/Projects/kvalley-v06c && python3 tools/kv_z80_to_8080.py msx/kvalley_src.asm /tmp/kvv.asm --target vector && tools/bin/sjasm -s /tmp/kvv.asm /tmp/kvv.rom /tmp/kvv.sym && node tools/verify/momias_lockstep.js`
Expected: v1↔v1 детерминизм; печать momiaData осмысленна (numMomias≥1).

- [ ] **Step 5: Commit**

```bash
cd /Users/boris/Projects/kvalley-v06c
git add tools/verify/momias_recon.js tools/verify/momias_lockstep.js
git commit -m "feat(v2/m2c): mummy-AI recon + v1<->v1 lockstep harness (de-risk, no port)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: ai_momias диспетчер + momia_anda (ходьба/падение через M2b-примитивы) — локстеп

**Files:** Create `v2/momias.asm`, `v2/momias_harness.asm`; Modify `tools/verify/momias_lockstep.js`

**Interfaces:** Produces — `ai_momias`: цикл по numMomias, диспетчер по ACTOR_STATUS, для статуса Anda — `momia_anda` (ходьба+простой→Pensando, падение), через M2b-примитивы. По карте Task 1.

- [ ] **Step 1: Записанный ввод/сцена «мумия ходит/падает» + локстеп-тест — FAIL**

Добавить в momias_lockstep.js прогон v2 ai_momias (харнесс) с тем же стартом, что v1; сверять momiaData ПОСЛЕ. Сцена/окно, где мумия ходит и падает. Заглушка `ai_momias: ret` → FAIL.

- [ ] **Step 2: Реализовать ai_momias + momia_anda**

Портировать диспетчер AI_Momias (jumpIndex по статусу, цикл numMomias, momiaEnProceso) + momia_anda (ходьба, простой→Pensando-статус, падение) из v1, вызывая M2b-примитивы (mueveElemento/chkTocaMuro/chkCae/cayendo) с mummy actor-ptr. ТОЛЬКО i8080-опкоды.

- [ ] **Step 3: Прогнать — PASS (потиково) + i8080**

Run: `cd /Users/boris/Projects/kvalley-v06c && node tools/verify/momias_lockstep.js anda` → momiaData v2 == v1 на каждом тике. i8080-гейт: `tools/bin/sjasm v2/momias_harness.asm /tmp/momias_harness.rom /tmp/momias.lst && node tools/verify/check_i8080.js /tmp/momias.lst` → OK.

- [ ] **Step 4: Commit**

```bash
git add v2/momias.asm v2/momias_harness.asm tools/verify/momias_lockstep.js
git commit -m "feat(v2/m2c): ai_momias dispatcher + momia_anda (walk/fall) == v1 lockstep, i8080-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: momia_piensa/momia_decide (AI-мозг: решение/преследование) — локстеп

**Files:** Modify `v2/momias.asm`, `tools/verify/momias_lockstep.js`

**Interfaces:** Produces — `momia_piensa` (таймер раздумья по типу) + `momia_decide` (позиция героя → направление/лестница/прыжок). По карте Task 1 (Step 2).

- [ ] **Step 1: Сценарий «мумия думает/решает/преследует» + тест — FAIL**

Окно, где мумия входит в Pensando и решает направление (относительно героя). Пока не реализовано → FAIL на статусе Pensando.

- [ ] **Step 2: Реализовать momia_piensa + momia_decide**

Портировать AI-решение из v1 (отчёт Task 1 Step 2): таймер раздумья (тип→vecesDudaMomia), сравнение ProtaX/Y с позицией мумии → выбор направления/действия. ТОЛЬКО i8080-опкоды.

- [ ] **Step 3: Прогнать — PASS (решение==v1) + i8080; регресс anda**

Run: `node tools/verify/momias_lockstep.js piensa` → momiaData v2 == v1 (включая выбранное направление); `anda` всё ещё PASS.

- [ ] **Step 4: Commit**

```bash
git add v2/momias.asm tools/verify/momias_lockstep.js
git commit -m "feat(v2/m2c): momia_piensa/momia_decide (AI decision/chase) == v1 lockstep, i8080-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: momia_saltando/try_to_jump + лестницы — локстеп

**Files:** Modify `v2/momias.asm`, `tools/verify/momias_lockstep.js`

**Interfaces:** Produces — `momia_saltando`/`try_to_jump` (прыжок через M2b doSalto/chkChocaSalto) + лазанье по лестницам (M2b andaEscalera с mummy-ptr).

- [ ] **Step 1: Сценарий «мумия прыгает/лезет» + тест — FAIL**

Окно, где мумия прыгает и/или лезет по лестнице. Пока не реализовано → FAIL на этих статусах.

- [ ] **Step 2: Реализовать прыжок + лестницы мумий**

Портировать momia_saltando/try_to_jump (M2b doSalto/chkChocaSalto + указатель-дуги как у героя) и лестницы (M2b andaEscalera, quienEscalera=индекс мумии) из v1. ТОЛЬКО i8080-опкоды.

- [ ] **Step 3: Прогнать — PASS (прыжок+лестница==v1) + i8080; регресс anda/piensa**

Run: `node tools/verify/momias_lockstep.js salta && node tools/verify/momias_lockstep.js escalera` → v2==v1; прежние сценарии PASS.

- [ ] **Step 4: Commit**

```bash
git add v2/momias.asm tools/verify/momias_lockstep.js
git commit -m "feat(v2/m2c): momia jump + ladders == v1 lockstep, i8080-clean

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Интеграция в демо (мумии двигаются) + фиксация M2c

**Files:** Modify `tools/verify/gen_demo_m2b.js` (или новый gen_demo_m2c.js), `v2/README.md`, `docs/JOURNAL.md`; Modify `tools/verify/momias_lockstep.js`

- [ ] **Step 1: Локстеп на всех под-механиках + hero-регресс**

Run: `cd /Users/boris/Projects/kvalley-v06c && for sc in anda piensa salta escalera; do echo "$sc:"; node tools/verify/momias_lockstep.js $sc; done` → все PASS. Регресс hero: `for sc in walk ladder jump dig; do node tools/verify/hero_lockstep.js $sc; done` → PASS (modoSentEsc-гэп теперь закрыт мумиями).

- [ ] **Step 2: Мумии в игровом цикле демо**

В демо-цикл добавить `call ai_momias` (ПЕРЕД hero_tick — порядок как v1 AI_Momias до AI_Prota; см. m2b-task-1-report карту tickGame2, п.8 AI_Prota после мумий). Мумии обновляют momiaData → build_sprites рисует их движущимися. i8080-гейт.
Run: собрать демо, headless-прогон N кадров, сверить momiaData (мумии двинулись) + hero управляем.
Expected: мумии двигаются; i8080 OK; задеплоить kvv2_m2c.rom (или обновить kvv2_m2b.rom).

- [ ] **Step 3: README + journal + i8080-гейт всего M2c**

Дописать v2/README.md раздел M2c (нативное AI мумий == v1 по локстепу anda/piensa/salta/escalera; мумии двигаются в демо; M2b-гэп modoSentEsc закрыт), честные оговорки (флик-полиш отложен; какие сценарии упражнены). check_i8080.js OK. Дописать docs/JOURNAL.md «## M2c ГОТОВ».

- [ ] **Step 4: Commit майлстоуна M2c**

```bash
git add v2/momias.asm tools/verify/gen_demo_m2b.js tools/verify/momias_lockstep.js v2/README.md docs/JOURNAL.md
git commit -m "test(v2/m2c): mummy AI validated vs v1; mummies move in demo; M2c done

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review (при написании)

- **Покрытие спеки:** ai_momias+momia_anda (Task 2), momia_piensa/decide AI-мозг (Task 3), прыжок+лестницы (Task 4), интеграция+финал (Task 5); разведка+локстеп де-рискуют (Task 1). Ножи/флик — вне объёма (спека). ✓
- **Плейсхолдеры:** AI-логика ссылается на конкретные рутины v1 (AI_Momias 0x3DEA/momiaDecide 0x4773/momiaPiensa 0x44E3) + КАРТУ отчёта Task 1 — не «TODO». Контроллер уточнит Task 2-4 по отчёту Task 1. ✓
- **Согласованность:** адреса мумий и M2b-примитивы едины во всех задачах; momias-локстеп-харнесс (Task 1) — общий инструмент Task 2-4; контракт последовательности примитивов (M2b-ревью) соблюдён; порядок ai_momias ПЕРЕД hero_tick (Task 5) — как v1. ✓
