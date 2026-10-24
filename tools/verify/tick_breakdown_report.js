#!/usr/bin/env node
'use strict';
// All reported measurements and numeric estimates are read from results.json.
const fs=require('fs'),path=require('path');
const names={outer_head:'1. Шапка внешнего ISR',outer_pack:'2. vso_fix, глубина 1',game_logic:'3. runGame без подготовки/сервисного звука',sprite_prep:'4. Подготовка спрайтов/списка',nested_head:'5а. Вложенный ISR: шапка/эпилог',nested_sound:'5б. Вложенный ISR: звук',nested_pack:'5в. Вложенный ISR: vso_fix',tail_control:'6. Диспетчеризация, tickMain2, внешний эпилог',idle_main:'MAIN/ожидание вне ISR'};
const stageNames={detect:'Детектор изменений F',sticky_merge:'Sticky/dirty',overlap_propagation:'Распространение пересечений P',build_objects:'Обход объектов и выбор режима',geometry_shift_buffers:'vec_spr_prep: геометрия, сдвиги и буферы',fast_path_decision:'vsp_fastmark: выбор быстрого пути',sort_order:'Сортировка вывода',pair_decision:'vpr_scan: выбор пары/перекрытия',finalize:'Завершение списка'};
const cls={horizontal:'Горизонтальное движение',vertical:'Вертикальное движение',width_change:'Смена ширины/числа плоскостей',intersection:'Пересечение',standing:'Стояние',other:'Комбинированное движение/смена плоскости'};
function generate(file){
 const r=JSON.parse(fs.readFileSync(file)),out=[];
 const n=x=>Number.isInteger(x)?String(x):x.toFixed(2),tri=x=>`${n(x.mean)} / ${n(x.median)} / ${n(x.p90)}`;
 const hex=x=>'0x'+x.toString(16).toUpperCase(),add=s=>out.push(s);
 function table(headers,rows){add('| '+headers.join(' | ')+' |\n| '+headers.map(()=>'---').join(' | ')+' |\n'+rows.map(row=>'| '+row.join(' | ')+' |').join('\n'));}
 add('# Стоимость тика и оценка частичного сейва\n');
 add(`Ветка 3p, сборка ${r.build}. ROM SHA256: \`${r.rom_sha256}\`. SYM SHA256: \`${r.sym_sha256}\`. Единственный источник чисел этого отчёта — соседний \`results.json\`; отчёт создаёт \`tools/verify/tick_breakdown_report.js\`.\n`);
 add('## Доказано\n');
 add(`Воспроизведение из корня checkout:\n\n\`\`\`sh\n${r.command}\n\`\`\`\n\nКоманда создаёт results.json и затем REPORT.md из него. Никакие файлы игры не пересобираются. Хеши всех файлов src/, build/, devector/ до и после совпали: **${r.protected_unchanged?'да':'НЕТ'}**. Исходный драйвер perf_baseline_1205.js прочитан в памяти; его SHA256: \`${r.driver_sha256}\`. Звук не отключается, код AI и ROM в эмуляторе не патчатся.\n`);
 add('### Что именно измерено и как замыкается учёт\n');
 add(`Один шаг части А — внешний ISR, в котором действительно началась логика: от кадрового запроса до RET внешнего ISR. Время ожидания принятия IRQ входит в шапку отдельным полем request_wait; аппаратный DI/RST7 учитывается по реализации tv.js. Цена инструкции берётся из cpu.vcycles после исполнения; классификация сделана по активной глубине ISR и входу/возврату процедуры (PC + возвратный адрес + SP). Дочерние CALL/JP остаются в контексте процедуры; вложенный IRQ создаёт отдельный контекст и не оплачивается второй раз подготовкой или runGame.\n\nНезависимый контроль — развёрнутая растровая координата после фактического выхода из ISR. Проверяются и сумма инструкционных статей против CPU-времени, и та же сумма против растрового времени. Суммировать медианы разных статей нельзя: замыкание проверено на каждом сыром шаге. Все шаги лежат в results.json.\n`);
 add(`Длинный шаг: ${r.long_step_definition}. Кадр: **${n(r.frame_cycles)} тактов**. interval_frames — разность номеров видеокадров фактических стартов, без округления длительности; точные interval_cycles и interval_frames_fractional сохранены. Для последнего шага драйвер дренируется до следующего старта с тем же вводом; метрики исторического baseline не включают дренаж.\n`);
 add('Внешние ISR без запуска логики не принадлежат окну «запрос→RET логического ISR». Они сохранены отдельно в nonlogic_external_isrs. Чтобы их стоимость не исчезла, для каждого шага дополнительно замкнут полный интервал старт→следующий старт: interval_articles включает эти ISR, вложенные IRQ и ожидание MAIN. Именно по этому интервалу распределена экономия сейва на шаг.\n');
 add('Границы: vso_fix включает vec_spr_out и хвост починки vfr_gate; учтены все текущие писатели через memory.write в трёх видимых плоскостях. Подготовка начинается на vec_nat_sprites и заканчивается записью vsp_rdy=1; при раннем выходе — реальным возвратом. Её дочерние функции учтены эксклюзивно. Внешний звук до пачки входит в шапку; служебный звук tickMain/кооперативный звук — в диспетчеризацию. «runGame» в статье 3 включает вызываемые им фоновые блиты, но не подготовку и не служебный звук: это не только AI. Статья 6 также содержит chkControls и пролог tickMain, чтобы ни один такт не остался вне заданных статей.\n');
 table(['Проверенный старый скрипт','Почему не использован как готовое разложение'],[
 ['tick_profile.js','Пачка заканчивается на vso_prev; nearest-PC и префиксы смешивают vop_* подготовки/вывода, исключают большие растровые дельты; нет замыкания внешнего ISR.'],
 ['logic_prof.js','Фильтр RT по префиксам; отключён soundStep; старые наборы имён и нет вложенного эксклюзивного учёта.'],
 ['r2_tick_breakdown.js','Другой ROM/движок r2; другие символы, soundStep отключён.'],
 ['pack_prof.js','Берёт настоящие vcycles, но граница vso_fix+3 заканчивает на vfr_gate до починки; нет полного тика/эксклюзивного вложенного учёта.']]);
 for(const [label,s]of Object.entries(r.scenes)){
  add(`\n### ${label==='stress'?'Стресс: герой + две мумии наверху':'Обычный прогон с переходами экранов'}\n`);
  add(`Завершённых тиков: **${s.summary.all.n}**. Исходный драйвер: ${s.baseline.scene}; условия: ${s.baseline.ram_note}. Счётчик аппаратных кадров исходного прогона: **${s.baseline.counters.hardware_frames_total}**, игровых кадров: **${s.baseline.counters.hardware_frames_gameplay}**. Это тот же ввод по завершённым игровым тикам, что в прежнем baseline.\n`);
  table(['Замыкание','Расхождение'],[['Максимальная ошибка CPU, такты',n(s.closure.max_absolute_cycles)],['Максимальная ошибка CPU, %',n(s.closure.max_relative_pct)],['Максимальная ошибка независимого растра, такты',n(s.closure.max_raster_absolute_cycles)],['Максимальная ошибка независимого растра, %',n(s.closure.max_raster_relative_pct)]]);
  add('\nЗначения ячеек: **среднее / медиана / p90**, такты.\n');
  table(['Статья','Все шаги','Длинные шаги','Интервал ровно четыре кадра'],Object.keys(names).filter(k=>k!=='idle_main').map(k=>[names[k],tri(s.summary.all.articles[k]),tri(s.summary.long.articles[k]),tri(s.summary.four_frames.articles[k])]));
  add(`\nРазмеры выборок: все ${s.summary.all.n}, длинные ${s.summary.long.n}, четырёхкадровые ${s.summary.four_frames.n}. Для пустой выборки n=0, числовые поля нулевые.\n`);
  table(['Интервал до следующего старта, кадры','Шагов'],Object.entries(s.summary.all.interval_hist));
  add('\nПодготовка по стадиям, без вложенных ISR:\n');
  table(['Стадия','Все','Длинные','Четырёхкадровые'],Object.keys(s.summary.all.prep_stages).map(k=>[stageNames[k]||k,tri(s.summary.all.prep_stages[k]),tri(s.summary.long.prep_stages[k]),tri(s.summary.four_frames.prep_stages[k])]));
  add('\nТри самые дорогие стадии подготовки по сумме тактов: '+s.top_prep_stages.map(x=>`${stageNames[x.name]||x.name} (${n(x.per_step)} тактов/шаг)`).join('; ')+'.\n');
  add('\nСтоимость полного интервала старт→следующий старт (включая внешние ISR без логики и MAIN):\n');
  table(['Статья','Все','Длинные'],Object.keys(names).map(k=>[names[k],tri(s.summary.all.interval_articles[k]),tri(s.summary.long.interval_articles[k])]));
  const nested=s.steps.flatMap(x=>x.nested_inside_tick),fired=nested.filter(x=>x.pack_fired).length;
  add(`\nВложенных кадров внутри тика: **${nested.length}**; рабочая пачка сработала в **${fired}**, не сработала в **${nested.length-fired}**. На каждом шаге сохранены ordinal, depth, ready и pack_ids. Пачка перед логикой в том же внешнем ISR: **${s.steps.filter(x=>x.pack_before_logic).length}** шагов. Покрытие текущих входов: `+Object.entries(s.writer_coverage.checks).map(([k,v])=>`${k}=${v?'наблюдался':'не встретился'}`).join(', ')+'. Все framebuffer-писатели, включая vop_ow/vop_row, зарегистрированы независимо от имени.\n');
  const hot={};for(const x of s.steps)for(const [k,c]of Object.entries(x.prep_labels))hot[k]=(hot[k]||0)+c;
  table(['Горячий участок подготовки по PC','Тактов/шаг'],Object.entries(hot).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,c])=>[k,n(c/s.steps.length)]));
  if(label==='natural'){
   add('\nИгровой участок отдельно от перестройки экранов (logic_gs=5):\n');
   table(['Статья','Игровые длинные','Игровые четырёхкадровые'],Object.keys(names).filter(k=>k!=='idle_main').map(k=>[names[k],tri(s.summary.gameplay_long.articles[k]),tri(s.summary.gameplay_four.articles[k])]));
   add(`\nИгровых шагов всего ${s.summary.gameplay.n}; игровых длинных ${s.summary.gameplay_long.n}, четырёхкадровых ${s.summary.gameplay_four.n}. В смешанном прогоне длительная перестройка сцен входит в runGame, поэтому общая средняя не является средней стоимостью AI.\n`);
  }
 }
 const st=r.scenes.stress;
 add('\n### Сверка прежних медиан\n');
 table(['Метрика стресса','Раньше','Теперь','Объяснение'],[['Логический тик',n(r.references.stress_logic_median),n(st.summary.all.logic_elapsed.median),'Разница равна явному учёту DI/RST7, отсутствующему в старом TT, который суммировал только cpu.instruction.'],['Рабочая пачка исходного baseline',n(r.references.stress_pack_median),n(st.baseline.packs.duration.median),'Исходный измеритель и окно пачки сохранены.']]);
 add(`\nПовтор стресса: полный набор сырых шагов и событий save/restore совпал: **${st.reproducibility?.steps_and_events_exact?'да':'не выполнен'}**. Проверка неизменности охватывает src/, build/, devector/ по protected_manifest, не только измеряемый ROM.\n`);
 add('### Полный сейв и наблюдаемые геометрии\n');
 add('Для каждого save/restore сохранены объект, старый слот на входе пачки, новый габарит, отдельные плоскости (plane, col, lo, ncols), пересечения по старому и новому габаритам участников, фактические собственные такты процедуры и счётчики чтений. lo адресуется циклически внутри страницы; геометрия не берётся из чужого слоя героя. Для нового save используется hi0b из +0x9A, для проверки соседнего draw — +0x9F. Это важно для дедупа.\n');
 for(const [label,s]of Object.entries(r.scenes)){
  const es=s.all_packs.flatMap(p=>p.events).filter(e=>e.operation==='save');
  table([label,'Вызовов','Среднее / медиана / p90 тактов'],[['Фактический полный save',es.length,tri(stats(es.map(e=>e.cycles)))],['Фактический restore',s.all_packs.flatMap(p=>p.events).filter(e=>e.operation==='restore').length,tri(stats(s.all_packs.flatMap(p=>p.events).filter(e=>e.operation==='restore').map(e=>e.cycles)))]]);
  const empirical=[...new Set(es.filter(e=>e.reads>0).map(e=>e.kernel_cycles/e.reads))].sort((a,b)=>a-b);add(`\nЦена тела сейва по исполненной трассе (kernel_cycles / реально прочитанные байты): **${empirical.map(n).join(', ')} тактов/байт**. Заголовки и управление столбцами в это тело не входят, но входят в полную цену процедуры.\n`);
  add(`\nНесовпадений количества ожидаемых байтов save и реально прочитанных из framebuffer: **${s.partial_save.summary.read_coverage_failures}**. Полная цена save взята из исполнения текущего ROM, а не из арифметической модели.\n`);
 }
 add('## Гипотезы\n');
 add('### Цена частичного сейва: модель, не выполненная оптимизация\n');
 const m=st.partial_save.instruction_model;
 add(`Стоимость инструкций взята из того же i8080-ядра на отдельном пустом microbenchmark CPU; загруженный игровой ROM не меняется. На Векторе POP DE стоит ${r.instruction_costs.pop_d.cycles}, MOV M,E / INR L / MOV M,D / INR L — по ${r.instruction_costs.mov_m_e.cycles}. Полный развёрнутый сейв: (${r.instruction_costs.pop_d.cycles} + ${r.instruction_costs.mov_m_e.cycles} + ${r.instruction_costs.inr_l.cycles} + ${r.instruction_costs.mov_m_d.cycles} + ${r.instruction_costs.inr_l.cycles}) / 2 = **${m.full_pop_byte} такта/байт**.\n`);
 add(`Перенос внутри слота: MOV A,M + STAX D + INX D + INR L = ${r.instruction_costs.mov_a_m.cycles+r.instruction_costs.stax_d.cycles+r.instruction_costs.inx_d.cycles+r.instruction_costs.inr_l.cycles} такта/байт; развёртка на четыре байта добавляет (DCR C + JNZ)/четыре = ${(r.instruction_costs.dcr_c.cycles+r.instruction_costs.jnz_taken.cycles)/4}, итого **${m.unrolled_copy_byte}**. Та же форма уже есть у vsm_p2u/vsm_p2d. Петля переменной длины для края: ${m.loop_recipe} = **${m.loop_copy_byte}**. Даже оптимистический перенос POP-ядром стоит не меньше полного сейва на тот же байт.\n`);
 add(`Накладные полного save для каждого события: F − ${m.full_pop_byte}×N, где F — реальный эксклюзивный профиль процедуры, N — реально прочитанные байты. Они сохраняются у частичного пути, включая шапку слота и инвалидирование ZFLAG; пропускается только тело повторного чтения. Геометрические проверки: ${m.guard_recipe} = **${m.guard_cycles}** тактов. Проверка пересечений дополнительно оплачивается на каждого другого участника явной последовательностью полевых сравнений; стоимость лежит в model.intersection_check_cycles. Это консервативный эскиз, а не доказанный минимум. Проверки early-exit и будущая сборка могут изменить цену.\n`);
 add('Формулы: общий байтовый участок O, новые края E, перемещаемые байты M. Если физический габарит не изменился, M=0 и E=0, данные остаются на месте. Иначе M=O. Цена частичного пути = накладные полного save + геометрические проверки + цена переноса×M + цена чтения×E + setup столбцов. Restore не сокращается: порядок очистки и общий фронт сейвов остаются прежними.\n');
 add('Вариант «перенос+края» — геометрическая оценка без проверки пересечений, **не безопасный путь**. Вариант с отказом — полный save при invalid, смене ширины/плоскостей, пересечении, завороте или отсутствии общего участка; проверки оплачиваются и при отказе. Оптимистический столбец — только нижняя оценка цены байтового ядра, не вариант для реализации. Частичный перенос уже существует в vsm_ph3 слитого пути; здесь моделируются только реально исполненные полные save, а не повторное добавление этой оптимизации.\n');
 for(const [label,s]of Object.entries(r.scenes)){
  add(`### Окупаемость: ${label}\n`);const z=s.partial_save.summary;
  table(['Вариант','Экономия на рабочую пачку: среднее / медиана / p90'],[['Перенос+края без проверки пересечений',tri(z.partial_saving)],['С отказом на полный save',tri(z.guarded_saving)],['Оптимистический предел байтового ядра',tri(z.optimistic_saving)]]);
  add(`\nЭкономия положительна, потеря отрицательна. С отказом на шаг: **${tri(z.guarded_per_step)}** тактов. Применим хотя бы к одному save в ${z.eligible_packs} из ${z.packs} рабочих пачек (**${n(z.eligible_pack_pct)}%**); это геометрическая применимость, а не доля прибыльных пачек. Пачки уже слитого пути без полного save дают нулевую экономию.\n`);
  table(['Класс','Вызовов','Применим','Полный save','Экономия с отказом','Предельная цена проверок'],Object.entries(s.partial_save.classes).map(([k,c])=>[cls[k],c.n,c.eligible,tri(c.full),tri(c.guarded_saving),tri(c.break_even_checks)]));
 }
 add('Предельная цена проверок — полный save минус цена переноса/краёв без геометрических проверок. Отрицательный предел означает, что перенос не окупается даже при бесплатных проверках. Для положительного предела будущий код обязан проверить всё дешевле этой суммы.\n');
 add('Классы взаимоисключающие: сначала пересечение, затем смена ширины/числа плоскостей, затем горизонтальное/вертикальное движение и стояние; остальные — комбинированные случаи/смена плоскости. Движение учитывается по старым координатам vec_nsp_prev и новым координатам записи вывода, поэтому движение внутри одного байтового габарита не записывается ошибочно в стояние.\n');
 add('### Размер кода и ограничения\n');
 table(['Резерв текущего ROM','Байты','Границы'],[['Перед .align',r.memory.align_free,`${hex(r.memory.align_gap_start)}–${hex(r.memory.align_gap_end-1)}`],['До romCeil',r.memory.rom_free,`${hex(r.memory.resident_end)}–${hex(r.memory.romCeil-1)}`]]);
 table(['Блок оценочного эскиза','Байты'],Object.entries(m.size_estimate.blocks).concat([['Итого',m.size_estimate.estimated_total_bytes]]));
 add(`\nЭто бюджет по длинам инструкций (geometry_offsets содержит регистровые MOV и непосредственные ALU-команды), не собранная и проверенная процедура. Он превышает pre-align резерв ${r.memory.align_free} байтов и номинально помещается в post-align резерв ${r.memory.rom_free}; размещение scratch, реентерабельность, реальные ветвления и фактический конец кода ещё не доказаны. Тактовая оценка не является доказательством отсутствия следов.\n`);
 add('### Сверка с «мёртвым» от 21.09\n');
 table(['Старый неудачный путь','Отличие/условие нового предположения'],[
 ['skip-restore + RMW без slb','Restore сохраняется целиком; старый спрайт очищается штатно. Экономится только повторное чтение фона. Корректность будущего кода ещё требует oracle.'],
 ['far-mummy LAST / LAST с начала / first-col prep / X&7 / floor skip','Ни порядок LAST, ни геометрия вывода, ни режим непрозрачности не меняются; подбайтовое движение лишь учитывается в трассе.'],
 ['self-mod vcm_or/vcm_andn','Модель не добавляет композитора и не патчит чужие CALL.'],
 ['save-only 3-plane strip','Близкий риск: геометрии и границы разных плоскостей сохраняются отдельно, шапка и ZFLAG оплачены; пересечения/смена ширины дают fallback. Без проверки полного фонового слота не считается безопасным.'],
 ['vcm_sk в занятом scratch','Никакой scratch не выделен; цена/безопасность будущего размещения не доказана.'],
 ['ld b,a до push bc','Измеритель не меняет регистры игры; производственный цикл должен сохранить счётчики.'],
 ['код за romCeil / переполнение pre-align / большой post idx-check','Показаны текущие отдельные резервы; pre-align для эскиза недостаточен, сборку не запускали.'],
 ['skip без valid мумии / без валидного фона','Невалидный слот и пересечение — отказ; требуется валидный старый clean-background слот.'],
 ['принудительный vpr_sl=LAST','Флаги пары и порядок вывода не трогаются.'],
 ['skip поверх фонового блита двери','Штатные restore и fixup остаются; для реализации отдельно проверить dirty-фон и свежесть слота, даже при неизменном bbox.']]);
 add('### Вывод\n');
 const worst=sc=>Object.entries(sc.summary.long.articles).sort((a,b)=>b[1].mean-a[1].mean)[0];
 const w=worst(st);add(`На стрессовых длинных шагах самая дорогая статья — **${names[w[0]]}**, среднее **${n(w[1].mean)}**, медиана **${n(w[1].median)}** тактов. Это измеренный приоритет для следующего анализа. Внутри подготовки первым смотреть ${stageNames[st.top_prep_stages[0].name]||st.top_prep_stages[0].name}.\n`);
 const nat=r.scenes.natural;if(nat){const a=worst(nat),b=Object.entries(nat.summary.gameplay_long.articles).sort((a,b)=>b[1].mean-a[1].mean)[0];add(`В смешанном обычном прогоне на длинных шагах по среднему крупнейшая статья — ${names[a[0]]} (${n(a[1].mean)} тактов); в игровом участке GS=5 — ${names[b[0]]} (${n(b[1].mean)} тактов). Переходы экранов нельзя использовать как аргумент переписывать AI.\n`);}
 add(`Предложенный общий частичный сейв **не окупается в консервативном оценочном варианте с проверками**: на стрессе медиана экономии на пачку **${n(st.partial_save.summary.guarded_saving.median)}** тактов`+(nat?`, в обычном прогоне среднее на пачку **${n(nat.partial_save.summary.guarded_saving.mean)}**`:``)+`. Возможный более узкий кандидат — сохранение уже правильного слота при неизменном физическом габарите и дешёвом доказательстве свежести. Это отдельная гипотеза: её цену и отсутствие следов ещё надо проверить. Планировщик и композит остаются отложенными.\n`);
 add('Никакой новой отрисовки не выполнялось; число дефектных верхних кадров для гипотетического пути не измерялось. Из экономии тактов нельзя выводить устранение мерцания. Принятых изменений игры нет.\n');
 fs.writeFileSync(path.join(path.dirname(file),'REPORT.md'),out.join('\n')+'\n');
}
function stats(a){const b=a.slice().sort((a,b)=>a-b);return {mean:b.length?b.reduce((s,x)=>s+x,0)/b.length:0,median:b.length?b[Math.floor(b.length*.5)]:0,p90:b.length?b[Math.min(b.length-1,Math.floor(b.length*.9))]:0};}
module.exports={generate};if(require.main===module)generate(process.argv[2]||path.resolve(__dirname,'../../docs/tick_breakdown/results.json'));
