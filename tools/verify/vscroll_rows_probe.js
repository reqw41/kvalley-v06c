// ПРОВЕРКА ПЕРЕД СДВИГОМ КАРТИНКИ НА 8 px (vec_vscroll 0x27 -> 0x2F).
// Сдвиг переносит строки fb 47..40 из-под поля НАВЕРХ кадра. Если в них есть хоть один
// непустой байт, он вылезет над табло. Здесь эти строки читаются из ЖИВОЙ игры во всех
// ТРЁХ видимых плоскостях (p3 в этой схеме не отображается — палитра схлопнута по её биту).
// Заодно печатаются соседние группы, которые тоже меняют место: fb 55..48 и fb 39..16.
"use strict";
const {make}=require("./beam_harness.js");
const E=make(process.argv[2],process.argv[3]);
const {L,rd,v06c,memory,keyboard}=E;
const wr=(a,v)=>memory.write(a&0xffff,v&255,false);
function tick(){const t0=rd(L.timer);do v06c.oneInterrupt(true);while(rd(L.timer)===t0);}
for(let i=0;i<700;i++)v06c.oneInterrupt(true);
for(let i=0;i<30;i++){E.key(32,1);for(let j=0;j<3;j++)v06c.oneInterrupt(true);E.key(32,0);for(let j=0;j<3;j++)v06c.oneInterrupt(true);}
let f=0;while(f<1500&&rd(L.GameStatus)!==5){v06c.oneInterrupt(true);f++;}
if(rd(L.GameStatus)!==5){console.log("ГЕЙТ ПРОВАЛЕН: до геймплея не дошли");process.exit(2);}
for(let i=0;i<60;i++)tick();
keyboard.keyDown({keyCode:39,which:39,preventDefault(){},stopPropagation(){}});
const PLANES=[[0x80,"p0"],[0xA0,"p1"],[0xC0,"p2"]];
const GROUPS=[[40,47,"fb 47..40 — УЕЗЖАЮТ НАВЕРХ"],[48,55,"fb 55..48 — метка версии (только титул)"],
              [16,39,"fb 39..16 — верхнее поле"],[56,63,"fb 63..56 — (c)KONAMI, остаётся под полем"]];
const dirty={}; let frames=0;
for(let n=0;n<400;n++){ v06c.oneInterrupt(true); frames++;
  if(n%7)continue;
  for(const [lo,hi,name] of GROUPS)for(const [pb,pn] of PLANES)for(let col=0;col<32;col++)
    for(let y=lo;y<=hi;y++){const v=rd(((pb+col)<<8)|y); if(v){const k=`${name} | ${pn}`;
      dirty[k]=dirty[k]||{n:0,ex:new Set()}; dirty[k].n++; if(dirty[k].ex.size<4)dirty[k].ex.add(`col${col} fb${y}=0x${v.toString(16)}`);}}
}
console.log(`кадров просмотрено ${frames}, снимков ${Math.ceil(400/7)}, столбцов 32, плоскости p0/p1/p2`);
let bad=0;
for(const [lo,hi,name] of GROUPS){
  const rows=PLANES.map(([pb,pn])=>{const k=`${name} | ${pn}`;return dirty[k]?`${pn}: ${dirty[k].n} непустых (${[...dirty[k].ex].join(", ")})`:`${pn}: ЧИСТО`;});
  const clean=rows.every(r=>r.endsWith("ЧИСТО"));
  if(name.startsWith("fb 47..40")&&!clean)bad=1;
  console.log(`${clean?"OK  ":"ЕСТЬ"} ${name}`);
  rows.forEach(r=>console.log("        "+r));
}
console.log(bad?"СДВИГ НЕЛЬЗЯ: строки 47..40 не пусты":"СДВИГ МОЖНО: строки 47..40 пусты во всех трёх плоскостях");
process.exit(bad?1:0);
