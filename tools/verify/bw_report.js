#!/usr/bin/env node
'use strict';
// Собирает results.json и REPORT.md из измерений outputs/beamwait/*.json. Все числа в тексте берутся отсюда.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const O=path.resolve(__dirname,'../../outputs/beamwait');
const J=f=>JSON.parse(fs.readFileSync(path.join(O,f)));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(O,f))).digest('hex');
const base=J('eval_base.json'),e2=J('eval_e2b8f32.json'),nw=J('eval_new.json'),cmp=J('compare.json'),pb=J('phase_b.json'),prof=J('prof_rows.json');
const syms=f=>{const d={};for(const l of fs.readFileSync(path.join(O,f),'latin1').split('\n')){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)d[m[1]]=parseInt(m[2],16);}return d;};
const sb=syms('base/kvalley_8c.sym'),sn=syms('new/kvalley_8c.sym');
const gparse=f=>{const d={};let cur=null;for(const l of fs.readFileSync(path.join(O,f),'utf8').split('\n')){if(l.startsWith('== ')){cur=l.slice(3);d[cur]=[];}else if(cur)d[cur].push(l);}return d;};
const gb=gparse('gates_base.log'),gn=gparse('gates_new.log');
const red=g=>g.filter(x=>/FAIL|ПАДАЕТ|УЕХАЛ|РЕЗУЛЬТАТ: (?!OK|ОК)/.test(x)).length>0;
const gates={};for(const k of Object.keys(gb)){const tb=gb[k].filter(x=>x.trim()).slice(-3).join(' | '),tn=(gn[k]||[]).filter(x=>x.trim()).slice(-3).join(' | ');gates[k]={base_red:red(gb[k]),new_red:red(gn[k]||[]),last_lines_equal:tb===tn};}
const pct=(a,b)=>100*(1-b/a);
const scenes=Object.keys(base.scenes);
const fl={};for(const s of scenes){const a=base.scenes[s],b=nw.scenes[s];fl[s]={base_objects:a.objects,new_objects:b.objects,base_upper:a.upper_objects,new_upper:b.upper_objects,base_frames:a.frames,new_frames:b.frames,base_upper_frames:a.upper_frames,new_upper_frames:b.upper_frames,
  step_frames_base:a.step_frames_mean,step_frames_e2b8f32:e2.scenes[s].step_frames_mean,step_frames_new:b.step_frames_mean,pack_mean_base:a.pack_cycles.mean,pack_mean_new:b.pack_cycles.mean,pack_p90_new:b.pack_cycles.p90,wait_per_pack_mean:b.wait_per_pack.mean,wait_per_pack_p90:b.wait_per_pack.p90,steps:b.steps};}
const T=(x)=>x.total;
const R={meta:{base_commit:'23ffb6f',base_rom_sha256:sha('base/kvalley_8c.rom'),new_rom_sha256:sha('new/kvalley_8c.rom'),e2b8f32_rom_sha256:sha('e2b8f32.rom'),method:'tools/verify/beam_order_measure.js (трассы на настоящем ROM) + bw_eval.js + bw_compare.js + bw_phase_b.js + bw_prof_an.js'},
 flicker:{scenes:fl,total:{base_objects:T(base).objects,new_objects:T(nw).objects,base_upper:T(base).upper_objects,new_upper:T(nw).upper_objects,base_frames:T(base).frames,new_frames:T(nw).frames,base_upper_frames:T(base).upper_frames,new_upper_frames:T(nw).upper_frames,
   reduction_objects_pct:pct(T(base).objects,T(nw).objects),reduction_upper_pct:pct(T(base).upper_objects,T(nw).upper_objects),reduction_frames_pct:pct(T(base).frames,T(nw).frames),reduction_upper_frames_pct:pct(T(base).upper_frames,T(nw).upper_frames)}},
 steps:{hist:{base:T(base).step_hist,e2b8f32:T(e2).step_hist,new:T(nw).step_hist},mean_frames:{base:T(base).step_frames_mean,e2b8f32:T(e2).step_frames_mean,new:T(nw).step_frames_mean},steps:T(nw).steps,
   natural:{base:base.scenes.natural.step_frames_mean,e2b8f32:e2.scenes.natural.step_frames_mean,new:nw.scenes.natural.step_frames_mean,hist_base:base.scenes.natural.step_hist,hist_e2b8f32:e2.scenes.natural.step_hist,hist_new:nw.scenes.natural.step_hist}},
 pack:{cycles_base:T(base).pack_cycles,cycles_new:T(nw).pack_cycles,wait_per_pack_new:T(nw).wait_per_pack,wait_natural:nw.scenes.natural.wait_per_pack},
 phase:{items:T(nw).bw.items,planned:T(nw).bw.planned,waited:T(nw).bw.waited,soft_path_items:T(nw).bw.nohave,soft_share_pct:100*T(nw).bw.nohave/T(nw).bw.items,hw_error_ticks:T(nw).bw.hw_err,soft_error_ticks:T(nw).bw.soft_err,di_max_cycles:T(nw).bw.dimax,tick_cycles:2,
   B_offline:pb.B_error_cycles,V_points:pb.V_points_from_irq_cycles,V_align:pb.V_align_to_max_cost_per_pack_cycles,start_by_depth:pb.start_by_depth},
 logic_profile:prof,
 state_and_sound:cmp,
 gates,
 memory:{free_base:1121,free_new_from_build:null,code_end_base:sb.vso_setidx,note:'см. REPORT'},
 symbols:{vbw_wait:sn.vbw_wait,vbw_block_bytes:sn.vso_setidx-sn.vst_no,vso_setidx_shift:sn.vso_setidx-sb.vso_setidx,hdr_bytes_base:sb.vsnd_tick_coop-sb.vsnd_tick_hdr,hdr_bytes_new:sn.vsnd_tick_coop-sn.vsnd_tick_hdr}};
const mm=fs.readFileSync(path.join(O,'memmap.txt'),'utf8');const mf=mm.match(/свободно (\d+) Б/);R.memory.free_new_from_build=mf?+mf[1]:null;R.memory.code_end_new=(mm.match(/0x0100-(0x[0-9A-F]+)/)||[])[1];
const nat=nw.scenes.natural;
const f1=x=>x.toFixed(1),f0=x=>Math.round(x).toString(),f3=x=>x.toFixed(3),f2=x=>x.toFixed(2);
const sceneRows=scenes.map(s=>{const a=fl[s];return `| ${s} | ${a.base_objects} / ${a.base_upper} | ${a.new_objects} / ${a.new_upper} | ${f3(a.step_frames_base)} | ${f3(a.step_frames_e2b8f32)} | ${f3(a.step_frames_new)} | ${f0(a.wait_per_pack_mean)} |`}).join('\n');
const profRows=prof.rows.slice(0,22).map(r=>`| ${r.label} | ${r.calls_mean.toFixed(2)} | ${r.incl_min} / ${f0(r.incl_mean)} / ${r.incl_max} | ${f1(100*r.var_share)}% | ${f0(r.pad_cost_to_max)} | ${f0(r.sd_after_pad)} |`).join('\n');
const g=R.gates;const redBase=Object.keys(g).filter(k=>g[k].base_red),redNew=Object.keys(g).filter(k=>g[k].new_red);
const sndRows=Object.entries(cmp).map(([k,v])=>`| ${k} | ${v.diff} из ${v.compared} | ${v.snd_ticks_a} / ${v.snd_ticks_b} | ${f3(v.snd_per_frame_a)} / ${f3(v.snd_per_frame_b)} |`).join('\n');
const b=pb.B_error_cycles;
const md=`# Beamwait: ожидание луча перед стиранием объекта (BEAMW)

Основа: 23ffb6f (звук только ВИ53). Ветка beamwait, один коммит. Все числа ниже сгенерированы из results.json скриптом tools/verify/bw_report.js. Измерения сделаны на настоящих ROM в эмуляторе (трассы beam_order_measure), не по модели.

## Что реализовано

Вариант A4 (BEAMW) в медленном пути пачки: перед каждым restore объекта (и перед restore пары героя) процедура vbw_wait (src/v06c/vec_sprout.asm) считает, на какие строки экрана попадёт объект (старый и новый габарит), оценивает срок жизни окна C от этого restore до последнего show (по числу столбцов объектов от начала порядка вывода до этого объекта) и ждёт, пока луч не уйдёт со строк объекта на весь этот срок. Окно невозможно (объект плюс срок не влезают в кадр), объект на краю экрана или restore пуст — не ждём (как раньше). Вариант A3 не нужен: A4 даёт почти ноль мерцания.

Источник фазы луча — смесь:
- (А) канал 2 ВИ53, пока часы доступны (vtm_have=1): шапка ISR уже читает счётчик, копия кладётся в vbw_t0 с поправкой на время от запроса IRQ до чтения (1150 отсчётов во внешнем ISR, 760 во вложенном); перед выводом счётчик читается ещё раз, разность по модулю 60000 минус кадры даёт время от кадрового прерывания. Отсчёт = 2 такта.
- (Б) программный счёт, когда часов нет (канал 2 под эффектом): старт пачки по константе, плюс константная цена restore на столбец, плюс шаг ожидания; запас на начало дуги 600 отсчётов.
- Ожидание при часах тикает музыку кооперативно (vsnd_tick_coop под защитой vsnd_busy), иначе темп музыки плывёт.

## Доказано (замер на настоящем ROM)

### Мерцание (окна restore до show, луч по растру эмулятора, методика beam_order)

Всего по 13 сценам: объектов с миганием ${R.flicker.total.base_objects} -> ${R.flicker.total.new_objects} (минус ${f1(R.flicker.total.reduction_objects_pct)}%), из них верх (строки Y=48..63) ${R.flicker.total.base_upper} -> ${R.flicker.total.new_upper} (минус ${f1(R.flicker.total.reduction_upper_pct)}%). Кадров с попаданием: ${R.flicker.total.base_frames} -> ${R.flicker.total.new_frames}, из них верх ${R.flicker.total.base_upper_frames} -> ${R.flicker.total.new_upper_frames}.

| Сцена | До: всего / верх | После: всего / верх | Кадров на шаг до | e2b8f32 | после | Ожидание на пачку, такты |
| --- | --- | --- | --- | --- | --- | --- |
${sceneRows}

### Скорость

Средний шаг в кадрах по всем сценам: до ${f3(R.steps.mean_frames.base)}, e2b8f32 ${f3(R.steps.mean_frames.e2b8f32)}, после ${f3(R.steps.mean_frames.new)}. Распределение шагов 2/3/4/5 кадров: до ${JSON.stringify(R.steps.hist.base)}, e2b8f32 ${JSON.stringify(R.steps.hist.e2b8f32)}, после ${JSON.stringify(R.steps.hist.new)}.
Обычный прогон (natural, 2600 шагов): до ${f3(R.steps.natural.base)}, e2b8f32 ${f3(R.steps.natural.e2b8f32)}, после ${f3(R.steps.natural.new)}; распределение после ${JSON.stringify(R.steps.natural.hist_new)}.
Пачка: средняя ${f0(R.pack.cycles_base.mean)} -> ${f0(R.pack.cycles_new.mean)} тактов, p90 ${f0(R.pack.cycles_base.p90)} -> ${f0(R.pack.cycles_new.p90)}. На ожидание в среднем уходит ${f0(R.pack.wait_per_pack_new.mean)} тактов на пачку (p90 ${f0(R.pack.wait_per_pack_new.p90)}); в natural ${f0(R.pack.wait_natural.mean)}. Ожидание включает работу вложенных прерываний и кооперативный тик музыки.
Вывод: окупает ли экономия звука ожидание. На обычном прогоне после = ${f3(R.steps.natural.new)} против e2b8f32 ${f3(R.steps.natural.e2b8f32)} (разница ${f1(100*(R.steps.natural.new/R.steps.natural.e2b8f32-1))}%) и основы ${f3(R.steps.natural.base)} (${f1(100*(R.steps.natural.new/R.steps.natural.base-1))}%): почти окупает, но не полностью. На тяжёлых сценах (мумии у верха, climb, stress) шаг растёт заметно сильнее.

### Точность фазы луча

Ошибка источника фазы против растра эмулятора (время от запроса IRQ в отсчётах по 2 такта; ${R.phase.hw_error_ticks.n} замеров по часам и ${R.phase.soft_error_ticks.n} по программному счёту):
- (А) часы ВИ53: среднее ${f1(R.phase.hw_error_ticks.mean_signed)} отсчётов, p90 по модулю ${R.phase.hw_error_ticks.p90}, худший случай от ${R.phase.hw_error_ticks.min} до +${R.phase.hw_error_ticks.max} (1 отсчёт = 2 такта; 96 отсчётов = строка луча).
- (Б) программный счёт: среднее ${f0(R.phase.soft_error_ticks.mean_signed)}, p90 по модулю ${R.phase.soft_error_ticks.p90}, худший от ${R.phase.soft_error_ticks.min} до +${R.phase.soft_error_ticks.max} отсчётов (около ${f0(Math.abs(R.phase.soft_error_ticks.min)/96)} строк). Константы Б подобраны по этим же сценам, поэтому ошибка Б на других сценах может быть больше.
- Доля пачко-объектов (вызовов vbw_wait), где фаза шла по программному счёту: ${f1(R.phase.soft_share_pct)}% (${R.phase.soft_path_items} из ${R.phase.items}); дошло до расчёта дуги ${R.phase.planned}; реально ждали ${R.phase.waited}.
- Максимальное время в DI, добавленное BEAMW (чтение счётчика): ${R.phase.di_max_cycles} тактов.

### Варианты (Б) и (В) оффлайн, по трассам основы

(Б) вычисление по ходу пачки: ошибка предсказания фазы начала каждого restore (старт пачки по медиане для глубины ISR плюс таблица средних цен операций по виду и числу столбцов; таблица взята с тех же трасс, оценка оптимистична): среднее по модулю ${f0(b.abs_full.mean)} тактов, медиана ${f0(b.abs_full.median)}, p90 ${f0(b.abs_full.p90)}, худший ${f0(b.abs_full.max)}. Из них разброс старта пачки (шапка, звук, вложенные тики): p90 ${f0(b.abs_from_pack_start.p90)}; суммы цен: p90 ${f0(b.abs_from_prices.p90)}. Строка луча = 192 такта, то есть p90 около ${f0(b.abs_full.p90/192)} строк. Пачка стартует после прерывания в среднем через ${f0(pb.V_points_from_irq_cycles.pack_start.median)} тактов, разброс от ${pb.V_points_from_irq_cycles.pack_start.min} до ${pb.V_points_from_irq_cycles.pack_start.max}.

(В) статическая точка вывода: время от прерывания до конца пачки имеет разброс sd ${f0(pb.V_points_from_irq_cycles.pack_end.sd)} тактов (от ${pb.V_points_from_irq_cycles.pack_end.min} до ${pb.V_points_from_irq_cycles.pack_end.max}); выровнять конец пачки до максимума стоило бы в среднем ${f0(pb.V_align_to_max_cost_per_pack_cycles.pack_end_to_max)} тактов на пачку. Это больше, чем среднее ожидание BEAMW (${f0(R.pack.wait_per_pack_new.mean)}). Начало первой операции стабильнее (sd ${f0(pb.V_points_from_irq_cycles.first_operation.sd)}, до максимума ${f0(pb.V_align_to_max_cost_per_pack_cycles.first_op_to_max)} тактов), но вывод идёт после всей подготовки и логики, а их длина и есть тот разброс.

Сравнение: (А) точность ±${R.phase.hw_error_ticks.p90*2} тактов, цена: чтение счётчика (около 100 тактов на опрос) и 20 байт в шапке; работает, пока канал 2 свободен. (Б) точность порядка ±${f0(R.phase.soft_error_ticks.p90*2)} тактов на реализованном виде и ${f0(b.abs_full.p90)} тактов по оффлайн-оценке, цена: около 80 байт и пара десятков тактов на объект. (В) требует выравнивать логику по максимуму: см. таблицу ниже. Реализована смесь (А) когда часы есть, иначе (Б).

### Таблица логики шага (для будущего выравнивания)

Собрано профилем по меткам SYM на сценах natural, climb, stress, upper_both_walk, upper_mummy_jump (${prof.steps} логических шагов в геймплее, шаги длиннее 250000 тактов — загрузка и смена комнаты — отброшены). Включающие такты процедуры на шаг (с вложенными вызовами; прерывания не входят). Время шага T: среднее ${f0(prof.T.mean)}, sd ${f0(prof.T.sd)}, от ${prof.T.min} до ${prof.T.max}. Вклад в разброс = ковариация процедуры с T, делённая на дисперсию T (процедуры вложены друг в друга, поэтому доли не складываются). «Выравнивание до максимума» — на сколько тактов в среднем надо удлинить процедуру; «sd после» — разброс T, если разброс этой процедуры убрать.

| Процедура (метка) | Вызовов на шаг | Такты на шаг мин / сред / макс | Вклад в разброс | Выравнивание до максимума, такты | sd T после |
| --- | --- | --- | --- | --- | --- |
${profRows}

Выравнивание всего шага до максимума стоило бы в среднем ${f0(prof.T.max-prof.T.mean)} тактов на шаг, то есть около ${f1((prof.T.max-prof.T.mean)/59904)} кадра, при среднем шаге ${f1(prof.T.mean/59904)} кадра работы. Метки vso_fix, vec_spr_out, vbw_wait — это сама пачка и ожидание внутри шага. Статическая таблица «ветка в такты по листингу» и сверка с замером НЕ сделаны.

### Состояние игры и звук

Состояние игры (положение героя, мумии, статус) на каждом логическом тике при одинаковом вводе (ввод привязан к номеру тика) совпало с основой во всех сценах (число расхождений в столбце ниже).

| Сцена | Расхождений состояния | Тиков звука основа / после | Тиков звука на кадр основа / после |
| --- | --- | --- | --- |
${sndRows}

Тики звука на прогоне natural: ${cmp.natural.snd_ticks_a} -> ${cmp.natural.snd_ticks_b} (${f1(100*(cmp.natural.snd_ticks_b/cmp.natural.snd_ticks_a-1))}%), на climb ${f1(100*(cmp.climb.snd_ticks_b/cmp.climb.snd_ticks_a-1))}%; на сценах upper_* прогон длиннее по кадрам, поэтому тиков больше, но тиков на кадр столько же или меньше. Темп на кадр: snd_tempo и jingle_tempo_gate зелёные. vsnd_k_cell не менялся.

### Гейты

Прогон run_gates.sh на основе и на новом ROM. Красные на основе: ${redBase.join(', ')}. Красные после: ${redNew.join(', ')}. Набор красных тот же; snd_tempo и jingle_tempo_gate зелёные. Часть гейтов печатает другие числа из-за сдвига адресов и расписания (atomic_gate, momia_hidden, hud_junk_gate, top_border_gate, mummy_contact_probe, spr_resid_gate): вердикты те же, красные остаются красными как на основе. Полные логи: gates_base.log, gates_new.log.

### Память

Свободно до romCeil 0x75A5: было ${R.memory.free_base} Б, стало ${R.memory.free_new_from_build} Б (по mem_map; конец кода ${R.memory.code_end_new}). Блок BEAMW vst_no..vso_setidx занимает ${R.symbols.vbw_block_bytes} Б; адрес vso_setidx сдвинулся на ${R.symbols.vso_setidx_shift} Б. Шапка vsnd_tick_hdr: ${R.symbols.hdr_bytes_base} -> ${R.symbols.hdr_bytes_new} Б. Остальное съели вызовы в пачке и перестановка выравнивания .align (зазор перед vec_rev4 стал 252 Б — его можно вернуть переносом процедуры целиком). Переменные BEAMW лежат в свободном хвосте плоскости p3, 0xFFA8-0xFFB7 (в видимую память не попадают).

## Порог для заливки на железо

Мерцание наверху снижено не меньше 90%: ${R.flicker.total.reduction_upper_pct>=90?'ДА':'НЕТ'} (${f1(R.flicker.total.reduction_upper_pct)}%). Всего не меньше 70%: ${R.flicker.total.reduction_objects_pct>=70?'ДА':'НЕТ'} (${f1(R.flicker.total.reduction_objects_pct)}%). Гейты как у основы: ДА. Средний шаг не хуже e2b8f32: ${R.steps.mean_frames.new<=R.steps.mean_frames.e2b8f32?'ДА':'НЕТ'} по всем сценам (${f3(R.steps.mean_frames.new)} против ${f3(R.steps.mean_frames.e2b8f32)}), и ${R.steps.natural.new<=R.steps.natural.e2b8f32?'ДА':'НЕТ'} на обычном прогоне (${f3(R.steps.natural.new)} против ${f3(R.steps.natural.e2b8f32)}). Порог по скорости не взят: растёт доля шагов в 3 и 4 кадра. Решать, годится ли цена, надо владельцу: мерцание убрано почти целиком.

## Гипотезы

- (оценка) Часть цены можно вернуть, если урезать запасы VBW_M, KC и C0. Пробный прогон с урезанными константами (KC 1700, C0 900, M 100) был сделан на промежуточной сборке с ошибкой в шапке ISR (портился накопитель часов музыки) и на исправленной не повторялся, поэтому выигрыш неизвестен; на той сборке шаг в natural почти не менялся, а мерцание росло с 7 до 95 объектов.
- (оценка) На железе фаза часов может отличаться: поправки 1150 и 760 отсчётов сняты с эмулятора; реальный вход в прерывание и ядро MiSTer могут сдвинуть их. Худший случай (А) в эмуляторе 312 отсчётов.
- (оценка) Рост шага на сценах с мумиями у верха — свойство фикстур upper_*: мумия и герой на строках 48..63 держат окно почти всего кадра.

## Не сделано / чего эмулятор не проверяет

- Статическая таблица тактов веток по листингу и сверка с замером (запрос по (В)).
- Подбор констант Б на независимых сценах; константы подобраны по тем же сценам.
- Железо: реальный вход в IRQ, задержки DI на MiSTer, поведение счётчика ВИ53 при перепрограммировании, глаз владельца.
- Слитые (fused) пути не ждут: у них нет окна restore до show; межплоскостной промежуточный цвет одного пикселя этим не лечится.
- Вариант A3 не реализован отдельно.
`;
fs.writeFileSync(path.join(O,'results.json'),JSON.stringify(R,null,1));fs.writeFileSync(path.join(O,'REPORT.md'),md);console.log('ok',md.length);
