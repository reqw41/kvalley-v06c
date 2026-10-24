// door_pass_lib.js — тик-стенд героя в пирамиде 2 (Вектор): загрузка, чит N, ввод по тикам. Для door_pass.js.
// минимальный тик-стенд для сценариев героя в пирамиде 2
const {make}=require('./beam_harness.js');
const KEY={SPACE:1,LEFT:16,UP:32,DOWN:64,RIGHT:128};
function boot(rom,sym){
  const E=make(rom,sym);const {L,rd,run,key,memory,v06c,cpu}=E;
  const wr=(a,v)=>memory.write(a&0xffff,v&0xff,false);
  run(400);key(112,1);key(114,1);for(let i=0;i<640&&rd(L.GameStatus)!==5;i++)run(1);key(112,0);key(114,0);
  for(let i=0;i<4000&&rd(L.GameStatus)!==5;i++)run(1);
  key(78,1);run(3);key(78,0);
  for(let i=0;i<3000&&!(rd(L.GameStatus)===5&&rd(L.piramideActual)===2);i++)run(1);
  run(100);
  const st={keys:0,tick:-1,on:null,pre:null};
  v06c.check_breakpoint=function(){const pc=cpu.pc;
    if(pc===L.chkControls&&(rd(L.tickInProgress)&1)){st.tick++;if(st.pre)st.pre(st.tick);}
    if(pc===L.chkControls){wr(L.vec_kb8,(~st.keys)&0xff);}
    return false;};
  return {E,L,rd,wr,st,run};
}
// выполнить n тиков; cb(t) после каждого тика (по росту tickInProgress-цикла: ждём следующий tick)
function ticks(B,n,keysFn,after){
  const {E,L,rd,st}=B;const t0=st.tick;
  for(let k=0;k<n;k++){
    const want=t0+k+1;st.keys=keysFn?keysFn(k):0;
    let g=0;while(st.tick<want&&g++<400)E.run(1);
    // дождаться окончания тика: tick логики завершён когда tickInProgress снова 0
    g=0;while((rd(L.tickInProgress)&1)&&g++<400)E.run(1);
    if(after)after(k);
  }
}
module.exports={boot,ticks,KEY};
