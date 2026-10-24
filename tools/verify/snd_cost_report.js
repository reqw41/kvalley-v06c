#!/usr/bin/env node
"use strict";
// snd_cost_report.js — outputs/sound-cost/REPORT.md целиком из results.json. Числа руками не вписываются.
const fs = require("fs"), path = require("path");
const OUT = path.resolve(__dirname, "../../outputs/sound-cost");
const R = JSON.parse(fs.readFileSync(path.join(OUT, "results.json")));

const n0 = (v) => (v === null || v === undefined || Number.isNaN(v) ? "н/д" : String(Math.round(v)));
const n1 = (v) => (v === null || v === undefined || Number.isNaN(v) ? "н/д" : v.toFixed(1));
const n2 = (v) => (v === null || v === undefined || Number.isNaN(v) ? "н/д" : v.toFixed(2));
const n3 = (v) => (v === null || v === undefined || Number.isNaN(v) ? "н/д" : v.toFixed(3));
const pc = (v) => (v === null || v === undefined || Number.isNaN(v) ? "н/д" : (100 * v).toFixed(1) + "%");
const q4d = (x) => `${n2(x.mean)} / ${n0(x.median)} / ${n0(x.p90)} / ${n0(x.max)}`;
const q4 = (x) => `${n0(x.mean)} / ${n0(x.median)} / ${n0(x.p90)} / ${n0(x.max)}`;
const md = (head, rows) => `| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}\n`;
const A = R.partA, C = R.partC, P = C.player, S = C.stream, REF = R.refs;
const SC = { stress: "стресс (120 тиков)", natural: "обычный прогон (2600 тиков)", effects_knife: "эпизод: бросок ножа ×3", effects_gem: "эпизод: подбор гема ×4", effects_death: "эпизод: смерть героя", scroll: "скролл между комнатами", idle_m0: "герой стоит, режим 0 (музыка+эффекты)", idle_m2: "герой стоит, режим 2 (тишина)" };
const CATRU = {
  clk_entry: "вход: call в тик + обвязка ISR (vec_sndb, vsnd_acc)", clk_gate: "часы: vsnd_tick*, накопитель vtm_acc, vst_*", clk_delta: "часы: vtm_read/vtm_delta (опрос ВИ53)", clk_lease: "часы: аренда канала C (vtm_start/arm/grab)",
  drv_parse: "драйвер: разбор нотных данных", drv_env: "драйвер: огибающие громкости", drv_fx: "драйвер: эффект падения (updateSfxCaer)", drv_other: "драйвер: прочее (цикл каналов, микшер, счёт длительности, вспомогательные)", drv_start: "драйвер: запуск звука (setMusic)",
  ov_shadow: "оверлей: запись в тень vec_ayregs + вход/выход", ov_modechk: "оверлей: проверки vec_snd_mode",
  out_ay: "вывод AY: порты 0x14/0x15", out_route: "вывод ВИ53: маршрутизация регистра в канал (vwp_vi_chip..)", out_vich: "вывод ВИ53: vec_vi_ch (порты 0x08–0x0B)", out_ay2vi: "вывод ВИ53: vec_ay2vi (пересчёт периода)", out_svc: "служебный вывод (apply/hush)",
};
const SECRU = { s1_clock: "1. Вход и часы", s2_driver: "2. Драйвер Konami (без WRTPSG)", s3_overlay: "3. Оверлей: тень и проверки режима", s4_output: "4. Вывод в чип" };
const CATSEC = { s1_clock: ["clk_entry", "clk_gate", "clk_delta", "clk_lease"], s2_driver: ["drv_parse", "drv_env", "drv_fx", "drv_other", "drv_start"], s3_overlay: ["ov_shadow", "ov_modechk"], s4_output: ["out_ay", "out_route", "out_vich", "out_ay2vi", "out_svc"] };

let o = "";
const L = (s = "") => { o += s + "\n"; };

// ----------------------------------------------------------------------------------------------
function cmpTable(scene, unit, key, title) {
  // key: frame | step | frame_gs5 | step_gs5
  const a = A.ay[scene][key], v = A.vi[scene][key];
  if (!a || !a.n) return;
  const rows = [];
  for (const [sk, names] of Object.entries(CATSEC)) {
    for (const c of names) { const x = a.cats[c], y = v.cats[c]; if (x.max === 0 && y.max === 0) continue; rows.push([`  ${CATRU[c]}`, q4(x), q4(y)]); }
    rows.push([`**${SECRU[sk]}**`, `**${q4(a.sections[sk])}**`, `**${q4(v.sections[sk])}**`]);
  }
  rows.push(["**ВСЕГО звук**", `**${q4(a.total)}**`, `**${q4(v.total)}**`]);
  L(`#### ${title}: ${SC[scene]}, ${unit} (n AY=${a.n}, ВИ53=${v.n})`);
  L(`Формат ячеек: среднее / медиана / p90 / максимум, такты.`);
  L();
  L(md(["Участок", "AY", "ВИ53"], rows));
}

// ----------------------------------------------------------------------------------------------
L(`# Цена звука на Векторе-06Ц: AY и ВИ53 (King's Valley, ветка 3p)`);
L();
L(`ROM (замороженная копия \`${R.rom.path}\`): SHA256 \`${R.rom.sha256}\` — ${R.rom.matches_expected ? "совпадает с заданным" : "**НЕ совпадает с заданным " + R.rom.expected_sha256 + "**"}. SYM SHA256 \`${R.rom.sym_sha256}\`.`);
L(`Источник \`outputs/stage-sched-nested/kvalley_8c.rom\` на момент сборки отчёта: ${R.rom.source_sha256_now === R.rom.sha256 ? "тот же" : "ИЗМЕНИЛСЯ (" + R.rom.source_sha256_now + ")"}; \`build/kvalley_8c.rom\`: ${R.rom.build_rom_sha256_now === R.rom.sha256 ? "тот же" : "другой (" + R.rom.build_rom_sha256_now + ")"}. Измерения шли по копии.`);
L();
L(`Воспроизведение одной командой (из корня worktree): \`node tools/verify/snd_cost_run_all.js\` (≈4 минуты). Отчёт целиком создаёт \`node tools/verify/snd_cost_report.js\` из \`outputs/sound-cost/results.json\`.`);
L();

// ----------------------------------------------------------------------------------------------
L(`## Итог в одну строку на режим чипа`);
L();
{
  const nat = (cn) => A[cn].natural, pl = P.natural;
  for (const [cn, nm] of [["ay", "AY"], ["vi", "ВИ53"]]) {
    const d = nat(cn), st = d.step, s1 = d.step.sections.s1_clock.mean, s234 = ["s2_driver", "s3_overlay", "s4_output"].reduce((s, k) => s + d.step.sections[k].mean, 0);
    const waste = cn === "ay" ? d.partB.step.wr_same_cyc.mean : d.partB.step.waste_cyc.mean;
    const player = pl[cn].step_cost.mean;
    L(`- **${nm}**: звук сейчас стоит **${n0(st.total.mean)} тактов на логический шаг** (обычный прогон, среднее; медиана ${n0(st.total.median)}, p90 ${n0(st.total.p90)}), из них часы и вход ${n0(s1)}, драйвер+оверлей+вывод ${n0(s234)}; **лишняя работа ${n0(waste)} тактов на шаг** (${pc(waste / st.total.mean)} от цены звука; определение — в части Б); проигрыватель событий (оценка по измеренным тактам команд, не реализация) стоил бы **${n0(player)} тактов на шаг** вместо ${n0(s234)} (часы остаются: итого ${n0(s1 + player)}).`);
  }
  L();
  L(`Стресс (120 тиков): AY ${n0(A.ay.stress.step.total.mean)}, ВИ53 ${n0(A.vi.stress.step.total.mean)} тактов звука на шаг (шаг стресса — ${n2(A.ay.stress.frames_per_step.mean)} кадра, ${n2(A.ay.stress.ticks.per_step.mean)} тика).`);
}
L();

// ----------------------------------------------------------------------------------------------
L(`# Доказано`);
L();
L(`Всё в этом разделе измерено на эмуляторе vector06js (\`${R.emulator.base}\`, i8080.js SHA256 \`${R.emulator.i8080_sha256}\`, tv.js \`${R.emulator.tv_sha256}\`), либо прочитано из исходников/листинга. Игра не менялась.`);
L();
L(`## 1. Как поставлен замер`);
L();
L(`- **Режим чипа.** Оверлей грузится на старте проверкой AY в \`vec_boot.asm\` (${REF.boot_probe ? "строка " + REF.boot_probe : ""}): проба успешна -> \`vec_snd_chip=0\` (AY), иначе \`vec_no_ay\` (строка ${REF.boot_noay}) -> \`vec_snd_chip=1\` (ВИ53); затем копия оверлея в дырку WRTPSG (\`vec_ov_cp\`, строка ${REF.boot_overlay}). В эмуляторе проба находит AY — режим AY получается штатно. Для режима ВИ53 в образе **в памяти** (файл ROM не меняется) три первых байта \`vec_ay_ok\` заменены на \`jp vec_no_ay\` — то есть эмулируется машина без AY, дальше всё штатно, включая копию оверлея ВИ53 и подмену \`SFX_Picar\` на \`vpic_tone\`.`);
{
  const rows = [];
  for (const cn of ["ay", "vi"]) { const c = A[cn].natural.chip_check; rows.push([cn === "ay" ? "AY" : "ВИ53", c.vec_snd_chip, c.vec_snd_mode, c.wrtpsg_bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")]); }
  L(`- **Подтверждение чтением** (после прогона обычной сцены): `);
  L();
  L(md(["Режим", "vec_snd_chip", "vec_snd_mode", "байты по адресу WRTPSG (+0..+5)"], rows));
  L(`  \`c3 f5 44\` = \`jp vwp_*\` (0x44F5), следующие три байта — \`jp vec_snd_apply\` в оверлее: у AY \`2c 45\` (vsa_ay = 0x452C), у ВИ53 \`f7 45\` (vsa_vi = 0x45F7). Это разные оверлеи.`);
}
L(`- **Сцены.** «стресс» — \`perf_baseline_1205.js --scene repro\` (120 тиков), «обычный прогон» — \`--scene natural\` (2600 тиков; в нём ${n0(A.ay.natural.n_frames_gs5)} кадров GS=5 из ${n0(A.ay.natural.n_frames)}, остальное — титул/вход/смерть), оба загружаются в памяти без правок. Эпизоды — свои сцены \`snd_cost_scenes.js\`: бросок ножа (в руку пишется \`objetoCogido=0x10\` на границе тика, FIRE жмётся, звук запускает сама игра), подбор гема (герой переставляется записью ProtaX/Y/Room на координаты гема из \`datosGemas\`, подбор и звук делает \`chkCogeGema\`), смерть героя (герой стоит, мумия подходит и убивает сама), скролл (ProtaX=240/10 + удержание ←/→, переход делает игра, GS=9). \`setMusic\` стенд не зовёт нигде.`);
L(`- **Единицы.** Такты ЦП = \`cpu.vcycles\` после каждой инструкции; +16 тактов на приём прерывания (DI+RST7, не звук). «Кадр» — один вызов \`oneInterrupt\` (59904 такта), «шаг» — интервал между двумя записями \`tickInProgress: 0->1\`.`);
L(`- **Атрибуция.** Каждая инструкция относится ровно к одному участку: контекст звука открывается на входе (\`vsnd_tick_clk/hdr/coop/tick\`, \`updateSound\`, \`setMusic\`/\`SetMusic_\`, \`vec_snd_apply/hush\`) и закрывается по паре (PC возврата, SP) на глубине того же ISR; внутри контекста участок определяется диапазоном PC из .sym (оверлей — из собранного \`build/snd_ov_*.sym\`, побайтно совпавшего с образом в ROM; граница «проверки режима» — первая \`ld a,(vec_snd_mode)\` в оверлее). Вызовы \`call\` в точки входа и обвязка ISR (\`vec_sndb\` push/pop, \`vsnd_acc\`) — участок «вход». WRTPSG, вызванный вне звука (\`ReadKeys\` пишет в регистр 15, строка ${REF.game_readkeys_wrtpsg}), в звук **не** входит и показан отдельно (\`ext_overlay\`).`);
L();
L(md(["Участок", "Что входит (метки)"], [
  ["1. Вход и часы", "call в тик и обвязка ISR; vsnd_tick_clk/hdr/coop/tick, vst_hw/vst_frame, vtm_hold/alive (накопитель); vtm_read, vtm_delta; vtm_start/arm/off/grab (аренда канала C)"],
  ["2. Драйвер Konami", "разбор: patternLoop, nextNote..loc_7C2D, setNote..setFreq, incMusicPoint, musicStorePtr; огибающие: loc_7C2D, loc_7C47, decVolume, setVolume; эффект падения: updateSfxCaer..initCaeSndDat; запуск: setMusic, SetMusic_, setChanData; прочее: switchCh3OnOff, SetPSGMixer, updateSound, updateSound2, голова processSndData, вспомогательные процедуры (ADD_A_HL, vec_ldir_bwd)"],
  ["3. Оверлей", "вход WRTPSG (jp), push/pop, расчёт адреса тени и запись \`ld (hl),e\` в vec_ayregs, выход (ret) — «тень»; \`ld a,(vec_snd_mode)\`..до \`vwp_*_out\`/\`vwp_vi_chip\` — «проверки режима»"],
  ["4. Вывод в чип", "AY: vwp_ay_out..vwp_ay_done (pop/push, out 0x15, out 0x14). ВИ53: vwp_vi_chip..vwp_vi_done (маршрутизация регистра в канал), vec_vi_ch (порты 0x08–0x0B), vec_ay2vi; apply/hush"],
]));
L();
L(`**Замыкание** (сумма участков против независимого счёта; допуск ≤ 0,5%):`);
L();
{
  const rows = [];
  let worst = 0;
  for (const cn of ["ay", "vi"]) for (const sc of Object.keys(SC)) {
    const c = A[cn][sc].closure;
    const e = Math.max(Math.abs(c.sections_vs_ctx_pct), Math.abs(c.pcrange_vs_ctx_pct), Math.abs(c.frame_rel_err_pct), Math.abs(c.steps_vs_frames_pct));
    worst = Math.max(worst, e);
    rows.push([cn === "ay" ? "AY" : "ВИ53", SC[sc], n0(c.sections_sum_cycles), `${n3(c.sections_vs_ctx_pct)}%`, `${n3(c.pcrange_vs_ctx_pct)}%`, `${n3(c.frame_rel_err_pct)}%`, `${n3(c.steps_vs_frames_pct)}%`, `${Object.keys(c.orphan_pcs).length}`]);
  }
  L(md(["Чип", "Сцена", "Σ участков, такты", "Σ участков vs счёт по контексту (CALL/RET)", "счёт по диапазону PC vs по контексту", "Σ тактов кадров vs 59904×кадры", "Σ по шагам vs Σ по кадрам", "PC звука вне контекста"], rows));
  L(`Максимальное расхождение по всем сравнениям: **${n3(worst)}%** (допуск 0,5%) — ${worst <= 0.5 ? "замыкание выполнено в обоих режимах чипа" : "**ДОПУСК НАРУШЕН**"}. Первые два сравнения — две реализации одного счёта (по контексту вызовов и по диапазону PC с поправкой на вспомогательные процедуры драйвера вне диапазонов, ReadKeys и вход/обвязку); третье — независимое: сумма всех тактов инструкций + 16×приёмов прерывания равна длине кадра.`);
}
L();

// ---------- Часть A
L(`## 2. Часть А: цена звука по участкам`);
L();
L(`### 2.1 Главная таблица: AY против ВИ53 по участкам`);
L();
cmpTable("natural", "на видеокадр, весь прогон", "frame", "Таблица А1");
cmpTable("natural", "на видеокадр, только геймплей GS=5", "frame_gs5", "Таблица А2");
cmpTable("natural", "на логический шаг, весь прогон", "step", "Таблица А3");
cmpTable("natural", "на логический шаг, только геймплей GS=5", "step_gs5", "Таблица А4");
cmpTable("stress", "на видеокадр", "frame", "Таблица А5");
cmpTable("stress", "на логический шаг", "step", "Таблица А6");
L(`### 2.2 Остальные сцены`);
L();
for (const sc of ["effects_knife", "effects_gem", "effects_death", "scroll", "idle_m0"]) {
  cmpTable(sc, "на видеокадр", "frame", "Таблица");
  cmpTable(sc, "на логический шаг", "step", "Таблица");
}
L(`### 2.3 Режим «тишина» (vec_snd_mode=2) для сравнения`);
L();
{
  const rows = [];
  for (const cn of ["ay", "vi"]) for (const sc of ["idle_m0", "idle_m2"]) { const d = A[cn][sc]; rows.push([cn === "ay" ? "AY" : "ВИ53", sc === "idle_m0" ? "0: музыка+эффекты" : "2: тишина", q4(d.frame.total), q4(d.step.total), n3(d.ticks.per_frame_mean)]); }
  L(md(["Чип", "Режим", "Звук на кадр (ср/мед/p90/макс)", "Звук на шаг", "тиков на кадр"], rows));
  L(`Режим 2 ставится как в игре (запись \`vec_snd_mode\` + \`vec_snd_apply\`); драйвер Konami продолжает работать (гасится только вывод в оверлее), поэтому цена тишины — не ноль.`);
}
L();
L(`### 2.4 Музыкальные тики`);
L();
{
  const rows = [];
  for (const cn of ["ay", "vi"]) for (const sc of Object.keys(SC)) {
    const t = A[cn][sc].ticks, nF = A[cn][sc].n_frames, bd = t.by_depth, tot = bd[0] + bd[1] + bd[2];
    rows.push([cn === "ay" ? "AY" : "ВИ53", SC[sc], n3(t.per_frame_mean), pc(t.zero_frac), pc(t.double_frac), `${n3(t.gs5.per_frame_mean)} / ${pc(t.gs5.zero_frac)} / ${pc(t.gs5.double_frac)}`, `${pc(bd[0] / tot)} / ${pc(bd[1] / tot)} / ${pc(bd[2] / tot)}`, Object.entries(t.by_entry).map(([k, v]) => `${k.replace("vsnd_tick_", "")}:${v}`).join(" ")]);
  }
  L(md(["Чип", "Сцена", "тиков на кадр", "кадров без тика", "кадров с ≥2 тиками", "GS=5: тиков/кадр / без / ≥2", "тики: глубина 0 / внешний ISR / вложенный ISR", "кто вызвал (число)"], rows));
  L(`Тик считается по входу в \`updateSound\`. Глубина — число вложенных приёмов прерывания на момент входа.`);
}
L();
L(`### 2.5 Где исполняется звук: внешний ISR и вложенный`);
L();
{
  const rows = [];
  for (const cn of ["ay", "vi"]) for (const sc of Object.keys(SC)) {
    const d = A[cn][sc], ds = d.depth_share, tot = ds.total_per_frame;
    rows.push([cn === "ay" ? "AY" : "ВИ53", SC[sc], n0(tot), `${n0(ds.main_depth0)} (${pc(ds.main_depth0 / tot)})`, `${n0(ds.outer_isr)} (${pc(ds.outer_isr / tot)})`, `${n0(ds.nested_isr)} (${pc(ds.nested_isr / tot)})`, q4(d.depth_frame_q.outer), q4(d.depth_frame_q.nested)]);
  }
  L(md(["Чип", "Сцена", "звук на кадр, ср.", "вне ISR (кооп-тики)", "внешний ISR", "вложенный ISR", "внешний: ср/мед/p90/макс", "вложенный: ср/мед/p90/макс"], rows));
}
L();
L(`### 2.6 Сверка с прошлыми отчётами`);
L();
{
  const a = A.ay.natural, v = A.vi.natural, s = A.ay.stress, sv = A.vi.stress;
  const nestTicksStep = (d) => d.ticks.by_depth[2] / d.n_steps, outerTicksStep = (d) => d.ticks.by_depth[1] / d.n_steps;
  const perTick = (d, k) => d[k].total.mean / d.ticks.per_step.mean;
  L(`- Комментарий в \`vec_isr.asm\` (метка \`vsnd_tick_hdr\`, строка ${REF.isr_tick_hdr}): «updateSound в шапке в среднем ~3000 тактов, p90 6500». Здесь: AY, обычный прогон, звук на кадр — среднее ${n0(a.frame.total.mean)}, p90 ${n0(a.frame.total.p90)}; ВИ53 — ${n0(v.frame.total.mean)} / ${n0(v.frame.total.p90)}. Порядок величин совпал для AY; цена одного тика в стрессе: AY ${n0(perTick(s, "step"))} тактов на тик (звук на шаг ÷ тиков на шаг), ВИ53 ${n0(perTick(sv, "step"))}.`);
  L(`- \`docs/tick_breakdown/REPORT.md\`, статья «5б. Вложенный ISR: звук» в стрессе: 3401 такт на шаг (среднее; медиана 3084; p90 5520) — это сборка 2709-1721-M (ROM \`96b294…\`), не нынешняя. Здесь, на замороженной сборке stage-sched-nested, в стрессе: ${n2(nestTicksStep(s))} вложенных и ${n2(outerTicksStep(s))} внешних тиков на шаг (AY), вложенный ISR даёт ${n0(s.depth_share.nested_isr * s.frames_per_step.mean)} тактов звука на шаг при ${n2(s.frames_per_step.mean)} кадра на шаг. 3401 ≈ цена **одного** тика (${n0(perTick(s, "step"))} у AY) — старая цифра, очевидно, соответствует примерно одному вложенному тику на шаг; у нынешней сборки шаг длиннее и вложенных тиков больше (${n2(nestTicksStep(s))}).`);
  L(`- Расхождения объясняются (а) другой сборкой и длиной шага, (б) разным определением шага (там — внешний ISR с логикой, здесь — интервал между стартами \`tickInProgress\`), (в) тем, что здесь учтены обвязка ISR и часы (участок 1), а в старой статье часть шла в «диспетчеризацию». Гипотезу (а) я проверил только косвенно (по числу тиков на шаг); старую сборку не прогонял.`);
}
L();

// ---------- Часть Б
L(`## 3. Часть Б: лишняя работа`);
L();
L(`Определения: **WRTPSG-вызов** — от входа в \`WRTPSG\` до возврата (оверлей целиком, включая вывод и аренду канала). **Тот же в тени** — записываемое значение равно байту \`vec_ayregs[reg]\` до записи. **Нет эффекта на чип (ВИ53)** — все \`vec_vi_ch\`, вызванные этим WRTPSG, оставили модель канала (режим, включён ли, делитель — по реальным записям в порты) без изменений, либо \`vec_vi_ch\` не вызывался вовсе (регистры 6, ≥11, фильтр режима). **Пара hi/lo** — запись старшего байта периода (регистр 1/3/5), за которой сразу следует запись младшего (регистр−1) того же голоса: первый вызов пересчитывает ноту по наполовину новому периоду и тут же перекрывается вторым.`);
L();
function bTable(scene, key, unit) {
  const rows = [];
  const a = A.ay[scene].partB, v = A.vi[scene].partB;
  const g = (B, name) => (key === "frame" ? B[name] : (B.step && B.step[name]));
  const row = (name, ay, vi) => { const f = /\(штук\)/.test(name) ? q4d : q4; rows.push([name, ay ? f(ay) : "—", vi ? f(vi) : "—"]); };
  row("WRTPSG-вызовов звука (штук)", g(a, "wr_calls"), g(v, "wr_calls"));
  if (key === "frame") { row("  тактов на все WRTPSG-вызовы звука", a.wr_cyc, v.wr_cyc); }
  else row("  тактов на все WRTPSG-вызовы звука", a.step.wr_cyc, v.step.wr_cyc);
  if (key === "frame") row("записей «то же в тени» (штук)", a.wr_same, v.wr_same);
  row("**записи «то же в тени»: такты**", g(a, "wr_same_cyc"), g(v, "wr_same_cyc"));
  row("**проверки vec_snd_mode в оверлее: такты**", g(a, "modechk_cyc"), g(v, "modechk_cyc"));
  row("огибающие громкости в драйвере (участок drv_env): такты", g(a, "env_driver_cyc"), g(v, "env_driver_cyc"));
  if (key === "frame") {
    row("ВИ53: вызовов vec_vi_ch (штук)", null, v.vich_calls); row("ВИ53: из них тот же делитель и то же состояние канала (штук)", null, v.vich_same);
    row("ВИ53: такты вызовов vec_vi_ch всего", null, v.vich_cyc);
  } else row("ВИ53: вызовов vec_vi_ch (штук)", null, v.step.vich_calls);
  row("**ВИ53: такты vec_vi_ch с тем же делителем и состоянием**", null, g(v, "vich_same_cyc"));
  row("**ВИ53: такты WRTPSG-вызовов без эффекта на чип**", null, g(v, "noeff_cyc"));
  row("**ВИ53: пары hi/lo, первый вызов с эффектом: такты**", null, g(v, "pair_eff_cyc"));
  row("ВИ53: пар hi/lo (штук)", null, g(v, "pair"));
  row("**ВИ53: всего лишней работы (без эффекта + первый вызов пары)**", null, g(v, "waste_cyc"));
  row("**ВИ53: записи громкости (рег. 8–10) без эффекта на чип: такты**", null, g(v, "vol_useless_cyc"));
  return md(["Показатель", "AY", "ВИ53"], rows);
}
L(`### 3.1 Обычный прогон, на видеокадр, весь прогон (ср/мед/p90/макс)`);
L(bTable("natural", "frame"));
L(`### 3.2 Обычный прогон, на логический шаг`);
L(bTable("natural", "step"));
L(`### 3.3 Стресс, на видеокадр`);
L(bTable("stress", "frame"));
L(`### 3.4 Стресс, на логический шаг`);
L(bTable("stress", "step"));
L(`### 3.5 Только геймплей GS=5 (обычный прогон), на видеокадр`);
{
  const a = A.ay.natural.partB.gs5, v = A.vi.natural.partB.gs5;
  L(md(["Показатель", "AY", "ВИ53"], [
    ["WRTPSG-вызовов звука (штук)", q4d(a.wr_calls), q4d(v.wr_calls)], ["записи «то же в тени»: такты", q4(a.wr_same_cyc), q4(v.wr_same_cyc)],
    ["проверки vec_snd_mode: такты", q4(a.modechk_cyc), q4(v.modechk_cyc)], ["ВИ53: vec_vi_ch тот же делитель/состояние: такты", "—", q4(v.vich_same_cyc)],
    ["ВИ53: WRTPSG без эффекта на чип: такты", "—", q4(v.noeff_cyc)], ["ВИ53: всего лишней работы: такты", "—", q4(v.waste_cyc)],
  ]));
}
L(`### 3.6 Число вызовов WRTPSG на кадр по номерам регистров (обычный прогон; среднее на кадр: все / «то же в тени» / такты всех / такты «то же»)`);
{
  const rows = [];
  const a = A.ay.natural.partB, v = A.vi.natural.partB;
  const nm = ["0 период A lo", "1 период A hi", "2 период B lo", "3 период B hi", "4 период C lo", "5 период C hi", "6 шум", "7 микшер", "8 громк. A", "9 громк. B", "10 громк. C", "11", "12", "13", "14", "15 (порт джойстика)"];
  for (let r = 0; r < 16; r++) {
    if (!a.wr_by_reg[r] && !v.wr_by_reg[r]) continue;
    rows.push([nm[r], `${n3(a.wr_by_reg[r])} / ${n3(a.wr_same_by_reg[r])} / ${n0(a.wr_cyc_by_reg[r])} / ${n0(a.wr_same_cyc_by_reg[r])}`, `${n3(v.wr_by_reg[r])} / ${n3(v.wr_same_by_reg[r])} / ${n0(v.wr_cyc_by_reg[r])} / ${n0(v.wr_same_cyc_by_reg[r])}`]);
  }
  L(md(["Регистр", "AY", "ВИ53"], rows));
  L(`Регистр 15 пишет не звук, а \`ReadKeys\` (строка ${REF.game_readkeys_wrtpsg}, выбор порта джойстика); в звук не входит: AY ${n2(a.wr_ext.mean)} вызова/кадр, ${n0(a.wr_ext_cyc.mean)} тактов; ВИ53 ${n2(v.wr_ext.mean)} вызова/кадр, ${n0(v.wr_ext_cyc.mean)} тактов (в таблице выше — только звук).`);
  const mix = { ay: a.wr_same_by_reg[7] / Math.max(a.wr_by_reg[7], 1e-9), vi: v.wr_same_by_reg[7] / Math.max(v.wr_by_reg[7], 1e-9) };
  L(`Запись микшера (рег. 7) идёт каждый тик из \`SetPSGMixer\` (строка ${REF.game_mixer}) и в ${pc(mix.ay)} случаев не меняет тень (AY), ${pc(mix.vi)} (ВИ53). В ВИ53 каждая такая запись в режиме 0 зовёт \`vec_vi_ch\` три раза подряд (\`vwp_vi_mix\`, строка ${REF.ovvi_mix}); среднее число вызовов vec_vi_ch на кадр ${n2(v.vich_calls.mean)}, из них без изменения состояния ${n2(v.vich_same.mean)} (${pc(v.vich_same.mean / v.vich_calls.mean)}).`);
}
L();

// ---------- Часть В
L(`## 4. Часть В: оценка проигрывателя готовых событий (без реализации)`);
L();
L(`### 4.1 Потоки событий`);
L();
L(`Метод. Каждый звук запускается штатным \`SetMusic_\` с тем значением A, с каким его зовёт игра (для музыки и эффектов включая флаговые биты 0x40/0x80, без них разбор данных другой), затем драйвер тикается вызовами \`updateSound\` по одному на кадр; прерывания выключены, игровая логика не идёт — поток чистый (без наложения). Начальное состояние выхода — после \`vec_snd_hush\`. Выход снимается с портов (AY: 0x15 выбор / 0x14 данные; ВИ53: 0x08 управляющее слово, 0x09–0x0B данные). Событие — **изменение итогового состояния выхода от кадра к кадру**: AY — (кадр, регистр 0–13, значение); ВИ53 — (кадр, канал, вид, делитель), вид: off (канал выключен), clk (канал 2 в режиме 2 с периодом 60000: часы в аренде), div (канал уже играет в режиме 3, новый делитель), start (канал был выключен и включается с делителем). Промежуточные состояния внутри кадра (например запись hi до lo) в поток не входят. Бесконечные циклы (\`FE FF\`) снимаются до первого прохода всеми каналами; эффект падения (id 1) — первые 60 кадров (длительность задаёт игра).`);
L(`**Упаковка** (простая, побайтная): токен 0x00 — конец; 0x01..0x7F — пауза N кадров (длиннее 127 режется); токен ≥0x80 — событие. AY: \`0x80|reg\` + байт значения (2 байта). ВИ53: \`0x80|(вид<<2)|канал\`; вид 0=off, 1=clk (токен 1 байт, период часов фиксирован), 2=div, 3=start (+2 байта делителя lo,hi). Потоки лежат в \`outputs/sound-cost/streams/{ay,vi}_<id>.json\` (события, hex упаковки, начальное состояние).`);
{
  const ok = Object.values(S.sounds).every((m) => Object.values(m).every((r) => r.replay_ok));
  const n = Object.values(S.sounds.ay).length + Object.values(S.sounds.vi).length;
  L(`**Проверка потока.** Независимый декодер (\`replay\` в \`snd_cost_stream.js\`, читает только упакованные байты и начальное состояние) воспроизводит выход и сравнивается с состоянием, снятым с портов, **покадрово по всем кадрам**: ${ok ? "совпало для всех " + n + " потоков (AY и ВИ53)" : "**РАСХОЖДЕНИЕ**"}. Это проверка того, что упаковка и разность состояний без потерь на уровне итоговых состояний кадров; побочные эффекты (звук на живом чипе) не проверялись.`);
}
L();
{
  const hdrs = ["id", "звук", "кадров", "данные игры, байт", "AY: событий", "AY: ев/кадр ср/p90/макс", "AY: поток, байт", "ВИ53: событий", "ВИ53: ев/кадр ср/p90/макс", "ВИ53: поток, байт", "AY: тик драйвера ср/макс", "ВИ53: тик драйвера ср/макс"];
  const rows = [];
  let tD = 0, tA = 0, tV = 0;
  for (const id of Object.keys(S.sounds.ay)) {
    const a = S.sounds.ay[id], v = S.sounds.vi[id];
    rows.push([id, a.name, a.frames, a.data_bytes, a.events, `${n2(a.events_per_frame.mean)}/${a.events_per_frame.p90}/${a.events_per_frame.max}`, a.bytes, v.events, `${n2(v.events_per_frame.mean)}/${v.events_per_frame.p90}/${v.events_per_frame.max}`, v.bytes, `${n0(a.driver_tick_cycles.mean)}/${n0(a.driver_tick_cycles.max)}`, `${n0(v.driver_tick_cycles.mean)}/${n0(v.driver_tick_cycles.max)}`]);
    if (Number(id) > 2) { tD += a.data_bytes; tA += a.bytes; tV += v.bytes; }
  }
  L(md(hdrs, rows));
  L(`Итого по звукам 3…29 (без «падения» и «удара», у которых данных нет): данные игры **${tD}** байт; поток AY **${tA}** байт (${n2(tA / tD)}×); поток ВИ53 **${tV}** байт (${n2(tV / tD)}×). Поток AY раздут событиями огибающих громкости (регистры 8–10 меняются почти каждый кадр); у ВИ53 громкость не выводится, огибающая видна только как пересечение порога \`vol<6\`.`);
  L(`«Тик драйвера» — цена одного вызова updateSound в изоляции (драйвер+оверлей+вывод, без часов).`);
}
L();
{
  const N = S.natural;
  L(`**Поток в обычном прогоне** (музыка и эффекты вместе, ${N.ay.frames} кадров AY): AY — событий на кадр ${q4d(N.ay.per_frame)} (ср/мед/p90/макс), кадров без событий ${pc(N.ay.zero_event_frac)}, всего ${N.ay.events} событий, упаковка ${N.ay.bytes} байт; ВИ53 — ${q4d(N.vi.per_frame)}, без событий ${pc(N.vi.zero_event_frac)}, всего ${N.vi.events}, ${N.vi.bytes} байт. Только GS=5: AY ${q4d(N.ay.per_frame_gs5)}, ВИ53 ${q4d(N.vi.per_frame_gs5)}.`);
}
L();
L(`### 4.2 Размер: нынешние данные и код против потоков`);
L();
{
  const D = S.data, K = S.code;
  const hx = (x) => "0x" + x.toString(16).toUpperCase().padStart(4, "0");
  L(md(["Что", "Адреса (по .sym)", "Байт"], [
    ["Нотные данные и эффекты (SFX_*, MUS_*, byte_7E*)", `${hx(D.range.start)}–${hx(D.range.end - 1)}`, D.range.bytes],
    ["Таблица MusicIndex", `${hx(D.music_index.addr)}–${hx(D.range.start - 1)}`, D.music_index.bytes],
    ["Таблица частот freqNotas", `${hx(K.freq_table.addr)}–${hx(K.freq_table.addr + K.freq_table.bytes - 1)}`, K.freq_table.bytes],
    ["Код драйвера: setMusic…musicStorePtr", `${hx(K.driver.start)}–${hx(K.driver.end - 1)}`, K.driver.bytes],
    ["Оверлей AY (в дырке WRTPSG)", `${hx(K.overlay_ay.addr)}–${hx(K.overlay_ay.addr + K.overlay_ay.bytes - 1)}`, K.overlay_ay.bytes],
    ["Оверлей ВИ53 (в дырке WRTPSG)", `${hx(K.overlay_vi.addr)}–${hx(K.overlay_vi.addr + K.overlay_vi.bytes - 1)}`, K.overlay_vi.bytes],
    ["Часы vtm_*, vsnd_tick* (остаются при замене)", `${hx(K.clock_vtm.start)}–${hx(K.clock_vtm.end - 1)}`, K.clock_vtm.bytes],
    ["ОЗУ каналов драйвера (MusicChanData ×3)", "0xFD44–0xFD6D", K.ram_channels],
  ]));
  const drv = K.driver.bytes + K.freq_table.bytes + D.music_index.bytes;
  L(`Что уходит при замене на проигрыватель: данные ${D.range.bytes} + MusicIndex ${D.music_index.bytes} + частоты ${K.freq_table.bytes} + код драйвера ${K.driver.bytes} (без SetMusic_-приоритета, который, видимо, остаётся) = ${D.range.bytes + drv} байт; оверлей AY ${K.overlay_ay.bytes} / ВИ53 ${K.overlay_vi.bytes}. Приходит: потоки всех 3…29 — AY ${S.sounds ? Object.entries(S.sounds.ay).filter(([i]) => Number(i) > 2).reduce((s, [, r]) => s + r.bytes, 0) : 0} / ВИ53 ${Object.entries(S.sounds.vi).filter(([i]) => Number(i) > 2).reduce((s, [, r]) => s + r.bytes, 0)} байт (+ код проигрывателя, см. ниже).`);
}
L();
L(`### 4.3 Цена проигрывателя на кадр (расчёт по измеренным тактам команд)`);
L();
L(`Такты команд сняты на эмуляторе: каждая команда исполнялась отдельно на «чистом» процессоре, число — \`cpu.vcycles\` (для условных переходов и возвратов отдельно «выполнен»/«нет»; признак выполненного перехода проверен по смещению PC).`);
L();
{
  const rows = Object.entries(P.instr).map(([k, v]) => [k, v.cycles, v.bytes]);
  L(md(["Команда", "такты", "байт"], rows));
}
L(`Проигрыватель вызывается вместо \`updateSound\` (\`jp updateSound\` из \`vsnd_tick_hdr\` становится \`jp tick\`), часы и вход (участок 1) остаются как есть. Листинги (команды i8080):`);
L();
L("AY:\n```\n" + P.ay.code + "\n```");
L("ВИ53:\n```\n" + P.vi.code + "\n```");
L(`Расчёт: стоимость = Σ тактов команд из таблицы.`);
L();
{
  const lst = (a) => a.join("; ");
  L(md(["Случай", "AY: команды", "AY: такты", "ВИ53: команды", "ВИ53: такты"], [
    ["Кадр без событий", lst(P.ay.listing.idle), P.ay.idle_frame, lst(P.vi.listing.idle), P.vi.idle_frame],
    ["Фиксированная часть кадра с событиями (пролог+эпилог)", `${lst(P.ay.listing.prologue)} // ${lst(P.ay.listing.epilogue)}`, P.ay.prologue + P.ay.epilogue, `${lst(P.vi.listing.prologue)} // ${lst(P.vi.listing.epilogue)}`, P.vi.prologue + P.vi.epilogue],
    ["Одно событие AY (reg,value)", lst(P.ay.listing.event), P.ay.event_cost, "—", "—"],
    ["Диспетчеризация события ВИ53", "—", "—", lst(P.vi.listing.dispatch), P.vi.dispatch],
    ["Обработчик ВИ53: off / clk / div / start", "—", "—", `off: ${lst(P.vi.listing.handlers.off)}; clk: ${lst(P.vi.listing.handlers.clk)}; div: ${lst(P.vi.listing.handlers.div)}; start: ${lst(P.vi.listing.handlers.start)}`, `${P.vi.handler.off} / ${P.vi.handler.clk} / ${P.vi.handler.div} / ${P.vi.handler.start}`],
    ["Событие ВИ53 целиком (диспетчер+обработчик): off / clk / div / start", "—", "—", "—", `${P.vi.event_cost.off} / ${P.vi.event_cost.clk} / ${P.vi.event_cost.div} / ${P.vi.event_cost.start}`],
    ["**Кадр с одним событием**", `пролог + 1×событие + эпилог`, `**${P.ay.one_event_frame}**`, `div: **${P.vi.one_event_frame_div}**; start: ${P.vi.one_event_frame_start}; off: ${P.vi.one_event_frame_off}`, `**${P.vi.one_event_frame_div}** (div)`],
    ["Кадр с одним событием + проверка режима (lda/cpi/jz на кадр)", lst(P.ay.listing.mode_gate), P.ay.one_event_frame_gate, lst(P.vi.listing.mode_gate), P.vi.one_event_frame_div + P.vi.mode_gate],
    ["**Худший кадр среди изолированных звуков**", "—", `**${P.ay.worst_isolated_frame}**`, "—", `**${P.vi.worst_isolated_frame}**`],
    ["**Худший кадр обычного прогона** (музыка+эффекты вместе)", "—", `**${P.ay.worst_natural_frame}**`, "—", `**${P.vi.worst_natural_frame}**`],
  ]));
  L(`Стоимость тика драйвера Konami в тех же изолированных сценах для сравнения — таблица 4.1, колонки «тик драйвера».`);
}
L();
L(`**Обычный прогон, пересчёт на реальные кадры.** По фактическим событиям каждого кадра и числу тиков (кадр без тика — 0 тактов; при ≥2 тиках лишние тики считаются холостыми):`);
L();
{
  const rows = [];
  for (const cn of ["ay", "vi"]) { const d = P.natural[cn]; rows.push([cn === "ay" ? "AY" : "ВИ53", q4(d.frame_cost), q4(d.frame_cost_gs5), q4(d.step_cost), n0(d.current_s234_frame_mean), n0(d.current_s234_step_mean), n0(d.current_s1_frame_mean), n0(d.current_total_step_mean)]); }
  L(md(["Чип", "Проигрыватель на кадр (ср/мед/p90/макс)", "то же, только GS=5", "Проигрыватель на шаг", "Сейчас участки 2+3+4, кадр (ср.)", "Сейчас участки 2+3+4, шаг (ср.)", "Часы и вход (участок 1), кадр (ср.)", "Весь звук сейчас, шаг (ср.)"], rows));
  L(`Проигрыватель заменяет участки 2, 3 и 4 (драйвер, оверлей, вывод); часы (участок 1) остаются и считаются отдельно.`);
}
L();
L(`### 4.4 Что мешает замене (по коду)`);
L();
{
  const w = REF.game_music_waits.join(", ");
  L(`1. **Наложение эффектов на музыку.** \`SetMusic_\` (\`kvalley_game.asm:${REF.game_setmusic}\`) выбирает каналы по номеру звука: эффект (id<11) — один канал, \`musicCh3\` (\`setSFX\`, строка ${REF.game_setsfx}); игровая музыка (id 11–16) — каналы 1–2; фанфары (≥17) — все три. Приоритет — сравнение номеров (\`setMus\`, строка ${REF.game_setmus}: \`cp e / ret c\`): новый звук с меньшим номером, чем звучащий на этом канале, отбрасывается, с большим или равным — затирает запись канала (\`setChanData\`, строка ${REF.game_setchan}). Во всех нынешних потоках эффект и музыка не делят канал (музыка игры на 1–2, эффект на 3), поэтому два независимых потока (музыка, эффекты) возможны, но: (а) в AY общие регистры 6 и 7 (шум, микшер) пишет любой канал — \`switchCh3OnOff\` (строка ${REF.game_ch3}) и \`SetPSGMixer\` (строка ${REF.game_mixer}) перекраивают микшер на лету; (б) фанфары ≥17 занимают канал 3, эффекты их не перебивают (меньший номер) — это поведение должен сохранить приоритет.`);
  L(`2. **Джинглы.** Это те же \`MUS_*\`: 3 канала, конечные (с \`FF\`), либо с бесконечным циклом \`FE FF\` (\`patternLoop\`, строка ${REF.game_pattern_loop}). Звуки 13, 15, 17, 20, 23, 26 в потоках выше конечны, 11 (игра) зациклена. Игра запускает их из ${REF.game_setmusic_calls} мест (\`call/jp setMusic\`), номер и флаги передаются в A.`);
  L(`3. **Ожидание конца мелодии игрой.** Игра читает **внутреннее состояние драйвера**: \`tickMuerto\` ждёт \`MusicChanData\` (байт CNT_NOTA канала 1) ≠ 0 («играет музыка смерти», строка ${REF.game_tickmuerto}); \`tickGame\` после фанфар этапа ждёт \`musicCh1|musicCh2\` ≠ 0 и затем запускает игровую музыку; \`setEndingStat\` — снова \`MusicChanData\`. Все места чтения состояния канала: строки ${w}. Проигрыватель обязан выставлять эти байты (занят/свободен) в те же ячейки, иначе после смерти игра не продолжится (в комментарии к \`vtm_arm\`, строка ${REF.isr_vtm_arm}, описана именно эта авария при остановленных часах).`);
  L(`4. **Темп на скролле.** Тики идут не только из шапки ISR: в длинных DI-участках музыку двигают кооперативные вызовы \`vsnd_tick_coop\` из \`vec_scroll.asm:${REF.scroll_coop}\` и \`vec_blit.asm:${REF.blit_coop}\` (доля кадра копится в \`vsnd_acc\`), в \`tickMain\` — \`vsnd_tick\` (строки ${REF.game_tickmain_vst}, ${REF.game_tickmain2_vst}), во вложенном ISR — строка ${REF.isr_call_tick_nested}. Проигрыватель получает тот же вход «сделать один тик» и темп не меняет, если сохранить точки вызова; но проигрыватель на тик несёт состояние (указатель, счётчик паузы), которое должно переживать вложенный вызов во время основного (как сейчас переживает \`vec_sndb\` через push/pop в обвязке). В сценах скролла выше доля тиков на кадр — в таблице 2.4.`);
  L(`5. **Аренда канала C ВИ53 под часы.** Часы живут на канале 2 ВИ53 (\`vtm_start\`, строка ${REF.isr_vtm_start}). \`vec_vi_ch\` при включении ноты на канале C зовёт \`vtm_grab\` (строка ${REF.ovvi_grab}, останавливает часы, \`vtm_have=0\`), при выключении — \`vtm_start\` (строка ${REF.ovvi_start}; перезапуск часов и проба \`vtm_wait\`). Событие start/off канала 2 в потоке проигрывателя обязано делать то же; в потоках ВИ53 выше это события вида clk/start/off на канале 2. Цена аренды сейчас — участок «аренда канала C» (в обычном прогоне ВИ53 ${n0(A.vi.natural.frame.cats.clk_lease.mean)} тактов на кадр в среднем, максимум ${n0(A.vi.natural.frame.cats.clk_lease.max)}); при замене она остаётся.`);
  L(`6. **Теневой регистр и режимы.** \`vec_ayregs\` — не только тень: из него \`vec_snd_apply\` (клавиша S и выход из паузы, строки ${REF.isr_apply_S}) пересылает состояние в чип после \`hush\` (строка ${REF.isr_hush_pause}); фильтр режима 1 (только эффекты) отсекает регистры 0–3, 8–9 (каналы музыки) в оверлее. Проигрыватель событий должен вести образ состояния выхода (14 байт AY / 3 канала ВИ53) и фильтровать события по режиму, иначе пауза и клавиша S ломаются. Поэтому в кадр с событием надо добавить проверку режима (строка «+ проверка режима» в 4.3) и запись в образ.`);
  L(`7. **Не звук в дырке WRTPSG.** \`ReadKeys\` (строка ${REF.game_readkeys_wrtpsg}) выбирает порт джойстика записью в регистр 15 через \`WRTPSG\`; вход \`WRTPSG\` придётся сохранить (в AY — побочная запись регистра 15 в чип). Всего вызовов \`WRTPSG\` в исходниках игры: строки ${REF.game_wrtpsg_callers.join(", ")}.`);
  L(`8. **Эффект падения** (id 1) — не данные: \`updateSfxCaer\` (строка ${REF.game_caer}) каждый тик прибавляет к частоте, длительность определяет игра (звук не имеет конца). В потоке нужен либо цикл с приращением, либо обрезка; в 4.1 снято 60 кадров.`);
}
L();
L(`## 5. Что проверено и как`);
L();
{
  const t = R.sanity;
  L(`- Существующий стенд \`snd_tempo.js\` на копии ROM: ${t ? "код выхода " + t.exit_code + ", последняя строка: «" + t.last_line + "»" : "не запускался"}. \`driver_profile.js\` меряет render_frame старого движка v2 и требует файлов в /tmp, к звуку текущей игры отношения не имеет — не использовался.`);
  L(`- Замороженный ROM сверен по SHA256 (см. начало). Исходные файлы \`src/\`, \`build/\`, \`devector/\`: хеши снимались перед прогоном и после; результат — в разделе 7.`);
  L(`- Скрипты (SHA256): ${Object.entries(R.scripts).map(([k, v]) => `\`${k}\` ${v.slice(0, 12)}`).join(", ")}.`);
}
L();

// ----------------------------------------------------------------------------------------------
L(`## 6. Что не удалось или вызывает сомнения`);
L();
L(`- Сцены «бросок ножа», «подбор гема» собраны с записью в память игры (нож в руку, перестановка героя на гем) — звук и логику запускает сама игра, но сцены не «естественные»; скролл — естественный переход, но герой поставлен у кромки комнаты. Смерть — естественная, мумия приходит сама.`);
L(`- В обычном прогоне больше половины кадров — не геймплей (GS=4 вход/карта), поэтому дана и выборка GS=5; числа на шаг по GS=5 берут GS в момент старта шага.`);
L(`- Сравнение со статьёй 5б старого отчёта — только по порядку величин и числу тиков на шаг; старую сборку не прогонял.`);
L(`- Поток событий — итоговые состояния по кадрам: промежуточные записи внутри кадра (в т.ч. hi до lo в ВИ53) потеряны намеренно. Совпадение проверено на уровне модели выхода (порты -> модель), не на живом чипе/слухом.`);
L(`- Режим ВИ53 в эмуляторе получен подменой пробы AY в памяти; аппаратное поведение ВИ53 (реальный счётчик, часы) эмулятор моделирует упрощённо — на цене тактов это не сказывается, на проверке «часы идут» (\`vtm_arm\`) может.`);
L(`- Оценка проигрывателя — расчёт по спискам команд, программа не написана и не запускалась в игре; не учтены вызов/возврат вокруг тика (уже есть в участке «вход»), хранение указателя потока в нескольких звуках одновременно (музыка+эффекты — два указателя), смена звука (priority).`);
L(`- Эффект падения снят на 60 кадров, циклические мелодии — до первого полного прохода.`);
L();

// ----------------------------------------------------------------------------------------------
L(`# Гипотезы`);
L();
L(`Ниже — предположения и рекомендации, **не подтверждённые измерением**.`);
L();
{
  const a = A.ay.natural, v = A.vi.natural;
  L(`1. Самая дешёвая правка до замены драйвера — убрать записи «то же значение» на входе WRTPSG (например сравнение с тенью до оверлея): в AY это ~${n0(a.partB.wr_same_cyc.mean)} тактов на кадр, в ВИ53 вместе с лишними пересчётами ~${n0(v.partB.waste_cyc.mean)} тактов на кадр (${pc(v.partB.waste_cyc.mean / v.frame.total.mean)} звука). Выигрыш на шаге: AY ${n0(a.partB.step.wr_same_cyc.mean)}, ВИ53 ${n0(v.partB.step.waste_cyc.mean)}. Эффект на слух и на сборку не проверялся.`);
  L(`2. В ВИ53 вывод громкости и микшера (рег. 7–10) почти всегда не даёт эффекта: достаточно считать пороговое состояние канала при записи 7–10 и звать \`vec_vi_ch\` только при его смене; предположительно снимает основную долю \`vec_vi_ch\`/\`vec_ay2vi\`.`);
  L(`3. Проигрыватель событий по расчёту дешевле участков 2+3+4 в ${n1((a.step.sections.s2_driver.mean + a.step.sections.s3_overlay.mean + a.step.sections.s4_output.mean) / P.natural.ay.step_cost.mean)} раз (AY) и в ${n1((v.step.sections.s2_driver.mean + v.step.sections.s3_overlay.mean + v.step.sections.s4_output.mean) / P.natural.vi.step_cost.mean)} раз (ВИ53) на шаг, но часть выигрыша, возможно, можно получить промежуточным шагом: драйвер остаётся, а вывод в чип идёт через «грязные» флаги (не пересчитывать период при записи hi+lo и при записи громкости).`);
  L(`4. Для AY поток событий раздувают огибающие громкости (по событию на канал на кадр); если нужен компактный поток, огибающую лучше оставить параметрами (начало, шаг, длительность), а не раскрывать в события — формат и цена такого проигрывателя не измерялись.`);
  L(`5. При замене на проигрыватель критичны состояния, на которые смотрит игра (ожидание конца мелодии смерти и фанфар); их проще всего сохранить, оставив ячейки \`MusicChanData\`/\`musicCh1,2\` и заставив проигрыватель их обновлять.`);
  L(`6. Часы ВИ53 (участок 1: ${n0(v.step.sections.s1_clock.mean)} тактов на шаг у ВИ53 против ${n0(a.step.sections.s1_clock.mean)} у AY) после замены драйвера станут главной частью цены звука; их цену можно снижать отдельно (опрос реже, без вложенной ветки), но это уже другая задача.`);
}
L();

// ----------------------------------------------------------------------------------------------
L(`## 7. Целостность файлов игры`);
L();
if (R.integrity) {
  const I = R.integrity;
  L(`Хеши SHA256 всех файлов в \`src/\`, \`build/\`, \`devector/\` (${I.files_before} файлов) сняты в начале и в конце прогона: ${I.identical ? "**совпали, ни один файл не изменился**" : "**ИЗМЕНИЛИСЬ: " + I.changed.length + " файл(ов)**"}. ${I.identical ? "" : "Изменённые: " + I.changed.slice(0, 20).join(", ") + (I.changed.length > 20 ? " …" : "") + ". Эти файлы мой код не пишет (скрипты пишут только в outputs/sound-cost/ и tools/verify/snd_cost_*.js); изменение, если оно есть, — от другого агента в той же папке."}`);
  L(`Манифест до: \`outputs/sound-cost/manifest_before.json\`, после: \`manifest_after.json\`.`);
} else L(`Проверка целостности не выполнена в этом прогоне.`);
L();

fs.writeFileSync(path.join(OUT, "REPORT.md"), o);
console.log("REPORT.md:", o.length, "символов");
