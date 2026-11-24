// [memory-for-speed hero-xor] Мусор в p1/p2 вдали от спрайтов: биты сборки B, которых нет у A, держатся >= 30 тиков, пока клетку не накрывает ни один спрайт.
// node tools/verify/ms_junk.js tools/verify <a.rom> <a.sym> <b.rom> <b.sym> сценарии...
// Мусор в плоскостях p1/p2 (0xA000/0xC000) вдали от спрайтов: B (hx1) имеет биты, которых нет у A (ps4), и держатся >= 30 тиков.
const TV=process.argv[2];const BH=require(TV+"/beam_harness.js");
BH.toGame=function(E){const {run,key,rd,L}=E;run(400);key(32,1);for(let i=0;i<640&&rd(L.GameStatus)!==5;i++)run(1);key(32,0);for(let i=0;i<4000&&rd(L.GameStatus)!==5;i++)run(1);return rd(L.GameStatus);};
const {runScenario}=require(TV+"/lo_lib.js");const {scenarios}=require(TV+"/lo_scen.js");
const [,,,ra,sa,rb,sb,...names]=process.argv;
function grab(E){const m=E.memory,b=new Uint8Array(0x6000);for(let i=0;i<0x6000;i++)b[i]=m.bytes[m.tobank(0x8000+i)];return b;}
function spr(E){const L=E.L,r=[];for(let i=0;i<14;i++)r.push([E.rd(L.sprAttrib+4*i),E.rd(L.sprAttrib+4*i+1),E.rd(L.sprAttrib+4*i+2)]);return r;}
for(const n of names){const fr=[];const s1=scenarios().find(x=>x.name===n);const p1=s1.pre;s1.pre=(t,api)=>{if(p1)p1(t,api);fr[t]=grab(api.E);};
 runScenario(ra,sa,s1,{snap:false});
 const s2=scenarios().find(x=>x.name===n);const p2=s2.pre;const age=new Map();const hist=[];const rep=new Set();
 s2.pre=(t,api)=>{if(p2)p2(t,api);const a=fr[t];if(!a)return;const b=grab(api.E);hist[t]=spr(api.E);const cov=new Uint8Array(0x2000);for(const S of [hist[t],hist[t-1]||[]])for(const [y,x] of S){if(((y+0x30)&255)<0x20)continue;const lo=(239-y)&255;for(let c=(x>>3)-1;c<=(x>>3)+3;c++)for(let r=-3;r<20;r++){if(c<0||c>31)continue;cov[(c<<8)|((lo+r)&255)]=1;}}
  for(let o=0x2000;o<0x6000;o++){const extra=b[o]&~a[o];if(extra&&cov[o&0x1fff])continue;if(extra){age.set(o,(age.get(o)||0)+1);const g=age.get(o);
    if(g===30){const col=(o&0x1fff)>>8,row=o&255;const k=col+','+(row>>3);if(!rep.has(k)){rep.add(k);
      const t0=t-29;console.log(n,'t0',t0,'col',col,'row',row,'plane',o<0x4000?'p1':'p2','extra',extra.toString(16),'spr@t0',JSON.stringify((hist[t0]||[]).map((s,i)=>[i,...s]).filter(s=>s[1]<0xD0&&Math.abs(((s[2]>>3)-col))<=3&&(((239-s[1])-row+20)&255)<40)));}}}
   else age.delete(o);}};
 runScenario(rb,sb,s2,{snap:false});console.log(n,'done');}
