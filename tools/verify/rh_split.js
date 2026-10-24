// rh_split.js - задача right-half: для кадров, где луч не нашёл >=20 пикселей героя (они есть во всех устоявшихся fb кадра),
// считает, сколько столбцов героя vop_ow успел записать ДО прохода луча по верхней строке героя.
// 'SPLIT' = левый столбец записан до луча, правый после (картина «нет правой половины»). usage: node rh_split.js <rom> <sym> <out.json>
const T=__dirname+'/';
const {runScene,FR}=require(T+'hf_stand.js');const {symtab}=require(T+'hf_cls.js');
const [ROM,SYM,OUT]=process.argv.slice(2);const W=576,G=0xff80a0a0>>>0,R=0xff4060e0>>>0;const hc=v=>{v>>>=0;return v===G||v===R};
const tally={};let n=0;const ex=[];
for(const hy of [8,16])for(const mum of [[60,100],[14,40]])for(const x of [40,100,160,210]){
 const r=runScene(ROM,SYM,{mode:'run',ticks:250,x,hy,mummy:true,dx0:mum[0],dx1:mum[1],runw:10,journal:true});const nm=symtab(r.E.L);const VS=r.E.L.vec_vscroll;const st=r.states;
 const byf={};for(const j of r.journal)(byf[j[0]]=byf[j[0]]||[]).push(j);
 for(let i=0;i<r.frames.length;i++){const f=r.frames[i].f;if(f<30)continue;const bmp=r.frames[i].bmp;const t0=f*FR,t1=t0+FR;
  let a=-1;for(let j=0;j<st.length;j++)if(st[j].t<t0)a=j;let b=st.length-1;for(let j=0;j<st.length;j++)if(st[j].t>=t1){b=j;break;}if(a<0)a=0;
  const set=st.slice(a,b+1);const meta=r.meta[i];const Y=meta.y>200?meta.y-256:meta.y;let ms=0;
  for(let y=Math.max(16,Y+46);y<Math.min(272,Y+100);y++)for(let xx=Math.max(0,meta.x-26);xx<Math.min(256,meta.x+30);xx++){const o=y*W+32+2*xx;if(set.every(s=>s.ideal[o]===set[0].ideal[o])&&hc(set[0].ideal[o])&&bmp[o]===0xff000000)ms++;}
  if(ms<20)continue;
  // hero draw writes (vop_row) in frames f-1,f
  const ws=[...(byf[f-1]||[]).map(j=>[...j,-1]),...(byf[f]||[]).map(j=>[...j,0])].filter(j=>nm(j[2])==='vop_row');
  if(!ws.length)continue;
  const cols={};for(const j of ws){const c=(j[3]>>8)&31;const t=(f+j[6])*FR+j[1];const lo=j[3]&255;const e=cols[c]=cols[c]||{t:1e12,lo:0};e.t=Math.min(e.t,t);e.lo=Math.max(e.lo,lo);}
  const cs=Object.keys(cols).map(Number).sort((p,q)=>p-q);
  const rTop=(VS-Math.max(...Object.values(cols).map(e=>e.lo)))&255;const Tb=f*FR+(40+rTop)*192-44;
  const before=cs.filter(c=>cols[c].t<=Tb).length;
  const k=cs.length+' cols: '+before+' drawn before beam';tally[k]=(tally[k]||0)+1;n++;
  const leftBefore=cs.length&&cols[cs[0]].t<=Tb, rightAfter=cols[cs[cs.length-1]].t>Tb;
  tally[leftBefore&&rightAfter?'SPLIT left-before/right-after':'other']=(tally[leftBefore&&rightAfter?'SPLIT left-before/right-after':'other']||0)+1;
  if(leftBefore&&rightAfter&&ex.length<3)ex.push({hy,mum:mum.join('/'),x,f,ms,Tb,cols:cs.map(c=>[c,cols[c].t-f*FR])});
 }}
require('fs').writeFileSync(OUT,JSON.stringify({frames:n,tally,examples:ex},null,1));console.log('frames',n,JSON.stringify(tally));
