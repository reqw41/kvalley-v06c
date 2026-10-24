// frame_shift_proof.js — «ЭТАЛОНЫ КОНЦОВКИ ПРОТУХЛИ ОТ ПЕРЕКОМПОНОВКИ КАДРА, А НЕ ОТ
// ПОЛОМКИ РЕНДЕРА» (симметрия кадра, 2026-08-12).
//
// ЗАЧЕМ. Пересъёмка эталонов bonus_ending_gate — операция, которую нельзя делать «на
// глаз»: сдвинутая картинка и испорченная картинка одинаково краснят гейт. Этот прогон
// сверяет старый эталон с новым кадром ПОБЛОЧНО, со сдвигами, ПОСЧИТАННЫМИ из геометрии
// (а не подобранными), и обязан дать НОЛЬ расхождений — тогда пересъёмка законна.
// Порядок: сначала bonus_ending_gate (он кладёт текущие кадры в ref/ending/out/),
// потом этот прогон, и только потом bonus_ending_gate --update.
// Сверяет эталонный PNG (старая раскладка) с текущим (новая) по ТРЁМ блокам со СВОИМИ
// сдвигами, ПОСЧИТАННЫМИ из геометрии (r = vec_vscroll - lo), а не подобранными.
// bmp: 576x288, строка кадра r -> bmp y = r+16; пиксель Вектора удвоен по X.
//
// БЛОКИ ЗАДАЮТСЯ АРГУМЕНТАМИ --block y0:y1:sdvig (y — bmp-строки ТЕКУЩЕГО кадра, сдвиг —
// сколько прибавить, чтобы попасть в строку ЭТАЛОНА). Без аргументов берётся раскладка
// последней перекомпоновки (раунд 2, 2026-08-12: эталоны сняты при табло fb 23..16 и
// подписи fb 47..40, стали — табло fb 15..8, подпись fb 55..48, поле не двигалось):
//   поле fb 255..64  экранные строки 32..223  -> bmp  48..239, сдвиг  0 (не двигалось)
//   табло fb 15..8   экранные строки 16..23   -> bmp  32..39,  сдвиг -8 (уехало ВНИЗ)
//   подпись fb 55..48 экранные строки 232..239 -> bmp 248..255, сдвиг +8 (уехала ВВЕРХ)
// ИСТОРИЯ: раунд 1 (эталоны, что переснимались 2026-08-12 первым заходом) проверялся
// блоками поле 48..239/+8, табло 24..31/+16, низ 256..263/-16.
"use strict";
const fs=require("fs"),zlib=require("zlib");
const W=576,H=288;
function readPng(p){
  const b=fs.readFileSync(p); let off=8, idat=[];
  while(off<b.length){const len=b.readUInt32BE(off), typ=b.toString("latin1",off+4,off+8);
    if(typ==="IDAT")idat.push(b.subarray(off+8,off+8+len)); off+=12+len;}
  const raw=zlib.inflateSync(Buffer.concat(idat));
  const px=Buffer.alloc(W*H*3);
  for(let y=0;y<H;y++){
    const f=raw[y*(W*3+1)]; if(f!==0)throw new Error("фильтр "+f+" не поддержан");
    raw.copy(px,y*W*3,y*(W*3+1)+1,y*(W*3+1)+1+W*3);}
  return px;
}
const eq=(a,b,ya,yb)=>{let d=0,first=null;
  for(let x=0;x<W;x++){const ia=(ya*W+x)*3, ib=(yb*W+x)*3;
    if(a[ia]!==b[ib]||a[ia+1]!==b[ib+1]||a[ia+2]!==b[ib+2]){d++;if(!first)first=[x,ya];}}
  return {d,first};};
const black=(a,y)=>{let n=0;for(let x=0;x<W;x++){const i=(y*W+x)*3;if(a[i]|a[i+1]|a[i+2])n++;}return n;};

const args=process.argv.slice(2);
const dir=args.find(a=>!a.startsWith("--"))||"tools/verify/ref/ending";
const blocks=[];
for(let i=0;i<args.length;i++)if(args[i]==="--block"){
  const [a,b,d]=args[i+1].split(":").map(Number); blocks.push({a,b,d,n:`блок ${a}..${b}`});}
if(!blocks.length){
  blocks.push({a:48,b:239,d:0,n:"поле"},{a:32,b:39,d:-8,n:"табло"},{a:248,b:255,d:8,n:"подпись"});}
for(const ph of ["1_scene","2_door","3_walk","4_jump","5_bonus"]){
  const ref=readPng(`${dir}/${ph}.png`), cur=readPng(`${dir}/out/${ph}.png`);
  let bad=0, tot=0, notes=[];
  for(const bl of blocks)for(let y=bl.a;y<=bl.b;y++){
    const r=eq(cur,ref,y,y+bl.d);bad+=r.d;tot+=W;
    if(r.d&&notes.length<9)notes.push(`${bl.n} y=${y} расх ${r.d} первый x=${r.first[0]}`);}
  // всё остальное обязано быть чёрным в ТЕКУЩЕЙ картинке
  let dirt=0;
  const covered=y=>blocks.some(bl=>y>=bl.a&&y<=bl.b);
  for(let y=0;y<H;y++)if(!covered(y)){dirt+=black(cur,y);}
  console.log(`${ph}: сверено ${tot} пикселей по трём блокам, расхождений ${bad}; ` +
    `вне блоков ненулевых пикселей в НОВОМ кадре ${dirt}` + (notes.length?`\n   ${notes.join("\n   ")}`:""));
}
