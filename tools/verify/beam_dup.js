// Есть ли в пачке ДУБЛИРУЮЩИЕСЯ проходы по одному и тому же куску фреймбуфера?
// Для каждого объекта раскладываем его работу на (плоскость+столбец, lo0) и ищем
// пары объектов, покрывающие ОДНИ И ТЕ ЖЕ байты fb: их save/restore делается дважды.
const {make,toGame}=require("./beam_harness.js");
const T=__dirname;
const ROM=process.argv[2]||T+"/../../build/kvalley_8c.rom", SYM=process.argv[3]||T+"/../../build/kvalley_8c.sym";
const NF=+(process.argv[4]||4000);
const E=make(ROM,SYM);
if(toGame(E)!==5){console.log("нет геймплея");process.exit(1);}
const {L,rd,v06c,cpu}=E;
const OUT=L.vec_spr_out;
let dupPack=0,packs=0,dupBytes=0,packsN={},ex=null;
v06c.check_breakpoint=function(){
  if(cpu.pc!==OUT)return false;
  const n=rd(L.vsp_n); if(!n)return false;
  packs++;
  const own=new Map(); let dup=0; const pairs=new Set();
  for(let p=0;p<n;p++){
    const i=rd(L.vsp_list+p), pg=0xE000+i*256;
    if(rd(pg+0x96)===2)continue;
    const hi=rd(pg+0x97),lo=rd(pg+0x98),nc=rd(pg+0x99),hib=rd(pg+0x9A),hic=rd(pg+0x9B);
    for(const h of [hi,hib,hic]){ if(!h)continue;
      for(let c=0;c<nc;c++)for(let r=0;r<16;r++){
        const key=((h+c)<<8)|((lo+r)&255);
        if(own.has(key)){dup++;pairs.add(own.get(key)+"+"+i);} else own.set(key,i);}}
  }
  if(dup){dupPack++;dupBytes+=dup;
    for(const p of pairs)packsN[p]=(packsN[p]||0)+1;
    if(!ex){ex=[];for(let p=0;p<n;p++){const i=rd(L.vsp_list+p),pg=0xE000+i*256;
      ex.push(`слот ${i}: pending=${rd(pg+0x96)} hi0=${rd(pg+0x97).toString(16)} lo0=${rd(pg+0x98)} nc=${rd(pg+0x99)} hi0b=${rd(pg+0x9A).toString(16)} hi0c=${rd(pg+0x9B).toString(16)}`);}}}
  return false;};
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let held=-1;
for(let f=0;f<NF;f++){
  if(f%25===0){const ks=[37,39,38,40];const k=ks[(rnd()*4)|0];
    if(k!==held){if(held>0)E.key(held,0);E.key(k,1);held=k;}}
  if(f>0&&f%400===0){E.key(78,1);v06c.oneInterrupt(true);E.key(78,0);}
  v06c.oneInterrupt(true);
}
if(held>0)E.key(held,0);
console.log(`пачек=${packs}, с ДВОЙНЫМ покрытием fb=${dupPack} (${(100*dupPack/packs).toFixed(1)}%)`);
console.log(`дублированных байт fb всего=${dupBytes}, в среднем на такую пачку=${dupPack?(dupBytes/dupPack).toFixed(1):0}`);
console.log("пары слотов:");for(const k of Object.keys(packsN).sort((a,b)=>packsN[b]-packsN[a]))console.log(`  ${k}: ${packsN[k]} пачек`);
if(ex){console.log("пример пачки:");for(const s of ex)console.log("  "+s);}
