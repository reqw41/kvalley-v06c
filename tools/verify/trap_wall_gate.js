// trap_wall_gate.js — СТЕНЫ-ЛОВУШКИ РАБОТАЮТ (жалоба с железа 2026-08-05:
// «не сработала ловушка на 3-м уровне»).
//
// МЕХАНИКА (MurosTrampa, kvalley_game.asm): в пирамиде до трёх стен-ловушек, запись
// 5 байт — [0] активирована, [1] Y, [2] дробная X, [3] X, [4] комната. Пока флаг 0,
// логика ждёт, когда герой окажется РОВНО в точке ловушки (16-битное сравнение (ProtaX):
// младший байт X, старший ProtaRoom, плюс отдельное сравнение Y); после активации ищется
// потолок, и стена каждые 32 тика таймера опускается на 4 пикселя, рисуя свой кирпич.
// ВАЖНО ДЛЯ ЧТЕНИЯ ЖАЛОБ: до активации стены на экране НЕТ — она невидима, пока герой
// не пройдёт через её точку. «Не вижу ловушку в комнате» — это штатное поведение.
//
// ЧТО ПРОВЕРЯЕТ ГЕЙТ (по умолчанию пирамида 3):
//   1) ловушки в пирамиде есть (иначе проверка бессодержательна — ПРОВАЛ ПОКРЫТИЯ);
//   2) поставленный в точку ловушки герой её АКТИВИРУЕТ (флаг 0 -> 1);
//   3) после активации Y стены РАСТЁТ — стена едет вниз;
//   4) стена ВИДНА: фреймбуфер в её столбце меняется по ходу движения (только для
//      ловушек в комнате, которая сейчас на экране, — см. ниже).
//
// Запуск: node tools/verify/trap_wall_gate.js [rom] [sym] [--pyr N]
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const pi=process.argv.indexOf("--pyr");
const PYR=pi>0?+process.argv[pi+1]:3;

// СЕАНС НА КАЖДУЮ ЛОВУШКУ. Первая же проверенная стена раздавливает подставленного под
// неё героя (flagVivo=0, сцена уходит в смерть), и следующие ловушки в том же прогоне
// «не активируются» — это артефакт стенда, а не игры: поставленный под ловушку #1
// пирамиды 8 герой активирует её штатно, если сеанс свежий. Поэтому каждая ловушка
// получает собственный запуск эмулятора.
function boot(){
  const E=make(ROM,SYM);
  const {L,rd,v06c}=E;
  const run=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
  const key=(c,d)=>E.key(c,d?1:0);
  run(700);
  for(let i=0;i<30;i++){key(32,1);run(3);key(32,0);run(3);}
  for(let i=0;i<800&&rd(L.GameStatus)!==5;i++)run(1);
  if(rd(L.GameStatus)!==5)return null;
  let guard=0;
  while(rd(L.piramideActual)<PYR&&guard++<20){
    const before=rd(L.piramideActual);
    key(78,1);run(3);key(78,0);
    for(let f=0;f<600&&(rd(L.piramideActual)===before||rd(L.GameStatus)!==5);f++)run(1);}
  if(rd(L.piramideActual)!==PYR)return null;
  run(60);
  return E;
}

const E0=boot();
if(!E0){console.log(`ПРОВАЛ ПОКРЫТИЯ: до пирамиды ${PYR} в геймплее не добрались`);process.exit(1);}
const L=E0.L;
for(const s of ["numMuroTrampa","muroTrampaDat","ProtaX","ProtaY","ProtaRoom","GameStatus",
                "piramideActual","flagVivo","MurosTrampa"])
  if(L[s]===undefined){console.log("нет символа "+s+" в .sym");process.exit(2);}
const dumpOf=(E,i)=>{const b=L.muroTrampaDat+5*i;
  return {on:E.rd(b),y:E.rd(b+1),x:E.rd(b+3),room:E.rd(b+4)};};

const n=E0.rd(L.numMuroTrampa);
console.log(`ROM=${ROM.split("/").pop()}  пирамида ${PYR}: стен-ловушек ${n}`);
if(!n){console.log(`ПРОВАЛ ПОКРЫТИЯ: в пирамиде ${PYR} ловушек нет — проверять нечего`);process.exit(1);}
for(let i=0;i<n;i++){const d=dumpOf(E0,i);
  console.log(`   #${i}: активна=${d.on} Y=${d.y} X=${d.x} комната=${d.room}`);}

const fails=[];let visChecks=0;
for(let i=0;i<n;i++){
  const E=(i===0)?E0:boot();
  if(!E){fails.push(`#${i}: сеанс не дошёл до пирамиды`);continue;}
  const {rd,v06c,memory,cpu}=E;
  const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
  const run=k=>{for(let j=0;j<k;j++)v06c.oneInterrupt(true);};
  const room0=rd(L.ProtaRoom);	// комната, которая сейчас НА ЭКРАНЕ
  const d0=dumpOf(E,i);
  // Координаты пишем НА ВХОДЕ В MurosTrampa: между кадрами логика успевает вернуть героя
  // на пол (замер: пишем Y=120, а chkActivaTrampa видит Y=128), и гейт мерил бы
  // траекторию, а не механику. ProtaX+1 — это ProtaRoom (0xFE25), нулём его писать нельзя.
  let hold=true;
  v06c.check_breakpoint=function(){
    if(hold&&cpu.pc===L.MurosTrampa){
      wr(L.ProtaRoom,d0.room);wr(L.ProtaX,d0.x);wr(L.ProtaY,d0.y);}
    return false;};
  let act=-1;
  for(let f=0;f<240;f++){run(1);if(rd(L.muroTrampaDat+5*i)){act=f;break;}}
  hold=false;v06c.check_breakpoint=()=>false;
  if(act<0){console.log(`   #${i}: НЕ АКТИВИРОВАЛАСЬ за 240 кадров`);fails.push(`#${i} не активируется`);continue;}
  const yStart=rd(L.muroTrampaDat+5*i+1);
  let yMax=yStart;
  // Столбцы стены во всех трёх плоскостях; fb-строка = 255 - экранная строка.
  const col=(d0.x>>3)&0x1F;
  const band=()=>{const v=[];
    for(const pl of [0x80,0xA0,0xC0])for(const c of [col,(col+1)&0x1F])
      for(let y=yStart-8;y<yStart+48;y++)v.push(memory.read(((pl+c)<<8)|((255-y)&0xff),false));
    return v;};
  // НАКОПИТЕЛЬНО, а не «снимок до / снимок после»: стена может доехать и остановиться,
  // и два крайних снимка совпадут даже при исправной отрисовке.
  let prev=band(),changed=0;
  for(let f=0;f<400;f++){run(1);
    const y=rd(L.muroTrampaDat+5*i+1);
    if(y>yMax)yMax=y;
    if(f%8===7){const b=band();
      for(let k=0;k<b.length;k++)if(b[k]!==prev[k])changed++;
      prev=b;}}
  const moved=yMax-yStart;
  // ВИДИМОСТЬ — ТОЛЬКО В КОМНАТЕ ЭКРАНА. Герой попадает в комнату ловушки записью
  // ProtaRoom, а перерисовку комнаты делает переход через край экрана, поэтому для
  // «чужой» ловушки пустой фреймбуфер — норма, и требовать изменений нельзя.
  const sameRoom=(d0.room===room0);
  console.log(`   #${i}: активирована на кадре ${act}, Y ${yStart} -> ${yMax} (сдвиг ${moved} пикс за 400 кадров)`
    +(sameRoom?`, байт экрана изменилось ${changed}`:", комната не на экране — видимость не проверяем"));
  if(moved<4)fails.push(`#${i} не едет вниз (сдвиг ${moved})`);
  if(sameRoom){visChecks++;if(!changed)fails.push(`#${i} НЕ ВИДНА: стена едет, а фреймбуфер в её столбце не менялся`);}
}
// ПОКРЫТИЕ: без единой проверки видимости зелёный гейт не означает, что стену видно.
if(!visChecks){console.log(`\nПРОВАЛ ПОКРЫТИЯ: ни одна ловушка не оказалась в комнате экрана — видимость не проверена`);process.exit(1);}
if(fails.length){console.log(`\n❌ TRAP WALL GATE FAIL: ${fails.join("; ")}`);process.exit(1);}
console.log("\n✅ TRAP WALL GATE OK: все стены-ловушки активируются, едут вниз и рисуются");
