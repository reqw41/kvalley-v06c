// GRAY-STRIPE transition probe (NATURAL path).
// The boot->first-gameplay sequence passes menu -> MAP screen (setupPergamino) ->
// stage (setupStage). We render EVERY frame from the START press onward with the
// ISR LIVE (PALVBL deferred palette timing active), logging per frame:
//   GameStatus/subStatus, flagPiramideMap, vec_pal_pending, ACTIVE palette
//   (io.Palette[2]: gray 0xF6 => p2 VISIBLE A+ ; red 0x5F => p2 INVISIBLE menu),
//   p2 pat_shadow non-zero bytes, center-column gray-stripe score.
// Saves a PNG for every frame that shows a gray center stripe (+ dumps a timeline).
const fs=require("fs"),vm=require("vm"),zlib=require("zlib");
const base="/Users/boris/Projects/vector06js";
const OUTDIR="/tmp/stripe_probe";try{fs.mkdirSync(OUTDIR,{recursive:true});}catch(e){}
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2],sym=process.argv[3];
const S={};for(const l of fs.readFileSync(sym,"latin1").split("\n")){const m=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(m)S[m[1]]=parseInt(m[2],16);}
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
const rd=a=>memory.read(a&0xffff),wr=(a,v)=>memory.write(a&0xffff,v);
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
function savepng(o){const bmp=v06c.bmp,rgb=Buffer.alloc(W*H*3);for(let i=0;i<W*H;i++){const c=bmp[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
fs.writeFileSync(o,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));}
function stripeScore(){const bmp=v06c.bmp;let bestRun=0,run=0,bestX=-1;
 for(let x=0;x<W;x++){let gray=0,tot=0;for(let y=40;y<H-40;y++){const c=bmp[y*W+x]>>>0;const r=c&255,gg=(c>>8)&255,b=(c>>16)&255;tot++;if(Math.abs(r-192)<40&&Math.abs(gg-192)<40&&Math.abs(b-192)<40)gray++;}
  const frac=gray/tot;if(frac>0.30){run++;if(run>bestRun){bestRun=run;bestX=x-run;}}else run=0;}
 return{bestRun,bestX};}
function p2stats(){let ps=0,p2=0;for(let a=0xC900;a<0xD100;a++)if(rd(a))ps++;for(let a=0xC000;a<0xE000;a++)if(rd(a))p2++;return{ps,p2};}
function palKind(){const c=io.Palette[2]>>>0;const r=c&255,gg=(c>>8)&255,b=(c>>16)&255;
 if(Math.abs(r-192)<40&&Math.abs(gg-192)<40)return"A+gray";
 if(r>180&&gg<140&&b<120)return"menuRED";return`?(${r},${gg},${b})`;}
const GS=S.GameStatus,SUB=S.subStatus,FPM=S.flagPiramideMap,PEND=S.vec_pal_pending;
function rec(f){const ps=p2stats(),ss=stripeScore();return{f,GS:rd(GS),sub:rd(SUB),fpm:rd(FPM),pend:rd(PEND),pal:palKind(),ps:ps.ps,run:ss.bestRun,x:ss.bestX};}
function line(r){return`f${r.f} GS=${r.GS} sub=${r.sub} fpm=${r.fpm} pend=${r.pend} pal=${r.pal} p2sh=${r.ps} stripe(run=${r.run}@x${r.x})`;}
// boot to menu
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
console.log("MENU",line(rec(-1)));
// reach in-pyramid gameplay (GS=5, fpm odd) via SPACE presses
let reached=false;
for(let blk=0;blk<50 && !reached;blk++){
  for(let f=0;f<25;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);if(rd(GS)===5&&(rd(FPM)&1)){reached=true;break;}}
  keyboard.keyUp({keyCode:32,preventDefault(){}});
  for(let f=0;f<5;f++){v06c.oneInterrupt(true);if(rd(GS)===5&&(rd(FPM)&1)){reached=true;break;}}
}
// walk right a bit so hero/mummies populate sprite planes p2/p3
for(let f=0;f<30;f++){keyboard.keyDown({keyCode:39,preventDefault(){}});v06c.oneInterrupt(true);}keyboard.keyUp({keyCode:39,preventDefault(){}});for(let f=0;f<15;f++)v06c.oneInterrupt(true);
console.log("REACHED",reached,line(rec(-1)));
// Trigger the natural STAGE-CLEAR transition: GameStatus=8 (stageClear) runs the
// game's own pergamino/map flow (setGameMode->GS4->showMap->cortinilla->setupPergamino).
wr(GS,8); wr(SUB,0);
console.log("POKE GS=8 (stageClear)",line(rec(-1)));
const timeline=[];
for(let f=0;f<300;f++){
  v06c.oneInterrupt(true);
  const r=rec(f);timeline.push(r);
  if(r.run>=6){savepng(`${OUTDIR}/f${String(f).padStart(3,'0')}_run${r.run}_x${r.x}_${r.pal}_gs${r.GS}.png`);}
}
// print compact timeline: only frames where GS/sub/pal/pend or stripe changes
let prev=null;
for(const r of timeline){
  const key=`${r.GS}|${r.sub}|${r.fpm}|${r.pend}|${r.pal}|${r.run>=6}`;
  if(key!==prev){console.log(line(r));prev=key;}
}
// also always print any frame with a stripe
console.log("--- stripe frames ---");
for(const r of timeline)if(r.run>=6)console.log(line(r));
console.log("PNGs ->",OUTDIR);
