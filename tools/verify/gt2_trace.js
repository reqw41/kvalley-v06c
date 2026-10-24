// gt2_trace.js - задача apex-fast, раунд 2: трасса записей в fb для кадра сцены gt2_eval (как rh_trace): столбец/плоскость, PC, такты от IRQ,
// строки и такт прохода луча. usage: node gt2_trace.js <rom> <sym> <hy> <sch> <dir -1|1> <x0> <frame> [out.json]   env: COL RUNW
const T=__dirname+'/';const {runScene,analyze,FR}=require(T+'hf_stand.js');const {symtab}=require(T+'hf_cls.js');
const [rom,sym,hyS,sch,dirS,x0S,fsel,out]=process.argv.slice(2);const hy=+hyS,dir=+dirS,x0=+x0S,COL=+(process.env.COL||2);
const offs={front:t=>60-3*t,back:t=>-(60-3*t),trail:t=>-22,lead:t=>22};
const place=(E,wr,t)=>{const {L,rd}=E;if(t===0)wr(L.updateMomiaAtr,0xC9);const MA=L.sprAttrib+4*6;const hx=rd(L.ProtaX);const mx=(hx+dir*offs[sch](t%40))&255;
 wr(MA,hy-1);wr(MA+1,mx);wr(MA+2,236);wr(MA+3,COL);for(const m of [7,8,9,10,11,12,13])wr(L.sprAttrib+4*m,0xe0);for(let m=0;m<4;m++){wr(L.momiaDat+m*22,4);wr(L.momiaDat+m*22+3,224);}};
const r=runScene(rom,sym,{mode:'run',ticks:240,x:x0,hy,runw:+(process.env.RUNW||50),placeFn:place,keys:t=>[dir<0?37:39],journal:true});
const nm=symtab(r.E.L);const VS=r.E.L.vec_vscroll;const a=analyze(r);const bad=new Map(a.map(e=>[e.f,e.bad.length]));const res=[];
for(const f of [+fsel-1,+fsel]){const g={};
 for(const [ff,t,pc,ad,v,old] of r.journal){if(ff!==f)continue;const col=(ad>>8)&31,pl=(ad>>13)-4,lo=ad&255;const k=col+'/'+pl+'/'+nm(pc);
  const e=g[k]=g[k]||{col,plane:pl,pc:nm(pc),n:0,chg:0,t0:1e9,t1:0,lo0:255,lo1:0};e.n++;e.t0=Math.min(e.t0,t);e.t1=Math.max(e.t1,t);e.lo0=Math.min(e.lo0,lo);e.lo1=Math.max(e.lo1,lo);if(v!==old)e.chg++;}
 for(const e of Object.values(g).sort((p,q)=>p.t0-q.t0)){const rTop=(VS-e.lo1)&255,rBot=(VS-e.lo0)&255;
  res.push({frame:f,col:e.col,plane:e.plane,pc:e.pc,bytes:e.n,changed:e.chg,t_first:e.t0,t_last:e.t1,row_top:rTop,row_bot:rBot,beam_top:(40+rTop)*192-44,beam_bot:(40+rBot)*192-44});}}
const meta=r.meta.find(m=>m.f===+fsel);
const o={scene:{hy,sch,dir,x0},frame:+fsel,hero_x:meta&&meta.x,bad_px:bad.get(+fsel)||0,writes:res};
if(out)require('fs').writeFileSync(out,JSON.stringify(o,null,1));
for(const w of res)if(w.frame===+fsel||w.t_first>20000)console.log(w.frame,'col'+w.col,'pl'+w.plane,w.pc.padEnd(10),'t',w.t_first,'-',w.t_last,'rows',w.row_top,'..',w.row_bot,'beam',w.beam_top,'..',w.beam_bot);
console.log('hero x',o.hero_x,'bad px',o.bad_px);
