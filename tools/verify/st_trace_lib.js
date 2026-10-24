// st_trace_lib.js - свёртка журнала записей в экранные плоскости: серии (кадр, метка PC, плоскость), такты от IRQ, диапазон колонок/строк.
'use strict';
function summarize(J,L,evs){
  const labs=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0xE000).sort((a,b)=>a[1]-b[1]);
  const lab=pc=>{let lo=0,hi=labs.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(labs[m][1]<=pc)lo=m;else hi=m-1;}return labs[lo][0];};
  const pl=a=>(a>>13)-4;let cur=null;const out=[];
  for(const [ff,c,pc,a,v] of J){const l=lab(pc),k=ff+'|'+l+'|'+pl(a);
    if(cur&&cur.k===k&&c-cur.c1<400){cur.c1=c;cur.n++;cur.a0=Math.min(cur.a0,a&0x1fff);cur.a1=Math.max(cur.a1,a&0x1fff);}
    else{cur={k,f:ff,c0:c,c1:c,n:1,a0:a&0x1fff,a1:a&0x1fff,l,p:pl(a)};out.push(cur);}}
  const lines=out.map(o=>`f${o.f} t${o.c0}-${o.c1} ${o.l} pl${o.p} n=${o.n} col${o.a0>>8}-${o.a1>>8} lo${o.a0&255}-${o.a1&255}`);
  for(const [t,n,ff] of (evs||[]))lines.push(`f${ff} t${t} == ${n}`);
  return lines.sort((x,y)=>{const f=s=>+s.match(/^f(\d+)/)[1],t=s=>+(s.match(/ t(\d+)/)||[0,0])[1];return f(x)-f(y)||t(x)-t(y);});
}
module.exports={summarize};
