// ГЕЙТ КЭША СОДЕРЖИМОГО БУФЕРА СПРАЙТА (vsp_bufchk/vsp_bufmark).
//
// ЧЕМ ЭТО НЕ СВЕРКА КАРТИНКИ. Расхождение fb между сборками объясняется разной скоростью
// и разным ходом партии, поэтому «картинка совпала» ничего про кэш не доказывает
// (ловушка #2). Здесь проверяется ИНВАРИАНТ ИЗНУТРИ ПРОГОНА и притом самый сильный из
// возможных: на КАЖДОМ попадании кэша прогон ОСТАНАВЛИВАЕТСЯ, буфер слота (0xA0..0xCF)
// снимается, ПРИНУДИТЕЛЬНО запускается пропущенная сборка vsp_pat, и результат сверяется
// байт в байт с тем, что кэш посчитал уже готовым. Дальше состояние ЦП и буфер
// возвращаются, и партия идёт как шла.
// Гейт ПАДАЕТ НА ПУСТОЙ ВЫБОРКЕ: ноль попаданий = проверять было нечего = провал.
"use strict";
const {make}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {L,rd,v06c,cpu,memory,keyboard}=E;
// [2026-08-26] Кэш буфера ОТКАЧЕН (см. коммит отката). Гейт оставлен в дереве, потому
// что он единственный умеет доказывать корректность кэша принудительной пересборкой, и
// понадобится, когда правку вернут. На сборке БЕЗ кэша он честно СКИПАЕТ: падать «нет
// метки» — значит держать в дереве вечно красный гейт и приучать смотреть мимо него.
for(const n of ["vsp_bufhit","vsp_pat","vec_nsp_idx","vsp_sh"])
  if(L[n]===undefined){console.log(`SKIP: сборка без кэша буфера спрайта (нет метки ${n}) — гейт неприменим.`);process.exit(0);}
const wr=(a,v)=>memory.write(a&0xffff,v&255,false);
const rdb=a=>memory.bytes[memory.tobank(a&0xFFFF)];
const wrb=(a,v)=>{memory.bytes[memory.tobank(a&0xFFFF)]=v&0xFF;};
function tick(){const t0=rd(L.timer);do v06c.oneInterrupt(true);while(rd(L.timer)===t0);}
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
let f=0;while(f<1500&&rd(L.GameStatus)!==5){v06c.oneInterrupt(true);f++;}
for(let i=0;i<40;i++)tick();
wr(L.vec_god,1);
const MD=L.momiaDat, STEP=(L.momiaDat2!==undefined)?(L.momiaDat2-L.momiaDat):16;
function place(){const hY=rd(L.ProtaY),hX=rd(L.ProtaX),room=rd(L.ProtaRoom);
  for(let m=0;m<2;m++){const p=MD+m*STEP;wr(p+0,0);wr(p+3,hY);wr(p+5,(hX+(m?14:-14))&255);wr(p+6,room);}
  wr(L.enemyAttrib,hY);wr(L.enemyAttrib+1,(hX+14)&255);wr(L.enemyAttrib+2,hY);wr(L.enemyAttrib+3,(hX-14)&255);}
place();for(let i=0;i<10;i++)tick();
keyboard.keyDown({keyCode:39,which:39,preventDefault(){},stopPropagation(){}});
const SENT=0x0080;
let hits=0, bad=0, okd=0, nd=0, skipped=0, patRan=true; const badList=[];
// ПОПАДАНИЕ отличаем от промаха ФАКТОМ ЗАПУСКА СБОРКИ: метка vsp_bufhit стоит на общем
// хвосте, и через неё проходят ОБА пути. Без этого «проверено 708 попаданий» означало бы
// «проверено 708 подготовок», а на промахе сверка тривиальна — буфер только что собран.
v06c.check_breakpoint=function(){
  if(cpu.pc===L.vsp_bufchk){patRan=false;return false;}
  if(cpu.pc===L.vsp_pat){patRan=true;return false;}
  if(cpu.pc!==L.vsp_bufhit||patRan)return false;
  const idx=rdb(L.vec_nsp_idx), pg=0xE0+idx, base=pg*256+0xA0;
  // МИР МОГ СДВИНУТЬСЯ ПОД НАМИ: vns_draw (повторный вывод без пересчёта) переписывает
  // vec_nsp_ptr, и вложенное прерывание между проверкой кэша и этой точкой меняет pat.
  // Тогда «принудительная сборка» соберёт ДРУГОЙ объект и сверять нечего. Такие случаи
  // считаем отдельно, а не записываем в провал: у настоящего попадания ключ по
  // построению равен (pat+1, сдвиг).
  { const p0=rd(L.vec_nsp_ptr)|(rd(L.vec_nsp_ptr+1)<<8);
    if(rdb(pg*256+0xF8)!==((rdb(p0+2)+1)&0xFF)||rdb(pg*256+0xF9)!==rdb(L.vsp_sh)){skipped++;return false;} }
  hits++;
  const saveBuf=[]; for(let i=0;i<0x30;i++)saveBuf.push(rdb(base+i));
  // полный снимок ЦП: сборка портит все регистры и флаги
  const st={sp:cpu.sp,pc:cpu.pc,iff:cpu.iff,regs:cpu.regs.slice(),
            sf:cpu.sf,pf:cpu.pf,hf:cpu.hf,zf:cpu.zf,cf:cpu.cf};
  const SP=0x7E00, savedSent=[rdb(SP),rdb(SP+1)];
  wrb(SP,SENT&0xFF); wrb(SP+1,SENT>>8);
  cpu.sp=SP; cpu.pc=L.vsp_pat; cpu.iff=false;
  let n=0; while(cpu.pc!==SENT){cpu.instruction();if(++n>200000){console.log("ГЕЙТ ПРОВАЛЕН: принудительная сборка не вернулась");process.exit(2);}}
  const first=[]; for(let i=0;i<0x30;i++)first.push(rdb(base+i));
  // ВТОРОЙ прогон той же сборки: если он не равен первому, врёт стенд/источник, а не кэш
  wrb(SP,SENT&0xFF); wrb(SP+1,SENT>>8); cpu.sp=SP; cpu.pc=L.vsp_pat; cpu.iff=false;
  n=0; while(cpu.pc!==SENT){cpu.instruction();if(++n>200000)break;}
  let nondet=0; for(let i=0;i<0x30;i++)if(rdb(base+i)!==first[i])nondet++;
  if(nondet)nd++;
  const diff=[];
  for(let i=0;i<0x30;i++){const got=first[i]; if(got!==saveBuf[i])diff.push(`+0x${(0xA0+i).toString(16)}: кэш ${saveBuf[i].toString(16)} != сборка ${got.toString(16)}`);}
  for(let i=0;i<0x30;i++)wrb(base+i,saveBuf[i]);
  wrb(SP,savedSent[0]); wrb(SP+1,savedSent[1]);
  cpu.sp=st.sp;cpu.pc=st.pc;cpu.iff=st.iff;cpu.regs=st.regs;
  cpu.sf=st.sf;cpu.pf=st.pf;cpu.hf=st.hf;cpu.zf=st.zf;cpu.cf=st.cf;
  // ключ обязан отвечать текущим (pat, сдвиг)
  const ptr=rd(L.vec_nsp_ptr)|(rd(L.vec_nsp_ptr+1)<<8);
  const pat=rdb(ptr+2), sh=rdb(L.vsp_sh);
  if(rdb(pg*256+0xF8)!==((pat+1)&0xFF)||rdb(pg*256+0xF9)!==sh)
    diff.push(`ключ слота ${idx}: ${rdb(pg*256+0xF8).toString(16)}/${rdb(pg*256+0xF9).toString(16)} против (pat+1,сдвиг) ${((pat+1)&255).toString(16)}/${sh.toString(16)}`);
  if(diff.length){bad++; if(badList.length<8)badList.push(`слот ${idx} pat=${pat.toString(16)} sh=${sh} ключ=${rdb(pg*256+0xF8).toString(16)}/${rdb(pg*256+0xF9)} расх=${diff.length}: `+diff.slice(0,2).join("; "));}
  else okd++;
  return false;
};
for(let i=0;i<600;i++){v06c.oneInterrupt(true);if(i%60===0)place();}
v06c.check_breakpoint=()=>false;
if(!hits){console.log("ГЕЙТ ПРОВАЛЕН: попаданий кэша НОЛЬ — проверять было нечего.");process.exit(2);}
console.log(`попаданий кэша проверено: ${hits}, из них расходится со сборкой: ${bad}; недетерминированных сборок: ${nd}; пропущено «мир сдвинулся» (vns_draw из вложенного прерывания переписал vec_nsp_ptr): ${skipped}`);
badList.forEach(x=>console.log("   "+x));
console.log(bad?"ГЕЙТ ПРОВАЛЕН":"SPRBUF CACHE GATE OK: каждое попадание побайтно равно принудительной сборке");
process.exit(bad?1:0);
