# King's Valley Z80→i8080 Recompilation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перекомпилировать распакованный Z80-образ King's Valley в чистый, читаемый
8080-исходник, собираемый `zasm --8080` в `.rom`, играбельный на vector06js; графика и звук
оригинальные.

**Architecture:** Символический рекомпилятор на Python превращает побайтовую карту код/данные
(построенную из динамической трассы на Z80.js + рекурсивного дизасма) в 8080-asm с метками;
ассемблер берёт на себя релокацию. Корректность гарантируется двухуровневой дифференциальной
верификацией: Tier-1 — быстрый прогон оригинала и перевода на общем JS-модели Вектора (ядро
Z80.js), покадровое сравнение экранной памяти; Tier-2 — авторитетный прогон собранного `.rom`
на настоящем vector06js (реальный i8080) через puppeteer.

**Tech Stack:** Node.js + `tools/vendor/Z80.js` (трасса/golden/Tier-1), Python 3 (рекомпилятор,
сравнение кадров, `emu8080.py`, `render_vram.py`), `zasm --8080` (сборка), MCP puppeteer
(Tier-2 vector06js), MCP msx-emu (вспом.).

## Global Constraints

- Целевой CPU: **Intel 8080 / КР580ВМ80А** — НИ ОДНОЙ Z80-инструкции в выходном `.rom`.
- Целевая платформа: **vector06js** (https://svofski.github.io/vector06js/), загрузка `.rom` с `0x100`.
- Графика и звук — **оригинальные данные байт-в-байт**; не конвертировать.
- Ассемблер: **`zasm --8080`** (режим строго 8080, диалект как в Monty/`src/main.asm`).
- Эталон входа: `roms/kvalley_unpacked64k.bin` (распакованный образ, вход игры `0x100`) —
  неизменяемый артефакт; оригинальный `roms/kvalley_z80.rom` тоже не трогать.
- Все адреса в выходном asm — **символические метки**; таблицы адресов — `DW label`.
- Критерий корректности задачи перевода: совпадение экранной памяти с golden на её сценарии.
- Прерывание Вектора-06Ц: vblank → **RST7 (вектор `0x38`)**, ~50 Гц.

---

## Карта файлов

**Инфраструктура верификации (Node.js):**
- `tools/machine.js` — модель Вектора-06Ц (RAM 64K, видеоплоскости, ВВ55-клавиатура из
  скрипта ввода, порты палитры/режима, таймерное прерывание RST7), CPU-ядро подключается извне.
- `tools/runrom.js` — прогон: `machine + ядро + rom + input-script` → дамп кадров экранной
  памяти + (для оригинала) лог событий трассы. Используется и для golden, и для Tier-1 target.
- `tools/inputs/*.json` — скрипты ввода по сценариям (menu, level1..N, death, pause).

**Сравнение/визуализация (Python):**
- `tools/diff_frames.py` — сравнение golden vs target кадров, первая точка расхождения.
- `tools/render_vram.py` — кадр → PNG (уже есть).

**Рекомпилятор (Python, пакет `tools/recompiler/`):**
- `disasm.py` — Z80-декодер: длина + мнемоника + операнды.
- `codemap.py` — слияние трассы + рекурсивного дизасма → классификация байт код/данные,
  множество меток, детект таблиц адресов и сайтов самомодификации.
- `translate.py` — правила перевода Z80-инструкция → 8080-asm (по группам опкодов).
- `emit.py` — генерация `src/kvalley.asm` (метки, `DB`/`DW`, таблицы как `DW label`).
- `recompile.py` — оркестратор: образ + карта → asm.

**Целевой исходник (8080):**
- `src/kvalley.asm` — генерируемый/правленый 8080-исходник.
- `src/z80ext.inc` — рантайм Z80-расширений: теневые регистры, EXX/EX AF′, IX/IY-хелперы,
  CB/ED-подпрограммы, флаговые хелперы.
- `Makefile` — `make rom` (zasm), `make verify` (дифф), `make golden`.

**Тесты:** `tests/` (pytest для рекомпилятора; node для машины/харнесса).

---

## Task 1: Модель Вектора-06Ц (JS) с подключаемым CPU-ядром

**Files:**
- Create: `tools/machine.js`
- Test: `tests/test_machine.js`

**Interfaces:**
- Produces: `class Machine(core)` где `core` = объект `{getState,setState,run_instruction,interrupt}`
  (совместим с `Z80.js`). Методы: `loadRom(buf, org=0x100)`, `setInput(scriptObj)`,
  `runFrame()` (исполнить ~один кадр 50 Гц инструкций, затем `core.interrupt(false,0xFF)`),
  `screenSnapshot()` → `Uint8Array` экранной памяти (4 плоскости Вектора),
  `portLog()` → массив `(port,value)` записей в палитру/режим/звук.
- Consumes: ничего (Task 1 — базовый).

**Замечание о памяти Вектора-06Ц:** экран — 4 плоскости по 0x4000 (32K видеоОЗУ). Точные
адреса плоскостей и порт управления подтвердить из `tools/render_vram.py` и Monty
`docs/reference/vector-memory-map.md` ПЕРЕД реализацией `screenSnapshot()`.

- [ ] **Step 1: Свериться с раскладкой видеопамяти**

Run: `sed -n '1,80p' tools/render_vram.py; sed -n '1,60p' /Users/boris/projects/Monty/docs/reference/vector-memory-map.md`
Зафиксировать: базовые адреса 4 плоскостей, порт(ы) палитры/режима. Записать в шапку `machine.js`.

- [ ] **Step 2: Написать падающий тест модели**

```js
// tests/test_machine.js
const assert = require('assert');
const Z80 = require('../tools/vendor/Z80.js');
const Machine = require('../tools/machine.js');
// мини-rom: LD A,0xAA; STA <plane0>; HLT  (адрес плоскости подставить из Step 1)
const PLANE0 = 0x????; // из Step 1
const rom = Buffer.from([0x3E,0xAA, 0x32, PLANE0&0xff,(PLANE0>>8)&0xff, 0x76]);
const m = new Machine(Z80({/* core ctor */}));
m.loadRom(rom, 0x100);
m.runFrame();
const scr = m.screenSnapshot();
assert.strictEqual(scr[0], 0xAA, 'байт записан в плоскость 0');
console.log('OK');
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `node tests/test_machine.js`
Expected: ошибка (модуль/метод не реализован).

- [ ] **Step 4: Реализовать `tools/machine.js`**

Минимальная модель: `mem=Uint8Array(0x10000)`, `io=Uint8Array(256)`; `core` создаётся снаружи и
получает колбэки `mem_read/mem_write/io_read/io_write`, замкнутые на эту модель; запись в порты
палитры/режима логируется. `runFrame()` крутит фиксированное число инструкций (старт: 60000),
затем `core.interrupt(false,0xFF)`. `screenSnapshot()` копирует видеоОЗУ. Клавиатура ВВ55
обслуживается в `io_read` по текущему кадру из `setInput`.

- [ ] **Step 5: Запустить тест — зелёный**

Run: `node tests/test_machine.js`
Expected: `OK`

- [ ] **Step 6: Коммит**

```bash
git add tools/machine.js tests/test_machine.js
git commit -m "feat(harness): Vector-06C machine model with pluggable CPU core"
```

---

## Task 2: Прогон-харнесс + формат скрипта ввода

**Files:**
- Create: `tools/runrom.js`, `tools/inputs/menu.json`
- Test: ручной прогон (артефакт-кадры)

**Interfaces:**
- Consumes: `Machine` (Task 1), `Z80.js`.
- Produces: CLI `node tools/runrom.js <rom> <input.json> <outdir> [--org 0x100] [--frames N]
  [--trace trace.json]`. Пишет `<outdir>/frameNNNN.bin` (экранные снимки) и при `--trace` —
  лог событий (см. Task 6). Формат `input.json`: `{ "frames": N, "keys": [ {"f":10,"down":"Right"},
  {"f":40,"up":"Right"}, ... ] }` (раскладка клавиш Вектора — взять из Monty/`probe_kbd*.js`).

- [ ] **Step 1: Скрипт ввода для меню/заставки**

Создать `tools/inputs/menu.json` с `{"frames":120,"keys":[]}` (заставка без ввода).

- [ ] **Step 2: Реализовать `tools/runrom.js`**

Грузит rom в `Machine`, применяет ввод, гоняет `frames` кадров, после каждого пишет
`screenSnapshot()` в `frameNNNN.bin`. Использует `Z80.js` как ядро.

- [ ] **Step 3: Снять golden-кадры оригинала**

Run: `node tools/runrom.js roms/kvalley_unpacked64k.bin tools/inputs/menu.json extracted/golden_menu --org 0x100`
Expected: появились `extracted/golden_menu/frame0000.bin..frame0119.bin`.

- [ ] **Step 4: Глазами проверить заставку**

Run: `python3 tools/render_vram.py extracted/golden_menu/frame0119.bin extracted/golden_menu.png && echo done`
Expected: PNG с экраном заставки/меню King's Valley (визуальная проверка корректности golden).

- [ ] **Step 5: Коммит**

```bash
git add tools/runrom.js tools/inputs/menu.json extracted/golden_menu.png
git commit -m "feat(harness): rom runner + input-script format; golden menu frames"
```

---

## Task 3: Инструмент сравнения кадров

**Files:**
- Create: `tools/diff_frames.py`
- Test: `tests/test_diff_frames.py`

**Interfaces:**
- Produces: CLI `python3 tools/diff_frames.py <golden_dir> <target_dir>` → код возврата 0 при
  полном совпадении; иначе печатает первую точку расхождения `(frame, offset, golden, target)` и
  возвращает 1. Функция `first_divergence(golden_dir, target_dir) -> None | (frame, off, g, t)`.

- [ ] **Step 1: Падающий тест**

```python
# tests/test_diff_frames.py
import os, tempfile
from tools.diff_frames import first_divergence
def test_identical_and_divergent():
    d1, d2 = tempfile.mkdtemp(), tempfile.mkdtemp()
    open(f"{d1}/frame0000.bin","wb").write(b"\x01\x02\x03")
    open(f"{d2}/frame0000.bin","wb").write(b"\x01\x02\x03")
    assert first_divergence(d1, d2) is None
    open(f"{d2}/frame0000.bin","wb").write(b"\x01\xFF\x03")
    assert first_divergence(d1, d2) == (0, 1, 0x02, 0xFF)
```

- [ ] **Step 2: Запустить — падает**

Run: `python3 -m pytest tests/test_diff_frames.py -v`
Expected: FAIL (нет модуля).

- [ ] **Step 3: Реализовать `tools/diff_frames.py`**

Сортирует `frame*.bin` в обоих каталогах, сравнивает побайтово, возвращает первый расходящийся
`(frame_index, offset, g_byte, t_byte)` или `None`.

- [ ] **Step 4: Зелёный**

Run: `python3 -m pytest tests/test_diff_frames.py -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add tools/diff_frames.py tests/test_diff_frames.py
git commit -m "feat(verify): frame-diff tool (first divergence point)"
```

---

## Task 4: Z80-дизассемблер (длина + мнемоника)

**Files:**
- Create: `tools/recompiler/__init__.py`, `tools/recompiler/disasm.py`
- Test: `tests/test_disasm.py`

**Interfaces:**
- Produces: `decode(mem: bytes, addr: int) -> Insn` где `Insn` = `@dataclass(length:int,
  mnem:str, group:str, targets:list[int], reads:list, writes:list)`. `group ∈ {'i8080','jr',
  'djnz','cb','ed','ixiy','exx','exaf'}`. Для переходов с известной целью — `targets`.

- [ ] **Step 1: Падающий тест на репрезентативные опкоды**

```python
# tests/test_disasm.py
from tools.recompiler.disasm import decode
def test_lengths_and_groups():
    assert decode(bytes([0x00]),0).length==1                      # NOP
    assert decode(bytes([0x21,0x34,0x12]),0).mnem=="LXI H,1234h"  # LD HL,nn
    j=decode(bytes([0x18,0xFE]),0x100); assert j.group=="jr" and j.targets==[0x100]  # JR -2
    d=decode(bytes([0x10,0x05]),0x100); assert d.group=="djnz" and d.targets==[0x107]
    assert decode(bytes([0xCB,0x11]),0).group=="cb" and decode(bytes([0xCB,0x11]),0).length==2
    assert decode(bytes([0xED,0xB0]),0).group=="ed"   # LDIR
    assert decode(bytes([0xDD,0x7E,0x05]),0).group=="ixiy"  # LD A,(IX+5)
    assert decode(bytes([0xD9]),0).group=="exx"
    assert decode(bytes([0x08]),0).group=="exaf"
```

- [ ] **Step 2: Запустить — падает**

Run: `python3 -m pytest tests/test_disasm.py -v`
Expected: FAIL.

- [ ] **Step 3: Реализовать `disasm.py`**

Полная таблица длин Z80 (база + префиксы CB/ED/DD/FD, DDCB/FDCB с disp). Для переходов
(JR/JRcc/DJNZ/JP/CALL/RST) заполнять `targets` где цель статически известна; для `JP (HL)/(IX)`
помечать `group` и оставлять `targets=[]` (резолв из трассы, Task 6).

- [ ] **Step 4: Зелёный**

Run: `python3 -m pytest tests/test_disasm.py -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add tools/recompiler/__init__.py tools/recompiler/disasm.py tests/test_disasm.py
git commit -m "feat(recompiler): Z80 disassembler (length + group + static targets)"
```

---

## Task 5: Захват событий трассы + карта код/данные

**Files:**
- Modify: `tools/runrom.js` (добавить `--trace` лог)
- Create: `tools/recompiler/codemap.py`
- Test: `tests/test_codemap.py`

**Interfaces:**
- Produces (runrom `--trace`): JSON `{ "execPC":[...], "jpHLTargets":[...], "smc":[addr...],
  "imMode":1, "isrAddr":0x38, "flagDepSites":[addr...] }`. `flagDepSites` = адреса `JP PE/PO`,
  исполнённые сразу после арифметики, и `DAA` после `SUB/SBC` (детект в ядре-обёртке).
- Produces (codemap): `build_map(image: bytes, trace: dict) -> CodeMap` с `.is_code(addr)`,
  `.labels: set[int]`, `.addr_tables: list[(start,count)]`, `.smc_sites: set[int]`.

- [ ] **Step 1: Расширить `runrom.js` логом событий**

В обёртке ядра фиксировать: каждый исполнённый PC; при опкоде `E9`/`DD E9`/`FD E9` — записать
текущий HL/IX/IY как цель; запись в адрес, который позже исполняется → `smc`; `ED 56/5E/46` → IM;
вектор прерывания → `isrAddr`; `JP PE/PO` после арифм-флага и `DAA` после `SUB` → `flagDepSites`.

- [ ] **Step 2: Снять трассу по всем сценариям**

Run: `node tools/runrom.js roms/kvalley_unpacked64k.bin tools/inputs/menu.json extracted/tr_menu --trace extracted/trace_menu.json`
(аналогично для остальных `tools/inputs/*.json` по мере их создания в Фазе 1).

- [ ] **Step 3: Падающий тест codemap**

```python
# tests/test_codemap.py
from tools.recompiler.codemap import build_map
def test_basic_classification():
    img=bytes([0x00,0xC9])+bytes(14)  # NOP;RET; затем нули-данные
    tr={"execPC":[0,1],"jpHLTargets":[],"smc":[],"imMode":1,"isrAddr":0x38,"flagDepSites":[]}
    cm=build_map(img,tr)
    assert cm.is_code(0) and cm.is_code(1)
    assert not cm.is_code(5)
```

- [ ] **Step 4: Запустить — падает**

Run: `python3 -m pytest tests/test_codemap.py -v`
Expected: FAIL.

- [ ] **Step 5: Реализовать `codemap.py`**

Засев из `execPC` + `jpHLTargets` + `isrAddr` + entry `0x100`; рекурсивный дизасм (Task 4) от
каждого засева, переходя по `targets`; всё непомеченное как код = данные. Детект таблиц адресов:
последовательности `DW`, чьи значения попадают в множество меток кода. `smc_sites` из трассы.

- [ ] **Step 6: Зелёный + прогон на реальной трассе**

Run: `python3 -m pytest tests/test_codemap.py -v && python3 -c "from tools.recompiler.codemap import build_map; import json; print('map built')"`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add tools/runrom.js tools/recompiler/codemap.py tests/test_codemap.py
git commit -m "feat(recompiler): trace event capture + code/data map builder"
```

---

## Task 6: Перевод — база 8080 + JR/DJNZ + эмиттер скелета

**Files:**
- Create: `tools/recompiler/translate.py`, `tools/recompiler/emit.py`, `tools/recompiler/recompile.py`
- Test: `tests/test_translate_base.py`

**Interfaces:**
- Produces: `translate_insn(insn, ctx) -> list[str]` (строки asm). `emit_program(image, codemap)
  -> str` (полный `.asm`). `ctx` даёт `label_for(addr)`.
- Перевод: база 8080 → та же инструкция в синтаксисе zasm; `JR e`→`JMP Lxxxx`;
  `JR cc,e`→`Jcc Lxxxx` (cc: NZ/Z/NC/C); `DJNZ e`→`DCR B` + `JNZ Lxxxx`.

- [ ] **Step 1: Падающий тест**

```python
# tests/test_translate_base.py
from tools.recompiler.disasm import decode
from tools.recompiler.translate import translate_insn
class Ctx:
    def label_for(self,a): return f"L{a:04X}"
def t(b,addr=0x100): return translate_insn(decode(bytes(b),addr),Ctx())
def test_base_and_rel():
    assert t([0x00])==["NOP"]
    assert t([0x18,0xFE],0x100)==["JMP L0100"]          # JR -2 → self
    assert t([0x20,0x02],0x100)==["JNZ L0104"]          # JR NZ,+2
    assert t([0x10,0x05],0x100)==["DCR B","JNZ L0107"]  # DJNZ
```

- [ ] **Step 2: Запустить — падает**

Run: `python3 -m pytest tests/test_translate_base.py -v`
Expected: FAIL.

- [ ] **Step 3: Реализовать базовый `translate.py` + `emit.py` + `recompile.py`**

`translate.py`: словарь база-8080→мнемоника zasm + ветки jr/djnz. Неизвестные группы пока →
`raise NotImplementedError(group)`. `emit.py`: проход по образу; для код-байт — `label_for` +
перевод; для данных — `DB`/`DW` (таблицы адресов из codemap → `DW Lxxxx`). `recompile.py`:
склейка (образ+карта→строка asm), CLI `python3 -m tools.recompiler.recompile <image> <map>`.

- [ ] **Step 4: Зелёный**

Run: `python3 -m pytest tests/test_translate_base.py -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add tools/recompiler/translate.py tools/recompiler/emit.py tools/recompiler/recompile.py tests/test_translate_base.py
git commit -m "feat(recompiler): base i8080 passthrough + JR/DJNZ + emitter skeleton"
```

---

## Task 7: Перевод — CB-группа (битовые) через рантайм-хелперы

**Files:**
- Modify: `tools/recompiler/translate.py`
- Create: `src/z80ext.inc` (раздел CB)
- Test: `tests/test_translate_cb.py`

**Interfaces:**
- Produces: перевод `CB`-опкодов (RLC/RRC/RL/RR/SLA/SRA/SRL/BIT/SET/RES для r и (HL)) в
  последовательности 8080 или `CALL`-хелперы из `z80ext.inc`.
- Consumes: эмиттер (Task 6).

- [ ] **Step 1: Падающий тест (примеры)**

```python
# tests/test_translate_cb.py
from tools.recompiler.disasm import decode
from tools.recompiler.translate import translate_insn
class Ctx:
    def label_for(self,a): return f"L{a:04X}"
def t(b): return translate_insn(decode(bytes(b),0),Ctx())
def test_cb():
    assert t([0xCB,0x27])==["ADD A,A"]            # SLA A == A+A (CY корректен)
    assert t([0xCB,0x47])==["MOV A,A","ANI 01h"]  # BIT 0,A → флаг Z по биту (упрощённо)
    # RES/SET/ротации — точные ожидаемые последовательности зафиксировать в реализации
```

- [ ] **Step 2: Запустить — падает**

Run: `python3 -m pytest tests/test_translate_cb.py -v`
Expected: FAIL.

- [ ] **Step 3: Реализовать CB-перевод + хелперы**

Прямые случаи инлайн (`SLA r`→`ADD`; `SET/RES b,r`→`ORI/ANI` для регистра в A или через хелпер);
сложные (`RLC/RRC/RR/RL/SRA/SRL`, операции над `(HL)`) → `CALL cb_xxx` в `src/z80ext.inc`,
сохраняя семантику флагов CY/Z. Каждый хелпер сопроводить комментарием семантики.

- [ ] **Step 4: Зелёный**

Run: `python3 -m pytest tests/test_translate_cb.py -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add tools/recompiler/translate.py src/z80ext.inc tests/test_translate_cb.py
git commit -m "feat(recompiler): CB bit-ops translation + z80ext runtime helpers"
```

---

## Task 8: Перевод — ED-группа (блочные/16-бит/NEG)

**Files:**
- Modify: `tools/recompiler/translate.py`, `src/z80ext.inc` (раздел ED)
- Test: `tests/test_translate_ed.py`

**Interfaces:**
- Produces: перевод `LDIR/LDDR/CPIR/CPDR`, `ADC/SBC HL,dd`, `LD (nn),dd`/`LD dd,(nn)`, `NEG`,
  `RLD/RRD`, `IM`, `RETI/RETN` → подпрограммы/последовательности 8080.

- [ ] **Step 1: Падающий тест**

```python
# tests/test_translate_ed.py
from tools.recompiler.disasm import decode
from tools.recompiler.translate import translate_insn
class Ctx:
    def label_for(self,a): return f"L{a:04X}"
def t(b): return translate_insn(decode(bytes(b),0),Ctx())
def test_ed():
    assert t([0xED,0xB0])==["CALL z80_ldir"]   # LDIR → хелпер
    assert t([0xED,0x44])==["CALL z80_neg"]     # NEG
    assert t([0xED,0x52]) and "z80_sbc_hl" in t([0xED,0x52])[0]  # SBC HL,DE
```

- [ ] **Step 2: Запустить — падает**

Run: `python3 -m pytest tests/test_translate_ed.py -v`
Expected: FAIL.

- [ ] **Step 3: Реализовать ED-перевод + хелперы**

`z80_ldir/lddr/cpir/cpdr/neg/sbc_hl/adc_hl/rld/rrd` в `z80ext.inc` (точная семантика
регистров/флагов, CY/Z). `IM n` → запись режима (на Векторе фактически IM1/RST7). `RETI/RETN`→`RET`
(+`EI` при необходимости). `LD (nn),dd`/`LD dd,(nn)` для DE/BC → пары `SHLD`/`LHLD`-подобных
последовательностей через временный обмен с HL.

- [ ] **Step 4: Зелёный**

Run: `python3 -m pytest tests/test_translate_ed.py -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add tools/recompiler/translate.py src/z80ext.inc tests/test_translate_ed.py
git commit -m "feat(recompiler): ED-group translation (block ops, 16-bit, NEG, RLD/RRD)"
```

---

## Task 9: Перевод — IX/IY через теневые слова + хелперы

**Files:**
- Modify: `tools/recompiler/translate.py`, `src/z80ext.inc` (раздел IX/IY)
- Test: `tests/test_translate_ixiy.py`

**Interfaces:**
- Produces: перевод DD/FD-инструкций. `IX/IY` хранятся как слова `z80_ix`/`z80_iy` в RAM.
  `LD r,(IX+d)`/`LD (IX+d),r` → хелперы, вычисляющие указатель и сохраняющие прочие регистры/флаги.
  `ADD IX,dd`, `INC/DEC IX`, `LD IX,nn`, `PUSH/POP IX`, `JP (IX)` → последовательности.

- [ ] **Step 1: Падающий тест**

```python
# tests/test_translate_ixiy.py
from tools.recompiler.disasm import decode
from tools.recompiler.translate import translate_insn
class Ctx:
    def label_for(self,a): return f"L{a:04X}"
def t(b): return translate_insn(decode(bytes(b),0),Ctx())
def test_ixiy():
    seq=t([0xDD,0x21,0x34,0x12])             # LD IX,1234h
    assert any("z80_ix" in s for s in seq)
    ld=t([0xDD,0x7E,0x05])                    # LD A,(IX+5)
    assert any("z80_ld_a_ixd" in s for s in ld) or any("z80_ix" in s for s in ld)
```

- [ ] **Step 2: Запустить — падает**

Run: `python3 -m pytest tests/test_translate_ixiy.py -v`
Expected: FAIL.

- [ ] **Step 3: Реализовать IX/IY-перевод + хелперы**

Объявить `z80_ix: DW 0` / `z80_iy: DW 0` в `z80ext.inc`. Хелперы `z80_ld_a_ixd` (вход: disp в
аккум/память), `z80_st_ixd`, `z80_add_ix` и т.п. — с строгим сохранением незатрагиваемых
регистров. `JP (IX)` → `LHLD z80_ix` + `PCHL`.

- [ ] **Step 4: Зелёный**

Run: `python3 -m pytest tests/test_translate_ixiy.py -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add tools/recompiler/translate.py src/z80ext.inc tests/test_translate_ixiy.py
git commit -m "feat(recompiler): IX/IY via shadow words + access helpers"
```

---

## Task 10: Перевод — EXX / EX AF,AF′ + теневой банк регистров

**Files:**
- Modify: `tools/recompiler/translate.py`, `src/z80ext.inc` (теневой банк)
- Test: `tests/test_translate_exx.py`

**Interfaces:**
- Produces: `EXX`→`CALL z80_exx` (обмен BC/DE/HL ↔ теневые `z80_bc'/de'/hl'` в RAM);
  `EX AF,AF′`→`CALL z80_exaf` (обмен A+флаги ↔ теневые). Хелперы сами сохраняют корректность
  активного набора.

- [ ] **Step 1: Падающий тест**

```python
# tests/test_translate_exx.py
from tools.recompiler.disasm import decode
from tools.recompiler.translate import translate_insn
class Ctx:
    def label_for(self,a): return f"L{a:04X}"
def t(b): return translate_insn(decode(bytes(b),0),Ctx())
def test_exx():
    assert t([0xD9])==["CALL z80_exx"]
    assert t([0x08])==["CALL z80_exaf"]
```

- [ ] **Step 2: Запустить — падает**

Run: `python3 -m pytest tests/test_translate_exx.py -v`
Expected: FAIL.

- [ ] **Step 3: Реализовать EXX/EXAF + теневой банк**

В `z80ext.inc`: `z80_bcp/z80_dep/z80_hlp: DW 0` и `z80_afp: DW 0`. `z80_exx`: обмен текущих
BC/DE/HL с теневыми (через стек/память, не теряя флаги вызывающего, если они нужны после —
проверить семантику: EXX флаги НЕ меняет). `z80_exaf`: обмен AF (`PUSH PSW`/`POP PSW` + теневое).

- [ ] **Step 4: Зелёный**

Run: `python3 -m pytest tests/test_translate_exx.py -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add tools/recompiler/translate.py src/z80ext.inc tests/test_translate_exx.py
git commit -m "feat(recompiler): EXX/EX AF,AF' via RAM-backed shadow register bank"
```

---

## Task 11: Точечная эмуляция различий флагов (overflow / DAA+N)

**Files:**
- Modify: `tools/recompiler/translate.py`, `src/z80ext.inc`
- Test: `tests/test_translate_flags.py`

**Interfaces:**
- Consumes: `codemap.flagDepSites` (Task 5).
- Produces: в сайтах из `flagDepSites` — `JP PE/PO` после арифметики транслируется через хелпер
  `z80_jp_ov`/`z80_jp_no` (вычисление настоящего overflow), а `DAA` после `SUB/SBC` — через
  `z80_daa_sub` (учёт флага N). Вне этих сайтов `JP PE/PO`→`JPE/JPO` (parity, как в 8080),
  `DAA`→`DAA`.

- [ ] **Step 1: Падающий тест**

```python
# tests/test_translate_flags.py
from tools.recompiler.disasm import decode
from tools.recompiler.translate import translate_insn
class Ctx:
    def __init__(self,dep): self.dep=set(dep)
    def label_for(self,a): return f"L{a:04X}"
    def is_flag_dep(self,a): return a in self.dep
def test_flags():
    # JP PE,nn (0xEA) НЕ в dep → обычный JPE
    assert translate_insn(decode(bytes([0xEA,0x00,0x02]),0x100),Ctx([]))==["JPE L0200"]
    # тот же адрес в dep → overflow-хелпер
    out=translate_insn(decode(bytes([0xEA,0x00,0x02]),0x100),Ctx([0x100]))
    assert any("z80_jp_ov" in s for s in out)
```

- [ ] **Step 2: Запустить — падает**

Run: `python3 -m pytest tests/test_translate_flags.py -v`
Expected: FAIL.

- [ ] **Step 3: Реализовать флаговую развилку + хелперы**

`translate.py` использует `ctx.is_flag_dep(addr)`. Хелперы `z80_jp_ov/z80_jp_no/z80_daa_sub` в
`z80ext.inc` (поддержание «теневого» бита overflow/N, выставляемого хелперами арифметики там,
где это требуется — реализовать минимально под выявленные сайты).

- [ ] **Step 4: Зелёный**

Run: `python3 -m pytest tests/test_translate_flags.py -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add tools/recompiler/translate.py src/z80ext.inc tests/test_translate_flags.py
git commit -m "feat(recompiler): targeted flag-semantics emulation (overflow, DAA+N)"
```

---

## Task 12: Сборка `.rom` + Makefile + прерывание RST7

**Files:**
- Create: `Makefile`
- Modify: `tools/recompiler/emit.py` (вектор `0x38`/RST7, инициализация рантайма)
- Test: ручная сборка

**Interfaces:**
- Produces: `make rom` → `roms/kvalley_v06c.rom`. ISR оригинала подключается к RST7 (`0x38`);
  стартовый код инициализирует теневые регистры/IX/IY и переходит на портированный вход `0x100`.

- [ ] **Step 1: Сгенерировать asm и собрать**

```makefile
# Makefile
IMG=roms/kvalley_unpacked64k.bin
golden:; node tools/runrom.js $(IMG) tools/inputs/menu.json extracted/golden_menu --org 0x100
asm:; python3 -m tools.recompiler.recompile $(IMG) > src/kvalley.asm
rom: asm; zasm --8080 src/kvalley.asm -o roms/kvalley_v06c.rom
verify:; node tools/runrom.js roms/kvalley_v06c.rom tools/inputs/menu.json extracted/tgt_menu --org 0x100 && python3 tools/diff_frames.py extracted/golden_menu extracted/tgt_menu
```

- [ ] **Step 2: Прогнать сборку**

Run: `make asm && make rom`
Expected: `roms/kvalley_v06c.rom` создан; `zasm` без ошибок (если ошибки — чинить перевод/эмиттер).

- [ ] **Step 3: Коммит**

```bash
git add Makefile tools/recompiler/emit.py
git commit -m "build: Makefile (asm/rom/golden/verify) + RST7 ISR wiring"
```

---

## Task 13: ВЕХА Фазы 0 — заставка/меню проходит дифф-верификацию

**Files:** —(интеграция; правки в `translate.py`/`emit.py`/`z80ext.inc` по результатам)

**Interfaces:**
- Consumes: всё выше.
- Produces: доказанный сквозной пайплайн на одном экране.

- [ ] **Step 1: Tier-1 дифф (быстрый, общий JS-движок)**

Run: `make golden && make verify`
Expected: `diff_frames.py` → код 0 (экранная память заставки/меню совпадает кадр-в-кадр).
Если расхождение — `diff_frames` даёт `(frame,offset)`; локализовать инструкцию по адресу,
исправить правило перевода/хелпер, пересобрать. Повторять до совпадения.

- [ ] **Step 2: Tier-2 авторитетный — vector06js (реальный i8080)**

Загрузить `roms/kvalley_v06c.rom` в https://svofski.github.io/vector06js/ через MCP puppeteer,
снять скриншот заставки, сверить с `extracted/golden_menu.png`.
Expected: заставка/меню визуально идентичны.

- [ ] **Step 2-impl (puppeteer):** navigate на vector06js → загрузить rom (через UI/drag-drop
  эмулятора) → `puppeteer_screenshot` → визуальная сверка. Зафиксировать рецепт загрузки в
  `tools/play_vector06js.md`.

- [ ] **Step 3: Коммит вехи**

```bash
git add -A
git commit -m "milestone(phase0): splash/menu passes Tier-1 diff + Tier-2 vector06js"
```

---

## Task 14: Фаза 1 — полная трансляция, дифф-верификация по уровням

**Files:** `tools/inputs/level*.json`, правки `translate.py`/`emit.py`/`z80ext.inc`/`codemap.py`

**Interfaces:**
- Consumes: пайплайн Фазы 0.
- Produces: весь код переведён; экранная память совпадает с golden на всех сценариях.

**Итеративный протокол (повторять для каждого сценария):**

- [ ] **Step 1: Скрипт ввода сценария**

Создать `tools/inputs/levelN.json` (последовательность клавиш, проходящая уровень/ключевые
ситуации: лестницы, меч, кирка, враги, смерть, F1, F2). Раскладку клавиш брать из Monty
`probe_kbd*.js`.

- [ ] **Step 2: Снять golden + трассу сценария**

Run: `node tools/runrom.js roms/kvalley_unpacked64k.bin tools/inputs/levelN.json extracted/golden_levelN --trace extracted/trace_levelN.json`

- [ ] **Step 3: Пересобрать карту с накопленной трассой**

Объединить все `extracted/trace_*.json` (бóльшее покрытие кода и целей JP(HL)); `make asm && make rom`.
Expected: `zasm` чисто; новые достижимые ветки/таблицы учтены.

- [ ] **Step 4: Дифф сценария (Tier-1)**

Run: `node tools/runrom.js roms/kvalley_v06c.rom tools/inputs/levelN.json extracted/tgt_levelN --org 0x100 && python3 tools/diff_frames.py extracted/golden_levelN extracted/tgt_levelN`
Expected: код 0. При расхождении — локализовать по `(frame,offset)`+трассе, исправить правило/
хелпер/флаговый сайт/SMC, повторить.

- [ ] **Step 5: Tier-2 ключевых сценариев в vector06js**

Снять скриншоты прохождения в vector06js (puppeteer), сверить с golden PNG; проверить звук на слух.

- [ ] **Step 6: Коммит сценария**

```bash
git add -A
git commit -m "phase1: level N verified (Tier-1 diff clean + Tier-2 spot-check)"
```

- [ ] **Step 7: Повторить Steps 1–6** для всех уровней/состояний, пока ни один сценарий не даёт
  расхождений и весь исполняемый код покрыт.

---

## Task 15: Фаза 2 — целевая платформа, полировка, релиз

**Files:** `roms/kvalley_v06c.rom`, `README.md`, `CONTEXT.md`

- [ ] **Step 1: Полный прогон в vector06js**

Загрузить релизный `.rom`, пройти ключевые уровни вручную (puppeteer/локально), проверить
управление (курсор+лестницы, пробел=прыжок/меч/кирка, F1=пауза, F2=самоликвидация), графику,
звук. Зафиксировать наблюдения.

- [ ] **Step 2: Производительность**

Если горячие места (ED/IX-IY/EXX-хелперы) тормозят геймплей — оптимизировать соответствующие
подпрограммы `z80ext.inc` (инлайн, спецслучаи). Перепроверить дифф после каждой оптимизации.

- [ ] **Step 3: README + журнал**

`README.md`: что это, как собрать (`make rom`), как запустить (vector06js), статус. Обновить
`CONTEXT.md` и журнал. Указать происхождение и автора оригинала (Иван Городецкий).

- [ ] **Step 4: Финальный коммит/тег**

```bash
git add -A
git commit -m "release: King's Valley for vanilla Vector-06C (i8080), runs on vector06js"
git tag v1.0
```

---

## Self-Review (выполнено)

- **Покрытие спеки:** Стадии A–E спеки → Задачи: A(готово в bootstrap)+IMG; B→Task 5; C→Tasks
  6–11; D→Task 12; E→Tasks 1–3,13,14. Фазы 0/1/2 спеки → Tasks 13/14/15. Риски (флаги, покрытие,
  JP(HL), SMC, EXX/IX-IY, перф) → Tasks 5,11,9,10,14,15.
- **Плейсхолдеры:** в Task 1 адрес плоскости `0x????` намеренно резолвится в Step 1 (зависит от
  факта раскладки видеопамяти Вектора) — это первый шаг задачи, не плейсхолдер реализации.
- **Согласованность типов:** имена хелперов (`z80_ldir/neg/sbc_hl/exx/exaf/ix/iy/jp_ov/daa_sub`),
  API (`decode`, `build_map`, `translate_insn`, `emit_program`, `first_divergence`) согласованы
  между задачами.
- **Замечание исполнителю:** Tasks 7–11 содержат репрезентативные ожидаемые последовательности;
  точные строки некоторых хелперов фиксируются при реализации соответствующего раздела
  `z80ext.inc` и закрепляются дифф-верификацией (Task 13/14) как окончательным критерием.

---

# РЕВИЗИЯ ПЛАНА v2 — сохранение адресов (RST-ловушка)

Стратегия сменилась на **сохранение адресов** (см. ревизию спеки + `docs/JOURNAL.md`).
**T1–T5 остаются в силе** (machine, runrom+trace, diff_frames, disasm, codemap).
**T6 (релоцирующий эмиттер/translate_insn) — СУПЕРСЕДНУТ** (релокация не используется).
Ниже — задачи v2. Вход трансляции: `roms/kvalley_postinit64k.bin` (post-init, SMC=0).

Свободные RST-векторы: 0x10/0x18/0x20/0x28/0x30 (игра строит только 0x00/0x08/0x38).
Универсальный вектор ловушки: **RST 0x10 (опкод D7)**.

## Task 6v2: Патчер образа + боковая таблица

**Files:** Create `tools/recompiler/patch.py`; Test `tests/test_patch.py`.
**Interfaces:** `find_z80_sites(image, codemap) -> list[Site]` (Site = addr, group, length, opbyte);
`build_target(image, codemap, runtime_org) -> (patched_bytes, table_bytes)`. Каждый Z80-сайт:
первый байт → 0xD7 (RST10), хвост сохраняется. Таблица: отсортированный массив записей
`{addr:uint16 LE, kind:uint8}` (kind кодирует JR-uncond/JRNZ/JRZ/JRNC/JRC/DJNZ/CB/ED/IXIY/EXX/EXAF;
суб-опкод/dd читаются из сохранённого хвоста в рантайме). Вектор 0x10 патчится на `JMP dispatcher`.

- [ ] Найти все Z80-сайты по codemap (group != 'i8080'), полный обход инструкций (decode(image[a:],a)).
- [ ] Патчить копию post-init образа: opbyte→0xD7; собрать таблицу (sorted by addr).
- [ ] TDD: синтетический образ с JR/EXX/CB → корректный патч + таблица.
- [ ] Найти свободную дыру RAM под рантайм+таблицу (скан codemap «не код и не данные»/нули); зафиксировать `runtime_org`.
- [ ] Commit.

## Task 7v2: RST-диспетчер + обработчики JR/JRcc/DJNZ (src/z80trap.asm)

**Files:** Create `src/z80trap.asm` (рантайм, ORG=runtime_org); Test: изолированный прогон на emu8080.py.
**Interfaces:** вектор 0x10 → `JMP z80_dispatch`. `z80_dispatch`: снять адрес возврата r со стека
(он = сайт+1); бинарный поиск (r-1) в таблице → kind; перейти к обработчику. КРИТично: сохранить
все регистры/флаги вызывающего для эмулируемой операции.
- [ ] Диспетчер: бинарный поиск по таблице (адрес, kind), переход по kind (таблица переходов).
- [ ] JR uncond: dd=[r]; target=r+1+signext(dd); установить PC=target (через стек).
- [ ] JR cc: проверить флаг (NZ/Z/NC/C), либо прыжок на target, либо продолжение с r+1.
- [ ] DJNZ: DCR B; если NZ — прыжок на target, иначе r+1. (B сохранить корректно.)
- [ ] Тест: маленький образ с JR/DJNZ через emu8080.py — поведение совпадает с Z80.js.
- [ ] Commit.

## Task 8v2: Обработчики CB (битовые)
**Files:** `src/z80trap.asm` (+CB). Суб-опкод = [r]; эмулировать RLC/RRC/RL/RR/SLA/SRA/SRL/BIT/SET/RES
для r и (HL), семантика CY/Z. Тест изолированно. Commit.

## Task 9v2: Обработчики ED
**Files:** `src/z80trap.asm` (+ED). LDIR/LDDR/CPIR/CPDR, ADC/SBC HL,dd, LD (nn),dd, NEG, RLD/RRD,
IM (no-op/режим), RETI/RETN→RET. Тест. Commit.

## Task 10v2: Обработчики IX/IY + теневые слова
**Files:** `src/z80trap.asm` (+IXIY, `z80_ix/z80_iy: DW`). Все DD/FD-формы по суб-опкоду из хвоста.
Тест. Commit.

## Task 11v2: EXX / EX AF,AF' + теневой банк регистров
**Files:** `src/z80trap.asm` (+теневой банк `z80_bcp/dep/hlp/afp`). EXX/EXAF — kind из таблицы
(1-байтовые сайты). Тест. Commit.

## Task 12v2: Флаги overflow/DAA (точечно)
Пока flagDepSites=0 (меню). Если полная трасса выявит — обработать JP PE/PO (overflow) и DAA+N в
рантайме. Иначе — пометить как не требуется. Тест/заметка. Commit.

## Task 13v2: Сборка + ВЕХА Фаза-0 (меню)
**Files:** `Makefile`. `make rom`: zasm src/z80trap.asm @runtime_org → бинарь рантайма; python
patch.py собирает `roms/kvalley_v06c.rom` = post-init образ + патч RST-сайтов + вектор 0x10 + рантайм+таблица.
- [ ] `make rom` собирает образ.
- [ ] Tier-1: `runrom` golden(unpacked) vs target(kvalley_v06c.rom) на menu.json → `diff_frames` == 0.
      (Прогон target — на том же Z80.js-движке; т.к. образ чисто-8080, исполняется корректно; ловушки
      проверяют именно эмуляцию Z80-ops. Для авторитетной проверки флагов — Tier-2.)
      ВНИМАНИЕ: golden берём с unpacked (он сам инициализируется); target = собранный образ, который
      грузится как РАБОЧИЙ post-init — он не проходит init заново. Согласовать точки сравнения
      (начинать сравнение кадров после стабилизации, либо target тоже от своего входа). Решить в задаче.
- [ ] Tier-2: загрузить rom в vector06js (puppeteer), скриншот = эталон.
- [ ] Commit вехи.

## Task 14v2: Фаза-1 — полное покрытие Z80-сайтов по уровням
Скрипты ввода по уровням → полная трасса → codemap покрывает ВЕСЬ исполняемый код → patch.py ловит
ВСЕ Z80-сайты. Итеративная дифф-верификация по уровням; чинить обработчики/флаги. Каждый уровень — commit.

## Task 15v2: Фаза-2 — vector06js, полировка, релиз
Полный прогон в vector06js (управление/звук/графика), оптимизация горячих обработчиков при
необходимости, README+журнал, релизный rom, тег.

### Самоконтроль ревизии
- Tier-1 «target на Z80.js»: образ чисто-8080, Z80.js его исполнит верно ПО ЛОГИКЕ; различия флагов
  8080↔Z80 Z80.js НЕ покажет (он Z80) → флаговые баги ловит ТОЛЬКО Tier-2 (реальный i8080 vector06js)
  или emu8080.py. Поэтому Tier-2/emu8080 — обязательная часть верификации, не опциональная.
- Точка отсчёта кадров target vs golden — открытый вопрос Task 13v2 (init проходит только unpacked).
