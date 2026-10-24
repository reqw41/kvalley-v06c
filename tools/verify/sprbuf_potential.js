// РАЗВЕДКА ПЕРЕД ПРАВКОЙ: сколько дал бы кэш содержимого буфера спрайта.
// Меряет ДО написания кода: (а) цену vsp_pat на вызов, (б) долю вызовов, у которых
// ключ (pat, сдвиг vsp_sh, ncols) совпал с ключом ПРЕДЫДУЩЕЙ сборки ТОГО ЖЕ слота —
// то есть буфер уже содержит нужное и сборку можно пропустить.
// Экономия = доля попаданий * цена vsp_pat. Если произведение мало, правку писать незачем.
"use strict";
const {make}=require("./beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
const {L,rd,v06c,cpu,memory,keyboard}=E;
const wr=(a,v)=>memory.write(a&0xffff,v&255,false);
function tick(){const t0=rd(L.timer);do v06c.oneInterrupt(true);while(rd(L.timer)===t0);}
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
let f=0;while(f<1500&&rd(L.GameStatus)!==5){v06c.oneInterrupt(true);f++;}
for(let i=0;i<40;i++)tick();
wr(L.vec_god,1);
const MD=L.momiaDat, STEP=(L.momiaDat2!==undefined)?(L.momiaDat2-L.momiaDat):16;
function place(){const hY=rd(L.ProtaY),hX=rd(L.ProtaX),room=rd(L.ProtaRoom);
  for(let m=0;m<2;m++){const p=MD+m*STEP;wr(p+0,0);wr(p+3,hY);wr(p+5,(hX+(m?14:-14))&255);wr(p+6,room);}
  wr(L.enemyAttrib,hY);wr(L.enemyAttrib+1,(hX+14)&255);wr(L.enemyAttrib+2,hY);wr(L.enemyAttrib+3,(hX-14)&255);}
place();for(let i=0;i<10;i++)tick();
keyboard.keyDown({keyCode:39,which:39,preventDefault(){},stopPropagation(){}});
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x8000).sort((a,b)=>a[1]-b[1]);
const addrs=syms.map(x=>x[1]);
const near=pc=>{let l=0,h=addrs.length-1,r=0;while(l<=h){const m=(l+h)>>1;if(addrs[m]<=pc){r=m;l=m+1}else h=m-1}return syms[r][0];};
// цена: считаем такты, пока PC внутри диапазона [vsp_pat, следующая метка ПОСЛЕ конца)
// — надёжнее по стеку: входим по vsp_pat, выходим, когда SP вернулся к значению входа.
let inPat=false, spAt=0, cyc=0, calls=0, prevPc=null, tot=0;
const last={}, keys=[]; let hits=0;
v06c.check_breakpoint=function(){
  if(inPat&&prevPc!==null)cyc+=cpu.vcycles|0;
  if(prevPc!==null)tot+=cpu.vcycles|0;
  const pc=cpu.pc;
  if(pc===L.vsp_pat&&!inPat){
    inPat=true; spAt=cpu.sp; calls++;
    const ptr=rd(L.vec_nsp_ptr)|(rd(L.vec_nsp_ptr+1)<<8);
    const pat=rd(ptr+2), sh=rd(L.vsp_sh), nc=rd(L.vsu_nc), idx=rd(L.vec_nsp_idx);
    const k=`${pat},${sh},${nc}`;
    if(last[idx]===k)hits++; last[idx]=k; keys.push(k);
  } else if(inPat&&cpu.sp>spAt){inPat=false;}
  prevPc=pc; return false;
};
for(let i=0;i<600;i++){v06c.oneInterrupt(true);if(i%60===0)place();}
v06c.check_breakpoint=()=>false;
if(!calls){console.log("ГЕЙТ ПРОВАЛЕН: vsp_pat не вызывался ни разу.");process.exit(2);}
console.log(`вызовов vsp_pat: ${calls}; цена ${(cyc/calls).toFixed(0)} тактов на вызов (${(100*cyc/tot).toFixed(2)}% всех тактов)`);
console.log(`ПОПАДАНИЙ ключа (pat,сдвиг,ncols) по тому же слоту: ${hits} = ${(100*hits/calls).toFixed(1)}%`);
console.log(`ПОТОЛОК ЭКОНОМИИ: ${(hits*cyc/calls).toFixed(0)} тактов за прогон = ${(100*hits*cyc/calls/tot).toFixed(2)}% всех тактов`);
