// cheat_god_death.js — отладочные читы G («God mode»), D («умереть сейчас») и ЗАМОК ЧИТОВ.
//
// ЗАМОК (2026-08-11). Все пять читов (N, H, E, G, D) работают ТОЛЬКО если партия запущена
// с титула комбинацией F1+F3. Обычный старт пробелом оставляет vec_cheats = 0, и весь
// блок читов в vec_isr пропускается одним переходом. F1+F3 запускают партию САМИ:
// vec_f15_scan (только при GameStatus=1) дописывает в образ ряда 8 бит SPACE, поэтому
// старт идёт ТЕМ ЖЕ путём chkPushAnyKey -> StartGame_0, а тот защёлкивает флаг.
//
// ГДЕ ЛЕЖАТ КЛАВИШИ. G/E/D — ряд 4 Вектора (G F E D C B A @): биты 0x80/0x20/0x10, скан
// снимает их одним `in`. F1/F3 — ряд 1 (F5 F4 F3 F2 F1 AP2 ПС ^\): биты 0x08 и 0x20.
// Гейт бессмертия стоит в momiaMataProta (kvalley_game.asm) — ЕДИНСТВЕННОЙ точке гибели
// героя, в которую сведены оба смертельных события (касание мумии и стена-ловушка).
// Вход vkp_kill — тело гибели МИМО гейта, им пользуется клавиша D.
//
// ЧТО ПРОВЕРЯЕТ. ДВЕ СЕССИИ эмулятора, каждая со своим стартом.
// Если в образе нет vec_hop (блок снят 050301b), гейт НЕ зеленеет на пустой выборке:
// он явно SKIP'ается. Проверять G/D без клавиш нечего; версия с читами — git revert.
//
//  СЕССИЯ «ПРОБЕЛ» (негативный контроль на РЕАЛЬНОМ ВВОДЕ, а не на вырезанном коде):
//    0. vec_cheats = 0 после старта;
//    1. G не включает бессмертие, D не убивает, N не меняет пирамиду, E не открывает
//       финал — то есть все четыре чита мертвы;
//    2. контакт с мумией при этом УБИВАЕТ (значит стенд исправен и умеет видеть смерть).
//  СЕССИЯ «F1+F3»:
//    3. vec_cheats = 1, партия стартовала (GameStatus дошёл до 5) БЕЗ нажатия пробела;
//    4. контроль: God выключен -> контакт убивает;
//    5. God включён клавишей G -> тот же контакт НЕ убивает;
//    6. клавиша D убивает ИЗ ВКЛЮЧЁННОГО God mode (иначе из режима нет выхода);
//    7. повторное G выключает режим -> контакт снова убивает.
//
// ПОЧЕМУ КОНТАКТ ПОДСТРАИВАЕТСЯ. Ждать, пока мумия сама догонит героя, — десятки тысяч
// кадров. Герой каждый кадр телепортируется в координаты живой мумии (комната/X/Y из
// momiaDat); логика игры не подменяется ни на байт, срабатывает штатная chkTocaMomia.
//
// СТРОГОСТЬ. Касание ловится НЕ по «герой умер» (это порочный круг), а ловушкой на PC:
// заход в momiaMataProta = касание состоялось, заход в vkp_kill = смерть исполнена.
// У каждой фазы свой минимум касаний; ноль касаний — ПРОВАЛ, а не успех.
//
// Запуск: node tools/verify/cheat_god_death.js [rom] [sym]
"use strict";
const fs = require("fs"), vm = require("vm");
const base = "/Users/boris/Projects/vector06js";

let rom = null, symArg = null;
for (const a of process.argv.slice(2)) {
  if (/\.sym$/i.test(a)) { symArg = a; continue; }
  if (/\.rom$/i.test(a) && rom === null) { rom = a; continue; }
  console.error(`не понял аргумент «${a}»: ожидались путь к .rom и путь к .sym`);
  process.exit(2);
}
rom = rom || "build/kvalley_8c.rom";
const symPath = symArg || rom.replace(/\.rom$/, ".sym");

// --- символы (общие для обеих сессий) ---------------------------------------------------
const L = {};
for (const l of fs.readFileSync(symPath, "latin1").split("\n")) {
  const m = l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);
  if (m) L[m[1]] = parseInt(m[2], 16);
}
if (L.vec_hop === undefined) {
  console.log(`ROM=${rom}`);
  console.log("читов в сборке нет — проверять нечего (нет vec_hop и клавиш N/H/E/G/D)");
  console.log("РЕЗУЛЬТАТ: SKIP");
  process.exit(0);
}
const need = ["momiaMataProta","vkp_kill","flagVivo","ProtaX","ProtaY","ProtaRoom",
              "protaStatus","momiaDat","numMomias","Vidas","GameStatus","vec_god",
              "vec_cheats","vec_kbf15","piramideActual","ACTOR_Y","ACTOR_X","ACTOR_ROOM"];
const miss = need.filter(n => L[n] === undefined);
if (miss.length) { console.error("в .sym нет меток: " + miss.join(", ")); process.exit(2); }

const KEY_SPACE = 32, KEY_G = 71, KEY_D = 68, KEY_E = 69, KEY_N = 78, KEY_F1 = 112, KEY_F3 = 114;
const MOMIA_STEP = 22;   // шаг записи мумии в momiaDat (см. chkTocaMomia4)

// --- сессия эмулятора -------------------------------------------------------------------
function session() {
  const g = {}; g.window = g;
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  g.document={createElement:()=>fc(),getElementById:()=>fc(),all:undefined};
  g.requestAnimationFrame=()=>0; g.setTimeout=()=>0; g.print=()=>0;
  g.console={log(){},debug(){},warn(){},error(){},info(){}};
  const ctx = vm.createContext(g);
  for (const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"])
    vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"), ctx, {filename:f});
  const memory=new ctx.Memory(), keyboard=new ctx.Keyboard(), timer=new ctx.I8253(), ay=new ctx.AY();
  const floppy=new(ctx.Floppy().FD1793)(), io=new ctx.IO(keyboard,timer,memory,ay,floppy);
  const cpu=new ctx.I8080(memory,io), tape={advance:()=>{},sample:0,reset:()=>{}};
  const v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
  v06c.bmp=new Uint32Array(576*288); v06c.displayFrame=()=>{}; v06c.dbg=null;
  // soundnik.soundStep НЕ глушим: он тактует ВИ53, на нём часы музыки.
  const img=new Uint8Array(fs.readFileSync(rom));
  memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
  cpu.pc=0x100; cpu.sp=0xc300; cpu.iff=false;
  timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();

  const S = {
    touches: 0, kills: 0,
    rd: a => memory.read(a & 0xffff),
    wr: (a,v) => memory.write(a & 0xffff, v & 0xff, false),
    key: (code, down) => { const e={keyCode:code,which:code,preventDefault(){},stopPropagation(){}};
      if (down) keyboard.keyDown(e); else keyboard.keyUp(e); },
    run: n => { for (let i=0;i<n;i++) v06c.oneInterrupt(true); },
  };
  v06c.check_breakpoint = function () {
    if (cpu.pc === L.momiaMataProta) S.touches++;
    else if (cpu.pc === L.vkp_kill) S.kills++;
    return false;
  };
  S.press = (code, hold=6) => { S.key(code,1); S.run(hold); S.key(code,0); S.run(6); };
  S.pickMomia = () => {
    const n = S.rd(L.numMomias);
    for (let i=0;i<n && i<4;i++) {
      const rec = L.momiaDat + i*MOMIA_STEP;
      const st = S.rd(rec);
      if (st === 0 || st === 3) continue;   // 0 = нет, 3 = на лестнице (касание не считается)
      return rec;
    }
    return null;
  };
  S.glue = rec => {
    S.wr(L.ProtaRoom, S.rd(rec + L.ACTOR_ROOM));
    S.wr(L.ProtaX,    S.rd(rec + L.ACTOR_X));
    S.wr(L.ProtaY,    S.rd(rec + L.ACTOR_Y));
    if (S.rd(L.protaStatus) === 3) S.wr(L.protaStatus, 0);
  };
  // Фаза «герой приклеен к мумии»: считаем касания и смерти.
  S.phase = (name, frames, opts={}) => {
    S.touches = 0; S.kills = 0;
    let glued = 0, noMomia = 0;
    for (let f=0; f<frames; f++) {
      if (S.rd(L.GameStatus) === 5) { const rec = S.pickMomia();
        if (rec) { S.glue(rec); glued++; } else noMomia++; }
      S.run(1);
      if (opts.stopOnDeath && S.rd(L.flagVivo) === 0) break;
    }
    return { name, touches: S.touches, kills: S.kills, glued, noMomia, alive: S.rd(L.flagVivo) };
  };
  S.revive = tag => {
    for (let i=0;i<900 && !(S.rd(L.GameStatus)===5 && S.rd(L.flagVivo)===1); i++) { S.press(KEY_SPACE,2); S.run(8); }
    S.wr(L.Vidas, 9);
    if (!(S.rd(L.GameStatus)===5 && S.rd(L.flagVivo)===1)) {
      console.error(`не вернулись в геймплей после «${tag}» (GS=${S.rd(L.GameStatus)}, flagVivo=${S.rd(L.flagVivo)})`);
      process.exit(1);
    }
  };
  return S;
}

let fail = 0;
const chk = (ok, msg) => { if (!ok) { console.log("   ОШИБКА: " + msg); fail++; } };
console.log(`ROM=${rom}`);

// =========================== СЕССИЯ 1: СТАРТ ПРОБЕЛОМ ===================================
// Негативный контроль на РЕАЛЬНОМ ВВОДЕ: код читов на месте, но замок закрыт.
const A = session();
A.run(300);
for (let i=0;i<40 && A.rd(L.GameStatus)!==5;i++) { A.press(KEY_SPACE,4); A.run(60); }
if (A.rd(L.GameStatus) !== 5) { console.error("старт пробелом не довёл до геймплея"); process.exit(1); }
A.wr(L.Vidas, 9);
const cheatsSpace = A.rd(L.vec_cheats);
console.log(`\nСЕССИЯ «ПРОБЕЛ»: vec_cheats = ${cheatsSpace} (ожидалось 0)`);

// G не должен включаться
A.press(KEY_G); const godAfterG_space = A.rd(L.vec_god);
// D не должен убивать
const pyrBefore = A.rd(L.piramideActual);
const aliveBeforeD_space = A.rd(L.flagVivo);
A.press(KEY_D); A.run(6);
const aliveAfterD_space = A.rd(L.flagVivo);
// N не должен менять пирамиду
A.press(KEY_N); A.run(120);
const pyrAfterN_space = A.rd(L.piramideActual);
// E не должен открывать финал
A.press(KEY_E); A.run(30);
const gsAfterE_space = A.rd(L.GameStatus);
// а мумия — обязана убивать (контроль исправности стенда)
const spaceKill = A.phase("контроль стенда: контакт при старте пробелом", 400, {stopOnDeath:true});
console.log(`  G: vec_god ${godAfterG_space} | D: flagVivo ${aliveBeforeD_space} -> ${aliveAfterD_space}` +
            ` | N: пирамида ${pyrBefore} -> ${pyrAfterN_space} | E: GameStatus ${gsAfterE_space}`);
console.log(`  ${spaceKill.name}: касаний ${spaceKill.touches}, смертей ${spaceKill.kills}, flagVivo ${spaceKill.alive}`);

chk(cheatsSpace === 0, `старт пробелом обязан оставить замок закрытым (vec_cheats=${cheatsSpace}, ожидалось 0)`);
chk(godAfterG_space === 0, `клавиша G сработала при закрытом замке (vec_god=${godAfterG_space})`);
chk(aliveBeforeD_space === 1 && aliveAfterD_space === 1, `клавиша D убила героя при закрытом замке (flagVivo ${aliveBeforeD_space} -> ${aliveAfterD_space})`);
chk(pyrAfterN_space === pyrBefore, `клавиша N сменила пирамиду при закрытом замке (${pyrBefore} -> ${pyrAfterN_space})`);
chk(gsAfterE_space !== 10, `клавиша E открыла финал при закрытом замке (GameStatus=${gsAfterE_space})`);
chk(spaceKill.touches >= 1, "контроль стенда: ни одного касания мумии — выборка пуста, проверять нечем");
chk(spaceKill.kills > 0 && spaceKill.alive === 0, "контроль стенда: контакт с мумией обязан убивать (иначе гейт не видит смерти)");

// =========================== СЕССИЯ 2: СТАРТ F1+F3 ======================================
// F1+F3 запускают партию САМИ: пробел здесь НЕ нажимается ни разу.
const B = session();
B.run(300);
B.key(KEY_F1,1); B.key(KEY_F3,1);
for (let i=0;i<60 && B.rd(L.GameStatus)!==5;i++) B.run(30);
const f15seen = B.rd(L.vec_kbf15);
B.key(KEY_F1,0); B.key(KEY_F3,0); B.run(10);
console.log(`\nСЕССИЯ «F1+F3»: GameStatus ${B.rd(L.GameStatus)}, vec_kbf15 = 0x${f15seen.toString(16)}, vec_cheats = ${B.rd(L.vec_cheats)}`);
chk(B.rd(L.GameStatus) === 5, `комбинация F1+F3 не запустила партию (GameStatus=${B.rd(L.GameStatus)}), пробел при этом не нажимался`);
chk(f15seen === 0x28, `скан не увидел обе клавиши ряда 1 (vec_kbf15=0x${f15seen.toString(16)}, ожидалось 0x28)`);
const cheatsF15 = B.rd(L.vec_cheats);
chk(cheatsF15 === 1, `старт F1+F3 обязан открыть замок (vec_cheats=${cheatsF15}, ожидалось 1)`);
B.wr(L.Vidas, 9);

const R = [];
if (B.rd(L.vec_god) !== 0) { console.error("на старте vec_god != 0"); process.exit(1); }
R.push(B.phase("1. контроль (God выкл): контакт с мумией", 400, {stopOnDeath:true}));
B.revive("контроль");

B.press(KEY_G);
const godOn = B.rd(L.vec_god);
R.push(B.phase("2. God ВКЛ (нажали G): тот же контакт", 400));

const aliveBeforeD = B.rd(L.flagVivo), godBeforeD = B.rd(L.vec_god);
B.press(KEY_D); B.run(4);
const aliveAfterD = B.rd(L.flagVivo);
B.revive("смерть по D");
const godAfterRevive = B.rd(L.vec_god);

B.press(KEY_G);
const godOff = B.rd(L.vec_god);
R.push(B.phase("4. God ВЫКЛ (G повторно): контакт", 400, {stopOnDeath:true}));

for (const r of R)
  console.log(`  ${r.name}: касаний ${r.touches}, смертей ${r.kills}, кадров «приклеен» ${r.glued}` +
              `${r.noMomia?`, без живой мумии ${r.noMomia}`:""}, flagVivo на выходе ${r.alive}`);
console.log(`  3. клавиша D: God до нажатия ${godBeforeD}, flagVivo ${aliveBeforeD} -> ${aliveAfterD}`);
console.log(`  vec_god: после 1-го G = ${godOn}, после воскрешения = ${godAfterRevive}, после 2-го G = ${godOff}`);

for (const r of R) chk(r.touches >= 1,
  `фаза «${r.name}» не набрала ни одного касания мумии — выборка пуста, гейт ничего не проверил`);
chk(R[0].kills > 0 && R[0].alive === 0,
  "КОНТРОЛЬ: без God mode контакт с мумией обязан убивать (гейт не видит смерти — проверять бессмертие нечем)");
chk(godOn === 1, `клавиша G не включила режим (vec_god=${godOn})`);
chk(R[1].kills === 0 && R[1].alive === 1,
  `God mode: контакт УБИЛ героя (смертей ${R[1].kills}, flagVivo ${R[1].alive})`);
chk(aliveBeforeD === 1 && aliveAfterD === 0,
  `клавиша D не убила героя из чистого состояния (flagVivo ${aliveBeforeD} -> ${aliveAfterD})`);
chk(godBeforeD === 1, "фаза D должна идти при ВКЛЮЧЁННОМ God mode — иначе не доказано, что D из него выводит");
chk(godAfterRevive === 1, `режим God слетел после смерти/воскрешения (vec_god=${godAfterRevive})`);
chk(godOff === 0, `повторное G не выключило режим (vec_god=${godOff})`);
chk(R[2].kills > 0 && R[2].alive === 0,
  `после выключения God mode контакт снова обязан убивать (смертей ${R[2].kills}, flagVivo ${R[2].alive})`);

// ============ ФАЗА 5: ГДЕ СБРАСЫВАЕТСЯ ЗАМОК (доказываем, а не утверждаем) ============
// Отдельного сброса в коде НЕТ: ячейку пишет только StartGame_0, и пишет на КАЖДОМ старте.
// Значит замок обязан закрыться сам, если из открытой партии дойти до game over, вернуться
// на титул и стартовать заново ПРОБЕЛОМ. Проверяем именно этот путь, целиком, без записей
// в память кроме обнуления жизней.
B.wr(L.Vidas, 0);                       // следующая смерть = game over
B.press(KEY_D); B.run(4);               // умираем читом (замок ещё открыт)
let sawTitle = false;
for (let i=0;i<1500 && !sawTitle;i++) { B.run(1); if (B.rd(L.GameStatus) === 1) sawTitle = true; }
const cheatsAtTitle = B.rd(L.vec_cheats);
// со ВТОРОГО старта — пробелом, F1/F3 не трогаем
let restarted = false;
for (let i=0;i<60 && !restarted;i++) { B.press(KEY_SPACE,4); B.run(60); if (B.rd(L.GameStatus)===5) restarted = true; }
const cheatsAfterSpace = B.rd(L.vec_cheats);
B.press(KEY_G);
const godAfterSpaceRestart = B.rd(L.vec_god);
console.log(`\n5. СБРОС ЗАМКА: дошли до титула ${sawTitle?"да":"НЕТ"}, vec_cheats на титуле ${cheatsAtTitle},` +
            ` перезапуск пробелом ${restarted?"да":"НЕТ"} -> vec_cheats ${cheatsAfterSpace}, G после него: vec_god ${godAfterSpaceRestart}`);
chk(sawTitle, "после game over игра не вернулась на титул (GameStatus=1) — путь сброса не проверен");
chk(restarted, "не удалось перезапустить партию пробелом после возврата на титул");
chk(cheatsAfterSpace === 0, `замок не закрылся на старте пробелом после открытой партии (vec_cheats=${cheatsAfterSpace})`);
chk(godAfterSpaceRestart === 0, `после перезапуска пробелом чит G снова работает (vec_god=${godAfterSpaceRestart})`);

if (fail) { console.log(`\nРЕЗУЛЬТАТ: ПРОВАЛ (${fail})`); process.exit(1); }
console.log("\nРЕЗУЛЬТАТ: ОК (замок: пробел глушит все читы, F1+F3 открывают и сами стартуют партию;" +
            " G гейтит смерть, D убивает мимо гейта, повторное G возвращает смертность)");
