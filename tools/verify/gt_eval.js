// gt_eval.js - задача apex-fast, раунд 2: «зелёный хвост» за героем при беге в середине экрана (лучевые кадры, как rh_eval).
// Сцены: hy {72,112} (этажи пирамиды 1), бег влево/вправо (stand: смена направления каждые 16 тиков), мумии нет/60-100/14-40, X 3 точки.
// Метрики по кадрам: bad = пиксели, которых нет ни в одном устоявшемся состоянии (hf_stand.analyze); behind = из них в полосе
// ЗА героем по ходу движения (24 точки пикселя шириной за габаритом героя); foreign = bad-пиксели цвета, которого нет ни в одном
// устоявшемся состоянии кадра в окне героя (промежуточная комбинация плоскостей); green = bad-пиксели цвета мумии (G>R,B).
// usage: node gt_eval.js <rom> <sym> <out.json> [ticks]
const T=__dirname+'/';const {runScene,analyze,FR}=require(T+'hf_stand.js');const fs=require('fs');
const [rom,sym,out,ticks]=[process.argv[2],process.argv[3],process.argv[4],+process.argv[5]||250];
const W=576;const HYS=process.env.HY?process.env.HY.split(',').map(Number):[72,112];
const XS=process.env.XS?process.env.XS.split(',').map(Number):[60,120,180];
const acc={};const add=(k,d)=>{const e=acc[k]=acc[k]||{frames:0,bad_frames:0,bad_px:0,behind_frames:0,behind_px:0,foreign_frames:0,foreign_px:0,green_frames:0,green_px:0};for(const q in d)e[q]+=d[q];};
const isGreen=c=>{const r=c&255,g=(c>>>8)&255,b=(c>>>16)&255;return g>=0x80&&g>r+0x40&&g>b+0x40;};
let hist={};let totFr=0,totTk=0;
for(const hy of HYS)for(const mum of [[-1,0],[60,100],[14,40]])for(const x of XS){
 let ld=0;const r=runScene(rom,sym,{mode:'run',ticks,x,hy,mummy:mum[0]>=0,dx0:mum[0],dx1:mum[1],runw:10});const a=analyze(r);const st=r.states;
 for(let i=0;i<r.frames.length;i++){const A=a[i];if(A.f<30)continue;
  const f=A.f,bmp=r.frames[i].bmp,t0=f*FR,t1=t0+FR;let aa=-1;for(let j=0;j<st.length;j++)if(st[j].t<t0)aa=j;let b=st.length-1;for(let j=0;j<st.length;j++)if(st[j].t>=t1){b=j;break;}if(aa<0)aa=0;
  const set=st.slice(aa,b+1);const m=r.meta[i];const pm=r.meta[Math.max(0,i-1)];if(m.x>pm.x)ld=1;else if(m.x<pm.x)ld=-1;const dir=ld;
  // окно героя: X-26..X+30 (px игры), экранные x = 32+2*xx
  const hx0=32+2*Math.max(0,m.x-26),hx1=32+2*Math.min(255,m.x+30);
  const behind=dir===0?null:(dir>0?[32+2*(m.x-40),32+2*(m.x+2)]:[32+2*(m.x-2),32+2*(m.x+40)]);
  // цвета, допустимые в устоявшихся состояниях окна героя
  const ok=new Set();for(const s of set){for(let y=16;y<272;y++){const o=y*W;for(let xx=hx0;xx<hx1;xx++)ok.add(s.ideal[o+xx]);}}
  let nb=0,nf=0,ng=0;
  for(const o of A.bad){const x=o%W;const c=bmp[o];const inWin=x>=hx0&&x<hx1;
   if(behind&&x>=behind[0]&&x<behind[1])nb++;
   if(inWin&&!ok.has(c)){nf++;hist[c>>>0]=(hist[c>>>0]||0)+1;}
   if(isGreen(c))ng++;}
  const d={frames:1,bad_frames:A.bad.length?1:0,bad_px:A.bad.length,behind_frames:nb?1:0,behind_px:nb,foreign_frames:nf?1:0,foreign_px:nf,green_frames:ng?1:0,green_px:ng};
  const mk=mum.join('/');add('all',d);add('hy'+hy,d);add('mum'+mk,d);add('hy'+hy+'/mum'+mk,d);add('dir'+(dir>0?'R':dir<0?'L':'0'),d);}
 totFr+=r.meta.length;totTk+=r.meta.length?(r.meta[r.meta.length-1].tick-r.meta[0].tick):1;
}
const o={fpt:+(totFr/totTk).toFixed(3),acc,foreign_colors:Object.fromEntries(Object.entries(hist).sort((p,q)=>q[1]-p[1]).slice(0,8).map(([c,n])=>['0x'+(+c).toString(16),n]))};
fs.writeFileSync(out,JSON.stringify(o,null,1));console.log(rom,'fpt',o.fpt);for(const k of Object.keys(acc).sort())if(!/\//.test(k))console.log(k.padEnd(14),JSON.stringify(acc[k]));console.log(JSON.stringify(o.foreign_colors));
