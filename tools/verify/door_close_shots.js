// Вход в пирамиду 1, снимки закрытия ворот. Старт F1+F3 (как toGame).
"use strict";
const fs=require("fs"),path=require("path");
const {make}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom";
const SYM=process.argv[3]||ROM.replace(/\.rom$/,".sym");
const DIR=process.argv[4]||T+"/../../docs/door_close_shots";
fs.mkdirSync(DIR,{recursive:true});

const E=make(ROM,SYM);
const {L,rd,v06c,key,pngFrom,idealBmp}=E;
const wr=(a,v)=>E.memory.write(a&0xffff,v&0xff,false);
const runf=n=>{for(let i=0;i<n;i++)v06c.oneInterrupt(true);};

function doorStatus(){
  // pyramidDoors: 7 байт на дверь, +4 = status (hi nibble state, lo nibble anim)
  const base=L.pyramidDoors;
  const out=[];
  for(let i=0;i<4;i++){
    const st=rd(base+i*7+4);
    if(rd(base+i*7)===0xff) continue;
    out.push({i,st,hi:(st>>4)&15,lo:st&15});
  }
  return out;
}
function heroRec(s){
  const pg=0xE000+s*256;
  return {pend:rd(pg+0x96),hi0:rd(pg+0x97),lo0:rd(pg+0x98),nc:rd(pg+0x99),
          hi0b:rd(pg+0x9F),hi0c:rd(pg+0x9B)};
}
function shot(name,extra){
  const f=path.join(DIR,name+".png");
  pngFrom(idealBmp(),f);
  const ds=doorStatus().map(d=>`${d.i}:${d.hi.toString(16)}${d.lo.toString(16)}`).join(" ");
  const h4=heroRec(4), h5=heroRec(5);
  console.log(`${name}  GS=${rd(L.GameStatus)} sub=${rd(L.subStatus)} entra=${rd(L.statusEntrada)} `+
    `Y=${rd(L.ProtaY)} X=${rd(L.ProtaX)} doors[${ds}] `+
    `s4 p=${h4.pend} nc=${h4.nc} hi=${h4.hi0.toString(16)} lo=${h4.lo0} `+
    `s5 p=${h5.pend} nc=${h5.nc}`+(extra?"  "+extra:""));
  return f;
}

console.log("boot…");
runf(400);
key(112,1); key(114,1); // F1+F3 — старт партии с читами
for(let i=0;i<80 && rd(L.GameStatus)!==4 && rd(L.GameStatus)!==5;i++) runf(8);
key(112,0); key(114,0);
console.log("after F1+F3  GS="+rd(L.GameStatus)+" pyr="+rd(L.piramideActual));

// Ждём InitStage (GS=4) или уже геймплей
let frames=0;
const seen=new Set();
let n=0;
while(frames<900){
  const gs=rd(L.GameStatus);
  const st=rd(L.statusEntrada);
  const doors=doorStatus();
  const closing=doors.find(d=>d.hi===5); // 0x50 = закрывается
  const keyD=closing?`c${closing.lo}`:`g${gs}e${st}`;
  if(!seen.has(keyD) && (gs===4 || (gs===5 && closing) || gs===4)){
    seen.add(keyD);
    shot(String(n++).padStart(2,"0")+"_gs"+gs+"_e"+st+(closing?"_c"+closing.lo:""),
         "pyr="+rd(L.piramideActual));
  }
  if(gs===5 && st>=1 && !closing) break; // уже внутри, дверь закрылась
  runf(1);
  frames++;
}
shot(String(n++).padStart(2,"0")+"_end","frames="+frames);
console.log("done, "+n+" shots in "+DIR);
