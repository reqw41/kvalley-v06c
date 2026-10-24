// st_knife_trace.js - первый кадр «герой пропал» (не показано >= половины пикселей героя) в сцене броска ножа с мумиями далеко:
// окно «пара стёрта -> показана» по записям в колонки героя, проход луча по строкам героя, порядок групп записей по колонкам.
// usage: node st_knife_trace.js <rom> <sym> out.json   (пирамида 1, Y=152, X=60, бросок влево, мумии +60/+100 прижаты)
'use strict';
process.env.HERO_OWN='1';
const T=__dirname+'/';const {runScript,FR}=require(T+'st_stand.js');const {evalRun}=require(T+'st_lib.js');const fs=require('fs');
const [rom,sym,out]=process.argv.slice(2);
const script=(E,wr,t)=>{const {L,rd}=E;if(t===0){wr(L.ProtaX,60);wr(L.ProtaY,152);wr(L.protaStatus,0);wr(L.ProtaXdecimal,0);}
 if(rd(L.knifesData)<=2){wr(L.objetoCogido,0x10);wr(L.IDcuchilloCoge,0);}
 const hX=rd(L.ProtaX),hY=rd(L.ProtaY);const room=rd(L.ProtaRoom),xs=[(hX+60)&255,(hX+100)&255];
 for(let m=0;m<2;m++){const p=L.momiaDat+m*22;wr(p,0);wr(p+3,hY);wr(p+5,xs[m]);wr(p+6,room);wr(p+0x14,m?1:4);}
 for(let m=2;m<4;m++){const p=L.momiaDat+m*22;wr(p,4);wr(p+3,0xe0);}
 const pats=[0x28,0x88],cols=[0x0a,0x09];
 for(let m=0;m<2;m++){const b=L.enemyAttrib+m*4;wr(b,hY);wr(b+1,xs[m]);wr(b+2,pats[m]);wr(b+3,cols[m]);const sa=L.sprAttrib+4*(6+m);wr(sa,hY);wr(sa+1,xs[m]);wr(sa+2,pats[m]);wr(sa+3,cols[m]);}
 for(let sl=8;sl<=13;sl++)wr(L.sprAttrib+4*sl,0xe0);
 const k=[];if(t%24===2)k.push(32);if(t%24>=8&&t%24<12)k.push(37);return k;};
function go(jr){const evs=[];let LL=null;const names=['vec_spr_out','vso_fastall','vpr_fs2','vbw_wait'];
 const r=runScript(rom,sym,{journal:jr,pyr:1,ticks:130,script,pcHook:(pc,f,cyc,E)=>{if(!LL){LL=E.L;LL._m=new Map(names.map(n=>[E.L[n],n]));}const n=LL._m.get(pc);if(n)evs.push([f*FR+cyc,n]);}});return {r,evs};}
const a=go(null);const res=evalRun(a.r,a.evs,8);let g=null,b=null,m=null,h=null,hw=null;
for(const c of res.filter(o=>o.hp>=40&&o.miss>=0.5*o.hp).slice(0,12)){b=go([c.f,c.f]);m=b.r.meta.find(q=>q.f===c.f);h=m.h[0][0]===2?m.h[1]:m.h[0];
  const L0=b.r.E.L;const lb=Object.entries(L0).filter(([k,v])=>v>=0x100&&v<0xE000).sort((x,y)=>x[1]-y[1]);const lb1=pc=>{let lo=0,hi=lb.length-1;while(lo<hi){const mm=(lo+hi+1)>>1;if(lb[mm][1]<=pc)lo=mm;else hi=mm-1;}return lb[lo][0];};
  hw=b.r.journal.filter(q=>((q[3]>>8)&31)>=h[1]&&((q[3]>>8)&31)<h[1]+h[3]&&!/^vbt|^vfn/.test(lb1(q[2])));if(hw.length){g=c;break;}}
if(!g){console.log('нет кадра');process.exit(1);}
const labs=Object.entries(b.r.E.L).filter(([k,v])=>v>=0x100&&v<0xE000).sort((x,y)=>x[1]-y[1]);const lab=pc=>{let lo=0,hi=labs.length-1;while(lo<hi){const mm=(lo+hi+1)>>1;if(labs[mm][1]<=pc)lo=mm;else hi=mm-1;}return labs[lo][0];};
const G={};for(const [f,c,pc,ad] of b.r.journal){const col=(ad>>8)&31;if(/^vbt|^vfn/.test(lab(pc)))continue;const k='col'+col;const q=G[k]=G[k]||{col,t0:1e9,t1:0,lo0:255,lo1:0,n:0};q.t0=Math.min(q.t0,c);q.t1=Math.max(q.t1,c);q.lo0=Math.min(q.lo0,ad&255);q.lo1=Math.max(q.lo1,ad&255);q.n++;}
const VS=m.vs;const tb=lo=>(40+((VS-lo)&255))*192-44;
const hero=Object.values(G).filter(q=>q.col>=h[1]&&q.col<h[1]+h[3]);
const o={frame:g.f,tick:g.tick,hero_rect:{hi0:h[1],lo0:h[2],nc:h[3],y:m.y,x:m.x,st:m.st},missing:g.miss,hero_px:g.hp,
 hero_erase_start:Math.min(...hero.map(q=>q.t0)),hero_show_end:Math.max(...hero.map(q=>q.t1)),beam:[Math.min(tb(h[2]),tb(h[2]+15)),Math.max(tb(h[2]),tb(h[2]+15))],
 groups:Object.values(G).sort((x,y)=>x.t0-y.t0),waits:b.evs.filter(e=>Math.floor(e[0]/FR)===g.f).map(e=>[e[0]%FR,e[1]])};
fs.writeFileSync(out,JSON.stringify(o,null,1));console.log(JSON.stringify({f:o.frame,erase:o.hero_erase_start,show_end:o.hero_show_end,beam:o.beam,groups:o.groups.map(q=>[q.col,q.t0,q.t1])}));
