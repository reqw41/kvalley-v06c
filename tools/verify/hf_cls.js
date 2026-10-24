// задача hud-flicker, см. outputs/hud-flicker/REPORT.md
const {runScene,analyze,FR}=require('./hf_stand.js');
function symtab(L){const syms=[];for(const [k,v] of Object.entries(L))if(v>=0x100&&v<0x7800)syms.push([v,k]);syms.sort((p,q)=>p[0]-q[0]);
 return pc=>{let lo=0,hi=syms.length-1,b=0;while(lo<=hi){const m=(lo+hi)>>1;if(syms[m][0]<=pc){b=m;lo=m+1}else hi=m-1}return syms[b][1];};}
function classify(r,a,skip){
  const L=r.E.L,VS=L.vec_vscroll,near=symtab(L),W=576;
  const byFrame=new Map();for(const j of r.journal){(byFrame.get(j[0])||byFrame.set(j[0],[]).get(j[0])).push(j);}
  const res={bytes:0,cats:{},frames:new Set()};
  for(let i=0;i<a.length;i++){const A=a[i];if(A.f<skip||!A.bad.length)continue;
    const f=A.f;const bytes=new Set();A.bad.forEach(p=>{const y=(p/W)|0,x=p%W;const lo=(VS-(y-16))&255;bytes.add((((x-32)>>1)>>3)+':'+lo);});
    const ws=[...(byFrame.get(f-2)||[]),...(byFrame.get(f-1)||[]),...(byFrame.get(f)||[])];
    for(const key of bytes){const [col,lo]=key.split(':').map(Number);const Tb=f*FR+(40+((VS-lo)&255))*192-44;
      const before=[],after=[];
      for(const w of ws){const aa=w[3];if(((aa>>8)&31)!==col||(aa&255)!==lo)continue;const t=w[0]*FR+w[1];
        (t<=Tb?before:after).push({t,pl:(aa>>13)-4,pc:near(w[2]),nv:w[4],ov:w[5]});}
      // last writer per plane before; first after within 20000 cyc
      const lastB={},firstA={};for(const w of before)lastB[w.pl]=w;for(const w of after)if(w.t-Tb<30000&&!firstA[w.pl])firstA[w.pl]=w;
      const pls=[0,1,2];let cat;
      const bPl=pls.filter(p=>lastB[p]&&Tb-lastB[p].t<30000),aPl=pls.filter(p=>firstA[p]);
      // only writes that change the byte value
      const bCh=bPl.filter(p=>lastB[p].nv!==lastB[p].ov),aCh=aPl.filter(p=>firstA[p].nv!==firstA[p].ov);
      const wb=[...new Set(bCh.map(p=>lastB[p].pc.replace(/\+.*/,'')))].join('/'),wa=[...new Set(aCh.map(p=>firstA[p].pc.replace(/\+.*/,'')))].join('/');
      cat=`before[${bCh.join('')}:${wb}] after[${aCh.join('')}:${wa}]`;
      res.cats[cat]=(res.cats[cat]||0)+1;res.bytes++;res.frames.add(f);}
  }
  return res;
}
module.exports={classify,symtab};
if(require.main===module){
  const [rom,sym,mode,tk,x,hy]=process.argv.slice(2);
  const r=runScene(rom,sym,{mode,ticks:+tk,x:+x,hy:+hy,journal:true,runw:10,mummy:process.env.MUM==='1'});const a=analyze(r);
  const c=classify(r,a,60);console.log(rom,mode,'bad bytes',c.bytes,'frames',c.frames.size);
  Object.entries(c.cats).sort((p,q)=>q[1]-p[1]).slice(0,15).forEach(([k,v])=>console.log(String(v).padStart(5),k));
}
