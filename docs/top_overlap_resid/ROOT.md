# top_overlap_resid — корень (2026-08-10 / фикс 2026-08-11)

## Вердикт A/B
- eae6b7b / 9b99ed1: пик **23** Б дыр (p2) @ t=481
- 1.0b c5a6436: пик **24** Б (та же полоса lo 200..247)
- **Старый дефект, обнажился** (не внесён `vclp`). Без контакта (`onmum=false`) пик 0.

## Механизм (доказано замером на t=481)
1. Остаток — **дыры** (TEST=0, REF≠0), не orphan-OR спрайта.
2. Сейвы слотов на p2 в зоне дыр — **нули**, при том что `vec_nat_room` рисует там тайлы.
3. `vpr_mix=0xFE`, у мумии `hi0c`, общий столбец; slow-path: `restore` нулей → снос p2 → `save` снимает нули.
4. Инвариант задачи#49 «кирпичи строго вне габарита» на верхней площадке **ложный** (бывают тайлы **p2**).
5. Сейв часто **частично** нулевой — «весь блок = 0» недостаточно.
6. К моменту restore `+0xA0` уже новый силуэт — ANDN из `0xA0` при движении опасен.

## Фикс: side-buffer MASK (`vec_topmask.asm`)
- `+0xD4` = MASK; `+0xD5..+0xF4` = силуэт прошлого кадра (≤32 Б = 2 кол).
- **afterdraw** (верх, GS=5, idx≥4, lo0≥224, **hi0c≠0**): `0xA0` → `+0xD5`, MASK=1.
- **restore+MASK**: ANDN из `+0xD5` только по **hi0** (p2), MASK=0, затем **POP** фона из `+6`.
- Фон в `+6` не подменяем силуэтом (иначе sticky, control≠0).

### Замеры vs база 9b99ed1
| Метрика | База | Фикс |
|---------|------|------|
| `top_overlap_resid` 1000t | peak **23** | peak **0**, control 0, mumPass 9 |
| то же 2000t | — | peak 0, mumPass 18 |
| `run_gates.sh` | — | **PASS** |
| DEVECTOR / свободно | 256 Б | OK / **142** Б |
| `hero_top_stress` не показаны | 27.79% | ~29.2% |
| `hero_top_stress` позже луча | 2.18% | ~3.3% |
| `jump_top_beam --onmum` «байт не было» | 29.8% | 29.4% |

## Пробы до фикса (отвергнуты)
MASK в +6; divert/live OR; skip empty/zeros; NOP/`call` delay (ложный green, mumPass↓); refill через save.

## Приёмка
peak 0 + control 0 + покрытие гейта; `run_gates` + DEVECTOR; не лечить задержкой; не класть силуэт в `+6`.

## Parallel same-dir (prompt #2, 2026-08-11)

### Жалоба
Движение героя и мумии **в одну сторону**, прыжок **вплотную сбоку** — на верхней строке остаётся голова мумии (orphan OR на p2 в зоне vclp lo≥240).

### Гейт
`top_overlap_resid.js` — два семейства: **legacy** (перепрыгивание) + **parallel** (same-dir, dist 0/8/16, фаза t≥NT/2). Метрики: `peakLegacy`, `peakParallel`.

| ROM | legacy | parallel | итог |
|-----|--------|----------|------|
| 3252e47 | 0 | **6** @ t=950 clip | FAIL |
| fix | 0 | 0 | OK |

### Корень
1. **vclp** обнуляет хвост `0xA0`, но **fb** в lo 240..255 держит OR (p2 / hi0c).
2. Силуэт в `+0xD5` из `0xA0` — нули в clip-части → ANDN не гасит.
3. Фильтр **hi0c≠0** в afterdraw (3252e47) дополнительно блокировал MASK у героя (`hi0cW=0`).

### Фикс (`vec_topmask.asm`)
- Убран `hi0c` gate в `vtm_afterdraw` (MASK ставится на всех верхних слотах).
- **`vtm_zclip`** после ANDN: нули lo 240..255 на **hi0** и **hi0c** (ncols столбцов).

### Замеры fix vs 3252e47
| Метрика | 3252e47 | fix |
|---------|---------|-----|
| `top_overlap_resid` 1200t | parallel **6** | **0** |
| `run_gates.sh` | — | **PASS** |
| DEVECTOR / свободно | 147 Б | OK / **93** Б |
| `burst_cost` 2000t | avg 6444 p90 22528 max 54712 | avg 6443 p90 22536 max 54716 |

## mumJump orphan (engine-cleanup задача 0, база 245f0a3)

### Жалоба (железо 1.04b)
Мумия **перепрыгивает** героя (штатное уклонение). На верхней строке и на обычных
рядах — **сироты** (TEST≠0 / REF=0), не дыры. Старый `top_overlap_resid` ловил
прыжок **героя** и дыры; направление/фаза/тип дефекта другие.

### Почему гейт не ловил
- нет семейства «мумия в прыжке» (`momiaDat` status=1 / `valoresSalto`);
- нет метрики orphan vs hole;
- `mumPass` — стоячая пара после прыжка героя, не дуга мумии.

### RED на 245f0a3 (`top_overlap_resid.js` 1200t, ROW=8)
| семейство | покрытие | пик |
|-----------|----------|-----|
| legacy | jumpPair 2, negY 4, mumPass 4 | d=7 orphan=6 |
| parallel | runs 5, contacts 2 | d=6 orphan=5 |
| **mumJump** | jumps 4, samples 97 | **orphan=10 clipOrphan=10** (p2, lo≥240) |

Проба `mumjump_probe.js`: на контакте пик orphan до ~98 (p0, вне clip) — MASK у
мумии с `hi0b=p0`, а ANDN в restore гасит только **hi0**. Clip-сироты p2 — zclip
до POP, POP возвращает хвост из `+6`.

Артефакты до фикса: `peak_mumjump_kvalley_8c_t825.png` (+ legacy/parallel t361/t409).


## mumJump без снятия sortord (2026-08-13, железо)

`vso_sortord` на MiSTer **обязателен** (полный `ret` = спрайты не видны; эмулятор
не ловил). Фикс без его снятия:

1. Сжат `vso_sortord` (~8 Б) → pre-align зазор под `vsu_hide`.
2. `vsu_hide` в `vec_topmask_gap.asm` (PRE-align).
3. `vtm_zclip` **после POP**, SP сначала как `vsu_rdone`, клип **hi0/hi0b** (hi0c
   отложен — parallel 0 на 1200t и без него).
4. afterdraw `lo0≥228`.

`top_overlap_resid` 1200t: clipOrphan **10→0**, parallel **5→0**, legacy 7→1,
mumJump orphan 10→2 (вне clip, row≈72). Гейт ещё красный по d=3; клип-сироты закрыты.
