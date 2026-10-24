// rh_trace.js - задача right-half: трасса записей в fb за кадры f-1..f: адрес (столбец/плоскость), PC (метка), такт от IRQ,
// экранные строки объекта и такт, когда луч проходит первую/последнюю строку записанного отрезка.
// usage: node rh_trace.js <rom> <sym> <mode run|jump> <hy> <x> <mummy 0|1> <dx0> <dx1> <frame> [out.json]
'use strict';
const T=__dirname+'/';
const {runScene,analyze,FR}=require(T+'hf_stand.js');const {symtab}=require(T+'hf_cls.js');
const [rom,sym,mode,hy,x,mum,dx0,dx1,fsel,out]=process.argv.slice(2);
const r=runScene(rom,sym,{mode,ticks:400,x:+x,hy:+hy,mummy:mum==='1',dx0:+dx0,dx1:+dx1,runw:10,journal:true});
const a=analyze(r);const nm=symtab(r.E.L);const VS=r.E.L.vec_vscroll;
const bad=new Map(a.map(e=>[e.f,e.bad.length]));
const res=[];
for(const f of [+fsel-1,+fsel]){
  const g={};
  for(const [ff,t,pc,ad,v,old] of r.journal){if(ff!==f)continue;
    const col=(ad>>8)&31,pl=(ad>>13)-4,lo=ad&255;const k=col+'/'+pl+'/'+nm(pc);
    const e=g[k]=g[k]||{col,plane:pl,pc:nm(pc),n:0,chg:0,t0:1e9,t1:0,lo0:255,lo1:0};
    e.n++;e.t0=Math.min(e.t0,t);e.t1=Math.max(e.t1,t);e.lo0=Math.min(e.lo0,lo);e.lo1=Math.max(e.lo1,lo);if(v!==old)e.chg++;}
  for(const e of Object.values(g).sort((p,q)=>p.t0-q.t0)){
    const rTop=(VS-e.lo1)&255,rBot=(VS-e.lo0)&255;
    res.push({frame:f,col:e.col,plane:e.plane,pc:e.pc,bytes:e.n,changed:e.chg,t_first:e.t0,t_last:e.t1,row_top:rTop,row_bot:rBot,
      beam_top:(40+rTop)*192-44,beam_bot:(40+rBot)*192-44,after_beam:e.t0>(40+rTop)*192-44});}
}
const o={scene:{mode,hy:+hy,x:+x,mummy:mum==='1',dx0:+dx0,dx1:+dx1},frame:+fsel,bad_px:bad.get(+fsel)||0,writes:res};
if(out)require('fs').writeFileSync(out,JSON.stringify(o,null,1));
for(const w of res)console.log(w.frame,'col'+w.col,'pl'+w.plane,w.pc.padEnd(10),'t',w.t_first,'-',w.t_last,'rows',w.row_top,'..',w.row_bot,'beam',w.beam_top,'..',w.beam_bot,w.after_beam?'AFTER-BEAM':'');
console.log('bad px',o.bad_px);
