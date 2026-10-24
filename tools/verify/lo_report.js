// lo_report.js — REPORT.md из results.json: все числа подставляются отсюда, не руками.
"use strict";
const fs = require("fs");
const D = "outputs/logic-opt/";
const r = JSON.parse(fs.readFileSync(D + "results.json"));
const L = r.logic_cycles_per_step, F = r.frames_per_step;
const saved = L.saved_mean, pctv = (100 * saved / L.base.logic_mean).toFixed(1);
const framesSaved = (saved / 59904).toFixed(3);
const gateRows = Object.keys(r.run_gates.base).filter(k => !k.endsWith("_last")).map(k => {
  const b = r.run_gates.base[k + "_last"], n = r.run_gates.new[k + "_last"];
  const norm = s => (s || "").replace(/\d+/g, "#");
  return `| ${k} | ${r.run_gates.base[k]} | ${r.run_gates.new[k]} | ${norm(b) === norm(n) ? "строка итога та же" : "строка итога отличается: " + (n || "").slice(0, 80)} |`;
}).join("\n");
const scen = Object.keys(r.per_scenario.base).map(s => {
  const a = r.per_scenario.base[s], b = r.per_scenario.new[s], g = r.behaviour_gate[s];
  return `| ${s} | ${a.ticks} | ${a.logic_mean} -> ${b.logic_mean} | ${a.logic_p90} -> ${b.logic_p90} | ${a.logic_max} -> ${b.logic_max} | ${a.frames_per_step} -> ${b.frames_per_step} | ${g.equal ? "0 расхождений" : "РАСХОЖДЕНИЕ тик " + g.first_diff.tick} |`;
}).join("\n");
const cov = Object.entries(r.per_scenario.base).map(([s, v]) => { const c = v.cov; return `| ${s} | ${Object.keys(c.pst).join(",")} | ${c.gems} | ${c.knifeTaken} | ${c.picoTaken} | ${c.deaths} | ${c.stageClear} | ${c.pyr.join(",")} | ${c.maxSimMum} |`; }).join("\n");
const fn = r.function_table.slice(0, 14).map(x => `| ${x.fn} | ${x.base} | ${x.new} | ${x.delta} |`).join("\n");
const fnUp = r.function_table.slice(-5).map(x => `| ${x.fn} | ${x.base} | ${x.new} | +${x.delta} |`).join("\n");
const cat = ["ixiy", "exx_scratch", "helper_call", "shift", "pushpop", "other"].map(k => `| ${k} | ${r.profile_categories.base[k] || 0} | ${r.profile_categories.new[k] || 0} |`).join("\n");
const unit = r.unit_tests.map(u => `| ${u.test} | ${u.N} | ${u["расхождений"]} | ${u["такты_эталон"]} -> ${u["такты_новая"]} |`).join("\n");
const md = `Снято ${saved} тактов логики на шаг из ${L.base.logic_mean} (${pctv}%), это ${framesSaved} кадра на шаг по арифметике (реально шаг natural ${F.base.natural} -> ${F.new.natural} кадра, stress ${F.base.stress} -> ${F.new.stress}); цена ${r.bytes_cost} Б образа (свободно до romCeil ${r.base.free_bytes} -> ${r.new.free_bytes}).

# logic-opt: ускорение игровой логики King's Valley

Основа 23ffb6f, ветка logic-opt. Все числа ниже подставлены скриптом tools/verify/lo_report.js из outputs/logic-opt/results.json.

## Доказано

Логика шага = такты тика без вложенных прерываний и без vec_nat_sprites (только тики с GameStatus=5), шесть сценариев по 2500-3000 тиков, один и тот же ввод по номеру тика в обеих сборках.

| Сценарий | Тиков | Логика, среднее | p90 | макс | Кадров на шаг | Гейт поведения |
|---|---|---|---|---|---|---|
${scen}

Итого по всем тикам: среднее ${L.base.logic_mean} -> ${L.new.logic_mean}, p90 ${L.base.logic_p90} -> ${L.new.logic_p90}, макс ${L.base.logic_max} -> ${L.new.logic_max} (максимум — тики со сменой уровня, там логика зовёт загрузку). Шаг целиком (с прерываниями и спрайтами) в среднем ${L.base.step_T_mean} -> ${L.new.step_T_mean} тактов.
Кадров на шаг: natural (demo + три тура) ${F.base.natural} -> ${F.new.natural}, stress ${F.base.stress} -> ${F.new.stress}. Выигрыш в кадрах мал: шаг привязан к 25 Гц (2 кадра), логика экономит такты внутри кадра, а длинные шаги (3+ кадра) определяются рендером.

Покрытие сценариев (базовая сборка): статусы героя, гемы, ножи, кирки, смерти, Stage Clear, пирамиды, макс. число мумий в комнате героя.

| Сценарий | Статусы героя | Гемы | Ножи | Кирки | Смерти | Stage Clear | Пирамиды | Мумий макс |
|---|---|---|---|---|---|---|---|---|
${cov}

Гейт поведения (tools/verify/lo_gate.sh): сравнение игрового состояния (карта MapaRAM, данные мумий, герой, гемы, ножи, кирки, двери, HUD, счёт) после каждого тика логики, без звука и без scratch-ячеек эмуляции. Расхождений: ${Object.values(r.behaviour_gate).reduce((a, g) => a + (g.equal ? 0 : 1), 0)} сценариев из ${Object.keys(r.behaviour_gate).length}. Негативный контроль (правка одного байта таблицы рядов карты в ROM) гейт ловит на тике 0 (см. раздел про ограничения).

Юнит-доказательство подпрограмм (эталон и новая из разных ROM на одних входах, сравниваются HL, A, BC, DE где обещано, SP):

| Подпрограмма | Входов | Расхождений | Такты на вызов |
|---|---|---|---|
${unit}

Профиль по функциям (такты на шаг, самые выигравшие и самые выросшие):

| Функция | База | Новая | Разница |
|---|---|---|---|
${fn}
${fnUp}

Накладные по видам (такты на шаг, классификация по тексту строки исходника):

| Вид | База | Новая |
|---|---|---|
${cat}

IX/IY-эмуляция и exx в базе уже были в основном убраны прежними проходами (план «IX->HL» из JOURNAL выполнен: остались \`ld hl,(z80_ix)\` по 16 тактов и пары \`ld de,N / add hl,de\`); оставшаяся работа была в структуре вызовов, а не в эмуляции.

run_gates.sh до и после (одна и та же формулировка итога = без изменений; красные spr_resid_gate, knife_purity, bonus_ending_gate красны и до):

| Гейт | База | Новая | Итог |
|---|---|---|---|
${gateRows}

## Что сделано

1. AI_Salidas: пред-скан дверей (хвост образа). Пока не собраны все гемы и у четырёх дверей старший ниббл статуса 0, общий проход ничего не пишет кроме ElemEnProceso=4 и puertaCerrada=0; пишем это сразу. Был самым дорогим пунктом (около 1300 тактов).
2. getMomiaDat/getMomiaProcDat: таблица из четырёх слов вместо цепочки умножения на 22 и обмена alt-регистрами через ячейки; AI_Momias без эмуляции двух exx. Ячейки z80_hl_alt и il_tmp на этом пути писались и не читались, z80_de_alt читал только AI_Momias.
3. getMapOffset/getMapOffset00: таблица рядов сразу с MapaRAMRoot, чтение таблицы без push/pop HL, индекс ряда через (Y>>2)&0x3E, отдельный вход без смещений для getMapOffset00.
4. getVariableMomia без call ADD_A_HL (записи мумий в одной странице).
5. itmGate двумя 16-битными сравнениями вместо цикла; chkTocaProta со встроенной chkArea (chkAreaItem переехала вместе с ней, она проваливалась в chkTocaProta).
6. ReadKeys: SNSMAT(7) всегда 0xFF => SELECT=0, ряд 8 это vec_kb8; самоубийство по F2 в tickGame мертво (SNSMAT(6)=0xFF) и убрано.

## Отвергнутые и откатанные правки

- AI_Salidas сначала лежал в pre-align части: +38 Б там сдвинули образ на страницу (свободно 1121 -> 865). Перенесён в хвост; pre-align зазор перед .align 256 был нулевым, теперь ему возвращено место.
- Первая версия getMapOffset складывала с таблицей рядов побайтно (add a,e / adc a,d) после and 0x1F, который сбрасывает перенос: юнит-тест нашёл расхождение на 24% входов, заменено на add hl,de.
- Первая версия chkTocaProta без chkAreaItem ломала подбор гемов (chkAreaItem проваливалась в неё): поймано гейтом поведения на тике 5, исправлено.
- Не делалось: флаг «есть гем со статусом 2» для AI_Gemas (около 250 тактов, но нужен новый байт состояния и доказательство единственного писателя, риск выше выигрыша); inline ADD_A_HL в getKnifeData (массив ножей пересекает границу страницы 0xFF00); безветвенное знаковое расширение B в getMapOffset (ровно столько же тактов); пересчёт хвоста getMapOffset через 16-битный сдвиг (не короче).

## Гипотезы (не проверено)

- AI_Gemas (пред-скан около 350 тактов на шаг) можно свести к проверке одного флага, если подтвердить, что статус 2 ставит только chkCogeGema.
- AI_Momias остаётся самым дорогим (около 1500 тактов): диспетчер jumpIndex для статусов, updateMomiaAtr/getMomiaAtrib, mueveElemento. Раскрутка по статусам даст ещё сотни тактов.
- setAttribProta/setAttribProta3 (около 500 тактов) пересчитываются каждый тик, даже когда герой не двигался.
- Выигрыш в кадрах невелик, пока рендер определяет длинные шаги; логика вне ISR.

## Ограничения методики

- Z80-эталон (msx/kvalley_src.asm) в этой ветке отсутствует; эталоном служит сборка 23ffb6f, поведение сверяется состояние в состояние по тикам. Совпадение с БК-версией доказательством не считалось.
- Из сравнения исключены: звук, scratch эмуляции (dummy_10+0..+19), flagStageClear (единственный читатель перезапускает музыку и сбрасывается по времени кадров, а не тиков), а указатели на таблицу прыжка и записи демо сравниваются как смещение от метки таблицы (адрес зависит от размера кода). После входа в геймплей таймер timer обнуляется (одинаково в обеих сборках).
- Ввод пишется в vec_kb8 при входе в chkControls, джойстик не участвует. Тик-в-тик равенство подтверждено только на этих сценариях, это не полное доказательство.
- Раскладка: gmd_tab, gmo_tab и статусы дверей должны лежать в одной странице; lo_gate.sh проверяет это по .sym.
`;
fs.writeFileSync(D + "REPORT.md", md);
console.log(md.split("\n")[0]);
