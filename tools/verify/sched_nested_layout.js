#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');const OUT=path.resolve(__dirname,'../../outputs/stage-sched-nested'),H=require('./beam_harness');
const E=H.make(path.join(OUT,'kvalley_8c.rom'),path.join(OUT,'kvalley_8c.sym')),B=H.make(path.join(OUT,'base/kvalley_8c.rom'),path.join(OUT,'base/kvalley_8c.sym'));
const out=[];let call=-1;for(let pc=E.L.vec_isr_nested;pc<E.L.vec_isr_done;pc++)if(E.rd(pc)===0xcd&&(E.rd(pc+1)|(E.rd(pc+2)<<8))===E.L.vec_nested_countdown)call=pc;
if(call<0||E.rd(call-1)!==0xf3)throw Error('countdown must follow DI');
if(E.L.vec_rev4!==B.L.vec_rev4)throw Error('aligned table page changed');
for(const n of [0,1,2]){E.memory.write(E.L.vec_fr_par,n,false);E.cpu.pc=call;E.cpu.sp=0xf700;E.cpu.iff=false;let cycles=0,ins=[];do{const pc=E.cpu.pc;E.cpu.instruction();cycles+=E.cpu.vcycles;ins.push({pc,cycles:E.cpu.vcycles});}while(E.cpu.pc!==call+3);if(E.rd(E.L.vec_fr_par)!==Math.max(0,n-1))throw Error('wrong countdown saturation');out.push({input:n,output:E.rd(E.L.vec_fr_par),cycles_without_call:cycles-ins[0].cycles,call_cycles:ins[0].cycles,total_cycles:cycles,instructions:ins});}
fs.writeFileSync(path.join(OUT,'countdown_cost.json'),JSON.stringify(out,null,2)+'\n');console.log(out.map(x=>[x.input,x.output,x.total_cycles]));
