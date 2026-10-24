// ПРОФИЛЬ ИГРОВОЙ ЛОГИКИ ПО ВЫЗОВАМ (inclusive), в тактах, на статике.
// Профиль по меткам показывает, ГДЕ горит время, но не показывает, КТО его тратит:
// одна игровая процедура размазана по десятку меток. Здесь считается время ВНУТРИ
// вызова (вместе со всем, что он позвал) — так видна структура тика.
// Вход в процедуру ловим по паре (PC == адрес символа, предыдущая команда — call),
// выход — по возврату SP выше уровня входа.
const {make,toGame}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {cpu,run,rd,L,key,memory}=E;
const FRAME=59904;
const byAddr={};
for(const [k,v] of Object.entries(L)) if(v>=0x100&&v<0x6800&&byAddr[v]===undefined) byAddr[v]=k;
const SKIP=/^vec_isr|^vsnd_|^updateSound|^musicCh|^MusicChan|^processSnd|^switchCh|^SetPSG|^WRTPSG|^RDVDP|^mixer|^vec_scan_keys|^vec_vi_ch|^vec_flushvi/;
const TIP=L.tickInProgress, CP=L.vbt8_cp;
let inStep=false,cyc=0,blits=0,steps=[],acc=null;
const stack=[];
const owr=memory.write.bind(memory);
memory.write=function(a,v,s){const aa=a&0xffff;
  if(aa===TIP){ if((v&255)&1){inStep=true;cyc=0;blits=0;acc={};stack.length=0;}
                else if(inStep){inStep=false;steps.push([cyc,blits,acc]);} }
  return owr(a,v,s);};
let prevWasCall=false, prevPc=0;
const isCall=op=>op===0xCD||(op&0xC7)===0xC4;   // CALL nn и Rcc nn
const orig=cpu.instruction.bind(cpu);
cpu.instruction=function(){
  const pc=cpu.pc&0xffff, sp=cpu.sp&0xffff;
  if(inStep){
    while(stack.length && sp>stack[stack.length-1].sp){ const f=stack.pop();
      acc[f.name]=(acc[f.name]||0)+(cyc-f.t0); }
    if(prevWasCall){ const n=byAddr[pc];
      if(n && !SKIP.test(n)) stack.push({name:n, sp, t0:cyc}); }
  }
  const op=memory.read(pc)&0xff;
  const t=orig();
  if(inStep){ cyc+=t; if(pc===CP) blits++; }
  prevWasCall=isCall(op); prevPc=pc;
  return t;
};
toGame(E); run(120);
for(const d of [39,37,39,38,32]){ key(d,1); run(300); key(d,0); run(50); }
const st=steps.filter(s=>s[1]<200);
const heavy=st.filter(s=>s[0]>FRAME&&s[0]<4*FRAME);
const show=(title,arr)=>{
  const agg={}; for(const [,,h] of arr) for(const [k,v] of Object.entries(h)) agg[k]=(agg[k]||0)+v;
  const avgLen=arr.reduce((a,b)=>a+b[0],0)/arr.length;
  console.log(`\n${title} (${arr.length} шагов, средняя длина ${Math.round(avgLen)} тактов):`);
  for(const [k,v] of Object.entries(agg).sort((a,b)=>b[1]-a[1]).slice(0,34)){
    const a=v/arr.length; if(a<200) continue;
    console.log(`  ${String(Math.round(a)).padStart(6)} т  ${(100*a/FRAME).toFixed(1).padStart(5)}% кадра  ${k}`);
  }
};
show("ТЯЖЁЛЫЙ ШАГ, время внутри вызова", heavy);
show("ВСЕ ШАГИ СТАТИКИ", st);
