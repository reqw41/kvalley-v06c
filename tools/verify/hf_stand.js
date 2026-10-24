// hf_stand.js - стенд задачи hud-flicker: герой на верхней площадке пирамиды 1 бегает/прыгает, на КАЖДОМ кадре снимается bmp эмулятора
// (то, что показывает луч), а на концах пачек вывода (vec_spr_out) - «устоявшийся» fb (idealBmp). Пиксель кадра, которого нет ни в одном
// устоявшемся состоянии вокруг кадра, считается испорченным (вспышка любой длины, чередование, промежуточный цвет плоскостей).
// Метрика bad: analyze(). Зоны по строкам bmp: HUD sy 16..63 (r 0..47), полоса sy 64..79 (r 48..63, 16 верхних строк поля), поле дальше.
'use strict';
const {make,toGame}=require('./beam_harness.js');
const FR=59904;
function runScene(rom,sym,opts){
  const E=make(rom,sym);const {L,rd,memory,v06c,key,cpu}=E;
  toGame(E);
  const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
  wr(L.vec_god,1);
  const HX0=opts.x!=null?opts.x:24,HY=opts.hy!=null?opts.hy:16;
  wr(L.ProtaX,HX0);wr(L.ProtaY,HY);wr(L.protaStatus,0);
  const mum=!!opts.mummy;
  const place=()=>{ if(!mum){for(let m=0;m<4;m++){wr(L.momiaDat+m*22,4);wr(L.momiaDat+m*22+3,224);}for(let sl=6;sl<=13;sl++)wr(L.sprAttrib+4*sl,224);}
    else{const room=rd(L.ProtaRoom),hX=rd(L.ProtaX),hY=HY,xs=[(hX+(opts.dx0||14))&255,(hX+(opts.dx1||40))&255];
      for(let m=0;m<2;m++){const p=L.momiaDat+m*22;wr(p,0);wr(p+3,hY);wr(p+5,xs[m]);wr(p+6,room);wr(p+0x14,m?1:4);}
      for(let m=2;m<4;m++){const p=L.momiaDat+m*22;wr(p,4);wr(p+3,0xe0);}
      const pats=[0x28,0x88],cols=[0x0a,0x09];
      for(let m=0;m<2;m++){const b=L.enemyAttrib+m*4;wr(b,hY);wr(b+1,xs[m]);wr(b+2,pats[m]);wr(b+3,cols[m]);const sa=L.sprAttrib+4*(6+m);wr(sa,hY);wr(sa+1,xs[m]);wr(sa+2,pats[m]);wr(sa+3,cols[m]);}
      for(let sl=8;sl<=13;sl++)wr(L.sprAttrib+4*sl,0xe0);} };
  const placeFn=opts.placeFn?(()=>opts.placeFn(E,wr,0)):null;let ptick=0;
  if(placeFn)placeFn();else place();
  const frames=[],meta=[],states=[],journal=[];
  let f=0,lastPc=0;
  // pack end hook
  const OUT=L.vec_spr_out;let outRet=-1,outSp=-1;
  const retOf=()=>memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);
  let live=false;
  v06c.check_breakpoint=function(){const pc=cpu.pc;lastPc=pc;if(opts.pcHook&&live)opts.pcHook(pc,f,E.cyc(),E);
    if(pc===OUT&&outRet<0){outSp=cpu.sp;outRet=retOf();}
    else if(outRet>=0&&pc===outRet&&cpu.sp>outSp){outRet=-1;
      if(live)states.push({t:f*FR+E.cyc(),ideal:E.idealBmp(),f});}
    return false;};
  if(opts.journal){const oW=memory.write.bind(memory);
    memory.write=function(a,v,s){const aa=a&0xffff;if(live&&aa>=0x8000&&aa<0xE000)journal.push([f,E.cyc(),lastPc,aa,v&255,memory.bytes[memory.tobank(aa)]]);return oW(a,v,s);};}
  let held=new Set(),tick=0,prevT=rd(L.timer),nf=0;
  const NT=opts.ticks;
  const keyFn=t=>opts.keys?opts.keys(t):(opts.mode==='run'?[t&16?37:39,...(t%32<12?[32]:[])]:[...(t%32<12?[32]:[])]);
  // initial state
  live=true;states.push({t:-1,ideal:E.idealBmp(),f:-1});
  while(tick<NT&&nf<NT*8){
    const want=new Set(keyFn(tick));
    for(const c of held)if(!want.has(c))key(c,0);
    for(const c of want)if(!held.has(c))key(c,1);
    held=want;
    live=rd(L.GameStatus)===5;
    v06c.oneInterrupt(true);
    if(live){frames.push({f,bmp:Uint32Array.from(v06c.bmp)});
      meta.push({f,tick,y:rd(L.ProtaY),x:rd(L.ProtaX),st:rd(L.protaStatus)});}
    f++;nf++;
    const t=rd(L.timer);if(t!==prevT){prevT=t;tick++;
      if(rd(L.ProtaY)>HY+24)wr(L.ProtaY,HY);
      if(Math.abs(rd(L.ProtaX)-HX0)>(opts.mode==='run'?(opts.runw||12):4))wr(L.ProtaX,HX0);
      ptick++;if(opts.placeFn)opts.placeFn(E,wr,ptick);else place();}
  }
  return {frames,meta,states,journal,E};
}
// bad pixels: beam value not in the set of settled states around the frame
function analyze(r){
  const W=576,res=[];const st=r.states;
  for(let i=0;i<r.frames.length;i++){
    const {f,bmp}=r.frames[i];const t0=f*FR,t1=t0+FR;
    let a=-1;for(let j=0;j<st.length;j++)if(st[j].t<t0)a=j;
    let b=st.length-1;for(let j=0;j<st.length;j++)if(st[j].t>=t1){b=j;break;}
    if(a<0)a=0;
    const set=st.slice(a,b+1).map(s=>s.ideal);
    const bad=[];let nHud=0,nStrip=0,nField=0;
    for(let y=16;y<272;y++){const o=y*W;for(let x=32;x<544;x++){const v=bmp[o+x];let ok=false;for(const s of set)if(s[o+x]===v){ok=true;break;}
      if(!ok){bad.push(o+x);if(y<64)nHud++;else if(y<80)nStrip++;else nField++;}}}
    res.push({f,nHud,nStrip,nField,bad,ns:set.length});
  }
  return res;
}
module.exports={runScene,analyze,FR};
if(require.main===module){
  const [rom,sym,mode,tk]=process.argv.slice(2);
  const r=runScene(rom,sym,{mode,ticks:+tk});const a=analyze(r);
  const s=k=>a.reduce((x,y)=>x+y[k],0),c=k=>a.filter(y=>y[k]).length;
  console.log(rom,'frames',a.length,'states',r.states.length,'bad px HUD',s('nHud'),'frames',c('nHud'),'strip',s('nStrip'),'frames',c('nStrip'),'field',s('nField'),'frames',c('nField'));
  console.log('ys',Math.min(...r.meta.map(m=>m.y)));
}
