// door_wall_report2.js — раунд 2: results.json (раздел round2) и REPORT_ROUND2.md из данных outputs/door-wall/round2.
"use strict";
const fs = require("fs"), cp = require("child_process"), path = require("path");
const O = path.join(__dirname, "../../outputs/door-wall"), R = O + "/round2";
const sha = f => cp.execSync("shasum " + f).toString().split(" ")[0];
const J = f => JSON.parse(fs.readFileSync(f, "utf8"));
const rng = a => a.length ? a[0] + ".." + a[a.length - 1] : "-";
const fix = J(R + "/cmp_fix2.json"), r1 = J(R + "/cmp_r1.json");
const first = a => a.map(s => s[1][0]);
const ez = J(R + "/audit_exit_z80.json").map(s => s[1][0]), ep = J(R + "/audit_exit_port.json").map(s => s[1][0]);
const lo = fs.readFileSync(R + "/lo_align_vs_31ad026.log", "utf8").trim().split("\n").map(l => JSON.parse(l));
const cb = { free_before: 169, free_after: 148, net: 21 };
const results = fs.existsSync(O + "/results.json") ? J(O + "/results.json") : {};
results.round2 = { rom: { sha1: sha(R + "/rom/kvalley_8c.rom"), sym_sha1: sha(R + "/rom/kvalley_8c.sym"), splash_sha1: sha(R + "/rom/kvalley_splash.rom"), size: fs.statSync(R + "/rom/kvalley_8c.rom").size },
  door: { z80: fix, before: r1, after: fix }, lo_align: lo.map(r => ({ scen: r.scen, ticks: r.ticks[0], equal: r.equal })), code: cb, exitAnim: { z80_frames: ez, port_frames: ep } };
fs.writeFileSync(O + "/results.json", JSON.stringify(results, null, 1));
const x = results.round2;
const md = `# door-wall, раунд 2: темп вращения двери и аудит timer

Основа 31ad026. Деплоя, push и MiSTer нет. Числа подставлены tools/verify/door_wall_report2.js из results.json (раздел round2).

## Итог

Анимация вращения двери теперь идёт в темпе оригинала: поворот ${rng(fix.spinPort)} тиков порта против ${rng(fix.spinZ80)} у Z80 (было ${rng(r1.spinPort)}). Правка ${cb.net} Б нетто (свободно ${cb.free_before} -> ${cb.free_after} Б). SHA1 ROM ${x.rom.sha1}.

## Доказано

### Дверь: Z80 / было (31ad026) / стало

Стенд tools/verify/door_pass.js, ${fix.n} запусков (двери A и B, оба направления, субпиксель, фаза нажатия). Допуск 1 шаг.

| Показатель | Z80 | Было | Стало |
|---|---|---|---|
| Длительность вращения, тиков | ${rng(fix.spinZ80)} | ${rng(r1.spinPort)} | ${rng(fix.spinPort)} |
| Длина прохода (состояние 6), тиков | ${fix.len6Z80.join("/")} | ${r1.len6Port.join("/")} | ${fix.len6Port.join("/")} |
| Проход состоялся / падения совпали с Z80 | - | ${r1.passEq}/${r1.n}, ${r1.fallEq}/${r1.n} | ${fix.passEq}/${fix.n}, ${fix.fallEq}/${fix.n} |
| Лишних падений | - | ${r1.fallsExtra} | ${fix.fallsExtra} |
| Тайлы двери и направление в момент конца вращения совпали | - | ${r1.tileAtSpinEndEqual}/${r1.n} | ${fix.tileAtSpinEndEqual}/${fix.n} |
| Тайлы и направление после 260 тиков совпали | - | ${r1.finTileEqual}/${r1.n} | ${fix.finTileEqual}/${fix.n} |
| Дверь не «полуповёрнута» (бит вращения снят) в конце | - | ${r1.doorNotSpinningAtEnd}/${r1.n} | ${fix.doorNotSpinningAtEnd}/${fix.n} |
| Все критерии разом | - | ${r1.allEqual}/${r1.n} | ${fix.allEqual}/${fix.n} |

Момент замены тайлов карты (putGiratMap) идёт вместе со снятием бита вращения (spiningDoorEnd), поэтому совпадает по тем же тикам, что и длительность (оценка тиков: 20..24 у Z80 из-за фазы timer, 20..23 у порта).

### Правка

spiningDoors3 теперь \`jp spinGate\`; spinGate в src/v06c/vec_jumpmid.asm берёт маску 3 для игрока (8 кадров = 4 тика) и 7 для демо (controlPlayer бит 6 = 0, как в раунде 1), затем \`jp spiningDoors3b\`. Регистр E свободен (DE пишется ниже).

### Проверки

- lo_align против 31ad026: ${x.lo_align.filter(r => r.equal).length}/${x.lo_align.length} equal (${x.lo_align.map(r => r.scen + " " + r.ticks).join(", ")}), включая demo; сценарии не включают вращающуюся дверь.
- run_gates.sh: вывод построчно равен раунду 1, кроме адреса vsu_srow в hud_junk_gate. Красные как на базе: spr_resid_gate, knife_purity, bonus_ending_gate. cheat_entry_gate со splash: PASS.

### Аудит: время открытия двери-выхода (openCloseExit, timer&0x1F)

Замер timer_audit_exit.js (запись 0x30 в статус выхода, до смены полубайта; четыре фазы старта): Z80 ${ez.join(", ")} кадров, порт ${ep.join(", ")} кадров (последнее значение порта — смена на 0, а не на 4). Порт примерно вдвое медленнее: Доказано для openCloseExit.

## Аудит темпа, завязанного на timer (БЕЗ исправления)

Тик порта = 2 кадра, timer +1 за тик (runGame). «Компенсировано» — уже учтено в коде.

| Процедура (строка в kvalley_game.asm) | Что делает | Статус / гипотеза | Как проверить по Z80 |
|---|---|---|---|
| protaGiratoria (раунд 1) | шаг двери героя | Компенсировано (раунд 1), Доказано | door_pass.js |
| spiningDoors3 (6488) | кадр вращения двери | Компенсировано (раунд 2), Доказано | door_pass.js |
| openCloseExit (5787) | and 0x1F: шаг анимации двери-выхода | Вдвое медленнее. Доказано замером выше | timer_audit_exit.js |
| chkNextTrampa (6153) | and 0x1F: стена-ловушка опускается на 4 px | Гипотеза: вдвое медленнее (32 тика = 64 кадра против 32) | поставить muroTrampaDat статус 1, замерить кадры между шагами Y |
| entraSale (7658) | and 1: шаг героя по лестнице входа | Компенсировано (комментарий и mask 1 вместо 3) | не проверялось |
| protaEscaleras, andaEscalera (2578, 9718) | маска лестницы героя | Компенсировано (b=0 у игрока, 1 у демо) | не проверялось |
| momiaEscaleras, pausaEscalera (8505, 8559: 3,0,1,0) | маска лестницы мумии (and b по timer) | Гипотеза: вдвое медленнее (маска 3 даёт шаг раз в 4 тика = 8 кадров против 4; герою маску убрали, мумиям нет) | поставить мумию типа 0 на лестницу, замерить X/Y за N кадров |
| momiaAnda2 (8055) | and 0x0F: уменьшение времени ходьбы мумии | Гипотеза: ходит вдвое дольше по кадрам (16 тиков = 32 кадра), при компенсированной скорости пути | длительность ходьбы мумии до смены состояния при одинаковом seed |
| momiaDecStress (8138) | and 0x1F: убывание стресса мумии | Гипотеза: вдвое медленнее | счётчик стресса за N кадров |
| поза «думает» мумии (8768) | and 0x1F: 32 кадра в позе, счётчик взглядов | Гипотеза: вдвое длиннее | кадры до смены позы |
| knifeRebota, knifeCae (4104, 4180) | and 3: координаты ножа раз в 4 кадра при отскоке и падении | Гипотеза: раз в 8 кадров (вдвое медленнее); полёт вперёд компенсирован (db 4, 2 px/тик) | бросить нож в стену / с края, замерить кадры до касания пола |
| updateKnifeAtt (4304) | and 0x0C: кадр вращения ножа | Гипотеза: вращение вдвое медленнее | число смен спрайта за N кадров |
| tickPergamino (10213) | and 7: цвет стрелки на карте | Гипотеза: цикл вдвое медленнее (чисто визуально) | период смены цвета |
| momiaLimbo (8573), cayendo (9702), прыжок (9799), momiaAparece | задержка появления, падение, прыжок, облако | Компенсировано (комментарии в коде) | не проверялось |
| tickGameOver (646) | and 1: одна итерация из двух | Не проверено; в оригинале это 50 Гц, порт на 25 Гц: гипотеза вдвое медленнее | длительность паузы Game Over |
| decrementы waitCounter, accionWaitCnt (бросок ножа, копание), agujeroCnt | счётчики по тику | Гипотеза: длительность в кадрах вдвое больше оригинала там, где счётчик уменьшается каждый тик без компенсации (не обходилось построчно) | время броска ножа/копания в кадрах |
`;
fs.writeFileSync(O + "/REPORT_ROUND2.md", md);
console.log("ok");
