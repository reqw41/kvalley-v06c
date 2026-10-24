// ЮНИТ-ТЕСТ ЗАЛИВКИ ВЕРХНЕЙ КЛИП-ЗОНЫ (vtm_zclip): доказать, что стек-заливка обнуляет
// РОВНО ГАБАРИТ ОБЪЕКТА (ncols столбцов на каждой его плоскости) и НИ ОДНОГО байта сверх
// него — ни в чужом столбце своей плоскости, ни за границей плоскости.
//
// Почему не хватает ab_fb_lockstep: правка меняет длительность пачки, партия расходится
// по фазе, и картинка расходится «сама по себе» (ловушка #2). Здесь фаза ни при чём:
// процедура вызывается НАПРЯМУЮ на подготовленной памяти, шагами ЦП, без прерываний.
//
// СХЕМА. Вся память забивается маркером 0xFF, ставится слот (шапка +3 = ncols, поля
// +0xF5/F6/F7 = страницы плоскостей), PC = vtm_zclip, стек — свой, возврат ловится по
// часовому адресу. Ожидание: обнулены ровно строки 0xF0..0xFF в ncols столбцах КАЖДОЙ
// НЕНУЛЕВОЙ плоскости, плюс служебная ячейка vsu_hi.
//
// [2026-09-11] ДОБАВЛЕНЫ СЛУЧАИ ПРАВОГО КРАЯ (столбцы 28/29/30/31 для всех трёх
// плоскостей) — ровно они ловят дефект «фиксированные 4 столбца»: заливка от страницы
// 0xBD (p1, столбец 29) уезжала в 0xBF (чужой столбец 31) и 0xC0 (столбец 0 СОСЕДНЕЙ
// плоскости), стирая фон лабиринта. НЕГАТИВНЫЙ КОНТРОЛЬ: на сборке ДО правки эти случаи
// обязаны краснеть («ЛИШНИХ»), иначе стенд слеп и доверять ему нельзя.
// [2026-09-11, ВТОРАЯ ПРАВКА] ДОБАВЛЕНЫ СЛУЧАИ ПО ВЕРТИКАЛИ. Заливка обязана работать
// ТОЛЬКО у объекта, чей габарит (строки lo0..lo0+15 ШАПКИ, +2) достаёт до клип-зоны
// 240..255, то есть при lo0 >= 225. Проверяются ОБЕ стороны границы: 224 (габарит
// 224..239) — молчит, 225 (габарит 225..240, касание одной строкой) — заливает ВСЮ
// клип-зону, потому что частичной высоты заливка не умеет и не должна: лишние строки
// она обнуляет ПОВЕРХ того, что сама же снимает вместе с силуэтом. Плюс реальный
// замеренный случай середины поля lo0 = 104. НЕГАТИВНЫЙ КОНТРОЛЬ: на сборке ДО правки
// случаи «середина поля» обязаны краснеть («ЛИШНИХ» 16 x плоскости x ncols).
// Гейт обязан падать на пустой выборке: если ни один случай не отработал — провал.
"use strict";
const {make}=require("./beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
const {L,v06c,cpu,memory}=E;
const SENT=0x0080;                       // часовой адрес возврата (в ОЗУ, не исполняется)
function run1(pages,ncols,lo0){
  // память-маркер: 0xFF во всей ОЗУ выше 0x8000 (экран+слоты), слот собираем сами
  for(let a=0x8000;a<=0xFFFF;a++)memory.bytes[memory.tobank(a)]=0xFF;
  const idx=3, slot=0xE0+idx;
  memory.bytes[memory.tobank(L.vec_nsp_idx)]=idx;
  const wr=(a,v)=>{memory.bytes[memory.tobank(a&0xFFFF)]=v&0xFF;};
  wr(slot*256+0x00,1);                    // valid шапки (заливка его не читает, но слот честный)
  wr(slot*256+0x02,lo0);                  // lo0 ШАПКИ — им гейтится САМ ФАКТ заливки
  wr(slot*256+0x03,ncols);                // ncols ШАПКИ — им и задаётся ширина заливки
  wr(slot*256+0xF5,pages[0]); wr(slot*256+0xF6,pages[1]); wr(slot*256+0xF7,pages[2]);
  const SP=0x7F00;                        // «настоящий» стек теста
  wr(L.vsu_sp,SP&0xFF); wr(L.vsu_sp+1,SP>>8);
  wr(SP,SENT&0xFF); wr(SP+1,SENT>>8);     // адрес возврата лежит по SP
  cpu.sp=SP; cpu.pc=L.vtm_zclip; cpu.iff=false;
  let n=0; while(cpu.pc!==SENT){cpu.instruction();if(++n>200000)throw new Error("vtm_zclip не вернулся");}
  // ячейки, которые расставил САМ ТЕСТ (иначе он ловит собственную подготовку)
  // vtm_zsp — служебная ячейка самого хайджека (адрес настоящего SP), не картинка
  const setup=new Set([slot*256+0x00,slot*256+0x02,slot*256+0x03,
                       slot*256+0xF5,slot*256+0xF6,slot*256+0xF7,L.vsu_sp,L.vsu_sp+1,L.vsu_hi,
                       ...(L.vtm_zsp!==undefined?[L.vtm_zsp,L.vtm_zsp+1]:[])]);
  const dirty=[];
  for(let a=0x8000;a<=0xFFFF;a++){const v=memory.bytes[memory.tobank(a)];
    if(v!==0xFF&&!setup.has(a))dirty.push([a,v]);}
  return {dirty,steps:n,spOk:cpu.sp===SP+2};
}
// lo0 по умолчанию 248 — верх зазора, куда vclp прижимает завёрнутый габарит.
const CASES=[
  {name:"три плоскости 0x82/0xA2/0xC2, ncols=3", pages:[0x82,0xA2,0xC2], nc:3},
  {name:"средняя плоскость пуста, ncols=3",      pages:[0x82,0x00,0xC2], nc:3},
  {name:"третьей плоскости нет, ncols=2",        pages:[0x82,0xA2,0x00], nc:2},
  {name:"первой плоскости нет (выход)",          pages:[0x00,0xA2,0xC2], nc:3},
  {name:"ncols=0 (пустой габарит, выход)",       pages:[0x82,0xA2,0xC2], nc:0},
  {name:"ЗАВОРОТ: столбцы 0xFD..0xFF",           pages:[0x0FD,0x00,0x00], nc:3},
  // --- граница по вертикали: габарит lo0..lo0+15 против клип-зоны 240..255 ---
  {name:"ВЕРТИКАЛЬ: lo0=225 (габарит 225..240, достаёт одной строкой) — ЗАЛИВАЕТ",
   pages:[0x82,0xA2,0xC2], nc:3, lo:225, mid:false},
  {name:"ВЕРТИКАЛЬ: lo0=224 (габарит 224..239, НЕ достаёт) — МОЛЧИТ",
   pages:[0x82,0xA2,0xC2], nc:3, lo:224, mid:true},
  {name:"ВЕРТИКАЛЬ: lo0=104 (замеренная мумия в середине поля) — МОЛЧИТ",
   pages:[0x0BD,0x0DD,0x9D], nc:3, lo:104, mid:true},
  {name:"ВЕРТИКАЛЬ: lo0=0 (габарит 0..15 — зазор и табло, не поле) — МОЛЧИТ",
   pages:[0x82,0xA2,0xC2], nc:3, lo:0, mid:true},
  {name:"ВЕРТИКАЛЬ: lo0=240 (габарит 240..255, вся клип-зона) — ЗАЛИВАЕТ",
   pages:[0x82,0xA2,0xC2], nc:3, lo:240, mid:false},
  {name:"ВЕРТИКАЛЬ: lo0=248 (габарит 248..255 и 0..7, заворот) — ЗАЛИВАЕТ",
   pages:[0x82,0xA2,0xC2], nc:3, lo:248, mid:false},
];
// ПРАВЫЙ КРАЙ: столбцы 28..31. ncols берём максимально возможный по подготовке
// (vsp_ncok: col0 + ncols <= 32, буфер спрайта — 3 столбца), то есть самый опасный.
// Три плоскости разом — и каждая по отдельности: у p2 «следующая страница» 0xE0 — это
// СТРАНИЦА СЛОТА 0, туда заливка уезжала бы не в картинку, а в служебные данные.
for(const col of [28,29,30,31]){
  const nc=Math.min(3,32-col);
  CASES.push({name:`ПРАВЫЙ КРАЙ: столбец ${col}, три плоскости, ncols=${nc}`,
              pages:[0x80+col,0xA0+col,0xC0+col], nc});
  for(const [pn,base] of [["p0",0x80],["p1",0xA0],["p2",0xC0]])
    CASES.push({name:`ПРАВЫЙ КРАЙ: столбец ${col}, только ${pn}, ncols=${nc}`,
                pages:[base+col,0,0], nc});
}
let bad=0, done=0, edge=0, mid=0;
for(const c of CASES){
  const lo0=(c.lo===undefined)?248:c.lo;
  const {dirty,spOk}=run1(c.pages,c.nc,lo0);
  // габарит по вертикали: 16 строк от lo0 ПО МОДУЛЮ 256; пересекается с 240..255?
  let touch=false; for(let k=0;k<16;k++)if(((lo0+k)&255)>=240)touch=true;
  const want=new Set();
  if(c.pages[0]&&c.nc&&touch)                            // пустая 1-я плоскость / ncols=0 / не достаёт = выход
    for(const p of c.pages){ if(!p)continue;
      for(let col=0;col<c.nc;col++)for(let lo=240;lo<256;lo++)want.add((((p+col)&0xFF)<<8)|lo); }
  const got=new Set(dirty.filter(([a,v])=>v===0).map(([a])=>a));
  const nonzero=dirty.filter(([a,v])=>v!==0);
  const missing=[...want].filter(a=>!got.has(a));
  const extra=[...got].filter(a=>!want.has(a));
  const ok=!missing.length&&!extra.length&&!nonzero.length&&spOk;
  if(!ok)bad++;
  done++; if(c.name.startsWith("ПРАВЫЙ КРАЙ"))edge++; if(!touch)mid++;
  console.log(`${ok?"OK  ":"ПЛОХО"} ${c.name}: обнулено ${got.size}, ждали ${want.size}`
    +(missing.length?`, НЕ ОБНУЛЕНО ${missing.length} (${missing.slice(0,4).map(a=>"0x"+a.toString(16)).join(" ")})`:"")
    +(extra.length?`, ЛИШНИХ ${extra.length} (${extra.slice(0,4).map(a=>"0x"+a.toString(16)).join(" ")})`:"")
    +(nonzero.length?`, ИСПОРЧЕНО НЕНУЛЁМ ${nonzero.length} (${nonzero.slice(0,4).map(([a,v])=>"0x"+a.toString(16)+"="+v).join(" ")})`:"")
    +(spOk?"":", SP НЕ ВОССТАНОВЛЕН"));
}
console.log(`ПОКРЫТИЕ: ${done} случаев, из них правый край (столбцы 28..31) ${edge},`
  +` середина поля (габарит не достаёт до строки 240) ${mid}`);
if(!done||edge<16||mid<3){console.log("ГЕЙТ ПРОВАЛЕН: выборка пуста, без случаев правого края"
  +" или без случаев середины поля.");process.exit(2);}
console.log(bad?`ПРОВАЛ: ${bad} из ${done}`:`ВСЕ ${done} СЛУЧАЕВ ЧИСТЫ`);
process.exit(bad?1:0);
