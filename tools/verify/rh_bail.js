// rh_bail.js - задача apex-fast: как часто BEAMW (vbw_wait) выходит без ожидания из-за переноса lo+15 > 255 (метка vbw_g2:
// «габарит переваливает через край fb»; carry = lo+15>255 по регистру E, bail = сразу за vbw_g2 исполнен vbw_out (carry в byY — это bail)) и в каких ProtaY. До правки (клемп до 255) бросок идёт на vbw_out, после — на vbw_g3.
// usage: node rh_bail.js <rom> <sym> <out.json> [ticks]
const T=__dirname+'/';const {runScene}=require(T+'hf_stand.js');const fs=require('fs');
const [rom,sym,out,ticks]=[process.argv[2],process.argv[3],process.argv[4],+process.argv[5]||300];
const tot={calls:0,carry:0,bail:0,byY:{}};let pend=0,pendB=null;
for(const hy of [8,16])for(const mum of [[-1,0],[60,100],[14,40]])for(const x of [24,72,120,168,216]){
 runScene(rom,sym,{mode:'run',ticks,x,hy,mummy:mum[0]>=0,dx0:mum[0],dx1:mum[1],runw:10,pcHook:(pc,f,cyc,E)=>{if(pend){pend--;if(pc===E.L.vbw_out){pend=0;tot.bail++;pendB.carry++;}}
  if(pc===E.L.vbw_g2){pend=4;pendB=null;const c=E.cpu;const Y=E.rd(E.L.ProtaY);const y=Y>200?Y-256:Y;const k=y<0?'Y<0':y<8?'0<=Y<8':'Y>=8';const b=tot.byY[k]=tot.byY[k]||{calls:0,carry:0};b.calls++;tot.calls++;pendB=b;if(c.e()+15>255){tot.carry++;}}}});}
fs.writeFileSync(out,JSON.stringify(tot,null,1));console.log(JSON.stringify(tot));
