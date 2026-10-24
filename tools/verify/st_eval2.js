// st_eval2.js - раунд 2 stair-gem: ВЕРХ лестницы (последние ступени, первый шаг на площадку, спуск с площадки; пирамиды 1 и 2, с ножом в руках и без)
// и БРОСОК НОЖА (пирамиды 1 и 2, места/направления/мумии). Окно героя — по записи вывода слотов 4/5 (HERO_OWN=1), а не по X героя: нож и мумия
// в окно не попадают. Метрики на кадр: bad (пиксель луча не из устоявшихся fb), miss (пиксели героя, общие для ВСЕХ устоявшихся fb, а луч показал иначе),
// gone (miss >= половины пикселей героя), gray (красных пикселей героя нет, серые есть: missR >= 0.6*hpR при hpR>=10 и серых >= 10), severe (bad>=40).
// usage: node st_eval2.js <rom> <sym> <out.json>   env: CLS=top,knife,ctrl MUM=0,1,2 PRE=0,5 ONLY=<подстрока>  TRACE=f0-f1 (с ONLY: журнал записей)
'use strict';
process.env.HERO_OWN='1';
const T=__dirname+'/';
const {runScript,FR}=require(T+'st_stand.js');const {evalRun}=require(T+'st_lib.js');const fs=require('fs');
const [rom,sym,out]=process.argv.slice(2);
const CLS=(process.env.CLS||'top,knife,ctrl').split(',');const MUMS=(process.env.MUM||'0,1,2').split(',').map(Number);const PRES=(process.env.PRE||'0,5').split(',').map(Number);
const names=['vec_spr_out','vso_fastall','vpr_fs2','vbw_wait','vso_fix','vfr_gate'];
const scenes=[];const add=(cls,name,o)=>scenes.push(Object.assign({cls,name},o));
// ---- подъёмы: [пирамида, Y основания, ключ, X ...] из скана (scan2.js); проверяются прогоном на прибытие (arrive) ----
const UP=JSON.parse(fs.readFileSync(T+'st_stairs.json','utf8'));
for(const u of UP)for(const carry of [0,1]){
  // подъём: старт в основании (X по диапазону), держим [вверх, dir], после прибытия на площадку идём дальше
  for(const X of u.xs)add('top',`up_p${u.pyr}_y${u.y}_${u.key}_x${X}${carry?'_knife':''}`,{pyr:u.pyr,x:X,y:u.y,ticks:u.ticks,carry,keys:()=>[38,u.dir<0?37:39]});
  // спуск: старт на площадке, идём к верху лестницы и жмём вниз + (противоположное направление подъёма) на offs пикселей
  for(const off of u.offs)add('top',`down_p${u.pyr}_y${u.ty}_${u.key}_o${off}${carry?'_knife':''}`,{pyr:u.pyr,x:u.tx+u.dir*10,y:u.ty,ticks:u.ticks,carry,
    keys:(E,s)=>{const x=E.rd(E.L.ProtaX);if(E.rd(E.L.protaStatus)===3)s.seen=1;const stepDir=-u.dir;return (s.seen||(x-u.tx)*stepDir>=off)?[40,stepDir<0?37:39]:[stepDir<0?37:39];}});
}
// ---- бросок ножа ----
for(const pyr of [1,2])for(const [y,xs] of [[72,[40,100,160]],[112,[60,120,180]],[152,[60,120,200]]])for(const x of xs)for(const dir of [-1,1])
  add('knife',`knife_p${pyr}_y${y}_x${x}_${dir<0?'L':'R'}`,{pyr,x,y,ticks:120,carry:1,throw:1,keys:(E,s,t)=>{const k=[];if(t%24===2)k.push(32);if(t%24>=8&&t%24<12)k.push(dir<0?37:39);return k;}});
// ---- контроль: ровная платформа, без ножа ----
add('ctrl','ctrl_p1_y72_R',{pyr:1,x:62,y:72,ticks:24,keys:()=>[39]});add('ctrl','ctrl_p1_y72_L',{pyr:1,x:182,y:72,ticks:24,keys:()=>[37]});
add('ctrl','ctrl_p2_y72_R',{pyr:2,x:80,y:72,ticks:24,keys:()=>[39]});add('ctrl','ctrl_p2_y72_L',{pyr:2,x:150,y:72,ticks:24,keys:()=>[37]});
const acc={};const perScene={};
function runOne(sc,mum,pre){
  const evs=[];let LL=null;const s={seen:0};
  const script=(E,wr,tick)=>{const {L,rd}=E;
    if(tick===0){wr(L.ProtaX,sc.x);wr(L.ProtaY,sc.y);wr(L.protaStatus,0);wr(L.ProtaXdecimal,0);}
    if(sc.carry&&rd(L.knifesData)<=2){wr(L.objetoCogido,0x10);wr(L.IDcuchilloCoge,0);}
    const hX=rd(L.ProtaX),hY=rd(L.ProtaY);
    if(mum===2){}else if(!mum){for(let m=0;m<4;m++){wr(L.momiaDat+m*22,4);wr(L.momiaDat+m*22+3,224);}for(let sl=6;sl<=13;sl++)wr(L.sprAttrib+4*sl,224);}
    else{const room=rd(L.ProtaRoom),xs=[(hX+60)&255,(hX+100)&255];
      for(let m=0;m<2;m++){const p=L.momiaDat+m*22;wr(p,0);wr(p+3,hY);wr(p+5,xs[m]);wr(p+6,room);wr(p+0x14,m?1:4);}
      for(let m=2;m<4;m++){const p=L.momiaDat+m*22;wr(p,4);wr(p+3,0xe0);}
      const pats=[0x28,0x88],cols=[0x0a,0x09];
      for(let m=0;m<2;m++){const b=L.enemyAttrib+m*4;wr(b,hY);wr(b+1,xs[m]);wr(b+2,pats[m]);wr(b+3,cols[m]);const sa=L.sprAttrib+4*(6+m);wr(sa,hY);wr(sa+1,xs[m]);wr(sa+2,pats[m]);wr(sa+3,cols[m]);}
      for(let sl=8;sl<=13;sl++)wr(L.sprAttrib+4*sl,0xe0);}
    return sc.keys(E,s,tick);};
  const TR=process.env.TRACE?process.env.TRACE.split('-').map(Number):null;
  const r=runScript(rom,sym,{pyr:sc.pyr,ticks:sc.ticks,pre,script,journal:TR,pcHook:(pc,f,cyc,E)=>{if(!LL){LL=E.L;LL._m=new Map(names.map(n=>[E.L[n],n]));}const n=LL._m.get(pc);if(n)evs.push([f*FR+cyc,n]);}});
  if(TR){const {summarize}=require(T+'st_trace_lib.js');const ev2=evs.filter(e=>Math.floor(e[0]/FR)>=TR[0]&&Math.floor(e[0]/FR)<=TR[1]).map(e=>[e[0]%FR,e[1],Math.floor(e[0]/FR)]);console.log(summarize(r.journal,r.E.L,ev2).join('\n'));}
  const res=evalRun(r,evs,8);const tk=r.meta.length?(r.meta[r.meta.length-1].tick-r.meta[0].tick):1;
  const ys=r.meta.map(m=>m.y);
  return {res,fr_all:r.meta.length,ticks:tk,ymin:Math.min(...ys),yend:ys[ys.length-1],xend:r.meta[r.meta.length-1].x};}
const fr2=o=>({gone:o.hp>=40&&o.miss>=0.5*o.hp?1:0,gray:(o.hpR>=10&&o.missR>=0.6*o.hpR&&(o.hp-o.hpR)>=10&&o.missG<0.5*(o.hp-o.hpR))?1:0});
const SH=(process.env.SHARD||'0/1').split('/').map(Number);let si=-1;
for(const sc of scenes){si++;if(si%SH[1]!==SH[0])continue;if(!CLS.includes(sc.cls)||(process.env.ONLY&&!sc.name.includes(process.env.ONLY)))continue;
  for(const mum of MUMS)for(const pre of PRES){const q=runOne(sc,mum,pre);const tag=`${sc.name}/m${mum}/p${pre}`;
    const bl=q.res.filter(o=>o.bad||o.miss);
    perScene[tag]={pyr:sc.pyr,cls:sc.cls,frames:q.res.length,fr_all:q.fr_all,ticks:q.ticks,ymin:q.ymin,yend:q.yend,xend:q.xend,
      bad_frames:q.res.filter(o=>o.bad).length,bad_px:q.res.reduce((p,o)=>p+o.bad,0),severe:q.res.filter(o=>o.bad>=40).length,
      miss20:q.res.filter(o=>o.miss>=20).length,oth_frames:q.res.filter(o=>o.oth>0).length,oth_px:q.res.reduce((p,o)=>p+o.oth,0),gone:q.res.filter(o=>fr2(o).gone).length,gray:q.res.filter(o=>fr2(o).gray).length,
      othlist:process.env.OTHLIST?q.res.filter(o=>o.oth>0).map(o=>[o.f,o.tick,o.oth,o.path]):undefined,badlist:bl.map(o=>[o.f,o.tick,o.x,o.y,o.st,o.path,o.bad,o.miss,o.missR,o.missG,o.hp,o.hpR,o.bb.join(':')])};
    process.stderr.write(tag+' '+JSON.stringify(Object.assign({},perScene[tag],{badlist:undefined}))+'\n');}}
fs.writeFileSync(out,JSON.stringify({rom,scenes:perScene},null,1));
