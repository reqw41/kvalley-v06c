// rh_paths.js - задача right-half: через какой путь пачки (по меткам PC) шли кадры, где у героя не хватает >=20 пикселей.
// usage: node rh_paths.js <rom> <sym> <out.json>
const T=__dirname+'/';
const {runScene,FR}=require(T+'hf_stand.js');
const [ROM,SYM,OUT]=process.argv.slice(2);const W=576,G=0xff80a0a0>>>0,R=0xff4060e0>>>0;const hc=v=>{v>>>=0;return v===G||v===R};
const names=['vec_spr_out','vpr_sout','vpr_ssd','vpr_smx','vop_ow','vtm_hrd','vso_fastall','vpz_pair','vmx_pair','vpr_fs2','vsb_mrow'];
const tot={};let nmiss=0,nbadonly=0;
for(const hy of [8,16])for(const mum of [[60,100],[14,40]])for(const x of [40,100,160,210]){
 let L=null;const ev=[];
 const r=runScene(ROM,SYM,{mode:'run',ticks:250,x,hy,mummy:true,dx0:mum[0],dx1:mum[1],runw:10,pcHook:(pc,f,cyc,E)=>{if(!L){L=E.L;L._m=new Map(names.map(n=>[E.L[n],n]));}const n=L._m.get(pc);if(n)ev.push([f*FR+cyc,n]);}});
 const packs=[];let cur=null;for(const [t,n] of ev){if(n==='vec_spr_out'){cur={t,set:new Set()};packs.push(cur);}else if(cur)cur.set.add(n);}
 const st=r.states;
 for(let i=0;i<r.frames.length;i++){const f=r.frames[i].f;if(f<30)continue;const bmp=r.frames[i].bmp;const t0=f*FR,t1=t0+FR;
  let a=-1;for(let j=0;j<st.length;j++)if(st[j].t<t0)a=j;let b=st.length-1;for(let j=0;j<st.length;j++)if(st[j].t>=t1){b=j;break;}if(a<0)a=0;
  const set=st.slice(a,b+1);const meta=r.meta[i];const Y=meta.y>200?meta.y-256:meta.y;let ms=0;
  for(let y=Math.max(16,Y+46);y<Math.min(272,Y+100);y++)for(let xx=Math.max(0,meta.x-26);xx<Math.min(256,meta.x+30);xx++){const o=y*W+32+2*xx;if(set.every(s=>s.ideal[o]===set[0].ideal[o])&&hc(set[0].ideal[o])&&bmp[o]===0xff000000)ms++;}
  if(ms<20)continue;nmiss++;
  const Tb=t0+(40+Math.max(0,Y+48))*192;
  let p=null;for(const q of packs)if(q.t<=Tb)p=q;
  const k=p?[...p.set].filter(n=>n!=='vec_spr_out').sort().join('+')||'(none)':'?';tot[k]=(tot[k]||0)+1;}
}
require('fs').writeFileSync(OUT,JSON.stringify({miss20_frames:nmiss,paths:tot},null,1));console.log('miss20',nmiss,JSON.stringify(tot));
