// ТЯЖЁЛЫЙ ШАГ ПО ТАКТАМ. Команды на i8080 стоят от 4 до 18 тактов, поэтому профиль
// «в командах» врёт: развёрнутая петля из дешёвых mov и петля из ld (nn),a — разные вещи.
// Здесь всё считается в тактах и меряется к длине кадра Вектора (59904 такта).
// Берём ТОЛЬКО статику: уровень уже отрисован (отсекаем массовый блит тайлов vbt8_cp),
// так что первичная отрисовка комнаты и скролл в статистику не попадают.
const {make,toGame}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {cpu,run,rd,L,key,memory}=E;
const FRAME=59904;
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x6800).sort((a,b)=>a[1]-b[1]);
const addrs=syms.map(x=>x[1]);
const near=pc=>{let l=0,h=addrs.length-1,r=0;while(l<=h){const m=(l+h)>>1;if(addrs[m]<=pc){r=m;l=m+1}else h=m-1}return syms[r][0];};
// логические узлы: во что складывать такты (первое совпадение выигрывает)
// ПРАВКА ПОКРЫТИЯ (сравнение схем 3pl vs A+2+2, 2026-08-25) — см. подробное объяснение в
// /private/tmp/kv-a2/tools/verify/tickcycles.js (та же правка внесена туда же, потому что
// эти метки существуют в ОБЕИХ сборках и однобокая правка исказила бы сравнение).
// ДОПОЛНИТЕЛЬНО (только здесь): у старой 3-плоскостной схемы обнаружен целый кластер
// меток save-under/merge-write, которых в A+2+2 просто нет — они пусты по построению
// (2+2 не мержит парные записи и не считает "гасимую" плоскость). Замер symprofile.js
// (тяжёлый шаг) показал по ним суммарно ~11-15% тактов, целиком уходивших в "прочую
// логику игры" — это ДЫРА измерения, а не "ноль тактов у новой схемы", раз для старой
// схемы это реальная стоимость движка. Добавлена ОТДЕЛЬНАЯ группа:
//   vfm_/vfz_ — vec_sprout.asm: vfm_geo/vfm_zs и обвязка — проверка геометрии объекта и
//     "пуст ли блок фона" для решения "годна ли пара к слитой записи" (фаза 4 унификации);
//   vmx_/vprs_ — vec_sprout.asm: перестановка/пересечение пары объектов под слитую запись
//     (комментарий у vmx_one/vmx_un: "решает, годна ли пара для СЛИТОЙ записи");
//   vpz_ — vec_sprout.asm: сама слитая запись пары (столбец буфера спрайта);
//   vom_/vop_ — vec_sprout.asm: vom_one/vop_or4 — "нужна ли ГАСИМАЯ плоскость" (OR по
//     габариту, что впрямую и есть композиция плоскостей save-under);
//   vclp — vec_sprout.asm: клип копии на завороте столбца, спутник vsu_scw (save-under).
// vhd_ (индекс створки двери) сознательно НЕ включён — это игровая логика двери, а не
// узел графического движка, который здесь сравнивается.
const GROUP=[
  [/^vec_isr|^vsnd_|^updateSound|^musicCh|^MusicChan|^processSnd|^switchCh|^SetPSG|^WRTPSG|^RDVDP|^mixer|^vwp_|^vst_hw$|^vst_frame$/, "прерывание+звук"],
  [/^vsb_|^vss_/,        "наложение спрайта (vsb/vss)"],
  [/^vsp_row|^vsp_orm|^vsp_msk|^vsp_sh|^vsa_/, "сборка сдвинутой копии"],
  [/^vfl|^vec_nsx|^vns_|^vfs_wr/, "фаза F: поиск изменений"],
  [/^vfx_|^vec_su_fixup/, "обход слотов на блит клетки (fixup)"],
  [/^vfr_|^vfxr_|^vec_su_repair/, "перерисовка стёртого блитом спрайта (задача#54)"],
  [/^vec_su_restore|^vsu_r|^vsur/, "стирание (restore)"],
  [/^vec_su_save|^vsu_s|^vsu_np|^vsu_c|^vsus/, "сохранение фона (save)"],
  [/^vbt|^vec_blit_tile|^vbtc|^vec_text_blit|^vtb_/, "блит клеток фона"],
  [/^vso_|^vec_spr_out|^vec_spr_show|^vsrt_|^vst_no$/, "пачка вывода: порядок/сейвы"],
  [/^vsp_|^vsd_|^vec_spr_prep/, "подготовка объекта (прочее)"],
  // vpz_resume — ЛОЖНОЕ совпадение по префиксу: это метка возврата из ПАУЗЫ (vec_isr.asm,
  // рядом с vec_paused/vec_snd_hush), к слитой записи пары (кластер vpz_pair..vpz_ce,
  // 0x669C-0x673D) отношения не имеет. Исключена явно, иначе испортила бы группу.
  [/^(?!vpz_resume$)(?:vfm_|vfz_|vmx_|vprs_|vpz_|vom_|vop_|vclp)/, "слияние парных записей и композиция гасимой плоскости (save-under 3pl, у A+2+2 отсутствует)"],
  [/^vec_su_ptr|^vsu_ptr|^vsp_hl/, "адресация слотов"],
  [/^vtm_|^vec_hero_redraw|^vhr_/, "верхняя маска/дорисовка героя"],
  [/^vec_brillo|^drawBrillo/, "аура гемов"],
  [/^vec_setpal|^vip_|^vbp_/, "палитра"],
];
const grp=n=>{for(const [re,g] of GROUP) if(re.test(n)) return g; return "прочая логика игры";};
const TIP=L.tickInProgress, CP=L.vbt8_cp;
let inStep=false,cyc=0,blits=0,hist=null,steps=[];
const owr=memory.write.bind(memory);
memory.write=function(a,v,s){const aa=a&0xffff;
  if(aa===TIP){ if((v&255)&1){inStep=true;cyc=0;blits=0;hist={};}
                else if(inStep){inStep=false;steps.push([cyc,blits,hist]);} }
  return owr(a,v,s);};
const orig=cpu.instruction.bind(cpu);
cpu.instruction=function(){ const pc=cpu.pc&0xffff; const t=orig();
  if(inStep){ cyc+=t; if(pc===CP) blits++; const g=grp(near(pc)); hist[g]=(hist[g]||0)+t; }
  return t; };
toGame(E); run(120);
for(const d of [39,37,39,38,32]){ key(d,1); run(300); key(d,0); run(50); }
const st=steps.filter(s=>s[1]<200).sort((a,b)=>a[0]-b[0]);
const n=st.length, q=p=>st[Math.min(n-1,Math.floor(n*p))][0];
const pc_=t=>(100*t/FRAME).toFixed(1)+"% кадра";
console.log(`СТАТИКА: ${n} шагов логики (уровень уже отрисован). Кадр Вектора = ${FRAME} тактов.`);
console.log(`  шаг, тактов:  p50 ${q(.5)} (${pc_(q(.5))})   p90 ${q(.9)} (${pc_(q(.9))})   p99 ${q(.99)} (${pc_(q(.99))})`);
console.log(`  не влезает в кадр: ${st.filter(s=>s[0]>FRAME).length} шагов = ${(100*st.filter(s=>s[0]>FRAME).length/n).toFixed(1)}%`);
const band=st.filter(s=>s[0]>FRAME&&s[0]<4*FRAME);
console.log(`\nРАЗБОР ТЯЖЁЛОГО ШАГА (${band.length} шагов, ${FRAME}..${4*FRAME} тактов), в среднем по узлам:`);
const agg={},tot=band.reduce((a,b)=>a+b[0],0);
for(const [,,h] of band) for(const [k,v] of Object.entries(h)) agg[k]=(agg[k]||0)+v;
const avg=tot/band.length;
console.log(`  ВСЕГО ${Math.round(avg)} тактов = ${pc_(avg)}\n`);
for(const [k,v] of Object.entries(agg).sort((a,b)=>b[1]-a[1])){
  const a=v/band.length; if(a<50) continue;
  console.log(`  ${String(Math.round(a)).padStart(6)} т  ${String((100*a/avg).toFixed(1)).padStart(5)}%  ${pc_(a).padStart(11)}  ${k}`);
}
const light=st.filter(s=>s[0]<=FRAME);
const agg2={},tot2=light.reduce((a,b)=>a+b[0],0);
for(const [,,h] of light) for(const [k,v] of Object.entries(h)) agg2[k]=(agg2[k]||0)+v;
console.log(`\nДЛЯ СРАВНЕНИЯ, ЛЁГКИЙ ШАГ (${light.length} шагов, в среднем ${Math.round(tot2/light.length)} тактов = ${pc_(tot2/light.length)}):`);
for(const [k,v] of Object.entries(agg2).sort((a,b)=>b[1]-a[1]).slice(0,6)){
  const a=v/light.length; console.log(`  ${String(Math.round(a)).padStart(6)} т  ${String((100*a/(tot2/light.length)).toFixed(1)).padStart(5)}%  ${k}`);
}
