#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),{createRequire}=require('module');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'outputs/stage-sched-nested');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const assert=(x,m)=>{if(!x)throw Error(m)};
const main=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/tick_breakdown/results.json')));
const prior=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/tick_breakdown/results_addendum1.json')));
const file=path.join(__dirname,'tick_breakdown_add1.js');
const code=fs.readFileSync(file,'utf8');
let source=(code.slice(0,code.lastIndexOf('module.exports={comparison,stats};if(require.main===module)main();'))+'module.exports={makeAPI,independent,comparison,stats};').replace("source=source.replace('module.exports={comparison,stats};if(require.main===module)main();'","source=source.replace('if(require.main===module)main();'");
if(process.argv.includes('--matched')) {
 const checkpoint='    checkpoints.push({ when: "after_setup", ...snapCtrl() });';
 const chain=" .replace('  let TT = 0;'";
 const injected=' .replace('+JSON.stringify(checkpoint)+','+JSON.stringify('    __setup(E);\n'+checkpoint)+')\n'+chain;
 const anchor="source=source.replace(' const oldInstruction=cpu.instruction.bind(cpu)'";
 const prefix='source=source.replace('+JSON.stringify(chain)+','+JSON.stringify(injected)+');\n'+
  "source=source.replace('__harness:wrapped', '__harness:wrapped,__setup:__onSetup');\n";
 source=source.replace(anchor,prefix+anchor);
 source=source.replace('console,process,Buffer,Set,Map,module:{exports:{}},__variant:variant', 'console,process,Buffer,Set,Map,module:{exports:{}},__onSetup,__variant:variant');
}
const initial={},normalization=[];let currentScene,currentMode;
function onSetup(E){const {L,rd,memory}=E;if(rd(L.tickInProgress)!==0)throw Error('unsafe setup normalization');const bytes=Array.from({length:L.varsEnd-L.GameStatus},(_,i)=>rd(L.GameStatus+i));if(currentMode==='baseline')initial[currentScene]=bytes;else{const diffs=[];for(let i=0;i<bytes.length;i++)if(bytes[i]!==initial[currentScene][i]){const addr=L.GameStatus+i;diffs.push({address:addr,old:bytes[i],new:initial[currentScene][i]});memory.write(addr,initial[currentScene][i],false);}normalization.push({scene:currentScene,range:[L.GameStatus,L.varsEnd],changes:diffs});}}
const ctx={require:createRequire(file),__dirname,console,process,Buffer,module:{exports:{}},__onSetup:onSetup};vm.createContext(ctx);vm.runInContext(source,ctx,{filename:file});
const A=ctx.module.exports,H=require('./beam_harness'),originalMake=H.make;
let selected;
H.make=(...args)=>originalMake(selected.rom,selected.sym);
const inputs={baseline:{rom:path.join(OUT,'base/kvalley_8c.rom'),sym:path.join(OUT,'base/kvalley_8c.sym')},new_rom:{rom:path.join(OUT,'kvalley_8c.rom'),sym:path.join(OUT,'kvalley_8c.sym')}};
assert(hash(inputs.baseline.rom)===main.rom_sha256,'wrong base');
const cohorts=prior.cohorts.ids;
const runs={},comparisons={};
for(const [name,scene,n] of (process.argv.includes('--stress')?[['stress','repro',120]]:[['stress','repro',120],['natural','natural',2600]])){
 runs[name]={};
 for(const mode of ['baseline','new_rom']){
  console.log('measure',name,mode,n);selected=inputs[mode];currentScene=name;currentMode=mode;
  // Both modes are observers only; count_nested is deliberately never selected.
  const raw=A.makeAPI('rom_observer').loadDriver(scene,n),extra=raw.extra;
  const measured=A.independent(raw,n,extra);extra.states=extra.states.filter(s=>s.tick<=n);
  assert(extra.counter_decrements===0,'host scheduler mutation');
  if(mode==='baseline')assert(JSON.stringify(measured.steps.map(s=>[s.logic_index,s.logic_start,s.interval_cycles]))===JSON.stringify(main.scenes[name].steps.map(s=>[s.logic_index,s.logic_start,s.interval_cycles])),'base timing changed');
  delete extra.calls;measured.all_packs=measured.all_packs.map(p=>({id:p.id,root_id:p.root_id,depth:p.depth,start:p.start,end:p.end,cost:p.cost,draw_own:p.draw_own}));
  runs[name][mode]={measured,extra};
 }
 const c=A.comparison(runs[name].baseline,runs[name].new_rom,name==='natural'?cohorts:null);
 c.views.new_rom=c.views.count_nested;delete c.views.count_nested;
 for(const x of c.checkpoints){x.new_rom=x.diagnostic;delete x.diagnostic;}
 c.diagnostic_reference=prior.comparisons[name].views.count_nested;
 c.frame_difference_vs_diagnostic_pct=100*(c.views.new_rom.frames.frames-c.diagnostic_reference.frames.frames)/c.diagnostic_reference.frames.frames;
 comparisons[name]=c;
 console.log(name,JSON.stringify({states:c.first_divergence,hist:c.views.new_rom.cadence.hist,frames:c.views.new_rom.frames.frames,beam:c.views.new_rom.frames.beam}));
}
H.make=originalMake;
const result={initial_state_normalization:normalization,schema:1,command:'node tools/verify/sched_nested_measure.js'+(process.argv.includes('--matched')?' --matched':'')+(process.argv.includes('--stress')?' --stress':''),inputs:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,{...v,rom_sha256:hash(v.rom),sym_sha256:hash(v.sym)}])),instrumentation:{scheduler_memory_hook:false,cpu_patches:false,input_bound_to_completed_ticks:true,closure:'CPU instructions plus independent IRQ clock gaps; exact next-start intervals'},cohorts:{three_frame:prior.cohorts.three_frame_gameplay,cheap:prior.cohorts.under_two_frame_work_budget,other:prior.cohorts.other,ids:cohorts},comparisons,runs};
fs.writeFileSync(path.join(OUT,process.argv.includes('--matched')?'matched.json':process.argv.includes('--stress')?'stress_debug.json':'measurement.json'),JSON.stringify(result,null,2)+'\n');
console.log('saved measurement.json');
