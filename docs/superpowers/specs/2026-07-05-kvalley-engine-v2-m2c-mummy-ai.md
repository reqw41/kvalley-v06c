# King's Valley engine v2 — M2c: нативное AI мумий (дизайн)

**Дата:** 2026-07-05
**Статус:** утверждён к реализации
**Родитель:** docs/superpowers/specs/2026-07-03-kvalley-engine-v2-design.md
**Предшественники:** M1 (render) ✅, M2a (сборщик сцены) ✅, M2b (физика героя + примитивы) ✅.

## Цель

Нативный i8080-код AI мумий King's Valley (ходьба, «раздумье», решение направления/
преследование героя, прыжок, лестницы, падение), **локстеп-доказанный против v1**
потиково. Мумии **оживают** — двигаются и преследуют, бит-в-бит как оригинал. Демо:
герой + живые мумии.

## Обоснование

Профиль M2-kickoff: AI мумий (getMomiaDat и др.) — самая тяжёлая игровая логика.
M2b уже вынес **общие примитивы движения параметризованными** (mueveElemento/cayendo/
chkPisaSuelo/chkTocaMuro/andaEscalera/doSalto) — M2c их переиспользует, портируя
только специфику мумий (диспетчер + AI-решение). Это и закрывает M2b-гэп `modoSentEsc`
(разделяемый scratch, который пишет код мумий).

## Механика v1 (что воспроизводим)

- `AI_Momias` (0x3DEA): цикл по `numMomias` (0x6C64); `momiaEnProceso` (0x6C65) =
  индекс текущей; `getMomiaProcDat` → указатель на структуру мумии (22Б ACTOR-формат,
  ТОТ ЖЕ, что у героя в M2b-примитивах); диспетчер `jumpIndex` по `ACTOR_STATUS`.
- Под-состояния (по статусу): `momiaAnda` (0x3E92, ходьба; при простое → статус 7
  «Pensando»), `momiaSaltando` (0x41F3, прыжок; `tryToJump` 0x41C2), лестницы, падение.
- **AI-мозг:** `momiaPiensa` (0x44E3, «думает» — таймер раздумья по типу мумии
  `vecesDudaMomia`), `momiaDecide` (0x4773, решение направления — смотрит на позицию
  героя, выбирает куда идти/лезть/прыгать). Это НОВОЕ (не покрыто M2b).
- Мумии пишут разделяемые scratch (`momiaEnProceso`, `modoSentEsc`) — воспроизвести как v1.

## Архитектура M2c

Новый нативный модуль `v2/momias.asm` (Слой 1, ядро). Переиспользует M2b-примитивы
из `v2/hero.asm` (параметризованные точки входа `*2`/body с actor-указателем).

```
AI_Momias: цикл по numMomias
  для каждой: getMomiaDat -> actor-ptr; jumpIndex по ACTOR_STATUS:
    Anda   -> momiaAnda   (ходьба; простой -> Pensando) --uses--> M2b mueveElemento/chkTocaMuro/chkCae
    Salta  -> momiaSaltando (tryToJump)                 --uses--> M2b doSalto/chkChocaSalto
    Escaleras -> лестницы                                --uses--> M2b andaEscalera
    Cae    -> падение                                    --uses--> M2b cayendo
    Pensando -> momiaPiensa -> momiaDecide (AI: смотрит на героя, выбирает направление)  [НОВОЕ]
  обновляет momiaData (ACTOR-структуры) -> build_sprites (M2a) рисует движущихся мумий
```

### Компоненты и интерфейсы

- `ai_momias()` (momias.asm): цикл по мумиям, диспетчер по статусу, обновляет структуры.
  Гейт: momiaData v2 == v1 потиково (локстеп).
- `momia_anda`/`momia_saltando`/`momia_piensa`/`momia_decide`/`try_to_jump` — под-состояния,
  порт v1; движение через M2b-примитивы (mummy actor-ptr). `momia_decide` — AI-решение
  (позиция героя → направление). Все ТОЛЬКО i8080-опкоды.
- Разделяемые scratch (`momiaEnProceso`, `modoSentEsc`) — писать как v1 (закрывает M2b-гэп).
- Контракт (ревью M2b): вызовы примитивов строго последовательны (scratch-globals
  hero_mv_ptr/hero_actor_ptr одноэкземплярны) — AI_Momias и hero_tick НЕ чередовать.

## Пошаговая миграция (без регрессии, v1 = эталон)

- Разведка: картировать диспетчер AI_Momias + под-состояния + AI-логику momiaDecide +
  полный формат momiaData; momias-локстеп-харнесс (адаптация hero_lockstep.js).
- `ai_momias` + `momia_anda` (ходьба/падение через M2b-примитивы) → локстеп momiaData.
- `momia_piensa`/`momia_decide` (AI-решение/преследование) → локстеп.
- `momia_saltando`/`try_to_jump` + лестницы → локстеп.
- Интеграция в демо (мумии двигаются) + i8080-гейт.
- Регресс: hero-локстеп (walk/ladder/jump/dig) держится; M2b modoSentEsc-гэп закрыт.

## Вне объёма M2c (следующее)

- Ножи/ловушки/предметы/game-flow (M2d), спрайты двери.
- Флик-полиш рендера (отложен — техника svofski incursiondelrio).
- Нативная распаковка уровня (пока MapaRAM из v1).

## Тестирование

- Локстеп momiaData: v2 ai_momias == v1 (все ACTOR-поля мумий) потиково на сценариях,
  упражняющих ходьбу/раздумье/решение/прыжок/лестницу/падение мумий + преследование.
- Регресс hero-локстеп (M2b) + пиксель-компар (M1/M2a).
- i8080-чистота: check_i8080.js OK.
- Демо: браузерный ROM — мумии ходят/преследуют (headless прогон + сверка momiaData с v1).

## Открытые вопросы для плана

- Точный jumpIndex-диспетчер AI_Momias (таблица статусов) и порядок под-состояний.
- Логика momiaDecide (как позиция героя → направление; типы мумий vecesDudaMomia).
- Полный формат momiaData (ACTOR 22Б: какие поля меняет AI — Status/Sentido/Timer/
  координаты/фаза прыжка/указатель-дуги как у героя).
- Как momia использует M2b-примитивы (какие точки входа, actor-ptr соглашение).
