// Проверка ключевого допущения: ПУСТ ЛИ ФОН под спрайтом в тех плоскостях, куда спрайт пишет.
// Если пуст — стирание нулями вместо восстановления из блока законно, а сейв не нужен вовсе.
const {make}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
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
// после каждого сейва смотрим блок фона: нулевой ли он
const stat={},ids={};let total=0,empty=0;
v06c.check_breakpoint=function(){
  if(cpu.pc===L.vsu_rdone){                    // сейв завершён: блок в слоте свежий
    const i=rd(L.vec_nsp_idx), p=0xE000+i*0x100;
    const nc=rd(p+3); if(!nc||nc>3)return false;
    let planes=1; if(rd(p+4))planes++; if(rd(p+5))planes++;
    let nz=0; const len=16*nc*planes;
    for(let k=0;k<len;k++) if(rd(p+6+k))nz++;
    total++; if(!nz)empty++;
    if(nz){                                  // фон НЕ пуст — какие клетки карты под габаритом
      const room=rd(L.ProtaRoom), base=L.MapaRAM+room*32;
      const col=rd(p+1)&0x1F, lo=rd(p+2);
      for(let j=0;j<nc;j++)for(let r=0;r<16;r+=8){
        const y=lo+r, tr=30-(y>>3);
        if(tr<0||tr>21)continue;
        const id=rd(base+tr*96+col+j);
        ids[id]=(ids[id]||0)+1;
      }
    }
    const key="слот "+i;
    stat[key]=stat[key]||{n:0,e:0,nzmax:0};
    stat[key].n++; if(!nz)stat[key].e++; if(nz>stat[key].nzmax)stat[key].nzmax=nz;
  }
  return false;
};
for(let i=0;i<600;i++){v06c.oneInterrupt(true);if(i%60===0)place();}
v06c.check_breakpoint=()=>false;
console.log(`сейвов ${total}: блок фона ПУСТ у ${empty} (${(100*empty/Math.max(total,1)).toFixed(1)}%)`);
const top=Object.entries(ids).sort((a,b)=>b[1]-a[1]).slice(0,8);
console.log("клетки карты под НЕПУСТЫМ фоном (ID -> сколько раз): "+top.map(([k,v])=>k+":"+v).join(", "));
for(const k of Object.keys(stat).sort()){const s=stat[k];
  console.log(`   ${k}: сейвов ${s.n}, пустых ${s.e} (${(100*s.e/s.n).toFixed(0)}%), макс ненулевых байт ${s.nzmax}`);}
