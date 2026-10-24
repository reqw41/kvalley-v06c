// isr_head_profile.js — сколько тактов съедает КАЖДЫЙ блок ISR ДО пачки вывода спрайтов.
// Зачем: старт пачки vec_spr_out — единственная величина, которую можно подвинуть, не
// трогая её длину; чтобы понять, что двигать, нужно знать цену каждого блока шапки.
// Клавиши подаются ФУНКЦИЕЙ ИГРОВОГО ТИКА (как beam_ab.js), поэтому замеры двух сборок
// сопоставимы напрямую.
// Запуск: node tools/verify/isr_head_profile.js <rom> <sym> [тиков=2600]
"use strict";
const {make}=require("./beam_harness.js");
const ROM=process.argv[2],SYM=process.argv[3],NT=+(process.argv[4]||2600);
const E=make(ROM,SYM);
const {L,rd,v06c,cpu}=E;
const ISR=L.vec_isr;
let TT=0;const oI=cpu.instruction.bind(cpu);
cpu.instruction=function(){oI();TT+=cpu.vcycles|0;};
// точки замера в порядке исполнения шапки
const PTS=[["isr",L.vec_isr],["snd",L.vsnd_sample],["vsp",L.vsp_load],["bri",L.vec_brillo_pal],
           ["key",L.vec_scan_keys],["out",L.vec_spr_out]];
const byPc={};for(const [n,a] of PTS){if(a===undefined){console.log("нет символа "+n);process.exit(2);}byPc[a]=n;}
let cur=null;const frames=[];
// точная длительность подпрограмм: вход по PC, выход по адресу возврата при SP>SP входа
const SUB={snd:{pc:L.vsnd_sample},bri:{pc:L.vec_brillo_pal},key:{pc:L.vec_scan_keys}};
for(const k in SUB){SUB[k].ret=-1;SUB[k].sp=-1;}
const {memory}=E;
function retOf(){return memory.read(cpu.sp,false)|(memory.read(cpu.sp+1,false)<<8);}
v06c.check_breakpoint=function(){const pc=cpu.pc;
  if(pc===ISR&&rd(L.vec_isr_depth)===0){if(cur)frames.push(cur);
    cur={t:{isr:TT},d:{},gs:rd(L.GameStatus),scene:L.vbp_scene===undefined?-1:rd(L.vbp_scene)};}
  if(!cur)return false;
  const n=byPc[pc];
  if(n&&cur.t[n]===undefined)cur.t[n]=TT;
  for(const k in SUB){const b=SUB[k];
    if(pc===b.pc&&b.ret<0){b.sp=cpu.sp;b.ret=retOf();b.t0=TT;}
    else if(b.ret>=0&&pc===b.ret&&cpu.sp>b.sp){b.ret=-1;if(cur.d[k]===undefined)cur.d[k]=TT-b.t0;}}
  return false;};
function keysFor(t){const k=[];
  if(t<900){if((t>>2)&1)k.push(32);}
  else if(t<1000){k.push(39);} else if(t<1010){k.push(78);}
  else if(t<1300){k.push(t&8?39:37);} else if(t<1310){k.push(78);}
  else if(t<1600){k.push(t&8?38:39);} else if(t<1640){k.push(78);}
  else if(t<2000){k.push(t&8?39:37);} else if(t<2060){k.push(78);}
  else {k.push(t&8?37:39);} return k;}
let held=new Set(),tick=0,nf=0;
const TIMER=L.timer;let prevT=rd(TIMER);
while(tick<=NT&&nf<400000){
  const want=new Set(keysFor(tick));
  for(const c of held)if(!want.has(c))E.key(c,0);
  for(const c of want)if(!held.has(c))E.key(c,1);
  held=want;
  v06c.oneInterrupt(true);nf++;
  const t=rd(TIMER);if(t!==prevT){prevT=t;tick++;}
}
if(cur)frames.push(cur);
const G=frames.filter(f=>f.gs===5&&f.t.out!==undefined);
function pct(a,p){if(!a.length)return NaN;const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*p))];}
function st(name,arr){if(!arr.length){console.log(name.padEnd(34)+" —");return;}
  const av=arr.reduce((a,b)=>a+b,0)/arr.length;
  console.log(name.padEnd(34)+"avg "+av.toFixed(0).padStart(6)+"  p50 "+String(pct(arr,.5)).padStart(6)+
    "  p90 "+String(pct(arr,.9)).padStart(6)+"  max "+String(pct(arr,1)).padStart(7)+"  n="+arr.length);}
const seg=(a,b)=>G.filter(f=>f.t[a]!==undefined&&f.t[b]!==undefined).map(f=>f.t[b]-f.t[a]);
const dur=k=>G.filter(f=>f.d[k]!==undefined).map(f=>f.d[k]);
console.log("кадров геймплея (GS=5) с пачкой: "+G.length+
  "  (из них в пирамиде vbp_scene=1: "+G.filter(f=>f.scene===1).length+")");
st("вход ISR (push'и, кап глубины)",seg("isr","snd"));
st("vsnd_sample (замер часов ВИ53)",dur("snd"));
st("проверка/применение палитры",seg("snd","bri").map((v,i)=>v).filter(()=>true).length?G.filter(f=>f.d.snd!==undefined&&f.t.bri!==undefined).map(f=>f.t.bri-f.t.snd-f.d.snd):[]);
st("  кадров с vsp_load",G.filter(f=>f.t.vsp!==undefined).map(f=>f.t.bri-f.t.vsp));
st("vec_brillo_pal (все кадры)",dur("bri"));
st("vec_brillo_pal (в пирамиде)",G.filter(f=>f.scene===1&&f.d.bri!==undefined).map(f=>f.d.bri));
st("глубина + push vw_* (bri..key)",G.filter(f=>f.d.bri!==undefined&&f.t.key!==undefined).map(f=>f.t.key-f.t.bri-f.d.bri));
st("vec_scan_keys",dur("key"));
console.log("---");
st("СТАРТ ПАЧКИ от IRQ",G.map(f=>f.t.out-f.t.isr));
st("СТАРТ ПАЧКИ (в пирамиде)",G.filter(f=>f.scene===1).map(f=>f.t.out-f.t.isr));
