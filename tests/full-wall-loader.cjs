'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const THREE=require('../tools/verification/node_modules/three/build/three.cjs');
const {JSDOM}=require('../tools/verification/node_modules/jsdom');
const source=fs.readFileSync(path.join(__dirname,'../src/shared/load-wall.js'),'utf8').replace(/export function/g,'function');
const context={URL,AbortController,setTimeout,clearTimeout,console};vm.createContext(context);vm.runInContext(source+'\nglobalThis.api={loadWallModel,disposeWallModel}',context);
const {loadWallModel,disposeWallModel}=context.api;
const wait=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function ownedModel(){
 const group=new THREE.Group(),geometry=new THREE.BoxGeometry(),texture=new THREE.Texture(),material=new THREE.MeshStandardMaterial({map:texture,normalMap:texture});
 let g=0,m=0,t=0;geometry.addEventListener('dispose',()=>g++);material.addEventListener('dispose',()=>m++);texture.addEventListener('dispose',()=>t++);
 group.add(new THREE.Mesh(geometry,material),new THREE.Mesh(geometry,[material,material]));
 return {group,counts:()=>({geometry:g,material:m,texture:t})};
}
function harness(parse){
 const dom=new JSDOM('<a-scene></a-scene>',{url:'https://example.test/app/'}),scene=dom.window.document.querySelector('a-scene');
 const draco={dispose(){throw new Error('Request must not dispose the shared decoder')}};let constructors=0,calls=0,decoder;
 scene.systems={'gltf-model':{getDRACOLoader:()=>draco}};
 const fakeThree={...THREE,GLTFLoader:class{constructor(){constructors++}setDRACOLoader(value){decoder=value}parseAsync(buffer,base){calls++;assert(buffer instanceof ArrayBuffer);assert.equal(base,'https://example.test/app/assets/full-wall/');return parse(buffer,base)}}};
 return {dom,scene,draco,get decoder(){return decoder},get calls(){return calls},get constructors(){return constructors},run(extra={}){return loadWallModel({THREE:fakeThree,sceneEl:scene,url:'assets/full-wall/wall.glb',fetchFile:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}),...extra})}};
}
async function main(){
 {const model=ownedModel(),h=harness(async()=>({scene:model.group}));try{const loaded=await h.run();assert.equal(loaded,model.group);assert.equal(h.decoder,h.draco);assert.equal(h.calls,1);assert.deepEqual(model.counts(),{geometry:0,material:0,texture:0});new THREE.Group().add(loaded);disposeWallModel(loaded);assert.equal(loaded.parent,null);assert.deepEqual(model.counts(),{geometry:1,material:1,texture:1},'Shared geometry/material/texture freed once per ownership release')}finally{h.dom.window.close()}}
 {const h=harness(()=>{throw Error('unexpected parse')}),abort=new AbortController();abort.abort();try{await assert.rejects(h.run({signal:abort.signal}),e=>e.name==='AbortError');assert.equal(h.constructors,0)}finally{h.dom.window.close()}}
 {const h=harness(()=>{throw Error('unexpected parse')}),abort=new AbortController();let fetchedSignal;try{const pending=h.run({signal:abort.signal,fetchFile:(url,{signal})=>{fetchedSignal=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('fetch canceled'),{name:'AbortError'}))))}});abort.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert(fetchedSignal.aborted);assert.equal(h.calls,0)}finally{h.dom.window.close()}}
 {const parsed=deferred(),model=ownedModel(),h=harness(()=>parsed.promise),abort=new AbortController();try{const pending=h.run({signal:abort.signal});await wait();assert.equal(h.calls,1);abort.abort();await assert.rejects(pending,e=>e.name==='AbortError');parsed.resolve({scene:model.group});await wait();assert.deepEqual(model.counts(),{geometry:1,material:1,texture:1},'Late Draco parse result disposed once after cancellation')}finally{h.dom.window.close()}}
 {const parsed=deferred(),model=ownedModel(),h=harness(()=>parsed.promise);try{const pending=h.run({timeoutMs:12});await assert.rejects(pending,/timed out/);parsed.resolve({scene:model.group});await wait();assert.deepEqual(model.counts(),{geometry:1,material:1,texture:1},'Timeout also releases late parse result')}finally{h.dom.window.close()}}
 {const h=harness(()=>{throw Error('unexpected parse')});let fetchSignal;try{const pending=h.run({timeoutMs:12,fetchFile:(url,{signal})=>{fetchSignal=signal;return new Promise(()=>{})}});await assert.rejects(pending,/timed out/);assert(fetchSignal.aborted);assert.equal(h.calls,0)}finally{h.dom.window.close()}}
 {const bytes=deferred(),h=harness(()=>{throw Error('unexpected parse')}),abort=new AbortController();try{const pending=h.run({signal:abort.signal,fetchFile:async()=>({ok:true,arrayBuffer:()=>bytes.promise})});await wait();abort.abort();await assert.rejects(pending,e=>e.name==='AbortError');bytes.resolve(new ArrayBuffer(4));await wait();assert.equal(h.calls,0,'Late response bytes must not enter Draco decode')}finally{h.dom.window.close()}}
 for(const [fetchFile,pattern]of [[async()=>({ok:false,status:404}),/HTTP 404/],[async()=>{throw Error('network failed')},/network failed/]]){
  const h=harness(()=>{throw Error('unexpected parse')});try{await assert.rejects(h.run({fetchFile}),pattern);assert.equal(h.calls,0)}finally{h.dom.window.close()}
 }
 {const h=harness(async()=>({}));try{await assert.rejects(h.run(),/contains no scene/)}finally{h.dom.window.close()}}
 {const h=harness(()=>{throw Error('decode failed')});try{await assert.rejects(h.run(),/decode failed/)}finally{h.dom.window.close()}}
 console.log('PASS fullwall loader: owned GLB delivery; shared decoder; base URL; fetch/byte/parse cancellation; timeout abort and late cleanup; HTTP/decode failures; geometry/material/texture dedup disposal. No real Draco/GPU claim.');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1});
module.exports={main};
