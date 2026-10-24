// door_pass.js — проход героя через вращающиеся двери пирамиды 2 (комната 1): Z80-оригинал против сборки.
//   node tools/verify/door_pass.js z80 > z80.json
//   node tools/verify/door_pass.js build/kvalley_8c.rom build/kvalley_8c.sym > port.json
//   node tools/verify/door_pass_cmp.js z80.json port.json   (сравнение с допуском в 1 шаг)
// Сетка: дверь A (X=0x40,Y=0x28) вправо со старта X=56 (за ней ступенька на 1 тайл, X=88), дверь A влево
// с X=72..80, дверь B (X=0x70,Y=0x20) вправо с X=104 и влево с X=120..127; субпиксель и задержка
// нажатия 0..3 тика (фаза timer). Мумии убраны (статус 4). Z80: msx_p1_lib (WebMSX), тик порта = 2 кадра.
const fs=require('fs');
const mode=process.argv[2];
function readSym(p){const m={};for(const l of fs.readFileSync(p,'latin1').split('\n')){const g=l.match(/^(\S+):\s*equ\s*0*([0-9A-Fa-f]+)h/);if(g)m[g[1]]=parseInt(g[2],16);}return m;}
let A,rd,wr,setKey,adv,adv1,pre;
const NT=+process.env.NT||0;
if(mode==='z80'){
  const P=require('../gfx/msx_p1_lib.js');
  const e=P.makeEmu(''+__dirname+'/../../legacy/msx/kvalley_z80.rom');
  A=readSym(__dirname+'/../../legacy/msx/kvalley_src.sym');
  wr=(a,v)=>e.m.bus.write(a,v&255);rd=a=>e.rd(a);
  P.hookKbd(e);
  let f=0;while(f<3000&&rd(A.GameStatus)!==1){e.runFrames(1);f++;}
  for(let t=0;t<40&&rd(A.GameStatus)!==3;t++)e.tap('SPACE',6,4);
  for(let i=0;i<400&&rd(A.GameStatus)<=4;i++){wr(A.piramideDest,2);wr(A.piramideActual,2);e.runFrames(1);}
  for(let i=0;i<4000&&rd(A.GameStatus)!==5;i++)e.runFrames(1);
  e.runFrames(100);
  setKey=(r,l)=>{e.setRow8('RIGHT',r);e.setRow8('LEFT',l);};
  adv=(n)=>e.runFrames(2*n);  // n тиков порта = 2n кадров
  adv1=()=>e.runFrames(1);
} else {
  const {boot,ticks}=require('./door_pass_lib.js');
  const B=boot(mode,process.argv[3]);A=B.L;rd=B.rd;wr=B.wr;
  setKey=(r,l)=>{B.st.keys=(r?128:0)|(l?16:0);};
  adv=(n)=>ticks(B,n,()=>B.st.keys);
  adv1=null;
}
const R=process.env.RES?JSON.parse(process.env.RES):null;
const D=[{y:0x20,x:0x70},{y:0x28,x:0x40}];   // по порядку записей doorGiraData: 0 = дверь B, 1 = дверь A
function setDoor(d,sent){
  const p=A.doorGiraData+d*7;wr(p,2);wr(p+5,sent);wr(p+6,0);
  const left=sent&4?0x52:0x50;
  const r0=(D[d].y>>3)-1,c=(D[d].x>>3)+32;
  for(let k=0;k<3;k++){wr(A.MapaRAM+(r0+k)*96+c,left);wr(A.MapaRAM+(r0+k)*96+c+1,left+1);}
}
const out=[];
function trial(d,dir,x,dec,delay){
  for(let m=0;m<4;m++){wr(A.momiaDat+m*22,4);wr(A.momiaDat+m*22+6,3);}
  setKey(false,false);adv(2);
  setDoor(0,8);setDoor(1,8);
  setDoor(d,dir>0?8:4);
  const hy=D[d].y+8;
  wr(A.ProtaY,hy);wr(A.ProtaX,x);wr(A.ProtaXdecimal,dec);wr(A.ProtaRoom,1);wr(A.protaStatus,0);wr(A.sentidoProta,dir>0?2:1);
  wr(A.timerEmpuja,0);wr(A.accionWaitCnt,0);wr(A.protaMovCnt,0);
  adv(delay);
  setKey(dir>0,dir<0);
  let s6a=-1,s6b=-1,xe=null,minY=hy,maxY=hy,spin=-1,tileAtEnd=null;
  const tl=()=>{const r0=(D[d].y>>3)-1,c=(D[d].x>>3)+32;return [rd(A.MapaRAM+r0*96+c),rd(A.MapaRAM+r0*96+c+1),rd(A.MapaRAM+(r0+2)*96+c),rd(A.doorGiraData+d*7+5)].join(',');};
  for(let t=0;t<260;t++){
    adv(1);
    const st=rd(A.protaStatus);
    if(st===6){if(s6a<0)s6a=t;s6b=t;}
    if(s6a>=0&&st!==6&&xe===null)xe=rd(A.ProtaX)+'.'+rd(A.ProtaXdecimal);
    if(process.env.DBG&&s6a>=0&&t<s6a+8)console.error(t,rd(A.doorGiraData),rd(A.doorGiraData+6),rd(A.doorGiraData+7));
    if(s6a>=0&&spin<0&&!(rd(A.doorGiraData+d*7)&1)){spin=t-s6a;tileAtEnd=tl();}
    const y=rd(A.ProtaY);if(y<minY)minY=y;if(y>maxY)maxY=y;
  }
  setKey(false,false);
  out.push({d,dir,x,dec,delay,pass:s6a>=0,len6:s6a>=0?s6b-s6a+1:0,spin,tileAtEnd,finTile:tl(),finBit0:rd(A.doorGiraData+d*7)&1,xe,fin:rd(A.ProtaX)+'.'+rd(A.ProtaXdecimal),finY:rd(A.ProtaY),st:rd(A.protaStatus),room:rd(A.ProtaRoom),maxDY:maxY-hy});
}
const decs=[0,0x80,0xA8,0xFA];
const delays=[0,1,2,3];
if(process.env.QUICK){trial(1,1,56,0,0);}
else{
for(const dec of decs)for(const dl of delays)trial(1,1,56,dec,dl);          // дверь A слева направо
for(const x of [72,73,74,75,76,77,78,79,80])for(const dec of [0,0x80])for(const dl of [0,1,2,3])trial(1,-1,x,dec,dl); // A справа налево
for(const dec of decs)for(const dl of delays)trial(0,1,104,dec,dl);
for(const x of [120,121,122,124,127])for(const dec of [0,0x80,0xFA])for(const dl of [0,1])trial(0,-1,x,dec,dl);
}
console.log(JSON.stringify(out));
