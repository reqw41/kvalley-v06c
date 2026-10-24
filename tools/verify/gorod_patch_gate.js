// ГЕЙТ пропатченного ROM Городецкого (клавиша L = центрирование картинки).
// Проверки:
//   1) патч встал: после распаковки в 0x000B лежит хук, в 0x01FF стоит `call 0x000B`;
//   2) игра идёт: за N кадров в фреймбуфер идут записи (иначе — провал покрытия);
//   3) БЕЗ нажатий поведение БАЙТ-В-БАЙТ с оригиналом: сверяем весь фреймбуфер
//      (0x8000..0xFFFF) и ОЗУ 0x0100..0x7FFF на контрольных кадрах; из сверки исключены
//      РОВНО четыре байта самого патча — 0x01FF..0x0201 (call) и 0x020B (значение скролла);
//   4) нажатие L переключает scroll 0x2F <-> 0x0F по ФРОНТУ, картинка едет ровно на 32
//      строки, удержание не дребезжит, отпускание не переключает;
//   5) цена хука в vcycles Вектора — замер на НАСТОЯЩЕМ кадре (перехват cpu.instruction
//      внутри v06c.oneInterrupt; ручная инъекция IRQ соврала бы: вне окна CW=0x8A порт 2
//      отдаёт защёлку PB, а не клавиатуру).
"use strict";
const {make} = require("./gorod_z80_harness.js");
const DIR = "/private/tmp/claude-501/-Users-boris/aaf13fdb-2d99-428a-803a-66608497546b/scratchpad/gorod/";
const ORIG = process.argv[2] || DIR+"kvalley.rom";
const PATCHED = process.argv[3] || DIR+"kvalley_Lcenter.rom";
const WARM = +(process.argv[4]||1200);
const KEY_L = 76;                       // vector06js keymap: 76 -> [ряд 5, бит 0x10] = L
const PATCH_BYTES = new Set([0x01ff,0x0200,0x0201,0x020b]);
let checks=0, fails=0;
const ok  = m=>{ checks++; console.log("  ok    "+m); };
const bad = m=>{ checks++; fails++; console.log("  ПРОВАЛ "+m); };

// ---------- 1. патч встал ----------
console.log("=== 1. установка патча (после распаковки) ===");
// распаковка чужого ROM занимает ~75 кадров стенда — раньше проверять нечего
const P = make(PATCHED); P.run(150);
const HOOK = [0x32,0xa5,0x10,0x3e,0xdf,0xd3,0x03,0xdb,0x02,0xe6,0x10,0x21,0x27,0x00,
              0xbe,0x77,0xc8,0xb7,0xc0,0x3a,0x0b,0x02,0xee,0x20,0x32,0x0b,0x02,0xc9,0x10];
const got = [...Array(HOOK.length)].map((_,i)=>P.rd(0x000b+i));
got.join()===HOOK.join() ? ok(`хук 0x000B..0x${(0x000b+HOOK.length-1).toString(16)} совпал побайтно (${HOOK.length} Б)`)
                         : bad("хук в 0x000B не совпал: "+got.map(b=>b.toString(16)).join(" "));
[P.rd(0x1ff),P.rd(0x200),P.rd(0x201)].join()===[0xcd,0x0b,0x00].join()
  ? ok("в ISR 0x01FF стоит call 0x000B") : bad("в 0x01FF не call 0x000B");
P.rd(0x20b)===0x2f ? ok("скролл при старте 0x2F (как в оригинале)") : bad(`скролл при старте 0x${P.rd(0x20b).toString(16)}`);

// ---------- 2/3. паритет без нажатий ----------
// ВАЖНО: сверять патч с ГОЛЫМ оригиналом бессмысленно — игра Городецкого не ждёт кадр в
// halt, а считает в главном цикле, и её «случайность» (демо, пауки) зависит от того,
// сколько тактов отъела ISR. Доказано опытом в gorod_patch_timing.js: если ОРИГИНАЛУ просто
// дописать 108 vcycles на инструкции 0x01FF, ничего больше не трогая, он расходится сам с
// собой уже на 109-м кадре. Поэтому честный эталон здесь — ОРИГИНАЛ + РОВНО ТА ЖЕ ЗАДЕРЖКА:
// если патч совпал с ним байт-в-байт, у хука нет никаких побочных действий кроме тактов.
console.log("=== 2/3. без нажатий: игра идёт и не делает ничего сверх своей цены в тактах ===");
const HOOK_VCYC = 108;
function delayed(rom,d){
  const E = make(rom);
  const orig = E.cpu.instruction.bind(E.cpu);
  E.cpu.instruction = function(){ const pc=this.pc; const c=orig(); if(pc===0x01ff){ this.vcycles=c+d; return c+d; } return c; };
  return E;
}
const O = delayed(ORIG, HOOK_VCYC), Q = make(PATCHED);
let fbwO=0, fbwQ=0;
O.trace.onWrite = a=>{ if(a>=0x8000) fbwO++; };
Q.trace.onWrite = a=>{ if(a>=0x8000) fbwQ++; };
const SKIPB = new Set([...PATCH_BYTES, 0x00fe, 0x00ff]);
for(let a=0x000b;a<=0x0027;a++) SKIPB.add(a);
let diffs=[], cmpCount=0, cmpSteady=0;
const SETTLE = 120;      // распаковка+инициализация чужого ROM укладывается в ~100 кадров
for(let f=0; f<WARM; f++){
  O.v06c.oneInterrupt(true); Q.v06c.oneInterrupt(true);
  if (f%25===24 || f===WARM-1){
    cmpCount++;
    if (f<SETTLE) continue;         // на распаковке оба «в пути», сверять нечего
    cmpSteady++;
    let n=0;
    for(let a=0x0100;a<=0xffff;a++){
      if (SKIPB.has(a)) continue;
      if (O.rd(a)!==Q.rd(a)){ if(n<3) diffs.push(`кадр ${f} адрес 0x${a.toString(16)} эталон ${O.rd(a)} патч ${Q.rd(a)}`); n++; }
    }
  }
}
fbwO>0 && fbwQ>0 ? ok(`записей в fb: эталон ${fbwO}, патч ${fbwQ}`) : bad("нет записей в фреймбуфер (провал покрытия)");
cmpSteady>0 ? ok(`сверок памяти на установившемся режиме: ${cmpSteady} (из ${cmpCount})`)
            : bad("ПРОВАЛ ПОКРЫТИЯ: ни одной сверки после установления");
diffs.length===0 ? ok(`ОЗУ 0x0100..0xFFFF байт-в-байт с «оригинал+${HOOK_VCYC} vcycles» за кадры ${SETTLE}..${WARM}`)
                 : bad("расхождения: "+diffs.join("; "));
Q.io.ScrollStart()===0x2f ? ok("scroll остался 0x2F (низ)") : bad(`scroll 0x${Q.io.ScrollStart().toString(16)}`);
Q.png(DIR+"L_before.png"); console.log("  снимок ДО: "+DIR+"L_before.png");

// ---------- 4. клавиша L ----------
console.log("=== 4. клавиша L: фронт, переключение, отсутствие дребезга ===");
const tap = E => { E.key(KEY_L,true);  for(let i=0;i<4;i++) E.v06c.oneInterrupt(true);
                   E.key(KEY_L,false); for(let i=0;i<4;i++) E.v06c.oneInterrupt(true); };
tap(Q); Q.io.ScrollStart()===0x0f ? ok("1-е нажатие -> scroll 0x0F (центр)") : bad(`1-е нажатие -> 0x${Q.io.ScrollStart().toString(16)}`);
Q.png(DIR+"L_after.png"); console.log("  снимок ПОСЛЕ: "+DIR+"L_after.png");
tap(Q); Q.io.ScrollStart()===0x2f ? ok("2-е нажатие -> scroll 0x2F (низ)") : bad(`2-е нажатие -> 0x${Q.io.ScrollStart().toString(16)}`);
tap(Q); Q.io.ScrollStart()===0x0f ? ok("3-е нажатие -> снова центр") : bad("3-е нажатие не сработало");
Q.key(KEY_L,true); for(let i=0;i<40;i++) Q.v06c.oneInterrupt(true);
Q.io.ScrollStart()===0x2f ? ok("удержание 40 кадров: сработал РОВНО один фронт (0x2F)") : bad(`удержание дало 0x${Q.io.ScrollStart().toString(16)}`);
Q.key(KEY_L,false); for(let i=0;i<10;i++) Q.v06c.oneInterrupt(true);
Q.io.ScrollStart()===0x2f ? ok("отпускание не переключает") : bad("отпускание переключает");

// ---------- 4б. геометрия ----------
console.log("=== 4б. сдвиг картинки ровно на 32 строки ===");
const A = make(PATCHED), B = make(PATCHED);
A.run(WARM); B.run(WARM);
B.key(KEY_L,true); for(let i=0;i<3;i++) B.v06c.oneInterrupt(true); B.key(KEY_L,false);
A.v06c.oneInterrupt(true); B.v06c.oneInterrupt(true);
const rowsOf = E => { const {W,H}=E, bmp=E.v06c.bmp, bd=bmp[0]>>>0, r=[];
  for(let y=0;y<H;y++){ let n=0; for(let x=0;x<W;x++) if((bmp[y*W+x]>>>0)!==bd) n++; if(n) r.push(y); } return r; };
const ra=rowsOf(A), rb=rowsOf(B);
if (ra.length && rb.length){
  console.log(`  строки bmp с содержимым: НИЗ ${ra[0]}..${ra[ra.length-1]}, ЦЕНТР ${rb[0]}..${rb[rb.length-1]}`);
  console.log(`  они же экранные строки (bmp-16): НИЗ ${ra[0]-16}..${ra[ra.length-1]-16}, ЦЕНТР ${rb[0]-16}..${rb[rb.length-1]-16}`);
  (ra[0]-rb[0]===32 && ra[ra.length-1]-rb[rb.length-1]===32)
    ? ok("картинка целиком поднялась ровно на 32 строки")
    : bad(`подъём верх ${ra[0]-rb[0]}, низ ${ra[ra.length-1]-rb[rb.length-1]} (ждали 32/32)`);
  (rb[rb.length-1]-16===223) ? ok("низ картинки в центре = экранная строка 223 (поле 32..223 из 256)")
                             : bad(`низ картинки = строка ${rb[rb.length-1]-16}`);
} else bad("пустой кадр при замере геометрии");

// ---------- 5. цена хука ----------
console.log("=== 5. цена хука на настоящем кадре ===");
function headCost(rom){
  const E = make(rom); E.run(WARM);
  let arm=false, acc=0, raw=0, res=null;
  const orig = E.cpu.instruction.bind(E.cpu);
  E.cpu.instruction = function(){
    const pc=this.pc;
    if (pc===0x01df){ arm=true; acc=0; raw=0; }
    const c = orig();
    if (arm){ acc+=c; raw+=this.rawT; if(this.pc===0x0212){ arm=false; if(res===null) res=[acc,raw]; } }
    return c;
  };
  for(let f=0; f<5 && res===null; f++) E.v06c.oneInterrupt(true);
  return res;
}
const cO=headCost(ORIG), cQ=headCost(PATCHED);
if (cO && cQ){
  console.log(`  голова ISR 0x01DF..0x0212, vcycles Вектора: оригинал ${cO[0]}, патч ${cQ[0]}, дельта ${cQ[0]-cO[0]}`);
  console.log(`  она же в чистых T-тактах Z80:        оригинал ${cO[1]}, патч ${cQ[1]}, дельта ${cQ[1]-cO[1]}`);
  console.log(`  доля кадра (59904 vcycles): ${(100*(cQ[0]-cO[0])/59904).toFixed(3)}%; это 0.56 растровой строки, и вся она в верхнем бордюре`);
  (cQ[1]-cO[1])<100 ? ok(`надбавка ${cQ[1]-cO[1]} T-тактов/кадр (требование <100 выполнено)`) : bad(`надбавка ${cQ[1]-cO[1]} T-тактов/кадр`);
  (cQ[0]-cO[0])<=120 ? ok(`надбавка ${cQ[0]-cO[0]} vcycles/кадр (с ожиданиями адаптера)`) : bad(`надбавка ${cQ[0]-cO[0]} vcycles/кадр — дороже допуска 120`);
} else bad("не удалось замерить цену ISR");

console.log(`=== ИТОГ: проверок ${checks}, провалов ${fails} ===`);
if (checks===0){ console.log("ПРОВАЛ ПОКРЫТИЯ: гейт не сделал ни одной проверки"); process.exit(1); }
process.exit(fails?1:0);
