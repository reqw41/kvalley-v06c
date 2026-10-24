// erase_delta.js — ЗАМЕР идеи «стирать не весь прошлый габарит, а ТОЛЬКО ДЕЛЬТУ».
//
// ЗАЧЕМ. Владелец: «стирание спрайта при движении в одну из сторон должно происходить
// только там где надо, а не всего, чтобы мерцало поменьше». Инструмент отвечает на три
// вопроса ЧИСЛАМИ, до всяких правок.
//
// 1) СКОЛЬКО СТИРАЕТСЯ ВПУСТУЮ. Стирание (vec_su_restore) идёт только СТАРЫМ путём и
//    кладёт фон из слота во ВЕСЬ прошлый габарит. Байт ОБЯЗАН быть стёрт только если в нём
//    есть бит СТАРОГО спрайта, не покрытый НОВЫМ: вывод идёт OR-ом (vsb_or) и погасить
//    ничего не может. Старый спрайт восстанавливается как fb & ~фон — вывод прошлого кадра
//    был OR-ом поверх чистого фона, значит эти биты и есть спрайт.
//    ВПУСТУЮ раскладывается на две части, и это главное различие:
//      - «БЕЗ БИТОВ СТАРОГО СПРАЙТА» — байт габарита, где спрайта не было вовсе; его
//        восстановление пишет фон поверх фона. Это НЕ дельта движения, это разница между
//        ПРЯМОУГОЛЬНИКОМ габарита и СИЛУЭТОМ, и геометрией её не поймать;
//      - «покрыто новым спрайтом» — та самая дельта.
// 2) НА СКОЛЬКО объект реально смещается за кадр и как часто остаётся в том же знакоместе.
// 3) КОМУ ПРИНАДЛЕЖИТ ОСТАТОК ТРАНЗИЕНТА на старом пути и можно ли было этот объект
//    вывести слитой записью (то есть не стирать ВООБЩЕ, а не «стирать поменьше»).
//
// Запуск: node tools/verify/erase_delta.js [rom] [sym] [кадров]
"use strict";
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom",
      SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||8000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,memory,cpu}=E;
const ISR=L.vec_isr,OUT=L.vec_spr_out,REST=L.vec_su_restore,SHOW=L.vec_spr_show,MRG=L.vso_merge1;
const BEAM0=13780+192*(((L.vec_vscroll-0x1F)&255));
const pgOf=i=>0xE000+i*256;
const cat=i=>i<4?"ворота":i<6?"герой":i<14?"мумии":i<19?"нож":"карта";
let TT=0;const oI=cpu.instruction.bind(cpu);cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
// годность объекта САМОГО ПО СЕБЕ — те же условия, что у прохода 1 vsp_fastmark
function fitness(i){
  const p=pgOf(i);
  if(rd(p)!==1)return "слот невалиден";
  if(rd(p+0x96)!==1)return "pending!=1 (скрыт/дедуплен)";
  if(rd(p+0x9F)!==rd(p+4)||rd(p+0x9B)!==rd(p+5))return "набор плоскостей разошёлся";
  if(rd(p+0x97)!==rd(p+1))return "hi0 (уехал по СТОЛБЦАМ)";
  if(rd(p+0x99)!==rd(p+3))return "ncols (сменил ШИРИНУ)";
  if(Math.abs(((rd(p+0x98)-rd(p+2)+128)&255)-128)>=16)return "|d| >= 16";
  return null;
}
const S={},st=k=>S[k]||(S[k]={n:0,bytes:0,need:0,noBits:0,zeroNeed:0,rows:0,rn:0,
  dx:{},dy:{},samecol:0,newobj:0,merged:0});
const prev={},acc={},nhist={};
let packs=0,fastPacks=0,total=0,cur=null;
const B={out:{pc:OUT},show:{pc:SHOW}};for(const k in B){B[k].ret=-1;B[k].sp=-1;}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0)cur={irq:TT,er:{},n:undefined};
  if(!cur)return false;
  if(pc===MRG&&rd(L.GameStatus)===5)st(cat(rd(L.vec_nsp_idx))).merged++;
  if(pc===OUT&&rd(L.GameStatus)===5){
    cur.n=rd(L.vsp_n);cur.i1=rd(L.vop_i1);packs++;if(rd(L.vsp_fast))fastPacks++;
    nhist[cur.n]=(nhist[cur.n]||0)+1;
    // попарные пересечения ПРОТИВ ВСЕХ членов пачки (и годных, и негодных): объект,
    // не делящий ни байта, мог бы пойти слитой записью ПООБЪЕКТНО
    const G=[];
    for(let i=0;i<cur.n;i++){const idx=rd(L.vsp_list+i),p=pgOf(idx),box=[];
      if(rd(p)===1)box.push([rd(p+2),rd(p+1),rd(p+3),rd(p+4),rd(p+5)]);
      if(rd(p+0x96)===1)box.push([rd(p+0x98),rd(p+0x97),rd(p+0x99),rd(p+0x9F),rd(p+0x9B)]);
      G.push({idx,box});}
    cur.conf={};
    for(let a=0;a<G.length;a++)for(let b=a+1;b<G.length;b++){let hit=false;
      for(const x of G[a].box)for(const y of G[b].box){
        if(Math.abs(x[0]-y[0])>=16)continue;
        for(const px of [x[1],x[3],x[4]].filter(v=>v))for(const py of [y[1],y[3],y[4]].filter(v=>v)){
          if((px&0xE0)!==(py&0xE0))continue;
          if((px&0x1F)>=(py&0x1F)+y[2]||(py&0x1F)>=(px&0x1F)+x[2])continue;
          hit=true;}}
      if(hit){cur.conf[G[a].idx]=1;cur.conf[G[b].idx]=1;}}}
  for(const k in B){const b=B[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();
      if(k==="show"){const i=rd(L.vec_nsp_idx),p=pgOf(i);
        b.d={i,t0:TT,lo0:rd(p+0x98),nc:rd(p+0x99),te:cur.er[i]!==undefined?cur.er[i]:-1,
             fit:fitness(i),conf:cur.conf&&cur.conf[i]?1:0,i1:cur.i1,pn:cur.n};}}
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){b.ret=-1;
      if(k==="show"){const d=b.d;
        if(d.nc&&d.te>=0&&d.pn!==undefined){const Ytop=255-(d.lo0+15);
          if(Ytop>=0&&Ytop<=190){let px=0;
            for(let r=0;r<16;r++){const bt=cur.irq+BEAM0+192*(Ytop+r);
              if(bt>d.te&&bt<TT)px+=d.nc*8;}
            if(px){total+=px;
              const key=d.fit?`${cat(d.i)} | НЕГОДЕН САМ: ${d.fit}`
                : d.conf?`${cat(d.i)} | делит байты с соседом по пачке`
                : d.i1?`${cat(d.i)} | пачка с непрозрачным героем`
                : d.pn>=8?`${cat(d.i)} | длина пачки ${d.pn} >= 8 (кэш vsp_fastmark)`
                : `${cat(d.i)} | ПООБЪЕКТНО СЛИЛСЯ БЫ (стирание было не нужно вовсе)`;
              acc[key]=(acc[key]||0)+px;}}}}}}
  // --- перепись стираний ---
  if(pc===REST&&rd(L.GameStatus)===5){
    const i=rd(L.vec_nsp_idx),p=pgOf(i);
    if(!rd(p))return false;
    cur.er[i]=TT;
    const onc=rd(p+3); if(!onc)return false;
    const s=st(cat(i)),olo=rd(p+2),pend=rd(p+0x96);
    const oplanes=[rd(p+1)];if(rd(p+4))oplanes.push(rd(p+4));if(rd(p+5))oplanes.push(rd(p+5));
    const nplanes=pend===1?[rd(p+0x97)].concat(rd(p+0x9F)?[rd(p+0x9F)]:[]).concat(rd(p+0x9B)?[rd(p+0x9B)]:[]):[];
    const nlo=rd(p+0x98),nnc=rd(p+0x99);
    s.n++;let need=0,tot=0,noBits=0,rmin=99,rmax=-1;
    for(let pi=0;pi<oplanes.length;pi++){
      const base=6+16*onc*pi,page=oplanes[pi];
      for(let c=0;c<onc;c++)for(let r=0;r<16;r++){
        const addr=0x8000+((page&0xE0)-0x80)*0x100+((page&0x1F)+c)*256+((olo+r)&255);
        const oldspr=rd(addr)&~rd(p+base+16*c+r)&255;
        tot++;
        if(!oldspr){noBits++;continue;}
        if(r<rmin)rmin=r;if(r>rmax)rmax=r;
        let cover=0;
        for(const np of nplanes){
          if((np&0xE0)!==(page&0xE0))continue;
          const col=(page&0x1F)+c-(np&0x1F),row=((olo+r)&255)-nlo;
          if(col<0||col>=nnc||row<0||row>15)continue;
          cover|=rd(p+0x0A0+16*col+row);}
        if(oldspr&~cover&255)need++;}}
    s.bytes+=tot;s.need+=need;s.noBits+=noBits;if(!need)s.zeroNeed++;
    if(rmax>=0){s.rows+=rmax-rmin+1;s.rn++;}
    if(pend===1){const Y=rd(p+0x9C),X=rd(p+0x9D),q=prev[i];
      if(q){const dx=((X-q.X+128)&255)-128,dy=((Y-q.Y+128)&255)-128;
        s.dx[dx]=(s.dx[dx]||0)+1;s.dy[dy]=(s.dy[dy]||0)+1;
        if((X>>3)===(q.X>>3))s.samecol++;}
      else s.newobj++;
      prev[i]={Y,X};}}
  return false;};
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  v06c.oneInterrupt(true);}
const top=(o,n)=>Object.keys(o).map(Number).sort((a,b)=>o[b]-o[a]).slice(0,n)
  .map(k=>`${k>=0?"+":""}${k}:${o[k]}`).join(" ");
console.log(`ROM=${ROM.split("/").pop()} кадров ${NF}; пачек GS=5 ${packs}, слитых ${fastPacks} (${(100*fastPacks/packs).toFixed(1)}%)`);
console.log(`размер пачки (пачек): ${Object.keys(nhist).map(Number).sort((a,b)=>a-b).map(k=>k+":"+nhist[k]).join(" ")}`);
let gB=0,gN=0;
for(const k of ["герой","мумии","нож","ворота","карта"]){const s=S[k];if(!s||!s.n)continue;
  const play=k==="герой"||k==="мумии"||k==="нож";if(play){gB+=s.bytes;gN+=s.need;}
  console.log(`\n${k}${play?"":" (вне геймплея, справочно)"}: стираний ${s.n}, слитых выводов ${s.merged}`);
  console.log(`   стёрто байт ${s.bytes} (${(s.bytes/s.n).toFixed(1)} на объект), ОБЯЗАТЕЛЬНЫХ ${s.need} = ${(100*s.need/s.bytes).toFixed(1)}%`);
  console.log(`   впустую: БЕЗ БИТОВ СТАРОГО СПРАЙТА ${s.noBits} = ${(100*s.noBits/s.bytes).toFixed(1)}% (фон поверх фона; не дельта, а прямоугольник против силуэта)`);
  console.log(`            покрыто НОВЫМ спрайтом    ${s.bytes-s.need-s.noBits} = ${(100*(s.bytes-s.need-s.noBits)/s.bytes).toFixed(1)}% (вот это и есть дельта)`);
  console.log(`   строк с битами старого спрайта ${(s.rows/Math.max(1,s.rn)).toFixed(1)} из 16; стираний, где не нужно НИ ОДНОГО байта: ${s.zeroNeed} = ${(100*s.zeroNeed/s.n).toFixed(1)}%`);
  console.log(`   dX: ${top(s.dx,6)} | dY: ${top(s.dy,6)} | остался в ТОМ ЖЕ знакоместе ${(100*s.samecol/Math.max(1,s.n-s.newobj)).toFixed(1)}%`);
}
console.log(`\nГЛАВНОЕ ЧИСЛО (герой+мумии+нож): обязательных байт ${gN} из ${gB} = ${(100*gN/Math.max(1,gB)).toFixed(1)}%, впустую ${(100-100*gN/Math.max(1,gB)).toFixed(1)}%`);
console.log(`\nТРАНЗИЕНТ СТАРОГО ПУТИ ${total} пикс — КОМУ ПРИНАДЛЕЖИТ:`);
for(const k of Object.keys(acc).sort((a,b)=>acc[b]-acc[a]))console.log(`   ${String(acc[k]).padStart(6)}  ${k}`);
let good=0;for(const k in acc)if(k.includes("ПООБЪЕКТНО"))good+=acc[k];
console.log(`   из них у объектов, которым стирание не нужно ВООБЩЕ (слились бы пообъектно): ${good} = ${(100*good/Math.max(1,total)).toFixed(1)}%`);
