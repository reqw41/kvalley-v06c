// СЦЕНАРИЙ ВЛАДЕЛЬЦА: верхний ряд, правый угол, идём влево, прижимаемся к бордюру и
// прыгаем — половина спрайта героя остаётся. Классифицируем остаток так же, как mumjump:
// TEST = экран после того, как спрайты убраны и движок их стёр; REF = чистая перерисовка
// комнаты. orphan = TEST есть, REF нет = невытертый спрайт.
const { make, toGame } = require("./beam_harness.js");
const ROM = process.argv[2] || "build/kvalley_8c.rom", SYM = process.argv[3] || "build/kvalley_8c.sym";
const E = make(ROM, SYM);
const { L, rd, v06c, memory, keyboard, cpu } = E;
const wr = (a,v) => memory.write(a & 0xffff, v & 255, false);
const EQ=process.env.EQ==="1";
// ШАГ СЦЕНАРИЯ — РОВНО ОДИН ИГРОВОЙ ТИК, а не кадр. `timer` инкрементирует runGame
// (kvalley_game.asm), то есть ровно один раз на исполненный шаг логики; ждём его смены.
// Это и делает сборки с РАЗНОЙ каденцией (50 Гц «как успеет» против fixed25) сравнимыми:
// сценарий «120 шагов влево с прыжком» одинаков по игре, сколько бы кадров он ни занял.
// [2026-09-11] добавлены (а) счётчик кадров, чтобы каденция была ВИДНА в отчёте, и
// (б) предохранитель: если за 16 кадров тик не случился, логика стоит — стенд падает,
// а не висит в бесконечном do/while (так он висел бы на любом GameStatus != 5).
let TKFRAMES=0;
function tick(keys){ TK++; const held=new Set(keys);
  if(EQ) wr(L.sprAttrib+20, rd(L.sprAttrib+16));   // сравнять Y обеих половин героя
  for(const c of [37,39,32]) held.has(c)?E.key(c,1):E.key(c,0);
  const t0=rd(L.timer); let nf=0;
  do { v06c.oneInterrupt(true); TKFRAMES++; nf++;
       if(nf>16){ console.error(`СТЕНД ВСТАЛ: за 16 кадров игровой тик не случился (timer=${rd(L.timer)}, GameStatus=${rd(L.GameStatus)})`); process.exit(3); }
     } while(rd(L.timer)===t0); }
function snap(){ return { m: memory.bytes.slice(), sp:cpu.sp, pc:cpu.pc, regs:cpu.regs.slice(),
  iff:cpu.iff, ip:cpu.iff_pending, sf:cpu.sf, pf:cpu.pf, hf:cpu.hf, zf:cpu.zf, cf:cpu.cf,
  ms:memory.mode_stack, mm:memory.mode_map, pm:memory.page_map, ps:memory.page_stack, cw:memory.cw }; }
function rest(s){ memory.bytes.set(s.m); cpu.sp=s.sp; cpu.pc=s.pc; cpu.iff=s.iff; cpu.iff_pending=s.ip;
  cpu.sf=s.sf; cpu.pf=s.pf; cpu.hf=s.hf; cpu.zf=s.zf; cpu.cf=s.cf;
  for(let i=0;i<8;i++)cpu.regs[i]=s.regs[i];
  memory.mode_stack=s.ms; memory.mode_map=s.mm; memory.page_map=s.pm; memory.page_stack=s.ps; memory.cw=s.cw; }
function grab(){ const b=Buffer.alloc(0x6000); for(let i=0;i<0x6000;i++)b[i]=rd(0x8000+i); return b; }
const TR=0xA000+19*256+251;
const _sy=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x8000).sort((a,b)=>a[1]-b[1]);
const _ad=_sy.map(x=>x[1]);
const _nr=pc=>{let l=0,h=_ad.length-1,r=0;while(l<=h){const m=(l+h)>>1;if(_ad[m]<=pc){r=m;l=m+1}else h=m-1}return _sy[r][0]+"+"+(pc-_ad[r]);};
let _lg=[];
{const ow=memory.write.bind(memory);
 memory.write=function(a,v,f){ if(a===TR){_lg.push(`${globalThis.__ph||"игра"} ${_nr(cpu.pc)} <- ${v} сл=${rd(L.vec_nsp_idx)}`); if(_lg.length>18)_lg.shift();} return ow(a,v,f); };}
process.on("exit",()=>{console.log("--- байт 0x"+TR.toString(16)+" (p1, X=152, lo=251) ---");_lg.forEach(x=>console.log("   "+x));});
// трасса: покрывает ли хоть одно стирание/сохранение остаточный адрес
const TRC=[]; let TRon=false;
const RA=0xA000+(+(process.env.RA_COL||19))*256+(+(process.env.RA_LO||251)); let TK=0, hist=[];
{const oi=cpu.instruction.bind(cpu);
 cpu.instruction=function(){
   if(TRon){
     const pc=cpu.pc;
     if(pc===L.vec_su_restore||pc===L.vec_su_save){
       const idx=rd(L.vec_nsp_idx), P=0xE000+idx*256;
       TRC.push({op:pc===L.vec_su_restore?"стир":"сейв", idx,
                 v:rd(P), hi0:rd(P+1), lo0:rd(P+2), nc:rd(P+3), hi0b:rd(P+4),
                 pend:rd(P+0x96), rhi:rd(P+0x97), rlo:rd(P+0x98), rnc:rd(P+0x99),
                 ph:globalThis.__ph});
     }
   }
   return oi();
 };}
let HW=[]; let HWon=false;
{const ow=memory.write.bind(memory);
 memory.write=function(a,v,f){ if(HWon&&a===0xE502){ HW.push(`${_nr(cpu.pc)} lo0:=${v}`); } return ow(a,v,f); };}
// УЧЁТ ПО КЛЕТКЕ: когда её писали и когда её накрывало стирание
const WC=0xA0+(+(process.env.WATCH_COL||18)), WR_=(+(process.env.WATCH_LO||251));
const WADDR=(WC<<8)|WR_;
const WLOG=[];
let FR=0, lastWr=-1, lastWrVal=0, lastCov=-1, lastCovGeo="";
{const ow=memory.write.bind(memory);
 memory.write=function(a,v,f){ if(a===WADDR){ if(v!==0){lastWr=FR;lastWrVal=v;}
     WLOG.push(`кадр ${FR} ${_nr(cpu.pc)} <- ${v.toString(2).padStart(8,"0")}`); if(WLOG.length>12)WLOG.shift(); }
   return ow(a,v,f); };}
{const oi=cpu.instruction.bind(cpu);
 cpu.instruction=function(){
   const pc=cpu.pc;
   if(pc===L.vec_isr) FR++;
   else if(pc===L.vec_su_restore){
     const idx=rd(L.vec_nsp_idx), P=0xE000+idx*256;
     if(rd(P)){ const hi0=rd(P+1),lo0=rd(P+2),nc=rd(P+3),hi0b=rd(P+4);
       for(const h of [hi0,hi0b]) if(h) for(let c=0;c<nc;c++) if(h+c===WC)
         for(let r=0;r<16;r++) if(((lo0+r)&0xFF)===WR_){
           lastCov=FR; lastCovGeo=`сл${idx} hi0=0x${hi0.toString(16)} lo0=${lo0} nc=${nc}`; }
     }
   }
   return oi();
 };}
process.on("exit",()=>{
  console.log(`УЧЁТ по клетке p${(WC>>5)&3} X=${(WC&31)*8} стр=${WR_}:`);
  console.log(`   последняя ЗАПИСЬ ненулём: кадр ${lastWr} (значение ${lastWrVal.toString(2).padStart(8,"0")})`);
  console.log(`   последнее СТИРАНИЕ, накрывшее её: кадр ${lastCov} ${lastCovGeo}`);
  console.log(`   итог: ${lastWr>lastCov?"НАРИСОВАНО ПОСЛЕ ПОСЛЕДНЕГО СТИРАНИЯ — сирота":"стирание было позже записи"}`);
  console.log("   последние записи в клетку:"); WLOG.forEach(x=>console.log("      "+x));
});
function tickMark(){          // состояние остаточного байта и геометрия пары после тика
  hist.push({t:TK, v:rd(RA),
    s4:[rd(0xE400),rd(0xE401),rd(0xE402),rd(0xE403)],
    s5:[rd(0xE500),rd(0xE501),rd(0xE502),rd(0xE503)],
    y:rd(L.ProtaY), x:rd(L.ProtaX)});
}
function covers(t,col,row){            // покрывает ли запись трассы столбец/строку
  for(const h of [t.hi0,t.hi0b]) if(h) for(let c=0;c<t.nc;c++)
    if(h+c===col) for(let r=0;r<16;r++) if(((t.lo0+r)&0xFF)===row) return true;
  return false;
}
function blockVsRef(idx,REF){            // сверить сохранённый блок с чистым фоном
  const P=0xE000+idx*256, out=[];
  if(!rd(P)) return out;                  // шапка невалидна
  const hi0=rd(P+1), lo0=rd(P+2), nc=rd(P+3), hi0b=rd(P+4);
  let off=P+6;
  for(const hi of [hi0,hi0b]){
    if(!hi) continue;
    for(let c=0;c<nc;c++) for(let r=0;r<16;r++){
      const a=((hi+c)<<8)|((lo0+r)&0xFF);
      const got=rd(off++), want=REF[a-0x8000];
      if(got!==want) out.push({a,got,want,pl:(a>>13)&3,col:hi+c,row:(lo0+r)&0xFF});
    }
  }
  return out;
}
// ЖИВАЯ МЕТРИКА, БЕЗ ПАРКОВКИ: пиксель есть на экране, его нет в чистой перерисовке
// комнаты И он не накрыт НИ ОДНИМ действующим габаритом -> это настоящий след.
// СЧЁТЧИК ЗОНЫ ЗАВОРОТА в тесте пересечения vec_su_fixup, с самопроверкой индексов:
// на инструкции `ld a,e` аккумулятор ПОСЛЕ неё обязан совпасть с E, иначе счётчик врёт.
//
// ПОЧИНКА 2026-09-11. Адрес точки был ЗАШИТ как vfx_t1-8 и протух: заплатка заворота
// (2026-08-20) вставила перед vfx_t1 ещё один `jp c,vfx_tb` — 3 байта, — и vfx_t1-8
// стал серединой этого jp. Самопроверка честно печатала «прошла 0/710» и её не читали,
// а в зоне заворота считался мусор. Теперь точка ИЩЕТСЯ ПО КОДУ: от vfx_t1 назад до 16
// байт ищем пару 0x7B,0xC6,0x0F (`ld a,e` / `add a,15`) — ровно тот пролог теста
// пересечения. Не нашли — стенд ПАДАЕТ, а не считает молча не там.
let FXall=0, FXwrap=0, FXchk=0, FXok=0, FXSITE=-1;
{ const at0=L.vfx_t1;
  for(let k=1;k<=16;k++){ const a=at0-k;
    if(rd(a)===0x7B && rd(a+1)===0xC6 && rd(a+2)===0x0F){ FXSITE=a; break; } }
  if(FXSITE<0){ console.error("САМОПРОВЕРКА СТЕНДА: пролог `ld a,e / add a,15` перед vfx_t1 не найден — счётчик заворота считать не по чему"); process.exit(3); }
}
{const oi=cpu.instruction.bind(cpu);
 cpu.instruction=function(){
   const at = cpu.pc===FXSITE;
   const eBefore = at ? cpu.regs[3] : 0;   // regs: b c d e h l m a -> 3 = E, 7 = A
   const r=oi();
   if(at){ FXall++; if(cpu.regs[7]===eBefore){FXok++;} FXchk++; if(eBefore>=241) FXwrap++; }
   return r;
 };}
process.on("exit",()=>console.log(
  `ТЕСТ ПЕРЕСЕЧЕНИЯ (точка 0x${FXSITE.toString(16)} = vfx_t1${FXSITE-L.vfx_t1}): проверок ${FXchk}`+
  `, самопроверка A==E прошла ${FXok}/${FXchk}`+
  `, из них строк в зоне заворота (lo_b>=241): ${FXwrap}`+
  (FXchk&&FXok!==FXchk?"   <== СТЕНД ВРЁТ":"")));
function liveResidue(){
  const s=snap();
  //  МАСКА ПО ОБЪЕДИНЕНИЮ СТАРОГО И НОВОГО ГАБАРИТОВ. Слитая запись пишет ШИРЕ записи
  //  вывода: фаза 1 закрывает покинутый столбец фоном по СТАРОМУ габариту (шапка слота),
  //  фаза 3 читает фон по НОВОМУ (запись вывода). Маска только по одному из них считает
  //  законную дорисовку следом — на этом первая версия метрики и врала (ровно 11 Б во
  //  всех фазах). Гейт vfm_geo гарантирует, что объединение укладывается в «габарит плюс
  //  столбец с каждой стороны», поэтому расширяем на 1 столбец влево и вправо.
  const cov=new Uint8Array(0x6000);
  const paint=(hi,lo,nc)=>{ if(!hi||!nc) return;
    for(let c=-1;c<=nc;c++){ const h=hi+c; if(h<0x80||h>=0xE0) continue;
      for(let r=0;r<16;r++) cov[((h<<8)|((lo+r)&0xFF))-0x8000]=1; } };
  for(let idx=0;idx<21;idx++){ const P=0xE000+idx*256;
    if(rd(P)) { const lo=rd(P+2), nc=rd(P+3);            // СТАРЫЙ габарит из шапки
      paint(rd(P+1),lo,nc); paint(rd(P+4),lo,nc); paint(rd(P+5),lo,nc); }
    const pd=rd(P+0x96);
    if(pd===1||pd===3){ const lo=rd(P+0x98), nc=rd(P+0x99);   // НОВЫЙ габарит из записи
      paint(rd(P+0x97),lo,nc); paint(rd(P+0x9A),lo,nc); paint(rd(P+0x9B),lo,nc); } }
  const LIVE=grab();
  for(let a=0x8000;a<0xE000;a++) wr(a,0);
  cpu.sp=(cpu.sp-2)&0xffff; wr(cpu.sp,0); wr(cpu.sp+1,0); cpu.pc=L.vec_nat_room;
  for(let i=0;i<40000000&&cpu.pc!==0;i++) cpu.instruction();
  const REF=grab(); rest(s);
  let n=0; const list=[];
  for(let pl=0;pl<3;pl++)for(let col=0;col<32;col++)for(let lo=64;lo<=255;lo++){
    const i=pl*0x2000+col*256+lo;
    if(cov[i]) continue;
    if(LIVE[i]&&!REF[i]){ n++; if(list.length<6) list.push(`p${pl} X=${col*8} стр=${lo} экран=${LIVE[i].toString(2).padStart(8,"0")}`); }
  }
  return {n,list};
}
function classify(){ globalThis.__ph="парковка";
  const s=snap(); TRC.length=0; TRon=true;
  const SL=[]; for(let idx=0;idx<8;idx++){ const P=0xE000+idx*256;
    if(!rd(P)) continue;
    SL.push({idx, hi0:rd(P+1), lo0:rd(P+2), nc:rd(P+3), hi0b:rd(P+4),
             blk:Array.from({length:0x90},(_,k)=>rd(P+6+k))}); }
  {const i=hist.map(h=>h.v).lastIndexOf(0);
   console.log(`  ОСТАТОЧНЫЙ БАЙТ: последний раз был нулём на тике ${i>=0?hist[i].t:"никогда"}; далее:`);
   for(const h of hist.slice(Math.max(0,i),Math.max(0,i)+6))
     console.log(`    тик ${h.t} байт=${h.v.toString(2).padStart(8,"0")} герой X=${h.x} Y=${h.y}`+
       ` | сл4 v=${h.s4[0]} hi0=0x${h.s4[1].toString(16)} lo0=${h.s4[2]} nc=${h.s4[3]}`+
       ` | сл5 v=${h.s5[0]} hi0=0x${h.s5[1].toString(16)} lo0=${h.s5[2]} nc=${h.s5[3]}`);}
  wr(L.setAttribProta,0x0C9); wr(L.updateMomiaAtr,0x0C9);
  for(let n=0;n<(+(process.env.PARK_TICKS||14));n++){ for(let sl=0;sl<21;sl++) wr(L.sprAttrib+4*sl,0xE0); tick([]); }
  const TEST=grab(); TRon=false;
  for(let a=0x8000;a<0xE000;a++) wr(a,0);
  cpu.sp=(cpu.sp-2)&0xffff; wr(cpu.sp,0); wr(cpu.sp+1,0); cpu.pc=L.vec_nat_room;
  for(let i=0;i<40000000&&cpu.pc!==0;i++) cpu.instruction();
  const REF=grab(); rest(s); globalThis.__ph="игра";
  for(const idx of [4,5]){
    const bad=blockVsRef(idx,REF);
    if(bad.length) console.log(`  БЛОК слота ${idx}: ${bad.length} байт РАСХОДЯТСЯ с чистым фоном`+
      bad.slice(0,4).map(b=>` [p${b.pl} стлб=0x${b.col.toString(16)} стр=${b.row} в блоке=${b.got.toString(2).padStart(8,"0")} фон=${b.want.toString(2).padStart(8,"0")}]`).join(""));
    else console.log(`  БЛОК слота ${idx}: совпадает с фоном (сейв чист)`);
  }
  {const col=0xA0+19, row=251;
   const hit=TRC.filter(t=>t.v&&covers(t,col,row));
   console.log(`  ТРАССА: всего вызовов ${TRC.length}, покрывают p1/X=152/стр251: ${hit.length}`);
   for(const t of TRC.slice(-10)) console.log(`    ${t.ph} ${t.op} сл${t.idx} шапка v=${t.v} hi0=0x${t.hi0.toString(16)} lo0=${t.lo0} nc=${t.nc} hi0b=0x${t.hi0b.toString(16)} | зап pend=${t.pend} hi0=0x${t.rhi.toString(16)} lo0=${t.rlo} nc=${t.rnc}${covers(t,col,row)?"  <= ПОКРЫВАЕТ":""}`);}
  let orphan=0,hole=0; const list=[];
  for(let pl=0;pl<3;pl++)for(let col=0;col<32;col++)for(let lo=64;lo<=255;lo++){
    const i=pl*0x2000+col*256+lo, t=TEST[i], r=REF[i];
    if(t===r)continue;
    if(t&&!r){orphan++; if(list.length<8)list.push(`p${pl} X=${col*8} lo=${lo} T=${t.toString(2).padStart(8,"0")}`);}
    else if(!t&&r)hole++;
  }
  // ДЛЯ КАЖДОЙ СИРОТЫ: чей габарит её накрывает и что лежит в блоке этого слота
  const why=[];
  for(let pl=0;pl<3;pl++)for(let col=0;col<32;col++)for(let lo=64;lo<=255;lo++){
    const i=pl*0x2000+col*256+lo;
    if(!(TEST[i]&&!REF[i])) continue;
    const page=0x80+pl*0x20+col;
    for(const sl of SL){
      const {idx,hi0,lo0,nc,hi0b}=sl;
      let off=6;
      for(const h of [hi0,hi0b]){ if(!h){continue}
        for(let c=0;c<nc;c++) for(let r=0;r<16;r++){
          const o=off+c*16+r;
          if(h+c===page && ((lo0+r)&0xFF)===lo)
            why.push(`p${pl} X=${col*8} стр=${lo} экран=${TEST[i].toString(2).padStart(8,"0")}`+
                     ` фон=${REF[i].toString(2).padStart(8,"0")} | сл${idx} блок[0x${o.toString(16)}]=`+
                     `${(sl.blk[o-6]??0).toString(2).padStart(8,"0")}`);
        }
        off+=16*nc;
      }
    }
    if(why.length>=6) break;
  }
  if(orphan){ if(why.length){ console.log("  ПОЧЕМУ СИРОТА:"); why.slice(0,6).forEach(x=>console.log("    "+x)); }
    else console.log(`  СИРОТЫ (${orphan} Б) ЛЕЖАТ ВНЕ ВСЕХ ГАБАРИТОВ: валидных слотов до парковки ${SL.length} [`+
      SL.map(x=>`сл${x.idx} hi0=0x${x.hi0.toString(16)} lo0=${x.lo0} nc=${x.nc}`).join("; ")+"]"); }
  return {orphan,hole,list};
}
if(process.env.BREAK){         // НЕГАТИВНЫЙ КОНТРОЛЬ: стирание отключено целиком
  wr(L.vec_su_restore,0x0C9); console.log("(негативный контроль: стирание отключено)");
}
// FIXWRAP — заплатка «заворот столбца» ПОВЕРХ ОБРАЗА, в котором её ещё нет. В этой линии
// заворот исправлен в самом исходнике (`jp c,vfx_tb` сразу за `add a,15`), поэтому
// заплатка не нужна и её точка правки (vfx_t1-7) больше не та. Не throw, а честный отказ:
// падение на «не та точка правки» выглядело как поломка стенда, а это норма.
if(process.env.FIXWRAP){
  const site=FXSITE+1, cur=[rd(site),rd(site+1),rd(site+2)];
  if(cur[0]===0xC6&&cur[1]===0x0F&&cur[2]===0xB8){
    const P=0x4100;
    [0xC6,0x0F,0xD2,(P+7)&255,(P+7)>>8,0x3E,0xFF,0xB8,0xC9].forEach((b,i)=>wr(P+i,b));
    [0xCD,P&255,P>>8].forEach((b,i)=>wr(site+i,b));
    console.log("(заворот столбца исправлен заплаткой)");
  } else if(cur[0]===0xC6&&cur[1]===0x0F&&cur[2]===0xDA){
    console.log("(FIXWRAP не нужен: заворот уже исправлен В ИСХОДНИКЕ — `jp c,vfx_tb` на месте)");
  } else throw new Error("не та точка правки: "+cur);
}
// НЕГАТИВНЫЙ КОНТРОЛЬ ЗАВОРОТА: ломаем исправление обратно — `jp c,vfx_tb` -> три nop.
// Если метрика orphan чувствительна к завороту, здесь она обязана ПОКРАСНЕТЬ; если и
// тут ноль, значит сценарий в зону заворота вообще не заходит и его «0 orphan» ничего
// не доказывает. Это и есть обязательный негативный контроль сторожа.
if(process.env.BREAKWRAP){
  const site=FXSITE+3;
  if(rd(site)!==0xDA) throw new Error("не та точка: ожидался jp c, а там "+rd(site));
  wr(site,0); wr(site+1,0); wr(site+2,0);
  console.log("(негативный контроль: защита от заворота столбца СНЯТА — jp c,vfx_tb занопен)");
}
if(process.env.OVLBAD){        // vmx_ovl всегда «пересекается» — консервативный путь пары
  [0xC3,L.vmx_bad&255,L.vmx_bad>>8].forEach((b,i)=>wr(L.vmx_ovl+i,b));
  console.log("(vmx_ovl приколочен к «пересекается»)");
}
if(process.env.NOFAST){        // vfm_geo := «нельзя» -> вся пара идёт медленным путём
  [0x3E,0x01,0x37,0xC9].forEach((b,i)=>wr(L.vfm_geo+i,b)); console.log("(слитая запись отключена)"); }
if(process.env.NOCLIP){ wr(L.vclp,0x0C9); console.log("(vclp отключён)"); }
if(toGame(E)!==5){ console.log("нет геймплея"); process.exit(1); }
const WARM=+(process.env.WARM||30);
for(let i=0;i<WARM;i++)tick([]);
wr(L.vec_god,1);
// верхний ряд, правый угол
wr(L.ProtaY, 8); wr(L.ProtaX, 232); wr(L.protaStatus, 0);
for(let i=0;i<12;i++)tick([]);
const c0=classify();
if(process.env.LIVE){ const l0=liveResidue();
  console.log(`ЖИВОЙ СЛЕД ДО ДВИЖЕНИЯ (герой стоит): ${l0.n} Б`); l0.list.forEach(x=>console.log("   "+x)); }
console.log(`контроль (стоим): orphan=${c0.orphan} hole=${c0.hole}`);
let livePeak=0, livePeakT=-1, livePeakList=null;
let peak=0, peakT=-1, peakList=null, peakSlots=null, peakHero='';
for(let t=0;t<120;t++){
  const keys=[37];                       // идём влево
  if(t%14===7) keys.push(32);            // и прыгаем
  if(t===96){HW=[];HWon=true;}
  tick(keys); tickMark();
  if(process.env.INJECT){          // ПРОВЕРКА ЧУВСТВИТЕЛЬНОСТИ: заведомый след в N байт
    const n=+process.env.INJECT;   // в нижней части поля, где спрайтов нет
    for(let k=0;k<n;k++) wr(0xA000+5*256+120+k, 0x55);
  }
  if(process.env.LIVE){ const lr=liveResidue();
    if(lr.n>livePeak){ livePeak=lr.n; livePeakT=t; livePeakList=lr.list; } }
  if(t===97){HWon=false; console.log("ЗАПИСИ в lo0 шапки слота 5 за тик 97: "+(HW.length?HW.join(" | "):"НИ ОДНОЙ"));}
  if(process.env.XLOG) console.log(`тик ${t} X=${rd(L.ProtaX)} Y=${rd(L.ProtaY)} st=${rd(L.protaStatus)}`+
    ` сл5 шапка hi0=0x${rd(0xE501).toString(16)} lo0=${rd(0xE502)} nc=${rd(0xE503)}`+
    ` | зап hi0=0x${rd(0xE597).toString(16)} lo0=${rd(0xE598)} nc=${rd(0xE599)} pend=${rd(0xE596)}`);
  const r=classify();
  if(r.orphan>peak){peak=r.orphan;peakT=t;peakList=r.list;
    peakSlots=[0,1,2,3,4,5,6,7].map(sl=>{const p=0xE000+sl*0x100;
      return `сл${sl}: v=${rd(p)} hi0=0x${rd(p+1).toString(16)} lo0=${rd(p+2)} nc=${rd(p+3)} b=0x${rd(p+4).toString(16)} c=0x${rd(p+5).toString(16)} | зап pend=${rd(p+0x96)} hi0=0x${rd(p+0x97).toString(16)} lo0=${rd(p+0x98)} nc=${rd(p+0x99)}`;});
    peakHero=`ProtaY=${rd(L.ProtaY)} X=${rd(L.ProtaX)} status=${rd(L.protaStatus)}`;}
}
if(process.env.LIVE){ console.log(`ЖИВОЙ СЛЕД: пик ${livePeak} Б @ t=${livePeakT}`); (livePeakList||[]).forEach(x=>console.log("   "+x)); }
console.log(`КАДЕНЦИЯ СЦЕНАРИЯ: ${TK} игровых тиков, ${TKFRAMES} кадров = ${(TKFRAMES/TK).toFixed(2)} кадра на тик`);
console.log(`ПИК orphan=${peak} @ t=${peakT} (X=${rd(L.ProtaX)} Y=${rd(L.ProtaY)})`);
if(peakList) peakList.forEach(x=>console.log("   "+x));
if(peakSlots){console.log("   "+peakHero);peakSlots.filter(x=>!x.includes("v=0 hi0=0x0")).forEach(x=>console.log("   "+x));}
