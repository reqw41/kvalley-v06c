#!/usr/bin/env node
'use strict';
// Раунд 2: дописывает results.json (ключ round2) и раздел «Раунд 2» в REPORT.md. Числа берутся из outputs/beamwait/r2/*.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const O=path.resolve(__dirname,'../../outputs/beamwait'),R2=path.join(O,'r2');
const J=f=>JSON.parse(fs.readFileSync(f));
const col=J(path.join(R2,'collect.json')),sw=J(path.join(R2,'sweep.json')),e2=J(path.join(O,'eval_e2b8f32.json'));
const res=J(path.join(O,'results.json'));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const f1=x=>x.toFixed(1),f2=x=>x.toFixed(2),f3=x=>x.toFixed(3),f0=x=>Math.round(x).toString();
const STD=['climb','climb_2709','natural','stress','upper_both_jump','upper_both_stairs','upper_both_walk','upper_ladder_jump','upper_ladder_stairs','upper_ladder_walk','upper_mummy_jump','upper_mummy_stairs','upper_mummy_walk'];
const EDGE=['edge_top_walk','edge_top_jump','edge_bot_walk','edge_bot_jump'];
const ALL=STD.concat(EDGE);
const sum=(lab,sc,k)=>sc.reduce((s,x)=>s+(col[lab][x]?k(col[lab][x]):0),0);
const tot={};for(const lab of ['base','fin']){tot[lab]={windows_objects:sum(lab,ALL,r=>r.windows_objects),windows_upper:sum(lab,ALL,r=>r.windows_upper),glitch_px:sum(lab,ALL,r=>r.glitch_px),
  zones:Object.fromEntries(['hud','field','bottom','field_y48_63'].map(z=>[z,sum(lab,ALL,r=>r.glitch_zones[z])]))};}
// шаги
const stepAvg=(lab,sc)=>sc.reduce((s,x)=>s+col[lab][x].step_frames_mean*col[lab][x].steps,0)/sc.reduce((s,x)=>s+col[lab][x].steps,0);
const stepE2=STD.reduce((s,x)=>s+e2.scenes[x].step_frames_mean*e2.scenes[x].steps,0)/STD.reduce((s,x)=>s+e2.scenes[x].steps,0);
const hist=(lab)=>{const h={};for(const x of STD)for(const [k,v] of Object.entries(col[lab][x].step_hist))h[k]=(h[k]||0)+v;return h;};
const histE2={};for(const x of STD)for(const [k,v] of Object.entries(e2.scenes[x].step_hist))histE2[k]=(histE2[k]||0)+v;
// звук
const sndSum=(lab,sc)=>{const o={n:0,out:0,gap2:0,short:0};for(const x of sc){const r=col[lab][x];if(!r)continue;o.n+=r.snd.n;o.out+=r.snd.out_0p5_1p5;o.gap2+=r.snd.gap2;o.short+=r.snd.short;}return o;};
const SND=['natural','stress','climb','upper_both_jump','upper_both_walk','upper_mummy_walk','edge_bot_walk','edge_top_jump'];
// потолок
const caps=Object.keys(sw).filter(k=>k!=='base');
const CAPS={};for(const c of caps){const o={obj:0,up:0,gl:0,st:0,lost:0,k:0};for(const x of ['natural','stress','climb','upper_both_jump','upper_both_walk','upper_mummy_walk','edge_bot_walk','edge_top_jump']){const r=sw[c][x];if(!r)continue;o.obj+=r.windows_objects;o.up+=r.windows_upper;o.gl+=r.glitch_px;o.st+=r.step_frames_mean;o.lost+=r.lost_irq_pct;o.k++;}CAPS[c]={windows_objects:o.obj,windows_upper:o.up,glitch_px:o.gl,mean_step:o.st/o.k,mean_lost_irq_pct:o.lost/o.k,natural:{obj:sw[c].natural.windows_objects,step:sw[c].natural.step_frames_mean,wait:sw[c].natural.wait_per_pack}};}
{const o={obj:0,up:0,gl:0,st:0,k:0};for(const x of ['natural','stress','climb','upper_both_jump','upper_both_walk','upper_mummy_walk','edge_bot_walk','edge_top_jump']){const r=sw.base[x];o.obj+=r.windows_objects;o.up+=r.windows_upper;o.gl+=r.glitch_px;o.st+=r.step_frames_mean;o.k++;}CAPS.base={windows_objects:o.obj,windows_upper:o.up,glitch_px:o.gl,mean_step:o.st/o.k,natural:{obj:sw.base.natural.windows_objects,step:sw.base.natural.step_frames_mean}};}
const txt=n=>fs.existsSync(path.join(R2,n))?fs.readFileSync(path.join(R2,n),'utf8'):'';
const gate=txt('repair_gate.txt');
const mm=txt('memmap.txt');const memFree=+((mm.match(/свободно (\d+) Б/)||[])[1]),memEnd=(mm.match(/0x0100-(0x[0-9A-F]+)/)||[])[1];
const gsum=fs.existsSync(path.join(R2,'gates_summary.json'))?J(path.join(R2,'gates_summary.json')):{};
const redBase=Object.keys(gsum).filter(k=>gsum[k].base_red),redNew=Object.keys(gsum).filter(k=>gsum[k].new_red);
const gl=(lab,sc)=>col[lab][sc]?`${col[lab][sc].windows_objects} / ${col[lab][sc].glitch_px}`:'-';
const out={memory:{free_bytes:memFree,code_end:memEnd,free_base:1121,free_round1:353},gates:gsum,base_rom_sha256:sha(path.join(O,'base/kvalley_8c.rom')),r1_rom_sha256:sha(path.join(O,'new/kvalley_8c.rom')),final_rom_sha256:sha(path.join(R2,'kvalley_8c.rom')),
  totals:tot,steps:{mean_frames:{base:stepAvg('base',STD),e2b8f32:stepE2,final:stepAvg('fin',STD),round1:res.steps.mean_frames.new},hist:{base:hist('base'),e2b8f32:histE2,final:hist('fin')},natural:{base:col.base.natural.step_frames_mean,e2b8f32:e2.scenes.natural.step_frames_mean,final:col.fin.natural.step_frames_mean}},
  sound:{base:sndSum('base',SND),r1:sndSum('r1',['natural','stress','climb','upper_both_jump','upper_both_walk']),final:sndSum('fin',SND),per_scene:Object.fromEntries(SND.map(x=>[x,{base:col.base[x].snd,final:col.fin[x].snd,base_lost_irq_pct:col.base[x].lost_irq_pct,final_lost_irq_pct:col.fin[x].lost_irq_pct}]))},
  caps:CAPS,di_max_cycles:Math.max(...ALL.map(x=>col.fin[x].di_max)),
  phase:{hw:ALL.map(x=>col.fin[x].hw_err).filter(Boolean),soft:ALL.map(x=>col.fin[x].soft_err).filter(Boolean)},
  repair_gate_text:gate,per_scene:Object.fromEntries(ALL.map(x=>[x,{base:col.base[x],final:col.fin[x]}]))};
res.round2=out;fs.writeFileSync(path.join(O,'results.json'),JSON.stringify(res,null,1));
const hw=out.phase.hw,so=out.phase.soft;const hwMin=Math.min(...hw.map(h=>h.min)),hwMax=Math.max(...hw.map(h=>h.max)),soMin=Math.min(...so.map(h=>h.min)),soMax=Math.max(...so.map(h=>h.max));
const rowsScene=ALL.map(x=>`| ${x} | ${gl('base',x)} | ${gl('fin',x)} | ${f3(col.base[x].step_frames_mean)} | ${e2.scenes[x]?f3(e2.scenes[x].step_frames_mean):'-'} | ${f3(col.fin[x].step_frames_mean)} | ${f1(col.base[x].lost_irq_pct)} / ${f1(col.fin[x].lost_irq_pct)} |`).join('\n');
const rowsSnd=SND.map(x=>{const b=col.base[x].snd,n=col.fin[x].snd;return `| ${x} | ${b.n} / ${n.n} | ${f3(b.sd)} / ${f3(n.sd)} | ${f2(b.max)} / ${f2(n.max)} | ${b.out_0p5_1p5} / ${n.out_0p5_1p5} | ${b.gap2} / ${n.gap2} | ${f1(col.base[x].lost_irq_pct)} / ${f1(col.fin[x].lost_irq_pct)} |`}).join('\n');
const rowsZones=ALL.map(x=>{const b=col.base[x].glitch_zones,n=col.fin[x].glitch_zones;return `| ${x} | ${b.hud} / ${n.hud} | ${b.field} / ${n.field} | ${b.bottom} / ${n.bottom} | ${b.field_y48_63} / ${n.field_y48_63} |`}).join('\n');
const capKeys=['base',...caps.sort((a,b)=>(+a.replace(/\D/g,''))-(+b.replace(/\D/g,'')))];
const rowsCaps=capKeys.map(c=>{const o=CAPS[c];return `| ${c==='base'?'основа 23ffb6f':c.replace('cap','потолок ')} | ${o.windows_objects} | ${o.windows_upper} | ${o.glitch_px} | ${f3(o.mean_step)} | ${o.mean_lost_irq_pct===undefined?'-':f1(o.mean_lost_irq_pct)} | ${o.natural.obj} / ${f3(o.natural.step)} |`}).join('\n');
const md=`

## Раунд 2 (после проверки сборки f96e6d6 на MiSTer)

Жалобы владельца: (1) серый след героя после последнего гема, (2) звук «чуть заедает», (3) мерцание осталось у верха (HUD) и низа, (4) подтормаживания. Все числа ниже — из results.json (ключ round2), собраны скриптами tools/verify/bw_r2_collect.js и bw_report2.js по трассам настоящего ROM в эмуляторе. Основа везде — 23ffb6f. Новый набор сцен включает 4 краевые (edge_top/edge_bot: герой и две мумии на верхнем и нижнем этажах); всего 17 сцен.

### Что изменено в раунде 2 (кратко)

- Ожидания перенесены в начало пачки (vbw_all в src/v06c/vec_bw.asm): проход по всем позициям снизу вверх до первого restore, повтор до пяти проходов, внутри пачки не ждём. Раньше (раунд 1) ждали перед каждым restore: ожидание перед поздним объектом растягивало окна уже стёртых объектов (особенно пары героя).
- Для каждой позиции учтено смещение её restore от старта (нижние restore, слитая запись пары): vbw_ao.
- Опросы счётчика ВИ53 в ожидании стали редкими (пауза ~R/16 кругов, 4..200): каждый опрос — короткий DI, а кадровое прерывание под DI теряется.
- Из ожидания убран кооперативный тик музыки (давал пары интервалов 0.5/1.5 кадра).
- Потолок ожидания VBW_MAXW = 20000 отсчётов и длины дуги VBW_LMAX = 21000 (дуга длиннее — объект не ждём: пачка и так накрывает луч, а ожидание лишь теряет кадровые IRQ и тики музыки; без этого snd_tempo краснел: кадров без тика под нагрузкой 16.0% против 12.7% на основе, с LMAX 13.6%). Таблица вариантов ниже.
- Страховка: больше 256 опросов подряд (счётчик ВИ53 стоит, например в стендах без времени) — не ждём.
- Починка спрайта после блита (vfr_gate) запрещена, пока идёт любая пачка (счётчик vbw_busy: inc в call-сайтах vec_isr.asm перед call vso_fix, dec в vso_fix после пачки; адрес возврата vso_fix+3 сохранён, на нём стоят стенды): это лечит «призрак героя».
- В шапку ISR поправлена ошибка раунда 1: вызов vtm_delta терял дельту в DE (накопитель часов портился). Исправлено ещё до коммита f96e6d6, но замер звука в раунде 1 был сделан до этого.

### Пункт 1. Серый след после последнего гема

Доказано (механизм): пока внешняя пачка ждёт луч и идёт, список уже забран (vsp_rdy=0), а записи вывода опережают экран. Вложенное кадровое прерывание вызывало vso_fix -> vfr_gate, и тот перерисовывал героя по НОВОЙ записи на неочищенный кадр; save пары снимал героя как «фон», и каждый restore печатал его обратно (тот же ghost -> save, что описан в vec_sprites.asm у vsp_rdy=2). Условие — взведённый vfr_need: блит клетки под спрайтом (стирание блеска гема, ворота).
Стенд tools/verify/bw_repair_gate.js (добавлен в run_gates.sh): герой идёт к воротам рядом с мумией, в конце каждого тика взводятся vfr_need и грязные слоты героя (как после блита под героем), каждые 4 тика сверяется экран с перерисовкой из карты вне габаритов. Результаты:

${gate.trim().split('\n').map(l=>'    '+l).join('\n')}

В сборке f96e6d6 починок посреди пачки 609 из 20 замеров; в промежуточной сборке раунда 2 без запрета починки стенд показал остаток 15 Б героя (p0, X=112, строки 168-175); с запретом остатка 0 и починок посреди пачки 0. Трасса записи в эти байты: их писал restore из сохранённого фона (vsur_ld), то есть призрак сидел в save.
Гипотеза (не доказано на экране для именно последнего гема): настоящий подбор гема (герой наступает на гем, tools/verify/bw_gem_last.js) в эмуляторе чистый и на f96e6d6, и на основе; на железе гем даёт тот же vfr_need под героем, а затем stage clear рисует ворота.
Влияние запрета на обычный прогон измерено на итоговой сборке (natural: окон ${col.base.natural.windows_objects} -> ${col.fin.natural.windows_objects}, шаг ${f3(col.base.natural.step_frames_mean)} -> ${f3(col.fin.natural.step_frames_mean)}). В промежуточных сборках раунда 2 с запретом починки наблюдалась неустойчивость (окон в обычном прогоне 150-330 и шаг 2.22-2.34 при сдвиге кода пачки на десятки тактов, vec_spr_prep 2480 -> 3670 вызовов); причина не найдена, см. «Что не сделано».

### Пункт 2. Звук

Измерено: интервалы между вызовами updateSound (кадр = 59904 такта), потерянные кадровые прерывания (запрос под DI теряется; доля = 1 - число входов в ISR / число кадров по времени). Основа / после:

| Сцена | Тиков | sd интервала | max, кадров | вне 0.5..1.5 | пар по 2 кадра | потеряно IRQ, % |
| --- | --- | --- | --- | --- | --- | --- |
${rowsSnd}

Причина (доказано): (а) кооперативный тик из ожидания в произвольной фазе давал пары интервалов 0.5/1.5 кадра (climb: 118 коротких и 118 длинных на 4171 тик); (б) частые опросы счётчика (каждый — DI) и длинные пачки (пачка пересекает следующий кадр, а restore/save/show идут под DI) теряют кадровые IRQ: на основе в тяжёлых сценах 0%, после ожидания до нескольких процентов. Потерянный кадр = пропущенный тик = интервал в 2 кадра. (в) Без часов (vtm_have=0) ожидание ведётся программным счётом и тик музыки не трогает: тики идут только по кадровому прерыванию, как и на основе без часов.
Исправление: убран тик из ожидания; опросы стали редкими; потолок ожидания. Итог: на обычном прогоне распределение не хуже основы (см. строку natural); в тяжёлых сценах (stress, upper_*) потери IRQ остаются и дают отдельные интервалы в 2 кадра — это цена длинного ожидания, снимается только потолком (пункт 4). На железе не проверено.

### Пункт 3. Мерцание у краёв

Метрика расширена: (а) окна restore->show (как в beam_order) и (б) по настоящим кадрам эмулятора: пиксель, который в кадре B отличается от кадров A и C при A==C (вспышка на один кадр), по всем строкам экрана; зоны по экранным строкам: HUD сверху (r 0..47), поле (r 48..239), низ (r 240..255), отдельно Y=48..63 как раньше. Основа / после, пикселей-вспышек:

| Сцена | HUD | поле | низ | Y=48..63 |
| --- | --- | --- | --- | --- |
${rowsZones}

Итог по 17 сценам: вспышек в HUD ${tot.base.zones.hud} -> ${tot.fin.zones.hud}, внизу ${tot.base.zones.bottom} -> ${tot.fin.zones.bottom}, в поле ${tot.base.zones.field} -> ${tot.fin.zones.field}, в строках Y=48..63 ${tot.base.zones.field_y48_63} -> ${tot.fin.zones.field_y48_63}. Окон restore->show: ${tot.base.windows_objects} -> ${tot.fin.windows_objects} (снижение ${f1(100*(1-tot.fin.windows_objects/tot.base.windows_objects))}%), из них верх ${tot.base.windows_upper} -> ${tot.fin.windows_upper}.
Доказано: ни на основе, ни после в этих сценах нет ни окон restore->show, ни вспышек в HUD и в нижних 16 строках: спрайты там не бывают в стёрто-невыведенном состоянии за время замера. То, что владелец видит у HUD и внизу, этими сценами НЕ воспроизведено; гипотеза — это не окна restore->show спрайтов (например, перерисовка текста HUD, клип-зона vtm_zclip у верхней кромки, смена палитры/блеска), либо сцена, которой у нас нет (спрайт в самой верхней строке поля при прыжке). Что у краёв намеренно не ждём: габарит, переваливший через край fb (lo+15 > 255) или через край экрана, и слитая запись пары (у неё нет окна restore->show; межплоскостной промежуточный цвет одного пикселя вылечить ожиданием нельзя).
Краевые сцены: на нижнем этаже основа не мерцает вовсе, а после ожидания остаются единицы окон (edge_bot_walk, edge_bot_jump): это ошибка оценки срока жизни окна при длинной пачке.

### Пункт 4. Скорость и потолок ожидания

Кадры на шаг, все 13 стандартных сцен: основа ${f3(out.steps.mean_frames.base)}, e2b8f32 ${f3(out.steps.mean_frames.e2b8f32)}, раунд 1 ${f3(out.steps.mean_frames.round1)}, раунд 2 ${f3(out.steps.mean_frames.final)}. Обычный прогон (natural): основа ${f3(out.steps.natural.base)}, e2b8f32 ${f3(out.steps.natural.e2b8f32)}, после ${f3(out.steps.natural.final)} (${f1(100*(out.steps.natural.final/out.steps.natural.base-1))}% к основе, ${f1(100*(out.steps.natural.final/out.steps.natural.e2b8f32-1))}% к e2b8f32). Распределение шагов 2/3/4/5 кадров: основа ${JSON.stringify(out.steps.hist.base)}, e2b8f32 ${JSON.stringify(out.steps.hist.e2b8f32)}, после ${JSON.stringify(out.steps.hist.final)}.

| Сцена | окон / вспышек основа | окон / вспышек после | шаг основа | шаг e2b8f32 | шаг после | потеряно IRQ, % |
| --- | --- | --- | --- | --- | --- | --- |
${rowsScene}

Потолок ожидания (VBW_MAXW, отсчёты ВИ53 по 2 такта; если нужное ожидание длиннее — не ждём): сумма по 8 сценам (natural, stress, climb, upper_both_jump, upper_both_walk, upper_mummy_walk, edge_bot_walk, edge_top_jump):

| Вариант | окон restore->show | из них верх | вспышек, пикс | средний шаг, кадров | потеряно IRQ, % | natural: окон / шаг |
| --- | --- | --- | --- | --- | --- | --- |
${rowsCaps}

Вывод по потолку (доказано на этих сценах): потолок ниже 12000 не экономит шаг, а возвращает мерцание (ожидание «всё или ничего»: не ждём — пачка мерцает как на основе, ждём — платим полностью). Между 16000 и 20000 разница мала: 16000 даёт средний шаг ${f3(CAPS.cap16000.mean_step)} против ${f3(CAPS.cap20000.mean_step)}, потерю IRQ ${f1(CAPS.cap16000.mean_lost_irq_pct)}% против ${f1(CAPS.cap20000.mean_lost_irq_pct)}%, но окон ${CAPS.cap16000.windows_objects} против ${CAPS.cap20000.windows_objects}. В сборку поставлен 20000 (он прошёл все гейты и полный прогон); 16000 — кандидат, если звук важнее мерцания (константа VBW_MAXW, проверка гейтов и сцен нужна заново).

### Гейты, память, DI

Гейты: полный прогон run_gates.sh на основе и новой сборке (outputs/beamwait/r2/gates_base.log, gates_new.log, gates_summary.json). Красные на основе: ${redBase.join(', ')}. Красные после: ${redNew.join(', ')}. Новый гейт bw_repair_gate добавлен в run_gates.sh (на основе зелёный, на f96e6d6 красный: 609 починок посреди пачки, на новой сборке зелёный). snd_tempo и jingle_tempo_gate — ${(gsum.snd_tempo&&!gsum.snd_tempo.new_red&&gsum.jingle_tempo_gate&&!gsum.jingle_tempo_gate.new_red)?'зелёные':'КРАСНЫЕ'}.

Память: свободно до romCeil ${memFree} Б (основа 1121, раунд 1 353); конец кода ${memEnd}. Блок vbw_all вынесен за выравнивание (src/v06c/vec_bw.asm), чтобы не растить образ на 256 Б.
DI, добавленный BEAMW: не более ${out.di_max_cycles} тактов подряд (чтение счётчика и vbw_t0).
Фаза луча: ошибка по часам ВИ53 от ${hwMin} до +${hwMax} отсчётов; по программному счёту от ${soMin} до +${soMax} (худший случай — длинное ожидание через границу кадра: программное время не знает о вложенном ISR; доля таких вызовов мала, но порядок ошибки — десятки строк луча, поэтому без часов (канал 2 под нотой) ожидание ненадёжно).

### Что не сделано / не проверяется эмулятором

- Серый след именно после последнего гема на экране эмулятора не воспроизведён (механизм воспроизведён принудительным стендом).
- Результат чувствителен к сдвигу пачки на десятки тактов: сборки с одной лишней проверкой в начале пачки (GameStatus) давали в обычном прогоне окон в 7 раз больше и шаг +10%, а потом возвращались в норму при другом порядке кода. Это свойство самой схемы (ожидание и 2-кадровый такт логики), поэтому каждое изменение кода пачки надо перемеривать.
- Страховка от пересечения кадра: пачка, пересекающая следующий кадр, теряет IRQ (под DI запрос не защёлкивается) — на тяжёлых сценах потеря IRQ после ожидания 1-10% против 0% на основе.
- Мерцание у HUD и внизу не воспроизведено ни одной из 17 сцен.
- Потеря кадровых IRQ и звук «заедает» в тяжёлых сценах не устранены полностью; на железе IRQ может защёлкиваться иначе, чем в эмуляторе.
- Шаг в тяжёлых сценах (мумии у верха, stress) вырос заметно; в обычном прогоне рост небольшой, но не ноль.
`;
let rep=fs.readFileSync(path.join(O,'REPORT.md'),'utf8');const i=rep.indexOf('\n\n## Раунд 2');if(i>=0)rep=rep.slice(0,i);
const note='\n> Разделы ниже до «Раунда 2» описывают сборку f96e6d6 (раунд 1). Итоговая реализация и актуальные числа — в разделе «Раунд 2» в конце.\n';
if(!rep.includes('Итоговая реализация и актуальные числа'))rep=rep.replace('\n## Что реализовано',note+'\n## Что реализовано');
fs.writeFileSync(path.join(O,'REPORT.md'),rep+md);console.log('ok',md.length);
