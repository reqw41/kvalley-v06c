'use strict';
// Загрузка функций модели beam_order (groups, metrics, beam...) без запуска её главной части.
const fs=require('fs'),path=require('path'),vm=require('vm');
module.exports=function load(OUT){
  let src=fs.readFileSync(path.join(__dirname,'beam_order_model.js'),'utf8');
  src=src.slice(0,src.indexOf('const scenes={};'));
  src=src.replace(/^#!.*\n/,'').replace("path.join(ROOT,'outputs/beamwait')","'"+OUT+"'").replace("(process.env.BW_OUT||path.join(ROOT,'outputs/beamwait'))","'"+OUT+"'");
  src=src.replace("const ROOT=path.resolve(__dirname,'../..')","const ROOT='/x'");
  const ctx={require,__dirname,console,process,Buffer};vm.createContext(ctx);
  vm.runInContext(src+';this.api={groups,metrics,beam,footprint,mod,F,stats,schedule}',ctx);
  return ctx.api;
};
