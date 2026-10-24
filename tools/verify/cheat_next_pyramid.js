// cheat_next_pyramid.js — головной тест отладочных читов перехода: N («следующая
// пирамида», +1) и H («прыжок», +5). Оба идут через общую точку vec_hop в vec_isr.asm.
//
// ЧТО ПРОВЕРЯЕТ:
// Если в образе нет vec_hop (блок снят 050301b), гейт НЕ зеленеет на пустой выборке:
// он явно SKIP'ается. Клавиш N/H нет — проверять нечего; версия с читами — git revert.
//  1. ПЕРЕХОД ДОЕЗЖАЕТ. После нажатия игра должна показать карту долины, загрузить нужную
//     пирамиду, провести героя по лестнице входа и вернуться в геймплей (GameStatus=5).
//     Ранее переход вис на GS=4 / subStatus=2 / statusEntrada=1: чит не задавал
//     puertaEntrada (штатный выход копирует её из данных двери), поэтому setSprDoorProta
//     брал не тот элемент pyramidDoors, герой оказывался вне поля (ProtaY=248), а входная
//     дверь никогда не «закрывалась» (puertaCerrada=0) — quietoFinEsc ждал вечно.
//  2. СТРЕЛКА НА КАРТЕ ВЕРНА С ПЕРВОГО КАДРА. puertaSalida должна равняться направлению
//     двери, через которую выходим (1,2,4,8 по номеру слота), а паттерн спрайта стрелки
//     (attrFlechaMap+2) — соответствующему элементу numSprFlechas. Ранее чит puertaSalida
//     не трогал, в ней лежал НОЛЬ -> индекс 0 -> паттерн 232 = стрелка ВВЕРХ независимо от
//     пути. Момент «карта появилась» ловится по ВЫЗОВУ vbp_map (ветка палитры карты), а НЕ
//     по GameStatus=4: при GS=4 ещё идёт шторка перехода и карта не построена.
//  3. ТАБЛИЦА vec_hop_ent НЕ РАЗЪЕХАЛАСЬ С КАРТАМИ. Для прыжка на 1 puertaEntrada, взятая
//     читом из выпеченной таблицы, обязана совпасть с байтом 6 настоящей двери в ОЗУ.
//
// СТРОГОСТЬ (2026-08-02): у КАЖДОЙ проверки есть МИНИМАЛЬНОЕ ЧИСЛО СРАБАТЫВАНИЙ, и гейт
// краснеет, если проверка не отработала ни разу. Ноль проверок — это ПРОВАЛ, а не успех.
// ЧТО БЫЛО СЛОМАНО: счётчик переходов брался из process.argv[3], а вызывали гейт как
// `node cheat_next_pyramid.js rom.rom rom.sym` (путь к .sym — законный аргумент, он же
// argv[4]). parseInt("...sym") = NaN, условие `step<NaN` ложно с первой итерации, цикл
// чита N не выполнялся НИ РАЗУ, done оставался 0 — и печаталось «N — 0 переходов ... OK»
// с кодом возврата 0. Сам чит N при этом был исправен. Теперь аргументы разбираются по
// ВИДУ (.rom / .sym / число), а не по позиции, нечисловой счётчик — ошибка запуска, и в
// конце стоит таблица покрытия: любая проверка ниже своего минимума = ПРОВАЛ.
//
// Запуск:  node tools/verify/cheat_next_pyramid.js [rom] [sym] [сколько переходов]
//          (порядок аргументов свободен: .rom, .sym и число различаются по виду)
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";
// --- разбор аргументов ПО ВИДУ, а не по позиции (см. «что было сломано» выше) ----------
let rom = null, symArg = null, WANT = null;
for (const a of process.argv.slice(2)) {
  if (/\.sym$/i.test(a)) { symArg = a; continue; }
  if (/^\d+$/.test(a)) { WANT = parseInt(a, 10); continue; }
  if (/\.rom$/i.test(a) && rom === null) { rom = a; continue; }
  console.error(`не понял аргумент «${a}»: ожидались путь к .rom, путь к .sym и число переходов`);
  process.exit(2);
}
rom = rom || "build/kvalley_8c.rom";
if (WANT === null) WANT = 6;             // сколько переходов подряд проверяем
if (!(WANT >= 1)) { console.error(`число переходов должно быть >= 1, получено ${WANT}`); process.exit(2); }
const VERBOSE = process.env.KV_VERBOSE === "1";

// --- эмулятор (тот же скелет, что в tools/verify/level_color_probe.js) --------------
const g = {}; g.window = g;
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.document={createElement:()=>fc(),getElementById:()=>fc(),all:undefined};
g.requestAnimationFrame=()=>0; g.setTimeout=()=>0; g.print=()=>0; g.console=console;
const ctx = vm.createContext(g);
for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
  vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"), ctx, {filename:f});
const memory=new ctx.Memory(), keyboard=new ctx.Keyboard(), timer=new ctx.I8253(), ay=new ctx.AY();
const floppy=new(ctx.Floppy().FD1793)(), io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io), tape={advance:()=>{},sample:0,reset:()=>{}};
const v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
v06c.bmp=new Uint32Array(576*288); v06c.displayFrame=()=>{}; v06c.dbg=null;
// ВНИМАНИЕ: soundnik.soundStep НЕ глушим — он тактует ВИ53, на нём часы музыки.
const img=new Uint8Array(fs.readFileSync(rom));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();

const rd=a=>memory.read(a&0xffff);
const run=n=>{for(let i=0;i<n;i++) v06c.oneInterrupt(true);};
const key=(code,down)=>{const e={keyCode:code,which:code,preventDefault(){},stopPropagation(){}};
  if(down) keyboard.keyDown(e); else keyboard.keyUp(e);};
// ЛОВУШКА НА vbp_map — ветку палитры КАРТЫ, ПЛЮС «карта уже живая» (GameStatus=5 при чётном
// flagPiramideMap = тик пергамента). Одного vbp_map с задачи #21 мало: палитра карты теперь
// применяется прерыванием СРАЗУ ПОСЛЕ её заказа в setupPergamino, то есть ещё ДО того, как
// та же setupPergamino распакует спрайты и поставит стрелку — раньше первый вызов vbp_map
// случался лишь по окончании постройки (прерывания на глубине 2 палитру не трогали), и
// «vbp_map == карта построена» работало случайно. GameStatus=4 по-прежнему не критерий:
// при нём идёт шторка перехода.
let mapHit=false, MAPPC=-1;	// MAPPC заполняется ниже, когда прочитан .sym
v06c.check_breakpoint=function(){ if(cpu.pc===MAPPC) mapHit=true; return false; };
const frame=()=>{ mapHit=false; v06c.oneInterrupt(true);
  return mapHit && rd(A.GameStatus)===5 && !(rd(A.flagPiramideMap)&1); };

// --- адреса: ТОЛЬКО ИЗ .sym (задача #37: база игровых переменных переезжает при
// уплотнении нижней ОЗУ, зашитые 0x6C00... после переезда указывали бы в код) -----------
const symPath = symArg || rom.replace(/\.rom$/, ".sym");
const L = {};
for (const l of fs.readFileSync(symPath, "latin1").split("\n")) {
  const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if (m) L[m[1]] = parseInt(m[2], 16);
}
if (L.vec_hop === undefined) {
  console.log("ROM=" + rom);
  console.log("читов в сборке нет — проверять нечего (нет vec_hop и клавиш N/H)");
  console.log("РЕЗУЛЬТАТ: SKIP");
  process.exit(0);
}
const A = {};
for (const n of ["GameStatus","subStatus","timer","waitCounter","Vidas","flagPiramideMap",
  "piramideActual","piramideDest","puertaEntrada","puertaSalida","statusEntrada",
  "flagEntraSale","flagStageClear","ProtaY","ProtaX","puertaCerrada","pyramidDoors",
  "gemasCogidas","ElemEnProceso","attrFlechaMap","numSprFlechas","vbp_map","vec_cheats"]) {
  if (L[n] === undefined) { console.error("нет символа " + n + " в " + symPath); process.exit(2); }
  A[n] = L[n];
}
MAPPC = A.vbp_map;
const DIRNAME={1:"вверх",2:"вниз",4:"влево",8:"вправо",0:"(ноль)"};
// направление слота двери -> паттерн стрелки: индекс в numSprFlechas = puertaSalida>>1
// с поправкой 4->3 (см. setFlechaMap). Таблицу читаем из ROM, а не зашиваем числами.
const SPRDIR={1:rd(A.numSprFlechas),2:rd(A.numSprFlechas+1),4:rd(A.numSprFlechas+2),8:rd(A.numSprFlechas+3)};
// Дверь текущей пирамиды, ведущая в pyr: возвращает направление слота (1,2,4,8) и байт 6.
function doorTo(pyr){
  for(let d=0; d<4; d++){
    if(rd(A.pyramidDoors+d*7)===0xFF) continue;
    if(rd(A.pyramidDoors+d*7+5)===pyr) return {slot:d, dir:1<<d, entra:rd(A.pyramidDoors+d*7+6)};
  }
  return null;
}
// СЧЁТЧИКИ СРАБАТЫВАНИЙ (см. таблицу покрытия в конце): проверка, не отработавшая ни
// разу, обязана красить гейт, а не молчать.
const C={arrow:0, entra:0, hop:0, bound:0, nodoor:0};
// Ждём ПЕРВОГО кадра карты и сверяем стрелку. Возвращает текст ошибки или null.
function checkArrow(tag, want){
  let f=0, got=false;
  for(; f<1200; f++){ if(frame()){ got=true; break; } }
  if(!got) return `${tag}: карта (vbp_map) не появилась за ${f} кадров`;
  C.arrow++;
  const ps=rd(A.puertaSalida), pat=rd(A.attrFlechaMap+2);
  const line=`  первый кадр карты: puertaSalida=${ps} (${DIRNAME[ps]||"?"}) паттерн=${pat} `+
             `[ожидалось ${want.dir} (${DIRNAME[want.dir]}) / ${SPRDIR[want.dir]}]`;
  console.log(line);
  if(ps!==want.dir) return `${tag}: стрелка карты смотрит НЕ ТУДА — puertaSalida=${ps}, ждали ${want.dir}`;
  if(pat!==SPRDIR[want.dir]) return `${tag}: паттерн стрелки ${pat}, ждали ${SPRDIR[want.dir]}`;
  if(want.entra!==undefined){
    C.entra++;
    if(rd(A.puertaEntrada)!==want.entra)
      return `${tag}: puertaEntrada=${rd(A.puertaEntrada)}, а в данных двери ${want.entra} `+
             `— таблица vec_hop_ent разъехалась с картами (tools/maps_compile.py)`;
  }
  return null;
}
const snap=()=>({GS:rd(A.GameStatus),sub:rd(A.subStatus),wc:rd(A.waitCounter),
  pira:rd(A.piramideActual),dest:rd(A.piramideDest),pe:rd(A.puertaEntrada),
  se:rd(A.statusEntrada),fes:rd(A.flagEntraSale),Y:rd(A.ProtaY),X:rd(A.ProtaX),
  pc:rd(A.puertaCerrada),fpm:rd(A.flagPiramideMap)});
const fmt=s=>`GS=${s.GS} sub=${s.sub} wc=${s.wc} pira=${s.pira} dest=${s.dest} `+
  `puertaEntrada=${s.pe} statusEntrada=${s.se} flagEntraSale=${s.fes} `+
  `ProtaY=${s.Y} ProtaX=${s.X} puertaCerrada=${s.pc} fpm=${s.fpm}`;

// --- буст в геймплей -----------------------------------------------------------------
//  СТАРТ ТЕПЕРЬ КОМБИНАЦИЕЙ F1+F3, А НЕ ПРОБЕЛОМ (замок читов, 2026-08-11). Читы N и H,
//  которые проверяет этот гейт, с обычного старта пробелом НЕ РАБОТАЮТ вовсе: vec_cheats
//  остаётся нулём, и весь блок читов в vec_isr пропускается. Прежний стенд после введения
//  замка краснел бы на первом же переходе — и это была бы ПРАВДА про обычную игру, а не
//  дефект. Поэтому стенд переведён на тот старт, при котором читы вообще существуют.
//  Пробел здесь не нажимается ни разу: F1+F3 запускают партию сами (vec_f15_scan
//  дописывает бит SPACE в образ ряда 8, старт идёт штатным chkPushAnyKey -> StartGame_0).
//  Что замок закрыт при старте пробелом — проверяет tools/verify/cheat_god_death.js.
run(400);
let ok=false;
key(112,true); key(114,true);            // F1 + F3 держим
for(let blk=0; blk<60 && !ok; blk++){
  run(25);
  if(rd(A.GameStatus)===5 && (rd(A.flagPiramideMap)&1)) ok=true;
}
key(112,false); key(114,false); run(5);
if(!ok){ console.log("НЕ УДАЛОСЬ войти в геймплей: "+fmt(snap())); process.exit(2); }
if(rd(A.vec_cheats)!==1){ console.log(`ЗАМОК ЧИТОВ НЕ ОТКРЫЛСЯ: vec_cheats=${rd(A.vec_cheats)} — читы N/H заведомо мертвы, проверять нечего`); process.exit(2); }
run(60); // дать герою устояться
console.log(`старт геймплея (F1+F3, замок открыт): ${fmt(snap())}\n`);

// --- цикл: N -> ждём возврата в GS=5 на следующей пирамиде -----------------------------
const LIMIT = 1200; // кадров на один переход (штатный переход ~200-400 кадров)
let done=0, fail=null, arrowFail=null;
for(let step=0; step<WANT; step++){
  const before=rd(A.piramideActual);
  // выходная дверь (в пирамиду before+1) — по ней ждём и направление стрелки, и дверь входа
  const want=doorTo(before+1);
  // фронт нажатия: N вниз на 3 кадра, потом отпустить
  key(78,true); run(3); key(78,false);
  // ДВЕРИ НЕТ = проверка стрелки не отработала. Молча пропускать нельзя: это дыра в
  // покрытии, её ловит таблица в конце (C.arrow < done).
  if(want){ const e=checkArrow(`переход ${before} -> ${before+1}`, want); if(e && !arrowFail) arrowFail=e; }
  else { C.nodoor++; console.log(`  ВНИМАНИЕ: у пирамиды ${before} нет двери в ${before+1} — стрелка не проверена`); }
  let f=0, last=null;
  for(; f<LIMIT; f++){
    run(1);
    const s=snap();
    if(VERBOSE && (last===null || fmt(s)!==fmt(last))) console.log(`  +${f} ${fmt(s)}`);
    last=s;
    if(s.GS===5 && s.pira===before+1 && s.fes===0) break;
  }
  const s=snap();
  if(f>=LIMIT){ fail={step,before,frames:f,s}; break; }
  run(40); // подышать в геймплее
  done++;
  console.log(`переход ${before} -> ${rd(A.piramideActual)}: ЗАВЕРШЁН за ${f} кадров  (${fmt(snap())})`);
}

console.log("");
if(fail){
  console.log(`ЗАВИС на переходе ${fail.before} -> ${fail.before+1}: за ${fail.frames} кадров не вернулись в GS=5`);
  console.log(`  состояние: ${fmt(fail.s)}`);
  for(let d=0; d<4; d++){
    const b=[]; for(let i=0;i<7;i++) b.push(rd(A.pyramidDoors+d*7+i).toString(16).padStart(2,"0"));
    console.log(`  pyramidDoors[${d}] = ${b.join(" ")}  (Y Xf X room status dest dir)`);
  }
  console.log(`ВЕРДИКТ: переходов подряд ${done} из ${WANT} — ПРОВАЛ`);
  process.exit(1);
}
if(arrowFail){
  console.log("СТРЕЛКА КАРТЫ (чит N): "+arrowFail);
  console.log(`ВЕРДИКТ: переходы доезжают (${done}), но направление стрелки неверно — ПРОВАЛ`);
  process.exit(1);
}
console.log(`${done} переходов читом N подряд завершились, пирамида ${rd(A.piramideActual)}, `+
            `стрелка карты верна с первого кадра каждого`);

// --- ФАЗА 2: чит H (прыжок на 5 пирамид) ----------------------------------------------
// Приёмка владельца: пять нажатий H из первой пирамиды доводят до 15-й без зависаний.
// Здесь мы уже не на первой (фаза 1 увела вперёд), поэтому просто жмём H, пока прыжки
// двигают игру, и проверяем: каждый прыжок доезжает, стрелка верна, упор в 15-ю.
console.log("");
let hops=0;
// СКОЛЬКО ПРЫЖКОВ ОБЯЗАНО ВЫЙТИ с той пирамиды, где нас оставила фаза 1 (по +5 до упора
// в 15-ю). Число считается ЗАРАНЕЕ и служит минимумом покрытия фазы 2: «прыжков 0, но
// зелено» больше невозможно.
let hopsExpect=0;
for(let p=rd(A.piramideActual); p<15; p=Math.min(p+5,15)) hopsExpect++;
if(hopsExpect===0){
  console.log(`ПРОВАЛ: фаза 1 оставила нас на пирамиде ${rd(A.piramideActual)} — читу H негде `+
              `отработать. Уменьшите число переходов (аргумент-число).`);
  process.exit(1);
}
const arrowN=C.arrow, entraN=C.entra;	// срез счётчиков между фазами
for(let step=0; step<hopsExpect+1; step++){
  const before=rd(A.piramideActual);
  if(before>=15) break;
  const want=doorTo(before+1);	// ВЫХОДИМ всегда через дверь в соседнюю пирамиду
  const expect=Math.min(before+5,15);
  key(72,true); run(3); key(72,false);
  if(want){ const e=checkArrow(`прыжок ${before} -> ${expect}`, {dir:want.dir}); if(e && !arrowFail) arrowFail=e; }
  else { C.nodoor++; console.log(`  ВНИМАНИЕ: у пирамиды ${before} нет двери в ${before+1} — стрелка не проверена`); }
  let f=0;
  for(; f<LIMIT; f++){ run(1);
    const s=snap(); if(s.GS===5 && s.pira===expect && s.fes===0) break; }
  if(f>=LIMIT){
    console.log(`ЗАВИС на прыжке ${before} -> ${expect} за ${f} кадров: ${fmt(snap())}`);
    process.exit(1);
  }
  run(40); hops++;
  console.log(`прыжок ${before} -> ${rd(A.piramideActual)}: ЗАВЕРШЁН за ${f} кадров  (${fmt(snap())})`);
}
if(rd(A.piramideActual)!==15){
  console.log(`ПРОВАЛ: прыжки H не довели до 15-й пирамиды (остановились на ${rd(A.piramideActual)})`);
  process.exit(1);
}
// упор в границу: с 15-й чит обязан МОЛЧАТЬ, а не улетать за конец списка пирамид
key(72,true); run(3); key(72,false); run(30);
C.bound++;
if(rd(A.GameStatus)!==5 || rd(A.piramideActual)!==15){
  console.log(`ПРОВАЛ: H с 15-й пирамиды не промолчал — ${fmt(snap())}`);
  process.exit(1);
}
if(arrowFail){ console.log("СТРЕЛКА КАРТЫ (чит H): "+arrowFail); process.exit(1); }
console.log(`прыжков читом H: ${hops}, дошли до 15-й, с 15-й чит молчит`);

// --- ТАБЛИЦА ПОКРЫТИЯ: ноль срабатываний = ПРОВАЛ ---------------------------------------
// Каждая проверка гейта обязана отработать хотя бы столько раз, сколько заявлено. Без
// этой таблицы гейт однажды уже печатал «N — 0 переходов ... OK» (см. шапку файла).
console.log("");
const COVER=[
  ["N: переход доехал до GS=5 на следующей пирамиде", done,          WANT],
  ["N: стрелка карты верна на ПЕРВОМ кадре",          arrowN,        WANT],
  ["N: puertaEntrada == байт 6 двери (vec_hop_ent)",  entraN,        WANT],
  ["H: прыжок доехал (+5 до упора)",                  hops,          hopsExpect],
  ["H: стрелка карты верна на ПЕРВОМ кадре",          C.arrow-arrowN,hopsExpect],
  ["H: с 15-й пирамиды чит молчит",                   C.bound,       1],
];
let cov=true;
for(const [name,got,min] of COVER){
  const bad=got<min; if(bad) cov=false;
  console.log(`  ${bad?"НЕ ОТРАБОТАЛА":"ok           "}  ${name}: срабатываний ${got}, минимум ${min}`);
}
if(C.nodoor) console.log(`  дверей в соседнюю пирамиду не нашлось: ${C.nodoor} раз (стрелка там не проверена)`);
if(!cov){
  console.log("ВЕРДИКТ: часть проверок не отработала ни разу (или недобрала) — ПРОВАЛ");
  process.exit(1);
}
console.log(`ВЕРДИКТ: N — ${done} переходов, H — ${hops} прыжков, стрелка карты верна `+
            `с первого кадра во всех, все проверки отработали — OK`);
process.exit(0);
