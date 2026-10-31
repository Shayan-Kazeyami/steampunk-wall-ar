const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function boot(){
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')+'\nprepareScene(); boot();';
  const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/shared/spec.json'),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../config/target-manifest.json'),'utf8'));
  const states=[],listeners={};let callbacks,starts=0,textures=0,disposed=0,stops=0;
  const scene={hasLoaded:true,object3D:{background:null}};
  const THREE={TextureLoader:class{load(_url,_ok,_progress,fail){textures++;fail(new Error('image unavailable'));}}};
  const window={AFRAME:{THREE,registerComponent(){}},addEventListener:(name,fn)=>{listeners[name]=fn;},removeEventListener:name=>{delete listeners[name];}};
  const document={readyState:'complete',querySelector:selector=>selector==='a-scene'?scene:{object3D:{}},addEventListener(){},removeEventListener(){}};
  const context={window,document,spec,manifest,matchMedia:()=>({matches:false}),location:{search:''},URLSearchParams,console:{error(){}},performance,createTrackingAdapter:()=>({stop:async()=>{stops++;},start:async()=>{starts++;},dispose:async()=>{}}),createEffects:()=>({setOverdrive(){},setTracked(){},setReducedMotion(){},dispose(){disposed++;}}),createUI:options=>{callbacks=options;return {setState:value=>states.push(value),setOverdrive(){},setReducedMotion(){},dispose(){}};}};
  vm.runInNewContext(source,context);
  return {callbacks,states,listeners,get disposed(){return disposed;},get stops(){return stops;},get starts(){return starts;},get textures(){return textures;}};
}
test('first use starts on landing without opening camera',()=>{const app=boot();assert.equal(app.states.at(-1).state,'landing');assert.equal(app.starts,0);});
test('failed camera-free preview Retry never starts the camera',async()=>{const app=boot();await app.callbacks.onPreview();assert.equal(app.states.at(-1).state,'error');assert.equal(app.textures,1);await app.callbacks.onRetry();assert.equal(app.textures,2);assert.equal(app.starts,0);});
test('explicit Start switches retry destination back to AR',async()=>{const app=boot();await app.callbacks.onPreview();await app.callbacks.onStart();await app.callbacks.onRetry();assert.equal(app.starts,2);});

test('cached navigation preserves UI and returns to landing without auto-start',async()=>{const app=boot();await app.callbacks.onStart();await app.listeners.pagehide({persisted:true});assert.equal(app.states.at(-1).state,'landing');assert.equal(app.disposed,0);assert.equal(app.starts,1);assert.ok(app.stops>=2);await app.callbacks.onStart();assert.equal(app.starts,2);});
test('real departure after cached navigation still disposes once',async()=>{const app=boot();await app.listeners.pagehide({persisted:true});const depart=app.listeners.pagehide;await depart({persisted:false});await depart({persisted:false});assert.equal(app.disposed,1);assert.equal(app.listeners.pagehide,undefined);});
