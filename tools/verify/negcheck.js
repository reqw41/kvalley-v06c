// Негативный контроль: убедиться, что прогон реально доходит до геймплея.
const {make,toGame}=require("./beam_harness.js");
const E=make(process.argv[2]||"build/kvalley_8c.rom",process.argv[3]||"build/kvalley_8c.sym");
const {run,key,rd,L}=E;
const status = toGame(E);
console.log("GameStatus после toGame:", status, status===5 ? "OK (геймплей)" : "ПРОВАЛ — не геймплей!");
let steps=0;
const TIP=L.tickInProgress;
let inStep=false;
const memory=E.memory;
const owr=memory.write.bind(memory);
memory.write=function(a,v,s){const aa=a&0xffff;
  if(aa===TIP){ if((v&255)&1){inStep=true;} else if(inStep){inStep=false;steps++;} }
  return owr(a,v,s);};
for(const d of [39,37,39,38,32]){ key(d,1); run(300); key(d,0); run(50); }
console.log("шагов логики собрано за контрольный прогон:", steps, steps>0 ? "OK" : "ПРОВАЛ — ноль шагов!");
