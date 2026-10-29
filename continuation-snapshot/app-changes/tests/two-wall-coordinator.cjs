'use strict'
// Run the real collection coordinator and UI against controlled XR/asset boundaries.
// This tests lifecycle ownership, not a camera, GLB appearance or phone performance.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs'),{JSDOM}=require('../tools/verification/node_modules/jsdom')
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p)))
const spec=read('src/shared/spec.json')
const experiences=[
 {id:'driveway',label:'Driveway',panel:spec.panels.driveway,manifest:read('config/targets/driveway.json'),compiledTarget:read('image-targets/steampunk-driveway-sign.json'),previewImage:'driveway.jpg',fullWall:{modelUrl:'driveway.glb',environmentUrl:'studio.hdr'}},
 {id:'garage-left',label:'Garage Left',panel:spec.panels.garageLeft || Object.values(spec.panels).find(panel=>panel.wallId==='GARAGE_LEFT'),manifest:read('config/target-manifest.json'),compiledTarget:read('image-targets/steampunk-garage-wide.json'),previewImage:'garage.jpg'},
]
experiences[1].panel=Object.values(spec.panels).find(panel=>panel.wallId===experiences[1].manifest.wallId)
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function load(relative,names,extras={}){const context={console,setTimeout,clearTimeout,URL,AbortController,...extras};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,relative),'utf8').replace(/^import .*$/mg,'').replace(/export (function|const|class)/g,'$1')+'\nglobalThis.api={'+names.join(',')+'}',context);return context.api}
function harness({pendingModel=false,pendingTexture=false,failModels=0,pageUrl='https://test.invalid/',trialConfig=null}={}){
 const dom=new JSDOM('<div id="ui"></div><a-scene><a-light></a-light><canvas class="a-canvas"></canvas></a-scene><a-camera id="main-camera"></a-camera>',{url:pageUrl,pretendToBeVisual:true}),{window}=dom,{document}=window,scene=document.querySelector('a-scene')
 window.__steampunkTrialConfig=trialConfig
 scene.hasLoaded=true;scene.object3D=new THREE.Scene();scene.camera=new THREE.PerspectiveCamera(60,1,.01,100);scene.renderer={setPixelRatio(){}};scene.play=()=>{};scene.resize=()=>{}
 scene.querySelector('a-light').object3D=new THREE.Group();document.querySelector('a-camera').object3D=new THREE.Group()
 const effects=[],models=[],textures=[],errors=[],modelGate=deferred();let trackerOptions,uiOptions,component,now=0,starts=0,stops=0,trackerDisposals=0,downloads=0,lateTexture,modelProgress
 const fakeThree={...THREE,TextureLoader:class{load(url,callback){const texture=new THREE.Texture();let disposals=0;texture.addEventListener('dispose',()=>disposals++);textures.push({texture,disposed:()=>disposals});if(pendingTexture)lateTexture=()=>callback(texture);else callback(texture);return texture}}}
 window.AFRAME={THREE:fakeThree,registerComponent(name,value){component=value}};window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
 const {createUIController}=load('src/ui/controller.js',['createUIController'],{window,document}),{loadPreviewTexture}=load('src/shared/load-preview.js',['loadPreviewTexture']),{createFieldSession}=load('src/shared/field-session.js',['createFieldSession'])
 function makeEffect(kind,model,onSoundState=()=>{}){
   const object3D=new THREE.Group();object3D.name=kind;if(model)object3D.add(model)
   const state={kind,tracked:false,boost:false,sound:false,light:'studio',updates:0,suspensions:0,suspended:false,disposals:0,interactions:0,samples:[],steam:true}
   const effect={object3D,state,ready:Promise.resolve(),setTracked(value){state.tracked=value;state.suspended=false;object3D.visible=value;if(!value){state.sound=false;onSoundState({enabled:false})}},suspendTracking(){if(!state.tracked && !state.suspended)return false;state.suspended=true;state.tracked=false;state.suspensions++;state.sound=false;state.boost=false;object3D.visible=false;onSoundState({enabled:false});return true},setOverdrive(value){state.boost=value},setLightingMode(value){state.light=value},setCameraLighting(value){state.samples.push(value)},setReducedMotion(value){state.reduced=value},setSteamEnabled(value){state.steam=value},async setSoundEnabled(value){state.sound=value;onSoundState({enabled:value});return value},interact(){state.interactions++;return true},interactAt(){state.interactions++;return{action:'gear'}},reset(){state.boost=false;state.sound=false},update(){state.updates++},dispose(){state.disposals++;if(model)model.disposed++;object3D.removeFromParent()},getDiagnostics(){return{kind}}}
   effects.push(effect);return effect
 }
 const {createTrackingEventRecorder}=load('src/shared/tracking-events.js',['createTrackingEventRecorder'])
 const {createWorldSnow}=load('src/shared/world-snow.js',['createWorldSnow'])
 const trackingDiagnostics={worldTrackingValid:null,worldTrackingStatus:'UNKNOWN'}
 const context={window,document,location:window.location,performance:{now:()=>now},matchMedia:window.matchMedia,innerHeight:900,devicePixelRatio:1,URLSearchParams,AbortController,setTimeout,clearTimeout,console:{...console,error:value=>errors.push(value)},spec,configuredExperiences:experiences,getExperience:()=>experiences[0],createFieldSession,createTrackingEventRecorder,loadPreviewTexture,
  createWorldSnow,createUI:options=>{uiOptions=options;return createUIController({...options,spec})},runEffectsContractChecks(){return[]},
  createTrackingAdapter(options){trackerOptions=options;return{getDiagnostics:()=>({...trackingDiagnostics}),async start(){starts++;options.onState({state:'searching'})},async stop(){stops++},async dispose(){trackerDisposals++}}},
  async loadWallModel(options){downloads++;modelProgress=options.onProgress;modelProgress?.({phase:'download',status:'loading',loadedBytes:0,totalBytes:null});if(failModels>0){failModels--;throw Error('controlled model failure')}const model=new THREE.Group();model.disposed=0;models.push(model);if(pendingModel)await modelGate.promise;return model},disposeWallModel:model=>model.disposed++,warmWallModel:()=>true,
  createFullWallEffects:options=>makeEffect('driveway',options.model,options.onSoundState),createEffects:()=>makeEffect('garage-left'),
 }
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'src/main.js'),'utf8').replace(/^import .*$/mg,''),context,{filename:'src/main.js'});document.dispatchEvent(new window.Event('DOMContentLoaded'))
 const targets=new Map(experiences.map(entry=>[entry.id,new THREE.Group()]));for(const target of targets.values())scene.object3D.add(target)
 return{window,document,scene,effects,models,textures,errors,get starts(){return starts},get stops(){return stops},get downloads(){return downloads},get trackerDisposals(){return trackerDisposals},get options(){return uiOptions},
  tick(step=16){now+=step;component.tick(now,step);return window.__steampunkDiagnostics},mode(){return this.tick().mode},
  click(key){const button=document.querySelector('[data-control="'+key+'"]');assert(button && !button.hidden && !button.disabled,key+' available');button.click()},
  effect(id){return effects.findLast(effect=>effect.state.kind===id)},track(id){const entry=experiences.find(entry=>entry.id===id);trackingDiagnostics.activeTarget=entry.manifest.compiledTargetName;trackerOptions.onState({state:'tracked',root:targets.get(id),manifest:entry.manifest});return targets.get(id)},lost(transient=false){trackingDiagnostics.activeTarget=null;trackerOptions.onState({state:'lost',transient})},lighting(value){trackerOptions.onLighting(value)},
  observe(type,detail={}){trackerOptions.onObservation({type,detail})},get trackerOptions(){return trackerOptions},
  progress(update){modelProgress?.(update)},worldPose(valid){trackingDiagnostics.worldTrackingValid=valid;trackingDiagnostics.worldTrackingStatus=valid?'NORMAL':'LIMITED'},
  pointer(type){const event=new window.Event(type);Object.assign(event,{pointerId:1,button:0,isPrimary:true,clientX:10,clientY:10});scene.querySelector('canvas').dispatchEvent(event)},
  hidden(value){Object.defineProperty(document,'hidden',{configurable:true,value});document.dispatchEvent(new window.Event('visibilitychange'))},lateModel(){modelGate.resolve()},lateTexture(){lateTexture()},
  async close(){window.dispatchEvent(new window.PageTransitionEvent('pagehide',{persisted:false}));await flush();window.close()},
 }
}
async function main(){
 const h=harness();try{
  await flush();assert.equal(h.downloads,1,'Startup prepares the full model once');assert.equal(h.effects.length,2)
  const idle=h.effect('driveway');for(let i=0;i<60;i++)h.tick();assert.equal(idle.state.updates,0,'Cached effects do no repeated update/reset work on landing')
  h.click('start');await flush();assert.equal(h.starts,1)
  const first=h.track('driveway'),driveway=h.effect('driveway'),garage=h.effect('garage-left');assert.equal(driveway.object3D.parent,first);h.click('sound');await flush();h.click('overdrive');h.pointer('pointerdown');h.lighting({exposure:1.2});assert(driveway.state.sound && driveway.state.boost)
  const second=h.track('garage-left');assert.equal(garage.object3D.parent,second);assert.equal(driveway.object3D.parent,null);assert(!driveway.state.tracked && !driveway.state.sound && !driveway.state.boost);assert.equal(driveway.state.light,'studio');assert(h.scene.querySelector('a-light').object3D.visible);h.pointer('pointerup');assert.equal(driveway.state.interactions,0,'Gesture cannot cross wall boundaries')
  const updates=driveway.state.updates;h.tick();assert.equal(driveway.state.updates,updates,'Inactive model is not updated');assert(h.document.querySelector('[data-control=sound]').hidden)
  h.track('driveway');assert.equal(driveway.object3D.parent,first);assert.equal(driveway.state.light,'camera');assert(!h.scene.querySelector('a-light').object3D.visible);assert.equal(h.starts,1,'Handoffs never restart the camera');assert.equal(h.downloads,1)
  h.pointer('pointerdown');h.options.onReducedMotionChange(true);h.pointer('pointerup');assert.equal(driveway.state.interactions,0,'Reduced motion cancels the pending gesture');h.options.onReducedMotionChange(false)
  h.options.onHelpChange(true);h.options.onOverdrive();assert.equal(h.options.onMachineAction('valve'),false);assert.equal(h.options.onSoundChange(true),false);h.pointer('pointerdown');h.pointer('pointerup');assert.equal(driveway.state.interactions,0);assert.equal(h.tick().overdrive,false);h.options.onHelpChange(false)
  h.pointer('pointerdown');h.hidden(true);h.pointer('pointerup');await flush();assert.equal(driveway.state.interactions,0);assert(!driveway.state.tracked && !driveway.state.sound);assert.equal(h.mode(),'paused');const pausedUpdates=driveway.state.updates;for(let i=0;i<10;i++)h.tick();assert.equal(driveway.state.updates,pausedUpdates,'Paused/hidden effects stay idle after one-time cleanup');h.hidden(false);h.click('retry');await flush();h.track('driveway');h.tick();assert(driveway.state.updates>pausedUpdates,'Recognized wall resumes live updates');h.lost();const lostUpdates=driveway.state.updates;for(let i=0;i<10;i++)h.tick();assert.equal(driveway.state.updates,lostUpdates,'Lost wall does no per-frame reset work');h.click('stop');await flush();assert.equal(h.mode(),'landing');assert.equal(h.downloads,1);assert.equal(driveway.state.disposals,0)
  h.options.onPreviewWall('garage-left');await flush();assert.equal(h.mode(),'preview');const texture=h.textures.at(-1);h.options.onPreviewWall('driveway');await flush();assert.equal(h.mode(),'preview');assert.equal(h.tick().activeWall,'driveway');assert.equal(texture.disposed(),1);assert.equal(garage.object3D.parent,null);assert.equal(h.downloads,1)
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pagehide',{persisted:true}));h.window.dispatchEvent(new h.window.PageTransitionEvent('pageshow',{persisted:true}));await flush();assert.equal(h.mode(),'landing');assert.equal(driveway.state.disposals,1);assert.equal(garage.state.disposals,1);assert.equal(h.downloads,2,'bfcache explicitly releases and reloads resources');h.options.onPreviewWall('garage-left');await flush();assert.equal(h.mode(),'preview');assert.equal(h.document.querySelectorAll('canvas.a-canvas').length,1)
 }finally{await h.close();for(const model of h.models)assert.equal(model.disposed,1);for(const effect of h.effects)assert.equal(effect.state.disposals,1);assert.equal(h.trackerDisposals,1)}
 const correspondence=harness();try{
  await flush();correspondence.click('start');await flush();correspondence.track('driveway')
  const effect=correspondence.effect('driveway'),fit={source:'tracked-wall-reference',wallId:experiences[0].manifest.wallId,targetName:experiences[0].manifest.compiledTargetName,gain:1,color:[1,1,1],wallColorMultiplier:[1.1,.9,1],confidence:.9}
  correspondence.lighting({...fit,targetName:experiences[1].manifest.compiledTargetName});assert.equal(effect.state.samples.length,0,'Another wall cannot tint the active artwork')
  correspondence.lighting(fit);assert.equal(effect.state.samples.length,1);correspondence.click('sound');await flush();correspondence.click('overdrive');correspondence.lost(true)
  assert.equal(correspondence.mode(),'lost');assert.equal(effect.state.suspensions,1);assert(effect.state.suspended && !effect.object3D.visible && !effect.state.sound && !effect.state.boost,'Transient loss hides and silences without committing reset')
  correspondence.lighting(fit);assert.equal(effect.state.samples.length,1,'Lost frames cannot update wall colour')
  correspondence.track('driveway');assert(effect.state.tracked && !effect.state.suspended);assert.equal(effect.state.samples.length,1,'Same-wall resume cannot replay or restamp a cached qualified fit')
  correspondence.track('garage-left');correspondence.track('driveway');assert.equal(effect.state.samples.length,1,'Wall handoff cannot replay a qualified sample')
  correspondence.lighting({source:'camera-rgb',gain:1,color:[1,1,1]});const count=effect.state.samples.length;correspondence.lighting({wallColorMatchReset:true});correspondence.track('garage-left');correspondence.track('driveway');assert.equal(effect.state.samples.length,count,'Reset sentinel clears cached room light without tinting or replay')
  correspondence.lost(true);correspondence.lost(false);assert(!effect.state.tracked && !effect.state.suspended,'Committed loss ends preservation');correspondence.click('stop');await flush();assert.equal(correspondence.mode(),'landing')
 }finally{await correspondence.close()}
 const quality=harness();try{
  await flush();quality.options.onPreviewWall('driveway');await flush();quality.tick();quality.hidden(true);quality.hidden(false);assert.equal(quality.tick(20001).fallback,0,'A hidden interval with no frames cannot masquerade as slow visible rendering');for(let i=0;i<3;i++)quality.tick(10001);assert.equal(quality.tick().fallback,3)
  const garage=quality.effect('garage-left'),glow=new THREE.Group();glow.name='amberGlowFixture';garage.object3D.add(glow)
  quality.options.onPreviewWall('garage-left');await flush();assert.equal(quality.tick().fallback,3);assert.equal(garage.state.steam,false);assert.equal(glow.visible,false,'Existing quality fallback follows the next cached wall');const activeUpdates=garage.state.updates;quality.tick();assert(garage.state.updates>activeUpdates,'Visible preview still updates under fallback')
 }finally{await quality.close()}
 const pending=harness({pendingModel:true});try{
  pending.options.onPreviewWall('driveway');await flush();assert.equal(pending.mode(),'loading');pending.options.onPreviewWall('garage-left');await flush();assert.equal(pending.mode(),'preview','New Garage preview bypasses canceled pending Driveway preparation');assert.equal(pending.tick().activeWall,'garage-left');pending.lateModel();await flush();assert.equal(pending.tick().activeWall,'garage-left');assert.equal(pending.downloads,1);pending.click('exitPreview');await flush();pending.click('start');await flush();assert.equal(pending.starts,1);assert.equal(pending.downloads,1)
 }finally{pending.lateModel();await pending.close()}
 const restored=harness({pendingModel:true});try{
  restored.options.onPreviewWall('driveway');await flush();restored.window.dispatchEvent(new restored.window.PageTransitionEvent('pagehide',{persisted:true}));restored.window.dispatchEvent(new restored.window.PageTransitionEvent('pageshow',{persisted:true}));await flush();assert.equal(restored.downloads,2);restored.lateModel();await flush();assert.equal(restored.mode(),'landing');assert.equal(restored.models[0].disposed,1,'Late pre-bfcache decode is disposed rather than replacing restored assets');assert.equal(restored.models[1].disposed,0);restored.options.onPreviewWall('driveway');await flush();assert.equal(restored.mode(),'preview');assert.equal(restored.effects.filter(effect=>effect.state.kind==='driveway').length,1)
 }finally{restored.lateModel();await restored.close();for(const model of restored.models)assert.equal(model.disposed,1)}
 const texturePending=harness({pendingTexture:true});try{
  texturePending.options.onPreviewWall('garage-left');await flush();texturePending.click('cancel');await flush();texturePending.options.onPreviewWall('driveway');await flush();assert.equal(texturePending.mode(),'preview');texturePending.lateTexture();await flush();assert.equal(texturePending.tick().activeWall,'driveway');assert.equal(texturePending.textures[0].disposed(),1,'Canceled late texture is disposed exactly once')
 }finally{await texturePending.close()}
 const retry=harness({failModels:2});try{
  await flush();retry.options.onPreviewWall('garage-left');await flush();retry.options.onPreviewWall('driveway');await flush();assert.equal(retry.mode(),'error');assert.equal(retry.tick().activeWall,'garage-left');retry.click('retry');await flush();assert.equal(retry.mode(),'preview');assert.equal(retry.tick().activeWall,'driveway','Retry remembers requested preview rather than previously active wall');assert.equal(retry.downloads,3);assert.equal(retry.starts,0)
 }finally{await retry.close()}
 console.log('PASS two-wall coordinator: real coordinator/UI; one startup download and camera across handoffs; idle/lost/hidden update gating; active updates resume; cross-wall quality fallback and hidden-time FPS isolation; inactive model/audio/boost/light cleanup; guarded gestures/help/reduced motion; pending-model/texture cancellation; original-wall Retry; preview reuse; bfcache and one-time disposal. XR, model and effects boundaries controlled; no phone/rendering claim.')
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1});module.exports={main,harness}
