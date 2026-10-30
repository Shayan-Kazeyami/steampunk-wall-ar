const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/startup.js'),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'');
function run({graphics=true,library=true,ready=true,throws=false,initializeThrows=false}={}){
 const states=[],timers=[];let mounted=0,initialized=0,disposed=0,prepared=0,lost=0;
 const scene={hasLoaded:ready,renderer:ready?{}:null,camera:ready?{}:null,pause(){}};
 const doc={querySelector:s=>s==='#scene-template'?{content:{cloneNode:()=>({querySelector:()=>scene})}}:{remove(){}},createElement:()=>({getContext:()=>{if(throws)throw new Error('GPU unavailable');return graphics?{getExtension:()=>({loseContext:()=>lost++})}:null;}}),body:{appendChild:()=>mounted++}};
 const context={};vm.createContext(context);vm.runInContext(source,context);
 context.startApplication({doc,view:{AFRAME:library?{THREE:{}}:undefined,location:{reload(){}}},makeUI:()=>({setState:s=>states.push(s),dispose:()=>disposed++}),prepare:()=>prepared++,initialize:()=>{if(initializeThrows)throw new Error('Renderer failed');initialized++;},schedule:(fn,delay)=>{timers.push({fn,delay});return timers.length;},cancel(){}});
 return {states,timers,get mounted(){return mounted;},get initialized(){return initialized;},get disposed(){return disposed;},get prepared(){return prepared;},get lost(){return lost;}};
}
test('no WebGL leaves honest accessible error without mounting A-Frame',()=>{const app=run({graphics:false});assert.equal(app.states[0].controlsPending,true);assert.equal(app.states.at(-1).graphicsUnavailable,true);assert.match(app.states.at(-1).message,/WebGL/);assert.equal(app.mounted,0);assert.equal(app.prepared,0);});
test('throwing WebGL probe also preserves fallback',()=>{assert.equal(run({throws:true}).states.at(-1).state,'error');});
test('missing A-Frame yields reload recovery rather than exception',()=>{const app=run({library:false});assert.equal(app.states.at(-1).canRetry,true);assert.equal(app.mounted,0);});
test('supported graphics starts real coordinator and disposes temporary UI',()=>{const app=run();assert.equal(app.initialized,1);assert.equal(app.disposed,1);assert.equal(app.mounted,1);assert.equal(app.lost,1);});
test('scene that never becomes ready times out to usable fallback',()=>{const app=run({ready:false});app.timers.find(t=>t.delay===15000).fn();assert.equal(app.states.at(-1).state,'error');assert.equal(app.states.at(-1).canRetry,true);assert.equal(app.initialized,0);});
test('coordinator setup exceptions leave fallback visible',()=>{const app=run({initializeThrows:true});assert.equal(app.states.at(-1).state,'error');assert.equal(app.disposed,0);});
