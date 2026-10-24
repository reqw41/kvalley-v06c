// gt2_eval.js - задача apex-fast, раунд 2: «зелёный хвост» — герой бежит по середине экрана, мумия (слот 6, ведётся стендом) идёт
// НАВСТРЕЧУ (front), ДОГОНЯЕТ сзади (back), СЛЕДУЕТ вплотную сзади (trail) или ВПЕРЕДИ (lead). Лучевые кадры (hf_stand.analyze).
// Метрики на кадр: bad (пиксель луча не из устоявшихся состояний), mum (из них цвета мумии MUMCOL), behind (в полосе за героем
// по ходу), hero_foreign (цвет, которого нет в устоявшихся состояниях окна героя).
// usage: node gt2_eval.js <rom> <sym> <out.json> [ticks]   env: HY=72,112 COL=<msx цвет мумии, 2 по умолчанию> SCH=front,back,trail,lead
const T=__dirname+'/';const {runScene,analyze,FR}=require(T+'hf_stand.js');const fs=require('fs');
const [rom,sym,out,ticks]=[process.argv[2],process.argv[3],process.argv[4],+process.argv[5]||240];
const W=576;const HYS=(process.env.HY||'72,112').split(',').map(Number);const COL=+(process.env.COL||2);const SCHS=(process.env.SCH||'front,back,trail,lead').split(',');
const G=0xff80a0a0>>>0,R=0xff4060e0>>>0;const isMum=c=>{const r=c&255,g=(c>>>8)&255,b=(c>>>16)&255;return g>=0x80&&g>r+0x40&&g>b+0x40;};
const acc={};const add=(k,d)=>{const e=acc[k]=acc[k]||{frames:0,bad_frames:0,bad_px:0,mum_frames:0,mum_px:0,behind_frames:0,behind_px:0,foreign_frames:0,foreign_px:0};for(const q in d)e[q]+=d[q];};
const offs={front:t=>60-3*t,back:t=>-(60-3*t),trail:t=>-22,lead:t=>22};
let totFr=0,totTk=0;const dump=[];
for(const hy of HYS)for(const sch of SCHS)for(const dir of [-1,1])for(const x0 of (process.env.X0||'80,120').split(',').map(Number)){
 const place=(E,wr,t)=>{const {L,rd}=E;if(t===0)wr(L.updateMomiaAtr,0xC9);
  const MA=L.sprAttrib+4*6;const hx=rd(L.ProtaX);const tp=t%40;const mx=(hx+dir*offs[sch](tp))&255;
  wr(MA,hy-1);wr(MA+1,mx);wr(MA+2,236);wr(MA+3,COL);
  for(const m of [7,8,9,10,11,12,13])wr(L.sprAttrib+4*m,0xe0);
  for(let m=0;m<4;m++){wr(L.momiaDat+m*22,4);wr(L.momiaDat+m*22+3,224);}};
 const names=['vec_spr_out','vso_fastall','vpr_fs2','vbw_wait'];const ev=[];let LL=null;
 const r=runScene(rom,sym,{pcHook:(pc,f,cyc,E)=>{if(!LL){LL=E.L;LL._m=new Map(names.map(n=>[E.L[n],n]));}const n=LL._m.get(pc);if(n)ev.push([f*FR+cyc,n]);},mode:'run',ticks,x:x0,hy,runw:+(process.env.RUNW||50),placeFn:place,keys:t=>[dir<0?37:39]});
 const packs=[];{let cur=null;for(const [t,n] of ev){if(n==='vec_spr_out'){cur={t,set:new Set()};packs.push(cur);}else if(cur)cur.set.add(n);}}
 const a=analyze(r);const st=r.states;const dlast=dir;
 for(let i=0;i<r.frames.length;i++){const A=a[i];if(A.f<30)continue;
  const f=A.f,bmp=r.frames[i].bmp,t0=f*FR,t1=t0+FR;let aa=-1;for(let j=0;j<st.length;j++)if(st[j].t<t0)aa=j;let b=st.length-1;for(let j=0;j<st.length;j++)if(st[j].t>=t1){b=j;break;}if(aa<0)aa=0;
  const set=st.slice(aa,b+1);const m=r.meta[i];
  const hx0=32+2*Math.max(0,m.x-26),hx1=32+2*Math.min(255,m.x+30);
  const behind=dlast>0?[32+2*(m.x-40),32+2*(m.x+2)]:[32+2*(m.x-2),32+2*(m.x+40)];
  const ok=new Set();for(const s of set)for(let y=16;y<272;y++){const o=y*W;for(let xx=hx0;xx<hx1;xx++)ok.add(s.ideal[o+xx]);}
  const Tb=t0+(40+Math.max(0,m.y>200?0:m.y+48))*192;let pk=null;for(const q of packs)if(q.t<=Tb)pk=q;const path=!pk?'?':pk.set.has('vso_fastall')?(pk.set.has('vpr_fs2')?'fastfs2':'fastmxp'):'slow';
  let nb=0,nf=0,nm=0;for(const o of A.bad){const x=o%W,c=bmp[o];if(x>=behind[0]&&x<behind[1])nb++;if(x>=hx0&&x<hx1&&!ok.has(c))nf++;if(isMum(c))nm++;}
  if(process.env.DUMP&&nf>=+process.env.DUMP)dump.push({path,hy,sch,dir,x0,f,foreign:nf,mum:nm,bad:A.bad.length,x:m.x});
  const d={frames:1,bad_frames:A.bad.length?1:0,bad_px:A.bad.length,mum_frames:nm?1:0,mum_px:nm,behind_frames:nb?1:0,behind_px:nb,foreign_frames:nf?1:0,foreign_px:nf};
  add('all',d);add('path:'+path,d);add('sch:'+sch,d);add('hy:'+hy,d);add('dir:'+(dir>0?'R':'L'),d);add('sch:'+sch+'/dir:'+(dir>0?'R':'L'),d);}
 totFr+=r.meta.length;totTk+=r.meta.length?(r.meta[r.meta.length-1].tick-r.meta[0].tick):1;}
if(process.env.DUMP)fs.writeFileSync(out.replace(/\.json$/,'_dump.json'),JSON.stringify(dump));
const o={fpt:+(totFr/totTk).toFixed(3),acc};fs.writeFileSync(out,JSON.stringify(o,null,1));
console.log(rom,'fpt',o.fpt);for(const k of Object.keys(acc).sort())if(!/\/dir/.test(k))console.log(k.padEnd(12),JSON.stringify(acc[k]));
