const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')

module.exports = async function coordinatorLifecycle({load,THREE,JSDOM,spec,manifest,compiled}) {
  const results = []
  const {createFieldSession}=load('src/shared/field-session.js',['createFieldSession'])
  const {createTrackingEventRecorder}=load('src/shared/tracking-events.js',['createTrackingEventRecorder'])
  const sleep = ms => new Promise(resolve => setTimeout(resolve,ms))
  const {createEffects}=load('src/effects/index.js',['createEffects'])
  const {runEffectsContractChecks}=load('src/effects/evidence/contract-check.js',['runEffectsContractChecks'],{createEffects})
  const {loadPreviewTexture}=load('src/shared/load-preview.js',['loadPreviewTexture'])
  function harness({pendingTexture=false, stopOutcome=null}={}) {
    const dom = new JSDOM('<div id="ui"></div><a-scene><canvas class="a-canvas"></canvas></a-scene><a-camera id="main-camera"></a-camera>', {url:'https://test.invalid/',pretendToBeVisual:true})
    const window=dom.window,document=window.document,scene=document.querySelector('a-scene')
    const ratios=[]
    scene.hasLoaded=true;scene.object3D=new THREE.Scene();scene.camera=new THREE.PerspectiveCamera(60,1,.1,100);scene.renderer={setPixelRatio(value){ratios.push(value)}}
    document.querySelector('a-camera').object3D=new THREE.Group()
    let component,lateLoad,disposed=0,now=0,configures=0,stopCalls=0,resolveStop,currentStopOutcome=stopOutcome
    const pendingStop=new Promise(resolve=>{resolveStop=resolve})
    const fakeThree={...THREE,TextureLoader:class {load(url,onLoad) {
      if(pendingTexture){lateLoad=onLoad;return}
      onLoad(new THREE.Texture())
    }}}
    window.AFRAME={THREE:fakeThree,components:{xrweb:{}},registerComponent(name,value){component=value}}
    if(stopOutcome){
      window.AFRAME.components['xrextras-named-image-target']={}
      const create=document.createElement.bind(document)
      document.createElement=tag=>{const element=create(tag);if(tag==='a-entity'){element.hasLoaded=true;element.object3D=new THREE.Group();element.components={'xrextras-named-image-target':{}}}return element}
      window.XR8={XrController:{configure(){configures++}},stop(){stopCalls++;if(currentStopOutcome==='pending')return pendingStop;if(currentStopOutcome==='rejected')return Promise.reject(Error('stop failed'));return Promise.resolve()}}
    }
    window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
    const {createUIController}=load('src/ui/controller.js',['createUIController'],{document,window})
    const {createTrackingAdapter}=load('src/tracking/index.js',['createTrackingAdapter'],{document,window,targetManifestModule:manifest,compiledTargetModule:compiled})
    const panel=Object.values(spec.panels).find(p=>p.wallId===manifest.wallId)
    const experience={id:'garage-left',label:'Garage Left',panel,manifest,compiledTarget:compiled,previewImage:'assets/garage-left.jpg',effectsConfig:{...spec.effects,panel}}
    const context={createFieldSession,createTrackingEventRecorder,window,document,location:window.location,THREE:fakeThree,spec,performance:{now:()=>now},matchMedia:window.matchMedia,
      innerHeight:900,devicePixelRatio:3,URLSearchParams,AbortController,setTimeout,clearTimeout,console,
      getExperience:()=>experience,configuredExperiences:[experience],loadPreviewTexture,createEffects,runEffectsContractChecks,createTrackingAdapter:options=>createTrackingAdapter({...options,engineStopTimeoutMs:10}),
      createUI:options=>createUIController({...options,spec}),
    }
    vm.createContext(context)
    const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8').replace(/^import .*$/mg,'').replace(/^export /mg,'')+'\nprepareScene();boot();'
    vm.runInContext(source,context,{filename:'src/main.js'})
    document.dispatchEvent(new window.Event('DOMContentLoaded'))
    const click=label=>{
      const button=[...document.querySelectorAll('button')].find(button=>button.textContent===label)
      assert(button && !button.hidden && !button.disabled,`Missing usable ${label}`)
      button.click()
    }
    return {dom,window,document,scene,click,ratios,get configures(){return configures},get stopCalls(){return stopCalls},resolveStop,setStopOutcome(value){currentStopOutcome=value},tick(step=16){now+=step;component.tick(now,step)},
      late(){lateLoad({dispose(){disposed++}})},disposed:()=>disposed,
      mode(){component.tick(0,16);return window.__steampunkDiagnostics.mode},
      async close(){resolveStop();window.dispatchEvent(new window.PageTransitionEvent('pagehide',{persisted:false}));await sleep(10);window.close()},
    }
  }
  const h=harness({pendingTexture:true})
  try {
    h.click('Preview animation');await sleep(10)
    assert.equal(h.mode(),'loading')
    h.click('Cancel');await sleep(30)
    assert.equal(h.mode(),'landing','Cancel must unblock pending preview immediately')
    h.late();await sleep(10)
    assert.equal(h.disposed(),1,'Late canceled preview texture must be disposed')
    assert.equal(h.mode(),'landing')
    assert.equal(h.scene.object3D.children.length,0)
    results.push({id:'coordinator-cancel-pending-texture',result:'pass',detail:'Cancel releases stalled preview queue to landing and disposes late texture; actual helper/coordinator, mocked loader.'})
  } finally {await h.close()}
  const engine=harness()
  try {
    engine.click('Start');await sleep(10)
    assert.equal(engine.mode(),'loading')
    engine.click('Cancel');await sleep(30)
    assert.equal(engine.mode(),'landing','Cancel must unblock actual adapter engine wait')
    assert.equal(engine.scene.hasAttribute('xrweb'),false)
    results.push({id:'coordinator-cancel-pending-engine',result:'pass',detail:'Actual coordinator/adapter cancellation reaches landing while XR engine is absent; no camera started.'})
  } finally {await engine.close()}
  const cached=harness()
  try {
    cached.click('Preview animation');await sleep(10)
    assert.equal(cached.mode(),'preview')
    const canvases=cached.document.querySelectorAll('canvas.a-canvas').length
    cached.window.dispatchEvent(new cached.window.PageTransitionEvent('pagehide',{persisted:true}))
    cached.window.dispatchEvent(new cached.window.PageTransitionEvent('pageshow',{persisted:true}))
    await sleep(20)
    assert.equal(cached.mode(),'landing')
    assert.equal(cached.scene.object3D.children.length,0)
    cached.click('Preview animation');await sleep(10)
    assert.equal(cached.mode(),'preview','UI remains reusable after bfcache restoration')
    cached.click(spec.ui.controls[1]);cached.tick()
    assert.equal(cached.window.__steampunkDiagnostics.overdrive,true)
    assert.equal(cached.document.querySelectorAll('canvas.a-canvas').length,canvases)
    assert.equal(cached.document.querySelectorAll('.wall-picker').length,0)
    results.push({id:'coordinator-bfcache-reusable-ui',result:'pass',detail:'Persisted pagehide/pageshow returns landing; preview/boost reusable without a page-switching picker; unchanged simulated canvas count; DOM events only.'})
  } finally {await cached.close()}
  for(const stopOutcome of ['rejected','pending']){
    const unsafe=harness({stopOutcome})
    try{
      unsafe.click('Start')
      await sleep(100)
      assert.equal(unsafe.configures,0,`${stopOutcome} stop before Start cannot configure camera`)
      assert.equal(unsafe.mode(),'error',`${stopOutcome} stop must present recovery, not landing`)
      assert.match(unsafe.document.querySelector('#ui').textContent,/reload/i,'uncertain camera stop needs reload guidance')
      unsafe.window.dispatchEvent(new unsafe.window.PageTransitionEvent('pagehide',{persisted:true}))
      unsafe.window.dispatchEvent(new unsafe.window.PageTransitionEvent('pageshow',{persisted:true}))
      await sleep(100)
      assert.equal(unsafe.configures,0,'page restoration cannot restart an uncertain camera')
      assert.notEqual(unsafe.mode(),'landing','page restoration cannot claim camera stopped')
      results.push({id:`coordinator-xr-stop-${stopOutcome}`,result:'pass',detail:'Mocked XR failure, UI recovery and page cache restoration; no camera hardware claim.'})
    } finally {await unsafe.close()}
  }
  for(const stopOutcome of ['rejected','pending']){
    const unsafe=harness({stopOutcome:'resolved'})
    try{
      unsafe.click('Start');await sleep(30)
      assert.equal(unsafe.configures,1,'camera session started before testing Stop')
      unsafe.setStopOutcome(stopOutcome)
      unsafe.click('Stop camera');await sleep(100)
      assert.equal(unsafe.mode(),'error','failed active stop must not claim landing')
      assert.match(unsafe.document.querySelector('#ui').textContent,/reload/i)
      for(const label of ['Start','Preview animation']){
        const button=[...unsafe.document.querySelectorAll('button')].find(button=>button.textContent===label)
        if(button && !button.disabled){button.click();button.click()}
      }
      await sleep(100)
      assert.equal(unsafe.configures,1,'repeated Start or Preview must not overlap uncertain camera')
      assert.notEqual(unsafe.mode(),'preview')
      results.push({id:`coordinator-active-xr-stop-${stopOutcome}`,result:'pass',detail:'Actual UI and adapter with mocked camera stop failure; no hardware claim.'})
    } finally {await unsafe.close()}
  }
  const quality=harness()
  try {
    assert.deepEqual(quality.ratios,[1.5],'High-DPR devices start at the contracted cap')
    quality.click('Preview animation');await sleep(10)
    quality.click(spec.ui.controls[1]);quality.tick()
    assert.equal(quality.window.__steampunkDiagnostics.overdrive,true)
    Object.defineProperty(quality.document,'hidden',{configurable:true,value:true})
    quality.document.dispatchEvent(new quality.window.Event('visibilitychange'));quality.tick()
    assert.equal(quality.window.__steampunkDiagnostics.overdrive,false,'Hidden preview must clear overload')
    Object.defineProperty(quality.document,'hidden',{configurable:true,value:false})
    // Simulate four separate 10-second slow windows with the coordinator clock.
    quality.tick()
    for(let i=1;i<=4;i++){
      quality.tick(10001)
      assert.equal(quality.window.__steampunkDiagnostics.fallback,i)
      assert.equal(quality.window.__steampunkDiagnostics.performanceFailed,i===4)
    }
    assert.deepEqual(quality.ratios,[1.5,1],'Lower resolution once before removing optional effects')
    const root=quality.scene.object3D.children[0]
    root.traverse(node=>{if(/glow/i.test(node.name))assert.equal(node.visible,false)})
    results.push({id:'coordinator-mobile-quality-and-hidden-preview',result:'pass',detail:'High-DPR cap 1.5; four slow windows lower DPR, disable steam/glows, then flag failure; hidden preview clears overload. Simulated clock, not measured device FPS.'})
  } finally {await quality.close()}
  return results
}
