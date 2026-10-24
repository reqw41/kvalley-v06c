// momia_hidden.js — ПРОПАВШИЕ ПИКСЕЛИ МУМИИ. Считает на ЖИВОМ кадре, сколько пикселей
// силуэта мумии НЕ ОТЛИЧАЮТСЯ от фона, который был под ними: индекс палитры тот же ->
// пиксель физически невидим, силуэт «дырявый».
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ slot_ledger (б). Там модель наивная: «спрайт делает OR в одну
// плоскость, значит там, где бит уже стоял, ничего не изменится». Она НЕ УЧИТЫВАЕТ
// ЗАДАЧУ#41: мумия ГАСИТ чужие плоскости под своим силуэтом (vom_check), поэтому её
// пиксель = ЧИСТЫЙ индекс своих плоскостей. Пиксель пропадает не там, где «бит уже
// стоял», а только там, где фон УЖЕ ИМЕЛ РОВНО ЭТОТ индекс. Разница большая: у тёплой
// мумии (p0 = idx8) пропадает ровно то, что нарисовано ТОНОМ A КАМНЯ, потому что тон A
// камня — это тот же idx8.
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ momia_purity. Та меряет ПРИМЕСЬ (фон просвечивает сквозь фигуру,
// пиксель не своего цвета). Эта — ИСЧЕЗНОВЕНИЕ (пиксель совпал с фоном). Это разные
// дефекты: примесь портит цвет, исчезновение съедает силуэт.
//
// КАК СЧИТАЕТ (без догадок, обе картинки берутся с железа эмулятора):
//   ФИНАЛ  — три плоскости fb ПОСЛЕ пачки vec_spr_out;
//   ФОН    — из save-under слота: плоскости, перечисленные в шапке (hi0/hi0b/hi0c),
//            берутся из сохранённых блоков, остальные — прямо из fb (спрайт их не трогал).
// Мумия опознаётся по паттерну (0x28-0x33 прямые, 0x88-0x93 зеркальные), как в momia_purity.
//
// Запуск: node tools/verify/momia_hidden.js [rom] [sym] [кадров на пирамиду] [пирамид]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const PF=+(process.argv[4]||600), NP=+(process.argv[5]||4);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu,memory}=E;
const wr=(a,v)=>memory.write(a&0xffff,v,false);
const isMomia=p=>(p>=0x28&&p<0x34)||(p>=0x88&&p<0x94);
const rot=h=>{let a=h+0x20;if(a>=0xE0)a-=0x60;return a;};
const planeOf=h=>(h&0xE0);            // 0x80=p0, 0xA0=p1, 0xC0=p2
const colOf=h=>(h&0x1F);
let outs=0, silPx=0, hidPx=0, hidOuts=0, live=false, frames=0;
const byIdx=new Map();                 // idx мумии -> [силуэт, пропало]
const byBg=new Map();                  // idx ФОНА под силуэтом -> пикселей
const blkHist={}; let blkSum=0, blkN=0;  // блоков плоскостей на вывод (цена блиттера)
let retSP=-1, retPC=-1, pending=[];
function beforePack(){
  pending=[];
  const n=rd(L.vsp_n);
  for(let k=0;k<n;k++){
    const idx=rd(L.vsp_list+k), pg=0xE000+idx*256;
    if(idx<6||idx>13)continue;
    if(rd(pg+0x96)!==1)continue;
    if(!isMomia(rd(L.sprAttrib+idx*4+2)))continue;
    const nc=rd(pg+0x99); if(!nc)continue;
    // БЛОКОВ ПЛОСКОСТЕЙ В ВЫВОДЕ: hi0 всегда + hi0b + hi0c. Это и есть цена мумии в
    // стирании/сохранении/выводе: каждый блок = 16*ncols байт через все три прохода.
    const nb=1+(rd(pg+0x9A)?1:0)+(rd(pg+0x9B)?1:0);
    blkHist[nb]=(blkHist[nb]||0)+1; blkSum+=nb*nc; blkN++;
    pending.push([pg,nc,rd(pg+0x97),rd(pg+0x98)]);
  }
}
// индекс пикселя: p0<<3 | p1<<2 | p2<<1
function idxAt(hi,lo,bit,plGet){
  const pl=planeOf(hi), col=colOf(hi);
  let v=0;
  for(const [pbase,w] of [[0x80,8],[0xA0,4],[0xC0,2]]){
    const page=pbase+col;
    if(plGet(page,lo)&(1<<bit)) v|=w;
  }
  return v;
}
function afterPack(){
  for(const [pg,nc,hi0,lo0] of pending){
    // разбор шапки save-under: какие плоскости сохранены и в каком порядке блоков
    if(rd(pg)!==1) continue;                    // шапка невалидна — фон не восстановить
    const hHi=rd(pg+1), hLo=rd(pg+2), hNc=rd(pg+3), hHib=rd(pg+4), hHic=rd(pg+5);
    if(hHi!==hi0||hLo!==lo0||hNc!==nc) continue; // сейв не от этого габарита
    // блоки сейва идут в порядке hi0 -> hi0b -> hi0c, по 16*ncols байт на плоскость
    const blocks=new Map();                      // СТАРШАЯ страница плоскости -> смещение блока
    let off=6;
    for(const h of [hHi,hHib,hHic]){ if(!h) continue; blocks.set(h,off); off+=16*hNc; }
    let sil=0, hid=0;
    for(let c=0;c<nc;c++)for(let r=0;r<16;r++){
      const s=rd(pg+0xA0+c*16+r); if(!s)continue;
      const lo=(lo0+r)&0xFF;
      for(const [pbase,w] of [[0x80,8],[0xA0,4],[0xC0,2]]){
        const basePage=(pbase+colOf(hi0))&0xFF;   // страница плоскости в столбце 0
        const fb=rd((((basePage+c)&0xFF)<<8)|lo);
        finBits[w]=fb;
        // ФОН: сохранённую плоскость берём из блока, несохранённую — из fb (спрайт её не трогал)
        bgBits[w]=blocks.has(basePage)?rd(pg+blocks.get(basePage)+c*16+r):fb;
      }
      for(let b=0;b<8;b++){
        if(!(s&(1<<b))) continue;
        let f=0,g=0;
        for(const w of [8,4,2]){ if(finBits[w]&(1<<b)) f|=w; if(bgBits[w]&(1<<b)) g|=w; }
        sil++; if(f===g) hid++;
        if(!byIdx.has(f)) byIdx.set(f,[0,0]);
        const e2=byIdx.get(f); e2[0]++; if(f===g) e2[1]++;
        byBg.set(g,(byBg.get(g)||0)+1);
      }
    }
    outs++; silPx+=sil; hidPx+=hid; if(hid) hidOuts++;
  }
  pending=[];
}
const finBits={}, bgBits={};
v06c.check_breakpoint=function(){
  const pc=cpu.pc;
  if(pc===L.vec_spr_out&&retPC<0&&live){retSP=cpu.sp;retPC=memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);beforePack();}
  else if(retPC>=0&&pc===retPC&&cpu.sp>retSP){retPC=-1;retSP=-1;afterPack();}
  return false;
};
function gotoPyr(p){
  while(rd(L.piramideActual)!==p){
    const cur=rd(L.piramideActual);
    wr(L.piramideDest, cur>p?p:cur+1); wr(L.subStatus,0); wr(L.GameStatus,8);
    let w=0; while(w<9000&&!(rd(L.piramideActual)!==cur&&rd(L.GameStatus)===5)){v06c.oneInterrupt(true);w++;}
    for(let i=0;i<40;i++)v06c.oneInterrupt(true);
    if(rd(L.piramideActual)===cur) return false;
  }
  return true;
}
for(let p=1;p<=NP;p++){
  if(p>1&&!gotoPyr(p)) break;
  live=false; for(let i=0;i<30;i++)v06c.oneInterrupt(true);
  live=true;
  for(let i=0;i<PF;i++){ v06c.oneInterrupt(true); if(rd(L.GameStatus)===5) frames++; }
  live=false;
}
console.log("ROM: "+ROM);
console.log(`кадров геймплея ${frames}, выводов мумий ${outs}, пикселей силуэта ${silPx}`);
console.log(`ПРОПАЛО (пиксель = фон под ним): ${hidPx} = ${silPx?(100*hidPx/silPx).toFixed(2):0}% площади`);
console.log(`выводов с пропажами: ${hidOuts} = ${outs?(100*hidOuts/outs).toFixed(1):0}%`);
console.log("разбивка по ИТОГОВОМУ индексу пикселя мумии:");
for(const [i,[s,h]] of [...byIdx].sort((a,b)=>b[1][0]-a[1][0]))
  console.log(`  idx${String(i).padEnd(2)}: силуэт ${String(s).padStart(7)}  пропало ${String(h).padStart(7)}  ${(100*h/s).toFixed(2)}%`);
console.log("ЦЕНА БЛИТТЕРА: блоков плоскостей на вывод (1 блок = 16*ncols байт x3 прохода):");
for(const k of Object.keys(blkHist).sort())
  console.log(`  ${k} блок(а): ${String(blkHist[k]).padStart(6)} выводов  ${(100*blkHist[k]/blkN).toFixed(2)}%`);
console.log(`  ИТОГО столбце-блоков (сумма блоков*ncols) = ${blkSum}, на вывод ${(blkSum/blkN).toFixed(3)}`);
console.log("ЧТО БЫЛО ПОД СИЛУЭТОМ (индекс фона) — показывает, часто ли мумия вообще стоит на непустом:");
for(const [i,n] of [...byBg].sort((a,b)=>b[1]-a[1]))
  console.log(`  idx${String(i).padEnd(2)}: ${String(n).padStart(7)} пикс  ${(100*n/silPx).toFixed(2)}%`);
