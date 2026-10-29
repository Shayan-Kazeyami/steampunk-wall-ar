'use strict'
// Real HDR parser + environment lifecycle with deterministic network/GPU doubles.
// These checks establish cancellation/resource behavior, not browser rendering.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const source=fs.readFileSync(path.resolve(__dirname,'../src/full-wall/runtime/environment-lighting.js'),'utf8').replace('export const createEnvironmentLighting','const createEnvironmentLighting')
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve()}
const hdr=()=>Uint8Array.from(Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n'),Buffer.from([128,100,60,129])])).buffer
function harness(fetchFile,timeoutMs,options={}){
  const timers=new Map(),listeners=new Map(),targets=[],inputs=[],counts={fetch:0,texture:0,textureDisposed:0,generator:0,generatorDisposed:0,targetDisposed:0},prior={name:'prior'},material={envMapIntensity:2}
  let next=0,signal
  const gpu={lost:Boolean(options.initiallyLost),initialized:!options.initiallyLost,fail:false,duringBuild:null}
  const canvas={addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(callback)},removeEventListener(type,callback){listeners.get(type)?.delete(callback)}}
  const THREE={DataTextureLoader:class{},DataUtils:{toHalfFloat:value=>value},HalfFloatType:1016,FloatType:1015,
    DataTexture:class{constructor(data,width,height){counts.texture++;this.data=data;this.width=width;this.height=height}dispose(){counts.textureDisposed++}},
    PMREMGenerator:class{constructor(){counts.generator++}compileEquirectangularShader(){assert.equal(gpu.initialized,true,'PMREM waits for renderer restore listener')}fromEquirectangular(texture){if(gpu.fail)throw new Error('PMREM GPU failure');inputs.push(Array.from(texture.data));const target={texture:{name:'generated',id:targets.length+1},dispose(){assert.equal(this.disposed,undefined,'Target is disposed exactly once');this.disposed=true;counts.targetDisposed++}};targets.push(target);if(gpu.duringBuild)gpu.duringBuild();return target}dispose(){counts.generatorDisposed++}}}
  const scene={environment:prior,attached:options.attached!==false,traverse(callback){if(this.attached)callback({isMesh:true,material})}}
  const renderer={domElement:canvas,getContext(){return{isContextLost:()=>gpu.lost}}}
  const context={AbortController,console,setTimeout(callback,ms){const id=++next;timers.set(id,{callback,ms});return id},clearTimeout(id){timers.delete(id)}}
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.create=createEnvironmentLighting',context)
  const api=context.create({THREE,scene,renderer,timeoutMs,intensity:options.intensity,fetch(url,options){counts.fetch++;signal=options.signal;return fetchFile(url,options)}})
  // Deliberately register the simulated renderer listener AFTER the factory.
  canvas.addEventListener('webglcontextrestored',()=>{gpu.initialized=true})
  return{api,scene,prior,material,counts,timers,listeners,targets,inputs,gpu,canvas,get signal(){return signal},
    lose(){gpu.lost=true;gpu.initialized=false;for(const callback of listeners.get('webglcontextlost')||[])callback()},
    restore(){gpu.lost=false;for(const callback of listeners.get('webglcontextrestored')||[])callback()},
    expire(){assert.equal(timers.size,1);const [id,timer]=timers.entries().next().value;timers.delete(id);timer.callback()}}
}
async function main(){
  // A fetch that never resolves and ignores AbortSignal must still release ready.
  {
    const gate=deferred();let bodyReads=0
    const h=harness(()=>gate.promise)
    assert.equal([...h.timers.values()][0].ms,15000,'Production acquisition has a finite default deadline')
    h.expire();const state=await h.api.ready
    assert.equal(state.status,'error');assert.match(state.error,/timed out/);assert.equal(h.signal.aborted,true)
    assert.equal(h.scene.environment,h.prior);assert.equal(h.timers.size,0)
    gate.resolve({ok:true,arrayBuffer(){bodyReads++;return Promise.resolve(hdr())}});await flush()
    assert.equal(bodyReads,0,'Timed-out headers must not start a late body read')
    assert.equal(h.counts.texture,0,'Late network resolution cannot allocate or replace environment')
    assert.equal(h.api.state.status,'error');h.api.dispose()
  }
  // A received response with a body that never resolves uses the same deadline.
  {
    const body=deferred(),h=harness(()=>Promise.resolve({ok:true,arrayBuffer:()=>body.promise}),25)
    await flush();assert.equal([...h.timers.values()][0].ms,25);h.expire();await h.api.ready
    assert.equal(h.api.state.status,'error');assert.equal(h.signal.aborted,true)
    body.resolve(hdr());await flush()
    assert.equal(h.scene.environment,h.prior);assert.equal(h.counts.texture,0);assert.equal(h.timers.size,0);h.api.dispose()
  }
  // Disposal settles readiness immediately even when headers/body ignore abort.
  for(const stage of ['headers','body']){
    const gate=deferred(),h=harness(()=>stage==='headers'?gate.promise:Promise.resolve({ok:true,arrayBuffer:()=>gate.promise}),25)
    await flush();h.api.dispose();const state=await h.api.ready
    assert.equal(state.status,'disposed');assert.equal(h.signal.aborted,true);assert.equal(h.timers.size,0)
    if(stage==='headers')gate.resolve({ok:true,arrayBuffer:()=>Promise.resolve(hdr())});else gate.resolve(hdr())
    await flush();assert.equal(h.counts.texture,0);assert.equal(h.scene.environment,h.prior);assert.equal(h.material.envMapIntensity,2)
    h.api.dispose();assert.equal(h.api.state.status,'disposed')
  }
  // Late rejection after timeout is observed, and cannot overwrite timeout state.
  {
    const gate=deferred(),h=harness(()=>gate.promise,25);h.expire();await h.api.ready
    gate.reject(new Error('late network failure'));await flush();assert.match(h.api.state.error,/timed out/);h.api.dispose()
  }
  // Success clears the deadline and frees temporary GPU resources; dispose restores
  // prior scene lighting/material multipliers and releases the PMREM target once.
  {
    const h=harness(()=>Promise.resolve({ok:true,arrayBuffer:()=>Promise.resolve(hdr())}),25)
    const state=await h.api.ready
    assert.equal(state.status,'ready');assert.equal(state.width,1);assert.equal(state.height,1)
    assert.equal(h.scene.environment.name,'generated');assert.equal(h.material.envMapIntensity,1.1)
    assert.equal(h.timers.size,0);assert.equal(h.signal.aborted,false)
    assert.equal(h.counts.textureDisposed,1);assert.equal(h.counts.generatorDisposed,1)
    h.api.dispose();h.api.dispose();assert.equal(h.counts.targetDisposed,1)
    assert.equal(h.scene.environment,h.prior);assert.equal(h.material.envMapIntensity,2)
  }
  {
    const h=harness(()=>Promise.resolve({ok:false,status:503}),25);await h.api.ready
    assert.equal(h.api.state.status,'error');assert.match(h.api.state.error,/503/);assert.equal(h.timers.size,0);h.api.dispose()
  }
  const success=()=>Promise.resolve({ok:true,arrayBuffer:()=>Promise.resolve(hdr())})
  // Real parser input survives repeated losses without fetching again. Targets
  // are replaced after the whole restore event and superseded GPU work is freed.
  {
    const h=harness(success,25);await h.api.ready
    const bytes=h.api.state.sourceBytes;assert.equal(bytes,hdr().byteLength)
    for(let cycle=1;cycle<=3;cycle++){
      const old=h.scene.environment;h.lose();assert.equal(h.api.state.status,'context-lost')
      h.restore();assert.equal(h.scene.environment,old,'Rebuild is deferred until renderer is initialized')
      await flush();assert.notEqual(h.scene.environment,old);assert.equal(h.api.state.status,'ready')
      assert.equal(h.api.state.restorations,cycle);assert.equal(h.counts.targetDisposed,cycle)
      assert.equal(h.material.envMapIntensity,1.1);assert.equal(h.api.state.sourceBytes,bytes)
    }
    assert.equal(h.counts.fetch,1);assert.equal(h.inputs.length,4)
    for(const pixels of h.inputs)assert.deepEqual(pixels,h.inputs[0],'Every PMREM uses identical decoded HDR pixels')
    assert.equal(h.counts.textureDisposed,4);assert.equal(h.counts.generatorDisposed,4)
    h.api.dispose();assert.equal(h.api.state.sourceBytes,0);assert.equal(h.counts.targetDisposed,4)
    assert.equal(h.listeners.get('webglcontextlost').size,0)
    assert.equal(h.listeners.get('webglcontextrestored').size,1,'Only the simulated renderer listener remains')
  }
  // Models attached after preload have already received full-wall .72 and
  // camera gain. Restore must leave those values and versions exactly alone.
  {
    const h=harness(success,25,{attached:false,intensity:.72});await h.api.ready
    h.scene.attached=true;h.material.envMapIntensity=2*.72*1.37;h.material.version=7
    const before={...h.material};h.lose();h.restore();await flush()
    assert.deepEqual(h.material,before);h.api.dispose();assert.deepEqual(h.material,before)
  }
  {
    const h=harness(success,25,{intensity:.72});await h.api.ready
    h.material.envMapIntensity=2*.72*.83;h.material.version=11
    const before={...h.material};h.lose();h.restore();await flush()
    assert.deepEqual(h.material,before,'Previously captured materials keep current camera gain on restore')
    h.api.dispose();assert.equal(h.material.envMapIntensity,2)
  }
  // A later owner must not lose its environment on restore or disposal, even
  // when takeover happens between the restore event and its deferred rebuild.
  for(const stage of ['initial','before-restore','queued-restore','during-build']){
    const gate=deferred(),external={name:'external',dispose(){throw new Error('External resources must never be disposed')}}
    const h=harness(stage==='initial'?()=>gate.promise:success,25)
    if(stage==='initial'){
      h.scene.environment=external;gate.resolve({ok:true,arrayBuffer:()=>Promise.resolve(hdr())});await h.api.ready
    }else{
      await h.api.ready
      if(stage==='before-restore')h.scene.environment=external
      if(stage==='during-build')h.gpu.duringBuild=()=>{h.scene.environment=external}
      h.lose();h.restore();if(stage==='queued-restore')h.scene.environment=external;await flush()
    }
    assert.equal(h.scene.environment,external);assert.equal(h.api.state.status,'superseded')
    h.api.dispose();assert.equal(h.scene.environment,external)
    assert.equal(h.counts.targetDisposed,h.targets.length)
  }
  // Disposal or another loss invalidates queued restoration before GPU work.
  for(const action of ['dispose','lose']){
    const h=harness(success,25);await h.api.ready;h.lose();h.restore()
    if(action==='dispose')h.api.dispose();else h.lose()
    await flush();assert.equal(h.counts.generator,1)
    assert.equal(h.api.state.status,action==='dispose'?'disposed':'context-lost')
    if(action==='lose'){h.restore();await flush();assert.equal(h.counts.generator,2);h.api.dispose()}
  }
  // A context lost during PMREM generation cannot install its invalid target.
  {
    const h=harness(success,25);await h.api.ready;const old=h.scene.environment
    h.gpu.duringBuild=()=>h.lose();h.lose();h.restore();await flush()
    assert.equal(h.scene.environment,old);assert.equal(h.counts.targetDisposed,1)
    assert.equal(h.api.state.status,'context-lost');h.gpu.duringBuild=null;h.restore();await flush()
    assert.notEqual(h.scene.environment,old);assert.equal(h.counts.fetch,1);h.api.dispose()
  }
  {
    const h=harness(success,25);await h.api.ready
    h.gpu.duringBuild=()=>h.api.dispose();h.lose();h.restore();await flush()
    assert.equal(h.api.state.status,'disposed');assert.equal(h.scene.environment,h.prior)
    assert.equal(h.counts.targetDisposed,2);assert.equal(h.api.state.sourceBytes,0)
    assert.equal(h.counts.textureDisposed,2);assert.equal(h.counts.generatorDisposed,2)
  }
  {
    const h=harness(success,25);await h.api.ready
    h.lose();h.restore();h.restore();await flush()
    assert.equal(h.counts.generator,2,'Duplicate restored event cannot rebuild the same generation twice')
    h.api.dispose()
  }
  // Download may finish while lost or after restore. Neither race duplicates
  // initial PMREM generation; restoration after a lost preload preserves gain.
  for(const stage of ['headers','body','already-lost'])for(const finish of ['lost','restored']){
    const gate=deferred(),h=harness(()=>stage==='body'?Promise.resolve({ok:true,arrayBuffer:()=>gate.promise}):gate.promise,25,{initiallyLost:stage==='already-lost',attached:false,intensity:.72})
    await flush();if(stage!=='already-lost')h.lose()
    if(finish==='restored'){h.restore();await flush()}
    gate.resolve(stage==='body'?hdr():{ok:true,arrayBuffer:()=>Promise.resolve(hdr())});await h.api.ready
    if(finish==='lost'){
      assert.equal(h.counts.generator,0);assert.equal(h.api.state.status,'context-lost')
      h.scene.attached=true;h.material.envMapIntensity=2*.72*1.37;h.restore();await flush()
      assert.equal(h.material.envMapIntensity,2*.72*1.37)
    }
    assert.equal(h.api.state.status,'ready');assert.equal(h.counts.generator,1);assert.equal(h.counts.fetch,1);h.api.dispose()
  }
  // Actual GPU generation failure selects the previous environment, releases
  // the lost target and cached source, and never retries the network.
  for(const stage of ['initial','restore']){
    const h=harness(success,25);if(stage==='initial')h.gpu.fail=true
    await h.api.ready
    if(stage==='restore'){h.gpu.fail=true;h.lose();h.restore();await flush()}
    assert.equal(h.api.state.status,'error');assert.match(h.api.state.error,/GPU failure/)
    assert.equal(h.scene.environment,h.prior);assert.equal(h.api.state.sourceBytes,0)
    assert.equal(h.counts.targetDisposed,stage==='restore'?1:0)
    h.lose();h.restore();await flush();assert.equal(h.api.state.status,'error');assert.equal(h.counts.fetch,1)
    assert.equal(h.counts.textureDisposed,h.counts.texture);assert.equal(h.counts.generatorDisposed,h.counts.generator);h.api.dispose()
  }
  {
    const h=harness(()=>Promise.resolve({ok:true,arrayBuffer:()=>Promise.resolve(new ArrayBuffer(16*1024*1024+1))}),25)
    await h.api.ready;assert.equal(h.api.state.status,'error');assert.match(h.api.state.error,/16 MiB/)
    assert.equal(h.counts.texture,0);assert.equal(h.api.state.sourceBytes,0);assert.equal(h.scene.environment,h.prior);h.api.dispose()
  }
  console.log('PASS environment lighting: header/body timeout and disposal; real HDR parse; bounded cached source; repeated GPU replacement without refetch; renderer-listener ordering; intensity/version identity; ownership takeover; queued restore cancellation; mid-build loss; download/context races; initial/restore GPU failure fallback; all temporary/owned GPU resources released.')
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={main}
