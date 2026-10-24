// bonus_ending_gate.js — ГЕЙТ ФИНАЛЬНОГО ЭКРАНА (бонус/концовка).
//
// ЧТО СТОРОЖИТ. Экран концовки (setupEnding: большая кирпичная полупирамида справа с
// дверью, две песчаниковые пирамидки слева, шесть звёзд, песчаный пол, табло; затем герой
// выходит из двери, идёт влево, прыгает, и выводится CONGRATULATIONS / SPECIAL BONUS 10000).
// Штатно он достижим ТОЛЬКО по прохождении всех 15 пирамид, поэтому ни один обычный прогон
// его не задевает, и любая поломка тайлов/адресов/блиттера здесь живёт незамеченной.
// Если в образе нет vec_hop (блок снят 050301b), клавиши E нет и гейт 15 пирамид не
// играет: он явно SKIP'ается, а не зеленеет на пустой выборке. Версия с читами — git revert.
//
// ПОЧЕМУ ГЕЙТ ПЕРЕПИСАН (2026-07-31). Прошлая версия гнала ДВА ROM в локстепе: нативный
// против «отката» со старым soft-VDP (сборка KV_NO_NATBONUS). soft-VDP из проекта удалён
// целиком (отдельная закрытая задача, «ноль следов»), сравнивать стало не с чем — гейт
// падал на ЛЮБОЙ сборке с одинаковым maxdiff 9944. Плюс в нём были зашиты адреса
// GameStatus/subStatus (0x6B00/0x6B01), протухшие ещё раньше. Теперь оракул — сохранённый
// PNG-эталон, как у screens_palette_check.js, а ВСЕ адреса берутся из .sym по имени
// (никаких чисел: база переменных уже переезжала 0x6B00 -> 0x6C00 -> 0x7092).
//
// ПЕРЕСНЯТЫ ЭТАЛОНЫ 4_jump/5_bonus (2026-07-31, задача #37). Уплотнение нижней ОЗУ
// (347c678) сдвинуло код на 3 байта, и в концовке разъехался ДРОБНЫЙ X героя
// (ProtaXdecimal расходится на тике 47 прыжка): герой приземляется на 6 игровых пикселей
// правее. Фазы 1-3 (сцена, выход из двери, ходьба) при этом бит-в-бит те же. Проверено,
// что новое поведение ДЕТЕРМИНИРОВАНО: заливка зоны переменных 0x00/0xAA/0x55 перед
// стартом даёт один и тот же кадр (то есть это не чтение неинициализированной ОЗУ).
//
// ПЕРЕСНЯТЫ ЭТАЛОНЫ 4_jump/5_bonus ЕЩЁ РАЗ (2026-08-03, задача #47) — ПО ТОЙ ЖЕ ПРИЧИНЕ.
// Уплотнение БЛОКА игровых переменных (1043 -> 621 Б, база 0x7092 -> 0x7238) укоротило bc
// блочных очисток startCode/loadGameGfx на 422 итерации => бут и загрузка уровня кончаются
// раньше => СВОБОДНО БЕГУЩИЙ `timer` к моменту нажатия E отличается на 2, а концовка к его
// фазе чувствительна: герой приземляется в другой точке прыжка. Что это НЕ регрессия
// рендера, доказано тремя независимыми замерами:
//   - фазы 1_scene/2_door/3_walk совпали с прежними эталонами БИТ-В-БИТ (git показывает
//     изменёнными ровно два PNG из пяти);
//   - coltab_frame_parity ПО ТИКАМ на A/B-паре «тот же код, старая раскладка / новая»:
//     4000 тиков, 399 контрольных точек по 24640 Б — расхождений НОЛЬ;
//   - заливка зоны переменных 0x00/0xAA/0x55 перед стартом даёт ОДИН И ТОТ ЖЕ кадр на
//     тиках 175 и 220 (то есть это не чтение неинициализированной ОЗУ).
// На картинках отличается ТОЛЬКО спрайт героя; счёт, HI, REST, текст CONGRATULATIONS/
// SPECIAL BONUS 10000 и весь фон — прежние.
//
// ПЕРЕСНЯТ ЭТАЛОН 1_scene (2026-08-07). ЗАКРЫТ «ИЗВЕСТНЫЙ ДОПУСК» В 2 ПИКСЕЛЯ, который
// таскался по отчётам с 4 августа (см. docs/BLITTER_UNIFICATION.md: «СВОЙ, не связанный
// с блиттером, промах в 2 пикселя фазы 1_scene»). Разбор:
//   - расходились ровно bmp-пиксели (526,187) и (527,187) — это ОДИН пиксель Вектора
//     (в 256-точечном режиме каждый удвоен по X): игровой X=247, строка картинки 171,
//     байтовый столбец 30, бит 0, цвет idx6 (#4060e0 в порядке слотов) — ТЕЛЕСНЫЙ;
//   - кадр НЕ порван лучом: посторонний прогон сверил все 65536 точек кадра с текущей
//     видеопамятью — расхождений ноль, то есть картинка честно показывает VRAM;
//   - двоичный поиск по 197 коммитам (0f94f30..2882f97, эталон 1_scene последний раз
//     снимался на 0f94f30) указал на b669a8c «Стойка героя с киркой: точка в слое кожи»;
//   - причинность доказана правкой в один байт: vec_spr_pico[0x23] 0x23 -> 0x03 (снять
//     ту самую точку) => все ПЯТЬ фаз совпадают с прежними эталонами. Обратно — 2 пикселя.
// На тике 10 герой стоит в дверях большой пирамиды со стойкой «с киркой», в зеркале, и
// добавленная точка ручки кирки попадает как раз в (247,171). То есть протух ЭТАЛОН, а
// рендер верен. РЕШЕНИЕ ВЛАДЕЛЬЦА 2026-08-07: точка добавлена им НАМЕРЕННО для целостности спрайта — НЕ «чинить к оригиналу». Сама точка отсутствует в оригинальном MSX-арте (поток
// GFX_ProtaPico лежит в legacy/msx/kvalley_z80.rom со смещения 0x13FD и распаковывается
// в 0x03) — если решение b669a8c когда-нибудь откатят, ЭТОТ эталон надо переснять назад.
//
// ПЕРЕСНЯТЫ ВСЕ ПЯТЬ ЭТАЛОНОВ (2026-08-10, ЗАДАЧА#56) — ДВЕ НАКОПИВШИЕСЯ ПРИЧИНЫ.
//   (1) ЧУЖАЯ, УЖЕ БЫВШАЯ ДО ЭТОЙ ПРАВКИ. На HEAD c5a6436 («1.0b: общий золотой слот,
//       shared-pool спрайтов, вход как концовка») гейт УЖЕ был красным: 1_scene 164 пикс,
//       2_door 148, 3_walk 148, 4_jump 262, 5_bonus совпадал. Замерено на самом c5a6436
//       ДО единой правки задачи#56 — то есть это не регрессия переноса табло. Расхождения
//       лежат на СПРАЙТЕ ГЕРОЯ (первые точки 512/458/346/342 по X при поле с 32) — ровно
//       там, где 1.0b пересобрал кадр героя из общего пула.
//   (2) СВОЯ. Табло уехало из поля в кайму, а картинка перецентрована (vec_vscroll
//       0x1F -> 0x27): весь кадр концовки сдвинут на 8 строк вниз, строка SCORE/HI/REST —
//       на 8 строк вверх от прежнего места. Расхождение выросло до 12710..16290 пикселей
//       из 165888 — это и есть сдвиг целиком, а не порча.
// ЧЕМ ДОКАЗАНО, ЧТО ЭТО СДВИГ, А НЕ ПОЛОМКА (перед пересъёмкой, глядя на картинки):
//   - гистограмма палитры по слотам во всех пяти фазах — та же, что была;
//   - coltab_frame_parity по игровым тикам (2600 тиков, 259 контрольных точек по 24640 Б)
//     на паре c5a6436 / эта сборка: расхождения ТОЛЬКО в клетках ряда 0 (старое место
//     табло, стало пусто) и ряда 30 (новое место), больше нигде ни байта;
//   - отдельная проба: строка ряда 0 старой сборки равна строке ряда 30 новой БАЙТ В БАЙТ
//     (356 ненулевых байт), ряд 0 новой сборки нулевой, ряд 30 старой — нулевой.
//
// ПЕРЕСНЯТЫ ВСЕ ПЯТЬ ЭТАЛОНОВ (2026-08-12, СИММЕТРИЯ КАДРА) — ПЕРЕКОМПОНОВКА, НЕ ПОЛОМКА.
// Табло поднялось на ряд (30 -> 29), нижняя строка UI вышла из поля в кайму (ряд 23 -> 26),
// картинка перецентрована (vec_vscroll 0x27 -> 0x1F). Расхождение со старыми эталонами
// 12710..16290 пикселей из 165888 — это перекомпоновка целиком.
// ЧЕМ ДОКАЗАНО (tools/verify/frame_shift_proof.js, прогон ДО пересъёмки): старый эталон и
// новый кадр сверены ПОБЛОЧНО со сдвигами, посчитанными из геометрии кадра, —
//   поле (fb 255..64) вверх на 8 строк, табло вверх на 16, нижняя строка UI ВНИЗ на 16, —
// и во ВСЕХ ПЯТИ фазах дали 0 расхождений на 119808 сверенных пикселей каждая, при нуле
// ненулевых пикселей вне трёх блоков. То есть ни один пиксель не изменился, изменилось
// только их место в кадре.
//
// ПЕРЕСНЯТЫ ВСЕ ПЯТЬ ЭТАЛОНОВ ЕЩЁ РАЗ (2026-08-12, РАУНД 2) — СНОВА ПЕРЕКОМПОНОВКА.
// Вердикт владельца с железа по варианту «зазоры 16/16»: HUD и нижняя строка разнесены,
// а под HUD мёртвая зона. Итог: табло вернулось в ряд 30 (fb 15..8), подпись поднялась в
// ряд 25 (fb 55..48), vec_vscroll не менялся (0x1F), поле осталось на месте.
// ЧЕМ ДОКАЗАНО (frame_shift_proof.js, прогон ДО пересъёмки): блоки со сдвигами из
// геометрии — поле 0 строк (не двигалось), табло на 8 строк ВНИЗ, подпись на 8 ВВЕРХ —
// дали 0 расхождений на 119808 пикселей в каждой из пяти фаз, при нуле ненулевых
// пикселей вне блоков.
//
// ПЕРЕСНЯТЫ ВСЕ ПЯТЬ ЭТАЛОНОВ (2026-08-12, РАУНД 3): подпись прижата к дну поля (ряд 25 ->
// 24) и отцентрирована по горизонтали, картинка перецентрована обратно на vec_vscroll
// 0x1F -> 0x27 (ради луча). ЧЕМ ДОКАЗАНО (frame_shift_proof.js ДО пересъёмки, блоки со
// сдвигами из геометрии r = vec_vscroll - lo): поле и табло уехали ВНИЗ ровно на 8 строк
// (скролл), больше в кадре концовки ничего нет — подпись там стёрта шторкой. 0 расхождений
// на 115200 пикселей в каждой из пяти фаз, вне блоков ноль ненулевых пикселей.
//   node tools/verify/frame_shift_proof.js tools/verify/ref/ending --block 56:247:-8 --block 40:47:-8
//
// КАК СВЕРЯЕТ. Доводит партию до геймплея пирамиды 1, НАЖИМАЕТ КЛАВИШУ E (чит «показать
// финал», см. vec_isr.asm) и снимает кадр в четырёх фазах постройки сцены. Каждый кадр
// сверяется с PNG-эталоном ПОБАЙТНО.
//
// ОТСТОЙ ПО ИГРОВЫМ ТИКАМ, А НЕ ПО КАДРАМ (как в screens_palette_check.js): всё в концовке
// — шторка, шаг героя, прыжок, счётчик текста — двигает игровой тик. Если сборка станет
// быстрее/медленнее и изменится число кадров на тик, отсчёт «через N кадров» поставил бы
// две сборки на РАЗНЫЕ тики и гейт краснел бы при полностью одинаковом рендере.
//
// Запуск:  node tools/verify/bonus_ending_gate.js [rom] [каталог эталонов] [--update]
//          --update перезаписывает эталоны (делать ТОЛЬКО осознанно, глядя на картинки)
// PNG текущего прогона всегда пишутся рядом с эталонами, в подкаталог out/.
"use strict";
const fs = require("fs"), vm = require("vm"), zlib = require("zlib"), path = require("path");
const base = "/Users/boris/Projects/vector06js";
const args = process.argv.slice(2).filter(a => a !== "--update");
const UPDATE = process.argv.includes("--update");
const rom = args[0] || "build/kvalley_8c.rom";
const refdir = args[1] || path.join(__dirname, "ref", "ending");
const outdir = path.join(refdir, "out");

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
// io.tape_player нужен: чтение порта 1 (ReadKeys_AC на пути chkPushAnyKey) лезет в
// tape_player.sample, и без него прогон падает исключением на выходе из концовки.
io.tape_player = tape;
const W=576, H=288;
v06c.bmp=new Uint32Array(W*H); v06c.displayFrame=()=>{}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
// ВНИМАНИЕ: soundnik.soundStep НЕ глушим — он тактует ВИ53, на нём часы музыки.
const img=new Uint8Array(fs.readFileSync(rom));
memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();

const symfile = rom.replace(/\.rom$/, ".sym");
const L={};
for(const l of fs.readFileSync(symfile,"latin1").split("\n")){
  const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/); if(m) L[m[1]]=parseInt(m[2],16); }
for(const n of ["GameStatus","subStatus","timer","flagPiramideMap","piramideActual",
                "vbt8_ecp","vbt8_ecj","vbt8_brick","vec_end_tile"])
  if(L[n]===undefined){ console.log(`❌ в ${symfile} нет символа ${n}`); process.exit(1); }
if(L.vec_hop===undefined){
  console.log(`ROM: ${rom}`);
  console.log("читов в сборке нет — проверять нечего (блок снят 050301b: нет vec_hop и клавиши E; штатный финал — после 15 пирамид; версия с читами: git revert 050301b && ./build.sh)");
  console.log("РЕЗУЛЬТАТ: SKIP");
  process.exit(0);
}
const rd=a=>memory.read(a&0xffff);
const run=n=>{for(let i=0;i<n;i++) v06c.oneInterrupt(true);};
const key=(code,down)=>{const e={keyCode:code,which:code,preventDefault(){},stopPropagation(){}};
  if(down) keyboard.keyDown(e); else keyboard.keyUp(e);};
const runTicks=n=>{ let last=rd(L.timer),c=0,guard=0;
  while(c<n && guard++<n*40){ run(1); const t=rd(L.timer); if(t!==last){last=t;c++;} } };

// ---- PNG: тот же кодек, что у screens_palette_check.js (8 бит, truecolor, фильтр 0) ----
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
function frameRGB(){ const bmp=v06c.bmp, rgb=Buffer.alloc(W*H*3);
  for(let i=0;i<W*H;i++){const c=bmp[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
  return rgb; }
function writePng(file, rgb){
  const raw=Buffer.alloc(H*(W*3+1));
  for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
  fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
}
// Читаем ТОЛЬКО свой формат (его и пишем): 8 бит, тип 2, без интерлейса, фильтр 0.
function readPng(file){
  const b=fs.readFileSync(file); let off=8; let w=0,h=0; const idat=[];
  while(off<b.length){
    const len=b.readUInt32BE(off), ty=b.toString("latin1",off+4,off+8);
    if(ty==="IHDR"){ w=b.readUInt32BE(off+8); h=b.readUInt32BE(off+12);
      if(b[off+16]!==8||b[off+17]!==2||b[off+20]!==0) throw new Error(`${file}: неожиданный формат PNG`); }
    else if(ty==="IDAT") idat.push(b.subarray(off+8,off+8+len));
    else if(ty==="IEND") break;
    off += 12+len;
  }
  const raw=zlib.inflateSync(Buffer.concat(idat));
  const rgb=Buffer.alloc(w*h*3);
  for(let y=0;y<h;y++){
    if(raw[y*(w*3+1)]!==0) throw new Error(`${file}: строка ${y} с фильтром != 0`);
    raw.copy(rgb, y*w*3, y*(w*3+1)+1, (y+1)*(w*3+1));
  }
  return {w,h,rgb};
}

// ---- сценарий ----
fs.mkdirSync(refdir,{recursive:true}); fs.mkdirSync(outdir,{recursive:true});
console.log(`ROM: ${rom}`);

// 1. довести партию до геймплея пирамиды 1 (тот же сценарий, что у screens_palette_check)
//  СТАРТ КОМБИНАЦИЕЙ F1+F3, А НЕ ПРОБЕЛОМ (замок читов): гейт открывает финал
//  читом E, а с обычного старта пробелом vec_cheats=0 и чит мёртв по замыслу.
//  Пробел здесь не нажимается ни разу — F1+F3 запускают партию сами.
let inGame=false;
key(112,true); key(114,true);
for(let blk=0; blk<60 && !inGame; blk++){
  for(let f=0; f<25; f++){ run(1);
    if(rd(L.GameStatus)===5 && (rd(L.flagPiramideMap)&1)){ inGame=true; break; } }
}
key(112,false); key(114,false); run(4);
if(!inGame){ console.log("❌ GATE FAIL: не удалось дойти до геймплея (сценарий кнопки старта сломан)"); process.exit(1); }
runTicks(40);
console.log(`геймплей: GS=${rd(L.GameStatus)} пирамида=${rd(L.piramideActual)}`);

// 2. ЧИТ: клавиша E -> финальный экран. Заодно это проверка самого чита.
key(69,true); run(6); key(69,false); run(4);
if(rd(L.GameStatus)!==0x0A){
  console.log(`❌ GATE FAIL: после нажатия E GameStatus=${rd(L.GameStatus)}, ожидался 10 (FinalJuego).`);
  console.log("   Чит «показать финал» не сработал — см. vec_isr.asm (vec_kbe) и vec_scan_keys (ряд 4).");
  process.exit(1);
}
if(rd(L.subStatus)!==0){
  console.log(`❌ GATE FAIL: subStatus=${rd(L.subStatus)}, ожидался 0.`);
  console.log("   С ненулевого подстатуса >=6 сцена перестраивается вечно, концовка не проигрывается.");
  process.exit(1);
}
console.log("чит E: GameStatus=10 (FinalJuego), subStatus=0 — ок");
// ПАТЧ БЛИТТЕРА. Тайлы 0x40-0x47 в концовке — грани пирамид/пол/звёзды, а в лабиринте те
// же номера = кирпич. vec_ct_ending расширяет диапазон 5 -> 8 и уводит его на свой
// обработчик (см. vbt8_ecp/vbt8_ecj в vec_blit.asm). Без патча вся сцена красится как
// кирпичная кладка, а после концовки — наоборот, лабиринт песчаником; и то и другое видно
// только глазами, поэтому проверяем байтами (ставится в setupEnding, снимается vec_ct_load).
const patch=()=>[rd(L.vbt8_ecp+1), rd(L.vbt8_ecj+1)|(rd(L.vbt8_ecj+2)<<8)];

// 3. фазы постройки сцены. Отсчёт — В ИГРОВЫХ ТИКАХ от момента входа в концовку.
const phases = [
  ["1_scene",   10, "сцена построена: полупирамиды, дверь, звёзды, пол, табло"],
  ["2_door",    45, "герой вышел из двери большой пирамиды"],
  ["3_walk",   120, "герой идёт влево по песку"],
  ["4_jump",   175, "прыжок в центре экрана"],
  ["5_bonus",  220, "CONGRATULATIONS + SPECIAL BONUS 10000 (+10000 очков и жизнь)"],
];
const hex=c=>((c>>>0)&0xFFFFFF).toString(16).padStart(6,"0");
function planeStats(){ // диагностика: гистограмма индексов палитры по видимым планам
  const cnt=new Array(16).fill(0);
  for(let i=0;i<8192;i++){ const b0=rd(0x8000+i), b1=rd(0xA000+i), b2=rd(0xC000+i);
    for(let b=7;b>=0;b--) cnt[(((b0>>b)&1)<<3)|(((b1>>b)&1)<<2)|(((b2>>b)&1)<<1)]++; }
  return cnt;
}
let done=0, fails=[];
for(const [name,upto,what] of phases){
  runTicks(upto-done); done=upto;
  const rgb=frameRGB();
  const cnt=planeStats();
  const pal=[0,2,4,6,8,10,12,14].map(k=>hex(io.Palette[k])).join(" ");
  const hst=[0,2,4,6,8,10,12,14].map(k=>String(cnt[k]).padStart(6)).join(" ");
  console.log(`--- фаза ${name} (тик ${upto}): ${what}`);
  console.log(`    GS=${rd(L.GameStatus)} sub=${rd(L.subStatus)}`);
  console.log(`    палитра idx 0,2,4,6,8,10,12,14: ${pal}`);
  console.log(`    пикселей на слот              : ${hst}`);
  if(name==="1_scene"){ const [n,h]=patch();
    if(n!==0x28 || h!==L.vec_end_tile){
      console.log(`    ❌ патч тайлов концовки не встал: диапазон ${n} (ждали 0x28), обработчик 0x${h.toString(16)} (ждали 0x${L.vec_end_tile.toString(16)} = vec_end_tile)`);
      console.log("       см. вызов vec_ct_ending в setupEnding (src/game/kvalley_game.asm)");
      fails.push("патч-вход"); }
    else console.log("    патч тайлов 0x40-0x67 -> vec_end_tile — ок"); }
  const refFile = path.join(refdir, `${name}.png`);
  const outFile = path.join(outdir, `${name}.png`);
  writePng(outFile, rgb);
  if(UPDATE){ writePng(refFile, rgb); console.log(`    эталон перезаписан: ${refFile}`); continue; }
  if(!fs.existsSync(refFile)){
    console.log(`    ❌ эталона нет: ${refFile} (создать: --update)`); fails.push(name); continue; }
  const ref = readPng(refFile);
  if(ref.w!==W || ref.h!==H){ console.log(`    ❌ эталон ${ref.w}x${ref.h}, кадр ${W}x${H}`); fails.push(name); continue; }
  let diff=0, firstX=-1, firstY=-1;
  for(let i=0;i<W*H;i++){
    if(rgb[i*3]!==ref.rgb[i*3] || rgb[i*3+1]!==ref.rgb[i*3+1] || rgb[i*3+2]!==ref.rgb[i*3+2]){
      if(diff===0){ firstX=i%W; firstY=(i/W)|0; } diff++; }
  }
  if(diff===0) console.log(`    ✅ кадр совпал с эталоном (${refFile})`);
  else { console.log(`    ❌ расхождение с эталоном: ${diff} пикселей из ${W*H}, первый (${firstX},${firstY})`);
         console.log(`       текущий кадр: ${outFile}`); fails.push(name); }
}
if(UPDATE){ console.log("\nЭТАЛОНЫ ОБНОВЛЕНЫ — посмотрите картинки глазами перед коммитом."); process.exit(0); }

// 4. концовка обязана ДОИГРАТЬСЯ и вернуть игру в Stage Clear (иначе экран — тупик)
let left=false, endGS=0;
for(let t=0;t<400 && !left;t++){ runTicks(1); if(rd(L.GameStatus)!==0x0A){ left=true; endGS=rd(L.GameStatus);
  console.log(`концовка доиграна на тике ${done+t+1}: GameStatus -> ${endGS} (8 = Stage Clear)`); } }
if(!left){ console.log("❌ концовка не завершилась за 620 тиков (зависла в GS=10)"); fails.push("выход"); }
else if(endGS!==8){ console.log(`❌ концовка ушла в GameStatus=${endGS}, ожидался 8 (Stage Clear)`); fails.push("выход"); }
// и партия обязана продолжиться (Stage Clear -> подготовка -> карта/игра)
runTicks(60);
if(rd(L.GameStatus)===8){ console.log("❌ игра застряла в Stage Clear после концовки"); fails.push("после"); }
else console.log(`после концовки игра живёт: GS=${rd(L.GameStatus)} sub=${rd(L.subStatus)}`);
// 5. ПАТЧ СНЯТ. Если он переживёт концовку, кирпичи лабиринта пойдут по ветке финала и
// следующая пирамида выйдет в цветах песчаника. Снятие делает vec_ct_load — любая
// загрузка профиля, то есть и вход в этап, и вход в титул.
{ const [n,h]=patch();
  if(n!==5 || h!==L.vbt8_brick){
    console.log(`❌ патч концовки НЕ СНЯТ: диапазон ${n} (ждали 5), обработчик 0x${h.toString(16)} (ждали 0x${L.vbt8_brick.toString(16)} = vbt8_brick)`);
    fails.push("патч"); }
  else console.log("патч тайлов концовки снят возвратом в этап — ок"); }

console.log(fails.length===0
  ? "\n✅ GATE PASS: чит E открывает финальный экран, все фазы совпали с эталонами, концовка доигрывается и возвращает игру в Stage Clear"
  : `\n❌ GATE FAIL: ${fails.join(", ")}`);
process.exit(fails.length===0 ? 0 : 1);
