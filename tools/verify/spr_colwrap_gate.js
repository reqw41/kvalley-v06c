// spr_colwrap_gate.js — СТОРОЖ «ОБЪЕКТ НЕ ПИШЕТ ВНЕ СВОИХ СТОЛБЦОВ» (заворот габарита).
//
// ЗАЧЕМ. Адрес fb = плоскость + столбец*256 + lo, столбцов 32 (0..31), переход к
// следующему столбцу — inc h. Значит ЛЮБОЙ выход габарита за столбец 31 не обрезается,
// а ПЕРЕНОСИТСЯ в старший байт: p0 столбец 31 (0x9F) + 1 = 0xA0 = p1 СТОЛБЕЦ 0, то есть
// правый край экрана заворачивается в ЛЕВЫЙ (да ещё и в чужой плоскости), а p2 столбец 31
// (0xDF) + 1 = 0xE0 — это уже не экран, а СТРАНИЦА СЛОТА 0 (створка ворот).
// Этот класс дефектов у нас уже был (задача #16, «остаток от ворот в правом столбце») и
// вернулся в августе 2026 жалобой с железа: «мумия уходит за экран вправо и появляется
// слева, её видно наполовину».
//
// ЧТО ПРОВЕРЯЕТ. Ловушка на КАЖДУЮ запись процессора во время пачки вывода (vec_spr_out,
// включая нож). Запись относится к объекту, чья подпрограмма сейчас исполняется
// (vec_su_restore / vec_su_save / vec_spr_show / vso_merge1 / vkn_one — все берут
// vec_nsp_idx). Разрешено писать только:
//   * в fb, в столбцы [X>>3 .. min(31, X>>3+3)] ЛЮБОЙ из трёх видимых плоскостей
//     (запас +3 столбца — это компенсация X+3 у мумии плюс 3 столбца буфера сдвига);
//   * в СВОЮ страницу слота 0xE000+idx*256 (туда пишут сейв и сдвиг фона).
// Всё остальное — заворот либо запись в чужую память, гейт краснеет.
// X берётся из ЗАПИСИ ВЫВОДА слота (+0x9D) — это ровно та координата, по которой
// подготовка считала габарит; для стирания — X, запомненный на прошлом сейве (стирание
// идёт по ШАПКЕ, снятой тогда же).
//
// ДВЕ СЦЕНЫ, ОБЕ ОБЯЗАТЕЛЬНЫ.
//  A) ЖИВАЯ ИГРА — псевдослучайный ввод по пирамидам.
//  B) ПРОВОКАЦИЯ ПРАВОГО КРАЯ — X мумии принудительно прогоняется по 240..255 (крючок
//     на входе в vec_spr_prep переписывает X в атрибутах). Без неё гейт был бы «зелён
//     бессодержательно»: в живой игре мумия доходит до края комнаты редко, а именно там
//     байтовая координата X и переполняется (X — МЛАДШИЙ байт, старший — ACTOR_ROOM,
//     см. updateMomiaAtr: мумия у границы комнаты законно стоит в X=253..255).
//     На MSX там видны первые 3 столбца клетки, а они у мумии ПУСТЫ (силуэт прижат
//     влево на 3, momia_push_left) — то есть эталон не показывает НИЧЕГО.
//
// Запуск: node tools/verify/spr_colwrap_gate.js [rom] [sym] [кадров живой сцены]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||1500);

const PLANES=[0x80,0xA0,0xC0];
function allowed(idx,X){
  const c0=X>>3, cm=Math.min(31,c0+3), s=new Set();
  for(const p of PLANES)for(let c=c0;c<=cm;c++)s.add(p+c);
  s.add(0xE0+idx);                       // своя страница слота: сейв и сдвиг фона
  return s;
}

// scene: "live" | "force"; forceX: значение X, которое навязывается мумиям
function runScene(scene,forceX,frames){
  const E=make(ROM,SYM);
  if(toGame(E)!==5)return {err:"нет геймплея"};
  const {L,rd,v06c,cpu,memory}=E;
  const OUT=L.vec_spr_out, PREP=L.vec_nat_sprites;   // подстановка X — ДО обхода объектов
  const OWNERS=[L.vec_su_restore,L.vec_su_save,L.vec_spr_show,L.vso_merge1,L.vkn_one];
  const savedX=new Array(24).fill(-1);   // X, под которым снят фон (по нему идёт стирание)
  let armed=false,ret=-1,rsp=-1,cur=-1,curSet=null,curX=-1,curWhat="";
  let writes=0,checked=0,objs=0,forced=0,bad=0,alien=0;
  const seen=new Set(),samples=[];
  let frameNo=0;
  const raw=cpu.memory_write_byte.bind(cpu);
  function violation(pg,kind){
    bad++;
    const k=`${cur}|${curWhat}|${curX}|${pg}`;
    if(seen.has(k))return; seen.add(k);
    if(samples.length<12)samples.push(
      `кадр ${frameNo} слот ${cur} (${curWhat}) X=${curX} -> столбцы [${curX>>3}..${Math.min(31,(curX>>3)+3)}], а записал в 0x${pg.toString(16)} = ${kind}`);
  }
  cpu.memory_write_byte=function(addr,w8,stackrq){
    if(armed&&!stackrq&&curSet){
      const a=addr&0xffff, pg=a>>8;
      // ТОЛЬКО ТРИ ВИДИМЫЕ ПЛОСКОСТИ (0x8000-0xDFFF) и ЗОНА СТРАНИЦ СЛОТОВ (0xE000-0xF4FF,
      // 21 слот по 256Б). Остальное в 0xE000+ — игровые переменные (vsp_list, vfm_arr, ...),
      // их пачка пишет законно и часто, к габариту они отношения не имеют.
      if(a>=0x8000&&a<0xE000){
        writes++;checked++;
        if(!curSet.has(pg))violation(pg,"плоскость p"+((pg>>5)&3)+" столбец "+(pg&31));
      }else if(a>=0xE000&&a<0xE000+21*256){
        writes++;checked++;
        // своя страница слота законна (сейв фона, сдвиг фона); чужая = либо перенос из
        // p2 столбца 31 (0xDF+1 = 0xE0), либо чужой слот — и то и другое дефект
        if(pg!==0xE0+cur){alien++;violation(pg,"СТРАНИЦА СЛОТА "+(pg-0xE0));}
      }
    }
    raw(addr,w8,stackrq);
  };
  function setOwner(idx,what,X){
    cur=idx;curWhat=what;curX=X;
    curSet=(X<0)?null:allowed(idx,X);
    if(X>=0)objs++;
  }
  v06c.check_breakpoint=function(){
    const pc=cpu.pc;
    if(pc===PREP){
      // ПОДСТАНОВКА ИДЁТ В АТРИБУТЫ ДО ОБХОДА ОБЪЕКТОВ — иначе крючок оказался бы ПОЗЖЕ
      // гейта заворота (тот стоит перед вызовом vec_spr_prep) и проверял бы не то.
      if(scene==="force"){
        for(let idx=6;idx<14;idx++){
          const p=L.sprAttrib+idx*4, pat=rd(p+2);
          if(rd(p)<0xD0&&((pat>=0x28&&pat<0x34)||(pat>=0x88&&pat<0x94))){
            memory.write(p+1,forceX&0xff);forced++;}
        }
      }
      return false;
    }
    if(pc===OUT){armed=true;rsp=cpu.sp;ret=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);curSet=null;cur=-1;return false;}
    if(!armed)return false;
    if(ret>=0&&pc===ret&&cpu.sp>rsp){armed=false;ret=-1;curSet=null;return false;}
    if(OWNERS.indexOf(pc)>=0){
      const idx=rd(L.vec_nsp_idx), pg=0xE000+idx*256;
      if(pc===L.vec_su_restore){
        setOwner(idx,"стирание",rd(pg)===1?savedX[idx]:-1);
      }else if(pc===L.vec_su_save){
        const X=rd(pg+0x9D);
        // сейв идёт по ЗАПИСИ ВЫВОДА и он же перезаписывает шапку -> дальше стирание пойдёт по этому X
        if(rd(pg+0x96)===1)savedX[idx]=X;else savedX[idx]=-1;
        setOwner(idx,"сохранение фона",rd(pg+0x96)===1?X:-1);
      }else if(pc===L.vkn_one){
        setOwner(idx,"нож",rd(L.sprAttrib+idx*4)<0xD0?rd(L.sprAttrib+idx*4+1):-1);
      }else{
        setOwner(idx,pc===L.vec_spr_show?"вывод":"слитая запись",rd(pg+0x9D));
      }
    }
    return false;
  };
  // --- драйверы сцен ---
  const step=()=>v06c.oneInterrupt(true);
  let seed=20260804; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  let held=-1;
  for(frameNo=0;frameNo<frames;frameNo++){
    if(frameNo%9===0){const ks=[37,39,39,38,40];const k=ks[(rnd()*5)|0];
      if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
    if(frameNo>0&&frameNo%300===0){if(held>0){E.key(held,0);held=-1;}
      E.key(78,1);step();E.key(78,0);
      for(let i=0;i<3000&&rd(L.GameStatus)!==5;i++)step();}
    step();
  }
  if(held>0)E.key(held,0);
  return {writes,checked,objs,forced,bad,alien,samples};
}

console.log(`ROM=${ROM.split("/").pop()}`);
let fail=false, totChecked=0, totObjs=0, totForced=0;
const rows=[];
function scene(name,r){
  if(r.err){console.log(name+": "+r.err);fail=true;return;}
  totChecked+=r.checked;totObjs+=r.objs;totForced+=r.forced;
  console.log(`${name}: записей в fb/слоты ${r.writes}, проверено ${r.checked}, объектов ${r.objs}, НАРУШЕНИЙ ${r.bad}`);
  for(const s of r.samples)console.log("   "+s);
  if(r.bad)fail=true;
  rows.push([name,r.checked,r.objs]);
}
scene("A) живая игра",runScene("live",0,NF));
for(let x=240;x<=255;x++){
  // 300 кадров: настоящие паттерны мумии (0x28-0x33/0x88-0x93) в первой пирамиде выходят
  // из облака пыли примерно к 200-му кадру, до того в слотах врагов сидит pat 0xE8.
  const r=runScene("force",x,300);
  if(r.err){console.log("B) провокация X="+x+": "+r.err);fail=true;continue;}
  totChecked+=r.checked;totObjs+=r.objs;totForced+=r.forced;
  if(r.bad||r.forced<20){
    console.log(`B) провокация X=${x}: подстановок ${r.forced}, проверено ${r.checked}, НАРУШЕНИЙ ${r.bad}`);
    for(const s of r.samples)console.log("   "+s);
    if(r.bad)fail=true;
    if(r.forced<20){console.log("   ПОДСТАНОВОК СЛИШКОМ МАЛО — сцена бессодержательна (min 20)");fail=true;}
  }else{
    console.log(`B) провокация X=${x}: подстановок ${r.forced}, проверено ${r.checked}, нарушений 0`);
  }
}
// --- ДЕКЛАРАЦИИ ПОКРЫТИЯ: молчаливого зелёного быть не должно -------------------------
const COVER=[["проверено записей",totChecked,10000],["объектов под ловушкой",totObjs,500],
             ["подстановок X мумии",totForced,100]];
console.log("ПОКРЫТИЕ:");
for(const [n,g,m] of COVER){
  const ok=g>=m;if(!ok)fail=true;
  console.log(`   ${n}: ${g} — ${ok?"ok (min "+m+")":"НЕ ОТРАБОТАЛО (min "+m+")"}`);
}
if(fail){console.log("FAIL: объект пишет вне своих столбцов (заворот габарита)");process.exit(1);}
console.log("SPR COLWRAP GATE OK");
console.log("РЕЗУЛЬТАТ: PASS (ни один объект не вышел за свои столбцы)");
