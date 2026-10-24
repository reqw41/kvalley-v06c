# King's Valley — полноценная нативная рекомпиляция Z80→i8080 (ревизия плана v3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans или subagent-driven-development.
> Шаги помечены `- [ ]`. Эта ревизия ОТМЕНЯЕТ trap-рантайм (v2) и возвращается к полноценной
> нативной рекомпиляции — но с дисциплиной проверки из проверенного метода Городецкого/Тимошенко
> (`vector06c.zx-pk.ru`, см. `vector06-recomp-ref/docs/zxpk_recompile_overview.txt`).

**Goal:** Получить чистый i8080-ROM King's Valley, играбельный на ванильном Векторе-06Ц
(vector06js), переведя ТОЛЬКО CPU Z80→i8080; графика/звук/ввод остаются векторными (порт
Городецкого их уже сделал).

**Architecture:** Полноценная символическая рекомпиляция. Каждый адрес → метка `L<orig>`,
таблицы адресов → `DW L<orig>`, данные → `DB`. Z80-only опкоды разворачиваются в i8080-макросы
inline (БЕЗ RST-ловушек — нет trap-состояния → нет interrupt-стены v2). Релокацию делает
ассемблер. Корректность доказывается ТЕСТОМ РЕЛОКАЦИИ (метод zx-pk): дизасм, реассембл, сдвиг
старта — если работает на другом диапазоне адресов, значит ВСЕ ссылки символические и перевод
адресо-корректен. Это ровно та дисциплина, которую trap-подход обходил (сохранял адреса, чтобы
НЕ релоцировать) ценой interrupt-небезопасности.

**Tech Stack:** Python 3 (`tools/recompiler/`: disasm, codemap, emit), `zasm` (Z80-режим для
faithful-реассембла; `--8080` для финальной сборки), Node + `tools/vendor/Z80.js` +
`tools/machine.js` (Tier-1 Z80-гейт: i8080-выход исполняется на Z80, т.к. i8080⊂Z80),
`tools/diff_frames.py` (покадровый дифф), реальный vector06js через puppeteer (Tier-2 live-гейт),
`AYVI53/source/VI53.asm` (звук AY→ВИ53 для ванильного Вектора, при необходимости).

## Global Constraints

- Целевой CPU финала: **Intel 8080 / КР580ВМ80А** — ни одной Z80-инструкции в релизном `.rom`.
- Вход рекомпиляции: **`roms/kvalley_postinit64k.bin`** (post-init, регион игры 0x4000+ ПОСТРОЕН
  и стабилен, SMC=0) + трасса **`extracted/trace_full.json`**. ВАЖНО: unpacked64k — пре-init
  снимок со СТАРЫМИ байтами депакера в 0x4000+ → дизасм там misalign'ится (доказано: 30 zasm-
  ошибок на unpacked vs 0 на postinit). Неизменяемые артефакты.
- Golden-эталон: **`extracted/golden_menu/`** (кадры оригинала Z80 на Z80.js+machine.js).
- Переводчик Z80-only опкодов: **переиспользовать `monty-recomp/tools/recompiler/inline.py`**
  (доказанный корректный макро-развёртыватель; это и есть «замена команд на i8080-макросы» из
  метода zx-pk). НЕ тащить из monty 2-сегментный rebase/VDP-шим — у нас аппаратура векторная.
- Сборка faithful-реассембла: `zasm` в Z80-режиме. Финал: `zasm --8080`.
- Прерывание Вектора: vblank → RST7 (вектор `0x38`), ~50 Гц. ISR оригинала register-transparent.
- НЕ возвращаться к RST-ловушкам. НЕ «ускорять» реентерабельный трап. (Стена v2, см. JOURNAL.)

---

## Карта файлов

**Существующее (переиспользуем как есть):**
- `tools/recompiler/disasm.py` — Z80-декодер (добавить поле `prefix`, 3 строки — см. Task R1).
- `tools/recompiler/codemap.py` — карта код/данные + метки + таблицы адресов (есть).
- `tools/machine.js`, `tools/runrom.js`, `tools/diff_frames.py` — Tier-1 гейт (есть).
- `monty-recomp/tools/recompiler/inline.py` — переводчик Z80-only→i8080-макросы (копируем в проект,
  ретаргетим SCRATCH_BASE на свободное окно RAM Вектора).

**Создать/переписать:**
- `tools/recompiler/emit_faithful.py` — НОВЫЙ: эмит образа как ПОБАЙТНО-ВЕРНОГО Z80-asm (метки +
  оригинальные Z80-мнемоники + `DW L` + `DB`), для теста релокации. Цель: реассембл байт-в-байт.
- `tools/recompiler/emit.py` — переписать: вместо trap-`translate_insn` использовать
  `inline.translate_inline`; добавить РЕЛЯБЕЛИНГ адресных операндов данных (см. Task R4).
- `tools/recompiler/relabel.py` — НОВЫЙ: единая логика «адрес-иммедиат/операнд → метка, если
  цель в образе» (для `LD A,(nn)`, `LD HL,nn` где nn — внутренний адрес, `DW`-таблицы).
- `tools/build_native.py` — НОВЫЙ оркестратор: образ+карта → asm → zasm → `.rom`.
- `Makefile` — цели `reasm` (faithful Z80, байт-сверка), `reloc` (сдвиг+дифф), `native` (i8080).

**Удалить из активного пути (оставить в истории git):** `src/z80trap.asm`, `src/z80table.inc`,
`src/z80state.inc`, `tools/recompiler/patch.py`, `tools/build_rom.py` — trap-рантайм v2.

---

## Фаза R — Релокационная корректность (гейт метода zx-pk)

Цель фазы: доказать, что дизасм ПОЛНЫЙ и ВСЕ ссылки символические, через faithful-реассембл и
тест сдвига. Это вскрывает каждый адрес-иммедиат/неразмеченный data-реф ДО перевода в i8080.

### Task R1: disasm.prefix + faithful-эмиттер (Z80 байт-в-байт)

**Files:**
- Modify: `tools/recompiler/disasm.py` (добавить поле `prefix`)
- Create: `tools/recompiler/emit_faithful.py`
- Test: `tests/test_emit_faithful.py`

**Interfaces:**
- Produces: `emit_faithful(image: bytes, codemap) -> str` — Z80-asm: для код-байт оригинальная
  Z80-мнемоника (через disasm.mnem, но в Z80-синтаксисе zasm), метки `L<addr>:` перед целями,
  `DW L<addr>` для addr_tables, `DB` для прочего.
- Consumes: `codemap.build_map` (есть), `disasm.decode` (есть).

- [ ] **Step 1: prefix в Insn.** В `disasm.py` добавить `prefix: int | None = None` в dataclass и
  выставлять его в DD/FD-пути (скопировать 3 строки из `monty-recomp/tools/recompiler/disasm.py`,
  diff показал — это единственное отличие).

- [ ] **Step 2: Падающий тест faithful-реассембла (синтетика).**
```python
# tests/test_emit_faithful.py
from tools.recompiler.codemap import build_map
from tools.recompiler.emit_faithful import emit_faithful
def test_roundtrip_small():
    # NOP; JR -2 (self); RET  + 1 байт данных
    img = bytes([0x00, 0x18, 0xFE, 0xC9, 0x42])
    tr = {"execPC":[0,1,3],"jpHLTargets":[],"smc":[],"imMode":1,"isrAddr":None,"flagDepSites":[]}
    cm = build_map(img, tr)
    asm = emit_faithful(img, cm)
    assert "L0001:" in asm           # цель JR
    assert "jr" in asm.lower()       # faithful: JR остаётся JR (Z80-режим)
    assert "db 42h" in asm.lower()   # данные
```

- [ ] **Step 3: Запустить — падает.** Run: `python3 -m pytest tests/test_emit_faithful.py -v` → FAIL.

- [ ] **Step 4: Реализовать `emit_faithful.py`.** Структура как `emit.py`, но КОД-байты эмитятся
  faithful: JR/DJNZ/CB/ED/IX-IY/EXX/EXAF — в исходных Z80-мнемониках Z80-синтаксиса zasm (jr/djnz/
  bit/ld (ix+d)/exx/ex af,af'); цели переходов — через метку `L<target>`; i8080-подмножество — тоже
  Z80-синтаксис zasm. Без перевода. (disasm уже даёт mnem; нужен маппер «disasm-мнемоника → точная
  Z80-строка для zasm». Для faithful цель — байт-идентичность после zasm.)

- [ ] **Step 5: Зелёный.** Run: `python3 -m pytest tests/test_emit_faithful.py -v` → PASS.

- [ ] **Step 6: Коммит.**
```bash
git add tools/recompiler/disasm.py tools/recompiler/emit_faithful.py tests/test_emit_faithful.py
git commit -m "feat(recomp): faithful Z80 re-emitter + disasm.prefix (relocation-test groundwork)"
```

### Task R2: Реассембл на месте — байт-в-байт с оригиналом

**Files:** Create `tools/build_native.py` (режим `--faithful`); Modify `Makefile` (цель `reasm`).

**Interfaces:**
- Produces: `make reasm` → собирает `build/kv_faithful.bin` из `emit_faithful` через `zasm` (Z80,
  ORG 0x100), затем сверяет с областью кода `kvalley_unpacked64k.bin` побайтно.
- Критерий: байты КОД-области идентичны (данные — тривиально; цель — доказать, что дизасм+эмит
  кодируют те же опкоды). Расхождение = баг дизасма/эмита (длина/мнемоника) → чинить.

- [ ] **Step 1:** `tools/build_native.py --faithful` пишет `build/kv_faithful.asm`, зовёт
  `zasm <asm> -o build/kv_faithful.bin` (Z80-режим, БЕЗ `--8080`).
- [ ] **Step 2:** Сверка `build/kv_faithful.bin` vs `roms/kvalley_unpacked64k.bin` по множеству
  код-адресов (`codemap._code`). Печать первого расхождения `(addr, want, got)`.
- [ ] **Step 3:** Прогнать; чинить расхождения дизасма/эмита до 0. (Ожидаемые грабли: hex-литералы
  zasm требуют ведущий 0; STA/LDA/SHLD/LHLD длины; DDCB-формы — см. JOURNAL T13v2.)
- [ ] **Step 4: Коммит.** `git commit -m "feat(recomp): in-place faithful reassembly byte-identical to original"`

### Task R3: Тест релокацией — сдвиг старта, прогон на Z80.js

**Files:** Modify `tools/build_native.py` (флаг `--org`); `Makefile` (цель `reloc`).

**Interfaces:**
- Produces: `make reloc` → собирает faithful-asm со СДВИНУТЫМ ORG, грузит в `machine.js`
  (Z80.js-ядро), снимает кадры, `diff_frames.py` vs `golden_menu`.
- Критерий: VRAM совпадает с golden → ВСЕ ссылки символические (нет хардкод-адресов). Расхождение
  локализует НЕразмеченный адрес-иммедиат/data-реф → добавить в relabel (Task R4) и повторить.

- [ ] **Step 1:** Эмит faithful-asm c ORG, сдвинутым относительно 0x100 (напр. весь образ как
  релоцируемая программа; данные/код — символические). Решить точку загрузки в `machine.js`.
- [ ] **Step 2:** Прогон сдвинутого образа на Z80.js+machine.js, дифф vs golden_menu.
- [ ] **Step 3:** ИТЕРАТИВНО: каждое расхождение → найти инструкцию-источник по адресу → это
  обычно `LD HL,nn`/`LD A,(nn)`/`DW` с внутренним адресом, не ставшим меткой → внести правило в
  `relabel.py` (Task R4) → пересобрать → повторять до дифф==0.
- [ ] **Step 4: Коммит.** `git commit -m "feat(recomp): relocation test passes (all refs symbolic, shifted ORG runs)"`

### Task R4: relabel.py — релябелинг адресных операндов

**Files:** Create `tools/recompiler/relabel.py`; Test `tests/test_relabel.py`.

**Interfaces:**
- Produces: `relabel_operand(insn, ctx) -> str|None` — если операнд инструкции (immediate `LD rp,nn`,
  абсолютный data-реф `LD A,(nn)`/`LD (nn),A`/`LHLD`/`SHLD`, элемент `DW`-таблицы) указывает ВНУТРЬ
  образа на известную метку/data-метку — вернуть имя метки `L<nn>`, иначе None (оставить число).
- Эвристика: nn в `codemap.labels` → код-метка; nn в диапазоне образа и читается/пишется как данные →
  data-метка (эмиттер ставит `L<nn>:` перед этим data-байтом). Видеопамять 0x8000+, порты — НЕ метки.

- [ ] **Step 1:** Падающий тест: `LD HL,4567h` где 4567h — метка → `ld hl,L4567`; `LD HL,1234h`
  где 1234h не в образе-коде-данных → остаётся числом.
- [ ] **Step 2..4:** Реализация + интеграция в `emit_faithful` и `emit`; гейт = Task R3 дифф==0.
- [ ] **Step 5: Коммит.** `git commit -m "feat(recomp): symbolic relabeling of address operands & data refs"`

**ВЕХА Фазы R:** faithful-реассембл байт-в-байт + тест релокации зелёный = дизасм полон, все ссылки
символические, рекомпиляция будет адресо-корректной. (Это фундамент, которого не было у trap-v2.)

---

## Фаза T — Перевод в i8080 (нативные макросы)

### Task T1: inline-переводчик в проект + scratch-окно Вектора

**Files:** Copy `monty-recomp/tools/recompiler/inline.py` → `tools/recompiler/inline.py`;
Modify SCRATCH_BASE; Test `tests/test_inline_smoke.py`.

- [ ] **Step 1:** Скопировать `inline.py`. Найти свободное non-video окно RAM Вектора под 18 байт
  scratch (z80_ix/iy/af_alt/bc_alt/de_alt/hl_alt/il_tmp/il_tmp2/il_a). Кандидат — дыра вне образа-
  данных (проверить картой; НЕ 0x8000+ видео, НЕ стек). Прописать в `SCRATCH_EQUS`.
- [ ] **Step 2:** Smoke-тест: `translate_inline(decode(bytes([0xD9]),0), ctx)` → swap-последовательность;
  `decode(bytes([0x18,0xFE]),0x100)` → `["jp L0100"]`.
- [ ] **Step 3:** Зелёный. **Step 4:** Коммит.

### Task T2: emit.py на inline + сборка i8080 + golden-дифф

**Files:** Modify `tools/recompiler/emit.py` (translate_inline вместо translate_insn, + relabel);
`tools/build_native.py` (режим `--8080`); `Makefile` (цель `native`, `verify`).

- [ ] **Step 1:** `emit.py` зовёт `inline.translate_inline` + `relabel`. SCRATCH_EQUS вверху.
- [ ] **Step 2:** `make native` → `zasm --8080 build/kv_native.asm -o roms/kvalley_v06c.rom`.
  zasm отвергнутые мнемоники = недопереведённые шейпы → чинить inline-покрытие.
- [ ] **Step 3:** `make verify` → прогон `kvalley_v06c.rom` (чистый i8080) на Z80.js+machine.js
  (i8080⊂Z80 → исполняется), дифф vs golden_menu. Критерий: VRAM совпадает.
- [ ] **Step 4:** ИТЕРАТИВНО чинить расхождения (флаги CB/ED/IX-IY, см. граблиные комментарии в
  inline.py: RES/SET push-psw, BIT ani, SRA add+rra, IX preserve-A). Reg/flag лок-степ по маске
  {S,Z,CY,P,AC}; N/PV не сверять (доказать, что код не опирается — DAA после SUB, JP PE/PO).
- [ ] **Step 5: Коммит вехи.** `git commit -m "milestone(phaseT): native i8080 recompile passes Tier-1 golden diff (menu)"`

### Task T3: Полное покрытие по уровням (итеративно)

Скрипты ввода `tools/inputs/level*.json` → трасса → codemap полнее → emit → `make verify` по
сценариям (лестницы/меч/кирка/враги/смерть/пауза). Каждый сценарий: golden(Z80) vs target(i8080)
на machine.js, дифф==0. Коммит на уровень. Расширять inline/relabel по мере вскрытия новых шейпов.

---

## Фаза V — Ванильный Вектор (vector06js) + звук

### Task V1: Live-гейт на реальном vector06js

- [ ] Загрузить `roms/kvalley_v06c.rom` в РЕАЛЬНЫЙ vector06js (puppeteer, штатный oneFrame/RAF —
  НЕ node-харнесс, журнал предупреждал). Чистый титул? Вход SPACE/курсор (порт2 ВВ55, строка 7,
  маппинг разобран в JOURNAL)? Играбельный 1-й уровень без мусора/зависаний?
- [ ] Расхождения здесь = i8080-специфика (тайминг прерываний на нативной границе) ИЛИ остаточные
  флаговые баги, не видимые на Z80.js (он Z80). Тайминг теперь НЕ упирается в trap-оверхед (нативный
  код ~как Z80 по числу инструкций) → ожидаем, что отрисовка укладывается в кадр (стена v2 снята).

### Task V2: Звук AY→ВИ53 (если требуется на ванильном)

- [ ] Порт Городецкого выводит звук через AY/Sound Tracker. На ванильном Векторе без AY-платы —
  подключить `AYVI53/source/VI53.asm` (диспетчер WRTPSG, AY8910→ВИ53+beeper). Гейт — на слух +
  лог OUT-портов. (Низкий приоритет: сначала графика/геймплей.)

### Task V3: Релиз

- [ ] README + журнал + CONTEXT, происхождение (Иван Городецкий), тег. Финальный `.rom`.

---

## Self-Review

- **Покрытие метода zx-pk:** дизасм→реассембл байт-в-байт (R2) ✓; тест релокации сдвигом (R3) ✓;
  перевод в i8080-макросы (T2, inline.py = «замена на макросы») ✓; запуск i8080 в эмуляторе
  исходного CPU (T2/T3 на Z80.js, i8080⊂Z80) ✓; адаптация звука AY→ВИ53 (V2) ✓.
- **Снятие стены v2:** нет trap-состояния → нет interrupt-небезопасности; нативный код ~= Z80 по
  плотности → нет перф-стены отрисовки. Релокация решена ДИСЦИПЛИНОЙ (тест сдвига), а не обходом.
- **Риск (главный):** адрес-иммедиаты в init/SMC-векторах (0x00/0x08/0x38 строятся кодом). Тест
  релокации (R3) их вскрывает поштучно — это его прямое назначение.
- **Типы согласованы:** `emit_faithful`/`emit_program`/`translate_inline`/`relabel_operand`/
  `build_map`/`decode`/`first_divergence`.
