// задача hud-flicker, см. outputs/hud-flicker/REPORT.md
const {runScene}=require('./hf_stand.js');
const rom=process.argv[2];
let pend=null,ok=0,bad=0,n1=0,badEx=[];
let ids=null;
const r=runScene(rom+'.rom',rom+'.sym',{mode:process.argv[3]||'run',ticks:250,x:+(process.argv[5]||24),hy:+(process.argv[4]||16),mummy:process.argv[6]==='1',runw:10,pcHook:(pc,f,cyc,E)=>{
  const {L,rd,cpu}=E;
  if(!ids)ids={w:L.vpz_wr,e:L.vtm_afterdraw};
  if(pc===ids.w){const jb=rd(L.vpz_jb+1)|(rd(L.vpz_jb+2)<<8);const pair=jb===L.vpz_bh;
    pend={pair,b:cpu.rp(0)>>8,nc:rd(L.vsb_nc),lo:rd(L.vsb_lo),pa:rd(L.vpz_pa+1),pb:rd(L.vpz_pb+1),d:rd(L.vpz_d+1),exp:[]};
    const buf=(page,c,i)=>rd(page*256+0xA0+16*c+i);
    for(let c=0;c<pend.nc;c++){for(let i=0;i<16;i++){
      pend.exp.push([(((pend.b+c)&255)<<8)|((pend.lo+i)&255),buf(pend.pa,c,i)]);
      if(pair)pend.exp.push([(((pend.b+pend.d+c)&255)<<8)|((pend.lo+i)&255),buf(pend.pb,c,i)]);}}
  } else if(pc===ids.e&&pend){let m=0;for(const [a,v] of pend.exp)if(rd(a)!==v)m++;
    if(pend.pair)n1++;
    if(m){bad++;if(badEx.length<3)badEx.push({pair:pend.pair,m,nc:pend.nc,lo:pend.lo});}else ok++;pend=null;}
}});
console.log(rom,'writes ok',ok,'bad',bad,'pair',n1,JSON.stringify(badEx));
