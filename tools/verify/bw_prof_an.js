const fs=require('fs');const files=process.argv.slice(2);
const steps=[];for(const f of files){const d=JSON.parse(fs.readFileSync(f));for(const s of d.steps)steps.push(s);}
const LIM=+process.env.LIM||1e9;for(let i=steps.length-1;i>=0;i--)if(steps[i].total>LIM)steps.splice(i,1);const n=steps.length;const T=steps.map(s=>s.total);
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length,vr=a=>{const m=mean(a);return a.reduce((x,y)=>x+(y-m)**2,0)/a.length};
const vT=vr(T);
const labels=new Set();steps.forEach(s=>Object.keys(s.self).forEach(k=>labels.add(k)));
const rows=[];
for(const l of labels){
  const self=steps.map(s=>s.self[l]||0), inc=steps.map(s=>s.incl[l]||0), calls=steps.map(s=>s.calls[l]||0);
  const m=mean(self),ms=mean(T);
  const mi=mean(inc);const cov=inc.reduce((x,y,i)=>x+(y-mi)*(T[i]-ms),0)/n;
  rows.push({label:l,calls_mean:mean(calls),calls_max:Math.max(...calls),self_min:Math.min(...self),self_mean:m,self_max:Math.max(...self),incl_min:Math.min(...inc),incl_mean:mean(inc),incl_max:Math.max(...inc),var_share:cov/vT,pad_cost_to_max:Math.max(...inc)-mi,sd_incl:Math.sqrt(vr(inc)),sd_after_pad:Math.sqrt(vr(T.map((t,i)=>t-inc[i])))});
}
rows.splice(0,rows.length,...rows.filter(r=>r.calls_mean>0&&r.label!=='romCeil'));rows.sort((a,b)=>b.var_share-a.var_share);
console.log('steps',n,'T mean',Math.round(mean(T)),'sd',Math.round(Math.sqrt(vT)),'min',Math.min(...T),'max',Math.max(...T));
for(const r of rows.slice(0,25))console.log(r.label.padEnd(22),'calls',r.calls_mean.toFixed(2),'incl min/mean/max',r.incl_min,Math.round(r.incl_mean),r.incl_max,'share',(100*r.var_share).toFixed(1)+'%','pad',Math.round(r.pad_cost_to_max),'sd_after',Math.round(r.sd_after_pad));
fs.writeFileSync(process.env.PROF_OUT||'prof_rows.json',JSON.stringify({steps:n,T:{mean:mean(T),sd:Math.sqrt(vT),min:Math.min(...T),max:Math.max(...T)},rows},null,1));
