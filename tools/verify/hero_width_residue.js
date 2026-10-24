// Regression: level 1, jump right past two mummies at the right stair mouth.
// At the failing frame clothing spans 3 byte columns, skin only 2. vop_ow used
// to clear an unsaved p0 bit at 0x96C1; it then became permanent background.
// This controls SAT at tickGame, retaining native rendering/IRQ scheduling.
// Usage: node tools/verify/hero_width_residue.js [rom] [sym] [--expect-bug]
'use strict';
const path = require('path');
const {make, toGame} = require('./beam_harness.js');
const base = path.resolve(__dirname, '../../build/kvalley_8c');
const E = make(process.argv[2] || base + '.rom', process.argv[3] || base + '.sym');
const {L, rd, memory, cpu, v06c} = E;
const wr = (a, v) => memory.write(a & 65535, v & 255, false);
if (toGame(E) !== 5) throw Error('No gameplay');
E.run(120);
const attrs = (i, y, x, pat, col) => [y,x,pat,col].forEach((v,k) => wr(L.sprAttrib + 4*i+k,v));
const hide = () => {for (let i=0;i<21;i++) wr(L.sprAttrib+4*i,0xe0);};
// Replace game logic in RAM only, before the controlled scene starts.
[0xcd,L.vec_nat_sprites&255,L.vec_nat_sprites>>8,0xc9].forEach((v,i) => wr(L.tickGame+i,v));
hide(); E.run(40);
const clean = Uint8Array.from({length:0x6000},(_,i) => rd(0x8000+i));
const heights = [0]; let h=0;
const table=[];
for(let i=0;i<32;i++){const v=rd(L.valoresSalto+i);if(v===254)break;table.push(v);}
if(table.length!==12)throw Error('Unexpected jump table');
const steps=[...table,...table.slice().reverse()];
for(let i=0;i<steps.length;i+=2){for(let k=0;k<2;k++)h+=(i+k<table.length?1:-1)*steps[i+k];heights.push(h);}
const terrain = x => 72 + Math.max(0,Math.min(40,x-152));
let ticks=0, draws=0;
v06c.check_breakpoint=()=>{
  if(cpu.pc===L.vop_ow || cpu.pc===L.vec_spr_show)draws++;
  if(cpu.pc!==L.tickGame)return false;
  const t=ticks++;
  if(t>=48){hide();return false;}
  const j=t-16, air=j>=0&&j<12, x=148+2*(t-16);
  const frame=air?2:((t>>1)&7), pat=[8,0,16,8,0,16,0,16][frame];
  const y=72-(air?heights[j]:0)-2+(frame&1);
  attrs(4,y,x,pat,14); attrs(5,y,x,pat+4,6);
  const x2=148-2*(t-16)+8, mp=0x28+4*((t>>2)%3);
  attrs(6,terrain(x)-2,x,mp,15); attrs(7,terrain(x2)-2,x2,mp+0x60,4);
  return false;
};
for(let f=0;f<320&&ticks<54;f++)E.run(1);
if(ticks<54||draws<20)throw Error('Insufficient scene coverage');
v06c.check_breakpoint=()=>false;
E.run(128);
let bytes=0,bits=0;const first=[];
for(let p=0;p<3;p++)for(let c=0;c<32;c++)for(let lo=64;lo<256;lo++){
  const i=p*8192+c*256+lo, value=rd(0x8000+i), d=value^clean[i];
  if(!d)continue;
  bytes++;for(let v=d;v;v>>=1)bits+=v&1;
  if(first.length<8)first.push({addr:(0x8000+i).toString(16),expected:clean[i],actual:value});
}
console.log(JSON.stringify({ticks,draws,bytes,bits,first}));
const expectedBug=process.argv.includes('--expect-bug');
const ok=expectedBug?bits===1&&first[0]?.addr==='96c1':bits===0;
console.log(ok?'PASS':'FAIL');process.exitCode=ok?0:1;
