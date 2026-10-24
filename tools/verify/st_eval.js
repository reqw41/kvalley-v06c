// st_eval.js - стенд stair-gem: лестница / переход лестница<->площадка / бег мимо основания и верха / подбор гема / ВХОД и ВЫХОД ворот.
// Метрики по кадрам луча в окне героя (и окне гема / ворот): bad_frames, bad_px (пиксель луча, которого нет ни в одном устоявшемся fb
// вокруг кадра), severe (>=40 px), missing20 (>=20 пикселей героя, которые есть во ВСЕХ устоявшихся fb кадра, а луч показал другое),
// missR10 (то же только для красной плоскости героя, >=10 px = «герой серый»), fpt (кадров на игровой тик по сценам со скриптом).
// usage: node st_eval.js <rom> <sym> <out.json>   env: CLS=stairs,pass,ctrl,gem,door  MUM=0,1  ONLY=<подстрока имени сцены>
'use strict';
const T=__dirname+'/';
const {runScript,FR}=require(T+'st_stand.js');const {runDoor}=require(T+'st_door.js');const fs=require('fs');
const [rom,sym,out]=process.argv.slice(2);
const W=576,G=0xff80a0a0>>>0,R=0xff4060e0>>>0;const isG=v=>(v>>>0)===G,isR=v=>(v>>>0)===R;
const CLS=(process.env.CLS||'stairs,pass,ctrl,gem,door').split(',');const MUMS=(process.env.MUM||'0,1').split(',').map(Number);
const PRES=(process.env.PRE||'0,3,7,11').split(',').map(Number);
const names=['vec_spr_out','vso_fastall','vpr_fs2','vbw_wait','vso_fix','vfr_gate'];
// ---------- сцены ----------
const keysRun=(dir)=>[dir<0?37:39];
const scenes=[];
const add=(cls,name,o)=>scenes.push(Object.assign({cls,name},o));
// лестницы: [старт X,Y, ключи по состоянию]
const stairKeys=(k)=>(E,st)=>k;
add('stairs','up_L_72',{x:47,y:72,ticks:46,keys:()=>[38,37]});
add('stairs','up_R_72',{x:192,y:72,ticks:46,keys:()=>[38,39]});
add('stairs','up_L_112',{x:184,y:112,ticks:46,keys:()=>[38,37]});
add('stairs','up_R_112',{x:57,y:112,ticks:46,keys:()=>[38,39]});
add('stairs','down_L_40',{x:4,y:40,ticks:56,keys:(E,s)=>s.seen?[40,39]:(E.rd(E.L.ProtaX)>=18?[40,39]:[39])});
add('stairs','down_R_40',{x:236,y:40,ticks:56,keys:(E,s)=>s.seen?[40,37]:(E.rd(E.L.ProtaX)>224?[37]:[40,37])});
// выход на лестницу бегом с площадки и сход с неё на площадку (в сценах up_* лестница кончается и герой идёт дальше по верху)
add('stairs','run_into_L_72',{x:110,y:72,ticks:54,keys:(E,s)=>s.seen||E.rd(E.L.ProtaX)<=52?[38,37]:[37]});
add('stairs','run_into_R_72',{x:150,y:72,ticks:54,keys:(E,s)=>s.seen||E.rd(E.L.ProtaX)>=188?[38,39]:[39]});
// бег по платформе мимо основания/верха
add('pass','pass_baseL_72',{x:110,y:72,ticks:24,keys:()=>[37]});
add('pass','pass_baseR_72',{x:20,y:72,ticks:24,keys:()=>[39]});
add('pass','pass_baseR2_72',{x:180,y:72,ticks:14,keys:()=>[39]});
add('pass','pass_baseL2_72',{x:216,y:72,ticks:14,keys:()=>[37]});
add('pass','pass_topL_40',{x:62,y:40,ticks:16,keys:()=>[37]});
add('pass','pass_topR_40',{x:4,y:40,ticks:16,keys:()=>[39]});
add('pass','pass_topR2_40',{x:180,y:40,ticks:12,keys:()=>[39]});
add('pass','pass_topL2_40',{x:236,y:40,ticks:12,keys:()=>[37]});
// контроль: ровная платформа Y=72 между лестницами
add('ctrl','ctrl_R_72',{x:62,y:72,ticks:24,keys:()=>[39]});
add('ctrl','ctrl_L_72',{x:182,y:72,ticks:24,keys:()=>[37]});
add('ctrl','ctrl_R_112',{x:150,y:112,ticks:14,keys:()=>[39]});
// гемы: [gx,gy,y героя,старты слева/справа]
const GEMS=[{g:0,gx:24,gy:24,hy:16,xl:2,xr:52},{g:1,gx:224,gy:24,hy:16,xl:196,xr:250},{g:2,gx:16,gy:160,hy:152,xl:9,xr:56},{g:3,gx:208,gy:120,hy:112,xl:166,xr:217}];
for(const q of GEMS)for(const side of (q.g===2?['L']:['L','R']))for(const jump of [0,10,24]){
  const x0=side==='L'?q.xl:q.xr,dir=side==='L'?1:-1;
  add('gem',`gem${q.g}_${side}${jump?'_jump'+jump:''}`,{x:x0,y:q.hy,ticks:30,gem:q,keys:(E,s)=>{const x=E.rd(E.L.ProtaX);const k=[dir>0?39:37];if(jump&&dir*(q.gx-x)<=jump&&!s.jumped)s.jumped=1;if(jump&&s.jumped&&s.jt++<3)k.push(32);return k;}});
}
// ---------- разбор кадров ----------
const acc={};const addAcc=(k,d)=>{const e=acc[k]=acc[k]||{frames:0,bad_frames:0,bad_px:0,severe:0,missing20:0,missR10:0};for(const q in d)e[q]+=d[q];};
const rowsLo=y=>Math.max(16,y+44),rowsHi=y=>Math.min(272,y+100);
function evalRun(r,hooks,opt){
  const st=r.states;const res=[];
  // пути пачек
  const packs=[];{let cur=null;for(const [t,n] of hooks.evs){if(n==='vec_spr_out'){cur={t,set:new Set()};packs.push(cur);}else if(cur)cur.set.add(n);}}
  for(let i=0;i<r.frames.length;i++){const m=r.meta[i];const f=m.f;if(opt.skip&&opt.skip(m,i))continue;
    const bmp=r.frames[i].bmp,t0=f*FR,t1=t0+FR;let a=-1;for(let j=0;j<st.length;j++)if(st[j].t<t0)a=j;let b=st.length-1;for(let j=0;j<st.length;j++)if(st[j].t>=t1){b=j;break;}if(a<0)a=0;
    const set=st.slice(a,b+1).map(s=>s.ideal);const Y=m.y>200?m.y-256:m.y;
    const rects={hero:[32+2*Math.max(0,m.x-26),32+2*Math.min(255,m.x+30),rowsLo(Y),rowsHi(Y)]};
    if(opt.rects)for(const k in opt.rects){const q=opt.rects[k](m,i);if(q)rects[k]=q;}
    const Tb=t0+(40+Math.max(0,Y+48))*192;let pk=null;for(const q of packs)if(q.t<=Tb)pk=q;const path=!pk?'?':pk.set.has('vso_fastall')?(pk.set.has('vpr_fs2')?'fastfs2':'fastmxp'):'slow';
    const o={path,f,y:m.y,gs:m.gs,x:m.x,tick:m.tick};
    for(const k in rects){const [x0,x1,y0,y1]=rects[k];let bad=0,miss=0,missR=0,bx0=1e9,bx1=-1,by0=1e9,by1=-1;
      for(let y=y0;y<y1;y++){const ro=y*W;for(let x=x0;x<x1;x++){if(k==='hero'&&opt.mask&&x>=opt.mask[0]&&x<opt.mask[1]&&y>=opt.mask[2]&&y<opt.mask[3])continue;const v=bmp[ro+x];let ok=false;for(const s of set)if(s[ro+x]===v){ok=true;break;}
        if(!ok){bad++;if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y;}
        if(k==='hero'){const v0=set[0][ro+x];if(v!==v0&&(isG(v0)||isR(v0))){let same=true;for(const s of set)if(s[ro+x]!==v0){same=false;break;}if(same){miss++;if(isR(v0))missR++;}}}}}
      o[k]={bad,miss,missR,bb:[bx0,bx1,by0,by1]};}
    res.push(o);}
  return res;
}
function fold(res,key,k){for(const o of res){const h=o[k];if(!h)continue;const d={frames:1,bad_frames:h.bad?1:0,bad_px:h.bad,severe:h.bad>=40?1:0,missing20:h.miss>=20?1:0,missR10:h.missR>=10?1:0};addAcc(key,d);}}
const perScene={};let totFr=0,totTk=0;
function runAll(){
for(const sc of scenes){
  if(!CLS.includes(sc.cls)||(process.env.ONLY&&!sc.name.includes(process.env.ONLY)))continue;
  for(const mum of MUMS)for(const pre of PRES){
    const evs=[];let LL=null;const s={seen:0,jumped:0,jt:0};
    const script=(E,wr,tick)=>{const {L,rd}=E;
      if(tick===0){wr(L.ProtaX,sc.x);wr(L.ProtaY,sc.y);wr(L.protaStatus,0);wr(L.ProtaXdecimal,0);}
      if(rd(L.protaStatus)===3)s.seen=1;
      const hX=rd(L.ProtaX),hY=rd(L.ProtaY);
      if(mum===2){}else if(!mum){for(let m=0;m<4;m++){wr(L.momiaDat+m*22,4);wr(L.momiaDat+m*22+3,224);}for(let sl=6;sl<=13;sl++)wr(L.sprAttrib+4*sl,224);}
      else{const room=rd(L.ProtaRoom),xs=[(hX+60)&255,(hX+100)&255];
        for(let m=0;m<2;m++){const p=L.momiaDat+m*22;wr(p,0);wr(p+3,hY);wr(p+5,xs[m]);wr(p+6,room);wr(p+0x14,m?1:4);}
        for(let m=2;m<4;m++){const p=L.momiaDat+m*22;wr(p,4);wr(p+3,0xe0);}
        const pats=[0x28,0x88],cols=[0x0a,0x09];
        for(let m=0;m<2;m++){const b=L.enemyAttrib+m*4;wr(b,hY);wr(b+1,xs[m]);wr(b+2,pats[m]);wr(b+3,cols[m]);const sa=L.sprAttrib+4*(6+m);wr(sa,hY);wr(sa+1,xs[m]);wr(sa+2,pats[m]);wr(sa+3,cols[m]);}
        for(let sl=8;sl<=13;sl++)wr(L.sprAttrib+4*sl,0xe0);}
      return sc.keys(E,s);};
    const TR=process.env.TRACE?process.env.TRACE.split('-').map(Number):null;const r=runScript(rom,sym,{ticks:sc.ticks,pre,script,journal:TR,pcHook:(pc,f,cyc,E)=>{if(!LL){LL=E.L;LL._m=new Map(names.map(n=>[E.L[n],n]));}const n=LL._m.get(pc);if(n)evs.push([f*FR+cyc,n]);}});
    if(TR){const {summarize}=require(T+'st_trace_lib.js');const ev2=evs.filter(e=>Math.floor(e[0]/FR)>=TR[0]&&Math.floor(e[0]/FR)<=TR[1]).map(e=>[e[0]%FR,e[1],Math.floor(e[0]/FR)]);console.log(summarize(r.journal,r.E.L,ev2).join('\n'));}
    const tk=r.meta.length?(r.meta[r.meta.length-1].tick-r.meta[0].tick):1;
    const opt={skip:(m)=>m.f<3};const rects={};
    let pickTick=-1;
    if(sc.gem){const q=sc.gem;for(const m of r.meta)if(m.gem[q.g]!==1&&pickTick<0){pickTick=m.tick;}
      rects.gem=(m)=>(pickTick>=0&&m.tick>=pickTick-1&&m.tick<=pickTick+10)?[32+2*(q.gx-12),32+2*(q.gx+24),q.gy+52,q.gy+84]:null;}
    opt.rects=rects;if(sc.gem){const q=sc.gem;opt.mask=[32+2*(q.gx-12),32+2*(q.gx+24),q.gy+52,q.gy+84];}
    const res=evalRun(r,{evs},opt);
    const tag=`${sc.name}/m${mum}/p${pre}`;
    perScene[tag]={frames:res.length,fr_all:r.meta.length,ticks:tk,picked:pickTick,bad_frames:res.filter(o=>o.hero.bad).length,bad_px:res.reduce((p,o)=>p+o.hero.bad,0),missing20:res.filter(o=>o.hero.miss>=20).length,severe:res.filter(o=>o.hero.bad>=40).length,missR10:res.filter(o=>o.hero.missR>=10).length,
      badlist:res.filter(o=>o.hero.bad).map(o=>[o.f,o.tick,o.x,o.y,o.path,o.hero.bad,o.hero.miss,o.hero.bb.join(':')]),gem_bad_px:sc.gem?res.reduce((p,o)=>p+(o.gem?o.gem.bad:0),0):undefined,gem_frames:sc.gem?res.filter(o=>o.gem).length:undefined};
    for(const key of ['cls:'+sc.cls,'cls:'+sc.cls+'/m'+mum,'all'])fold(res,key,'hero');
    if(sc.gem)fold(res,'gemwin/m'+mum,'gem');
    for(const o of res){addAcc('path:'+o.path+'/cls:'+sc.cls,{frames:1,bad_frames:o.hero.bad?1:0,bad_px:o.hero.bad,severe:o.hero.bad>=40?1:0,missing20:o.hero.miss>=20?1:0,missR10:o.hero.missR>=10?1:0});}
    totFr+=r.meta.length;totTk+=tk;addAcc('fptsrc/cls:'+sc.cls,{frames:r.meta.length,bad_frames:0,bad_px:0,severe:0,missing20:0,missR10:tk});
    process.stderr.write(tag+' '+JSON.stringify(perScene[tag])+'\n');
  }}
}
function runDoors(){
  const GATE=(m)=>[32+2*104,32+2*152,72+40,72+104];
  for(const pre of PRES)for(const kind of ['entry','exit']){
    const evs=[];const r=runDoor(rom,sym,kind,{pre,frames:kind==='entry'?330:260,names:['vec_spr_out','vso_fastall','vpr_fs2','vbw_wait']});
    // runDoor пишет события в r.evs
    const res=evalRun(r,{evs:r.evs.filter(e=>e[1]!=='vso_fix')},{skip:(m)=>m.f<60&&kind==='entry'&&m.y===0,rects:{gate:GATE}});
    // герой виден только когда y>0
    const hres=res.filter(o=>o.y>0||kind==='exit');
    perScene['door_'+kind+'/p'+pre]={frames:res.length,hero_bad_frames:hres.filter(o=>o.hero.bad).length,hero_bad_px:hres.reduce((p,o)=>p+o.hero.bad,0),hero_missing20:hres.filter(o=>o.hero.miss>=20).length,hero_missR10:hres.filter(o=>o.hero.missR>=10).length,gate_bad_frames:res.filter(o=>o.gate.bad).length,gate_bad_px:res.reduce((p,o)=>p+o.gate.bad,0),
      series:res.map(o=>[o.f,o.gs,o.y,o.hero.bad,o.hero.miss,o.hero.missR,o.gate.bad,o.path,o.hero.bb.join(':'),o.gate.bb.join(':')])};
    fold(hres,'door:'+kind,'hero');fold(res,'doorgate:'+kind,'gate');
    process.stderr.write('door_'+kind+'/p'+pre+' '+JSON.stringify(Object.assign({},perScene['door_'+kind+'/p'+pre],{series:undefined}))+'\n');
  }
}
runAll();if(CLS.includes('door'))runDoors();
const o={rom,fpt:totTk?+(totFr/totTk).toFixed(3):0,acc,scenes:perScene};fs.writeFileSync(out,JSON.stringify(o,null,1));
console.log(rom,'fpt',o.fpt);for(const k of Object.keys(acc).sort())console.log(k.padEnd(34),JSON.stringify(acc[k]));
