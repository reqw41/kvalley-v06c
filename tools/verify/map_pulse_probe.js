// MAP-PULSE probe. Reaches the "PYRAMID'S MAP" screen (flagPiramideMap==2) via the
// natural stage-clear flow (poke GameStatus=8), then samples the sprite-plane palette
// indices 1/5/9/13 (io.Palette) EVERY frame while on the map, alongside the game's own
// colorPiramidMap RAM byte. The silhouette+arrow must PULSE: palette should cycle
// black(0x00)/dark-red(0x56)/yellow(0x76) in lock-step with colorPiramidMap.
// Saves a PNG for each distinct pulse phase seen (up to 3). Also reports p2 shadow (must
// be 0 on the map) so we prove the map is not broken.
const fs=require("fs"),vm=require("vm"),zlib=require("zlib");
const base="/Users/boris/Projects/vector06js";
const OUTDIR="/tmp/map_pulse";try{fs.mkdirSync(OUTDIR,{recursive:true});}catch(e){}
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
function p2sh(){let ps=0;for(let a=0xC900;a<0xD100;a++)if(rd(a))ps++;return ps;}
// classify a packed RGB palette entry into black / red / yellow / other
function classify(c){c>>>=0;const r=c&255,gg=(c>>8)&255,b=(c>>16)&255;
 if(r<70&&gg<70&&b<70)return"BLACK";
 if(r>150&&gg<140)return"RED";
 if(r>150&&gg>150)return"YELLOW";
 return`?(${r},${gg},${b})`;}
function palHex(idx){const c=io.Palette[idx]>>>0;return`${classify(c)}[rgb ${(c&255)},${(c>>8)&255},${(c>>16)&255}]`;}
const GS=S.GameStatus,SUB=S.subStatus,FPM=S.flagPiramideMap,CPM=S.colorPiramidMap;
console.log("syms GS=%s FPM=%s colorPiramidMap=%s",GS.toString(16),FPM.toString(16),CPM.toString(16));
// boot to menu
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
// reach gameplay (GS=5, fpm odd)
let reached=false;
for(let blk=0;blk<50 && !reached;blk++){
  for(let f=0;f<25;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);if(rd(GS)===5&&(rd(FPM)&1)){reached=true;break;}}
  keyboard.keyUp({keyCode:32,preventDefault(){}});
  for(let f=0;f<5;f++){v06c.oneInterrupt(true);if(rd(GS)===5&&(rd(FPM)&1)){reached=true;break;}}
}
console.log("reached gameplay=",reached,"GS=",rd(GS),"fpm=",rd(FPM));
// natural stage-clear -> map flow
wr(GS,8); wr(SUB,0);
// run until fpm==2 (map on screen)
let onmap=false;
for(let f=0;f<200 && !onmap;f++){v06c.oneInterrupt(true);if(rd(FPM)===2)onmap=true;}
console.log("onmap(fpm==2)=",onmap,"@GS=",rd(GS));
if(!onmap){console.log("FAILED to reach map");process.exit(2);}
// sample the map for many frames, watching the pulse
const seenPhase={};const rows=[];let saved=0;
for(let f=0;f<220;f++){
  const cpmPre=rd(CPM);               // colorPiramidMap value present before this frame's ISR
  v06c.oneInterrupt(true);
  if(rd(FPM)!==2)break;               // left the map
  // p3 arrow indices 1/5/9/13 ; p2 silhouette indices 2/6/10/14
  const k1=classify(io.Palette[1]>>>0),k5=classify(io.Palette[5]>>>0),k9=classify(io.Palette[9]>>>0),k13=classify(io.Palette[13]>>>0);
  const s2=classify(io.Palette[2]>>>0),s6=classify(io.Palette[6]>>>0),s10=classify(io.Palette[10]>>>0),s14=classify(io.Palette[14]>>>0);
  rows.push({f,cpmPre,k1,k5,k9,k13,s2,s6,s10,s14,ps:p2sh(),rgb1:io.Palette[1]>>>0,rgb2:io.Palette[2]>>>0});
  // save one PNG per distinct silhouette(idx2) phase from the CYCLING region (cpmPre!=0)
  if(cpmPre!==0 && !(s2 in seenPhase)&&saved<3){seenPhase[s2]=1;saved++;
    savepng(`${OUTDIR}/map_silhouette_${s2}_arrow_${k1}_cpm${cpmPre.toString(16)}_f${f}.png`);}
}
// compact timeline: print only frames where cpmPre / arrow(idx1) / silhouette(idx2) changes
console.log("--- pulse timeline (colorPiramidMap -> arrow idx1 | silhouette idx2 | p2sh) ---");
let prev=null;
for(const r of rows){
  const key=`${r.cpmPre}|${r.k1}|${r.s2}`;
  if(key!==prev){console.log(`f${String(r.f).padStart(3)} cpmPre=0x${r.cpmPre.toString(16)} -> arrow idx1=${r.k1}(rgb ${(r.rgb1&255)},${(r.rgb1>>8)&255},${(r.rgb1>>16)&255}) | silhouette idx2=${r.s2}(rgb ${(r.rgb2&255)},${(r.rgb2>>8)&255},${(r.rgb2>>16)&255}) | p2sh=${r.ps}`);prev=key;}
}
// best-lag correlation: expected color from cpmPre (1->BLACK,6->RED,else->YELLOW)
function expect(cpm){return cpm===1?"BLACK":cpm===6?"RED":"YELLOW";}
function bestlag(sel){let best={lag:0,m:-1};for(let lag=0;lag<=3;lag++){let m=0,t=0;for(let i=lag;i<rows.length;i++){t++;if(sel(rows[i])===expect(rows[i-lag].cpmPre))m++;}if(m>best.m)best={lag,m,t};}return best;}
const ba=bestlag(r=>r.k1),bs=bestlag(r=>r.s2);
const phA=new Set(rows.map(r=>r.k1)),phS=new Set(rows.map(r=>r.s2));
console.log("--- summary ---");
console.log(`arrow(idx1) best-lag correlation vs colorPiramidMap: ${ba.m}/${ba.t} at lag=${ba.lag}`);
console.log(`silhouette(idx2) best-lag correlation vs colorPiramidMap: ${bs.m}/${bs.t} at lag=${bs.lag}`);
console.log("distinct arrow(idx1) phases:",[...phA].join(", "));
console.log("distinct silhouette(idx2) phases:",[...phS].join(", "));
console.log("arrow 4 idx (1/5/9/13) equal every frame:",rows.every(r=>r.k1===r.k5&&r.k5===r.k9&&r.k9===r.k13));
const silUneq=rows.filter(r=>!(r.s2===r.s6&&r.s6===r.s10&&r.s10===r.s14));
console.log("silhouette 4 idx (2/6/10/14) equal:",rows.length-silUneq.length,"/",rows.length,"frames; unequal frames:",silUneq.slice(0,6).map(r=>`f${r.f}[${r.s2},${r.s6},${r.s10},${r.s14}]`).join(" "));
console.log("silhouette NOT black-square (idx2 != BLACK on >50% frames):", rows.filter(r=>r.s2!=="BLACK").length, "of", rows.length, "frames non-black");
console.log("max p2sh on map:",Math.max(...rows.map(r=>r.ps)),"(must be 0)");
console.log("frames sampled on map:",rows.length);
console.log("PNGs ->",OUTDIR);
