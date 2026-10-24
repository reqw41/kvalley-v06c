// st_lib.js - общая разборка кадров для st_eval2 (та же метрика, что в st_eval.js): окно героя, bad/missing/missR, путь пачки.
'use strict';
const {FR}=require('./st_stand.js');
const W=576,G=0xff80a0a0>>>0,R=0xff4060e0>>>0;const isG=v=>(v>>>0)===G,isR=v=>(v>>>0)===R;
let HERO_OWN=!!process.env.HERO_OWN;
function evalRun(r,evs,skipF){
  const st=r.states;const res=[];
  const packs=[];{let cur=null;for(const [t,n] of evs){if(n==='vec_spr_out'){cur={t,set:new Set()};packs.push(cur);}else if(cur)cur.set.add(n);}}
  for(let i=0;i<r.frames.length;i++){const m=r.meta[i];const f=m.f;if(f<skipF)continue;
    const bmp=r.frames[i].bmp,t0=f*FR,t1=t0+FR;let a=-1;for(let j=0;j<st.length;j++)if(st[j].t<t0)a=j;let b=st.length-1;for(let j=0;j<st.length;j++)if(st[j].t>=t1){b=j;break;}if(a<0)a=0;
    const set=st.slice(a,b+1).map(s=>s.ideal);const Y=m.y>200?m.y-256:m.y;
    let x0=32+2*Math.max(0,m.x-26),x1=32+2*Math.min(255,m.x+30),y0=Math.max(16,Y+44),y1=Math.min(272,Y+100);
    if(HERO_OWN&&m.h){const h=m.h[0][0]===2?m.h[1]:m.h[0];if(h[3]>0&&m.h[0][0]!==2){x0=32+16*h[1];x1=Math.min(544,32+16*(h[1]+h[3]+1));const ra=((m.vs-(h[2]+16))&255)+16,rb=((m.vs-h[2])&255)+17;if(ra<rb){y0=Math.max(16,ra);y1=Math.min(272,rb);}}}
    const Tb=t0+(40+Math.max(0,Y+48))*192;let pk=null;for(const q of packs)if(q.t<=Tb)pk=q;const path=!pk?'?':pk.set.has('vso_fastall')?(pk.set.has('vpr_fs2')?'fastfs2':'fastmxp'):'slow';
    let hp=0,hpR=0,bad=0,miss=0,missR=0,missG=0,bx0=1e9,bx1=-1,by0=1e9,by1=-1;
    for(let y=y0;y<y1;y++){const ro=y*W;for(let x=x0;x<x1;x++){const v=bmp[ro+x];let ok=false;for(const s of set)if(s[ro+x]===v){ok=true;break;}
      if(!ok){bad++;if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y;}
      const v0=set[0][ro+x];if(isG(v0)||isR(v0)){let same=true;for(const s of set)if(s[ro+x]!==v0){same=false;break;}if(same){hp++;if(isR(v0))hpR++;if(v!==v0){miss++;if(isR(v0))missR++;else missG++;}}}}}
    let oth=0;if(process.env.OTHER){const rb=Math.max(64,0);for(let y=rb;y<272;y++){const ro=y*W;const inRow=y>=y0&&y<y1;for(let x=32;x<544;x++){if(inRow&&x>=x0&&x<x1)continue;const v=bmp[ro+x];let ok=false;for(const s of set)if(s[ro+x]===v){ok=true;break;}if(!ok)oth++;}}}
    res.push({f,oth,tick:m.tick,x:m.x,y:m.y,st:m.st,path,bad,miss,missR,missG,hp,hpR,bb:[bx0,bx1,by0,by1]});}
  return res;
}
module.exports={evalRun};
