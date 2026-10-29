'use strict'
// Real Three transforms; mocked XR/AFrame startup. This does not establish
// native recognition, sensor access, supported-phone validity or performance.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
const {JSDOM}=require('../tools/verification/node_modules/jsdom')
const root=path.resolve(__dirname,'..'),read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))
const manifest=read('config/targets/driveway.json'),compiled=read('image-targets/steampunk-driveway-sign.json')
const name=manifest.compiledTargetName
const source=fs.readFileSync(path.join(root,'src/tracking/index.js'),'utf8')
  .replace(/^import .*$/mg,'').replace(/export (const|function)/g,'$1')
const recorderSource=fs.readFileSync(path.join(root,'src/shared/tracking-events.js'),'utf8').replace(/export function/g,'function')

function fixture(options={}){
  const dom=new JSDOM('<a-scene></a-scene>',{url:'https://test.invalid/',pretendToBeVisual:true})
  const {window}=dom,{document}=window,scene=document.querySelector('a-scene')
  scene.hasLoaded=true;scene.object3D=new THREE.Scene()
  const events=[],states=[],errors=[],order=[],configs=[],modules=new Map()
  let running=false,configuredFlag=null,stops=0
  const create=document.createElement.bind(document)
  document.createElement=tag=>{
    const el=create(tag)
    if(tag==='a-entity'){el.hasLoaded=true;el.object3D=new THREE.Group();el.components={'xrextras-named-image-target':{}}}
    return el
  }
  window.AFRAME={THREE,components:{xrweb:{},'xrextras-named-image-target':{}}}
  const configure=value=>{
    assert(!running,'World mode must be configured before pipeline/run, including restarts')
    configuredFlag=value.disableWorldTracking;configs.push(value);order.push('configure:'+configuredFlag)
  }
  window.XR8={XrController:{configure,pipelineModule(){order.push('controller-pipeline');return {name:'reality'}}},
    addCameraPipelineModule(module){assert(!running,'Observation module installed before run');modules.set(module.name,module);order.push('add:'+module.name)},
    removeCameraPipelineModule(moduleName){modules.delete(moduleName)},
    stop(){running=false;stops++;order.push('stop')},
  }
  const set=scene.setAttribute.bind(scene)
  scene.setAttribute=(key,value)=>{
    if(key==='xrweb'){
      order.push('scene:'+value)
      const flag=/disableWorldTracking: (true|false)/.exec(value)?.[1]==='true'
      assert.equal(configuredFlag,flag,'Explicit controller and AFrame mode must agree')
      // Model the actual pinned AFrame integration: configure again, then create
      // controller pipeline and run. Both configure calls must select same mode.
      configure({disableWorldTracking:flag})
      window.XR8.XrController.pipelineModule();running=true;order.push('run')
    }
    set(key,value)
  }
  const context={window,document,console,URLSearchParams,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
    targetManifestModule:manifest,compiledTargetModule:compiled}
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.create=createTrackingAdapter;',context)
  const tracker=context.create({sceneEl:scene,manifest,compiledTarget:compiled,
    onState:value=>states.push(value),onError:value=>errors.push(value),
    onObservation:observation=>events.push(observation),...options})
  const event=(el,type,detail)=>el.dispatchEvent(new window.CustomEvent(type,{detail}))
  const emit=(type,detail)=>event(scene,type,detail)
  return {dom,window,document,scene,events,states,errors,order,configs,modules,tracker,emit,event,
    get target(){return scene.querySelector('a-entity')},get stops(){return stops},
    named(type,detail){event(this.target,type,detail)},
    scanning(){emit('xrimagescanning',{imageTargets:[{name}]})},
    video(){emit('camerastatuschange',{status:'HASVIDEO'})},
    found(){emit('xrimagefound',{name,scaledWidth:.4,scaledHeight:.3})},
    frame(reality){modules.get('steampunk-world-observation')?.onUpdate({processCpuResult:{reality}})},
    async close(){await tracker.dispose();dom.window.close()},
  }
}
const types=h=>h.events.map(event=>event.type)
const pose={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0,w:1}}
async function main(){
  // 1. Defaults, immutable diagnostics, true startup boundary, idempotency and retries.
  const baseline=fixture()
  try{
    await baseline.tracker.start()
    assert.equal(baseline.configs[0].disableWorldTracking,true)
    assert.equal(baseline.configs[0].imageTargetData[0].name,compiled.name)
    assert.equal(baseline.modules.size,0,'Default adapter installs no observation/GPU module')
    assert.deepEqual(types(baseline),[],'Adapter SEARCHING state is not native search/camera evidence')
    const diagnostics=baseline.tracker.getDiagnostics();assert.equal(diagnostics.worldTracking,false)
    diagnostics.worldTracking=true;assert.equal(baseline.tracker.getDiagnostics().worldTracking,false)
    baseline.emit('camerastatuschange',{status:'REQUESTING'})
    baseline.scanning();assert.deepEqual(types(baseline),[],'Declarations alone are not camera ready')
    baseline.video();assert.deepEqual(types(baseline),['camera-ready','search-started'])
    baseline.video();baseline.scanning();assert.equal(baseline.events.length,2,'Startup observations deduplicate per session')
    const configureCount=baseline.configs.length
    await baseline.tracker.start();assert.equal(baseline.configs.length,configureCount,'Active start never mutates mode')
    await baseline.tracker.retry();assert.equal(baseline.configs.length,configureCount+2)
    assert.equal(baseline.tracker.getDiagnostics().cameraHasVideo,false)
    baseline.video();assert.equal(types(baseline).at(-1),'camera-ready')
    baseline.emit('xrimagescanning',{imageTargets:[{name:'other'}]})
    assert.equal(types(baseline).at(-1),'camera-ready','Unknown declaration cannot establish expected target search')
    baseline.scanning();assert.equal(types(baseline).at(-1),'search-started')
    await baseline.tracker.stop();assert.equal(types(baseline).at(-1),'tracking-stopped')
    await baseline.tracker.start();assert(baseline.configs.every(config=>config.disableWorldTracking===true))
    assert(baseline.order.indexOf('configure:true')<baseline.order.indexOf('controller-pipeline'))
    assert.equal(baseline.errors.length,0)
  }finally{await baseline.close()}

  // 2. Raw callbacks precede geometry/smoothing/hide gates; duplicates reach recorder.
  const raw=fixture({transientLossMs:150})
  try{
    await raw.tracker.start();raw.video();raw.scanning()
    raw.named('xrextrasfound')
    assert.equal(types(raw).at(-1),'target-found')
    assert.equal(raw.tracker.getDiagnostics().rootVisible,false,'Geometry still gates visibility')
    raw.found()
    assert.equal(types(raw).filter(type=>type==='target-found').length,2,'Synthetic internal geometry recovery does not masquerade as recognizer callback')
    raw.named('xrextrasfound');raw.found()
    assert.equal(types(raw).filter(type=>type==='target-found').length,4,'All actual duplicate callbacks survive')
    const count=raw.events.length
    raw.tracker.update(100,16);raw.emit('xrimageupdated',{name})
    assert.equal(raw.events.length,count,'Render/pose updates never invent target-found')
    raw.emit('xrimagelost',{name});raw.named('xrextraslost');raw.named('xrextraslost')
    assert.equal(types(raw).filter(type=>type==='target-lost').length,3)
    assert.equal(raw.tracker.getDiagnostics().rootVisible,false)
    assert.equal(raw.tracker.getDiagnostics().lossPending,true)
    assert(raw.events.filter(event=>event.type.startsWith('target-')).every(event=>event.detail.target===name && event.detail.reason.length<=120))
    const recorderContext={globalThis:{performance:{now:()=>0}}};vm.createContext(recorderContext)
    vm.runInContext(recorderSource+'\nglobalThis.createRecorder=createTrackingEventRecorder;',recorderContext)
    let time=0
    const recorder=recorderContext.globalThis.createRecorder({now:()=>time++})
    recorder.begin({target:name});for(const {type,detail} of raw.events)recorder.record(type,detail)
    const snapshot=recorder.snapshot()
    assert(snapshot.events.some(event=>event.type==='target-found' && event.classification==='duplicate'))
    assert(snapshot.events.some(event=>event.type==='target-lost' && event.classification==='duplicate'))
    assert.equal(snapshot.summary['first-acquisition'].completed.count,1)
    await raw.tracker.stop();const stopped=raw.events.length
    raw.named('xrextrasfound');raw.found();raw.video();raw.scanning()
    assert.equal(raw.events.length,stopped,'Late stopped callbacks do not revive observations')
  }finally{await raw.close()}

  // 3. Update-only render recovery stays separate from native acquisition evidence.
  const updateOnly=fixture()
  try{
    await updateOnly.tracker.start()
    updateOnly.emit('xrimageupdated',{name,scaledWidth:.4,scaledHeight:.3})
    assert.equal(updateOnly.tracker.getDiagnostics().rootVisible,true,'Existing recovery behaviour is retained')
    assert(!types(updateOnly).includes('target-found'))
  }finally{await updateOnly.close()}

  // 4. World mode is consistent on every restart; known native status + finite pose
  // qualify world observations. Unknown states and mere pose presence do not.
  const world=fixture({worldTracking:true})
  try{
    await world.tracker.start()
    assert.equal(world.configs[0].disableWorldTracking,false)
    assert.equal(world.tracker.getDiagnostics().worldTracking,true)
    assert.equal(world.tracker.getDiagnostics().worldTrackingStatus,'UNKNOWN')
    assert.equal(world.tracker.getDiagnostics().worldTrackingValid,null)
    world.frame({...pose});world.frame({...pose,trackingStatus:'invented'})
    assert(!types(world).some(type=>type.startsWith('world-')))
    world.frame({...pose,trackingStatus:'NORMAL',trackingReason:'x'.repeat(1000)})
    assert.equal(types(world).at(-1),'world-tracking-valid')
    assert.equal(world.events.at(-1).detail.reason.length,120)
    world.frame({...pose,trackingStatus:'NORMAL'});assert.equal(world.events.length,1)
    world.frame({...pose,trackingStatus:'LIMITED',trackingReason:'INITIALIZING'})
    assert.equal(types(world).at(-1),'world-tracking-invalid')
    world.frame({...pose,trackingStatus:'NORMAL',position:{x:NaN,y:0,z:0}})
    assert.equal(world.tracker.getDiagnostics().worldTrackingValid,false)
    world.frame({...pose,trackingStatus:'NORMAL',rotation:{x:0,y:0,z:0,w:0}})
    assert.equal(world.tracker.getDiagnostics().worldTrackingValid,false)
    world.frame({...pose,trackingStatus:'NORMAL'});assert.equal(types(world).at(-1),'world-tracking-valid')
    world.frame({...pose,trackingStatus:'UNSPECIFIED'});assert.equal(types(world).at(-1),'world-tracking-invalid')
    world.frame({...pose});assert.equal(world.tracker.getDiagnostics().worldTrackingValid,null)
    assert.equal(world.tracker.getDiagnostics().worldTrackingStatus,'UNKNOWN')
    const stale=world.modules.get('steampunk-world-observation')
    await world.tracker.stop();assert.equal(world.modules.size,0)
    assert.equal(world.tracker.getDiagnostics().worldTrackingValid,null)
    const count=world.events.length;stale.onUpdate({processCpuResult:{reality:{...pose,trackingStatus:'NORMAL'}}})
    assert.equal(world.events.length,count,'Removed pipeline callback is inert')
    await world.tracker.start();stale.onUpdate({processCpuResult:{reality:{...pose,trackingStatus:'NORMAL'}}})
    assert.equal(world.events.length,count,'Previous session callback stays inert after restart')
    await world.tracker.retry();assert.equal(world.modules.size,1)
    assert(world.configs.every(config=>config.disableWorldTracking===false))
    assert(world.order.indexOf('configure:false')<world.order.indexOf('add:steampunk-world-observation'))
    assert(world.order.indexOf('configure:false')<world.order.indexOf('controller-pipeline'))
    world.found();world.named('xrextrasfound');world.emit('xrimagelost',{name})
    assert.equal(world.tracker.getDiagnostics().rootVisible,false,'World mode retains immediate hiding; no anchor persistence')
  }finally{await world.close()}

  // 5. Observer exceptions cannot prevent tracking, camera readiness or hiding.
  const throws=fixture({onObservation(){throw new Error('observer failed')},worldTracking:true})
  try{
    await throws.tracker.start();throws.video();throws.scanning();throws.found();throws.named('xrextrasfound')
    throws.frame({...pose,trackingStatus:'NORMAL'})
    assert.equal(throws.tracker.getDiagnostics().rootVisible,true)
    throws.emit('xrimagelost',{name});assert.equal(throws.tracker.getDiagnostics().rootVisible,false)
    await throws.tracker.stop();assert.equal(throws.errors.length,0)
  }finally{await throws.close()}

  // 6. Cancellation before readiness must never configure/run; retry can complete.
  const canceled=fixture({worldTracking:true})
  try{
    canceled.scene.hasLoaded=false
    const pending=canceled.tracker.start();await new Promise(resolve=>setTimeout(resolve,1))
    await Promise.all([pending,canceled.tracker.stop()])
    assert.equal(canceled.configs.length,0);assert.equal(canceled.modules.size,0)
    assert(!types(canceled).includes('camera-ready'));assert(!types(canceled).includes('search-started'))
    canceled.scene.hasLoaded=true;await canceled.tracker.retry()
    assert.equal(canceled.configs[0].disableWorldTracking,false)
    assert.equal(canceled.errors.length,0)
  }finally{await canceled.close()}

  // 7. Hidden pause excludes late callbacks, explicit restart resumes observations.
  const hidden=fixture({worldTracking:true})
  try{
    await hidden.tracker.start();hidden.video();hidden.scanning()
    Object.defineProperty(hidden.document,'visibilityState',{value:'hidden',configurable:true})
    hidden.event(hidden.document,'visibilitychange');await new Promise(resolve=>setTimeout(resolve,0))
    assert.equal(types(hidden).at(-1),'tracking-paused');assert.equal(hidden.modules.size,0)
    const count=hidden.events.length;hidden.found();hidden.video();assert.equal(hidden.events.length,count)
    Object.defineProperty(hidden.document,'visibilityState',{value:'visible',configurable:true})
    await hidden.tracker.start();assert.equal(types(hidden).at(-1),'tracking-resumed')
    hidden.scanning();hidden.video();assert.equal(types(hidden).at(-1),'search-started')
    await hidden.tracker.stop();assert.equal(types(hidden).at(-1),'tracking-stopped')
  }finally{await hidden.close()}
  console.log('PASS tracking observations: 7 groups; default/image+world configure-before-pipeline/run, restart/retry/Stop/cancellation, raw duplicates, no synthetic acquisition, camera/search boundary, native status qualification, observer isolation and hidden lifecycle. Supported-phone checks remain NOT RUN.')
}
main().catch(error=>{console.error(error);process.exitCode=1})
