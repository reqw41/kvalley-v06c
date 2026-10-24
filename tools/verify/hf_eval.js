// задача hud-flicker, см. outputs/hud-flicker/REPORT.md
// usage: node eval2.js name rom sym ticks out.json
const {runScene,analyze}=require('./hf_stand.js');const fs=require('fs');
const [name,rom,sym,tk,out]=process.argv.slice(2);
const SC=[['top16_run',16,24,'run',0],['top16_jump',16,24,'jump',0],['top8_run',8,124,'run',0],['top8_jump',8,124,'jump',0],['top16_run_mum',16,24,'run',1],['top8_run_mum',8,124,'run',1],['top8_jump_mum',8,124,'jump',1],['mid40_run',40,48,'run',0],['mid72_run',72,124,'run',0]];
const W=576;const zone=y=>y<64?'hud':y<80?'strip':'field';
const res={};
for(const [n,hy,x,mode,mum] of SC){
  const r=runScene(rom,sym,{mode,ticks:+tk,x,hy,mummy:!!mum,runw:10});
  const a=analyze(r);const F=r.frames;
  const R={frames:0,bad:{hud:0,strip:0,field:0},badframes:0,badframes_zone:{hud:0,strip:0,field:0},flash:{hud:0,strip:0,field:0},flashframes:0,maxrun:0,alt:0,hero_ymin:255};
  let run=0,prevBad=[];
  for(let i=0;i<a.length;i++){ if(a[i].f<30)continue; R.frames++;
    const A=a[i];const zs={hud:A.nHud,strip:A.nStrip,field:A.nField};
    for(const z in zs){R.bad[z]+=zs[z];if(zs[z])R.badframes_zone[z]++;}
    if(A.bad.length){R.badframes++;run++;R.maxrun=Math.max(R.maxrun,run);}else run=0;
    // alternation: pixel bad in frames i and i-2 but not i-1
    if(i>=2){const s1=new Set(a[i-2].bad),s0=new Set(a[i-1].bad);let c=0;for(const p of A.bad)if(s1.has(p)&&!s0.has(p))c++;R.alt+=c;}
    // legacy flash A==C, B!=A
    if(i>=2&&F[i-2].f>=30){const Aa=F[i-2].bmp,B=F[i-1].bmp,C=F[i].bmp;let any=0;
      for(let y=16;y<272;y++){const o=y*W;let n=0;for(let x=32;x<544;x++){const p=o+x;if(B[p]!==Aa[p]&&B[p]!==C[p]&&Aa[p]===C[p])n++;}
        if(n){R.flash[zone(y)]+=n;any=1;}}
      R.flashframes+=any;}
  }
  R.hero_ymin=Math.min(...r.meta.map(m=>m.y>200?m.y-256:m.y));
  const ticks=r.meta.length?r.meta[r.meta.length-1].tick-r.meta[0].tick:1;R.frames_per_tick=+(r.meta.length/ticks).toFixed(3);
  res[n]=R;console.error(name,n,JSON.stringify(R));
}
fs.writeFileSync(out,JSON.stringify({name,res},null,1));
