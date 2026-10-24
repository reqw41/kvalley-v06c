// Задача #5: ГЕЙТ «НЕТ ШЛЕЙФА» (T_resid). Две проверки на КАЖДУЮ пачку vec_spr_out:
//  A) КОМПОЗИЦИЯ. Снимок fb на ВХОДЕ в пачку, на него накладывается НЕЗАВИСИМАЯ JS-модель
//     ВСЕХ операций пачки в порядке их выполнения: vec_su_restore (данные слота обратно в
//     fb по габариту шапки) и vec_spr_show (OR по hi0/hi0b, ANDN по hi0c). В конце пачки
//     модель обязана совпасть с настоящим fb байт-в-байт. Байты, которые пишет СЛИТАЯ
//     запись, из сравнения исключены — их побайтно проверяет пункт D.
//  B) ЧИСТОТА SAVE-UNDER (это и есть корень шлейфа). Сохранённый в слоте «фон» обязан
//     совпадать с ЧИСТЫМ фоном в габарите слота (тот же снимок плюс одни лишь стирания,
//     без спрайтов). Если сейв объекта снял пиксели
//     уже НАРИСОВАННОГО соседа (герой = слоты 4+5 в одной точке, обе пишут p2), то на
//     следующем кадре restore вернёт их в fb => шлейф. Именно так падал снятый быстрый путь.
//
// ПОКРЫТИЕ (2026-08-02). Все проверки ниже условны: они срабатывают, только если движок
// дошёл до соответствующего пути. Проверка, не отработавшая НИ РАЗУ, «зелена» бессодержательно
// — поэтому в конце стоит таблица ДЕКЛАРАЦИЙ: сколько раз проверка ОБЯЗАНА отработать.
// [2026-08-06, ЗАДАЧА#53 ОСТАТОК] СДВИГ ПО СТОЛБЦАМ И СМЕНА ШИРИНЫ — ЖИВЫЕ ПУТИ. Прежде
// здесь стояла обратная декларация «ожидается РОВНО НОЛЬ»: столбцовый эксперимент шага 5
// задачи #37 был замерен и отвергнут (рваные строки 200 -> 3920 на СТОЛБЦОВОМ ядре).
// Переезд вернулся на ПОСТРОЧНОМ ядре vsb_mrow и с гейтом вложенности габаритов
// (новый обязан накрывать старый по столбцам), поэтому обе декларации переведены в живые:
// min 1, и теперь их поломку заметит именно этот гейт.
// Запуск: node tools/verify/spr_resid_gate.js [rom] [sym] [frames]
// Образ — ТЕКУЩАЯ сборка. Прежний дефолт tools/verify/base5.rom был локальным снимком
// задачи #5 и в репозиторий никогда не входил: без аргументов гейт падал на ENOENT,
// не открыв эмулятор. Это не эталон для сравнения (гейт строит модель сам), а просто
// протухший путь. Обновлять «эталон» не нужно — гейт сторожит текущий движок.
const {make,toGame}=require("./beam_harness.js");
const fs=require("fs");
let ROM="build/kvalley_8c.rom", SYM="build/kvalley_8c.sym", NF=9000;
for(const a of process.argv.slice(2)){
  if(a==="--explain") continue;
  if(/\.sym$/i.test(a)){ SYM=a; continue; }
  if(/\.rom$/i.test(a)){ ROM=a; continue; }
  if(/^\d+$/.test(a)){ NF=+a; continue; }
  console.error("не понял аргумент «"+a+"»: ожидались .rom, .sym или число кадров");
  process.exit(2);
}
if(!fs.existsSync(ROM)){console.error("нет образа "+ROM+" — сначала ./build.sh");process.exit(2);}
if(!fs.existsSync(SYM)){console.error("нет символов "+SYM);process.exit(2);}
// СТИМУЛ (2026-08-06). Ввод — псевдослучайная прогулка, поэтому ПОКРЫТИЕ у неё хрупкое:
// любая правка, меняющая такты, уводит траекторию в другие пирамиды. После перестановки
// пары в начало пачки прежний стимул (чит N раз в 500 кадров, 3000 кадров) перестал
// доходить до НЕПРОЗРАЧНОЙ МУМИИ в слитой пачке, и декларация «многоплоскостный объект»
// осталась пустой — при том, что сам путь жив: с читом раз в 350 кадров он отрабатывает
// 46 раз на той же сборке (и 154 раза на сборке ДО правки). Чаще меняем пирамиду —
// прогулка видит больше содержимого; 4000 кадров вместо 3000 — прогон и так упирается
// в потолок содержимого примерно там.
//
// [2026-10-17, apex-fast] NF 4000 -> 9000: ожидание BEAMW в слитой пачке сдвинуло такты, и на 4000 кадрах прогулка не доходила до
// слитой записи непрозрачной мумии (МНОГОПЛОСКОСТНЫЙ 0 при живом пути: на 9000 кадрах 83 у итога, 204 у базы).
// [2026-09-27] ПОКРЫТИЕ ШАГА C. Без GOD герой погибает до пирамиды 2, и слитая запись
// непрозрачной мумии (hi0b/hi0c, idx7, d0=1) в прогулке не встречается — min 1 краснел
// при живом пути (на той же сборке с GOD: ≥1 hit @ ~кадр 1748, pir=2). vec_cheats=1
// нужен, чтобы N реально менял пирамиду после замка F1+F3 на титуле. Требование
// покрытия не снижено: mPlanes по-прежнему min 1 при наличии vec_hop.
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;
const wr=(a,v)=>memory.write(a&65535,v&255,false);
if(L.vec_cheats!==undefined) wr(L.vec_cheats,1);
if(L.vec_god!==undefined) wr(L.vec_god,1);
const OUT=L.vec_spr_out,SHOW=L.vec_spr_show,HRD=L.vec_hero_redraw,OW=L.vop_ow;
const FB0=0x8000,FBN=0x6000;  // ТОЛЬКО плоскости p0/p1/p2: хвост p3 (0xE000+) — это слоты и переменные, не экран
// ЗАДАЧА#53 (2026-08-06): ПАРА ГЕРОЯ ВЫВОДИТСЯ ПЕРВОЙ, ДО ОБЩЕГО ПРОХОДА СТИРАНИЯ.
// Прежняя модель брала снимок «чистого фона» на ПЕРВОМ vec_spr_show и молча опиралась на
// порядок «сначала стёрли всех, потом рисуем всех». Этот порядок ИЗМЕНИЛСЯ НАРОЧНО (пара
// = restore->save->show в начале пачки, см. vpr_sout), и модель, привязанная к порядку,
// перестала описывать ЗАДУМАННОЕ поведение — она бы краснела на правильной картинке.
// Теперь модель ПОРЯДКА НЕ ЗНАЕТ ВООБЩЕ: она стартует со снимка fb на ВХОДЕ в пачку и
// повторяет КАЖДУЮ операцию пачки в том порядке, в каком та произошла:
//   vec_su_restore -> модель[габарит ШАПКИ] := данные слота (это и делает стирание),
//   vec_spr_show   -> композиция спрайта (как и раньше).
// Побочно это УСИЛИВАЕТ гейт: раньше стирание не проверялось вовсе (оно пряталось внутри
// снимка), теперь ошибка в restore тоже краснеет. «Чистый фон» для проверки B (шлейф)
// считается тем же способом — снимок плюс одни лишь стирания, без спрайтов.
const clean=new Uint8Array(FBN), model=new Uint8Array(FBN), snapB=new Uint8Array(FBN);
const BITS=x=>{let c=0;while(x){c+=x&1;x>>=1;}return c;};
let cur=null,ret=-1,rsp=-1;
let batches=0,badA=0,badB=0,bitsA=0,bitsB=0,heroB=0,heroFrames=0,worstA=0,worstB=0;
const sampA=[],sampB=[],sampC=[],sampD=[];let badC=0,bytesC=0,badD=0,bitsD=0,mBatches=0;
let badE=0,bitsE=0,mObj=0,mVert=0,mHoriz=0,mWide=0,mPlanes=0,mAband=0;
let frameNo=0;
// счётчики ПОКРЫТИЯ (таблица деклараций в конце): сколько раз каждая проверка реально
// что-то сравнила. Ноль сравнений = проверка бессодержательна.
let showCalls=0,saveCmp=0,covCalls=0,compCalls=0,restCalls=0;
function grab(dst){for(let i=0;i<FBN;i++)dst[i]=rd(FB0+i);}
// ЗАДАЧА#37: геометрию вывода vec_spr_show берёт из ЗАПИСИ ВЫВОДА (+0x97 hi0, +0x98 lo0,
// +0x99 ncols, +0x9F hi0b-для-вывода, +0x9B hi0c), а не из шапки слота: при pending=3
// шапки нет вовсе, а +0x9A (hi0b ДЛЯ СЕЙВА) дедуп обнуляет. Модель повторяет это.
const drawn=new Set();
function applyShow(idx){
  const pg=0xE000+idx*256;
  const hi0=rd(pg+0x97),lo0=rd(pg+0x98),nc=rd(pg+0x99),hib=rd(pg+0x9F),hic=rd(pg+0x9B);
  if(!nc)return;
  if(rd(pg+0x96)===2)return;
  showCalls++;
  // ЗАДАЧА#39: НЕПРОЗРАЧНЫЙ ГЕРОЙ. Если подготовка включила режим, кожа ПЕРЕД своим OR
  // гасит собственную плоскость СИЛУЭТОМ СОСЕДА (буфер другой страницы, vop_pg), а чужую
  // p0 гасит сосед штатным hi0c. Модель обязана повторять именно этот порядок.
  // ЗАДАЧА#41: у НЕПРОЗРАЧНОЙ МУМИИ (объект одноплоскостной) hi0b — не вторая рисуемая
  // плоскость, а ВТОРАЯ ГАСЯЩАЯ; признак лежит в слоте по смещению 0xD0.
  // ЗАДАЧА#52 (2026-08-05): СТВОРКА ВОРОТ ОДНИМ ОБЪЕКТОМ. Признак +0xD3 (страница слота
  // ДЕТАЛИ) уводит объект на композит vsc_leaf: по ВСЕМ трём плоскостям пишется
  //     p := (фон & ~заливка) | лица,
  // где заливка — буфер СВОЕГО слота, лица — буфер слота детали. Модель здесь делала OR
  // и краснела ровно на гашении фона заливкой: 6 пачек, 779 бит, все — p1 столбец 17,
  // слот 2 (створка). Проверено сборкой ДО задачи#52: пункт A там 0 пачек. То есть это
  // была слепота гейта к новому пути, а не порча картинки — но молчать он не должен:
  // теперь композит моделируется, и любое отклонение от него снова покраснеет.
  const det=rd(pg+0xD3);
  if(det){
    compCalls++;
    // vsc_leaf: p1 (hi0) = (фон & ~заливка) | лица; p2/p0 (hi0b/hi0c) = только ANDN заливки.
    // Модель раньше клала лица на все три плоскости и краснела не на картинке, а на себе.
    const h0=rd(pg+0x97), hb=rd(pg+0x9F), hc=rd(pg+0x9B);
    const paint=(h,orFace)=>{
      if(!h)return;
      for(let c=0;c<nc;c++){const pgc=((h+c)&0xff);
        for(let r=0;r<16;r++){const a=pgc*256+((lo0+r)&0xff)-FB0;
          if(a<0||a>=FBN)continue;
          const fill=rd(pg+0xA0+c*16+r), face=orFace?rd(det*256+0xA0+c*16+r):0;
          drawn.add(a);
          model[a]=((model[a]&~fill)|face)&0xff;}}};
    paint(h0,true); paint(hb,false); paint(hc,false);
    // vsc_leaf заканчивается ret: на MSX створка SAT 0–3 накрывает пару 4–5,
    // героя поверх листа не кладём (иначе idx2 одежды просвечивает). Раньше
    // модель звала applyShow(4/5) под старый vec_hero_redraw и краснела на
    // правильной картинке (fb=0 под створкой, модель ждала одежду).
    return;
  }
  const bandn=rd(pg+0xD0)?1:0;
  const planes=[];
  if(L.vop_i1&&rd(L.vop_i1)===idx+1)planes.push([hi0,1,rd(L.vop_pg)*256]);
  // vss_or слот 4: одежда ГАСИТ p1 своим силуэтом (hi0 xor 0x60), иначе кожа+живой p2 = idx6.
  if(idx===4&&hi0){
    const hip1=hi0^0x60;
    for(let c=0;c<nc;c++){const pgc=((hip1+c)&0xff);
      for(let r=0;r<16;r++){const a=pgc*256+((lo0+r)&0xff)-FB0;
        if(a<0||a>=FBN)continue;
        model[a]&=~rd(pg+0xA0+c*16+r)&0xff;}}
  }
  planes.push([hi0,0,pg]);if(hib)planes.push([hib,bandn,pg]);if(hic)planes.push([hic,1,pg]);
  const maskC=rd(L.vpr_sl)===2&&idx>=6;
  const clo0=rd(0xE498),cc0=rd(0xE497)&0x1F,cnc=rd(0xE499);
  for(const [h,andn,src] of planes)
    for(let c=0;c<nc;c++){const pgc=((h+c)&0xff);
      for(let r=0;r<16;r++){const a=pgc*256+((lo0+r)&0xff)-FB0;
        let s=rd(src+0xA0+c*16+r);
        if(a<0||a>=FBN)continue;
        if(maskC&&lo0===clo0){
          const col=(h+c)&0x1F;
          if(col>=cc0&&col<cc0+cnc)s&=~rd(0xE4A0+(col-cc0)*16+r)&0xff;
        }
        drawn.add(a);
        if(andn)model[a]&=~s&0xff; else model[a]|=s;}}
}
// C) ПОКРЫТИЕ (гейт дедупа, задача #37). Всё, куда пачка ПИСАЛА, обязано попадать в
// габарит хотя бы ОДНОГО валидного слота — иначе стирание следующего кадра не вернёт
// туда фон и на экране останется шлейф. Проверка прямая: множество записанных байт fb
// против объединения габаритов всех валидных слотов.
function coverGap(){
  covCalls++;
  const cov=new Set();
  for(let idx=0;idx<21;idx++){
    const pg=0xE000+idx*256;
    if(rd(pg)!==1)continue;
    const hi0=rd(pg+1),lo0=rd(pg+2),nc=rd(pg+3),hib=rd(pg+4),hic=rd(pg+5);
    if(!nc)continue;
    const planes=[hi0,hib,hic];
    // Створка (признак +0xD3): p2/p0 — только ANDN заливкой, в шапку не входят
    // (+0x9A:=0, иначе сейв кладёт одежду «фоном»). Пачка их пишет — это не шлейф,
    // а дырки швов; покрытие берём из записи вывода (+0x9F/+0x9B).
    if(rd(pg+0xD3)) planes.push(rd(pg+0x9F), rd(pg+0x9B));
    for(const h of planes){ if(!h)continue;
      for(let c=0;c<nc;c++){const pgc=((h+c)&0xff);
        for(let r=0;r<16;r++){const a=pgc*256+((lo0+r)&0xff)-FB0;
          if(a>=0&&a<FBN)cov.add(a);}}}
  }
  let g=0;for(const a of drawn)if(!cov.has(a))g++;
  if(EXPLAIN&&g&&explainedC<4)explainC(cov,g);
  return g;
}
// applyRestore: то, что делает vec_su_restore — данные слота обратно в fb по габариту
// ШАПКИ (плоскости hi0/hi0b/hi0c подряд, по 16*ncols байт на плоскость). Применяется и к
// модели, и к «чистому фону»: стирание спрайтов не рисует.
function applyRestore(idx){
  const pg=0xE000+idx*256;
  if(rd(pg)!==1)return;                     // слот невалиден — vec_su_restore выходит сразу
  const hi0=rd(pg+1),lo0=rd(pg+2),nc=rd(pg+3),hib=rd(pg+4),hic=rd(pg+5);
  if(!nc)return;
  restCalls++;
  let p=pg+6;
  for(const h of [hi0,hib,hic]){ if(!h)continue;
    for(let c=0;c<nc;c++){const pgc=((h+c)&0xff);
      for(let r=0;r<16;r++,p++){const a=pgc*256+((lo0+r)&0xff)-FB0;
        if(a<0||a>=FBN)continue;
        model[a]=rd(p);clean[a]=rd(p);}}}
}
function checkSaves(list){
  // ТОЛЬКО слоты, сохранённые В ЭТОЙ пачке: их данные обязаны совпасть с чистым фоном
  let bits=0,hero=0;
  for(const idx of list){
    const pg=0xE000+idx*256;
    if(rd(pg)!==1)continue;
    const hi0=rd(pg+1),lo0=rd(pg+2),nc=rd(pg+3),hib=rd(pg+4),hic=rd(pg+5);
    if(!nc)continue;
    saveCmp++;
    let p=pg+6;
    for(const h of [hi0,hib,hic]){ if(!h)continue;
      for(let c=0;c<nc;c++){const pgc=((h+c)&0xff);
        for(let r=0;r<16;r++,p++){const a=pgc*256+((lo0+r)&0xff)-FB0;
          if(a<0||a>=FBN)continue;
          const d=(rd(p)^clean[a])&0xff;
          if(d){bits+=BITS(d);if(idx===4||idx===5)hero+=BITS(d);}}}}
  }
  return [bits,hero];
}
//  --explain: РАЗБОР расхождения пункта A (2026-08-05). Печатает первые три случая:
//  какие байты fb не совпали с моделью, в какой плоскости и строке они лежат, ПИСАЛА ЛИ
//  туда пачка (множество drawn) и попадают ли они в габарит валидного слота. Это делит
//  причины надвое: «пачка написала не то, что говорит модель» против «в fb во время
//  пачки писал КТО-ТО ЕЩЁ» (тогда байты будут вне drawn).
const EXPLAIN=process.argv.includes("--explain");
let explained=0,explainedC=0;
function explainC(cov,g){
  explainedC++;
  const gaps=[];
  for(const a of drawn)if(!cov.has(a))gaps.push(a);
  const by={};
  for(const a of gaps){
    const p=planeOf(a),col=((a+FB0)>>8)&0x1F,row=(a+FB0)&0xff;
    const k=`${p} col${col}`;(by[k]=by[k]||[]).push(row);}
  console.log(`  --- C кадр ${frameNo}: ${g} байт вне габаритов, drawn=${drawn.size}`);
  for(const [k,rows] of Object.entries(by).slice(0,16)){
    rows.sort((x,y)=>x-y);
    console.log(`      ${k}: строки ${rows[0]}..${rows[rows.length-1]} (${rows.length} шт)`);}
  for(let idx=0;idx<21;idx++){
    const pg=0xE000+idx*256;
    const v=rd(pg),pend=rd(pg+0x96),ncW=rd(pg+0x99),ncH=rd(pg+3);
    if(!v&&pend!==1&&pend!==3&&!ncW)continue;
    console.log(`      слот ${idx}: valid=${v} pend=${pend} шапка hi=${rd(pg+1).toString(16)}/${rd(pg+4).toString(16)}/${rd(pg+5).toString(16)} lo=${rd(pg+2)} nc=${ncH}  запись hi=${rd(pg+0x97).toString(16)}/${rd(pg+0x9F).toString(16)}/${rd(pg+0x9B).toString(16)} lo=${rd(pg+0x98)} nc=${ncW} 9A=${rd(pg+0x9A).toString(16)} D0=${rd(pg+0xD0)} D3=${rd(pg+0xD3)}`);
  }
}
function planeOf(a){const p=(a+FB0)>>8;	// 0x8000 p0, 0xA000 p1, 0xC000 p2
  return p>=0xC0?"p2":p>=0xA0?"p1":p>=0x80?"p0":"?";}
function explainA(){
  explained++;
  const diffs=[];
  for(let i=0;i<FBN;i++){const d=(model[i]^rd(FB0+i))&0xff;if(d)diffs.push(i);}
  const cov=new Set();
  const owner={};
  for(let idx=0;idx<21;idx++){const pg=0xE000+idx*256;
    if(rd(pg)!==1)continue;
    const hi0=rd(pg+1),lo0=rd(pg+2),nc=rd(pg+3),hib=rd(pg+4),hic=rd(pg+5);
    if(!nc)continue;
    for(const h of [hi0,hib,hic]){if(!h)continue;
      for(let c=0;c<nc;c++)for(let r=0;r<16;r++){
        const a=((h+c)&0xff)*256+((lo0+r)&0xff)-FB0;
        if(a>=0&&a<FBN){cov.add(a);owner[a]=idx;}}}}
  const inDrawn=diffs.filter(a=>drawn.has(a)).length;
  const inCov=diffs.filter(a=>cov.has(a)).length;
  console.log(`  --- РАЗБОР кадра ${frameNo}: ${diffs.length} байт расходятся`);
  console.log(`      писала ли пачка сюда: ${inDrawn} из ${diffs.length}; в габарите валидного слота: ${inCov}`);
  const by={};
  for(const a of diffs.slice(0,400)){
    const p=planeOf(a),col=((a+FB0)>>8)&0x1F,row=(a+FB0)&0xff;
    const k=`${p} col${col}`;(by[k]=by[k]||[]).push(row);}
  for(const [k,rows] of Object.entries(by).slice(0,12)){
    rows.sort((x,y)=>x-y);
    const o=owner[diffs.find(a=>`${planeOf(a)} col${((a+FB0)>>8)&0x1F}`===k)];
    console.log(`      ${k}: строки fb ${rows[0]}..${rows[rows.length-1]} (${rows.length} шт), слот-владелец ${o===undefined?"НЕТ":o}`);}
  const a0=diffs[0];
  console.log(`      пример: адрес 0x${(a0+FB0).toString(16)} модель 0x${model[a0].toString(16)} fb 0x${rd(FB0+a0).toString(16)}`);
}
const SAVE=L.vec_su_save,MERGE=L.vso_merge1,REST=L.vec_su_restore;
// ЗАДАЧА#37 ШАГ 3: СЛИТАЯ ЗАПИСЬ. Такая пачка не зовёт ни vec_su_restore, ни vec_su_save,
// ни vec_spr_show — проверки A/B/C её просто не видят. Поэтому для неё отдельная прямая
// проверка D: НЕЗАВИСИМАЯ МОДЕЛЬ того, что слитая запись обязана положить в fb и в слот.
// ЗАДАЧА#37 ШАГИ 4-5: габарит объекта может ПЕРЕЕХАТЬ ПО СТРОКАМ (d = lo0_new - lo0_old),
// ПО СТОЛБЦАМ (dcol = hi0_new - hi0_old, плоскость та же) и СМЕНИТЬ ШИРИНУ (ncols), и модель это повторяет ровно
// так, как задумано в vsm_shift — НЕЗАВИСИМО от него, по определению «что должно быть»:
//   fb[СТАРЫЙ габарит \ новый] = фон из слота (объекта там больше нет);
//   fb[НОВЫЙ габарит, столбец i, строка j] = фон OR спрайт, где фон = слот[столбец i+dcol,
//     строка j+d], если этот байт был и в старом габарите, иначе — СНИМОК fb ДО ПАЧКИ
//     (краевые строки И краевые столбцы лежат вне старого габарита, там чистый фон);
//   слот после пачки = фон под НОВЫМ габаритом (иначе стирание следующего кадра вернёт
//     не то, а шапка+данные разъедутся).
// Снимок берётся на ВХОДЕ в пачку: если бы объект прочитал край из fb, куда уже написал
// сосед по этой же пачке, модель разошлась бы с fb — это и есть проверка.
// БЕЗ УЧЁТА dcol проверка была бы СЛЕПА к горизонтальному пути (ровно как была слепа к
// вертикальному до шага 4): она сверяла бы старые страницы fb с новыми данными.
// ШАГ C (2026-08-03): МНОГОПЛОСКОСТНЫЙ ОБЪЕКТ. Слитая запись умеет hi0b (+0x9F) и hi0c
// (+0x9B) — вторую и третью плоскости, каждая со своим блоком фона в слоте (блоки идут
// подряд по 16*ncols в порядке hi0 -> hi0b -> hi0c) и своей операцией: hi0 всегда OR,
// hi0c всегда AND NOT, hi0b — по признаку слот+0xD0 (ЗАДАЧА#41). Модель повторяет ЭТО, а
// не только первую плоскость: без такого разбора проверка была бы слепа ровно к тому
// пути, который шаг C и добавил. Сдвиг габарита моделируется для КАЖДОЙ плоскости.
const dexp=[],sexp=[],mergedA=new Set();
function expectMerge(idx){
  const pg=0xE000+idx*256;
  const hiN=rd(pg+0x97),loN=rd(pg+0x98),ncN=rd(pg+0x99);
  const hiO=rd(pg+1),loO=rd(pg+2),ncO=rd(pg+3); // ШАПКА на входе = СТАРЫЙ габарит
  if(!ncN)return;
  const bandn=rd(pg+0xD0)?1:0;
  const plN=[[hiN,0]];                          // плоскости ЗАПИСИ: страница + «гасит?»
  if(rd(pg+0x9F))plN.push([rd(pg+0x9F),bandn]);
  if(rd(pg+0x9B))plN.push([rd(pg+0x9B),1]);
  const plO=[hiO];                              // плоскости ШАПКИ (под ними лежит фон слота)
  if(rd(pg+4))plO.push(rd(pg+4));
  if(rd(pg+5))plO.push(rd(pg+5));
  const d=loN-loO, dc=hiN-hiO, dn=ncN-ncO;
  mObj++; if(d)mVert++; if(dc)mHoriz++; if(dn)mWide++;   // на чём именно проверена модель
  // ПОКИНУТЫЙ СТОЛБЕЦ (2026-08-06): столбец старого габарита, которого нет в новом, —
  // его фаза 1 обязана закрыть фоном ЦЕЛИКОМ (16 строк), а не |d| строками. Путь
  // открывается только при dc>0 (уехал вправо) или ncols_ст-dc>ncols_нов (сузился).
  if(dc>0||ncO-dc>ncN)mAband++;
  if(plN.length>1)mPlanes++;
  const spr=[];
  for(let i=0;i<ncN;i++){const t=[];
    for(let j=0;j<16;j++)t.push(rd(pg+0xA0+i*16+j));spr.push(t);}
  for(let k=0;k<plN.length;k++){                 // --- каждая плоскость своим блоком фона ---
    const [hpN,andn]=plN[k], hpO=(k<plO.length?plO[k]:hiO+dc);
    const base=pg+6+k*ncO*16;
    const bg=[];                                 // слот ДО переезда: фон по столбцам
    for(let c=0;c<ncO;c++){const b=[];
      for(let j=0;j<16;j++)b.push(rd(base+c*16+j));bg.push(b);}
    for(let c=0;c<ncO;c++){                      // старый габарит: всё, чего нет в новом
      const pgc=((hpO+c)&0xff), ci=c-dc;         // -> закрыто фоном из слота
      for(let j=0;j<16;j++){
        if(ci>=0&&ci<ncN&&j-d>=0&&j-d<16)continue; // байт попал и в новый габарит — ниже
        const a=pgc*256+((loO+j)&0xff)-FB0;
        if(a>=0&&a<FBN){dexp.push([a,bg[c][j]]);mergedA.add(a);}}
    }
    for(let i=0;i<ncN;i++){                      // новый габарит -> фон OR/AND NOT спрайт
      const pgc=((hpN+i)&0xff), co=i+dc;
      for(let j=0;j<16;j++){
        const jo=j+d, a=pgc*256+((loN+j)&0xff)-FB0;
        const inOld=(co>=0&&co<ncO&&jo>=0&&jo<16);
        const nb=inOld?bg[co][jo]:(a>=0&&a<FBN?snapB[a]:0);
        const s=spr[i][j];
        if(a>=0&&a<FBN){dexp.push([a,(andn?nb&~s:nb|s)&0xff]);mergedA.add(a);}
        sexp.push([base+i*16+j,nb]);}
    }
  }
}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===OUT){cur={first:true,saved:[],merged:false};rsp=cpu.sp;ret=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
    grab(snapB);   // снимок fb ДО пачки: из него модель берёт фон КРАЕВЫХ строк
    model.set(snapB);clean.set(snapB);drawn.clear();mergedA.clear();}
  else if(cur&&pc===SAVE){cur.saved.push(rd(L.vec_nsp_idx));}
  else if(cur&&pc===REST){applyRestore(rd(L.vec_nsp_idx));}
  else if(cur&&pc===MERGE){cur.merged=true;expectMerge(rd(L.vec_nsp_idx));}
  else if(cur&&ret>=0&&pc===ret&&cpu.sp>rsp){
    ret=-1;
    if(cur.merged){
      mBatches++;let bad=0,badS=0;
      for(const [a,v] of dexp)if((rd(FB0+a)&0xff)!==v)bad+=BITS((rd(FB0+a)^v)&0xff);
      for(const [p,v] of sexp)if((rd(p)&0xff)!==v)badS+=BITS((rd(p)^v)&0xff);
      if(bad){badD++;bitsD+=bad;if(sampD.length<5)sampD.push(`кадр ${frameNo}: ${bad} бит fb`);}
      if(badS){badE++;bitsE+=badS;if(sampD.length<5)sampD.push(`кадр ${frameNo}: ${badS} бит в слоте`);}
      dexp.length=0;sexp.length=0;}
    if(cur.first){
      batches++;
      let bits=0;
      for(let i=0;i<FBN;i++){if(mergedA.has(i))continue;   // слитую запись проверяет D
        const d=(model[i]^rd(FB0+i))&0xff;if(d)bits+=BITS(d);}
      if(bits){badA++;bitsA+=bits;if(bits>worstA)worstA=bits;if(sampA.length<5)sampA.push(`кадр ${frameNo}: ${bits} бит`);
        if(EXPLAIN&&explained<3)explainA();}
      const [b,h]=checkSaves(cur.saved);
      if(b){badB++;bitsB+=b;if(b>worstB)worstB=b;if(sampB.length<5)sampB.push(`кадр ${frameNo}: ${b} бит (герой ${h})`);}
      if(h){heroFrames++;heroB+=h;}
      const g=coverGap();
      if(g){badC++;bytesC+=g;if(sampC.length<5)sampC.push(`кадр ${frameNo}: ${g} байт вне габаритов слотов`);}
    }
    cur=null;}
  else if(cur&&(pc===HRD||pc===OW)){applyShow(4);applyShow(5);}
  else if(cur&&pc===SHOW){applyShow(rd(L.vec_nsp_idx));}
  return false;};
let seed=987654321; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(frameNo=0;frameNo<NF;frameNo++){
  if(frameNo%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(frameNo>0&&frameNo%350===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  v06c.oneInterrupt(true);
}
if(held>0)E.key(held,0);
console.log(`ROM=${ROM.split("/").pop()} кадров=${NF} пачек с выводом=${batches}`);
console.log(`A) КОМПОЗИЦИЯ fb != модель: ${badA} пачек (${(100*badA/batches).toFixed(2)}%), бит всего ${bitsA}, худшая пачка ${worstA}`);
for(const s of sampA)console.log("   "+s);
console.log(`B) SAVE-UNDER != чистый фон (ШЛЕЙФ): ${badB} пачек (${(100*badB/batches).toFixed(2)}%), бит всего ${bitsB}, худшая пачка ${worstB}`);
console.log(`   в т.ч. слоты 4/5 (ГЕРОЙ): ${heroFrames} пачек, бит ${heroB}`);
for(const s of sampB)console.log("   "+s);
console.log(`C) ПОКРЫТИЕ (нарисовано вне габаритов валидных слотов = ШЛЕЙФ): ${badC} пачек, байт ${bytesC}`);
for(const s of sampC)console.log("   "+s);
console.log(`D) СЛИТАЯ ЗАПИСЬ (fb != модель «хвост-фон / фон OR спрайт»): ${badD} пачек из ${mBatches} слитых, бит ${bitsD}`);
console.log(`   слот после пачки != фон под НОВЫМ габаритом: ${badE} пачек, бит ${bitsE}`);
console.log(`   проверено объектов слитой записи ${mObj}: со сдвигом по строкам ${mVert}, по СТОЛБЦАМ ${mHoriz}, со сменой ШИРИНЫ ${mWide}, МНОГОПЛОСКОСТНЫХ ${mPlanes}, с ПОКИНУТЫМ столбцом ${mAband}`);
for(const s of sampD)console.log("   "+s);

// --- ДЕКЛАРАЦИИ ПОКРЫТИЯ ----------------------------------------------------------------
// [имя, сколько отработало, минимум, «путь объявлен отсутствующим»]
// Живой путь с нулём срабатываний = ПРОВАЛ (проверка бессодержательна).
// Отсутствующий путь с НЕнулём = тоже ПРОВАЛ, но с другим смыслом: путь вернулся, и
// декларацию надо перевести в живую, иначе завтра его поломку никто не заметит.
const COVER=[
  ["A) композиция: пачек с выводом",                 batches,  1, false],
  ["A) композиция: вызовов vec_spr_show в модели",    showCalls,1, false],
  ["A) композиция: КОМПОЗИТ створки (задача#52)",      compCalls,1, false],
  ["A) композиция: стираний vec_su_restore в модели", restCalls,1, false],
  ["B) save-under: сравнённых слотов",                saveCmp,  1, false],
  ["C) покрытие габаритами: проверок",                covCalls, 1, false],
  ["D) слитая запись: пачек",                         mBatches, 1, false],
  ["D) слитая запись: объектов",                      mObj,     1, false],
  ["D) слитая запись: сдвиг габарита по СТРОКАМ",      mVert,    1, false],
  ["D) слитая запись: МНОГОПЛОСКОСТНЫЙ объект (шаг C)", mPlanes, L.vec_hop?1:0, false],
  ["D) слитая запись: сдвиг по СТОЛБЦАМ",             mHoriz,   1, false],
  ["D) слитая запись: смена ШИРИНЫ",                  mWide,    1, false],
  ["D) слитая запись: ПОКИНУТЫЙ столбец (сузился/вправо)", mAband, 1, false],
];
let cov=true;
console.log("ПОКРЫТИЕ:");
for(const [name,got,min,absent] of COVER){
  let tag;
  if(absent){
    if(got===0){ tag="путь отсутствует, проверка неприменима"; }
    else { tag="ПУТЬ ВЕРНУЛСЯ — переведите декларацию в живую (min 1)"; cov=false; }
  } else if(got<min){ tag="НЕ ОТРАБОТАЛА (min "+min+")"; cov=false; }
  else tag="ok (min "+min+")";
  console.log(`   ${name}: ${got} — ${tag}`);
}
if(!L.vec_hop)
  console.log("   (без vec_hop стимул остаётся на пирамиде 1: двуплоскостные в слитую пачку не попадают; сверка D жива, если счётчик > 0)");
if(badA||badB||badC||badD||badE){console.log("FAIL");process.exit(1);}
if(!cov){console.log("FAIL: покрытие разошлось с декларацией");process.exit(1);}
console.log("SPR RESID GATE OK");
console.log("РЕЗУЛЬТАТ: PASS (шлейфа нет, все живые проверки отработали)");
