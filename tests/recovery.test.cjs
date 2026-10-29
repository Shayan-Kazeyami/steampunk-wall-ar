const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function boot(){
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*$/gm,'');
  const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/shared/spec.json'),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../config/target-manifest.json'),'utf8'));
  const states=[];let callbacks,starts=0,textures=0;
  const scene={hasLoaded:true,object3D:{background:null}};
  const THREE={TextureLoader:class{load(_url,_ok,_progress,fail){textures++;fail(new Error('image unavailable'));}}};
  const window={AFRAME:{THREE,registerComponent(){}},addEventListener(){},removeEventListener(){}};
  const document={readyState:'complete',querySelector:selector=>selector==='a-scene'?scene:{object3D:{}},addEventListener(){},removeEventListener(){}};
  const context={window,document,spec,manifest,matchMedia:()=>({matches:false}),location:{search:''},URLSearchParams,console:{error(){}},performance,createTrackingAdapter:()=>({stop:async()=>{},start:async()=>{starts++;},dispose:async()=>{}}),createEffects:()=>({setOverdrive(){},setTracked(){},setReducedMotion(){},dispose(){}}),createUI:options=>{callbacks=options;return {setState:value=>states.push(value),setOverdrive(){},setReducedMotion(){},dispose(){}};}};
  vm.runInNewContext(source,context);
  return {callbacks,states,get starts(){return starts;},get textures(){return textures;}};
}
test('first use starts on landing without opening camera',()=>{const app=boot();assert.equal(app.states.at(-1).state,'landing');assert.equal(app.starts,0);});
test('failed camera-free preview Retry never starts the camera',async()=>{const app=boot();await app.callbacks.onPreview();assert.equal(app.states.at(-1).state,'error');assert.equal(app.textures,1);await app.callbacks.onRetry();assert.equal(app.textures,2);assert.equal(app.starts,0);});
test('explicit Start switches retry destination back to AR',async()=>{const app=boot();await app.callbacks.onPreview();await app.callbacks.onStart();await app.callbacks.onRetry();assert.equal(app.starts,2);});
