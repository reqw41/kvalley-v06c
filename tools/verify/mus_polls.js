const TV=__dirname;
const BH=require(TV+"/beam_harness.js");
const make0=BH.make; let G=null;
BH.make=function(...a){const E=make0(...a);const {v06c,cpu,L,rd}=E;
 G={L,calls:{},ticks:{},cur:null,busy:{}};const g=G;
 const rd16=x=>rd(x)|(rd(x+1)<<8);
 let cb=v06c.check_breakpoint;
 Object.defineProperty(v06c,"check_breakpoint",{get(){return function(){
   if(cpu.pc===L.vsu_poll){const r=rd16(cpu.sp);g.cur=r;const k=r+(rd(L.vbw_busy)?"P":"T");g.calls[k]=(g.calls[k]||0)+1;}
   if(cpu.pc===L.updateSound&&g.cur!==null&&rd16(cpu.sp)===L.vsp_out){const k=g.cur+(rd(L.vbw_busy)?"P":"T");g.ticks[k]=(g.ticks[k]||0)+1;}
   return cb.apply(this,arguments);};},set(f){cb=f;},configurable:true});
 return E;};
BH.toGame=function(E){const {run,key,rd,L}=E;run(400);key(112,1);key(114,1);for(let i=0;i<640&&rd(L.GameStatus)!==5;i++)run(1);key(112,0);key(114,0);for(let i=0;i<4000&&rd(L.GameStatus)!==5;i++)run(1);return rd(L.GameStatus);};
const {runScenario}=require(TV+"/lo_lib.js");const {scenarios}=require(TV+"/lo_scen.js");
const nm=a=>{let b=null;for(const [n,v] of Object.entries(G.L)) if(!/^[A-Z0-9_]+$/.test(n)&&v<=a&&v>=0x100&&v<0x7600&&(!b||v>b[1])) b=[n,v]; return b?b[0]+"+"+(a-b[1]):a.toString(16);};
for(const n of process.argv.slice(5)){const s=scenarios().find(x=>x.name===n);G=null;runScenario(process.argv[3],process.argv[4],s,{snap:false});
 const out=[];for(const k of Object.keys(G.calls)){const site=+k.slice(0,-1);out.push([nm(site)+k.slice(-1),G.calls[k],G.ticks[k]||0]);}
 out.sort((a,b)=>b[1]-a[1]);console.log(n,JSON.stringify(out));}
