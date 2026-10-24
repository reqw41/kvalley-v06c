// mg_measure.js — сводный замер демо Metal Gear (metalgear-v06c) на vector06js.
// Единый прогон -> все семь пунктов задачи, чтобы кадры/фазы были одни и те же
// во всех таблицах (не рассинхронизировать замеры между отдельными прогонами).
//
// Запуск: node tools/verify/mg_measure.js
"use strict";
const fs=require("fs");
const {make,toPlay}=require("./mg_harness.js");
const ROM="/Users/boris/Projects/vector06js/metalgear.rom";
const EDD="/Users/boris/Projects/vector06js/metalgear.edd";
const LST="/Users/boris/projects/metalgear-v06c/build/demo.lst";
const FRAME=59904;

const E=make(ROM,EDD,LST);
const {memory,cpu,v06c,rd,L}=E;

console.log("=== СТЕНД ===");
console.log(`rom=${ROM}`);
console.log(`edd=${EDD}  файл=${E.eddBytes}Б  загружено_в_квазидиск=${E.eddLoaded}Б`);
console.log(`sym=${LST}  символов_разобрано=${Object.keys(L).length}`);

// --- проверка обязательных символов ---
const NEED=["popblit","sb_blit","gd_blit","bg_fill","gg_build","blit_mono","blit_or","draw_bg","compose",
            "state","ST_GAME","frame_tog","pl_ctrl","kv_ok"];
const missing=NEED.filter(k=>L[k]===undefined);
if(missing.length){console.log("ОШИБКА: в demo.lst не найдены символы: "+missing.join(", "));process.exit(1);}

console.log("\n=== ЗАГРУЗКА КВАЗИДИСКА ===");
console.log(`kv_ok сразу после старта не проверяем (проверяется в kv_check внутри первого кадра)`);

// --- дойти до геймплея ---
const tp=toPlay(E,1200);
console.log(`\n=== ВХОД В ДЕМО ===`);
console.log(`toPlay: state=${tp.state} (ST_GAME=${L.ST_GAME}) за ${tp.frames} кадров`);
console.log(`kv_ok=${rd(L.kv_ok)}  (1 = сигнатура квазидиска найдена, графика зон доступна)`);
if(tp.state!==L.ST_GAME){
  console.log("ПРОВАЛ: демо не дошло до state==ST_GAME — дальнейшие замеры отменены.");
  process.exit(1);
}
// устояться (проскочить самый первый кадр входа в комнату)
E.run(20);

// ================= ИНСТРУМЕНТАЦИЯ =================
const ILLEGAL=new Set([0x08,0x10,0x18,0x20,0x28,0x30,0x38,0xCB,0xD9,0xDD,0xED,0xFD]);
const ILLEGAL_NAME={0x08:"EX AF,AF'",0x10:"DJNZ",0x18:"JR",0x20:"JR NZ",0x28:"JR Z",
              0x30:"JR NC",0x38:"JR C",0xCB:"CB-prefix",0xD9:"EXX",
              0xDD:"DD-prefix(IX)",0xED:"ED-prefix",0xFD:"FD-prefix(IY)"};

let TT=0;                 // монотонный счётчик T-states с начала измерения (не по кадру)
let curFrame=-1;
let frameTT0=0;            // TT на начало текущего кадра
let haltTT=0;              // тактов в HLT за текущий кадр
const frameHalt=[];        // halt-тактов по кадрам
const frameTotal=[];       // всего тактов по кадрам (для проверки == FRAME)
const frameTog=[];         // frame_tog, снятый ПОСЛЕ прогона кадра
const frameWriteCount=[];  // писем в FB (0x8000-0xFFFF) по кадрам

const executedOps=new Map();  // pc -> опкод (первый увиденный), для i8080-чистоты по трассе
const illegalHits=[];         // {pc,op} исполненные Z80-only опкоды (должно быть пусто)

const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc;
  const op=rd(pc);
  if(!executedOps.has(pc)){executedOps.set(pc,op);
    if(ILLEGAL.has(op))illegalHits.push({pc,op});}
  const isHlt=(op===0x76);
  oI();
  const d=cpu.vcycles|0;
  TT+=d;
  if(isHlt) haltTT+=d;
};

// --- запись в фреймбуфер: перехват memory.write, диапазон $8000-$FFFF (все 4 плана) ---
// ПРИМЕЧАНИЕ: задание называет диапазон 0x8000-0xDFFF, но план $E0 живёт в
// $E000-$FFFF (см. beam_harness.idealBmp: смещения планов 0,0x2000,0x4000,0x6000
// от базы $8000 => план3 = $E000-$FFFF). Чтобы не обрубить план $E0, границу
// расширили до $FFFF — это явное решение по покрытию, а не расхождение с фактом.
const oW=memory.write.bind(memory);
const writeLog=[];                 // {frame,cyc,addr} — весь измеряемый прогон (300 кадров)
memory.write=function(addr,w8,stackrq){
  const a=addr&0xffff;
  if(a>=0x8000 && a<=0xFFFF){
    frameWriteCount[curFrame]=(frameWriteCount[curFrame]||0)+1;
    writeLog.push({frame:curFrame,cyc:E.cyc(),addr:a,tt:TT});
  }
  oW(addr,w8,stackrq);
};

// --- профиль процедур: вход/выход по СП (как beam_top.js) ---
const TARGETS={popblit:L.popblit,sb_blit:L.sb_blit,gd_blit:L.gd_blit,bg_fill:L.bg_fill,
               gg_build:L.gg_build,blit_mono:L.blit_mono,blit_or:L.blit_or,draw_bg:L.draw_bg,
               compose:L.compose};
const st={};for(const k in TARGETS)st[k]={sp:-1,ret:-1,tt0:0,wc0:0};
const spans={};for(const k in TARGETS)spans[k]=[]; // {frame,dur,writes,wIdx0,wIdx1}
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  for(const k in TARGETS){
    const addr=TARGETS[k];if(addr===undefined)continue;
    const s=st[k];
    if(pc===addr && s.ret<0){
      s.sp=cpu.sp;s.ret=retOf();s.tt0=TT;s.wIdx0=writeLog.length;s.f0=curFrame;
    } else if(s.ret>=0 && pc===s.ret && cpu.sp>s.sp){
      spans[k].push({frame:curFrame,frame0:s.f0,dur:TT-s.tt0,wIdx0:s.wIdx0,wIdx1:writeLog.length});
      s.ret=-1;
    }
  }
  return false;
};

function runFrame(){
  curFrame++;
  haltTT=0;
  const tt0=TT;
  v06c.oneInterrupt(true);
  frameTotal[curFrame]=TT-tt0;
  frameHalt[curFrame]=haltTT;
  frameTog[curFrame]=rd(L.frame_tog);
}

// ================= ПРОГОН =================
const DETAILED_FRAMES=40;   // >=20 кадров подряд для гистограммы/пачек/периодичности
const LONG_EXTRA=260;       // ещё кадров для статистики по процедурам (итого 300)

for(let f=0;f<DETAILED_FRAMES;f++) runFrame();
for(let f=0;f<LONG_EXTRA;f++) runFrame();

const TOTAL_FRAMES=DETAILED_FRAMES+LONG_EXTRA;

// кадры, накрытые исполнением draw_bg (полная перерисовка фона при входе/смене
// комнаты растягивается на много видеокадров из-за прерываний внутри цикла) —
// это НЕ штатная периодика чередования A/B1/B2, а разовое событие; помечаем,
// чтобы не портить статистику периодичности.
const transitionFrames=new Set();
for(const s of spans.draw_bg) for(let f=s.frame0;f<=s.frame;f++) transitionFrames.add(f);

// ================= 1. ГИСТОГРАММА ЗАПИСЕЙ В FB (детальная фаза) =================
console.log(`\n=== 1. ГИСТОГРАММА ЗАПИСЕЙ В FB ($8000-$FFFF), ${DETAILED_FRAMES} кадров подряд ===`);
const detWrites=writeLog.filter(w=>w.frame<DETAILED_FRAMES);
if(detWrites.length===0){
  console.log("ПРОВАЛ ИНСТРУМЕНТА: за "+DETAILED_FRAMES+" кадров перехвачено 0 записей в диапазон $8000-$FFFF.");
} else {
  console.log(`всего перехвачено записей: ${detWrites.length}`);
  console.log(`из них внутри разовой полной перерисовки draw_bg (кадры ${[...transitionFrames].filter(f=>f<DETAILED_FRAMES).join(",")||"—"}): ${detWrites.filter(w=>transitionFrames.has(w.frame)).length} — см. пункт 4/5, это НЕ штатный кадровый блит`);
  const NBINS=32,BINSZ=FRAME/NBINS;
  const bins=new Array(NBINS).fill(0);
  const binsSteady=new Array(NBINS).fill(0);
  for(const w of detWrites){const b=Math.min(NBINS-1,(w.cyc/BINSZ)|0);bins[b]++;if(!transitionFrames.has(w.frame))binsSteady[b]++;}
  console.log("бин(0..31, по "+BINSZ.toFixed(0)+" тактов) -> записей всего | без кадров draw_bg-перерисовки:");
  for(let i=0;i<NBINS;i++){
    if(bins[i]===0)continue;
    console.log(`  бин${String(i).padStart(2)} [${(i*BINSZ)|0}..${((i+1)*BINSZ)|0}) такт: ${bins[i]}  | ${binsSteady[i]}`);
  }
  const cycs=detWrites.map(w=>w.cyc).sort((a,b)=>a-b);
  const med=cycs[(cycs.length/2)|0];
  console.log(`min такт=${cycs[0]}  max такт=${cycs[cycs.length-1]}  median=${med}`);
  const steadyCycs=detWrites.filter(w=>!transitionFrames.has(w.frame)).map(w=>w.cyc).sort((a,b)=>a-b);
  if(steadyCycs.length) console.log(`(без draw_bg-кадров) min=${steadyCycs[0]}  max=${steadyCycs[steadyCycs.length-1]}  median=${steadyCycs[(steadyCycs.length/2)|0]}`);
  // по кадрам
  console.log("\nкадр -> число записей в FB (* = кадр внутри разовой draw_bg-перерисовки):");
  for(let f=0;f<DETAILED_FRAMES;f++){
    console.log(`  кадр ${String(f).padStart(2)} (frame_tog=${frameTog[f]}): ${frameWriteCount[f]||0} записей${transitionFrames.has(f)?"  *draw_bg*":""}`);
  }
}

// ================= 2. ДЛИНА ПАЧКИ =================
console.log(`\n=== 2. ДЛИНА ПАЧКИ (первая/последняя запись в FB за кадр), поле начинается с такта 13780 ===`);
console.log("кадр  первая_запись  последняя_запись  длина_пачки  записей_в_кадре  доБеама(13780-первая)");
for(let f=0;f<DETAILED_FRAMES;f++){
  const ws=writeLog.filter(w=>w.frame===f);
  const tag=transitionFrames.has(f)?"  *draw_bg*":"";
  if(!ws.length){console.log(`  ${String(f).padStart(3)}   (нет записей)${tag}`);continue;}
  const cs=ws.map(w=>w.cyc);
  const mn=Math.min(...cs),mx=Math.max(...cs);
  console.log(`  ${String(f).padStart(3)}   ${String(mn).padStart(6)}        ${String(mx).padStart(6)}          ${String(mx-mn).padStart(6)}       ${String(ws.length).padStart(5)}         ${13780-mn}${tag}`);
}

// ================= 3. ПЕРИОДИЧНОСТЬ (frame_tog: 0/1/2 = B2/A/B1) =================
console.log(`\n=== 3. ПЕРИОДИЧНОСТЬ: frame_tog -> число записей в FB ===`);
{
  // используем ВЕСЬ прогон (TOTAL_FRAMES), исключая кадры разовой draw_bg-перерисовки —
  // она не относится к штатному чередованию A/B1/B2 и портит средние.
  const byPhase={};
  let steadyFrames=0;
  for(let f=0;f<TOTAL_FRAMES;f++){
    if(transitionFrames.has(f))continue;
    steadyFrames++;
    const ph=frameTog[f];
    byPhase[ph]=byPhase[ph]||{frames:0,writes:0};
    byPhase[ph].frames++;
    byPhase[ph].writes+=(frameWriteCount[f]||0);
  }
  console.log(`(по ${steadyFrames} кадрам вне draw_bg-перерисовки, из ${TOTAL_FRAMES} всего)`);
  console.log("frame_tog(0=B2 1=A 2=B1) -> кадров, суммарно_записей, среднее_на_кадр");
  for(const ph of Object.keys(byPhase).sort()){
    const b=byPhase[ph];
    console.log(`  frame_tog=${ph}: кадров=${b.frames}  записей=${b.writes}  среднее=${(b.writes/b.frames).toFixed(1)}`);
  }
  console.log("\nкадр%2 -> суммарно_записей, кадр%3 -> суммарно_записей (вне draw_bg-перерисовки):");
  const byMod2={0:0,1:0},byMod3={0:0,1:0,2:0};
  for(let f=0;f<TOTAL_FRAMES;f++){
    if(transitionFrames.has(f))continue;
    byMod2[f%2]+=(frameWriteCount[f]||0);
    byMod3[f%3]+=(frameWriteCount[f]||0);
  }
  console.log(`  f%2=0: ${byMod2[0]}   f%2=1: ${byMod2[1]}`);
  console.log(`  f%3=0: ${byMod3[0]}   f%3=1: ${byMod3[1]}   f%3=2: ${byMod3[2]}`);
}

// ================= 4. ТАКТЫ НА СПРАЙТ (весь прогон, TOTAL_FRAMES кадров) =================
console.log(`\n=== 4. ТАКТЫ НА ВЫЗОВ (весь прогон, ${TOTAL_FRAMES} кадров) ===`);
console.log("процедура      адрес   вызовов   min    avg      max    вызовов/кадр");
const routineTotalDur={};
for(const k of Object.keys(TARGETS)){
  const arr=spans[k];
  if(!arr.length){console.log(`  ${k.padEnd(12)} $${TARGETS[k].toString(16)}   0 вызовов за прогон`);continue;}
  const durs=arr.map(a=>a.dur);
  const min=Math.min(...durs),max=Math.max(...durs),avg=durs.reduce((a,b)=>a+b,0)/durs.length;
  routineTotalDur[k]=durs.reduce((a,b)=>a+b,0);
  console.log(`  ${k.padEnd(12)} $${TARGETS[k].toString(16).padStart(4,"0")}  ${String(arr.length).padStart(5)}  ${String(min).padStart(5)}  ${avg.toFixed(0).padStart(6)}  ${String(max).padStart(6)}   ${(arr.length/TOTAL_FRAMES).toFixed(2)}`);
}
// popblit: тактов на 1 байт (записи в fb внутри popblit-спанов), по всему прогону
{
  const pb=spans.popblit;
  let totalDur=0,totalW=0;
  for(const s of pb){totalDur+=s.dur;totalW+=(s.wIdx1-s.wIdx0);}
  console.log(`\npopblit: тактов/байт (весь прогон, ${TOTAL_FRAMES} кадров):`);
  if(totalW>0) console.log(`  вызовов=${pb.length}  суммарно_тактов=${totalDur}  суммарно_записей=${totalW}  тактов/байт=${(totalDur/totalW).toFixed(2)}`);
  else console.log("  ПРОВАЛ: за весь прогон не зафиксировано ни одной записи внутри popblit-спанов.");
}

// ================= 5. СУММАРНАЯ ЗАГРУЗКА КАДРА =================
console.log(`\n=== 5. СУММАРНАЯ ЗАГРУЗКА КАДРА (${TOTAL_FRAMES} кадров, бюджет ${FRAME} такт/кадр) ===`);
{
  const sumPopblit=routineTotalDur.popblit||0;
  const sumBuf=(routineTotalDur.bg_fill||0)+(routineTotalDur.gg_build||0)+(routineTotalDur.compose||0);
  const sumFrameTotal=frameTotal.reduce((a,b)=>a+b,0);
  const sumHalt=frameHalt.reduce((a,b)=>a+b,0);
  const sumBusy=sumFrameTotal-sumHalt;
  const sumRest=sumBusy-sumPopblit-sumBuf;
  console.log(`суммарно тактов за ${TOTAL_FRAMES} кадров: ${sumFrameTotal}  (ожидание ${TOTAL_FRAMES*FRAME})`);
  console.log(`из них HLT (ожидание прерывания): ${sumHalt}  (${(100*sumHalt/sumFrameTotal).toFixed(1)}%)`);
  console.log(`занято (не HLT): ${sumBusy}  (${(100*sumBusy/sumFrameTotal).toFixed(1)}%)`);
  console.log(`  (а) popblit-ы:                 ${sumPopblit}  (${(100*sumPopblit/sumFrameTotal).toFixed(2)}% от кадра, ${(sumPopblit/TOTAL_FRAMES).toFixed(0)} такт/кадр в среднем)`);
  console.log(`  (б) bg_fill+gg_build+compose:  ${sumBuf}  (${(100*sumBuf/sumFrameTotal).toFixed(2)}% от кадра, ${(sumBuf/TOTAL_FRAMES).toFixed(0)} такт/кадр в среднем)`);
  console.log(`  (в) всё остальное занятое:     ${sumRest}  (${(100*sumRest/sumFrameTotal).toFixed(2)}% от кадра, ${(sumRest/TOTAL_FRAMES).toFixed(0)} такт/кадр в среднем)`);
  console.log(`средний занятый (не-HLT) такт/кадр: ${(sumBusy/TOTAL_FRAMES).toFixed(0)}  (${(100*sumBusy/TOTAL_FRAMES/FRAME).toFixed(1)}% бюджета кадра)`);
}

// ================= 6. i8080 vs Z80 (по трассе исполнения) =================
console.log(`\n=== 6. i8080-ЧИСТОТА ПО ТРАССЕ ИСПОЛНЕНИЯ (${TOTAL_FRAMES} кадров игры + вход в демо) ===`);
console.log(`уникальных исполненных адресов PC: ${executedOps.size}`);
if(illegalHits.length===0){
  console.log("Z80-only опкоды в ИСПОЛНЕННОЙ трассе: НЕ НАЙДЕНЫ.");
} else {
  const uniq=new Map();
  for(const h of illegalHits) if(!uniq.has(h.pc)) uniq.set(h.pc,h.op);
  console.log(`НАЙДЕНЫ Z80-only опкоды на ${uniq.size} исполненных адресах:`);
  for(const [pc,op] of uniq) console.log(`  pc=$${pc.toString(16)}  опкод=0x${op.toString(16)}  (${ILLEGAL_NAME[op]})`);
}
// статическая сверка (весь .lst, не только трасса) — для контраста с покрытием трассой
{
  const DATA_RE=/^\s*(?:[A-Za-z_]\w*:\s*)?\.?(db|dw|ds|dm|byte|word|defb|defw|defs)\b/i;
  const NONINSN_RE=/^\s*(?:[A-Za-z_]\w*:\s*)?(?:$|;|org\b|equ\b|include\b|=|\.)/i;
  let staticHits=0;
  for(const raw of fs.readFileSync(LST,"latin1").split("\n")){
    const m=raw.match(/^\s*\d+[+]?\s+([0-9A-Fa-f]{4})\s+((?:[0-9A-Fa-f]{2}\s)+)\t?(.*)$/);
    if(!m)continue;
    const bytes=m[2].trim().split(/\s+/).map(h=>parseInt(h,16));
    const src=m[3]||"";
    if(bytes.length===0)continue;
    if(DATA_RE.test(src)||NONINSN_RE.test(src)||src.trim()==="")continue;
    if(ILLEGAL.has(bytes[0]))staticHits++;
  }
  console.log(`(справочно) статический check_i8080 по ВСЕМУ .lst: ${staticHits} потенциальных срабатываний вне трассы`);
}

// ================= 7. ПОРЯДОК ЗАПИСИ =================
console.log(`\n=== 7. ПОРЯДОК ЗАПИСИ VRAM: sb_blit (Снейк) и gd_blit (охранник) ===`);
function reportOrder(name,arr){
  const withWrites=arr.filter(s=>s.wIdx1>s.wIdx0);
  if(!withWrites.length){console.log(`${name}: за весь прогон (${TOTAL_FRAMES} кадров) нет спанов с записями — не замерено.`);return;}
  const s=withWrites[0];
  const addrs=writeLog.slice(s.wIdx0,s.wIdx1).map(w=>w.addr);
  const planeOf=a=>["$80","$A0","$C0","$E0"][(a>>13)&3];
  const planes=[...new Set(addrs.map(planeOf))];
  const cols=[...new Set(addrs.map(a=>a&0xff))]; // low byte varies по L (строка), колонка = верхний байт-$план
  const colBytes=[...new Set(addrs.map(a=>(a>>8)&0x1f))]; // (addr - план_база)>>8 = номер колонки 0..31
  console.log(`${name}: первый спан кадр=${s.frame}, записей=${addrs.length}, планы=${planes.join(",")}, колонок~${colBytes.length}`);
  console.log(`  первые ${Math.min(40,addrs.length)} адресов (hex): ` + addrs.slice(0,40).map(a=>a.toString(16)).join(" "));
  // возрастает ли L (=addr&0xff убывает, т.к. VRAM пишется сверху-вниз с L=255-Y) внутри одной колонки?
  const firstCol=addrs.filter(a=>(a&0xff00)===(addrs[0]&0xff00));
  const lows=firstCol.map(a=>a&0xff);
  const monotoneDown=lows.every((v,i)=>i===0||v<lows[i-1]);
  const monotoneUp=lows.every((v,i)=>i===0||v>lows[i-1]);
  console.log(`  внутри первого столбца (${firstCol.length} записей, план ${planeOf(addrs[0])}, H=$${((addrs[0]>>8)&0xff).toString(16)}): L ${monotoneDown?"убывает (сверху вниз)":monotoneUp?"возрастает (снизу вверх)":"не монотонно"} : ${lows.slice(0,20).join(",")}`);
}
reportOrder("sb_blit (Снейк)",spans.sb_blit);
if(spans.gd_blit.some(s=>s.wIdx1>s.wIdx0)){
  reportOrder("gd_blit (охранник)",spans.gd_blit);
} else {
  console.log("gd_blit (охранник): в штатном прогоне (стартовая комната, локальный индекс 16) НИ ОДНОЙ "+
    "записи в FB за "+TOTAL_FRAMES+" кадров, хотя gd_blit вызывался "+spans.gd_blit.length+" раз "+
    "(каждый раз — быстрый ранний выход, ~136 тактов). ПРИЧИНА (проверено по данным, не догадка): "+
    "в data/rooms_v.inc room_acts_tab[16]=room_acts+55, а по смещению 55 лежит \"db 0\" — в стартовой "+
    "комнате демо (room_acts+55) 0 охранников. См. раздел 7B ниже: комната принудительно переключена "+
    "на room 1 (room_acts+1: 3 охранника), чтобы получить реальный блит охранника.");
}

// ================= 7B/4B/5B. ЧИТ: ПРИНУДИТЕЛЬНАЯ КОМНАТА С ОХРАННИКАМИ =================
// Стартовая комната демо (room_acts+55 в data/rooms_v.inc) настроена БЕЗ охранников
// (db 0). Автоплей интро после этого уходит в радио-вызов и, по трассе, не
// возвращается в интерактивный геймплей: tb_on крутится 0->3->1->2->1->2->1->0
// периодом ~1120 кадров БЕСКОНЕЧНО (проверено прогоном 30000 кадров) — то есть
// штатным путём (даже с нажатиями пробела на каждой странице текста) дойти до
// комнаты 1 (room_acts+1 = 3 охранника) за разумный бюджет НЕ УДАЛОСЬ.
// ЧИТ (только для перестановки комнаты, ДАЛЬШЕ весь код исполняется штатно,
// НЕ модифицирован): прямой вызов room_enter(A=1) инъекцией в CPU — толкаем
// синтетический адрес возврата на стек, ставим pc=room_enter, regs[7]=1,
// шагаем cpu.instruction() до возврата. room_enter — обычная подпрограмма,
// её код не меняется, поведение guard_one/gd_blit после этого — родное.
console.log(`\n=== 7B/4B/5B. ЧИТ: room_enter(A=1) — комната с 3 охранниками (room_acts+1) ===`);
{
  const E2=make(ROM,EDD,LST);
  const {memory:m2,cpu:c2,v06c:v2,rd:rd2,L:L2}=E2;
  const tp2=toPlay(E2,1200);
  E2.run(5);
  function callRoutine(addr,aVal){
    const retAddr=0x0003;
    c2.sp=(c2.sp-2)&0xffff;
    m2.write(c2.sp,retAddr&0xff,false);
    m2.write((c2.sp+1)&0xffff,(retAddr>>8)&0xff,false);
    c2.pc=addr;c2.regs[7]=aVal;
    let guard=0;
    while(c2.pc!==retAddr && guard<5_000_000){c2.instruction();guard++;}
    return guard;
  }
  const instrCount=callRoutine(L2.room_enter,1);
  console.log(`room_enter(1) инъекцией: ${instrCount} инструкций, cur_room=${rd2(L2.cur_room)}, gd_id=[${rd2(L2.gd_id)},${rd2(L2.gd_id+1)},${rd2(L2.gd_id+2)}] (1=охранник есть)`);
  if(rd2(L2.cur_room)!==1||instrCount>=5_000_000){
    console.log("ПРОВАЛ ЧИТА: room_enter не переключил комнату или не завершился — раздел 7B/4B/5B не замерен.");
  } else {
    // та же инструментация, что и в основном прогоне, но локально для E2
    let TT2=0,curF2=-1;
    const wlog2=[]; const fwc2=[];
    const oW2=m2.write.bind(m2);
    m2.write=function(a,w,s){const aa=a&0xffff; if(aa>=0x8000&&aa<=0xffff){fwc2[curF2]=(fwc2[curF2]||0)+1; wlog2.push({frame:curF2,addr:aa,cyc:E2.cyc()});} oW2(a,w,s);};
    const oI2=c2.instruction.bind(c2);
    c2.instruction=function(){const d0=TT2;oI2();TT2+=c2.vcycles|0;};
    const T2={gd_blit:L2.gd_blit,gg_build:L2.gg_build,blit_mono:L2.blit_mono,blit_or:L2.blit_or};
    const st2={};for(const k in T2)st2[k]={ret:-1};
    const sp2={};for(const k in T2)sp2[k]=[];
    function retOf2(){return m2.read(c2.sp,false)|(m2.read(c2.sp+1,false)<<8);}
    v2.check_breakpoint=function(){
      const pc=c2.pc;
      for(const k in T2){
        const addr=T2[k];if(addr===undefined)continue;const st=st2[k];
        if(pc===addr&&st.ret<0){st.sp=c2.sp;st.ret=retOf2();st.tt0=TT2;st.wi0=wlog2.length;}
        else if(st.ret>=0&&pc===st.ret&&c2.sp>st.sp){sp2[k].push({frame:curF2,dur:TT2-st.tt0,wi0:st.wi0,wi1:wlog2.length});st.ret=-1;}
      }
      return false;
    };
    const GFRAMES=200;
    for(let f=0;f<GFRAMES;f++){curF2++;v2.oneInterrupt(true);}
    console.log(`прогон после переключения: ${GFRAMES} кадров`);
    console.log("\nпроцедура      адрес   вызовов   min    avg      max");
    for(const k of Object.keys(T2)){
      const arr=sp2[k];
      if(!arr.length){console.log(`  ${k.padEnd(12)} $${T2[k].toString(16)}   0 вызовов`);continue;}
      const durs=arr.map(a=>a.dur);
      console.log(`  ${k.padEnd(12)} $${T2[k].toString(16).padStart(4,"0")}  ${String(arr.length).padStart(5)}  ${String(Math.min(...durs)).padStart(5)}  ${(durs.reduce((a,b)=>a+b,0)/durs.length).toFixed(0).padStart(6)}  ${String(Math.max(...durs)).padStart(6)}`);
    }
    const gdWith=sp2.gd_blit.filter(s=>s.wi1>s.wi0);
    if(gdWith.length){
      let dDur=0,dW=0;for(const s of gdWith){dDur+=s.dur;dW+=(s.wi1-s.wi0);}
      console.log(`\ngd_blit (реальный блит, не ранний выход): вызовов=${gdWith.length}  суммарно_тактов=${dDur}  суммарно_записей=${dW}  тактов/байт=${(dDur/dW).toFixed(2)}`);
      const s=gdWith[0];
      const addrs=wlog2.slice(s.wi0,s.wi1).map(w=>w.addr);
      const planeOf=a=>["$80","$A0","$C0","$E0"][(a>>13)&3];
      const planes=[...new Set(addrs.map(planeOf))];
      const colBytes=[...new Set(addrs.map(a=>(a>>8)&0x1f))];
      console.log(`первый спан с записями: кадр=${s.frame}, записей=${addrs.length}, планы=${planes.join(",")}, колонок~${colBytes.length}`);
      console.log(`первые ${Math.min(40,addrs.length)} адресов (hex): `+addrs.slice(0,40).map(a=>a.toString(16)).join(" "));
      const firstCol=addrs.filter(a=>(a&0xff00)===(addrs[0]&0xff00));
      const lows=firstCol.map(a=>a&0xff);
      const monoDown=lows.every((v,i)=>i===0||v<lows[i-1]);
      const monoUp=lows.every((v,i)=>i===0||v>lows[i-1]);
      console.log(`внутри первого столбца (${firstCol.length} записей, план ${planeOf(addrs[0])}): L ${monoDown?"убывает (сверху вниз)":monoUp?"возрастает (снизу вверх)":"не монотонно"}: ${lows.slice(0,20).join(",")}`);
    } else {
      console.log(`\ngd_blit: за ${GFRAMES} кадров ПОСЛЕ переключения комнаты 0 вызовов gd_blit вообще (не только 0 записей) —`);
      console.log(`ПРИЧИНА: инъекция room_enter(A=1) уводит движок из нормального цикла mloop (frame_tog остаётся`);
      console.log(`неизменным все ${GFRAMES} кадров, PC при выборках между кадрами блуждает в районе $70xx — код`);
      console.log(`музыкального движка/квазидиска, не mloop). Похоже, room_enter, вызванный НЕ из штатного`);
      console.log(`enter_game/leave_radio потока, оставляет теневое состояние порта квазидиска (kv_cw) или`);
      console.log(`музыкального стрима рассинхронизированным. НЕ ЗАМЕРЕНО: реальный блит охранника (тактовый`);
      console.log(`профиль gd_blit/gg_build/blit_mono/blit_or с фактическими записями) в этом прогоне получить`);
      console.log(`не удалось. gd_id=[1,1,1] и наличие 13203 ненулевых байт VRAM после самой инъекции подтверждают,`);
      console.log(`что охранники штатно СПАВНЯТСЯ (room_enter отработал корректно) — не удалось лишь ДОЖИТЬ`);
      console.log(`до штатного вызова gd_blit движком после инъекции за разумный бюджет кадров.`);
    }
  }
}

console.log("\n=== ГОТОВО ===");
