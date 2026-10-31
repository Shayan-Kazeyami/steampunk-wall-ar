'use strict'
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict')
const context={URL,AbortController,setTimeout,clearTimeout,console};vm.createContext(context)
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/shared/load-wall.js'),'utf8').replace(/export function/g,'function')+'\nglobalThis.load=loadWallModel',context)
const flush=()=>new Promise(resolve=>setImmediate(resolve))
let cases=0
async function test(name,run){await run();cases++;console.log('PASS '+name)}
function setup({headers={},pending=false}={}){
 const chunks=[new Uint8Array([1,2]),new Uint8Array([3,4])],updates=[];let parsed,fetches=0,cancelled=0,released=0,reads=0
 const scene={ownerDocument:{baseURI:'https://test.invalid/ar/'},systems:{'gltf-model':{getDRACOLoader:()=>({})}}}
 const THREE={GLTFLoader:class{setDRACOLoader(){}async parseAsync(buffer){parsed=Array.from(new Uint8Array(buffer));return{scene:{traverse(){},removeFromParent(){}}}}}}
 const reader={read(){if(pending)return new Promise(()=>{});const value=chunks[reads++];return Promise.resolve(value?{done:false,value}:{done:true})},cancel(){cancelled++;return Promise.resolve()},releaseLock(){released++}}
 const response={ok:true,headers:{get:name=>headers[name]??null},body:{getReader:()=>reader}}
 return {updates,get parsed(){return parsed},get fetches(){return fetches},get cancelled(){return cancelled},get released(){return released},
  run(extra={}){return context.load({THREE,sceneEl:scene,url:'assets/wall.glb',fetchFile:async()=>{fetches++;return response},onProgress:value=>updates.push(value),...extra})}}
}
async function main(){
 await test('Known total and decode phases share one fetch',async()=>{const h=setup({headers:{'content-length':'4'}});await h.run();assert.deepEqual(h.parsed,[1,2,3,4]);assert.equal(h.fetches,1);assert.equal(h.released,1);const complete=h.updates.find(x=>x.phase==='download'&&x.status==='complete');assert.equal(complete.loadedBytes,4);assert.equal(complete.totalBytes,4);assert(h.updates.some(x=>x.phase==='decode'&&x.status==='loading'))})
 for(const headers of [{},{'content-length':'bad'},{'content-length':'999'},{'content-length':'2'},{'content-length':'4','content-encoding':'gzip'}])await test('Unknown/compressed/inconsistent total '+JSON.stringify(headers),async()=>{const h=setup({headers});await h.run();assert.equal(h.updates.find(x=>x.phase==='download'&&x.status==='complete').totalBytes,null)})
 await test('Cancellation from initial progress avoids starting network work',async()=>{const h=setup(),abort=new AbortController();await assert.rejects(h.run({signal:abort.signal,onProgress(){abort.abort()}}),e=>e.name==='AbortError');assert.equal(h.fetches,0)})
 await test('Cancellation from download-complete progress avoids decoding',async()=>{const h=setup(),abort=new AbortController();await assert.rejects(h.run({signal:abort.signal,onProgress(update){if(update.phase==='download'&&update.status==='complete')abort.abort()}}),e=>e.name==='AbortError');assert.equal(h.parsed,undefined)})
 await test('Presentation exception cannot fail loading',async()=>{const h=setup();await h.run({onProgress(){throw Error('presentation only')}});assert.equal(h.fetches,1);assert.deepEqual(h.parsed,[1,2,3,4])})
 await test('Abort cancels unresponsive stream and stops progress',async()=>{const h=setup({pending:true}),abort=new AbortController(),work=h.run({signal:abort.signal});await flush();const count=h.updates.length;abort.abort();await assert.rejects(work,e=>e.name==='AbortError');assert.equal(h.cancelled,1);assert.equal(h.parsed,undefined);assert.equal(h.updates.length,count)})
 await test('Deadline cancels reader without waiting for its promise',async()=>{const h=setup({pending:true});await assert.rejects(h.run({timeoutMs:10}),/timed out/);assert.equal(h.cancelled,1);assert.equal(h.parsed,undefined)})
 console.log(`PASS loader progress: ${cases} cases; no GPU/phone claim`)
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
