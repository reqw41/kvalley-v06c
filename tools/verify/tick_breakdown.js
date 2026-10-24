#!/usr/bin/env node
'use strict';
// Read-only game measurement. The baseline driver is loaded in memory unchanged;
// only instrumentation hooks are added. Output stays in docs/tick_breakdown/.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'docs/tick_breakdown');
const harness=require('./beam_harness.js');
const SHA='96b294eb0eae7e2b33da8f1b587598f7191047d28934e3c268814c37d48434b8';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const q=a=>{const b=a.slice().sort((x,y)=>x-y),n=b.length;return {n,mean:n?b.reduce((s,x)=>s+x,0)/n:0,median:n?b[Math.floor(n*.5)]:0,p90:n?b[Math.min(n-1,Math.floor(n*.9))]:0,min:n?b[0]:0,max:n?b[n-1]:0};};
function treeFiles(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?treeFiles(path.join(dir,d.name)):[path.join(dir,d.name)]);}
function protectedManifest(){return Object.fromEntries(['src','build','devector'].flatMap(d=>treeFiles(path.join(ROOT,d))).map(p=>[path.relative(ROOT,p),hash(p)]));}
function assert(c,m){if(!c)throw Error(m);}
const CATS=['outer_head','outer_pack','game_logic','sprite_prep','nested_head','nested_sound','nested_pack','tail_control'];
const addrHex=n=>'0x'+n.toString(16).padStart(4,'0');
function geometry(E,idx,fresh=false){
 const p=0xe000+idx*256,rd=E.rd,o=fresh?0x97:1;
 const nc=rd(p+(fresh?0x99:3)),lo=rd(p+(fresh?0x98:2));
 const hi=[rd(p+o),rd(p+(fresh?0x9a:4)),rd(p+(fresh?0x9b:5))];
 const planes=hi.filter(h=>h>=0x80&&h<0xe0).map(h=>({plane:(h-0x80)>>5,col:(h-0x80)&31,lo,ncols:nc,rows:16}));
 return {valid:!!rd(p),pending:rd(p+0x96),x:rd(fresh?p+0x9d:E.L.vec_nsp_prev+idx*3+1),y:rd(fresh?p+0x9c:E.L.vec_nsp_prev+idx*3),planes};
}
function footprint(g){const a=new Set();if(!g.valid)return a;for(const p of g.planes)for(let c=0;c<p.ncols;c++)for(let y=0;y<16;y++)a.add(p.plane*8192+(p.col+c)*256+((p.lo+y)&255));return a;}
function intersect(a,b){let n=0;for(const x of a)if(b.has(x))n++;return n;}
function union(a,b){return new Set([...a,...b]);}
function setupTrace(E,scene){
 const {L,cpu,memory,v06c,rd,cyc,FRAME}=E;
 let armed=false,now=0,instructionStart=0,irqFrames=[],contexts=[],roots=[],packs=[],currentRoot=null,lastStep=null,currentInstr=null;
 let stepCounter=0,packCounter=0,seq=0,drain=false;
 let rasterPrev=null,rasterWraps=0,pendingExit=null;
 function rasterClock(){const p=cyc();if(rasterPrev!==null&&p<rasterPrev-1000)rasterWraps++;rasterPrev=p;return rasterWraps*FRAME+p;}
 const opcodeStats={},writers={},executedEntries={},saveKernelStats={};
 const symEntries=Object.entries(L).filter(([n,a])=>a>=0x100&&a<0x8000).sort((a,b)=>a[1]-b[1]);
 const labels=new Map(symEntries.map(([n,a])=>[a,n]));
 function near(pc){let lo=0,hi=symEntries.length-1,r=0;while(lo<=hi){let m=(lo+hi)>>1;if(symEntries[m][1]<=pc){r=m;lo=m+1}else hi=m-1;}return symEntries[r]?.[0]||addrHex(pc);}
 const tracked={vec_spr_prep:'prep_substage',vso_fix:'pack',vec_spr_out:'draw',vec_nat_sprites:'prep',runGame:'game',vec_su_save:'save',vec_su_restore:'restore',vsnd_tick_hdr:'sound',vsnd_tick:'sound',vsnd_tick_clk:'sound',vsnd_tick_coop:'sound',updateSound:'sound'};
 const entries=new Map(Object.entries(tracked).filter(([n])=>L[n]!==undefined).map(([n,t])=>[L[n],{name:n,type:t}]));
 const stageNames={vec_nat_sprites:'detect',vflm_gate:'sticky_merge',vfla_go:'overlap_propagation',vflp_done:'build_objects',vns_done:'finalize',vsp_fastmark:'fast_path_decision',vso_sortord:'sort_order',vpr_scan:'pair_decision'};
 const stagePC=new Map(Object.entries(stageNames).filter(([n])=>L[n]!==undefined).map(([n,s])=>[L[n],s]));
 function active(type){for(let i=contexts.length-1;i>=0;i--)if(contexts[i].type===type&&contexts[i].depth===irqFrames.length)return contexts[i];return null;}
 const oldInstruction=cpu.instruction.bind(cpu),oldCheck=v06c.checkInterrupt.bind(v06c),oldWrite=memory.write.bind(memory),oldRead=memory.read.bind(memory);
 function charge(cat,c,pc){if(lastStep)lastStep.interval_articles[cat]+=c;const r=currentRoot;if(!r)return;r.articles[cat]+=c;r.instruction_cycles+=c;if(cat==='sprite_prep'){const pr=active('prep');const s=active('prep_substage')?'geometry_shift_buffers':pr?.stage||'other';r.prep_stages[s]=(r.prep_stages[s]||0)+c;r.prep_labels[near(pc)]=(r.prep_labels[near(pc)]||0)+c;}if(cat==='game_logic')r.game_labels[near(pc)]=(r.game_labels[near(pc)]||0)+c;}
 function classify(){const pack=active('pack'),sound=active('sound'),pr=active('prep'),gm=active('game');if(irqFrames.length>1)return sound?'nested_sound':pack?'nested_pack':'nested_head';if(pack)return 'outer_pack';if(pr&&pr.building)return 'sprite_prep';if(sound){if(!currentRoot.packWasEntered&&!currentRoot.logic)return 'outer_head';return 'tail_control';}if(gm)return 'game_logic';return currentRoot.packWasEntered?'tail_control':'outer_head';}
 function openContext(entry,pc){
  const sp=cpu.sp,ret=rd(sp)|(rd((sp+1)&65535)<<8),depth=irqFrames.length;
  if(contexts.some(c=>c.name===entry.name&&c.sp===sp&&c.ret===ret&&c.depth===depth))return;
  const c={...entry,sp,ret,depth,start:now,cost:0};
  if(c.type==='prep'){c.stage='detect';c.building=true;}
  if(c.type==='pack'){
   currentRoot.packWasEntered=true;
   const rawN=rd(L.vsp_n),ids=Array.from({length:Math.min(rawN,21)},(_,i)=>rd(L.vso_ord+i));
   // Existing order is irrelevant for old/new overlap; include all populated slots
   // in the pending list, and retain both save and draw plane geometries.
   const states=Array.from({length:21},(_,idx)=>({idx,old:geometry(E,idx),fresh:geometry(E,idx,true),draw:geometry(E,idx,true)}));
   for(const s of states){s.fresh.valid=[1,3].includes(s.fresh.pending);s.draw.planes=geometry(E,s.idx,true).planes;const pg=0xe000+s.idx*256;s.draw.planes=[rd(pg+0x97),rd(pg+0x9f),rd(pg+0x9b)].filter(h=>h>=0x80&&h<0xe0).map(h=>({plane:(h-0x80)>>5,col:(h-0x80)&31,lo:rd(pg+0x98),ncols:rd(pg+0x99),rows:16}));s.draw.valid=s.fresh.valid;}
   c.pack={id:++packCounter,root_id:currentRoot.id,depth,start:now,ready:rd(L.vsp_rdy),list_size:rawN,ids,states:states.filter(s=>ids.includes(s.idx)),events:[],cost:0,draw_elapsed:0,draw_own:0,writes:0};
   packs.push(c.pack);currentRoot.pack_ids.push(c.pack.id);
   const irq=irqFrames.at(-1);irq.pack_ids.push(c.pack.id);irq.pack_ready=c.pack.ready;
  }
  if(c.type==='draw'){c.pack=active('pack')?.pack;}
  if(c.type==='save'||c.type==='restore'){
   c.pack=active('pack')?.pack;
   if(c.pack){const idx=rd(L.vec_nsp_idx);c.event={operation:c.type,object:idx,old:geometry(E,idx),fresh:geometry(E,idx,true),cycles:0,reads:0,writes:0,kernel_cycles:0,pc_costs:{}};c.pack.events.push(c.event);}
  }
  contexts.push(c);
 }
 v06c.checkInterrupt=function(){
  if(armed&&this.irq&&cpu.iff){
   const rasterAccept=rasterClock();const before=irqFrames.length,phase=cyc(),ret=cpu.pc+(cpu.last_opcode===0x76?1:0);
   if(!before){currentRoot={id:++seq,scene,request:now-phase,raster_request:rasterAccept-phase,accept:now,request_wait:phase,request_gs:rd(L.GameStatus),articles:Object.fromEntries(CATS.map(k=>[k,0])),instruction_cycles:0,irq_cycles:0,prep_stages:{},prep_labels:{},game_labels:{},pack_ids:[],nested:[],logic:false};currentRoot.articles.outer_head+=phase;roots.push(currentRoot);}
   const f={depth:before+1,ret:ret&65535,sp:(cpu.sp-2)&65535,accept:now,request:now-phase,pack_ids:[],pack_ready:null};
   irqFrames.push(f);if(before)currentRoot.nested.push(f);
   const cat=before?'nested_head':'outer_head';currentRoot.articles[cat]+=16;if(lastStep)lastStep.interval_articles[cat]+=16;currentRoot.irq_cycles+=16;now+=16;
  }
  return oldCheck();
 };
 memory.write=function(a,b,stack){
  if(armed&&currentRoot){
   if((a&65535)===L.tickInProgress){
    if((b&255)===1&&rd(a)===0){currentRoot.logic=true;currentRoot.logic_index=++stepCounter;currentRoot.interval_articles=Object.fromEntries([...CATS,'idle_main'].map(k=>[k,0]));currentRoot.logic_start=now;currentRoot.logic_start_frame=Math.floor((currentRoot.raster_request+now-currentRoot.request)/FRAME);currentRoot.logic_start_phase=cyc();currentRoot.logic_gs=rd(L.GameStatus);if(lastStep){lastStep.next_start=now;lastStep.interval_cycles=now-lastStep.logic_start;lastStep.interval_frames=currentRoot.logic_start_frame-lastStep.logic_start_frame;lastStep.interval_frames_fractional=lastStep.interval_cycles/FRAME;}lastStep=currentRoot;}
    if((b&255)===0&&rd(a)===1)currentRoot.logic_end=now;
   }
   if((a&65535)===L.vsp_rdy&&(b&255)===1){const p=active('prep');if(p){p.markReadyAfter=true;currentRoot.ready_time=now;}}
   const p=active('pack');if(p&&(a&65535)>=0x8000&&(a&65535)<0xe000){p.pack.writes++;const k=near(currentInstr?.pc||0);writers[k]=(writers[k]||0)+1;}
   const rt=active('restore');if(rt?.event&&(a&65535)>=0x8000&&(a&65535)<0xe000)rt.event.writes++;
   const s=active('save');if(s?.event&&(a&65535)>=0xe000+s.event.object*256+6&&(a&65535)<0xe000+s.event.object*256+0x96)s.event.writes++;
  }
  return oldWrite(a,b,stack);
 };
 memory.read=function(a,stack){if(armed){const rt=active('restore');if(rt?.event&&(a&65535)>=0x8000&&(a&65535)<0xe000)rt.event.writes++;
   const s=active('save');if(s?.event&&(a&65535)>=0x8000&&(a&65535)<0xe000)s.event.reads++;}return oldRead(a,stack);};
 cpu.instruction=function(){
  if(!armed)return oldInstruction();
  const rasterNow=rasterClock();if(pendingExit){pendingExit.raster_elapsed=rasterNow-pendingExit.raster_request;pendingExit.raster_error=pendingExit.closure_sum-pendingExit.raster_elapsed;pendingExit=null;}
  const pc=cpu.pc,opcode=rd(pc);if(labels.has(pc))executedEntries[labels.get(pc)]=(executedEntries[labels.get(pc)]||0)+1;currentInstr={pc,opcode};instructionStart=now;
  if(currentRoot){const e=entries.get(pc);if(e)openContext(e,pc);const p=active('prep');if(p&&p.building&&stagePC.has(pc))p.stage=stagePC.get(pc);}
  const cat=currentRoot?classify():null;
  oldInstruction();const c=cpu.vcycles|0;now+=c;
  const key=opcode.toString(16).padStart(2,'0');(opcodeStats[key]||=(new Set())).add(c);
  if(currentRoot){
   charge(cat,c,pc);
   for(const x of contexts)if(x.depth===irqFrames.length){x.cost+=c;if(x.event){x.event.cycles+=c;x.event.pc_costs[near(pc)]=(x.event.pc_costs[near(pc)]||0)+c;if((x.type==='save'&&((pc>=L.vsu_srow&&pc<L.vsu_srow+40)||(pc>=L.vsu_scwr&&pc<L.vsu_scwr+8)))||(x.type==='restore'&&pc>=L.vsur_ld+2&&pc<L.vsur_ld+42)){x.event.kernel_cycles+=c;}}}
   const pr=active('prep');if(pr?.markReadyAfter){pr.building=false;pr.markReadyAfter=false;}
   while(contexts.length){const x=contexts.at(-1);if(cpu.pc!==x.ret||cpu.sp!==((x.sp+2)&65535))break;contexts.pop();if(x.type==='draw'&&x.pack){x.pack.draw_elapsed=now-x.start;x.pack.draw_own=x.cost;}if(x.type==='pack'){x.pack.cost=x.cost;x.pack.elapsed=now-x.start;x.pack.end=now;}if(x.type==='prep')currentRoot.prep_inclusive=(currentRoot.prep_inclusive||0)+(now-x.start);}
   const f=irqFrames.at(-1);
   if(f&&cpu.pc===f.ret&&cpu.sp===((f.sp+2)&65535)){
    f.exit=now;irqFrames.pop();assert(!contexts.some(x=>x.depth>irqFrames.length),'unclosed routine at ISR return');
    if(!irqFrames.length){currentRoot.exit=now;currentRoot.elapsed=now-currentRoot.request;currentRoot.closure_sum=Object.values(currentRoot.articles).reduce((a,b)=>a+b,0);currentRoot.closure_error=currentRoot.closure_sum-currentRoot.elapsed;pendingExit=currentRoot;currentRoot=null;}
   }
  } else if(lastStep)lastStep.interval_articles.idle_main+=c;
 };
 return {E,scene,arm(){armed=true;},finish(n,keyFn,t){drain=true;let held=new Set();for(let f=0;f<300&&(!lastStep||stepCounter<n+1||!roots.find(r=>r.logic_index===n)?.exit);f++){const want=new Set(keyFn(t));for(const k of held)if(!want.has(k))E.key(k,0);for(const k of want)E.key(k,1);held=want;v06c.oneInterrupt(true);}armed=false;assert(stepCounter>=n+1,'missing next logic start');},get(){return {roots,packs,writers,executedEntries,opcodeStats:Object.fromEntries(Object.entries(opcodeStats).map(([k,s])=>[k,[...s].sort((a,b)=>a-b)]))};}};
}
function loadDriver(scene,n){
 let trace;
 const s=fs.readFileSync(path.join(__dirname,'perf_baseline_1205.js'),'utf8').split('// --- main ----------------------------------------------------------------')[0]
 .replace('const { make, toGame } = require("./beam_harness.js");','const { make, toGame } = __harness;')
 .replace('build: "2709-1205-M"', 'build: "2709-1721-M"')
 .replace('  let TT = 0;','  __trace.arm();\n  let TT = 0;');
 const wrapped={make(...a){const E=harness.make(...a);trace=setupTrace(E,scene);context.__trace=trace;return E;},toGame:harness.toGame};
 const context={require,__dirname,console,process:{argv:['node','tick_breakdown'],exitCode:0},Buffer,__harness:wrapped};
 vm.createContext(context);vm.runInContext(s+'\nthis.__runScene=runScene;',context,{filename:'perf_baseline_1205.instrumented-in-memory.js'});
 // Finish only after the original result has been constructed; historical
 // counters and raster metrics therefore exclude the diagnostic drain.
 const source=String(context.__runScene);
 vm.runInContext('this.__runScene='+source.replace('  return result;','  __trace.finish(ticks,keyFn,completedLogicTicks);\n  return result;'),context);
 const baseline=context.__runScene(scene,n,{repro:scene==='repro'});
 return {baseline,...trace.get()};
}
function summarize(raw,n){
 const steps=raw.roots.filter(r=>r.logic&&r.logic_index<=n);assert(steps.length===n,'step count mismatch');
 for(const r of steps){assert(r.exit&&r.next_start,'incomplete step');assert(Math.abs(r.closure_error)/r.elapsed<=.005,'closure >0.5%');assert(Math.abs(r.raster_error)/r.raster_elapsed<=.005,'raster closure >0.5%');r.logic_elapsed=r.logic_end-r.logic_start;r.pack_before_logic=raw.packs.some(p=>p.root_id===r.id&&p.depth===1&&p.start<r.logic_start&&p.draw_own>1000);r.nested_inside_tick=r.nested.filter(f=>f.accept>=r.logic_start&&f.accept<r.logic_end).map((f,i)=>({ordinal:i+1,depth:f.depth,request:f.request,ready:f.pack_ready,pack_fired:f.pack_ids.some(id=>raw.packs.find(p=>p.id===id)?.draw_own>1000),pack_ids:f.pack_ids}));}
 for(const r of steps)assert(Object.values(r.prep_stages).reduce((a,b)=>a+b,0)===r.articles.sprite_prep,'prep-stage closure');
 for(const r of steps)assert(Object.values(r.interval_articles).reduce((a,b)=>a+b,0)===r.interval_cycles,'interval CPU closure');
 const groups={all:steps,long:steps.filter(r=>r.interval_frames>=3),four_frames:steps.filter(r=>r.interval_frames===4),gameplay:steps.filter(r=>r.logic_gs===5),gameplay_long:steps.filter(r=>r.logic_gs===5&&r.interval_frames>=3),gameplay_four:steps.filter(r=>r.logic_gs===5&&r.interval_frames===4)};
 const summary={};for(const [name,rs]of Object.entries(groups)){summary[name]={n:rs.length,elapsed:q(rs.map(r=>r.elapsed)),logic_elapsed:q(rs.map(r=>r.logic_elapsed)),articles:Object.fromEntries(CATS.map(k=>[k,q(rs.map(r=>r.articles[k]))])),prep_stages:Object.fromEntries([...new Set(steps.flatMap(r=>Object.keys(r.prep_stages)))].map(k=>[k,q(rs.map(r=>r.prep_stages[k]||0))])),interval_articles:Object.fromEntries([...CATS,'idle_main'].map(k=>[k,q(rs.map(r=>r.interval_articles[k]||0))])),interval_hist:rs.reduce((h,r)=>(h[r.interval_frames]=(h[r.interval_frames]||0)+1,h),{})};}
 const prepTotals={};for(const r of steps)for(const [k,c]of Object.entries(r.prep_stages))prepTotals[k]=(prepTotals[k]||0)+c;
 const writerNames=Object.keys(raw.writers),needed=['vop_row','vsur_ld','vsu_srow','vsb_andn1'];
 const lastExit=steps.at(-1).next_start;
 const packs=raw.packs.filter(p=>p.start<=lastExit&&p.end&&p.draw_own>1000);
 return {steps,packs:packs.map(p=>({id:p.id,root_id:p.root_id,depth:p.depth,cost:p.cost,draw_own:p.draw_own,draw_elapsed:p.draw_elapsed,writes:p.writes})),summary,top_prep_stages:Object.entries(prepTotals).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,cycles])=>({name,cycles,per_step:cycles/n})),closure:{max_raster_absolute_cycles:Math.max(...steps.map(r=>Math.abs(r.raster_error))),max_raster_relative_pct:Math.max(...steps.map(r=>100*Math.abs(r.raster_error)/r.raster_elapsed)),max_absolute_cycles:Math.max(...steps.map(r=>Math.abs(r.closure_error))),max_relative_pct:Math.max(...steps.map(r=>100*Math.abs(r.closure_error)/r.elapsed)),total_instruction_cycles:steps.reduce((s,r)=>s+r.instruction_cycles,0)},writer_coverage:{writers:raw.writers,executed_entries:raw.executedEntries,checks:Object.fromEntries(needed.map(k=>[k,(raw.executedEntries[k]||0)>0])),nested_packs:packs.filter(p=>p.depth>1).length,all_nested_attempts:steps.reduce((s,r)=>s+r.nested.length,0)},baseline:raw.baseline,opcode_costs:raw.opcodeStats,nonlogic_external_isrs:raw.roots.filter(r=>!r.logic&&r.exit&&r.exit<=lastExit).map(r=>({id:r.id,request:r.request,exit:r.exit,articles:r.articles,pack_ids:r.pack_ids})),all_packs:raw.packs.filter(p=>p.start<=lastExit&&p.end)};
}
// Instruction-model costs are obtained from the same emulator, on an isolated
// empty microbenchmark CPU. No loaded game ROM or game state is changed.
function instructionCosts(E){const mem=new E.ctx.Memory(),c=new E.ctx.I8080(mem,{interrupt(){},input(){return 0},output(){}});const probes={mov_a_m:[0x7e],stax_d:[0x12],inx_d:[0x13],inr_l:[0x2c],dcr_c:[0x0d],jnz_taken:[0xc2,0,2],pop_d:[0xd1],mov_m_e:[0x73],mov_m_d:[0x72],lda:[0x3a,0,0],cmp_m:[0xbe],mvi_c:[0x0e,16],call:[0xcd,0,2],ret:[0xc9],lxi_h:[0x21,0,3],di:[0xf3],ei:[0xfb],shld:[0x22,0,3],lhld:[0x2a,0,3],sphl:[0xf9],mov_h_b:[0x60],mvi_l:[0x2e,0],inr_b:[0x04],dcr_b:[0x05],jmp:[0xc3,0,2],mov_a_c:[0x79],ora_a:[0xb7]};const out={};for(const [name,bytes]of Object.entries(probes)){mem.init_from_array(new Uint8Array(bytes),0x100);c.pc=0x100;c.sp=0x400;c.set_rp(2,0x500);c.set_rp(1,0x600);c.set_rp(0,0x100);c.zf=0;c.iff_pending=0;c.instruction();out[name]={bytes:bytes.length,cycles:c.vcycles};}return out;}
function evaluateSave(scene,costs){
 const byteLoop=costs.mov_a_m.cycles+costs.stax_d.cycles+costs.inx_d.cycles+costs.inr_l.cycles+costs.dcr_c.cycles+costs.jnz_taken.cycles;
 const popByte=(costs.pop_d.cycles+costs.mov_m_e.cycles+costs.inr_l.cycles+costs.mov_m_d.cycles+costs.inr_l.cycles)/2;
 // Eight byte-field comparisons + two guarded branches and call/ret. Counts
 // below are an explicit conservative sketch, not an assembled game path.
 const guard=8*(costs.lda.cycles+costs.lxi_h.cycles+costs.cmp_m.cycles+costs.jnz_taken.cycles)+costs.call.cycles+costs.ret.cycles;
 const unrolledCopy=costs.mov_a_m.cycles+costs.stax_d.cycles+costs.inx_d.cycles+costs.inr_l.cycles+(costs.dcr_c.cycles+costs.jnz_taken.cycles)/4;
 const kernelSetup=2*costs.lxi_h.cycles+costs.mvi_c.cycles;
 const classes={horizontal:[],vertical:[],width_change:[],intersection:[],standing:[],other:[]};
 const packEst=[];
 for(const pack of scene.all_packs){
  if(pack.draw_own<=1000)continue;
  const es=pack.events,model={pack_id:pack.id,root_id:pack.root_id,depth:pack.depth,full:0,partial:0,guarded:0,optimistic:0,eligible:0,saves:0};
  for(const e of pack.events){const st=pack.states.find(s=>s.idx===e.object);e.old_at_pack=st?.old;e.new_at_pack=st?.fresh;const old=footprint(st?.old||e.old),fresh=footprint({...e.fresh,valid:e.fresh.pending===1});e.overlap_objects=[];const region=union(old,fresh);for(const s of pack.states){if(s.idx===e.object||!pack.ids.includes(s.idx))continue;const theirs=union(footprint(s.old),footprint(s.draw));const hit=intersect(region,theirs);if(hit)e.overlap_objects.push({object:s.idx,byteplanes:hit});}
   if(e.operation!=='save')continue;
   const overlap=intersect(old,fresh),total=fresh.size,edge=total-overlap;
   const oldPlanes=(st?.old.planes||[]),newPlanes=e.fresh.planes;
   const planesChanged=oldPlanes.some((p,i)=>p.plane!==newPlanes[i]?.plane);
   const width=oldPlanes.some((p,i)=>p.ncols!==newPlanes[i]?.ncols)||oldPlanes.length!==newPlanes.length;
   const dx=newPlanes[0]&&oldPlanes[0]?newPlanes[0].col-oldPlanes[0].col:0,dy=newPlanes[0]&&oldPlanes[0]?((newPlanes[0].lo-oldPlanes[0].lo+128)&255)-128:0;
   const same=total>0&&overlap===total&&old.size===total;
   const intersects=e.overlap_objects.length>0;
   const dxPixels=e.fresh.x-(st?.old.x||0),dyPixels=e.fresh.y-(st?.old.y||0);
   const kind=intersects?'intersection':width?'width_change':planesChanged?'other':(dx||dxPixels)&&!dy&&!dyPixels?'horizontal':!dx&&!dxPixels&&(dy||dyPixels)?'vertical':!dx&&!dy&&!dxPixels&&!dyPixels?'standing':'other';
   // No slot allocation/layout change. When source==destination, retain it;
   // otherwise every retained byte must be physically relocated in the slot.
   const moved=same?0:overlap;
   const eligible=st?.old.valid&&e.fresh.pending===1&&total>0&&!width&&!planesChanged&&!intersects&&overlap>0&&newPlanes.every(p=>p.lo<=240)&&oldPlanes.every(p=>p.lo<=240);
   const expectedReads=e.fresh.pending===1?total:0;
   e.read_coverage={expected:expectedReads,actual:e.reads,match:expectedReads===e.reads};
   const columns=newPlanes.reduce((s,p)=>s+p.ncols,0);
   const perColumnOverhead=Math.max(0,e.cycles-e.reads*popByte);
   const partial=guard+(total?perColumnOverhead:0)+moved*unrolledCopy+edge*byteLoop+(same?0:columns*kernelSetup);
   // For unchanged footprint the entire save body can be bypassed. This keeps
   // restore intact, so the background remains clean before all subsequent saves.
   const retainedCost=same?guard+perColumnOverhead:partial;
   const checkedObjects=width?0:Math.max(0,pack.ids.length-1);
   const overlapCheck=checkedObjects*(4*(costs.lda.cycles+costs.lxi_h.cycles+costs.cmp_m.cycles+costs.jnz_taken.cycles)+2*costs.lxi_h.cycles);
   const guarded=eligible?retainedCost+overlapCheck:e.cycles+guard+overlapCheck;
   const optimistic=same?guard+perColumnOverhead:guard+perColumnOverhead+(moved+edge)*popByte;
   e.model={kind,planes_changed:planesChanged,dx_pixels:dxPixels,dy_pixels:dyPixels,dx_columns:dx,dy_rows:dy,full_cycles:e.cycles,total_bytes:total,retained_bytes:overlap,new_edge_bytes:edge,moved_bytes:moved,same_footprint:same,eligible,partial_cycles:retainedCost,guarded_cycles:guarded,optimistic_cycles:optimistic,full_overhead_cycles:perColumnOverhead,break_even_checks:e.cycles-(retainedCost-guard),intersection_check_cycles:overlapCheck,reason:eligible?'old clean slot, same width/planes, no overlap/wrap':'fallback: invalid/width/planes/overlap/wrap/no retained bytes'};
   classes[kind].push(e.model);model.full+=e.cycles;model.partial+=retainedCost;model.guarded+=guarded;model.optimistic+=optimistic;model.eligible+=eligible?1:0;model.saves++;
  }
  model.partial_saving=model.full-model.partial;model.guarded_saving=model.full-model.guarded;model.optimistic_saving=model.full-model.optimistic;packEst.push(model);
 }
 const perStep=scene.steps.map(r=>{const pp=packEst.filter(p=>{const pp=scene.all_packs.find(x=>x.id===p.pack_id);return pp.start>=r.logic_start&&pp.start<r.next_start;});return {logic_index:r.logic_index,partial:pp.reduce((s,p)=>s+p.partial_saving,0),guarded:pp.reduce((s,p)=>s+p.guarded_saving,0),optimistic:pp.reduce((s,p)=>s+p.optimistic_saving,0)};});
 return {instruction_model:{loop_copy_byte:byteLoop,unrolled_copy_byte:unrolledCopy,full_pop_byte:popByte,guard_cycles:guard,column_setup_cycles:kernelSetup,guard_recipe:'8 × (LDA + LXI H + CMP M + JNZ taken) + CALL + RET',loop_recipe:'MOV A,M + STAX D + INX D + INR L + DCR C + JNZ taken',size_estimate:{guard_bytes:8*(costs.lda.bytes+costs.lxi_h.bytes+costs.cmp_m.bytes+costs.jnz_taken.bytes)+costs.call.bytes+costs.ret.bytes,transfer_loop_bytes:4*(costs.mov_a_m.bytes+costs.stax_d.bytes+costs.inx_d.bytes+costs.inr_l.bytes)+costs.dcr_c.bytes+costs.jnz_taken.bytes,
blocks:{field_guard:8*(costs.lda.bytes+costs.lxi_h.bytes+costs.cmp_m.bytes+costs.jnz_taken.bytes)+costs.call.bytes+costs.ret.bytes,
rectangle_checks:4*(costs.lda.bytes+costs.lxi_h.bytes+costs.cmp_m.bytes+costs.jnz_taken.bytes)+2*costs.lxi_h.bytes+costs.call.bytes+costs.ret.bytes,
geometry_offsets:6*costs.lda.bytes+4*costs.lxi_h.bytes+8+6*2+4*costs.jnz_taken.bytes,
bidirectional_loops:2*(4*(costs.mov_a_m.bytes+costs.stax_d.bytes+costs.inx_d.bytes+costs.inr_l.bytes)+costs.dcr_c.bytes+costs.jnz_taken.bytes)+4*costs.jnz_taken.bytes,
transfer_setup:2*costs.lxi_h.bytes+costs.mvi_c.bytes,
entry_exit:costs.di.bytes+costs.shld.bytes+costs.lxi_h.bytes+1+costs.shld.bytes+2*costs.lhld.bytes+2*costs.sphl.bytes+costs.ei.bytes+costs.ret.bytes,
plane_cursor:4+2*costs.jnz_taken.bytes+costs.jmp.bytes,
fallback_dispatch:costs.jnz_taken.bytes+costs.call.bytes+costs.ret.bytes},estimated_not_assembled:true}},classes:Object.fromEntries(Object.entries(classes).map(([k,es])=>[k,{n:es.length,full:q(es.map(e=>e.full_cycles)),partial_saving:q(es.map(e=>e.full_cycles-e.partial_cycles)),guarded_saving:q(es.map(e=>e.full_cycles-e.guarded_cycles)),eligible:es.filter(e=>e.eligible).length,same_footprint:es.filter(e=>e.same_footprint).length,break_even_checks:q(es.map(e=>e.break_even_checks)),retained_bytes:q(es.map(e=>e.retained_bytes)),edge_bytes:q(es.map(e=>e.new_edge_bytes))}])),per_pack:packEst,per_step:perStep,summary:{packs:packEst.length,eligible_packs:packEst.filter(p=>p.eligible>0).length,eligible_pack_pct:100*packEst.filter(p=>p.eligible>0).length/(packEst.length||1),partial_saving:q(packEst.map(p=>p.partial_saving)),guarded_saving:q(packEst.map(p=>p.guarded_saving)),optimistic_saving:q(packEst.map(p=>p.optimistic_saving)),guarded_per_step:q(perStep.map(p=>p.guarded)),read_coverage_failures:scene.all_packs.flatMap(p=>p.events).filter(e=>e.operation==='save'&&!e.read_coverage?.match).length}};
}
function memoryInfo(){const lines=fs.readFileSync(path.join(ROOT,'build/kvalley_8c.lst'),'latin1').split('\n');let pending=null;for(const line of lines){const m=line.match(/^\s*\d+[+\s]\s*([0-9A-Fa-f]{4})\s/);if(!m)continue;const a=parseInt(m[1],16);if(pending!==null){if(a>pending)return {align_gap_start:pending,align_gap_end:a,align_free:a-pending};pending=null;}if(/\.align\b/.test(line))pending=a;}throw Error('no align gap');}
function main(){fs.mkdirSync(OUT,{recursive:true});assert(hash(path.join(ROOT,'build/kvalley_8c.rom'))===SHA,'unexpected ROM');const before=protectedManifest();const scenes={};const args=process.argv.slice(2);const quick=args.includes('--quick');for(const [name,driver,n]of quick?[['stress','repro',120]]:[['stress','repro',120],['natural','natural',2600]]){console.log('measuring',name,n);const raw=loadDriver(driver,n);scenes[name]=summarize(raw,n);console.log(name,'closure',scenes[name].closure,'tick',scenes[name].summary.all.logic_elapsed.median,'packs',scenes[name].baseline.packs.duration.median);}const E=harness.make(path.join(ROOT,'build/kvalley_8c.rom'),path.join(ROOT,'build/kvalley_8c.sym'));const costs=instructionCosts(E);for(const scene of Object.values(scenes)){scene.partial_save=evaluateSave(scene,costs);const sz=scene.partial_save.instruction_model.size_estimate;sz.estimated_total_bytes=Object.values(sz.blocks).reduce((a,b)=>a+b,0);}
 if(!quick){console.log('checking exact stress reproducibility');const rr=summarize(loadDriver('repro',120),120);rr.partial_save=evaluateSave(rr,costs);assert(JSON.stringify(rr.steps)===JSON.stringify(scenes.stress.steps),'stress steps differ on repeat');assert(JSON.stringify(rr.all_packs)===JSON.stringify(scenes.stress.all_packs),'stress packs differ on repeat');scenes.stress.reproducibility={steps_and_events_exact:true};}const after=protectedManifest();assert(JSON.stringify(before)===JSON.stringify(after),'protected files changed');const result={schema:1,build:'2709-1721-M',references:{stress_logic_median:103756,stress_pack_median:46100},rom_sha256:SHA,sym_sha256:hash(path.join(ROOT,'build/kvalley_8c.sym')),frame_cycles:59904,command:'node tools/verify/tick_breakdown.js',long_step_definition:'разность номеров видеокадров между фактическими стартами логики ≥ 3; разность ровно 4 выделена отдельно',instruction_costs:costs,memory:{...memoryInfo(),resident_end:E.L.snd_ov_res_end,romCeil:E.L.romCeil,rom_free:E.L.romCeil-E.L.snd_ov_res_end},protected_manifest:before,protected_unchanged:true,driver_sha256:hash(path.join(__dirname,'perf_baseline_1205.js')),scenes};fs.writeFileSync(path.join(OUT,quick?'quick.json':'results.json'),JSON.stringify(result,null,2)+'\n');console.log('saved',quick?'quick.json':'results.json');if(!quick)require('./tick_breakdown_report.js').generate(path.join(OUT,'results.json'));}
if(require.main===module)main();
