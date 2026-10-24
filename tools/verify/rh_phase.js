// rh_phase.js - задача apex-fast: та же матрица, что rh_eval.js, но метрики разделены по ФАЗЕ героя и ПУТИ пачки.
// Фаза (ProtaY и protaStatus кадра): apex = Y<0 (lo0=239-Y>=240, путь vsb_mcol); jtop = прыжок/падение (status!=0) при 0<=Y<8 (у верха, рядом с апексом); run = status 0 (бег/стоит); other = прыжок/падение ниже.
// Путь (по меткам PC пачки, накрывающей момент прохода луча по верху героя, как rh_paths.js):
//   fastfs2 = vso_fastall + vpr_fs2 (слитая пачка, пара старым путём, BEAMW не звался); fastmxp = vso_fastall без vpr_fs2;
//   slow = без vso_fastall; ? = пачка не найдена.
// env: HY=8,16 MODES=run XS=20,40,.. DUMP=<path> сужают матрицу / печатают список кадров пути.
// usage: node rh_phase.js <rom> <sym> <out.json> [ticks]
const T=__dirname+'/';
const {runScene,analyze,FR}=require(T+'hf_stand.js');const fs=require('fs');
const [rom,sym,out,ticks]=[process.argv[2],process.argv[3],process.argv[4],+process.argv[5]||250];
const W=576,G=0xff80a0a0>>>0,R=0xff4060e0>>>0;const hc=v=>{v>>>=0;return v===G||v===R};
const names=['vec_spr_out','vso_fastall','vpr_fs2','vpr_s2x','vbw_all'];
const acc={};const add=(k,d)=>{const e=acc[k]=acc[k]||{frames:0,bad_frames:0,bad_px:0,severe_frames:0,missing20_frames:0};for(const q in d)e[q]+=d[q];};
let totFr=0,totTk=0;
const HYS=process.env.HY?process.env.HY.split(',').map(Number):[8,16,24];const dump=[];
const MODES=process.env.MODES?process.env.MODES.split(','):['run','jump'];const XS=process.env.XS?process.env.XS.split(',').map(Number):[40,100,160,210];
for(const hy of HYS)for(const mode of MODES)for(const mum of [[-1,0],[60,100],[14,40]])for(const x of XS){
 let L=null;const ev=[];
 const r=runScene(rom,sym,{mode,ticks,x,hy,mummy:mum[0]>=0,dx0:mum[0],dx1:mum[1],runw:10,pcHook:(pc,f,cyc,E)=>{if(!L){L=E.L;L._m=new Map(names.map(n=>[E.L[n],n]));}const n=L._m.get(pc);if(n)ev.push([f*FR+cyc,n]);}});
 const packs=[];let cur=null;for(const [t,n] of ev){if(n==='vec_spr_out'){cur={t,set:new Set()};packs.push(cur);}else if(cur)cur.set.add(n);}
 const a=analyze(r);const st=r.states;
 for(let i=0;i<r.frames.length;i++){const A=a[i];if(A.f<30)continue;
  const f=A.f,bmp=r.frames[i].bmp,t0=f*FR,t1=t0+FR;let aa=-1;for(let j=0;j<st.length;j++)if(st[j].t<t0)aa=j;let b=st.length-1;for(let j=0;j<st.length;j++)if(st[j].t>=t1){b=j;break;}if(aa<0)aa=0;
  const set=st.slice(aa,b+1);const meta=r.meta[i];const Y=meta.y>200?meta.y-256:meta.y;let ms=0;
  for(let y=Math.max(16,Y+46);y<Math.min(272,Y+100);y++)for(let xx=Math.max(0,meta.x-26);xx<Math.min(256,meta.x+30);xx++){const o=y*W+32+2*xx;if(set.every(s=>s.ideal[o]===set[0].ideal[o])&&hc(set[0].ideal[o])&&bmp[o]===0xff000000)ms++;}
  const Tb=t0+(40+Math.max(0,Y+48))*192;let p=null;for(const q of packs)if(q.t<=Tb)p=q;
  const path=!p?'?':p.set.has('vso_fastall')?(p.set.has('vpr_fs2')?'fastfs2':'fastmxp'):'slow';
  const phase=Y<0?'apex':meta.st===0?'run':Y<8?'jtop':'other';
  const d={frames:1,bad_frames:A.bad.length?1:0,bad_px:A.bad.length,severe_frames:A.bad.length>=40?1:0,missing20_frames:ms>=20?1:0};
  if(process.env.DUMP&&path===process.env.DUMP&&ms>=20)dump.push({hy,mode,mum:mum.join('/'),x,f,Y,st:meta.st,ms,bad:A.bad.length});
  add('all',d);add('phase:'+phase,d);add('path:'+path,d);add('phase:'+phase+'/path:'+path,d);add('mum:'+mum.join('/'),d);}
 const tk=r.meta.length?(r.meta[r.meta.length-1].tick-r.meta[0].tick):1;totFr+=r.meta.length;totTk+=tk;
}
if(process.env.DUMP)console.log(JSON.stringify(dump));
const o={fpt:+(totFr/totTk).toFixed(3),acc};fs.writeFileSync(out,JSON.stringify(o,null,1));
console.log(rom,'fpt',o.fpt);for(const k of Object.keys(acc).sort())console.log(k.padEnd(28),JSON.stringify(acc[k]));
