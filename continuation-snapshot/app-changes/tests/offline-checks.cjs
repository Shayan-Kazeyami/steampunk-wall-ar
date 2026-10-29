const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert')
const ar=path.resolve(__dirname,'..')
const {createRequire}=require('module')
const crypto=require('crypto')
const verificationRequire=createRequire(path.join(ar,'tools/verification/package.json'))
let THREE,JSDOM
try {
 THREE=verificationRequire('three')
 ;({JSDOM}=verificationRequire('jsdom'))
} catch(error) {
 console.error('Install isolated test dependencies: npm ci --prefix tools/verification')
 throw error
}
assert.equal(THREE.REVISION,'158','Tests require independent Three r158')
assert.equal(verificationRequire('jsdom/package.json').version,'26.1.0','Tests require pinned JSDOM')
const sourcePaths=['src/effects/index.js','src/effects/evidence/contract-check.js',
 'src/ui/controller.js','src/tracking/index.js','src/main.js','src/shared/spec.json',
 'config/target-manifest.json','image-targets/steampunk-garage-wide.json','src/shared/load-preview.js','src/catalog/index.js','config/targets/driveway.json','image-targets/steampunk-driveway-sign.json']
const sourceHashes=Object.fromEntries(sourcePaths.map(relative=>[relative,
 crypto.createHash('sha256').update(fs.readFileSync(path.join(ar,relative))).digest('hex')]))
const spec=JSON.parse(fs.readFileSync(path.join(ar,'src/shared/spec.json')))
const results=[]
const canonicalControls=['Start','Overdrive','Retry','Preview animation','Exit preview','Reset','Reduce motion','Cancel','Stop camera']
const displayed=label=>spec.ui.controls[canonicalControls.indexOf(label)] || label

function load(file,names,extras={}){
 let code=fs.readFileSync(path.join(ar,file),'utf8').replace(/^import .*$/mg,'').replace(/export (function|const|class)/g,'$1')
 const context={console,THREE,setTimeout,clearTimeout,setInterval,clearInterval,URLSearchParams,AbortController,...extras}
 vm.createContext(context);vm.runInContext(code+'\n globalThis.moduleResult={'+names.join(',')+'}',context,{filename:file})
 return context.moduleResult
}
async function run(){
 const {createEffects}=load('src/effects/index.js',['createEffects'])
 const garageManifest=JSON.parse(fs.readFileSync(path.join(ar,'config/target-manifest.json')))
 const garageTarget=JSON.parse(fs.readFileSync(path.join(ar,'image-targets/steampunk-garage-wide.json')))
 const drivewayManifest=JSON.parse(fs.readFileSync(path.join(ar,'config/targets/driveway.json')))
 const drivewayTarget=JSON.parse(fs.readFileSync(path.join(ar,'image-targets/steampunk-driveway-sign.json')))
 const catalog=load('src/catalog/index.js',['getExperience','experiences'],{spec,garageManifest,garageTarget,drivewayManifest,drivewayTarget})
 assert.equal(catalog.getExperience('').id,'driveway')
 assert.equal(catalog.getExperience('?wall=garage-left').id,'driveway')
 assert.equal(catalog.experiences.length,1,'Garage is disabled in the active catalog')
 assert.equal(catalog.getExperience('?wall=unknown').id,'driveway')
 for(const entry of catalog.experiences){
  assert.equal(entry.panel.wallId,entry.manifest.wallId)
  assert.equal(entry.manifest.compiledTargetName,entry.compiledTarget.name)
  assert.equal(entry.manifest.trackingImagePath,entry.compiledTarget.imagePath)
  assert(fs.existsSync(path.join(ar,entry.compiledTarget.imagePath)))
  assert(fs.existsSync(path.join(ar,'src',entry.previewImage)))
 }
 results.push({id:'catalog-driveway-only',result:'pass',detail:'Only Driveway is active; stale Garage URLs fall back to Driveway; matching panel/manifest/compiled target and existing preview asset verified.'})

 const {runEffectsContractChecks}=load('src/effects/evidence/contract-check.js',['runEffectsContractChecks'],{createEffects})
 results.push(...runEffectsContractChecks({THREE,spec}))
 const dom=new JSDOM('<div id="mount"></div>',{url:'https://test.invalid/'})
 const {document}=dom.window
 const {createUIController}=load('src/ui/controller.js',['createUIController'],{document,window:dom.window})
 const log=[]
 const ui=createUIController({mount:document.querySelector('#mount'),spec,onOverdrive:()=>log.push('boost'),onStart:()=>log.push('start')})
 for(const state of [...spec.ui.trackingStates,...spec.ui.extraStates]){
  ui.setState({state,targetLabel:'Garage Left',canRetry:true})
  const shown=[...document.querySelectorAll('button')].filter(b=>!b.hidden && !b.closest('[hidden]')).map(b=>b.textContent.trim())
  const expected=spec.ui.visibleControlsByState[state].filter(x=>x!=='Reduce motion').map(x=>displayed(x==='Retry_if_canRetry'?'Retry':x))
  assert.deepEqual(shown,expected,`visible controls ${state}`)
 }
 ui.setState({state:'preview'});const boost=[...document.querySelectorAll('button')].find(b=>b.textContent===displayed('Overdrive'));boost.click();boost.click();assert.equal(log.length,2)
 ui.setState({state:'landing'});assert(boost.hidden || boost.disabled)
 ui.dispose();ui.dispose();boost.click();assert.equal(log.length,2)
 results.push({id:'ui-dom-state-controls-callbacks-disposal',result:'pass',detail:'All states, repeated callbacks, and disposal tested in JSDOM; no visual/layout claims'})
 // Delayed start is canceled immediately by stop: the XR attribute must never be added.
 const manifest=JSON.parse(fs.readFileSync(path.join(ar,'config/target-manifest.json')))
 const compiled=JSON.parse(fs.readFileSync(path.join(ar,'image-targets/steampunk-garage-wide.json')))
 const scene=document.createElement('div');scene.hasLoaded=false
 const attrs=[];const original=scene.setAttribute.bind(scene);scene.setAttribute=(k,v)=>{attrs.push(k);original(k,v)}
 dom.window.XR8={XrController:{configure(){}},stop(){}};dom.window.AFRAME={THREE,components:{xrweb:{}}}
 const {createTrackingAdapter}=load('src/tracking/index.js',['createTrackingAdapter'],{document,window:dom.window,targetManifestModule:manifest,compiledTargetModule:compiled})
 const states=[],errors=[]
 const tracker=createTrackingAdapter({sceneEl:scene,onState:e=>states.push(e.state),onError:e=>errors.push(e)})
 const started=tracker.start();await new Promise(r=>setTimeout(r,10));const stopped=tracker.stop();scene.hasLoaded=true;await Promise.all([started,stopped]);assert(!attrs.includes('xrweb'));assert.equal(errors.length,0);await tracker.dispose();await tracker.dispose()
 results.push({id:'tracking-cancel-pending-start',result:'pass',detail:'Stop during scene wait prevents XR activation; disposal safe twice. Mock runtime only.'})
 // Coordinator uses a DOM scene and a fake camera/texture loader, no WebGL or network.
 const page=new JSDOM('<div id="ui"></div><a-scene></a-scene><a-camera id="main-camera"></a-camera>',{url:'https://test.invalid/',pretendToBeVisual:true})
 const w=page.window,d=w.document,el=d.querySelector('a-scene'),cam=d.querySelector('a-camera')
 el.hasLoaded=true;el.object3D=new THREE.Scene();el.camera=new THREE.PerspectiveCamera(60,1,0.1,100);el.renderer={setPixelRatio(){}}
 cam.object3D=new THREE.Group()
 let now=0,component,stops=0
 const fakeThree={...THREE,TextureLoader:class {load(url,resolve){resolve(new THREE.Texture())}}}
 w.AFRAME={THREE:fakeThree,registerComponent(n,c){component=c}};w.matchMedia=()=>({matches:false})
 const {loadPreviewTexture}=load('src/shared/load-preview.js',['loadPreviewTexture'])
 const panel=Object.values(spec.panels).find(p=>p.wallId===manifest.wallId)
 const experience={id:'garage-left',label:'Garage Left',panel,manifest,compiledTarget:compiled,previewImage:'assets/garage-left.jpg',effectsConfig:{...spec.effects,panel}}
 const {createFieldSession}=load('src/shared/field-session.js',['createFieldSession'])
 const {createTrackingEventRecorder}=load('src/shared/tracking-events.js',['createTrackingEventRecorder'])
 const main=fs.readFileSync(path.join(ar,'src/main.js'),'utf8').replace(/^import .*$/mg,'')
 const ctx={createFieldSession,createTrackingEventRecorder,window:w,document:d,location:w.location,THREE:fakeThree,spec,manifest,performance:{now:()=>now},matchMedia:w.matchMedia,innerHeight:900,devicePixelRatio:1,URLSearchParams,console,AbortController,setTimeout,clearTimeout,loadPreviewTexture,getExperience:()=>experience,configuredExperiences:[experience],
 createEffects,runEffectsContractChecks,createUI:opts=>createUIController({...opts,spec}),createTrackingAdapter:()=>({stop:async()=>{stops++},start:async()=>{},dispose:async()=>{}})}
 vm.createContext(ctx);vm.runInContext(main,ctx);d.dispatchEvent(new w.Event('DOMContentLoaded'))
 const button=label=>[...d.querySelectorAll('button')].find(b=>b.textContent===label)
 async function flush(){await new Promise(r=>setTimeout(r,5))}
 button('Preview animation').click();await flush();component.tick(0,16);assert.equal(w.__steampunkDiagnostics.mode,'preview');assert.equal(el.object3D.children.length,1)
 button(displayed('Overdrive')).click();component.tick(0,16);assert.equal(w.__steampunkDiagnostics.overdrive,true)
 now=2000;button(displayed('Overdrive')).click();now=4000;component.tick(0,16);assert.equal(w.__steampunkDiagnostics.overdrive,true)
 now=5001;component.tick(0,16);assert.equal(w.__steampunkDiagnostics.overdrive,false)
 button('Exit preview').click();await flush();component.tick(0,16);assert.equal(w.__steampunkDiagnostics.mode,'landing');assert.equal(el.object3D.children.length,0);assert(stops>=2)
 w.dispatchEvent(new w.Event('pagehide'));await flush()
 results.push({id:'coordinator-preview-boost-expiry-exit-disposal',result:'pass',detail:'Offline DOM + scene objects: preview enter/exit, restartable 3000ms expiry, cleanup. Texture/camera adapter mocked; no rendering proof.'})
 results.push(...await require('./preview-loader.cjs')({load}))
 results.push(...await require('./coordinator-lifecycle.cjs')({load,THREE,JSDOM,spec,manifest,compiled}))
 results.push(...require('./driveway-effects.cjs')({load,THREE,spec}))
 await require('./runtime-regressions.cjs')({load,THREE,JSDOM,spec,manifest,compiled,results})
 const failures=results.filter(r=>r.result!=='pass')
 const report={status:'passed',testedAt:new Date().toISOString(),scope:'offline module tests; independent Three r158 and JSDOM, not actual AFrame/browser/phone proof',sourceHashes,results}
 const reportDir=path.join(ar,'tools/verification/results')
 fs.mkdirSync(reportDir,{recursive:true})
 fs.writeFileSync(path.join(reportDir,'offline-checks.json'),JSON.stringify(report,null,2)+'\n')
 dom.window.close();page.window.close()
 if(failures.length)throw Error(JSON.stringify(failures))
 console.log(`${results.length} offline checks passed`)
}
run().catch(e=>{
 const reportDir=path.join(ar,'tools/verification/results')
 fs.mkdirSync(reportDir,{recursive:true})
 fs.writeFileSync(path.join(reportDir,'offline-checks.json'),JSON.stringify({
  testedAt:new Date().toISOString(),scope:'offline mocked module checks; not actual AFrame/browser/phone proof',
  status:'failed',sourceHashes,results,error:e.stack || String(e),
 },null,2)+'\n')
 console.error(e);process.exitCode=1
})
