// задача hud-flicker, см. outputs/hud-flicker/REPORT.md
const {runScene,FR}=require('./hf_stand.js');
const rom=process.argv[2];
const ds=[];let t0=null;let ids=null;
runScene(rom+'.rom',rom+'.sym',{mode:'run',ticks:150,x:24,hy:16,runw:10,pcHook:(pc,f,cyc,E)=>{
  if(!ids)ids={w:E.L.vpz_wr,e:E.L.vtm_afterdraw};
  if(pc===ids.w)t0=f*FR+cyc;else if(pc===ids.e&&t0!==null){ds.push(f*FR+cyc-t0);t0=null;}}});
ds.sort((a,b)=>a-b);console.log(rom,'n',ds.length,'median',ds[ds.length>>1],'min',ds[0],'p90',ds[Math.floor(ds.length*.9)]);
