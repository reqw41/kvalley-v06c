#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),zlib=require('zlib'),crypto=require('crypto'),{createRequire}=require('module');
const ROOT=path.resolve(__dirname,'../..'),OUT=(process.env.BW_OUT||path.join(ROOT,'outputs/beamwait')),FILE=path.join(__dirname,'tick_breakdown_add1.js');
let historical=false;
const assert=(x,m)=>{if(!x)throw Error(m)},sha=b=>crypto.createHash('sha256').update(b).digest('hex');
let code=fs.readFileSync(FILE,'utf8');code=code.slice(0,code.lastIndexOf('module.exports={comparison,stats};if(require.main===module)main();'))+'module.exports={makeAPI,independent,stats,newExtra};';
code=code.replace("source=source.replace('module.exports={comparison,stats};if(require.main===module)main();'", "source=source.replace('if(require.main===module)main();'");
code=code.replace('this.__api={loadDriver,summarize,instructionCosts,protectedManifest};','this.__api={loadDriver,summarize,instructionCosts,protectedManifest,setupTrace};');
code=code.replace('console,process,Buffer,Set,Map,module:{exports:{}},__variant:variant','console,process,Buffer,Set,Map,module:{exports:{}},__variant:variant').replace('__makeExtra:newExtra','__makeExtra:__instrument');
const custom=`    if (sceneName.startsWith('upper_')||sceneName.startsWith('edge_')) {
      const [kind,env0,motion]=sceneName.split('_'),edge=kind==='edge',env=edge?'both':env0;
      rawWr(L.vec_god,1);
      const cells=[];for(let y=edge?(env0==='top'?8:152):48;y<=(edge?(env0==='top'?40:184):56);y+=8)for(let x=40;x<216;x+=8){const id=rd(L.MapaRAM+(y/8-1)*96+rd(L.ProtaRoom)*32+x/8);if((id>>4)===2)cells.push({x,y,id});}
      if(!cells.length)fail('no upper ladder cells');
      const usable=cells.filter(c=>[33,34].includes(c.id));const c=usable[motion==='jump'?0:Math.floor(usable.length/2)]||cells[0],HX=env==='mummy'&&motion!=='stairs'?64:motion==='jump'?c.x+16:c.x-8+(c.id===34?2:6),HY=c.y-8;
      rawWr(L.ProtaX,HX);rawWr(L.ProtaY,HY);rawWr(L.protaStatus,0);
      const place=()=>{if(env==='ladder'){for(let m=0;m<4;m++){safeWr(L.momiaDat+m*22,4);safeWr(L.momiaDat+m*22+3,224);}for(let sl=6;sl<=13;sl++)safeWr(L.sprAttrib+4*sl,224);}else{placeTwoMummies(HY,rd(L.ProtaX),8,80,true);safeWr(L.momiaDat+22,4);safeWr(L.momiaDat+25,224);safeWr(L.sprAttrib+28,224);}};
      place();
      keyFn=t=>motion==='stairs'?[38,t&16?39:37]:motion==='jump'?[t&16?37:39,...(t%32<12?[32]:[])]:[t&16?37:39];
      pinFn=()=>{if(rd(L.ProtaY)<(edge?(env0==='top'?0:HY-16):(motion==='jump'?24:motion==='stairs'?32:40))||rd(L.ProtaY)>(edge?(env0==='top'?HY+24:HY+16):63)||(motion==='walk'&&rd(L.protaStatus)===2)){safeWr(L.ProtaY,HY);safeWr(L.protaStatus,0);}if(Math.abs(rd(L.ProtaX)-HX)>(env==='mummy'&&motion!=='stairs'?4:12))safeWr(L.ProtaX,HX);place();};
      interventions.push('upper fixture '+env+'/'+motion+' at '+HX+','+HY+'; pins only at completed ticks');
      checkpoints.push({when:'ladder_selection',cells,selected:c,HX,HY});
    } else if (sceneName === "natural") {`;
const chain=" .replace('  let TT = 0;'";
code=code.replace("source=source.replace(' const oldInstruction=cpu.instruction.bind(cpu)'",'source=source.replace('+JSON.stringify(chain)+','+JSON.stringify(' .replace('+JSON.stringify('    if (sceneName === "natural") {')+','+JSON.stringify(custom)+')\n'+chain)+');\n'+"source=source.replace(' const oldInstruction=cpu.instruction.bind(cpu)'");
code=code.replace('console,process,Buffer,Set,Map,module:{exports:{}},__variant:variant','console,process,Buffer,Set,Map,module:{exports:{}},__instrument,__variant:variant');
let A,trace,GLITCH=null;const SNDCNT={n:0};
// --- профиль логики шага (BW_PROF=1): включающие/собственные такты по меткам SYM на шаг ---
const PROF_ON=!!process.env.BW_PROF;let PROF=null;
function profInit(E){
 const syms=[];for(const l of fs.readFileSync(path.join(ROOT,'build/kvalley_8c.sym'),'latin1').split('\n')){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m){const v=parseInt(m[2],16);if(v>=0x100&&v<0x7600)syms.push([v,m[1]]);}}
 syms.sort((a,b)=>a[0]-b[0]);
 const near=pc=>{let lo=0,hi=syms.length-1,r=0;while(lo<=hi){const mid=(lo+hi)>>1;if(syms[mid][0]<=pc){r=mid;lo=mid+1}else hi=mid-1}return syms[r][1];};
 PROF={near,steps:new Map(),stacks:{},tmp:null};
}
function instrument(E,scene,variant){
 const ex=A.newExtra(E,scene,variant),{L,rd,cpu}=E,data=ex.get();
 const benchMemory=new E.ctx.Memory(),benchCPU=new E.ctx.I8080(benchMemory,{interrupt(){},input(){return 0},output(){}});const br=a=>benchMemory.read(a,false),bw=(a,v)=>benchMemory.write(a,v,false);let benchPack=null;
 const packs=new Map(),stack=[];let now=0,depth=0,activePack=null,anchor=0,current=null,rootNow=null;
 const entries=new Map([[L.vhr_one,'show'],[L.vec_spr_show,'show'],[L.vso_merge1,'fused'],[L.vpr_wr,'pair_fused'],[L.vop_ow,'pair_show']].filter(x=>x[0]!==undefined));
 const original={pre:ex.pre,post:ex.post,write:ex.write,arm:ex.arm,get:ex.get};
 let drainTime=null;ex.arm=()=>{anchor=E.cyc();original.arm();}; // --- глюк-детектор по настоящим кадрам: пиксель кадра B отличен от A и C, а A==C (одно-кадровая вспышка) ---
 const GW={rows:new Float64Array(288),frames:0,ring:[],rowFrames:new Float64Array(288)};GLITCH=GW;
 {const v=E.v06c,oi=v.oneInterrupt.bind(v);v.oneInterrupt=function(...args){const r=oi(...args);
   if(rd(L.GameStatus)===5){const cur=Uint32Array.from(v.bmp);GW.ring.push(cur);if(GW.ring.length>3)GW.ring.shift();
    if(GW.ring.length===3){const [A,B,C]=GW.ring;GW.frames++;for(let y=0;y<288;y++){let n=0;const o=y*576;for(let x=0;x<576;x++){const i=o+x;if(B[i]!==A[i]&&B[i]!==C[i]&&A[i]===C[i])n++;}if(n){GW.rows[y]+=n;GW.rowFrames[y]++;}}}}
   else GW.ring.length=0;
   return r;};}
const od=ex.drain;ex.drain=()=>{drainTime=now;od();};
 function slotGeometry(idx,fresh=false){const base=0xe000+idx*256,lo=rd(base+(fresh?0x98:2)),ncols=rd(base+(fresh?0x99:3)),pages=fresh?[0x97,0x9f,0x9b]:[1,4,5];return {valid:fresh?[1,3].includes(rd(base+0x96)):!!rd(base),planes:pages.map(o=>rd(base+o)).filter(h=>h>=0x80&&h<0xe0).map(h=>({plane:(h-0x80)>>5,col:h&31,lo,ncols,rows:16}))};}
 function pack(p){if(!packs.has(p.id))packs.set(p.id,{id:p.id,root:p.root_id,depth:p.depth,start:p.start,phase:(p.start+anchor)%59904,states:p.states,all_slots:Array.from({length:21},(_,idx)=>({idx,old:slotGeometry(idx),draw:slotGeometry(idx,true)})),clock:{have:rd(L.vtm_have),chip:rd(L.vec_snd_chip),mode:rd(L.vec_snd_mode),voice_c:rd(L.vec_vch+2)},ids:p.ids,gs:rd(L.GameStatus),events:[],segments:[],bw:[],raw:p,unattributed:0,restore_background:{},oracle:{cells:{},classes:{},writes:0,matched:0,mismatched:0,final:{}}});return packs.get(p.id);}
 function open(p,kind,slots,start,ret,sp){const e={id:p.events.length,kind,slots,start,end:null,cycles:0,writes:[],reads:[]};p.events.push(e);return {event:e,ret,sp,depth};}
 ex.pre=ctx=>{original.pre(ctx);rootNow=ctx.root;now=ctx.now;depth=ctx.depth;if(historical&&now===0)anchor=E.cyc();const p=ctx.active('pack')?.pack;activePack=p?pack(p):null;current=null;
  if(activePack&&L.vbw_wait!==undefined){const w16=ad=>rd(ad)|(rd(ad+1)<<8);
   if(ctx.pc===L.vbw_wait)activePack.bw.push({slot:rd(L.vec_nsp_idx),pos:cpu.rp(0)>>8,in:now,depth,ok:rd(L.vbw_ok),have:rd(L.vtm_have),sl:rd(L.vpr_sl),mix:rd(L.vpr_mix),taus:[]});
   const it=activePack.bw[activePack.bw.length-1];
   if(it&&it.out===undefined){
    if(ctx.pc===L.vbw_a1){it.c=w16(L.vbw_c);it.len=w16(L.vbw_len);it.r=rd(L.vbw_r);it.planned=true;}
    if(ctx.pc===L.vbw_tau)it.taus.push([cpu.rp(4),E.cyc(),now]);
    if(ctx.pc===L.vbw_hwr)it.di0=now;
    if(ctx.pc===L.vbw_ei&&it.di0!==undefined){it.dimax=Math.max(it.dimax||0,now-it.di0);it.di0=undefined;}
    if(ctx.pc===L.vbw_out)it.out=now;}}
  if(L.updateSound!==undefined&&ctx.pc===L.updateSound){SNDCNT.n++;(SNDCNT.t=SNDCNT.t||[]).push(now);}
  if(ctx.pc===L.vec_isr_skip)SNDCNT.skip=(SNDCNT.skip||0)+1;
  if(ctx.pc===L.vfr_gate&&rd(L.vsp_rdy)===0&&rd(L.vfr_need)&&rd(L.vsp_n)>0){const li=activePack&&activePack.bw[activePack.bw.length-1];if(li&&li.planned&&li.out===undefined)SNDCNT.hazw=(SNDCNT.hazw||0)+1;else SNDCNT.haz=(SNDCNT.haz||0)+1;}
  if(ctx.pc===L.vec_isr)SNDCNT.isr=(SNDCNT.isr||0)+1;
  if(process.env.BW_PCS){for(const nm of process.env.BW_PCS.split(',')){if(L[nm]!==undefined&&ctx.pc===L[nm]){(SNDCNT.pcs=SNDCNT.pcs||{})[nm]=((SNDCNT.pcs||{})[nm]||0)+1;}}}
  if(L.vbw_busy!==undefined&&ctx.pc===L.vso_fix&&rd(L.vbw_busy)){SNDCNT.bz=(SNDCNT.bz||0)+1;if(rd(L.vsp_rdy)===1)SNDCNT.bz1=(SNDCNT.bz1||0)+1;if(rd(L.vfr_need))SNDCNT.bzn=(SNDCNT.bzn||0)+1;}
  if(L.vsnd_tick_hdr!==undefined&&ctx.pc===L.vsnd_tick_hdr)SNDCNT.hdr=(SNDCNT.hdr||0)+1;
  if(!activePack)return ctx;
  if(entries.has(ctx.pc)){const kind=entries.get(ctx.pc),sp=cpu.sp;stack.push(open(activePack,kind,kind.startsWith('pair')?[4,5]:[rd(L.vec_nsp_idx)],now,rd(sp)|(rd(sp+1)<<8),sp));}
  for(const kind of ['restore','save']){const c=ctx.active(kind);if(c?.event){if(!c.event.beam_order)c.event.beam_order=open(activePack,kind,[c.event.object],now,c.ret,c.sp);current=c.event.beam_order;break;}}
  current??=stack.findLast(s=>s.depth===depth);
  // Keep all control and IRQ work; no instruction is assigned twice.
  const owner=current?.event.id??null,seg=activePack.segments.at(-1);
  if(seg&&seg.owner===owner&&seg.end===now)seg.pending=true;else activePack.segments.push({owner,start:now,end:now,pending:true});
  return ctx;
 };
 ex.post=ctx=>{original.post(ctx);if(PROF_ON&&PROF.pre){const q=PROF.pre,r=q.root,d=q.depth;const st=PROF.stacks[d]=PROF.stacks[d]||[];
  const isCall=q.op===0xCD||((q.op&0xC7)===0xC4),isRet=q.op===0xC9||((q.op&0xC7)===0xC0);
  const li=r&&r.logic?r.logic_index:0;
  if(li&&d>=1){let S=PROF.steps.get(li);if(!S){S={self:{},incl:{},calls:{},total:0,nested:0};PROF.steps.set(li,S);}
   const own=PROF.near(q.pc);S.self[own]=(S.self[own]||0)+ctx.cost;S.total+=ctx.cost;
   const seen=new Set();for(const f of st){if(!seen.has(f.name)){seen.add(f.name);S.incl[f.name]=(S.incl[f.name]||0)+ctx.cost;}}
   if(isCall&&cpu.sp===((q.sp-2)&65535)){const nm=PROF.near(cpu.pc);S.calls[nm]=(S.calls[nm]||0)+1;}
  }
  if(isCall&&cpu.sp===((q.sp-2)&65535))st.push({name:PROF.near(cpu.pc),sp:cpu.sp});
  else if(isRet&&cpu.sp===((q.sp+2)&65535)){while(st.length&&st[st.length-1].sp<cpu.sp)st.pop();}
  if(d>=2&&li===0){}
 }
if(activePack){const seg=activePack.segments.at(-1);if(seg?.pending){seg.end=ctx.now;delete seg.pending;}if(current){current.event.cycles+=ctx.cost;if(cpu.pc===current.ret&&cpu.sp===((current.sp+2)&65535))current.event.end=ctx.now;}for(let i=stack.length-1;i>=0;i--)if(stack[i].depth===depth&&cpu.pc===stack[i].ret&&cpu.sp===((stack[i].sp+2)&65535)){stack[i].event.end=ctx.now;stack.splice(i,1);}}now=ctx.now;};
 ex.write=(a,b,old,ctx)=>{if(!(a===L.tickInProgress&&!rootNow))original.write(a,b,old,ctx);if(!activePack||a<0x8000||a>=0xe000)return;if(!current){activePack.unattributed++;return;}const e=current.event;e.writes.push([now-e.start,a,b,old,E.cyc()]);if(e.kind==='restore'){
  const y=255-(a&255),col=(a>>8)&31,room=rd(L.ProtaRoom),id=y>=8&&y<184?rd(L.MapaRAM+(Math.floor(y/8)-1)*96+room*32+col):null;
  const ptr=id===null?0:rd(L.indexTiles+2*(id>>4))|(rd(L.indexTiles+2*(id>>4)+1)<<8),tile=id===null?null:rd(ptr+(id&15));
  let kind=id===null?'outside_map':id>>4===5||id>>4===6||id>>4===7?'doors':id>>4===3||id>>4===4||id>>4===8?'items':'tile';
  const mode=tile===null?null:rd(L.vec_tilemode+tile),colored=tile===null||tile===0?false:(mode!==255&&((mode&7)===4||!!(mode&0x80)))||[0x40,0x41,0x42,0x43,0x44,0x51,0x52,0x53,0x5c].includes(tile);
  const k=kind+':'+(colored?'colored':'plain');activePack.restore_background[k]=(activePack.restore_background[k]||0)+1;
  if(tile!==null){const cell=col+':'+Math.floor(y/8),o=activePack.oracle;
   if(!o.cells[cell]){if(benchPack!==activePack.id){benchMemory.bytes.set(E.memory.bytes);benchMemory.control_write(E.memory.cw);benchPack=activePack.id;}
    const row=Math.floor(y/8);for(let plane=0;plane<3;plane++)for(let dy=0;dy<8;dy++)bw(0x8000+plane*8192+col*256+((255-row*8-dy)&255),0);
    bw(L.vw_byte,tile);bw(L.vec_isr_depth,1);benchCPU.set_rp(0,(row<<8)|col);benchCPU.sp=0x7000;bw(0x7000,0);bw(0x7001,0);benchCPU.pc=L.vbt8_ent;benchCPU.iff=false;benchCPU.iff_pending=0;let cycles=24,count=0;
    while(benchCPU.pc!==0&&count++<200000){benchCPU.instruction();cycles+=benchCPU.vcycles;}
    assert(benchCPU.pc===0,'native tile oracle failed');o.cells[cell]={tile,mode,kind,cycles,values:Array.from({length:24},(_,i)=>br(0x8000+Math.floor(i/8)*8192+col*256+((255-row*8-i%8)&255)))};
   }
   const ref=o.cells[cell].values[((a-0x8000)>>13)*8+y%8],match=b===ref;o.writes++;o[match?'matched':'mismatched']++;const c=o.classes[k]||(o.classes[k]={writes:0,matched:0,mismatched:0});c.writes++;c[match?'matched':'mismatched']++;
   const foreign=activePack.all_slots.some(s=>!e.slots.includes(s.idx)&&!(e.slots.some(i=>i===4||i===5)&&[4,5].includes(s.idx))&&s.old.valid&&s.old.planes.some(p=>col>=p.col&&col<p.col+p.ncols&&((a-p.lo)&255)<16));
   o.final[a]={category:foreign?'sprites':kind==='tile'?(match?(colored?'colored_tile':'clean_tile'):'tile_mismatch'):kind,match};
  }else activePack.oracle.final[a]={category:'outside_map',match:false};

 }};
 const oldRead=E.memory.read.bind(E.memory);E.memory.read=(a,s)=>{const b=oldRead(a,s);if(activePack&&current?.event.kind==='save'&&a>=0x8000&&a<0xe000)current.event.reads.push(a);return b;};
 ex.get=()=>({...original.get(),beam_order:{anchor,drainTime,packs:[...packs.values()].filter(p=>p.raw.end&&p.raw.draw_own>1000).map(p=>{const {raw,...rest}=p;return {...rest,end:raw.end,cost:raw.cost,draw_own:raw.draw_own};})}});
 trace={E,ex};return ex;
}
const context={require:createRequire(FILE),__dirname,console,process,Buffer,module:{exports:{}},__instrument:instrument};vm.createContext(context);vm.runInContext(code,context,{filename:FILE});A=context.module.exports;
fs.mkdirSync(OUT,{recursive:true});
const EDGE=['top','bot'].flatMap(e=>['walk','stairs','jump'].map(m=>[`edge_${e}_${m}`,`edge_${e}_${m}`,160]));
const scenes=[['stress','repro',120],['natural','natural',2600],['climb','climb',1800],['climb_2709','hero_atomic',1800],...['mummy','ladder','both'].flatMap(env=>['walk','stairs','jump'].map(m=>[`upper_${env}_${m}`,`upper_${env}_${m}`,160])),...EDGE];
const requested=process.argv[2],todo=requested?scenes.filter(x=>x[0]===requested||(requested==='upper'&&x[0].startsWith('upper_')||requested==='edge'&&x[0].startsWith('edge_'))):scenes;
for(const[name,driver,n]of todo){console.log('record',name,n);let raw,observed=n;if(driver==='hero_atomic'){
 historical=true;const api=A.makeAPI('rom_observer'),H=require('./beam_harness'),original=H.make,log=[];let traced;const ctx={require:createRequire(path.join(__dirname,'hero_atomic.js')),__dirname,console:{log(...args){log.push(args.join(' '));console.log(...args);}},process:{argv:['node','hero_atomic',path.join(ROOT,'build/kvalley_8c.rom'),path.join(ROOT,'build/kvalley_8c.sym'),String(n),'--climb']},Buffer};
 H.make=(...args)=>{const E=original(...args);traced=api.setupTrace(E,name);ctx.__trace=traced;return E;};let source=fs.readFileSync(path.join(__dirname,'hero_atomic.js'),'utf8').replace('let TT=0;','__trace.arm();let TT=0;').replace('if(pc===SHOW||pc===MERGE)', 'if(pc===L.vop_ow)curSlot=4;\n    if(pc===SHOW||pc===MERGE||pc===L.vhr_one||pc===REST)');vm.createContext(ctx);try{vm.runInContext(source+'\nthis._keys=KF;this._tick=tick;this._direct={historical_log:log,intermediate_color:{scope:"hero_bbox",frames_gameplay:frames,bad_frames:badFrames,bad_pixels:badPixT,hero_ytop_48_63:{frames:zFrames[1],bad_frames:zBadFr[1],bad_pixels:zBad[1]}}};',Object.assign(ctx,{log}),{filename:'hero_atomic.recorded.js'});observed=traced.get().extra.steps.length-1;console.log('historical logic steps',observed,'root logic',traced.get().roots.filter(r=>r.logic).length);traced.finish(observed,ctx._keys,ctx._tick);raw={baseline:ctx._direct,...traced.get()};}finally{H.make=original;}historical=false;
 }else raw=A.makeAPI('rom_observer').loadDriver(driver,n);const extra=raw.extra,measured=A.independent(raw,observed,extra);assert(measured.closure.max_relative_pct===0&&measured.closure.max_raster_relative_pct===0,'clock closure');const detail=extra.beam_order;
 const result={scene:name,ticks:n,observed_logic_ticks:observed,driver,rom_sha256:sha(fs.readFileSync(path.join(ROOT,'build/kvalley_8c.rom'))),sym_sha256:sha(fs.readFileSync(path.join(ROOT,'build/kvalley_8c.sym'))),beam0:13780+192*((trace.E.L.vec_vscroll-31)&255),frame:59904,closure:measured.closure,steps:measured.steps.map(s=>({tick:s.logic_index,start:s.logic_start,next:s.next_start,cycles:s.interval_cycles,frames:s.interval_frames,gs:s.logic_gs,articles:s.interval_articles})),build_label:Array.from({length:11},(_,i)=>trace.E.rd(trace.E.L.KV_VERSION+i)).map(g=>g>=16&&g<=25?String(g-16):g===32?'-':String.fromCharCode(65+g-33)).join(''),direct:raw.baseline,states:extra.states.filter(s=>s.tick<=observed),...detail};
 if(name.startsWith('edge_'))console.log('edge hero y range',Math.min(...result.states.map(s=>s.hero.y)),Math.max(...result.states.map(s=>s.hero.y)),'status',[...new Set(result.states.map(s=>s.hero.status))].join());
 if(name.startsWith('upper_')){const motion=name.split('_')[2],wanted=motion==='jump'?1:motion==='stairs'?3:0;assert(result.states.some(s=>s.hero.status===wanted),'missing actual motion coverage '+name);assert(result.states.some(s=>s.hero.y>=40&&s.hero.y<=63),'missing upper coverage '+name);}
 for(const p of result.packs){p.events.forEach(e=>{assert(e.end!==null,'unclosed event '+name+' '+e.kind);});}
 if(PROF_ON&&PROF){fs.writeFileSync(path.join(OUT,'prof-'+name+'.json'),JSON.stringify({scene:name,steps:[...PROF.steps].map(([k,v])=>({step:k,...v}))}));PROF=null;}
 if(GLITCH)result.glitch={frames:GLITCH.frames,rows:Array.from(GLITCH.rows),row_frames:Array.from(GLITCH.rowFrames)};GLITCH=null;result.snd_ticks=SNDCNT.n;result.isr_skips=SNDCNT.skip||0;result.pcs=SNDCNT.pcs||{};SNDCNT.pcs={};result.busy_hits={all:SNDCNT.bz||0,rdy1:SNDCNT.bz1||0,need:SNDCNT.bzn||0};SNDCNT.bz=SNDCNT.bz1=SNDCNT.bzn=0;result.repair_in_pack=SNDCNT.haz||0;result.repair_in_wait=SNDCNT.hazw||0;SNDCNT.haz=0;SNDCNT.hazw=0;result.isr_entries=SNDCNT.isr||0;result.hdr_calls=SNDCNT.hdr||0;SNDCNT.isr=0;SNDCNT.hdr=0;result.snd_times=SNDCNT.t||[];SNDCNT.t=[];SNDCNT.n=0;SNDCNT.skip=0;
 const gz=zlib.gzipSync(JSON.stringify(result),{level:9}),file=path.join(OUT,name+'.trace.json.gz');fs.writeFileSync(file,gz);console.log('saved',name,'packs',result.packs.length,'bytes',gz.length,'unattributed',result.packs.reduce((s,p)=>s+p.unattributed,0));}
