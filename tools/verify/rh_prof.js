// rh_prof.js - задача apex-fast: смены меток PC (hf_cls.js symtab) за кадры f-1..f; время = такт от начала кадра f-1 (кадр f начинается с 59904).
// usage: node rh_prof.js <rom> <sym> <кадр> <hy> <x> <dx0> <dx1>
const T=__dirname+'/';
const {runScene,FR}=require(T+'hf_stand.js');const {symtab}=require(T+'hf_cls.js');
const [rom,sym,fsel,hy,x,m0,m1]=process.argv.slice(2);
const evs=[];let nm=null;let last=null;
const r=runScene(rom,sym,{mode:'run',ticks:400,x:+x,hy:+hy,mummy:true,dx0:+m0,dx1:+m1,runw:10,pcHook:(pc,f,cyc,E)=>{if(f<+fsel-1||f>+fsel)return;if(!nm)nm=symtab(E.L);const n=nm(pc);if(n!==last){evs.push([f*FR+cyc,n]);last=n;}}});
const base=(+fsel)*FR;
// compress: print segments with start time relative to frame fsel, merging within 100 cycles
let out=[];for(let i=0;i<evs.length;i++){const t=evs[i][0]-(+fsel-1)*FR;out.push(t+' '+evs[i][1]);}
console.log(out.filter((_,i)=>true).join('\n'));
