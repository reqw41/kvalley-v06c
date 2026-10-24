// lo_align.js — гейт поведения по тикам, НЕ зависящий от скорости кадров: старт тиков с кадра, где GS впервые стал 5
// (у lo_gate старт по кадрам, и сборка с другим темпом получает сдвиг тика 0 — ложное расхождение).
// node tools/verify/lo_align.js tools/verify <a.rom> <a.sym> <b.rom> <b.sym> <сценарии...>
const TV=process.argv[2];const BH=require(TV+"/beam_harness.js");
BH.toGame=function(E){const {run,key,rd,L}=E;run(400);key(112,1);key(114,1);
 for(let i=0;i<640&&rd(L.GameStatus)!==5;i++)run(1);key(112,0);key(114,0);
 for(let i=0;i<4000&&rd(L.GameStatus)!==5;i++)run(1);return rd(L.GameStatus);};
const {runScenario,diffSnaps}=require(TV+"/lo_lib.js");const {scenarios}=require(TV+"/lo_scen.js");
const [,, ,ra,sa,rb,sb,...names]=process.argv;
for(const n of names){const s1=scenarios().find(x=>x.name===n),s2=scenarios().find(x=>x.name===n);
 const A=runScenario(ra,sa,s1,{}),B=runScenario(rb,sb,s2,{});
 const pre=R=>R.steps.filter(x=>x.g===undefined).length;
 const d=diffSnaps(A,B,A.ranges,A.L);
 console.log(JSON.stringify({scen:n,boot:s1.boot,ticks:[A.snaps.length,B.snaps.length],frames:[A.framesTotal,B.framesTotal],equal:!d,first:d}));}
