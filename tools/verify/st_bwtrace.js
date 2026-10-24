// st_bwtrace.js - замер окна «пара героя стёрта -> показана» против прохода луча и работы BEAMW (ожидания) в кадрах заданного тика сцены.
// Сцена: подъём по лестнице пирамиды 2 (основание Y=40, X=59, клавиши вверх+вправо), мумии прижаты +60/+100 (как st_eval2, режим m1).
// usage: node st_bwtrace.js <rom> <sym> <tick> out.json
'use strict';
const T=__dirname+'/';
const {runScript,FR}=require(T+'st_stand.js');const fs=require('fs');
const [rom,sym,TK,out]=[process.argv[2],process.argv[3],+process.argv[4],process.argv[5]];
const w16=(E,a)=>E.rd(a)|(E.rd(a+1)<<8);
const script=(E,wr,t)=>{const {L,rd}=E;if(t===0){wr(L.ProtaX,59);wr(L.ProtaY,40);wr(L.protaStatus,0);wr(L.ProtaXdecimal,0);}
 const hX=rd(L.ProtaX),hY=rd(L.ProtaY);const room=rd(L.ProtaRoom),xs=[(hX+60)&255,(hX+100)&255];
 for(let m=0;m<2;m++){const p=L.momiaDat+m*22;wr(p,0);wr(p+3,hY);wr(p+5,xs[m]);wr(p+6,room);wr(p+0x14,m?1:4);}
 for(let m=2;m<4;m++){const p=L.momiaDat+m*22;wr(p,4);wr(p+3,0xe0);}
 const pats=[0x28,0x88],cols=[0x0a,0x09];
 for(let m=0;m<2;m++){const b=L.enemyAttrib+m*4;wr(b,hY);wr(b+1,xs[m]);wr(b+2,pats[m]);wr(b+3,cols[m]);const sa=L.sprAttrib+4*(6+m);wr(sa,hY);wr(sa+1,xs[m]);wr(sa+2,pats[m]);wr(sa+3,cols[m]);}
 for(let sl=8;sl<=13;sl++)wr(L.sprAttrib+4*sl,0xe0);
 return [38,39];};
let ev=[];let LL=null;const names=['vec_spr_out','vbw_wait','vbw_poll','vbw_out','vpr_fs2'];
function go(jr){ev=[];LL=null;return runScript(rom,sym,{journal:jr,pyr:2,ticks:TK+2,script,pcHook:(pc,f,cyc,E)=>{if(!LL){LL=E.L;LL._m=new Map(names.map(n=>[E.L[n],n]));}const n=LL._m.get(pc);if(!n)return;
  if(n==='vbw_poll')ev.push({f,t:cyc,e:n,hw:E.rd(E.L.vbw_hw),A:w16(E,E.L.vbw_a),len:w16(E,E.L.vbw_len),c:w16(E,E.L.vbw_c)});else ev.push({f,t:cyc,e:n,np:n==='vbw_out'?E.rd(E.L.vbw_np):undefined});}});}
const r0=go(null);const fr0=r0.meta.filter(m=>m.tick===TK).map(m=>m.f);const r=go([Math.min(...fr0),Math.max(...fr0)]);
// кадры тика TK
const fr=r.meta.filter(m=>m.tick===TK).map(m=>m.f);const res=[];
for(const f of fr){const m=r.meta.find(q=>q.f===f);const h=m.h[0][0]===2?m.h[1]:m.h[0];
  const VS=m.vs;const tb=lo=>(40+((VS-lo)&255))*192-44;const lo0=h[2];
  const jw=r.journal.filter(q=>q[0]===f&&((q[3]>>8)&31)>=h[1]&&((q[3]>>8)&31)<h[1]+h[3]);
  res.push({f,erase_start:jw.length?jw[0][1]:null,show_end:jw.length?jw[jw.length-1][1]:null,hero:{hi0:h[1],lo0:h[2],nc:h[3],y:m.y,x:m.x,st:m.st},beam:[Math.min(tb(lo0),tb(lo0+15)),Math.max(tb(lo0),tb(lo0+15))],events:ev.filter(e=>e.f===f)});}
fs.writeFileSync(out,JSON.stringify({rom,tick:TK,frames:res},null,1));
console.log(JSON.stringify(res.map(q=>({f:q.f,beam:q.beam,n:q.events.length}))));
