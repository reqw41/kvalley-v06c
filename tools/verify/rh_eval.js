// rh_eval.js - задача right-half: частота «испорченных» кадров героя на верхних этажах по КАДРАМ ЛУЧА (frames[].bmp).
// Матрица: Y героя {8,16,24} x {бег,прыжок} x мумии {нет, далеко 60/100, рядом 14/40} x X {40,100,160,210}.
// Метрики на кадр: bad (пиксель луча не совпал ни с одним устоявшимся fb вокруг кадра), severe (>=40 пикселей),
// missing20 (>=20 пикселей героя, которые есть во ВСЕХ устоявшихся fb кадра, а луч показал чёрным = «нет половины героя»).
// usage: node rh_eval.js <rom> <sym> <out.json> [ticks]
const T=__dirname+'/';
const {runScene,analyze,FR}=require(T+'hf_stand.js');const fs=require('fs');
const [rom,sym,out,ticks]=[process.argv[2],process.argv[3],process.argv[4],+process.argv[5]||250];
const W=576,G=0xff80a0a0>>>0,R=0xff4060e0>>>0;const hc=v=>{v>>>=0;return v===G||v===R};
const res=[];
for(const hy of [8,16,24])for(const mode of ['run','jump'])for(const mum of [[-1,0],[60,100],[14,40]])for(const x of [40,100,160,210]){
 const r=runScene(rom,sym,{mode,ticks,x,hy,mummy:mum[0]>=0,dx0:mum[0],dx1:mum[1],runw:10});const a=analyze(r);const st=r.states;
 let n=0,bf=0,bp=0,sev=0,miss20=0,tm=0;
 for(let i=0;i<r.frames.length;i++){const A=a[i];if(A.f<30)continue;n++;
  if(A.bad.length){bf++;bp+=A.bad.length;if(A.bad.length>=40)sev++;}
  const f=A.f,bmp=r.frames[i].bmp,t0=f*FR,t1=t0+FR;let aa=-1;for(let j=0;j<st.length;j++)if(st[j].t<t0)aa=j;let b=st.length-1;for(let j=0;j<st.length;j++)if(st[j].t>=t1){b=j;break;}if(aa<0)aa=0;
  const set=st.slice(aa,b+1);const meta=r.meta[i];const Y=meta.y>200?meta.y-256:meta.y;let ms=0;
  for(let y=Math.max(16,Y+46);y<Math.min(272,Y+100);y++)for(let xx=Math.max(0,meta.x-26);xx<Math.min(256,meta.x+30);xx++){const o=y*W+32+2*xx;if(set.every(s=>s.ideal[o]===set[0].ideal[o])&&hc(set[0].ideal[o])&&bmp[o]===0xff000000)ms++;}
  if(ms>=20)miss20++;}
 const tk=r.meta.length?(r.meta[r.meta.length-1].tick-r.meta[0].tick):1;
 res.push({hy,mode,mum:mum.join('/'),x,frames:n,bad_frames:bf,bad_px:bp,severe_frames:sev,missing20_frames:miss20,fpt:+(r.meta.length/tk).toFixed(3)});}
fs.writeFileSync(out,JSON.stringify(res));
const s=k=>res.reduce((p,q)=>p+q[k],0);console.log(rom,'frames',s('frames'),'bad',s('bad_frames'),'px',s('bad_px'),'severe',s('severe_frames'),'miss20',s('missing20_frames'));
