// audit_smoothness.js — ЗАМЕР РАВНОМЕРНОСТИ ИГРЫ (жалоба владельца: «идёт неравномерно»).
//
// ЧТО СЧИТАЕТ (пять пунктов задачи):
//  1) Длительность ИГРОВОГО ТИКА в тактах CPU. Тик = один вызов H_TIMI из vec_isr
//     (vec_isr_nr: `call H_TIMI`) — бракетим вход/выход по SP, как B{} в beam_ab.js
//     (эталон см. tools/verify/beam_ab.js). avg/p50/p90/p99/max/сигма.
//  2) Доля РЕАЛЬНЫХ кадров (каждый v06c.oneInterrupt() — это один аппаратный vblank,
//     RST7 стреляет всегда), на которых:
//       - тик НЕ состоялся вовсе — прерывание пришло на глубине >=2 и ушло в
//         vec_isr_nested (H_TIMI в этом кадре не звался, см. vec_isr.asm: `ld a,
//         (vec_isr_depth); cp 1; jp nz, vec_isr_nested`);
//       - кадр СБРОШЕН целиком (глубина уже =3, `cp 3 / jp nc, vec_isr_skip`) — хуже
//         nested: не идёт даже пачка вывода;
//       - tickInProgress != 0 (src/game/kvalley_vars.asm:93) — H_TIMI МОГ быть вызван,
//         но tickMain увидел бит0=1 и логику (runGame) пропустил (ветка tickMain2).
//     Это ТРИ РАЗНЫХ причины «тика не было», не путать.
//  3) Сколько РЕАЛЬНЫХ кадров уходит на один игровой тик — распределение (1,2,3,…).
//     Тик засекается по смене переменной timer (.sym), как в beam_ab.js.
//  4) Дисперсия интервалов (в кадрах) между сменами позиции героя. Источник — ProtaX/
//     ProtaY (ЛОГИКА). Проверено по .sym и src/v06c/vec_sprout.asm: герой — ПАРА слотов
//     4 (одежда p2) и 5 (кожа p1), «стоят в одной точке» (vec_sprout.asm:2929) — одного
//     слота достаточно.
//  5) То же, но по РЕАЛЬНО ВЫВЕДЕННОЙ позиции: vec_nsp_prev — это НЕ логика, а снапшот
//     Y,X,pat, который кладёт vso_prev ПОСЛЕ фактической записи в fb (см. vec_sprout.asm
//     "vso_prev: снапшот prev = то, что реально выведено"; вызывается из ВСЕХ путей
//     пачки — vec_spr_show/vso_merge1/парного стек-блита). Слот 4, шаг записи 3 байта
//     (Y,X,pat), база vec_nsp_prev + slot*3. Меняется только в кадре, где пачка ДЕЙСТВИТЕЛЬНО
//     записала слот — то есть «логика тикает, а картинка стоит» здесь ВИДНО как отсутствие
//     события.
//  И то и другое — отдельно «любая смена» и отдельно «смена X» (бег по горизонтали).
//
// СЦЕНЫ: низ пирамиды 1 (keysFor из beam_ab), верх пирамиды 1 (натуральный вход — см.
// startGame/sceneTop ниже), нож (keysKnife + форс objetoCogido дословно из beam_ab.js),
// поздняя пирамида с мумиями (чит H/N через vec_hop, см. vec_isr.asm). Скролл/переход
// GameStatus=9 — ловится ПОПУТНО: длительности тиков бьются по gs НА МОМЕНТ ВХОДА в
// H_TIMI (не только 5), поэтому если GS=9 всплывёт в любой сцене — у него уже будет
// статистика; иначе честно печатаем «не покрыто».
//
// Ввод — ПО ИГРОВЫМ ТИКАМ (счётчик tick, не номер кадра), как в beam_ab.js: обе сборки
// должны пройти ОДНУ И ТУ ЖЕ игру, иначе цифры несопоставимы.
//
// ===== СТАРТ ПАРТИИ: ПОЧЕМУ НЕ toGame() ИЗ beam_harness.js (ЗАМЕР 2026-08-13) ===========
// beam_harness.js — общий файл (правки в нём не в объёме этой задачи), но её toGame()
// (F1+F5, удержание, ждать GS=5) для сборки B (1.0b, /private/tmp/kv10b-resid) МОЛЧА даёт
// НЕ ТУ СЦЕНУ: probeB4.js/probeB5.js — F1+F5-удержание стабильно приводит к
// piramideActual=5 при движущемся БЕЗ единого нажатия герое (диагональный бег по лестницам,
// зигзаг Y/X). Это АТТРАКТ-ДЕМО, а не партия игрока: hero_top_stress.js это уже
// документирует («без нажатия игра уходит в аттракт-демо, а демо стартует на пирамиде 5»,
// и именно поэтому сама проверяет НЕ GS===5, а piramideActual===1). У beam_harness.toGame()
// и у прежней версии этого файла такой проверки не было — они бы молча намеряли демо-прогон
// и на B, и потенциально при любой чужой правке timing на A.
// ПОЧЕМУ РАЗНИЦА A/B. Сборка B старше, у неё нет vec_f15_scan (тот появился вместе с замком
// читов 2026-08-11) — F1/F5 просто не входят в опрашиваемую матрицу клавиш игры, поэтому
// удержание F1+F5 не даёт СТАРТОВОГО фронта вовсе, и партия достаётся исключительно
// тайм-ауту титула — а тот на B короче и утыкается в демо раньше, чем у A.
// ЛЕЧЕНИЕ. startGame(rom,sym,wantCheats) ниже: если нужны читы (замок 2026-08-11 требует
// СТАРТ именно F1+F5 — иначе vec_cheats=0 и блок читов в vec_isr пропускается целиком,
// см. cheat_next_pyramid.js), пробуем F1+F5-удержание на СВЕЖЕМ движке и проверяем
// piramideActual===1 (не демо); если это не сработало (либо читы не нужны) — резервный
// путь ДОСЛОВНО из hero_top_stress.js: run(700) простоя, затем 30 фронтов SPACE
// (3 кадра вниз / 3 вверх). Замер (probeB5.js): именно эта раскладка даёт piramideActual=1
// НА ОБЕИХ сборках — единственный проверенный путь, надёжный на B.
// Каждая сцена ПОСЛЕ старта дополнительно проверяет piramideActual===1 сама (кроме
// «толпы мумий», где герой намеренно уводится читом дальше) — если демо всё же
// проскочило, гейт обязан упасть, а не намерить чужую сцену.
"use strict";
const {make}=require("./beam_harness.js");
function startGame(rom,sym,wantCheats){
  if(wantCheats){
    const E=make(rom,sym);
    const {run,key,rd,L}=E;
    run(400);
    key(112,1);key(116,1);
    for(let i=0;i<80&&rd(L.GameStatus)!==5;i++)run(16);
    key(112,0);key(116,0);run(8);
    if(rd(L.GameStatus)===5&&rd(L.piramideActual)===1)return E;
    // F1+F5 не довели до пирамиды 1 (замок отсутствует/иная тайминг-модель) — резерв ниже
    // на СВЕЖЕМ движке (не донашиваем состояние неудавшейся попытки).
  }
  const E=make(rom,sym);
  const {rd,L,v06c,key}=E;
  for(let i=0;i<700;i++)v06c.oneInterrupt(true);
  for(let i=0;i<30;i++){key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);
                        key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
  for(let i=0;i<800&&rd(L.GameStatus)!==5;i++)v06c.oneInterrupt(true);
  return E;
}

function usage(){
  console.log("usage: node audit_smoothness.js <romA> <symA> [romB symB] [--ticks N]");
  process.exit(2);
}
const argv=process.argv.slice(2);
const tIdx=argv.indexOf("--ticks");
let NT=2200;
if(tIdx>=0){NT=+argv[tIdx+1];argv.splice(tIdx,2);}
if(argv.length!==2&&argv.length!==4)usage();
const ROM_A=argv[0],SYM_A=argv[1];
const ROM_B=argv[2],SYM_B=argv[3];
if(!ROM_A||!SYM_A)usage();

const REQUIRED=["H_TIMI","vec_isr","vec_isr_nested","vec_isr_skip","vec_isr_depth",
  "tickInProgress","ProtaX","ProtaY","vec_nsp_prev","vec_nsp_idx","GameStatus","timer",
  "sprAttrib","enemyAttrib","objetoCogido","IDcuchilloCoge","knifesData","piramideActual"];

// ===== ИНСТРУМЕНТАЦИЯ (общая для всех сцен) ============================================
// TT — суммарные такты CPU (cpu.vcycles эмулятора vector06js — РЕАЛЬНЫЕ такты i8080, не
// бумажные, см. правило проекта). Бракетим H_TIMI по SP; глубину/nested/skip ловим как
// breakpoint-флаги, сбрасываемые перед каждым реальным кадром.
function makeInstrumented(E){
  const {L,rd,memory,cpu,v06c}=E;
  for(const s of REQUIRED)if(L[s]===undefined){
    console.log(`нет символа ${s} в .sym`);process.exit(2);}
  const TICK=L.H_TIMI,NEST=L.vec_isr_nested,SKIP=L.vec_isr_skip;
  let TT=0;
  const oI=cpu.instruction.bind(cpu);
  cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
  function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
  const st={tickSp:-1,tickRet:-1,tickStart:0,gs0:0,nested:false,skip:false};
  const durationsByGS={};
  v06c.check_breakpoint=function(){
    const pc=cpu.pc;
    if(pc===TICK&&st.tickRet<0){
      st.tickSp=cpu.sp;st.tickRet=retOf();st.tickStart=TT;st.gs0=rd(L.GameStatus);
    }else if(st.tickRet>=0&&pc===st.tickRet&&cpu.sp>st.tickSp){
      const dur=TT-st.tickStart;st.tickRet=-1;
      (durationsByGS[st.gs0]=durationsByGS[st.gs0]||[]).push(dur);
    }
    if(pc===NEST)st.nested=true;
    if(pc===SKIP)st.skip=true;
    return false;
  };
  return {st,durationsByGS,TT:()=>TT};
}

// ===== ЦИКЛ ЗАМЕРА (общий для всех сцен) ================================================
// Клавиши — функция ТИКА (tick), не кадра (правило задачи, эталон beam_ab.js). Один тик
// может занять несколько реальных кадров — тогда keysFn(tick) вызывается с тем же tick
// несколько раз подряд (набор клавиш не меняется), это штатно и безвредно.
const HERO_SLOT=4; // sprAttrib/vec_nsp_prev: 0-3 ворота, 4-5 герой (см. шапку файла)
function measure(E,inst,NT,keysFn,opts={}){
  const {L,rd,memory,v06c}=E;
  const TIMER=L.timer;
  const frameCountByGS={},nestedByGS={},skipByGS={},tickInProgByGS={};
  const framesPerTick=[];
  const logicSeq=[],dispSeq=[];
  const NSPPREV=L.vec_nsp_prev;
  let held=new Set(),tick=0,prevT=rd(TIMER),nframes=0,curFramesInTick=0;
  const cap=opts.frameCap||300000;
  while(tick<=NT&&nframes<cap){
    const want=new Set(keysFn(tick));
    for(const c of held)if(!want.has(c))E.key(c,0);
    for(const c of want)if(!held.has(c))E.key(c,1);
    held=want;
    if(opts.perFrame)opts.perFrame(tick);
    inst.st.nested=false;inst.st.skip=false;
    v06c.oneInterrupt(true);nframes++;curFramesInTick++;
    const gs=rd(L.GameStatus);
    frameCountByGS[gs]=(frameCountByGS[gs]||0)+1;
    if(inst.st.nested)nestedByGS[gs]=(nestedByGS[gs]||0)+1;
    if(inst.st.skip)skipByGS[gs]=(skipByGS[gs]||0)+1;
    if(rd(L.tickInProgress)&1)tickInProgByGS[gs]=(tickInProgByGS[gs]||0)+1;
    if(gs===5){
      const lx=rd(L.ProtaX),ly=rd(L.ProtaY);
      const base=NSPPREV+HERO_SLOT*3;
      const dy=rd(base),dx=rd(base+1);
      logicSeq.push({f:nframes,x:lx,y:ly});
      dispSeq.push({f:nframes,x:dx,y:dy});
    }
    const t=rd(TIMER);
    if(t!==prevT){prevT=t;tick++;framesPerTick.push(curFramesInTick);curFramesInTick=0;}
  }
  for(const c of held)E.key(c,0);
  return {frameCountByGS,nestedByGS,skipByGS,tickInProgByGS,framesPerTick,logicSeq,dispSeq,
          nframes,durationsByGS:inst.durationsByGS};
}

// ===== СЦЕНЫ =============================================================================
// keysFor/keysKnife — ДОСЛОВНО из tools/verify/beam_ab.js (эталон раскладки; правило проекта
// «порты — дословно по исходнику», здесь это касается и собственных стендов-эталонов).
function keysBottom(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);}
  else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);}
  else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);}
  else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);}
  else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);}
  return k;}
function keysKnife(t){const k=[];
  if(t<260){if((t>>2)&1)k.push(32);return k;}
  if((t&31)<16)k.push(39);else k.push(37);
  if((t&15)===3)k.push(32);
  return k;}
function keysRun(t){return [(t%200)<100?39:37];}

// Проверка ПОСЛЕ startGame(): не демо (см. шапку файла). piramideActual===1 — сигнал,
// который использует и hero_top_stress.js. Для сцен 1-3 (все на пирамиде 1) обязателен.
function verifyStart(E,name){
  const {rd,L}=E;
  if(rd(L.GameStatus)!==5||rd(L.piramideActual)!==1){
    console.log(`ПРОВАЛ ПОКРЫТИЯ: сцена «${name}» — после старта GS=${rd(L.GameStatus)} `+
      `piramideActual=${rd(L.piramideActual)} (ждали 5/1; похоже на аттракт-демо, а не партию)`);
    process.exit(1);
  }
}
function sceneBottom(E,inst,NT){
  verifyStart(E,"низ пирамиды 1 (штатный бег)");
  return measure(E,inst,NT,keysBottom);
}
function sceneTop(E,inst,NT){
  verifyStart(E,"верх пирамиды 1 (верхняя строка)");
  // ЗАМЕР 2026-08-13 (НЕ форсируем ProtaY константой — hero_top_stress.js так делает на
  // ОДНОЙ сборке, но здесь A/B). Пробой показал: сборка A входит в пирамиду 1 СРАЗУ на
  // устойчивом Y=72 (без хода), сборка B (1.0b, HUD в игровом поле — другая раскладка
  // экрана) ещё 150-300 кадров идёт по лестнице от Y~152 и останавливается на Y=120.
  // Значит «верхняя строка» — РАЗНЫЙ абсолютный Y в разных сборках; форс константы из
  // .sym одной сборки на другую значил бы мерить РАЗНЫЕ сцены (то же нарушение, из-за
  // которого beam_ab.js вообще завели — см. её шапку). Вместо форса просто ждём, пока
  // штатный вход (без нажатий) устаканится: Y не меняется 20 кадров подряд, бюджет 800
  // кадров. Это и есть верхняя строка — её кладёт сама игра при входе в пирамиду 1.
  const {rd,L,v06c}=E;
  let lastY=-1,stable=0,settled=false;
  for(let i=0;i<800;i++){
    v06c.oneInterrupt(true);
    const y=rd(L.ProtaY);
    if(y===lastY)stable++;else stable=0;
    lastY=y;
    if(stable>20){settled=true;break;}
  }
  if(!settled)console.log(`  ПРЕДУПРЕЖДЕНИЕ: вход в пирамиду 1 не устаканился за 800 кадров (Y=${lastY}) — мерим как есть`);
  return measure(E,inst,NT,keysRun);
}
function sceneKnife(E,inst,NT){
  verifyStart(E,"нож");
  const perFrame=(tick)=>{
    if(tick>=260){
      const st=E.rd(E.L.knifesData);
      if(st<=2){E.memory.write(E.L.objetoCogido&0xffff,0x10,false);
                E.memory.write(E.L.IDcuchilloCoge&0xffff,0,false);}
    }};
  return measure(E,inst,NT,keysKnife,{perFrame});
}
// jumpToCrowd: чит H (+5 пирамид)/N (+1), см. vec_hop в vec_isr.asm. Замок читов 2026-08-11
// требует старта F1+F5 (startGame(rom,sym,true) уже это попытался — см. sceneCrowd). Жмём H по фронту (down 3 кадра, up), ждём
// возврата в GS=5, повторяем. Мумий считаем по enemyAttrib: Y<0xD0 = активна (см.
// hero_top_stress.js/mummy_survey.js). Гейт: пустая выборка мумий => process.exit(1).
// Замер (mumscan, 2026-08-13): быстрые повторные N/H-нажатия с коротким settle дают
// НЕСТАБИЛЬНЫЙ piramideActual (в одном прогоне N уводил номер пирамиды НАЗАД) — это
// чувствительность фронта чита к точной фазе кадра, а не баг чита. Лечится длинным
// settle (300 кадров) после каждого нажатия и ФИКСИРОВАННЫМ числом нажатий H (не условием
// «пока пирамида < N», которое гоняется по нестабильному чтению). H дважды из старта
// пирамиды 1 детерминированно ведёт на позднюю пирамиду (+5+5); если мумий не нашлось —
// довираем N, тоже фиксированным бюджетом попыток.
function jumpToCrowd(E,inst){
  const {L,rd,key,v06c}=E;
  const gsSeen={};
  function watchRun(n){for(let i=0;i<n;i++){v06c.oneInterrupt(true);
    const g=rd(L.GameStatus);gsSeen[g]=(gsSeen[g]||0)+1;}}
  function press(code){key(code,1);watchRun(3);key(code,0);
    let f=0;for(;f<1500&&rd(L.GameStatus)!==5;f++)watchRun(1);
    watchRun(300);}
  function mummyCount(){let c=0;for(let m=0;m<8;m++)if(rd(L.enemyAttrib+m*4)<0xD0)c++;return c;}
  press(72);press(72); // H,H: +5,+5 пирамид от старта (пирамида 1) — детерминированно
  let nAttempts=0;
  while(mummyCount()<1&&nAttempts<8){press(78);nAttempts++;} // N: довираем, если мумий не видно
  return {pyramid:rd(L.piramideActual),mummies:mummyCount(),gsSeen};
}
function sceneCrowd(E,inst,NT){
  verifyStart(E,"поздняя пирамида, толпа мумий");
  const info=jumpToCrowd(E,inst);
  if(info.mummies<1){
    console.log(`ПРОВАЛ ПОКРЫТИЯ: сцена толпы мумий не набралась (дефект замера, не «ноль дефектов») — `+
      `пирамида ${info.pyramid}, активных мумий ${info.mummies}`);
    process.exit(1);
  }
  const res=measure(E,inst,NT,keysRun);
  res.meta={pyramid:info.pyramid,mummies:info.mummies,gsSeenDuringJump:info.gsSeen};
  return res;
}

// ===== СТАТИСТИКА ========================================================================
function stats(arr){
  if(!arr||!arr.length)return null;
  const a=arr.slice().sort((x,y)=>x-y);const n=a.length;
  const sum=a.reduce((s,v)=>s+v,0);const avg=sum/n;
  const sd=Math.sqrt(a.reduce((s,v)=>s+(v-avg)*(v-avg),0)/n);
  const p=q=>a[Math.min(n-1,Math.floor(n*q))];
  return {n,avg,p50:p(0.5),p90:p(0.9),p99:p(0.99),max:a[n-1],min:a[0],sd,cv:avg?sd/avg:0};
}
function changeIntervals(seq,mode){ // mode: 'pos' (X или Y) | 'x' (только X)
  const events=[];let prev=null;
  for(const s of seq){
    if(prev===null){prev=s;continue;}
    const changed=mode==="x"?(s.x!==prev.x):(s.x!==prev.x||s.y!==prev.y);
    if(changed)events.push(s.f);
    prev=s;
  }
  const intervals=[];for(let i=1;i<events.length;i++)intervals.push(events[i]-events[i-1]);
  return {events:events.length,intervals};
}
function histFrames(intervals){
  const h={1:0,2:0,3:0,4:0,5:0,"6+":0};
  for(const v of intervals){if(v>=6)h["6+"]++;else h[v]=(h[v]||0)+1;}
  return h;
}
function fmtHist(h){return Object.keys(h).map(k=>`${k}:${h[k]}`).join(" ");}
function n2(x){return x===undefined||x===null||Number.isNaN(x)?"—":x.toFixed(2);}
function n0(x){return x===undefined||x===null||Number.isNaN(x)?"—":Math.round(x).toString();}
function pct(a,b){return b?(100*a/b).toFixed(1)+"%":"—";}

// ===== СБОРКА ОТЧЁТА ПО ОДНОМУ ПРОГОНУ СЦЕНЫ ============================================
function digest(res){
  const gs5=res.frameCountByGS[5]||0;
  const durAll=res.durationsByGS[5]||[];
  const durSt=stats(durAll);
  const nested=res.nestedByGS[5]||0, skip=res.skipByGS[5]||0, tip=res.tickInProgByGS[5]||0;
  const fptSt=stats(res.framesPerTick);
  const fptHist=histFrames(res.framesPerTick);
  const lp=changeIntervals(res.logicSeq,"pos"), lx=changeIntervals(res.logicSeq,"x");
  const dp=changeIntervals(res.dispSeq,"pos"), dx=changeIntervals(res.dispSeq,"x");
  return {gs5,durAll,durSt,nested,skip,tip,fptSt,fptHist,
    lpSt:stats(lp.intervals),lpEv:lp.events,lpHist:histFrames(lp.intervals),
    lxSt:stats(lx.intervals),lxEv:lx.events,lxHist:histFrames(lx.intervals),
    dpSt:stats(dp.intervals),dpEv:dp.events,dpHist:histFrames(dp.intervals),
    dxSt:stats(dx.intervals),dxEv:dx.events,dxHist:histFrames(dx.intervals),
    nframes:res.nframes,meta:res.meta,durationsByGS:res.durationsByGS};
}

function checkNonEmpty(name,d){
  if(d.gs5<50){
    console.log(`ПРОВАЛ ПОКРЫТИЯ: сцена «${name}» — всего ${d.gs5} кадров геймплея (GS=5), это пустая выборка`);
    process.exit(1);
  }
  if(d.durAll.length<10){
    console.log(`ПРОВАЛ ПОКРЫТИЯ: сцена «${name}» — ${d.durAll.length} тиков геймплея, пустая выборка`);
    process.exit(1);
  }
  if(d.lpEv<5){
    console.log(`ПРОВАЛ ПОКРЫТИЯ: сцена «${name}» — герой сменил позицию ${d.lpEv} раз(а) за ${d.gs5} кадров, `+
      `подозрение на замороженную сцену`);
    process.exit(1);
  }
}

// ===== ВЫВОД ==============================================================================
function printScene(name,label,d){
  console.log(`\n----- сцена «${name}», сборка ${label} -----`);
  console.log(`  кадров всего ${d.nframes}, геймплея (GS=5) ${d.gs5}, тиков H_TIMI (gs=5) ${d.durAll.length}`);
  if(d.meta)console.log(`  meta: пирамида ${d.meta.pyramid}, активных мумий ${d.meta.mummies}, `+
    `GS во время прыжка: ${JSON.stringify(d.meta.gsSeenDuringJump)}`);
  const s=d.durSt;
  console.log(`  ТИК (такты CPU, H_TIMI): avg ${n0(s.avg)} p50 ${n0(s.p50)} p90 ${n0(s.p90)} p99 ${n0(s.p99)} `+
    `max ${n0(s.max)} sd ${n0(s.sd)} (кадр=59904 такта)`);
  console.log(`  БЕЗ ТИКА (глубина>=2, vec_isr_nested): ${d.nested} = ${pct(d.nested,d.gs5)} кадров gs5`);
  console.log(`  КАДР СБРОШЕН ЦЕЛИКОМ (глубина=3, vec_isr_skip): ${d.skip} = ${pct(d.skip,d.gs5)} кадров gs5`);
  console.log(`  tickInProgress != 0: ${d.tip} = ${pct(d.tip,d.gs5)} кадров gs5`);
  const f=d.fptSt;
  console.log(`  КАДРОВ НА ТИК: avg ${n2(f.avg)} p50 ${f.p50} p90 ${f.p90} max ${f.max} | гистограмма ${fmtHist(d.fptHist)}`);
  const row=(tag,st,ev,h)=>console.log(`  ${tag}: событий ${ev}, интервал(кадр) avg ${n2(st&&st.avg)} `+
    `sd ${n2(st&&st.sd)} CV ${n2(st&&st.cv)} | гистограмма ${fmtHist(h)}`);
  row("ЛОГИКА поз. (X или Y)",d.lpSt,d.lpEv,d.lpHist);
  row("ЛОГИКА X (бег)       ",d.lxSt,d.lxEv,d.lxHist);
  row("ЭКРАН  поз. (реальн.)",d.dpSt,d.dpEv,d.dpHist);
  row("ЭКРАН  X    (реальн.)",d.dxSt,d.dxEv,d.dxHist);
}

function printCompare(name,dA,dB){
  console.log(`\n===== A/B «${name}» =====`);
  const row=(tag,a,b)=>console.log(`  ${tag.padEnd(34)} A=${String(a).padStart(10)}   B=${String(b).padStart(10)}`);
  row("кадров геймплея (gs=5)",dA.gs5,dB.gs5);
  row("тиков H_TIMI (gs=5)",dA.durAll.length,dB.durAll.length);
  row("тик avg такт",n0(dA.durSt?.avg),n0(dB.durSt?.avg));
  row("тик p50 такт",n0(dA.durSt?.p50),n0(dB.durSt?.p50));
  row("тик p90 такт",n0(dA.durSt?.p90),n0(dB.durSt?.p90));
  row("тик p99 такт",n0(dA.durSt?.p99),n0(dB.durSt?.p99));
  row("тик max такт",n0(dA.durSt?.max),n0(dB.durSt?.max));
  row("тик sd такт",n0(dA.durSt?.sd),n0(dB.durSt?.sd));
  row("без тика (nested), %",pct(dA.nested,dA.gs5),pct(dB.nested,dB.gs5));
  row("кадр сброшен (skip), %",pct(dA.skip,dA.gs5),pct(dB.skip,dB.gs5));
  row("tickInProgress!=0, %",pct(dA.tip,dA.gs5),pct(dB.tip,dB.gs5));
  row("кадров/тик avg",n2(dA.fptSt?.avg),n2(dB.fptSt?.avg));
  row("кадров/тик max",dA.fptSt?.max,dB.fptSt?.max);
  row("логика X: инт. avg/sd/CV",`${n2(dA.lxSt?.avg)}/${n2(dA.lxSt?.sd)}/${n2(dA.lxSt?.cv)}`,
                                  `${n2(dB.lxSt?.avg)}/${n2(dB.lxSt?.sd)}/${n2(dB.lxSt?.cv)}`);
  row("экран X: инт. avg/sd/CV",`${n2(dA.dxSt?.avg)}/${n2(dA.dxSt?.sd)}/${n2(dA.dxSt?.cv)}`,
                                 `${n2(dB.dxSt?.avg)}/${n2(dB.dxSt?.sd)}/${n2(dB.dxSt?.cv)}`);
  row("логика поз: инт. avg/sd/CV",`${n2(dA.lpSt?.avg)}/${n2(dA.lpSt?.sd)}/${n2(dA.lpSt?.cv)}`,
                                    `${n2(dB.lpSt?.avg)}/${n2(dB.lpSt?.sd)}/${n2(dB.lpSt?.cv)}`);
  row("экран поз: инт. avg/sd/CV",`${n2(dA.dpSt?.avg)}/${n2(dA.dpSt?.sd)}/${n2(dA.dpSt?.cv)}`,
                                   `${n2(dB.dpSt?.avg)}/${n2(dB.dpSt?.sd)}/${n2(dB.dpSt?.cv)}`);
}

// ===== MAIN ===============================================================================
// wantCheats=true ТОЛЬКО у «толпы мумий» — единственная сцена, которой нужны читы N/H.
const SCENES=[
  ["низ пирамиды 1 (штатный бег)",sceneBottom,false],
  ["верх пирамиды 1 (верхняя строка)",sceneTop,false],
  ["нож",sceneKnife,false],
  ["поздняя пирамида, толпа мумий",sceneCrowd,true],
];

function runBuild(rom,sym,label){
  const out={};
  const durationsByGS9={};
  for(const [name,fn,wantCheats] of SCENES){
    const E=startGame(rom,sym,wantCheats);
    const inst=makeInstrumented(E);
    const res=fn(E,inst,NT);
    const d=digest(res);
    checkNonEmpty(name,d);
    printScene(name,label,d);
    out[name]=d;
    if(res.durationsByGS[9])
      (durationsByGS9[name]=res.durationsByGS[9]);
  }
  out.__gs9=durationsByGS9;
  return out;
}

console.log(`audit_smoothness: тиков на сцену ${NT}`);
console.log(`A: ${ROM_A}`);
const resA=runBuild(ROM_A,SYM_A,"A");
let resB=null;
if(ROM_B){
  console.log(`B: ${ROM_B}`);
  resB=runBuild(ROM_B,SYM_B,"B");
  for(const [name] of SCENES)printCompare(name,resA[name],resB[name]);
}

// ===== СЦЕНА 5: скролл/переход GameStatus=9 (попутный улов) ============================
console.log(`\n----- сцена «скролл/переход, GameStatus=9» -----`);
function report9(res,label){
  const g9=res.__gs9;
  const names=Object.keys(g9);
  if(!names.length){
    console.log(`  ${label}: НЕ ПОКРЫТО — GameStatus=9 ни разу не встретился в тиках ни одной из ${SCENES.length} сцен`);
    return;
  }
  for(const n of names){
    const s=stats(g9[n]);
    console.log(`  ${label}, попутно из «${n}»: тиков ${s.n}, avg ${n0(s.avg)} p50 ${n0(s.p50)} `+
      `p90 ${n0(s.p90)} max ${n0(s.max)} такт`);
  }
}
report9(resA,"A");
if(resB)report9(resB,"B");
if(!resB)console.log("(B не задан — сравнение A/B не выполнено, отчёт только по A)");
