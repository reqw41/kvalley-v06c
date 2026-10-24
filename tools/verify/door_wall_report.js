// door_wall_report.js — собирает outputs/door-wall/results.json и REPORT.md; числа в отчёт подставляются из results.json.
"use strict";
const fs = require("fs"), cp = require("child_process"), path = require("path");
const O = path.join(__dirname, "../../outputs/door-wall");
const sha = f => cp.execSync("shasum " + f).toString().split(" ")[0];
const cmp = k => JSON.parse(fs.readFileSync(`${O}/data/cmp_${k}.json`, "utf8"));
const lo = fs.readFileSync(`${O}/lo_align_vs_1110c3b.log`, "utf8").trim().split("\n").map(l => JSON.parse(l));
const res = {
  rom: { sha1: sha(`${O}/rom/kvalley_8c.rom`), size: fs.statSync(`${O}/rom/kvalley_8c.rom`).size,
         sym_sha1: sha(`${O}/rom/kvalley_8c.sym`), splash_sha1: sha(`${O}/rom/kvalley_splash.rom`) },
  builds: { fix: cmp("fix"), base: cmp("base"), clo: cmp("clo"), c23: cmp("c23") },
  lo_align: lo.map(r => ({ scen: r.scen, ticks: r.ticks[0], equal: r.equal })),
  code: { game_bytes_removed: 0, note: "см. results.code_bytes" },
  code_bytes: JSON.parse(fs.readFileSync(`${O}/code_bytes.json`, "utf8")),
};
fs.writeFileSync(`${O}/results.json`, JSON.stringify(res, null, 1));
const b = res.builds, cb = res.code_bytes;
const row = (n, k) => `| ${n} | ${b[k].n} | ${b[k].passEq}/${b[k].n} | ${b[k].fallEq}/${b[k].n} | ${b[k].fallsExtra} | ${b[k].xeWithin1step}/${b[k].n} | ${b[k].maxdx} | ${b[k].len6Port.join("/")} |`;
const md = `# door-wall: проход героя сквозь ступеньку после вращающейся двери

Основа 1110c3b, ветка door-wall. Деплоя, push и MiSTer нет. Числа подставлены скриптом tools/verify/door_wall_report.js из results.json.

## Итог

Баг порта, не оригинала. Состояние 6 (проход вращающейся двери) идёт вдвое длиннее оригинала: ${b.base.len6Port.join("/")} тиков вместо ${b.base.len6Z80.join("/")} и вдвое больше шагов, герой выходит из двери на ${b.base.maxdx.toFixed(0)} px дальше, чем у оригинала, и попадает внутрь ступеньки за дверью. Правка: ${cb.fix_total} Б нетто (тело в холодном хвосте vec_jumpmid.asm, в vec_tables/игре осталось \`jp\`). SHA1 ROM ${res.rom.sha1}.

## Доказано

### 1. Сценарий

Пирамида 2, комната 1, дверь A (запись 1 doorGiraData: Y=0x28, X=0x40, высота 3). Слева от двери пол (ряд карты 7, колонки 7..12), за дверью справа ступенька на тайл вверх (платформа, колонка 11, X=88). Герой Y=48, X=56 (у двери), держит ВПРАВО: через 8 тиков толкания дверь пускает его (состояние 6), он выходит справа от двери и должен упереться в ступеньку.

| Сборка | X на выходе из двери | Что дальше |
|---|---|---|
| Z80 оригинал | 76.88 | упирается в ступеньку, остаётся на X=76..77 (Y=48) |
| 1110c3b, a1f99e8, 23ffb6f | 94.16 | заходит в тайл ступеньки (X=88..95), пола нет, падает на 16 px и уходит дальше (X=116, Y=64) |
| door-wall | 76.88 | упирается, как оригинал |

### 2. Оригинал против сборок (стенд tools/verify/door_pass.js)

Сетка ${b.fix.n} запусков: дверь A вправо (X=56, 4 субпикселя, 4 фазы нажатия), A влево (X=72..80), дверь B вправо (X=104) и влево (X=120..127). Оригинал — Z80 kvalley_z80.rom в WebMSX (пирамида 2 выставлена записью piramideDest/piramideActual в статусах 3-4), тик порта = 2 кадра. Допуск сравнения 1 шаг (0.66 px): фаза нажатия относительно кадра у Z80 даёт 31 или 32 шага, у порта всегда 32.

| Сборка | Запусков | Проход состоялся | Падение совпало с Z80 | Лишних падений | X на выходе из двери в пределах 1 шага | Макс. расхождение X, px | Длина состояния 6, тиков |
|---|---|---|---|---|---|---|---|
${row("1110c3b (текущая)", "base")}
${row("a1f99e8 (logic-opt)", "clo")}
${row("23ffb6f (до logic-opt)", "c23")}
${row("door-wall (правка)", "fix")}

Z80: длина состояния 6 = ${b.fix.len6Z80.join("/")} тиков. До правки все три сборки дают одно и то же, поэтому logic-opt и vec_jumpmid/fix-jump-wall не причастны. Дефект есть уже на 23ffb6f, то есть появился раньше logic-opt; по коду protaWalk2 и тик 25 Гц введены 85a7d11 (на 85a7d11^ сценарий не замерялся: чит N там отсутствует, это вывод по коду, не замер).

### 3. Причина

Оригинал: protaGiratoria идёт на \`timer&1\` (каждый второй кадр 50 Гц), accionWaitCnt=0x20, шаг mueveProta без проверки стены: 32 шага по 0xA8 = ~21 px за 64 кадра. На порте тик логики = 2 кадра, но \`timer\` растёт на 1 за тик, поэтому \`timer&1\` пропускал каждый второй тик (64 тика = 128 кадров), а protaAnda4 на 25 Гц делал protaWalk2 (два шага за ход). Итого ~58 шагов (${b.base.maxdx.toFixed(0)} px сверх). Состояние 6 не смотрит стену, поэтому герой оказывается внутри ступеньки; chkProtaCae не находит пол, падение.

### 4. Правка

Состояние 6 для игрока идёт каждый тик (тик = 2 кадра оригинала), один mueveProta через protaAnda4s, без protaWalk2. Демо (controlPlayer бит 6 = 0) оставлено с гейтом \`timer&1\`, как шло. protaGiratoria в игре теперь \`jp protaGirMid\`, тело в src/v06c/vec_jumpmid.asm (перед .align vec_rev4 зазор в игре всего 1 Б: прямая вставка в игру подняла образ 29861 -> ${cb.direct_size} Б, свободно 0 Б, поэтому вынесено).

Размер: образ ${res.rom.size} Б (без изменений), свободно до romCeil ${cb.free_before} -> ${cb.free_after} Б (нетто ${cb.fix_total} Б).

### 5. Проверки

- lo_align против 1110c3b: ${res.lo_align.filter(r => r.equal).length}/${res.lo_align.length} сценариев equal (${res.lo_align.map(r => r.scen + " " + r.ticks).join(", ")}). Расхождений не ожидалось: ни один из шести сценариев не заходит в состояние 6 (покрытие статусов героя в outputs/logic-opt/REPORT.md: 0..5 без 6), правка лежит только в этой ветке.
- Гейты run_gates.sh: вывод правки и основы (outputs/door-wall/gates_fix.log, gates_base.log) идентичен построчно, кроме адреса vsu_srow в hud_junk_gate (сдвиг кода). Красные и на основе: spr_resid_gate (FAIL), knife_purity (ГЕЙТ ПАДАЕТ: сцены «нож над лестницей» нет), bonus_ending_gate (FAIL 1_scene, 2_door, 3_walk, 4_jump, 5_bonus). cheat_entry_gate с build/kvalley_splash.rom: PASS.

## Гипотезы (оценка, не замер)

- Анимация вращения двери в порте идёт вдвое медленнее оригинала: поворот занимает ${b.fix.spinPort[0]}..${b.fix.spinPort[b.fix.spinPort.length - 1]} тиков против ${b.fix.spinZ80[0]}..${b.fix.spinZ80[b.fix.spinZ80.length - 1]} у Z80 (замер, door_pass.js, поле spin): \`timer&7\` в spiningDoors тоже осталось от 50 Гц. Это не причина падения; к концу прохода (32 тика) дверь ещё доворачивается, тайлы карты заменяются позже, чем у оригинала. Не исправлялось (вне задачи); оценка влияния на игру: только вид и момент замены тайлов двери.
- Прочие места, где \`timer&N\` осталось от 50 Гц, не проверялись.
`;
fs.writeFileSync(`${O}/REPORT.md`, md);
console.log("ok");
