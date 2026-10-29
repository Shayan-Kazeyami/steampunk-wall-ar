'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs'),{JSDOM}=require('../tools/verification/node_modules/jsdom')
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p)))
const driveway={manifest:read('config/targets/driveway.json'),compiledTarget:read('image-targets/steampunk-driveway-sign.json')}
const garage={manifest:read('config/target-manifest.json'),compiledTarget:read('image-targets/steampunk-garage-wide.json')}
function watchdogClock(){
  const tasks=new Map();let nextId=0
  return {
    setTimeout(callback,delay){
      if(delay!==30000)return setTimeout(callback,delay)
      const id={watchdog:++nextId};tasks.set(id,callback);return id
    },
    clearTimeout(id){if(id?.watchdog)tasks.delete(id);else clearTimeout(id)},
    get size(){return tasks.size},
    take(){const callbacks=[...tasks.values()];tasks.clear();return callbacks},
    fire(){for(const callback of this.take())callback()},
  }
}
function fixture(extra=garage,timers,options={}){
  const dom=new JSDOM('<a-scene></a-scene>',{url:'https://test.invalid/',pretendToBeVisual:true}),{window}=dom,{document}=window,scene=document.querySelector('a-scene')
  scene.hasLoaded=true;scene.object3D=new THREE.Scene()
  const states=[],errors=[],configs=[],attrs=[],create=document.createElement.bind(document)
  document.createElement=tag=>{const el=create(tag);if(tag==='a-entity'){el.hasLoaded=true;el.object3D=new THREE.Group();el.components={'xrextras-named-image-target':{}};const set=el.setAttribute.bind(el);el.setAttribute=(key,value)=>{if(key==='xrextras-named-image-target')el.targetName=value.name;set(key,value)}}return el}
  const set=scene.setAttribute.bind(scene);scene.setAttribute=(key,value)=>{attrs.push(key);set(key,value)}
  window.AFRAME={THREE,components:{xrweb:{},'xrextras-named-image-target':{}}};window.XR8={XrController:{configure:value=>configs.push(value)},stop(){}}
  const context={window,document,console,URLSearchParams,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,targetManifestModule:driveway.manifest,compiledTargetModule:driveway.compiledTarget,...timers}
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'src/tracking/index.js'),'utf8').replace(/^import .*$/mg,'').replace(/export (const|function)/g,'$1')+'\nglobalThis.create=createTrackingAdapter',context)
  const tracker=context.create({sceneEl:scene,manifest:driveway.manifest,compiledTarget:driveway.compiledTarget,additionalTargets:[extra],...options,onState:value=>states.push(value),onError:value=>errors.push(value)})
  const event=(el,type,detail)=>el.dispatchEvent(new window.CustomEvent(type,{detail}))
  const target=wall=>[...scene.querySelectorAll('a-entity')].find(el=>el.targetName===wall.manifest.compiledTargetName)
  const found=wall=>event(target(wall),'xrextrasfound'),lost=wall=>event(target(wall),'xrextraslost')
  const geometry=(wall,width=.4)=>event(scene,'xrimagefound',{name:wall.manifest.compiledTargetName,scaledWidth:width,scaledHeight:width*.75})
  return{dom,window,scene,states,errors,configs,attrs,tracker,event,target,found,lost,geometry,async close(){await tracker.dispose();dom.window.close()}}
}
async function run(){
  const h=fixture();try{
    await h.tracker.start();assert.equal(h.scene.querySelectorAll('a-entity').length,2)
    assert.equal(h.configs.length,1);assert.deepEqual(Array.from(h.configs[0].imageTargetData,item=>item.name),[driveway.compiledTarget.name,garage.compiledTarget.name])
    assert.equal(h.attrs.filter(key=>key==='xrweb').length,1,'Both walls share one camera startup')
    h.found(driveway);assert(!h.states.some(state=>state.state==='tracked'),'Geometry gate protects primary wall')
    h.geometry(driveway);const first=h.states.at(-1);assert.equal(first.manifest.candidateId,driveway.manifest.candidateId);assert(first.root.visible)
    h.found(garage);assert(first.root.visible,'Second wall also waits for valid geometry')
    h.geometry(garage,.53);const second=h.states.at(-1);assert.equal(second.manifest.candidateId,garage.manifest.candidateId)
    assert(!first.root.visible && second.root.visible,'Only the most recently recognized wall is visible')
    let diagnostics=h.tracker.getDiagnostics()
    assert.equal(diagnostics.targets.filter(item=>item.visible).length,1)
    assert.equal(diagnostics.primaryTarget,driveway.manifest.compiledTargetName)
    assert.equal(diagnostics.expectedTarget,garage.manifest.compiledTargetName,'Summary follows active Garage, not configured primary')
    assert.equal(diagnostics.trackingImagePath,garage.manifest.trackingImagePath)
    assert.equal(diagnostics.rootVisible,true);assert.equal(diagnostics.targetFound,true)
    h.event(h.scene,'xrimagescanning',{imageTargets:[{name:driveway.manifest.compiledTargetName},{name:garage.manifest.compiledTargetName}]})
    diagnostics=h.tracker.getDiagnostics();assert(diagnostics.expectedTargetDeclared && diagnostics.allTargetsDeclared)
    assert(diagnostics.targets.every(item=>item.declared))
    const updatesBefore=h.states.length
    for(let i=0;i<8;i++){
      h.event(h.scene,'xrimageupdated',{name:driveway.manifest.compiledTargetName})
      h.event(h.scene,'xrimageupdated',{name:garage.manifest.compiledTargetName})
    }
    assert.equal(h.states.length,updatesBefore,'Simultaneously visible updates cannot flicker or restart either experience')
    assert(second.root.visible && !first.root.visible)
    h.event(h.target(driveway),'xrextrasfound',{name:'unknown-wall'})
    assert.equal(h.states.length,updatesBefore,'Mismatched named events are ignored')
    const [pw,ph]=garage.manifest.panelImagePx,[cx,cy,cw]=garage.manifest.sourceCropPx;second.root.updateMatrixWorld(true)
    for(const [px,py]of [[0,0],[pw,0],[pw,ph],[0,ph]]){
      const actual=new THREE.Vector3(px/pw-.5,(ph/2-py)/pw,0).applyMatrix4(second.root.matrixWorld)
      assert(Math.abs(actual.x-((px-cx)/cw-.5)*.53)<1e-10)
      assert(Math.abs(actual.y-((cy+garage.manifest.sourceCropPx[3]/2-py)/cw)*.53)<1e-10,'Each wall uses its own crop transform')
    }
    const count=h.states.length;h.lost(driveway);assert.equal(h.states.length,count,'Late old-wall loss cannot replace active wall state');assert(second.root.visible)
    h.lost(garage);assert.equal(h.states.at(-1).state,'lost');assert.equal(h.states.at(-1).manifest.candidateId,garage.manifest.candidateId);assert(!second.root.visible)
    h.found(driveway);assert(first.root.visible);assert.equal(h.configs.length,1,'Changing walls never reconfigures/restarts the engine')
    h.found(garage);assert(second.root.visible);h.lost(garage);assert(first.root.visible,'An already-found other wall can resume when foreground wall is lost')
    await h.tracker.stop();assert(h.tracker.getDiagnostics().targets.every(item=>!item.visible && !item.found));const stoppedCount=h.states.length
    h.found(garage);assert.equal(h.states.length,stoppedCount,'Late events cannot revive a stopped session')
    await h.tracker.start();assert.equal(h.scene.querySelectorAll('a-entity').length,2,'Restart reuses target entities')
    assert.equal(h.attrs.filter(key=>key==='xrweb').length,2)
    h.event(h.scene,'camerastatuschange',{status:'DENIED'});const errorCount=h.errors.length;h.found(garage);assert(h.tracker.getDiagnostics().targets.every(item=>!item.visible));assert.equal(h.errors.length,errorCount)
  }finally{await h.close();assert.equal(h.scene.querySelectorAll('a-entity').length,0)}
  // Raw engine updates can recover a missed named acquisition. They carry the
  // latest pose through XRExtras; they must never steal an already active wall.
  const raw=fixture();try{
    await raw.tracker.start()
    raw.event(raw.scene,'xrimageupdated',{name:garage.manifest.compiledTargetName,scaledWidth:.53,scaledHeight:.3975})
    const garageRoot=raw.states.at(-1).root;assert(garageRoot.visible)
    assert.equal(raw.states.at(-1).manifest.candidateId,garage.manifest.candidateId)
    const count=raw.states.length
    raw.event(raw.scene,'xrimageupdated',{name:driveway.manifest.compiledTargetName,scaledWidth:.4,scaledHeight:.3})
    assert.equal(raw.states.length,count,'First background geometry must not steal focused wall')
    raw.event(raw.scene,'xrimageupdated',{name:'unknown-wall',scaledWidth:1,scaledHeight:1})
    raw.event(raw.scene,'xrimagelost',{name:'unknown-wall'})
    assert.equal(raw.states.length,count)
    raw.event(raw.scene,'xrimagelost',{name:garage.manifest.compiledTargetName})
    assert.equal(raw.states.at(-1).manifest.candidateId,driveway.manifest.candidateId)
    assert(!garageRoot.visible && raw.states.at(-1).root.visible)
    const afterRawLoss=raw.states.length;raw.lost(garage)
    assert.equal(raw.states.length,afterRawLoss,'Subsequent named loss is deduplicated')
    await raw.tracker.stop()
    const afterStop=raw.states.length
    raw.event(raw.scene,'xrimageupdated',{name:garage.manifest.compiledTargetName,scaledWidth:.53,scaledHeight:.3975})
    raw.geometry(garage,.99);raw.found(garage)
    assert.equal(raw.states.length,afterStop,'Stopped raw/named events cannot revive content')
    await raw.tracker.start();assert(!raw.tracker.getDiagnostics().allTargetsDeclared,'Declarations reset for each camera session')
    assert.equal(raw.tracker.getDiagnostics().targetImageLoad,'NOT_OBSERVED')
  }finally{await raw.close()}
  // Camera startup can synchronously acquire the secondary wall. Do not replace
  // that TRACKED state with SEARCHING merely because primary Driveway is absent.
  const immediate=fixture();try{
    const set=immediate.scene.setAttribute.bind(immediate.scene)
    immediate.scene.setAttribute=(key,value)=>{set(key,value);if(key==='xrweb'){immediate.geometry(garage);immediate.found(garage)}}
    await immediate.tracker.start()
    assert.equal(immediate.states.at(-1).state,'tracked')
    assert.equal(immediate.states.at(-1).manifest.candidateId,garage.manifest.candidateId)
  }finally{await immediate.close()}
  const hidden=fixture();try{
    await hidden.tracker.start();hidden.geometry(garage);hidden.found(garage)
    Object.defineProperty(hidden.window.document,'visibilityState',{value:'hidden',configurable:true})
    hidden.event(hidden.window.document,'visibilitychange')
    await new Promise(resolve=>setTimeout(resolve,0))
    assert.equal(hidden.states.at(-1).state,'paused')
    assert(hidden.tracker.getDiagnostics().targets.every(item=>!item.visible && !item.found))
    hidden.found(garage);assert.equal(hidden.states.at(-1).state,'paused')
  }finally{await hidden.close()}
  for(const extra of [
    {...garage,manifest:{...garage.manifest,candidateId:driveway.manifest.candidateId}},
    {...garage,manifest:{...garage.manifest,compiledTargetName:driveway.manifest.compiledTargetName},compiledTarget:{...garage.compiledTarget,name:driveway.compiledTarget.name}},
    {...garage,manifest:{...garage.manifest,sourceCropPx:[-1,0,100,100]}},
    {...garage,manifest:{...garage.manifest,sourceCropPx:[0,0,999999,100]}},
    null,
  ]){
    const invalidTarget=fixture(extra);try{
      await invalidTarget.tracker.start();assert.equal(invalidTarget.errors[0].code,'ASSET_LOAD_FAILED')
      assert(!invalidTarget.attrs.includes('xrweb'),'Malformed or duplicate targets fail before requesting camera')
    }finally{await invalidTarget.close()}
  }
  const partial=fixture();try{
    const create=partial.window.document.createElement.bind(partial.window.document)
    let stall=true
    partial.window.document.createElement=tag=>{
      const el=create(tag)
      if(tag==='a-entity' && partial.scene.querySelector('a-entity') && stall)el.hasLoaded=false
      return el
    }
    const starting=partial.tracker.start()
    await new Promise(resolve=>setTimeout(resolve,5))
    assert.equal(partial.scene.querySelectorAll('a-entity').length,2)
    await Promise.all([starting,partial.tracker.stop()])
    assert.equal(partial.errors.length,0,'Cancel halfway through target creation is not an error')
    assert.equal(partial.scene.querySelectorAll('a-entity').length,1,'Unfinished secondary entity is removed on cancellation')
    assert(!partial.attrs.includes('xrweb'))
    stall=false;await partial.tracker.start()
    assert.equal(partial.scene.querySelectorAll('a-entity').length,2,'Retry completes secondary target without duplicating primary')
    assert.equal(partial.configs.length,1)
  }finally{await partial.close()}
  const engineFailure=fixture();try{
    const configure=engineFailure.window.XR8.XrController.configure
    engineFailure.window.XR8.XrController.configure=()=>{throw new Error('engine setup failed')}
    await engineFailure.tracker.start()
    assert.equal(engineFailure.errors[0].code,'ENGINE_FAILED')
    assert(engineFailure.tracker.getDiagnostics().targets.every(item=>!item.visible && !item.found))
    engineFailure.window.XR8.XrController.configure=configure
    await engineFailure.tracker.retry();engineFailure.geometry(garage);engineFailure.found(garage)
    assert.equal(engineFailure.states.at(-1).state,'tracked','Retry recovers after engine setup failure')
    assert.equal(engineFailure.scene.querySelectorAll('a-entity').length,2)
  }finally{await engineFailure.close()}
  const clock=watchdogClock(),loading=fixture(garage,clock)
  const targetList=[{name:driveway.manifest.compiledTargetName},{name:garage.manifest.compiledTargetName}]
  try{
    await loading.tracker.start()
    assert.equal(clock.size,0,'Start never times out a user waiting for camera permission')
    loading.event(loading.scene,'xrimageloading',{imageTargets:targetList})
    assert.equal(clock.size,0,'Even loading before camera permission cannot start the countdown')
    loading.event(loading.scene,'camerastatuschange',{status:'hasVideo'})
    assert.equal(clock.size,1,'Countdown starts after loading and actual video are both observed')
    loading.event(loading.scene,'xrimageloading',{imageTargets:targetList})
    assert.equal(clock.size,1,'Repeated loading does not multiply or extend the deadline')
    loading.event(loading.scene,'xrimagescanning',{imageTargets:[targetList[0]]})
    assert.equal(clock.size,1,'A missing second wall cannot count as complete readiness')
    clock.fire()
    assert.equal(loading.errors.length,1)
    assert.equal(loading.errors[0].code,'ASSET_LOAD_FAILED');assert.equal(loading.errors[0].retryable,true)
    await new Promise(resolve=>setTimeout(resolve,0))
    assert.equal(loading.tracker.getDiagnostics().active,false)
    assert(loading.tracker.getDiagnostics().targets.every(item=>!item.visible && !item.found))
    loading.found(garage);assert.equal(loading.errors.length,1,'Late acquisition cannot clear target-load failure')
    await loading.tracker.retry()
    loading.event(loading.scene,'camerastatuschange',{status:'hasVideo'})
    assert.equal(clock.size,0,'Camera alone has no target-loading deadline')
    loading.event(loading.scene,'xrimageloading',{imageTargets:targetList});assert.equal(clock.size,1)
    loading.event(loading.scene,'xrimagescanning',{imageTargets:targetList});assert.equal(clock.size,0)
    assert.equal(loading.tracker.getDiagnostics().targetLoadPending,false)
    loading.geometry(garage);loading.found(garage);assert.equal(loading.states.at(-1).state,'tracked')
    clock.fire();assert.equal(loading.errors.length,1,'Successful target declaration cancels the deadline')
  }finally{await loading.close();assert.equal(clock.size,0)}
  for(const action of ['stop','dispose','hidden','error']){
    const clock=watchdogClock(),h=fixture(garage,clock)
    try{
      await h.tracker.start()
      h.event(h.scene,'camerastatuschange',{status:'hasVideo'})
      h.event(h.scene,'xrimageloading',{imageTargets:targetList});assert.equal(clock.size,1)
      // Keep a captured callback to verify its generation is invalidated even
      // when a browser already queued the timer before cancellation.
      const staleCallbacks=clock.take()
      if(action==='hidden'){
        Object.defineProperty(h.window.document,'visibilityState',{value:'hidden',configurable:true})
        h.event(h.window.document,'visibilitychange')
      }else if(action==='error')h.event(h.scene,'camerastatuschange',{status:'DENIED'})
      else await h.tracker[action]()
      const errors=h.errors.length
      for(const callback of staleCallbacks)callback()
      await new Promise(resolve=>setTimeout(resolve,0))
      assert.equal(h.errors.length,errors,action+' invalidates any already-queued timeout')
      assert.equal(clock.size,0)
    }finally{await h.close()}
  }
  const invalid=fixture({...garage,compiledTarget:{...garage.compiledTarget,name:'wrong'}});try{await invalid.tracker.start();assert.equal(invalid.errors[0].code,'ASSET_LOAD_FAILED');assert(!invalid.attrs.includes('xrweb'))}finally{await invalid.close()}
  const pending=fixture();try{pending.scene.hasLoaded=false;const starting=pending.tracker.start();await new Promise(resolve=>setTimeout(resolve,5));await Promise.all([starting,pending.tracker.stop()]);assert(!pending.attrs.includes('xrweb'))}finally{await pending.close()}
  console.log('PASS two-wall tracking: two real target declarations, one camera startup, independent crop transforms/geometry gates, automatic handoff, stale-loss isolation, fallback, active-wall diagnostics, simultaneous update stability, raw-event recovery/loss, hidden pause, malformed-target rejection, bounded target-load recovery without permission timeout, Stop/restart/error/cancel/disposal. XR events mocked; no phone recognition claim.')
}
run().catch(error=>{console.error(error);process.exitCode=1})
