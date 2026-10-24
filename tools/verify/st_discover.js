// st_discover.js - строит st_stairs.json: основания лестниц (кандидаты из скана ключей вверх у основания), проверка подъёмом на прибытие.
// usage: node st_discover.js <rom> <sym> cand.json out.json   (cand: [{pyr,y,key,xs:[..]}])
'use strict';
const {runScript}=require('./st_stand.js');const fs=require('fs');
const [rom,sym,cf,of]=process.argv.slice(2);const cand=JSON.parse(fs.readFileSync(cf,'utf8'));const outl=[];
for(const c of cand){const dir=c.key==='UL'?-1:1;const X=c.xs[Math.floor(c.xs.length/2)];
  const traj=[];const r=runScript(rom,sym,{pyr:c.pyr,ticks:60,script:(E,wr,t)=>{const {L}=E;if(t===0){wr(L.ProtaX,X);wr(L.ProtaY,c.y);wr(L.protaStatus,0);wr(L.ProtaXdecimal,0);for(let m=0;m<4;m++){wr(L.momiaDat+m*22,4);wr(L.momiaDat+m*22+3,224);}}return [38,dir<0?37:39];}});
  let last=-1,arr=null,seen=0,tick=-1;const ys=[];for(const m of r.meta){if(m.tick===tick)continue;tick=m.tick;ys.push([m.y,m.x,m.st]);}
  let top=null;for(let i=0;i<ys.length;i++){if(ys[i][2]===3)seen=1;if(seen&&ys[i][2]===0&&!top){top={y:ys[i][0],x:ys[i][1],tick:i};}}
  const ok=top&&top.y<=c.y-16&&ys.slice(0,4).every(a=>a[0]<=c.y);
  console.log(JSON.stringify(c),ok?'OK top '+JSON.stringify(top):'нет: '+JSON.stringify(ys.slice(0,6)));
  if(ok)outl.push({pyr:c.pyr,y:c.y,key:c.key,dir,xs:c.xs,ty:top.y,tx:top.x,ticks:Math.min(70,top.tick+14),offs:[3,4,5,6,7]});}
fs.writeFileSync(of,JSON.stringify(outl,null,1));
