// ЦЕЛЕВОЙ СЛУЧАЙ: герой (два слоя) + две мумии в кадре — по словам владельца самый частый.
// Ставим обеих мумий вплотную к герою и держим их там, меряем длину тика.
const {make}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {L,rd,v06c,cpu,cyc,FRAME,memory,keyboard}=E;
const wr=(a,v)=>memory.write(a&0xffff,v&255,false);
function tick(){const t0=rd(L.timer);do v06c.oneInterrupt(true);while(rd(L.timer)===t0);}
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
let f=0;while(f<1500&&rd(L.GameStatus)!==5){v06c.oneInterrupt(true);f++;}
for(let i=0;i<40;i++)tick();
wr(L.vec_god,1);
const MD=L.momiaDat, STEP=(L.momiaDat2!==undefined)?(L.momiaDat2-L.momiaDat):16;
function place(){
  const hY=rd(L.ProtaY), hX=rd(L.ProtaX), room=rd(L.ProtaRoom);
  for(let m=0;m<2;m++){const p=MD+m*STEP;
    wr(p+0,0); wr(p+3,hY); wr(p+5,(hX+(m?14:-14))&255); wr(p+6,room);}
  wr(L.enemyAttrib,hY); wr(L.enemyAttrib+1,(hX+14)&255);
  wr(L.enemyAttrib+2,hY); wr(L.enemyAttrib+3,(hX-14)&255);
}
place(); for(let i=0;i<10;i++)tick();
keyboard.keyDown({keyCode:39,which:39,preventDefault(){},stopPropagation(){}});
let frames=0,prev=0,inTick=false,acc=0;
const rows=[],byN={};
const now=()=>frames*FRAME+cyc();
v06c.check_breakpoint=function(){
  const t=now();
  if(inTick){let d=t-prev;if(d<0)d+=FRAME;if(d>0&&d<4000)acc+=d;}
  prev=t;
  if(cpu.pc===L.runGame&&!inTick){inTick=true;acc=0;}
  else if(cpu.pc===L.tickMain2&&inTick){inTick=false;
    if(acc>0){const n=rd(L.vsp_n);rows.push(acc);(byN[n]=byN[n]||[]).push(acc);}}
  return false;
};
for(let i=0;i<900;i++){v06c.oneInterrupt(true);frames++;if(i%60===0)place();}
v06c.check_breakpoint=()=>false;
const q=(a,x)=>a.length?a.slice().sort((u,v)=>u-v)[Math.min(a.length-1,Math.floor(a.length*x))]:0;
const B30=Math.round(FRAME*50/30), B25=FRAME*2;
console.log(`тиков ${rows.length}: p50 ${q(rows,.5)} p90 ${q(rows,.9)} max ${q(rows,1)}`);
console.log(`бюджеты: 30 Гц = ${B30}, 25 Гц = ${B25}`);
for(const n of Object.keys(byN).sort((a,b)=>a-b)){const a=byN[n];if(a.length<10)continue;
  const over30=a.filter(x=>x>B30).length, over25=a.filter(x=>x>B25).length;
  console.log(`   объектов ${n}: тиков ${String(a.length).padStart(4)} p50 ${String(q(a,.5)).padStart(6)} p90 ${String(q(a,.9)).padStart(6)}  выше 30Гц ${(100*over30/a.length).toFixed(0)}%  выше 25Гц ${(100*over25/a.length).toFixed(0)}%`);}
