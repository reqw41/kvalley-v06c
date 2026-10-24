// hero_jitter.js — РАВНОМЕРНОСТЬ ОБНОВЛЕНИЯ ГЕРОЯ НА ЭКРАНЕ.
//
// ПОВОД. Жалоба с железа держится: «спрайт героя вверху в движении по прежнему мерцает»,
// при этом hero_atomic --gate зелёный, а в верхней зоне (Ytop 48..63) у него РОВНО НОЛЬ
// дефектных кадров. Значит меряем не тот дефект.
//
// ЧЕГО НЕ ВИДИТ hero_atomic (и все beam_*): все они проверяют СОГЛАСОВАННОСТЬ картинки
// внутри кадра — «не показал ли луч цвет, которого нет ни в старом кадре, ни в новом».
// Кадр, в котором герой не перерисован ВООБЩЕ, для них идеален: старое == новое,
// рассогласования нет. А в отчёте hero_atomic стоит число, мимо которого прошли:
// кадров без пачки 38.33%, и пара героя пишет байты лишь в 793 кадрах из 2700.
// Если логика двигает героя равномерно, а экран показывает сдвиг то через 2 кадра, то
// через 5, глаз видит именно дрожание силуэта — и ни одна метрика этого не считает.
//
// ЧТО СЧИТАЕТ ЭТОТ ЗАМЕР:
//   A. ЛОГИКА — интервалы между сменами координат героя в sprAttrib (Y,X в пикселях,
//      слоты 4/5 — MSX-структура по 4 байта). Это эталон: как ДОЛЖНО двигаться.
//   B. ЭКРАН — интервалы между сменами ВИДИМОЙ позиции. Видимая позиция кадра — не та,
//      что записана в шапке слота к концу кадра, а та, что была под ЛУЧОМ: если пара
//      дописана позже прохода луча над Ytop героя, глаз в этом кадре видел ПРЕДЫДУЩУЮ.
//   C. ДЖИТТЕР — разброс интервалов экрана: гистограмма, мода, доля интервалов не в моде,
//      σ. Ровный шаг (пусть даже редкий) глаз читает как плавность; рваный — как дрожь.
//   D. ОТСТАВАНИЕ — на сколько кадров показанная позиция отстаёт от логической, и как
//      часто логика успела сдвинуть героя ДВАЖДЫ, пока экран не показал ни одного сдвига
//      (проглоченный шаг: герой телепортируется на 2 пикселя разом).
//
// ПРОВЕРКА САМОГО ИНСТРУМЕНТА (без неё замеру верить нельзя, см. playbook п.9):
//   --selftest прогоняет метрику джиттера на ИСКУССТВЕННЫХ последовательностях с заранее
//   известным ответом (ровный шаг 3; шаг 2/5 вперемешку; каждый третий кадр проглочен) и
//   печатает, что она про них сказала. Если ровная последовательность даёт джиттер != 0
//   или рваная даёт 0 — метрика сломана и числам прогона верить нельзя.
//   --trace печатает сырую покадровую ведомость (логика / запись / луч / видимое).
//
// Запуск: node tools/verify/hero_jitter.js [rom] [sym] [тиков=2600] [--climb] [--trace] [--selftest]
"use strict";
const T=__dirname;

// ---------------- метрика джиттера (чистая функция — её и проверяет --selftest) --------
// vis[] — видимая позиция по кадрам (строка "x,y" или null, когда героя нет на экране).
// Возвращает интервалы между СМЕНАМИ позиции и разброс этих интервалов.
function jitter(vis){
  const iv=[];let last=-1;
  for(let f=0;f<vis.length;f++){
    if(vis[f]===null)continue;
    if(last<0){last=f;continue;}
    if(vis[f]!==vis[last]){iv.push(f-last);last=f;}
  }
  if(!iv.length)return{n:0,hist:{},mode:0,offMode:0,offPct:0,mean:0,sd:0};
  const hist={};for(const v of iv)hist[v]=(hist[v]||0)+1;
  let mode=0,mc=-1;for(const k of Object.keys(hist))if(hist[k]>mc){mc=hist[k];mode=+k;}
  const offMode=iv.length-mc;
  const mean=iv.reduce((a,b)=>a+b,0)/iv.length;
  const sd=Math.sqrt(iv.reduce((a,b)=>a+(b-mean)*(b-mean),0)/iv.length);
  return{n:iv.length,hist,mode,offMode,offPct:100*offMode/iv.length,mean,sd,iv};
}

if(process.argv.indexOf("--selftest")>0){
  // Известные ответы: (1) ровный шаг 3 -> джиттер 0; (2) чередование 2/5 -> ~50% не в моде,
  // sd заметно больше нуля; (3) ровный шаг 1, но каждый третий кадр «проглочен» (позиция
  // не обновилась) -> интервалы 1/2 вперемешку, джиттер НЕ ноль.
  const mk=(n,f)=>{const a=[];let p=0;for(let i=0;i<n;i++){p=f(i,p);a.push(String(p));}return a;};
  const cases=[
    ["ровный шаг 3 кадра (ожидаем джиттер 0%)",      mk(300,i=>Math.floor(i/3))],
    ["чередование 2/5 (ожидаем джиттер заметный)",   (()=>{const a=[];let p=0,f=0,k=0;
        while(a.length<300){const step=(k++%2)?5:2;for(let j=0;j<step&&a.length<300;j++)a.push(String(p));p++;}return a;})()],
    ["шаг 1, каждый третий кадр проглочен",          mk(300,i=>i-Math.floor(i/3))],
  ];
  console.log("SELFTEST метрики джиттера (проверка инструмента до доверия числам):");
  let bad=0;
  for(const [name,seq] of cases){
    const r=jitter(seq);
    const h=Object.keys(r.hist).sort((a,b)=>a-b).map(k=>`${k}кадр x${r.hist[k]}`).join(" ");
    console.log(`  ${name}\n     смен ${r.n}, мода ${r.mode}, не в моде ${r.offPct.toFixed(1)}%, sd ${r.sd.toFixed(2)}  [${h}]`);
    if(name.startsWith("ровный")&&r.offPct!==0){bad++;console.log("     ПРОВАЛ: ровная последовательность дала джиттер");}
    if(name.startsWith("чередование")&&r.offPct<10){bad++;console.log("     ПРОВАЛ: рваная последовательность дала джиттер ~0");}
    if(name.startsWith("шаг 1, каждый")&&r.offPct===0){bad++;console.log("     ПРОВАЛ: проглоченные кадры не замечены");}
  }
  console.log(bad?`SELFTEST FAIL (${bad}) — числам прогона верить нельзя`:"SELFTEST OK — метрика различает ровное и рваное");
  process.exit(bad?1:0);
}

const {make}=require("./beam_harness.js");
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NT=+(process.argv[4]||2600);
const CLIMB=process.argv.indexOf("--climb")>0;
const TRACE=process.argv.indexOf("--trace")>0;
const E=make(ROM,SYM);
const {L,rd,v06c,memory,cpu}=E;
for(const s of ["vec_isr","vec_isr_nested","vec_spr_out","vec_spr_show","vso_merge1","vec_nsp_idx","sprAttrib","GameStatus","timer","vec_isr_depth"])
  if(L[s]===undefined){console.log("нет символа "+s+" в .sym");process.exit(2);}
const BEAM0=13780+192*((((L.vec_vscroll===undefined?0x1F:L.vec_vscroll)-0x1F)&255));
const FB0=0x8000,PLN=0x2000;
const OUT=L.vec_spr_out,SHOW=L.vec_spr_show,MERGE=L.vso_merge1;
const ATTR=L.sprAttrib;                      // MSX-структура: 4 байта на слот (Y,X,pat,col)
const VPR_PA=0x29,VPR_PB=0x2B;

let TT=0;
const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};

// --- слежение за записями пары героя (слоты 4 и 5) ---
let curSlot=-1,inPack=false,outRet=-1,outSp=-1;
let wr4=0,wr5=0,tLast=-1;                    // момент ПОСЛЕДНЕЙ записи пары в этом кадре
// ФАЗА: когда логика ПИШЕТ координаты в sprAttrib относительно момента, когда пачка
// начинает ВЫВОД. Если запись иногда попадает ПОСЛЕ старта пачки, шаг уезжает на
// следующий кадр — отсюда и гуляющая задержка, и потерянные позиции.
let tAttr=-1,tPack=-1,packPos=null;
const oW=memory.write.bind(memory);
memory.write=function(addr,w8,stackrq){
  oW(addr,w8,stackrq);
  const a=addr&0xffff;
  if(a===ATTR+4*4||a===ATTR+4*4+1){if(tAttr<0)tAttr=TT;return;}
  if(a<FB0||a>=0xE000)return;
  if(!inPack)return;
  if(curSlot===4){wr4++;tLast=TT;}
  else if(curSlot===5){wr5++;tLast=TT;}
};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
// ЗАДАЧА#53 (2026-08-07): пара героя пишется СТЕК-БЛИТОМ (vpz_col/vpz_bh в
// vec_sprout.asm), а не через vpr_ka/vpr_kb. Слот берём из САМОМОДИФИЦИРУЕМОГО
// операнда `ld h,страница_слота` — он верен и для пары, и для одиночного объекта.
const KA=L.vpr_ka,KB=L.vpr_kb,WA=L.vop_wa,WB=L.vop_wb;
const PZA=L.vpz_pa, PZB=L.vpz_pb;
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===L.vec_isr_nested)maxDepth=2;   // ветка «только звук»: вывод спрайтов пропущен
  if(pc===OUT&&outRet<0){outSp=cpu.sp;outRet=retOf();inPack=true;
    if(tPack<0){tPack=TT;packPos=`${rd(ATTR+4*4+1)},${rd(ATTR+4*4)}`;}}
  else if(outRet>=0&&pc===outRet&&cpu.sp>outSp){outRet=-1;inPack=false;curSlot=-1;}
  if(inPack){
    if(pc===SHOW||pc===MERGE)curSlot=rd(L.vec_nsp_idx);
    else if(pc===KA||pc===WA)curSlot=(rd(VPR_PA)-0xE0)&255;
    else if(pc===KB||pc===WB)curSlot=(rd(VPR_PB)-0xE0)&255;
    else if(pc===PZA)curSlot=(rd(PZA+1)-0xE0)&255;
    else if(pc===PZB)curSlot=(rd(PZB+1)-0xE0)&255;
  }
  return false;};

// ---------------- прогон ----------------
function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);}else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);}else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);}else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);}else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);}return k;}
function keysClimb(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else{const ph=t%40;if(ph<24)k.push(38);else if(ph<32)k.push(39);else k.push(37);}
  return k;}
const KF=CLIMB?keysClimb:keysFor;

const logicSeq=[],visSeq=[],rows=[];
let phN=0,phSum=0,phAfter=0,phNoPack=0;const phList=[];
let maxDepth=0,nestNoPack=0,nestWithPack=0,plainNoPack=0;
let held=new Set(),tick=0,prevT=0,nf=0,frames=0;
let prevVis=null,lateFrames=0,noDrawFrames=0,packFrames=0;
let swallowed=0,logicChanges=0;
const TIMER=L.timer;
while(tick<=NT&&nf<400000){
  const want=new Set(KF(tick));
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  const frameIrq=TT;
  wr4=wr5=0;tLast=-1;tAttr=-1;tPack=-1;packPos=null;maxDepth=0;
  const wasLive=(rd(L.GameStatus)===5);
  v06c.oneInterrupt(true);
  if(!wasLive){logicSeq.push(null);visSeq.push(null);nf++;
    const t0=rd(TIMER);if(t0!==prevT){prevT=t0;tick++;}continue;}
  frames++;
  // ЛОГИКА: координаты героя в sprAttrib (слот 4 — одежда, ведущий объект пары)
  const y=rd(ATTR+4*4),x=rd(ATTR+4*4+1);
  const lp=`${x},${y}`;
  // ЛУЧ над верхней строкой героя. Y в sprAttrib — экранная строка спрайта сверху вниз.
  const tb=frameIrq+BEAM0+192*(y&255);   // строка героя; отличие от выводимой <= 1 пиксель
  const drew=(wr4>0&&wr5>0);
  if(drew)packFrames++;else noDrawFrames++;
  // ВИДИМОЕ: пара дописана позже луча -> в этом кадре глаз видел прежнюю позицию
  const late=drew&&tLast>tb;
  if(late)lateFrames++;
  if(tPack<0){if(maxDepth>=2)nestNoPack++;else plainNoPack++;}else if(maxDepth>=2)nestWithPack++;
  if(tAttr>=0&&tPack>=0){phN++;const d=tAttr-tPack;phSum+=d;phList.push(d);if(d>0)phAfter++;}
  else if(tAttr>=0&&tPack<0)phNoPack++;
  const vp=(drew&&!late&&packPos)?packPos:prevVis;
  visSeq.push(vp);logicSeq.push(lp);
  if(logicSeq.length>1){
    const pl=logicSeq[logicSeq.length-2];
    if(pl!==null&&pl!==lp){logicChanges++;
      // проглоченный шаг: логика сдвинула, а видимое осталось прежним И на прошлом кадре
      // тоже не обновлялось -> два логических шага подряд без показа
      if(vp===prevVis&&prevVis!==null&&visSeq.length>2&&visSeq[visSeq.length-3]===prevVis)swallowed++;}
  }
  if(TRACE&&rows.length<120)rows.push({f:frames,lp,drew,late,vis:vp,w4:wr4,w5:wr5,
    dt:drew?Math.round(tLast-frameIrq):0,tb:Math.round(tb-frameIrq)});
  prevVis=vp;
  nf++;
  const t=rd(TIMER);if(t!==prevT){prevT=t;tick++;}
}

// ---------------- E. ЛАТЕНТНОСТЬ: через сколько кадров логический сдвиг доехал до экрана
// Если задержка ПОСТОЯННА, глаз её не видит вовсе — это просто сдвиг фазы. Дрожание даёт
// РАЗБРОС задержки: один шаг показан сразу, следующий через 4 кадра. Сопоставляем события
// по порядку: для каждой смены логики ищем ближайшую последующую смену экрана в ту же
// позицию, не переиспользуя уже сопоставленные (иначе ходьба туда-сюда даст ложные пары).
function events(seq){const e=[];let last=null;
  for(let f=0;f<seq.length;f++){const v=seq[f];if(v===null)continue;
    if(last===null){last=v;continue;}
    if(v!==last){e.push({f,pos:v});last=v;}}
  return e;}
const evL=events(logicSeq),evV=events(visSeq);
// Сопоставление ЖАДНЫМ проходом врёт: взяв одну дальнюю пару, оно рассыпает все
// последующие (герой ходит туда-сюда, позиции повторяются) — первая версия этого замера
// давала 51% «не показанных» при том, что выводов пары БОЛЬШЕ, чем сдвигов логики, то
// есть была внутренне противоречива. Считаем наибольшей общей подпоследовательностью:
// она находит максимальное согласованное сопоставление, а всё, что в него не вошло, —
// честно перескоченные позиции.
function lcsMatch(a,b){
  const n=a.length,m=b.length;
  const dp=new Uint16Array((n+1)*(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
    dp[i*(m+1)+j]=a[i].pos===b[j].pos?dp[(i+1)*(m+1)+j+1]+1
      :Math.max(dp[(i+1)*(m+1)+j],dp[i*(m+1)+j+1]);
  const pairs=[];let i=0,j=0;
  while(i<n&&j<m){
    if(a[i].pos===b[j].pos){pairs.push([i,j]);i++;j++;}
    else if(dp[(i+1)*(m+1)+j]>=dp[i*(m+1)+j+1])i++;else j++;
  }
  return pairs;
}
const pairs=lcsMatch(evL,evV);
const lat=[];let unshown=evL.length-pairs.length;
for(const [i,j] of pairs){const d=evV[j].f-evL[i].f;if(d>=0&&d<=40)lat.push(d);}
const latHist={};for(const v of lat)latHist[v]=(latHist[v]||0)+1;
const latMean=lat.length?lat.reduce((a,b)=>a+b,0)/lat.length:0;
const latSd=lat.length?Math.sqrt(lat.reduce((a,b)=>a+(b-latMean)*(b-latMean),0)/lat.length):0;

const pct=(a,b)=>b?(100*a/b).toFixed(2)+"%":"—";
const A=jitter(logicSeq),B=jitter(visSeq);
const hs=r=>Object.keys(r.hist).map(Number).sort((a,b)=>a-b).map(k=>`${k}:${r.hist[k]}`).join(" ");
console.log(`ROM=${ROM.split("/").pop()} ${CLIMB?"[--climb] ":""}тиков ${NT}, экранных кадров геймплея ${frames}`);
console.log(`   кадров, где пара героя писала байты: ${packFrames} = ${pct(packFrames,frames)}`);
console.log(`   кадров БЕЗ вывода героя вовсе:        ${noDrawFrames} = ${pct(noDrawFrames,frames)}`);
console.log(`   вывод завершён ПОЗЖЕ луча над героем: ${lateFrames} = ${pct(lateFrames,packFrames)}`);
console.log(`A. ЛОГИКА (sprAttrib слот 4): смен позиции ${A.n}, мода ${A.mode} кадра, не в моде ${A.offPct.toFixed(1)}%, sd ${A.sd.toFixed(2)}`);
console.log(`   интервалы: ${hs(A)}`);
console.log(`B. ЭКРАН (позиция под ЛУЧОМ): смен ${B.n}, мода ${B.mode} кадра, не в моде ${B.offPct.toFixed(1)}%, sd ${B.sd.toFixed(2)}`);
console.log(`   интервалы: ${hs(B)}`);
console.log(`C. ДЖИТТЕР = насколько экран рванее логики: sd ${A.sd.toFixed(2)} -> ${B.sd.toFixed(2)}, не в моде ${A.offPct.toFixed(1)}% -> ${B.offPct.toFixed(1)}%`);
console.log(`D. ПРОГЛОЧЕННЫХ ШАГОВ (логика сдвинула, экран не показал): ${swallowed} при ${logicChanges} сменах = ${pct(swallowed,logicChanges)}`);
console.log(`E. ЗАДЕРЖКА логика -> экран: сопоставлено ${lat.length} из ${evL.length} сдвигов, НЕ ПОКАЗАНЫ ВОВСЕ ${unshown} = ${pct(unshown,evL.length)}`);
console.log(`   задержка avg ${latMean.toFixed(2)} кадра, sd ${latSd.toFixed(2)} (постоянная задержка глазу не видна, дрожь даёт РАЗБРОС)`);
console.log(`   гистограмма задержки: ${Object.keys(latHist).map(Number).sort((a,b)=>a-b).map(k=>`${k}кадр:${latHist[k]}`).join(" ")}`);
{const q=phList.slice().sort((a,b)=>a-b);const qq=p=>q.length?Math.round(q[Math.min(q.length-1,Math.floor(q.length*p))]):0;
console.log(`F. ФАЗА: запись координат в sprAttrib относительно СТАРТА пачки вывода (тактов; минус = логика успела ДО вывода)`);
console.log(`   кадров с записью и пачкой ${phN}: avg ${phN?Math.round(phSum/phN):0}, p10 ${qq(0.1)}, p50 ${qq(0.5)}, p90 ${qq(0.9)}`);
console.log(`   запись ПОСЛЕ старта пачки (шаг уезжает на следующий кадр): ${phAfter} = ${pct(phAfter,phN)}`);
console.log(`   кадров, где логика писала координаты, а пачки НЕ БЫЛО вовсе: ${phNoPack}`);
console.log(`G. ПОЧЕМУ ПАЧКИ НЕ БЫЛО: вложенное прерывание (тик не кончился, depth>=2) ${nestNoPack}, БЕЗ вложенности ${plainNoPack}`);
console.log(`   для контроля: кадров с вложенностью, где пачка ВСЁ ЖЕ была: ${nestWithPack}`);}
if(TRACE){
  console.log(`--- сырая ведомость (кадр: логика | вывод | луч) ---`);
  for(const r of rows)console.log(`   ${String(r.f).padStart(4)}: лог=${r.lp.padEnd(8)} ${r.drew?`писал w4=${String(r.w4).padStart(3)} w5=${String(r.w5).padStart(3)} конец+${String(r.dt).padStart(6)}`:"НЕ ВЫВОДИЛСЯ          "} луч+${String(r.tb).padStart(6)} ${r.late?"ПОЗЖЕ ЛУЧА":"          "} видно=${r.vis}`);
}
