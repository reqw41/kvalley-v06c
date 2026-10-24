// УСТОЙЧИВАЯ метрика: сколько КОМАНД тратится на адресацию слотов, на один игровой тик.
// Доля «не влезло» между сборками несравнима — ускорение меняет ход игры и траекторию.
// Здесь считаются команды внутри самих процедур адресации, делённые на число тиков.
const {make,toGame}=require("./beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
const {cpu,run,rd,L,key,memory}=E;
const syms=Object.entries(L).filter(([k,v])=>v>=0x100&&v<0x6800).sort((a,b)=>a[1]-b[1]);
const addrs=syms.map(x=>x[1]);
const near=pc=>{let l=0,h=addrs.length-1,r=0;while(l<=h){const m=(l+h)>>1;if(addrs[m]<=pc){r=m;l=m+1}else h=m-1}return syms[r][0];};
const WANT=new Set(["vec_su_ptr","vec_su_setidx","vsu_ptr_a","vsp_hl"]);
const TIP=L.tickInProgress;
let ticks=0,cost=0,total=0,inStep=false;
const owr=memory.write.bind(memory);
memory.write=function(a,v,s){ if((a&0xffff)===TIP){ if((v&255)&1){inStep=true;ticks++;} else inStep=false; } return owr(a,v,s); };
const orig=cpu.instruction.bind(cpu);
cpu.instruction=function(){ if(inStep){ total++; if(WANT.has(near(cpu.pc&0xffff))) cost++; } return orig(); };
toGame(E); run(120);
for(const d of [39,37,39,38,32]){ key(d,1); run(300); key(d,0); run(50); }
console.log(`тиков ${ticks}: команд всего ${(total/ticks).toFixed(1)}/тик, из них адресация слотов ${(cost/ticks).toFixed(1)} = ${(100*cost/total).toFixed(1)}%`);
