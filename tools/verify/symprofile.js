// Профиль тактов по КОНКРЕТНЫМ меткам (не группам) для тяжёлого шага, чтобы найти
// реальную долю тактов у меток, не попавших в GROUP из tickcycles.js.
// Использование: node symprofile.js <rom> <sym>  (запускать из корня дерева, verify/beam_harness.js рядом)
const {make,toGame}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {cpu,run,rd,L,key,memory}=E;
const FRAME=59904;
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x6800).sort((a,b)=>a[1]-b[1]);
const addrs=syms.map(x=>x[1]);
const near=pc=>{let l=0,h=addrs.length-1,r=0;while(l<=h){const m=(l+h)>>1;if(addrs[m]<=pc){r=m;l=m+1}else h=m-1}return syms[r][0];};
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
  [/^(?!vpz_resume$)(?:vfm_|vfz_|vmx_|vprs_|vpz_|vom_|vop_|vclp)/, "слияние парных записей и композиция гасимой плоскости (save-under 3pl)"],
  [/^vec_su_ptr|^vsu_ptr|^vsp_hl/, "адресация слотов"],
  [/^vtm_|^vec_hero_redraw|^vhr_/, "верхняя маска/дорисовка героя"],
  [/^vec_brillo|^drawBrillo/, "аура гемов"],
  [/^vec_setpal|^vip_|^vbp_/, "палитра"],
];
const covered = n => GROUP.some(([re])=>re.test(n));
const TIP=L.tickInProgress, CP=L.vbt8_cp;
let inStep=false,cyc=0,blits=0,hist=null,steps=[];
const owr=memory.write.bind(memory);
memory.write=function(a,v,s){const aa=a&0xffff;
  if(aa===TIP){ if((v&255)&1){inStep=true;cyc=0;blits=0;hist={};}
                else if(inStep){inStep=false;steps.push([cyc,blits,hist]);} }
  return owr(a,v,s);};
const orig=cpu.instruction.bind(cpu);
cpu.instruction=function(){ const pc=cpu.pc&0xffff; const t=orig();
  if(inStep){ cyc+=t; if(pc===CP) blits++; const n=near(pc); hist[n]=(hist[n]||0)+t; }
  return t; };
toGame(E); run(120);
for(const d of [39,37,39,38,32]){ key(d,1); run(300); key(d,0); run(50); }
const st=steps.filter(s=>s[1]<200);
const band=st.filter(s=>s[0]>FRAME&&s[0]<4*FRAME);
const agg={},tot=band.reduce((a,b)=>a+b[0],0);
for(const [,,h] of band) for(const [k,v] of Object.entries(h)) agg[k]=(agg[k]||0)+v;
const avg=tot/band.length;
console.log(`ТЯЖЁЛЫЙ ШАГ: ${band.length} шагов, среднее ${Math.round(avg)} тактов = ${(100*avg/FRAME).toFixed(1)}% кадра`);
console.log(`\nМетки с префиксом 'v', НЕ покрытые ни одной группой GROUP, отсортированы по среднему числу тактов на тяжёлый шаг:`);
let sumUncoveredV=0;
const rows=[];
for(const [k,v] of Object.entries(agg)){
  if(!k.startsWith('v')) continue;
  if(covered(k)) continue;
  const a=v/band.length;
  rows.push([k,a]);
  sumUncoveredV+=a;
}
rows.sort((a,b)=>b[1]-a[1]);
for(const [k,a] of rows){ if(a<20) continue; console.log(`  ${String(Math.round(a)).padStart(6)} т  ${(100*a/avg).toFixed(2).padStart(5)}%  ${k}`); }
console.log(`\nИТОГО у v*-меток вне групп: ${Math.round(sumUncoveredV)} тактов = ${(100*sumUncoveredV/avg).toFixed(1)}% от тяжёлого шага`);
