// FAITHFUL proof: reach real gameplay (hero+mummies in sprite planes p2/p3),
// then trampoline-CALL the REAL map-setup routine setupPergamino (same code the
// inter-level map runs), then render the frozen frame with the CPU PARKED (no
// game logic) so the picture reflects exactly what setupPergamino left in VRAM.
// BASE: gameplay sprite leftover bleeds into the map. FIX (HideSprites added to
// setupPergamino): planes cleared, leftover gone.
const fs=require("fs"),vm=require("vm"),zlib=require("zlib");const base="/Users/boris/Projects/vector06js";
const g={};g.window=g;g.document={createElement:()=>fc(),getElementById:()=>fc()};
function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),drawImage:()=>{},fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
g.requestAnimationFrame=()=>0;g.setTimeout=()=>0;g.print=()=>0;g.console=console;
const ctx=vm.createContext(g);
for(const f of ["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"]) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
const rom=process.argv[2],sym=process.argv[3],out=process.argv[4];
const S={};for(const l of fs.readFileSync(sym,"latin1").split("\n")){const m=l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);if(m)S[m[1]]=parseInt(m[2],16);}
const memory=new ctx.Memory(),keyboard=new ctx.Keyboard(),timer=new ctx.I8253(),ay=new ctx.AY(),floppy=new(ctx.Floppy().FD1793)(),io=new ctx.IO(keyboard,timer,memory,ay,floppy);
const cpu=new ctx.I8080(memory,io),tape={advance:()=>{},sample:0,reset:()=>{}},v06c=new ctx.Vector06c(cpu,memory,io,ay,tape);
const W=576,H=288;v06c.bmp=new Uint32Array(W*H);v06c.displayFrame=()=>{};v06c.check_breakpoint=()=>false;v06c.dbg=null;if(v06c.soundnik)v06c.soundnik.soundStep=()=>{};
const img=new Uint8Array(fs.readFileSync(rom));memory.init_from_array(img.subarray(0,0x10000),0x100);memory.detach_boot&&memory.detach_boot();
cpu.pc=0x100;cpu.sp=0xc300;cpu.iff=false;
// АДРЕСА ПЕРЕЕЗЖАЛИ (0x6B00 -> 0x6C00 -> 0x7092): берём из .sym по имени, не зашитыми числами.
function need(name){if(!(name in S)){console.error(`нет символа "${name}" в ${sym}`);process.exit(2);}return S[name];}
const GS=need("GameStatus"),FPM=need("flagPiramideMap");const rd=a=>memory.read(a),wr=(a,v)=>memory.write(a,v);
const m8=new Uint8Array(memory.bytes.buffer);
function planeNZ(){let n2=0,n3=0;for(let w=0x2000;w<0x4000;w++){if(m8[w*4+2])n2++;if(m8[w*4+3])n3++;}return{n2,n3};}
function savepng(o){const bmp=v06c.bmp,rgb=Buffer.alloc(W*H*3);for(let i=0;i<W*H;i++){const c=bmp[i]>>>0;rgb[i*3]=c&255;rgb[i*3+1]=(c>>8)&255;rgb[i*3+2]=(c>>16)&255;}
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xff]^(c>>>8);return c^0xffffffff;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tt)>>>0);return Buffer.concat([l,tt,c]);}
const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;rgb.copy(raw,y*(W*3+1)+1,y*W*3,(y+1)*W*3);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
fs.writeFileSync(o,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));}
// 1) boot + reach gameplay
// flagPiramideMap теперь СЧЁТЧИК, а не флаг (bit0: нечёт=в пирамиде/геймплей, чёт=карта) — сверка по чётности.
for(let f=0;f<400;f++)v06c.oneInterrupt(true);
for(let blk=0;blk<40 && !(rd(GS)===5&&(rd(FPM)&1));blk++){for(let f=0;f<25;f++){keyboard.keyDown({keyCode:32,preventDefault(){}});v06c.oneInterrupt(true);}keyboard.keyUp({keyCode:32,preventDefault(){}});for(let f=0;f<5;f++)v06c.oneInterrupt(true);}
for(let f=0;f<40;f++){keyboard.keyDown({keyCode:39,preventDefault(){}});v06c.oneInterrupt(true);}keyboard.keyUp({keyCode:39,preventDefault(){}});for(let f=0;f<30;f++)v06c.oneInterrupt(true);
console.log("gameplay plane",planeNZ());
// 2) trampoline CALL setupPergamino ; HALT   (faithful map-setup)
const A_setupPergamino=need("setupPergamino"),A_updateSprites=need("updateSprites");
wr(0,0xCD);wr(1,A_setupPergamino&0xFF);wr(2,(A_setupPergamino>>8)&0xFF);wr(3,0x76);
cpu.pc=0;cpu.iff=false;
for(let n=0;n<2000000;n++){if(rd(cpu.pc)===0x76)break;cpu.instruction();}
// 3) run one updateSprites tick like the real map does (tickPergamino->updateSprites)
//    to let map sprites draw AND any leftover-erase happen, faithfully.
wr(0,0xCD);wr(1,A_updateSprites&0xFF);wr(2,(A_updateSprites>>8)&0xFF);wr(3,0x76);
cpu.pc=0;
for(let n=0;n<2000000;n++){if(rd(cpu.pc)===0x76)break;cpu.instruction();}
console.log("after setup+updateSprites plane",planeNZ());
// 4) render frozen frame: park CPU at HALT, iff off, no game logic runs
wr(4,0x76);cpu.pc=4;cpu.iff=false;cpu.halted=false;
for(let f=0;f<3;f++)v06c.oneInterrupt(true);
savepng(out);
console.log("render ->",out,"final plane",planeNZ());
