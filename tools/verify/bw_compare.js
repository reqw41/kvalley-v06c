#!/usr/bin/env node
'use strict';
// Сравнение состояния игры по логическим тикам и счёта тиков звука: основа против новой сборки.
const fs=require('fs'),zlib=require('zlib'),path=require('path');
const [A,B]=[process.argv[2],process.argv[3]];
const out={};
for(const f of fs.readdirSync(A).filter(f=>f.endsWith('.trace.json.gz'))){
  const a=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(A,f)))),b=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(B,f))));
  const n=Math.min(a.states.length,b.states.length);let same=0,diff=0,first=null;
  const key=s=>JSON.stringify({gs:s.game_status,hero:s.hero,mum:s.mummies??null});
  for(let i=0;i<n;i++){if(key(a.states[i])===key(b.states[i]))same++;else{diff++;if(first===null)first={i,tick:a.states[i].tick,a:key(a.states[i]).slice(0,200),b:key(b.states[i]).slice(0,200)};}}
  const frames=s=>s.steps.reduce((x,y)=>x+y.frames,0);
  out[a.scene]={states_a:a.states.length,states_b:b.states.length,compared:n,same,diff,first_diff:first,snd_ticks_a:a.snd_ticks,snd_ticks_b:b.snd_ticks,frames_a:frames(a),frames_b:frames(b),
    snd_per_frame_a:a.snd_ticks/frames(a),snd_per_frame_b:b.snd_ticks/frames(b)};
}
fs.writeFileSync(process.argv[4],JSON.stringify(out,null,1));
for(const [k,v] of Object.entries(out))console.log(k.padEnd(20),'states',v.compared,'diff',v.diff,'snd',v.snd_ticks_a,v.snd_ticks_b,'frames',v.frames_a,v.frames_b,'snd/frame',v.snd_per_frame_a.toFixed(4),v.snd_per_frame_b.toFixed(4));
