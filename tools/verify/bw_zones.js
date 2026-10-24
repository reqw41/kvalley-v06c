#!/usr/bin/env node
'use strict';
// Мерцание по зонам экрана: HUD сверху (экранные строки r 0..47), поле, низ (r 240..255), отдельно Y=48..63 как в beam_order.
// Объекто-случай = (пачка, слот) с хотя бы одним попаданием луча в окно restore->show в этой зоне.
// Использование: node bw_zones.js <каталог трасс> <out.json>
const fs=require('fs'),zlib=require('zlib'),path=require('path');
const DIR=process.argv[2];
const api=require('./bw_lib.js')(DIR);
const VS=0x2F;
const zoneOf=lo=>{const r=(VS-lo)&255;return r<48?'hud':r>=240?'bottom':'field';};
const Z=['hud','field','bottom','y48_63'];
const tot={};Z.forEach(z=>tot[z]={objects:0,pixels_bytes:0,frames:new Set(),windows:0});
const per={};
for(const f of fs.readdirSync(DIR).filter(f=>f.endsWith('.trace.json.gz')).sort()){
  const d=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR,f))));
  const S={};Z.forEach(z=>S[z]={objects:0,bytes:0,frames:new Set(),windows:0});
  for(const p of d.packs.filter(p=>p.gs===5&&p.end<=d.drainTime)){
    const m=api.metrics(d,p,new Map(p.events.map(e=>[e.id,e.start])));
    const seen={};
    for(const r of m.rows){const lo=r.address&255;const zs=[zoneOf(lo)];if(r.upper)zs.push('y48_63');
      for(const z of zs){S[z].windows++;if(r.hit){S[z].bytes++;(seen[z]=seen[z]||new Set()).add(r.slot);}}}
    for(const z of Z)if(seen[z])S[z].objects+=seen[z].size;
    // кадры: объекты по зонам
    for(const z of Z){}
  }
  per[d.scene]=Object.fromEntries(Z.map(z=>[z,{objects:S[z].objects,hit_bytes:S[z].bytes,windows:S[z].windows}]));
  for(const z of Z){tot[z].objects+=S[z].objects;tot[z].pixels_bytes+=S[z].bytes;tot[z].windows+=S[z].windows;}
}
const out={per_scene:per,total:Object.fromEntries(Z.map(z=>[z,{objects:tot[z].objects,hit_bytes:tot[z].pixels_bytes,windows:tot[z].windows}]))};
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));console.log(JSON.stringify(out.total));
