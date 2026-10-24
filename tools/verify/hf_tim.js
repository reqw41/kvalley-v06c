// задача hud-flicker, см. outputs/hud-flicker/REPORT.md
const {runScene,FR}=require('./hf_stand.js');
const rom=process.argv[2];const hy=+process.argv[3],x=+process.argv[4],mode=process.argv[5]||'run';
let ids=null;const ev=[];
const names=['vbw_pw','vbw_out','vpz_pair','vpr_or','vpz_wr','vtm_afterdraw','vec_isr_nested'];
const r=runScene(rom+'.rom',rom+'.sym',{mode,ticks:200,x,hy,runw:10,pcHook:(pc,f,cyc,E)=>{
  if(!ids){ids={};for(const n of names)ids[E.L[n]]=n;}
  const n=ids[pc];if(n)ev.push([f*FR+cyc,n,E.rd(E.L.vsb_lo),E.rd(E.L.ProtaY),E.cpu.sp]);}});
const VS=0x2F;
let i=0;const out=[];
for(let k=0;k<ev.length;k++){
  if(ev[k][1]==='vbw_pw'){const t0=ev[k][0];let tout=null,tw=null,te=null,path=null;
    let depth=0;
    for(let j=k+1;j<ev.length&&ev[j][0]-t0<80000;j++){
      if(ev[j][1]==='vbw_out'&&tout===null)tout=ev[j][0];   // first vbw_out after pw
      if((ev[j][1]==='vpz_wr'||ev[j][1]==='vpr_or')&&tw===null){tw=ev[j][0];path=ev[j][1];}
      if(ev[j][1]==='vtm_afterdraw'&&tw!==null&&te===null){te=ev[j][0];break;}
    }
    const lo0=ev[k][2];const rtop=(VS-(lo0+15))&255,rbot=(VS-lo0)&255;
    const b0=(40+rtop)*192-44,b1=(40+rbot)*192-44;
    const ph=t0%FR,pw=tw!==null?tw%FR:null,pe=te!==null?te%FR:null;
    const conflict=pw!==null&&pe!==null&&Math.max(0,Math.min(pe,b1+192)-Math.max(pw,b0))>0;
    out.push({ph,waited:tout===null?null:(tout-t0),pw,pe,b0,b1,path,conflict,lo0});
  }}
console.log('calls',out.length,'conflicts',out.filter(o=>o.conflict).length);
out.filter(o=>o.conflict).slice(0,30).forEach(o=>console.log(JSON.stringify(o)));
