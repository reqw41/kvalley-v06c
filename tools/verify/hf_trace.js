// задача hud-flicker, см. outputs/hud-flicker/REPORT.md
// Доказательство механизма: для байтов, испорченных "промежуточным цветом", трасса записей:
// адрес, PC (метка), такт от кадрового IRQ, строка луча, плоскость, значения.
const {runScene,analyze,FR}=require('./hf_stand.js');const {symtab}=require('./hf_cls.js');
const [rom,sym,mode,tk,x,hy,maxn]=process.argv.slice(2);
const r=runScene(rom,sym,{mode,ticks:+tk,x:+x,hy:+hy,journal:true,runw:10});const a=analyze(r);
const L=r.E.L,VS=L.vec_vscroll,near=symtab(L),W=576;const out=[];
for(const A of a){if(A.f<30||!A.bad.length)continue;const f=A.f;
  const bytes=new Set();A.bad.forEach(p=>{const y=(p/W)|0,xx=p%W;bytes.add((((xx-32)>>1)>>3)+':'+((VS-(y-16))&255));});
  for(const key of bytes){const [col,lo]=key.split(':').map(Number);const beam=(40+((VS-lo)&255))*192-44;
    const ws=r.journal.filter(j=>(j[0]===f||j[0]===f-1)&&((j[3]>>8)&31)===col&&(j[3]&255)===lo).map(j=>({frame:j[0],cyc:j[1],line:Math.floor(j[1]/192),pc:near(j[2]),addr:'0x'+j[3].toString(16),plane:(j[3]>>13)-4,new:j[4],old:j[5]}));
    out.push({frame:f,col,lo,beam_cyc:beam,beam_line:Math.floor(beam/192),writes:ws});
    if(out.length>=+maxn)break;}
  if(out.length>=+maxn)break;}
console.log(JSON.stringify(out,null,1));
