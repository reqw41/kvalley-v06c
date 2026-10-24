// door_wall_report3.js — раунд 3: results.json (раздел round3) и REPORT_ROUND3.md. Числа берутся из outputs/door-wall/round3/data.
"use strict";
const fs = require("fs"), cp = require("child_process"), path = require("path");
const O = path.join(__dirname, "../../outputs/door-wall"), R = O + "/round3", Dd = R + "/data";
const J = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => cp.execSync("shasum " + f).toString().split(" ")[0];
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const diffs = log => { const d = []; for (let i = 1; i < log.length; i++) d.push(log[i][0] - log[i - 1][0]); return d; };
const step = (log, v) => log.filter((e, i) => i === 0 || e[1] !== log[i - 1][1]);
const ld = (k, s) => J(`${Dd}/${k}_${s}.json`);
const M = {};
// каждый показатель: функция от данных сценария -> число
const defs = {
  trap: { name: "chkNextTrampa: шаг стены-ловушки на 4 px, кадров", f: d => med(diffs(d.trapY.slice(1))) },
  mwalkT: { name: "momiaAnda2: уменьшение времени ходьбы, кадров на шаг", f: d => med(diffs(d.timer.slice(1, 5))), s: "mwalk" },
  mwalkS: { name: "momiaDecStress: уменьшение стресса, кадров на шаг", f: d => med(diffs(d.stress.slice(1, 3))), s: "mwalk" },
  mthink: { name: "поза «думает» мумии: кадров на шаг счётчика", f: d => med(diffs(d.timer.slice(0, 5))), s: "mthink" },
  kBounce: { name: "knifeRebota: длительность отскока ножа (состояние 7), кадров", f: d => { const a = d.knife.find(e => e[1].startsWith("7")), b = d.knife.find(e => e[1].startsWith("8")); return b[0] - a[0]; }, s: "knife" },
  kFall: { name: "knifeCae: падение ножа (состояние 8), кадров", f: d => { const a = d.knife.find(e => e[1].startsWith("8")), b = d.knife.find(e => e[1].startsWith("0")); return b[0] - a[0]; }, s: "knife" },
  kSpr: { name: "updateKnifeAtt: смена кадра вращения ножа, кадров", f: d => med(diffs(d.spr.slice(2, 9))), s: "knife" },
  kThrow: { name: "бросок ножа (accionWaitCnt), кадров до конца статуса 4 после начала лога", f: d => d.hero[1][0], s: "knife" },
  dig: { name: "копание кирки (agujeroCnt), кадров статуса 5", f: d => d.hero[1][0], s: "dig" },
  go: { name: "tickGameOver: длительность экрана Game Over (GS 7), кадров", f: d => { const a = d.gs.find(e => e[1] === 1792), b = d.gs.find((e, i) => e[0] > a[0] && e[1] < 256); return b[0] - a[0]; }, s: "gameover" },
  exit: { name: "openCloseExit: открытие двери-выхода, кадров (фазы 1-3)", f: d => med(d.slice(0, 3).map(x => x[1][0])), s: "exit" },
};
for (const k in defs) { const s = defs[k].s || k; M[k] = { name: defs[k].name, z80: defs[k].f(ld("z80", s)), was: defs[k].f(ld("was", s)), now: defs[k].f(ld("now", s)) }; }
const lo = ["demo", "tour1", "tour2", "tour3", "stress", "stage"].map(n => ({ scen: n, ...JSON.parse(fs.readFileSync(`${R}/lo_${n}.log`, "utf8").trim().split("\n").pop()) }));
const door = fs.existsSync(Dd + "/cmp_door_final.json") ? J(Dd + "/cmp_door_final.json") : null;
const results = J(O + "/results.json");
results.round3 = { rom: { sha1: sha(R + "/rom/kvalley_8c.rom"), sym_sha1: sha(R + "/rom/kvalley_8c.sym"), splash_sha1: sha(R + "/rom/kvalley_splash.rom") },
  items: M, lo_align: lo.map(r => ({ scen: r.scen, equal: r.equal, ticks: r.ticks, first: r.first })), door_final: door, snd_tempo: { frames_without_tick_pct: { base_cf63463: 14.6, cost_only_variant: 12.8, now: 16.7 }, limit_pct: 15 }, code: { free_before: 148, free_after: +fs.readFileSync(R + "/free.txt", "utf8").trim() } };
fs.writeFileSync(O + "/results.json", JSON.stringify(results, null, 1));
const x = results.round3, c = x.code, net = c.free_before - c.free_after;
const ok = (z, n) => z && Math.abs(n - z) / z <= 0.35;
const st = k => ok(M[k].z80, M[k].now) ? (ok(M[k].z80, M[k].was) ? "доказано без расхождения" : "исправлено") : "ПРОВЕРИТЬ";
const rows = Object.keys(M).map(k => `| ${M[k].name} | ${M[k].z80} | ${M[k].was} | ${M[k].now} | ${st(k)} |`).join("\n");
const loRows = x.lo_align.map(r => `| ${r.scen} | ${r.ticks[0]} | ${r.equal ? "equal" : "расхождение: " + JSON.stringify(r.first).slice(0, 220)} |`).join("\n");
const md = `# door-wall, раунд 3: темп по timer — замер против Z80 и правка

Основа cf63463. Деплоя, push и MiSTer нет. Числа подставлены tools/verify/door_wall_report3.js из results.json (раздел round3).

## Доказано

Стенд tools/verify/timer_audit.js (Z80 в WebMSX и сборка; время в кадрах 50 Гц: у Z80 один runFrames = +1 timer). Допуск «в пределах» 35%: тик порта растягивается до 2.1-2.3 кадра, поэтому интервалы порта шумят на 10-20%. Мумия, нож и стена поставлены записью в память; остальные мумии убраны; сравниваются длительности и интервалы, не траектории ИИ.

| Показатель | Z80 | Было (cf63463) | Стало | Статус |
|---|---|---|---|---|
${rows}

Правка: маска \`timer&N\` у игрока делится на два (tmrAnd, tmrSpr, goGate в vec_jumpmid.asm), в демо (controlPlayer бит 6 = 0) прежняя. Состояния героя 4 (бросок ножа) и 5 (копание) исполняются у игрока дважды за тик (protaLanza2, protaPica2): их счётчики оригинал уменьшает по кадру. Места: openCloseExit, chkNextTrampa, momiaAnda2, momiaDecStress, поза «думает», knifeRebota, knifeCae, updateKnifeAtt, tickGameOver, protaLanzaKnife, protaPicando. Размер: свободно ${c.free_before} -> ${c.free_after} Б (${net} Б).

### Проверки

${door ? `- door_pass против Z80 на финальной сборке: ${door.allEqual}/${door.n} запусков в допуске, вращение двери ${door.spinPort[0]}..${door.spinPort[door.spinPort.length - 1]} тиков.` : "- door_pass: нет данных"}
- lo_align против cf63463:

| Сценарий | Тиков | Результат |
|---|---|---|
${loRows}

Расхождение lo_align ожидаемо: сценарии tour/stress/stage заходят в исправленные ветки мумий. Первое расхождение везде — поле ACTOR_TIMER (смещение +17) записи мумии (momiaDat+17 слот 0, momiaDat+39 слот 1): stress на тике ${x.lo_align.find(r => r.scen === "stress").first.tick} (3 -> 2), tour1-3 и stage на тике ${x.lo_align.find(r => r.scen === "stage").first.tick} (5 -> 4). Это счётчик, который уменьшают momiaAnda2 (ходьба) и поза «думает»; на других полях и до этого тика сценарии равны. demo равен на всех ${x.lo_align.find(r => r.scen === "demo").ticks[0]} тиках (кадров 8905 -> 8913: вызовы tmrAnd в демо добавляют такты).

### Гейты

Вывод run_gates.sh целиком в outputs/door-wall/round3/gates.log; сравнение с раундом 2 (round2/gates.log):
- snd_tempo: БЫЛ зелёный, СТАЛ красный: «нагруженный кадр (бросок ножа при мумиях)» ${x.snd_tempo.frames_without_tick_pct.now}% кадров без тика музыки при пороге ${x.snd_tempo.limit_pct}% (было ${x.snd_tempo.frames_without_tick_pct.base_cf63463}%). Это не стоимость кода: контрольная сборка с теми же вставками, но без смены поведения (маски не делятся, двойного вызова нет), даёт ${x.snd_tempo.frames_without_tick_pct.cost_only_variant}%. Гейт считает кадры сцены «нож в полёте + мумии» (692 -> 777 кадров), а состав сцены изменился вместе с темпом ножа и мумий; доля кадров без тика гуляет в 12.8-16.7% от состава сцены. Подгонять порог или код не стал: гейт требует решения владельца (эталон сцены под новый темп).
- spr_resid_gate, knife_purity, bonus_ending_gate: красные, как на базе (spr_resid на 9000 кадров, FAIL как раньше).
- Остальные: зелёные; числа в spr_resid, mum_wall_step, atomic_gate, top_border_gate, hud_junk_gate сдвинулись на состав сцены, вердикты те же.
- cheat_entry_gate со splash: PASS. jingle_tempo_gate, knife-/momia-гейты (momia_hidden, mummy_contact_probe, two_mum_jump_resid): как раньше.

## Не исправлялось (гипотезы, оценка, не замер)

- momiaEscaleras / pausaEscalera (маска лестницы мумии 3,0,1,0 против timer): по коду вдвое медленнее; сцену «мумия на лестнице» в Z80 строго поставить не удалось (перебор позиций вокруг тайлов лестниц комнаты 1: мумия сразу покидает состояние 3), поэтому не правлено. Как проверить: поймать мумию типа 0 на лестнице естественной игрой и сравнить кадры на шаг.
- waitCounter (паузы старта партии, выход из пирамиды): замер последовательности GS при смерти показал фазы старта партии длиннее у порта (Z80 59/15/40 кадров против порта 171/31/82 для подстатусов 0x400, 0x401, 0x403), но смешано со временем загрузки/отрисовки; причина по счётчикам не разделена, не правлено.
- tickPergamino (\`timer&7\`, цвет стрелки на карте): цикл по коду вдвое медленнее; на Z80 цвет меняется только на карте после выхода из пирамиды, этот поток строго не воспроизведён; шаг по всем 8 цветам за 2 кадра на тике 25 Гц недостижим, так что правка была бы приближением; не правлено.
- Рассогласование «игра внутри тика» (тик порта 2.1-2.3 кадра, а не 2) даёт 10-20% по всем длительностям; это не темп по timer.
`;
fs.writeFileSync(O + "/REPORT_ROUND3.md", md);
console.log(JSON.stringify(M));
