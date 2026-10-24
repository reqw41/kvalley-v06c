// Плоскости p0/p1/p2 в силуэте героя на закрытии входных ворот (пирамида 1).
// Вопрос: одежда (p2) не пишется, или её снова гасит створка после vec_hero_redraw?
"use strict";
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||ROM.replace(/\.rom$/,".sym");
const E=make(ROM,SYM);
const {L,rd,v06c,key,cpu}=E;
const runf=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};
const need=n=>{if(L[n]===undefined){console.log("нет "+n);process.exit(2);}return L[n];};
for(const n of ["vec_hero_redraw","vsc_leaf","drawPuerta","vec_nsp_idx","vec_spr_show","vso_fastall","vfr_gate"]) need(n);

function doorStatus(){
  const base=L.pyramidDoors, out=[];
  for(let i=0;i<4;i++){
    const st=rd(base+i*7+4);
    if(rd(base+i*7)===0xff) continue;
    out.push({i,st,hi:(st>>4)&15,lo:st&15});
  }
  return out;
}
function slotHdr(s){
  const pg=0xE000+s*256;
  return {s,pend:rd(pg+0x96),hi0:rd(pg+0x97),lo0:rd(pg+0x98),nc:rd(pg+0x99),
          hi0c:rd(pg+0x9B),hi0b:rd(pg+0x9F),d0:rd(pg+0xD0),d3:rd(pg+0xD3)};
}
function fmtSlot(h){
  return `s${h.s} p=${h.pend} nc=${h.nc} hi0=${h.hi0.toString(16)} lo=${h.lo0}`+
         ` b=${h.hi0b.toString(16)} c=${h.hi0c.toString(16)} D0=${h.d0} D3=${h.d3.toString(16)}`;
}
// vsb_or пишет буфер[r] в fb lo0+r (низ-вверх, inc l).
function silStats(slot){
  const pg=0xE000+slot*256;
  const nc=rd(pg+0x99), hi0=rd(pg+0x97), lo0=rd(pg+0x98);
  const hist=new Map();
  let bits=0, p0=0,p1=0,p2=0,p3=0;
  if(!nc) return {bits:0,p0:0,p1:0,p2:0,p3:0,hist};
  for(let c=0;c<nc;c++) for(let r=0;r<16;r++){
    const v=rd(pg+0xA0+c*16+r); if(!v) continue;
    const col=(hi0+c)&31, lo=(lo0+r)&255;
    const a=0x8000+(col<<8)+lo;
    const b0=rd(a), b1=rd(a+0x2000), b2=rd(a+0x4000), b3=rd(a+0x6000);
    for(let b=0;b<8;b++) if(v&(1<<b)){
      bits++;
      if((b0>>b)&1) p0++;
      if((b1>>b)&1) p1++;
      if((b2>>b)&1) p2++;
      if((b3>>b)&1) p3++;
      const idx=((b0>>b)&1)<<3|((b1>>b)&1)<<2|((b2>>b)&1)<<1|((b3>>b)&1);
      hist.set(idx,(hist.get(idx)||0)+1);
    }
  }
  return {bits,p0,p1,p2,p3,hist};
}
function histStr(h){
  return [...h.entries()].sort((a,b)=>b[1]-a[1])
    .map(([i,n])=>`idx${i}:${n}`).join(" ")||"(пусто)";
}

const marks=[];
function mark(why){
  const s4=silStats(4), s5=silStats(5);
  marks.push({why, idx:rd(L.vec_nsp_idx), gs:rd(L.GameStatus),
              c4:s4.p2, k4:s4.p1, c5:s5.p2, k5:s5.p1, bits4:s4.bits, bits5:s5.bits});
}
function dump(tag){
  const ds=doorStatus().map(d=>`${d.i}:${d.hi.toString(16)}${d.lo.toString(16)}`).join(" ");
  console.log(`\n== ${tag}  GS=${rd(L.GameStatus)} sub=${rd(L.subStatus)} entra=${rd(L.statusEntrada)} `+
    `Y=${rd(L.ProtaY)} X=${rd(L.ProtaX)} doors[${ds}] idx=${rd(L.vec_nsp_idx)}`);
  for(let s=0;s<6;s++) console.log("  "+fmtSlot(slotHdr(s)));
  for(const s of [4,5]){
    const st=silStats(s);
    console.log(`  sil${s} bits=${st.bits} p0=${st.p0} p1=${st.p1} p2=${st.p2} p3=${st.p3}  ${histStr(st.hist)}`);
  }
  if(!marks.length) console.log("  (нет leaf/redraw в этом кадре)");
  else for(const m of marks) console.log("   "+m.why+
    ` idx=${m.idx} GS=${m.gs} s4.p2=${m.c4}/${m.bits4} s4.p1=${m.k4} s5.p2=${m.c5}/${m.bits5} s5.p1=${m.k5}`);
  const pg=0xE000+4*256, nc=rd(pg+0x99), hi0=rd(pg+0x97), lo0=rd(pg+0x98);
  if(nc){
    const c0=hi0&31;
    console.log("  grid lo0..+15 col "+c0+".."+(c0+nc-1)+" (idx, .=0):");
    for(let r=0;r<16;r++){
      let row="";
      for(let c=0;c<nc;c++){
        const a=0x8000+(((c0+c)&31)<<8)+((lo0+r)&255);
        const b0=rd(a), b1=rd(a+0x2000), b2=rd(a+0x4000);
        for(let b=7;b>=0;b--){
          const idx=((b0>>b)&1)<<3|((b1>>b)&1)<<2|((b2>>b)&1)<<1;
          row+=idx?idx.toString(16):".";
        }
        row+=" ";
      }
      console.log("   "+String((lo0+r)&255).padStart(3)+" "+row);
    }
    const dir=T+"/../../docs/door_close_shots";
    require("fs").mkdirSync(dir,{recursive:true});
    E.pngFrom(E.idealBmp(), dir+"/planes_"+tag.replace(/\s+/g,"_")+".png");
  }
}

let spH=-1, retH=-1, spP=-1, retP=-1, nShow4=0, nGate=0;
const retOf=()=>E.memory.read(cpu.sp,false)|(E.memory.read(cpu.sp+1,false)<<8);
function hook(){
  const pc=cpu.pc;
  if(pc===L.vsc_leaf) mark("leaf_enter s"+rd(L.vec_nsp_idx));
  if(pc===L.vec_spr_show && rd(L.vec_nsp_idx)===4){ nShow4++; mark("show4"); }
  if(pc===L.vfr_gate) nGate++;
  if(pc===L.vso_fastall) mark("fastall");
  if(pc===L.vec_hero_redraw){
    mark("hero_rd_enter s"+rd(L.vec_nsp_idx));
    if(spH<0){spH=cpu.sp; retH=retOf();}
  } else if(spH>=0 && pc===retH && cpu.sp>spH){
    mark("hero_rd_ret");
    spH=-1;
  }
  if(pc===L.drawPuerta){
    mark("puerta_enter");
    if(spP<0){spP=cpu.sp; retP=retOf();}
  } else if(spP>=0 && pc===retP && cpu.sp>spP){
    mark("puerta_ret");
    spP=-1;
  }
  return false;
}

console.log("boot…");
runf(400);
key(112,1); key(114,1);
for(let i=0;i<80 && rd(L.GameStatus)!==4 && rd(L.GameStatus)!==5;i++) runf(8);
key(112,0); key(114,0);
console.log("after F1+F3  GS="+rd(L.GameStatus)+" pyr="+rd(L.piramideActual));
v06c.check_breakpoint=hook;

let frames=0, dumpedEnd=false;
const seen=new Set();
while(frames<900){
  const gs=rd(L.GameStatus);
  const st=rd(L.statusEntrada);
  const doors=doorStatus();
  const closing=doors.find(d=>d.hi===5);
  const keyD=closing?`c${closing.lo}`:`g${gs}e${st}`;
  if(!seen.has(keyD) && (gs===4 || (gs===5 && closing))){
    seen.add(keyD);
    dump(keyD);
  }
  marks.length=0;
  if(gs===5 && st>=1 && !closing){
    dump("after close");
    dumpedEnd=true;
    break;
  }
  runf(1);
  frames++;
}
if(!dumpedEnd) dump("timeout frames="+frames);
console.log("done frames="+frames+" show4="+nShow4+" vfr_gate="+nGate);
