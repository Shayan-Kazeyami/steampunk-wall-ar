import {createTrackingAdapter} from './tracking/index.js'
import {createEffects} from './effects/index.js'
import {createUI} from './ui/index.js'
import {runEffectsContractChecks} from './effects/evidence/contract-check.js'
import {getExperience,experiences as configuredExperiences} from './catalog/index.js'
import {loadPreviewTexture} from './shared/load-preview.js'
import {loadWallModel,disposeWallModel,warmWallModel} from './shared/load-wall.js'
import {createFullWallEffects} from './full-wall/index.js'
import spec from './shared/spec.json'
import {createFieldSession} from './shared/field-session.js'
import {createTrackingEventRecorder} from './shared/tracking-events.js'
import {createWorldSnow} from './shared/world-snow.js'
import {createRenderBenchmark} from './shared/render-benchmark.js'

const A=window.AFRAME
let tick=()=>{},booted=false
A.registerComponent('steampunk-coordinator',{tick(time,delta){tick(time,delta)}})
function boot(){
  const scene=document.querySelector('a-scene')
  if(!scene.hasLoaded){scene.addEventListener('loaded',boot,{once:true});return}
  if(booted)return
  booted=true
  const THREE=A.THREE,cameraEl=document.querySelector('#main-camera')
  // Experiments are injected into the private harness, never selected by a public query.
  const privateTrialPath=/(?:^|\/)Models\/(?:driveway-target-trials\/runtime|coverage-wave-2026-10-25\/tracking\/runtime)\//.test(location.pathname)
  const trial=privateTrialPath && window.__steampunkTrialConfig?.schemaVersion===1?window.__steampunkTrialConfig:null
  const experiences=configuredExperiences.map(entry=>{
    const candidate=trial?.target
    if(!candidate || entry.id!=='driveway')return entry
    const manifest=candidate.manifest,compiledTarget=candidate.compiledTarget
    if(manifest?.wallId!==entry.manifest.wallId || manifest?.panelImagePx?.join(',')!==entry.manifest.panelImagePx.join(',') || compiledTarget?.name!==manifest.compiledTargetName)throw new Error('Invalid private trial target')
    return {...entry,manifest,compiledTarget,targetHash:candidate.targetHash,luminanceHash:candidate.luminanceHash}
  })
  const coverageTargets=Array.isArray(trial?.coverageTargets)?trial.coverageTargets:[]
  for(const target of coverageTargets){
    const primary=experiences[0].manifest
    if(target?.manifest?.wallId!==primary.wallId || target?.manifest?.panelImagePx?.join(',')!==primary.panelImagePx.join(',') ||
      target?.compiledTarget?.name!==target?.manifest?.compiledTargetName)throw new Error('Invalid same-wall coverage target')
  }
  const trackingEntries=[...experiences,...coverageTargets]
  let experience=experiences.find(entry=>entry.id===getExperience(location.search).id) || experiences[0],activeId=experience.id
  const singleExperience=experiences.length===1
  const worldTracking=trial?.worldTracking===true
  const worldSnow=worldTracking?createWorldSnow({THREE,scene:scene.object3D}):null
  const snowCamera=worldTracking?new THREE.Vector3():null
  document.title=singleExperience?'JZ Light Show · Driveway':'JZ Light Show · The Steampunk Collection'
  const records=new Map(experiences.map(entry=>[entry.id,{entry,effects:null,preparation:null,controller:null,generation:0,assetsState:'idle',gpuWarmed:false}]))
  let mode='landing',until=0,epoch=0,disposed=false,suspended=false,preview=null,plane=null,texture=null,queue=Promise.resolve(),retryAction='ar',retryWall=activeId,lastLighting=null,operation=null,helpOpen=false,loadingConsumer=null
  const motionQuery=matchMedia('(prefers-reduced-motion: reduce)')
  let reduced=motionQuery.matches,frames=0,windowStart=null,fallback=0,diagnostics={},nextDiagnostics=0,fieldActive=false
  const assetInstancingEnabled=!(new URLSearchParams(location.search).get('renderBenchmark')==='1' && new URLSearchParams(location.search).get('assetInstancing')==='off')
  const renderBenchmark=new URLSearchParams(location.search).get('renderBenchmark')==='1' && typeof createRenderBenchmark==='function'
    ?createRenderBenchmark({renderer:scene.renderer,isActive:()=>!document.hidden && ['preview','tracked'].includes(mode),
      state:()=>({mode,activeWall:activeId,fallback,overdrive:until>0})}):null
  if(renderBenchmark){
    Object.defineProperty(window,'__steampunkRenderBenchmark',{value:renderBenchmark,configurable:true})
    renderBenchmark.start('opt-in-preview-and-tracking-session')
  }
  const current=()=>records.get(activeId),effects=()=>current()?.effects
  const buildIdentity=trial?.bundleHash || document.querySelector('script[src*="bundle"]')?.getAttribute('src') || 'LOCAL_UNVERSIONED'
  const fieldSession=createFieldSession({wall:experiences.length>1?'collection':experience.id,build:buildIdentity,
    now:()=>performance.now(),navigator:window.navigator,performance:window.performance})
  fieldSession.setActive(false)
  const trialRecorders=new Map(trackingEntries.map(entry=>[entry.manifest.compiledTargetName,createTrackingEventRecorder({now:()=>performance.now()})]))
  function observe(type,detail={}){
    if(detail.target){trialRecorders.get(detail.target)?.record(type,detail);return}
    for(const recorder of trialRecorders.values())recorder.record(type,detail)
  }
  function beginTrials(){
    const medium=new URLSearchParams(location.search).get('medium')
    for(const entry of trackingEntries){
      const target=entry.manifest.compiledTargetName
      trialRecorders.get(target).begin({build:buildIdentity,
        bundleHash:trial?.bundleHash || 'UNKNOWN',targetHash:entry.targetHash || trial?.targetHash || 'UNKNOWN',modelHash:trial?.modelHash || 'UNKNOWN',target,
        engineMode:worldTracking?'image-plus-world':'image-only',trackingMode:trial?.variant || 'production-image-only',
        lossPolicy:'immediate-hide;150ms-phase-recovery',device:'NOT RECORDED',browser:window.navigator?.userAgent || 'NOT RECORDED',
        scanMedium:['screen','print'].includes(medium)?medium:'UNKNOWN'})
    }
    observe('scan-requested')
  }
  function fieldSnapshot(){
    fieldSession.sampleMemory()
    return {...fieldSession.snapshot(),renderBenchmark:renderBenchmark?.snapshot() || {status:'NOT_ENABLED',enable:'renderBenchmark=1'},trackingTrials:{schemaVersion:1,
      configuration:trial?{variant:trial.variant,worldTracking,coverageTargetCount:coverageTargets.length+1,coverageManifestHash:trial.coverageManifestHash || null,
        referenceHashes:trackingEntries.map(entry=>({target:entry.manifest.compiledTargetName,compiled:entry.targetHash || trial.targetHash || 'UNKNOWN',luminance:entry.luminanceHash || 'UNKNOWN'})),
        lightingPolicy:trial.disableColorMatch?'studio':'unchanged-camera-match',rendererSha256:trial.rendererHash || 'UNKNOWN'}:{worldTracking:false,lightingPolicy:'unchanged-camera-match'},
      scope:'Raw supplied recognition/lifecycle events; rendered continuity is separate; no physical acceptance inferred',
      targets:Object.fromEntries([...trialRecorders].map(([name,recorder])=>[name,recorder.snapshot()]))}}
  }
  const fieldExport=Object.freeze({snapshot:fieldSnapshot,exportJSON:()=>JSON.stringify(fieldSnapshot(),null,2)})
  Object.defineProperty(window,'__steampunkFieldSession',{value:fieldExport,configurable:true})
  Object.defineProperty(window,'__steampunkDiagnostics',{get:()=>Object.freeze({...diagnostics}),configurable:true})
  let trackingDebug=null,measureButton=null
  if(new URLSearchParams(location.search).has('debug')){
    trackingDebug=document.createElement('pre');trackingDebug.id='tracking-diagnostics'
    trackingDebug.style.cssText='position:fixed;right:8px;top:130px;z-index:25;padding:8px;background:#000b;color:#fff;white-space:pre-wrap;pointer-events:none;font:11px monospace;max-width:92vw;max-height:30vh;overflow:hidden'
    document.body.appendChild(trackingDebug)
  }
  if(new URLSearchParams(location.search).has('measure')){
    measureButton=document.createElement('button');measureButton.textContent='Download measurements'
    measureButton.style.cssText='position:fixed;right:12px;top:80px;z-index:30;padding:10px'
    measureButton.addEventListener('click',()=>{
      const url=window.URL.createObjectURL(new window.Blob([fieldExport.exportJSON()],{type:'application/json'}))
      const link=document.createElement('a');link.href=url;link.download='steampunk-collection-measurements.json'
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>window.URL.revokeObjectURL(url),0)
    });document.body.appendChild(measureButton)
  }
  function pauseField(){fieldActive=false;fieldSession.setActive(false);frames=0;windowStart=null}
  function boost(value){effects()?.setOverdrive(value);ui.setOverdrive(value);if(!value)until=0}
  function cancelEffects(){boost(false);effects()?.setTracked(false);ui.setSoundEnabled?.(false)}
  function park(){
    cancelEffects()
    effects()?.object3D.removeFromParent();effects()?.setLightingMode?.('studio')
  }
  function activate(id){
    const entry=records.get(id)?.entry
    if(!entry)return
    if(id!==activeId){park();activeId=id;experience=entry;frames=0;windowStart=null}
    ui.setActiveWall?.(id);ui.setMachineAvailable?.(!!entry.fullWall)
    ui.setSoundAvailable?.(!!entry.fullWall && !!effects())
    scene.querySelectorAll('a-light').forEach(light=>{if(light.object3D)light.object3D.visible=!entry.fullWall})
    if(fallback>=2)effects()?.setSteamEnabled?.(false)
    if(fallback>=3)effects()?.object3D.traverse(object=>{if(/glow/i.test(object.name))object.visible=false})
  }
  function state(next,extra={}){
    if(!['searching','tracked','lost'].includes(next))worldSnow?.setActive(false)
    if(mode==='tracked' && next!=='tracked')observe('render-hidden',{reason:next})
    if(mode!=='tracked' && next==='tracked')observe('render-visible')
    if(!['preview','tracked'].includes(next))pauseField()
    mode=next
    const helpers={landing:'',loading:'You can cancel while the artwork is getting ready.',searching:coverageTargets.length?'Frame the left, centre or right machinery. Hold steady while the artwork is recognized.':singleExperience?'Frame the central JZ Light Show sign and nearby machinery.':'Driveway: frame the central JZ Light Show sign and nearby machinery. Garage Left: frame the clock and surrounding gears.',
      tracked:singleExperience?'Tap a valve, gear or gauge to explore.':experience.fullWall?'Tap a valve, gear or gauge. Move to the other artwork to change walls.':'Explore the moving details. Aim at the other artwork whenever you like.',
      lost:coverageTargets.length?'Bring a clear part of the artwork back into view. Hold steady.':singleExperience?'Bring the sign and nearby machinery back into view. Hold steady.':'Bring the sign or clock back into view. Move a little closer if needed, then hold steady.',paused:'Tap Retry when you are ready to continue.',
      preview:experience.fullWall?'Tap a valve, gear or gauge to explore.':'An animated view of Garage Left. Start scanning to place it on the artwork.',
      error:'Check camera permissions or try an artwork preview.'}
    ui.setState({state:next,targetLabel:experience.label,helperText:helpers[next] || '',...extra})
  }
  const tracker=createTrackingAdapter({sceneEl:scene,manifest:experiences[0].manifest,compiledTarget:experiences[0].compiledTarget,
    transientLossMs:150,worldTracking,coverageTargets,
    onObservation:event=>{
      if(disposed)return
      observe(event.type,event.detail)
    },
    additionalTargets:experiences.slice(1).map(entry=>({manifest:entry.manifest,compiledTarget:entry.compiledTarget})),
    onLighting:sample=>{
      if(trial?.disableColorMatch===true)return
      if(sample?.wallColorMatchReset===true){lastLighting=null;return}
      if(sample?.source==='tracked-wall-reference'){
        if(mode==='tracked' && !document.hidden && sample.wallId===experience.manifest.wallId && sample.targetName===tracker.getDiagnostics?.().activeTarget)effects()?.setCameraLighting?.(sample)
        return
      }
      lastLighting=sample
      if(mode==='tracked' && !document.hidden)effects()?.setCameraLighting?.(sample)
    },
    onState(event){
      if(disposed || suspended || ['landing','preview','transition','error'].includes(mode))return
      if(event.state==='tracked' && event.root){
        const entry=experiences.find(item=>item.manifest.compiledTargetName===event.manifest?.compiledTargetName || item.manifest.wallId===event.manifest?.wallId) || experience
        if(entry.id!==activeId || effects()?.object3D.parent!==event.root){
          park();activate(entry.id);event.root.add(effects().object3D)
          effects()?.setLightingMode?.(trial?.disableColorMatch===true?'studio':'camera');if(lastLighting)effects()?.setCameraLighting?.(lastLighting)
          fieldSession.mark('wall-'+entry.id)
        }
        effects()?.setTracked(true)
      }else{
        lastLighting=null
        if(event.state==='lost' && event.transient===true){
          boost(false)
          if(!effects()?.suspendTracking?.())cancelEffects()
          ui.setSoundEnabled?.(false)
        }else cancelEffects()
      }
      state(event.state)
    },
    onError(error){
      if(disposed || suspended || ['landing','preview','transition'].includes(mode))return
      if(mode==='tracked')observe('render-hidden',{reason:'tracking-error'})
      observe('tracking-stopped',{reason:error.code || 'tracking-error'})
      loadingConsumer=null;cancelEffects();state('error',{code:error.code,message:spec.ui.errorMessages[error.code]?undefined:error.message,canRetry:error.retryable})
    },
  })
  function removePreview(){
    if(preview){effects()?.object3D.removeFromParent();preview.removeFromParent();preview=null}
    if(plane){plane.geometry.dispose();plane.material.dispose();plane=null}
    texture?.dispose();texture=null;scene.object3D.background=null
  }
  function releaseAll(){
    worldSnow?.reset()
    for(const record of records.values()){
      ++record.generation;record.controller?.abort();record.controller=null;record.preparation=null
      record.effects?.object3D.removeFromParent();record.effects?.dispose();record.effects=null
      record.assetsState='idle';record.gpuWarmed=false;record.progress=null
    }
    ui.setSoundAvailable?.(false);ui.setSoundEnabled?.(false)
  }
  function preparationProgress(entry,generation,update){
    const record=records.get(entry.id)
    if(disposed || suspended || generation!==record.generation)return
    record.progress={...update}
    if(mode==='loading' && loadingConsumer?.token===epoch && loadingConsumer.id===entry.id)ui.setLoadingProgress?.(record.progress)
  }
  async function prepare(entry){
    const record=records.get(entry.id)
    if(record.effects && record.assetsState==='ready')return
    if(record.preparation)return record.preparation
    if(!entry.fullWall){
      record.effects=createEffects({THREE,config:entry.effectsConfig});record.effects.setReducedMotion(reduced)
      record.effects.setTracked(false);record.assetsState='ready';return
    }
    const generation=record.generation,controller=new AbortController()
    record.controller=controller;record.assetsState='loading';fieldSession.mark('preparation-start')
    const work=(async()=>{
      const model=await loadWallModel({THREE,sceneEl:scene,url:entry.fullWall.modelUrl,signal:controller.signal,
        onProgress:update=>preparationProgress(entry,generation,update)})
      if(disposed || suspended || controller.signal.aborted || generation!==record.generation){disposeWallModel(model);return}
      fieldSession.mark('model-decoded')
      const anisotropy=Math.min(8,scene.renderer?.capabilities?.getMaxAnisotropy() || 1)
      model.traverse(object=>{if(object.isMesh)for(const material of(Array.isArray(object.material)?object.material:[object.material]))
        if(material)for(const value of Object.values(material))if(value?.isTexture){value.anisotropy=anisotropy;value.needsUpdate=true}})
      try{record.effects=createFullWallEffects({THREE,model,sceneEl:scene,environmentUrl:entry.fullWall.environmentUrl,assetInstancing:assetInstancingEnabled,
        onSoundState:value=>{if(activeId===entry.id)ui.setSoundEnabled?.(value.enabled)}})}
      catch(error){disposeWallModel(model);throw error}
      record.effects.setReducedMotion(reduced)
      preparationProgress(entry,generation,{phase:'environment',status:'loading'})
      const environment=await record.effects.ready;fieldSession.mark('environment-settled')
      if(disposed || suspended || generation!==record.generation)return
      preparationProgress(entry,generation,{phase:'environment',status:environment?.status==='ready'?'complete':environment?.status==='disabled'?'skipped':'fallback'})
      preparationProgress(entry,generation,{phase:'warmup',status:'loading'})
      if(!document.hidden && typeof warmWallModel==='function')record.gpuWarmed=warmWallModel({THREE,sceneEl:scene,object3D:record.effects.object3D})
      preparationProgress(entry,generation,{phase:'warmup',status:record.gpuWarmed?'complete':'skipped'})
      if(record.gpuWarmed)fieldSession.mark('gpu-warmed')
      record.assetsState='ready';fieldSession.mark('assets-ready')
      if(activeId===entry.id)ui.setSoundAvailable?.(true)
    })().catch(error=>{
      if(generation===record.generation){record.assetsState='error';record.effects?.dispose();record.effects=null}
      throw error
    }).finally(()=>{if(generation===record.generation){record.preparation=null;record.controller=null}})
    record.preparation=work;return work
  }
  function preload(){for(const entry of experiences)prepare(entry).catch(()=>{/* Start/preview presents an actionable retry. */})}
  function invalidate(){++epoch;worldSnow?.setActive(false);loadingConsumer=null;operation?.abort();operation=null;cancelEffects()}
  // Cancel only this consumer; the shared preparation remains cached for later scans.
  function awaitOperation(work,signal){
    return new Promise((resolve,reject)=>{
      const abort=()=>{const error=new Error('Experience request canceled');error.name='AbortError';reject(error)}
      if(signal.aborted){abort();return}
      signal.addEventListener('abort',abort,{once:true})
      Promise.resolve(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
    })
  }
  function request(action,id=activeId){
    if(disposed)return Promise.resolve()
    if(action==='preview' && !records.has(id))return Promise.resolve()
    if(action!=='landing'){retryAction=action;retryWall=id}
    if(mode==='tracked')observe('render-hidden',{reason:'request-'+action})
    // Preparation can be cancelled before the adapter owns any camera session.
    observe('tracking-stopped',{reason:'request-'+action})
    invalidate();const token=epoch,controller=new AbortController();operation=controller;pauseField();mode='transition'
    const stopped=tracker.stop()
    if(action==='landing'){park();removePreview();state('landing');queue=Promise.resolve(stopped);return queue}
    state('loading',{message:action==='preview'?'Opening '+records.get(id).entry.label+'…':undefined})
    queue=queue.then(async()=>{
      await stopped
      if(disposed || suspended || token!==epoch)return
      if(action==='ar')beginTrials()
      loadingConsumer={token,id:action==='ar'?(experiences.find(entry=>entry.fullWall && records.get(entry.id).assetsState!=='ready')?.id || activeId):id}
      const pending=records.get(loadingConsumer.id)
      if(pending?.assetsState==='loading' && pending?.progress)ui.setLoadingProgress?.(pending.progress)
      park();removePreview()
      if(action==='ar')await awaitOperation(Promise.all(experiences.map(prepare)),controller.signal)
      else await awaitOperation(prepare(records.get(id).entry),controller.signal)
      if(disposed || suspended || token!==epoch)return
      if(action==='preview'){
        activate(id);effects()?.setLightingMode?.('studio')
        preview=new THREE.Group()
        if(!experience.fullWall){
          const loaded=await loadPreviewTexture({THREE,url:experience.previewImage,signal:controller.signal})
          if(disposed || suspended || token!==epoch){loaded.dispose();return}
          texture=loaded;if(THREE.SRGBColorSpace)texture.colorSpace=THREE.SRGBColorSpace;else texture.encoding=THREE.sRGBEncoding
          plane=new THREE.Mesh(new THREE.PlaneGeometry(1,experience.panel.imagePx[1]/experience.panel.imagePx[0]),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}))
          plane.position.z=-.001;preview.add(plane)
        }
        preview.add(effects().object3D);scene.object3D.add(preview);scene.object3D.background=new THREE.Color('#10120f')
        cameraEl.object3D.position.set(0,0,2);cameraEl.object3D.rotation.set(0,0,0)
        state('preview');scene.play?.();scene.resize?.();fit();effects().setTracked(true);return
      }
      loadingConsumer=null;state('loading');ui.setLoadingProgress?.({phase:'camera',status:'loading'});await tracker.start()
    }).catch(error=>{
      if(disposed || suspended || token!==epoch || error.name==='AbortError')return
      loadingConsumer=null;observe('tracking-stopped',{reason:'asset-load-failed'})
      park();removePreview();state('error',{code:'ASSET_LOAD_FAILED',canRetry:true});console.error(error)
    })
    return queue
  }
  const ui=createUI({mount:document.querySelector('#ui'),collection:experiences.every(entry=>entry.previewImage) && (experiences.length>1 || experience.id==='driveway')?experiences:undefined,
    onStart:()=>request('ar'),onRetry:()=>request(retryAction,retryWall),onPreview:()=>request('preview'),
    onPreviewWall:id=>request('preview',id),onClosePreview:()=>request('landing'),onCancel:()=>request('landing'),onStop:()=>request('landing'),
    onReset:()=>{boost(false);effects()?.reset?.();ui.setSoundEnabled?.(false)},
    onOverdrive:()=>{if(!canInteract())return;until=performance.now()+3000;boost(true)},
    onReducedMotionChange:value=>{reduced=value;worldSnow?.setReducedMotion(value);if(value)boost(false);for(const record of records.values())record.effects?.setReducedMotion(value);ui.setReducedMotion(value)},
    onSoundChange:value=>{if(value && !canInteract(false))return false;return effects()?.setSoundEnabled?.(value) || false},
    onMachineAction:action=>{
      if(!canInteract())return false
      const accepted=effects()?.interact?.(action) || false
      if(accepted && action==='restart'){boost(false);ui.setSoundEnabled?.(false)}
      if(accepted)window.requestAnimationFrame(fit);return accepted
    },
    onHelpChange:open=>{helpOpen=open;pointerCancel();if(open){worldSnow?.setActive(false);boost(false);effects()?.setSoundEnabled?.(false);ui.setSoundEnabled?.(false)}},
  })
  ui.setReducedMotion(reduced);activate(activeId);state('landing')
  const canvas=scene.renderer?.domElement || scene.querySelector('canvas.a-canvas')
  let pointerStart=null
  function canInteract(respectMotion=true){return !disposed && !suspended && !document.hidden && !helpOpen && (!respectMotion || !reduced) && ['tracked','preview'].includes(mode)}
  function pointerDown(event){
    pointerStart=null
    if(!experience.fullWall || event.isPrimary===false || event.button>0 || !canInteract())return
    pointerStart={id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now(),wall:activeId}
  }
  function pointerCancel(){pointerStart=null}
  function pointerUp(event){
    const start=pointerStart;pointerStart=null
    if(!start || !canInteract() || start.wall!==activeId || start.id!==event.pointerId || performance.now()-start.time>650 || Math.hypot(start.x-event.clientX,start.y-event.clientY)>12)return
    const result=effects()?.interactAt?.(event.clientX,event.clientY,canvas)
    if(!result)return
    if(result.action==='gear'){until=performance.now()+3000;ui.setOverdrive(true)}
    ui.announceMachine?.(result.action);window.requestAnimationFrame(fit)
  }
  canvas?.addEventListener('pointerdown',pointerDown);canvas?.addEventListener('pointerup',pointerUp);canvas?.addEventListener('pointercancel',pointerCancel)
  function fit(){
    if(mode!=='preview' || !scene.camera)return
    const dockHeight=document.querySelector('.steampunk-ui__dock')?.getBoundingClientRect().height || 160
    const hudHeight=document.querySelector('.steampunk-ui__top')?.getBoundingClientRect().height || 100
    const camera=scene.camera,usableHeight=Math.max(.25,1-(dockHeight+hudHeight+48)/innerHeight)
    const ratio=experience.panel.imagePx[1]/experience.panel.imagePx[0]
    const distance=Math.max(ratio/usableHeight,1/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.12
    cameraEl.object3D.position.set(0,0,distance)
  }
  function applySystemMotion(event){
    reduced=event.matches;worldSnow?.setReducedMotion(reduced);if(reduced)boost(false)
    for(const record of records.values())record.effects?.setReducedMotion(reduced)
    ui.setReducedMotion(reduced)
  }
  function visibility(){
    pointerCancel()
    if(!document.hidden){if(mode==='preview')effects()?.setTracked(true);return}
    worldSnow?.setActive(false)
    observe('tracking-paused',{reason:'document-hidden'});observe('render-hidden',{reason:'document-hidden'})
    pauseField();cancelEffects()
    if(!['landing','preview'].includes(mode)){invalidate();mode='transition';tracker.stop().then(()=>{if(!disposed && !suspended && mode==='transition')state('paused',{canRetry:true})})}
  }
  window.addEventListener('resize',fit);document.addEventListener('visibilitychange',visibility)
  motionQuery.addEventListener?.('change',applySystemMotion)
  scene.renderer?.setPixelRatio(Math.min(devicePixelRatio,1.5))
  tick=(time,delta)=>{
    if(disposed || suspended)return
    tracker.update?.(time,delta)
    const now=performance.now(),active=['preview','tracked'].includes(mode) && !document.hidden
    const tracking=tracker.getDiagnostics?.() || null
    if(worldSnow){
      worldSnow.setActive(!helpOpen && !document.hidden && fallback<2 && ['searching','tracked','lost'].includes(mode))
      worldSnow.setReducedMotion(reduced)
      scene.camera?.getWorldPosition(snowCamera)
      worldSnow.update(now,delta/1000,snowCamera,!!scene.camera && tracking?.worldTrackingValid===true && tracking?.worldTrackingStatus==='NORMAL')
    }
    const measuredActive=active || worldSnow?.getDiagnostics().visible===true
    if(measuredActive!==fieldActive){fieldActive=measuredActive;fieldSession.setActive(measuredActive)}
    if(fieldActive)fieldSession.frame(now)
    if(until && now>=until)boost(false)
    if(active)effects()?.update({deltaMs:delta,nowMs:now})
    if(active && delta>0){
      if(windowStart===null)windowStart=now
      frames++
      if(now-windowStart>=10000){
        if(frames*1000/(now-windowStart)<25){
          if(fallback===0)scene.renderer.setPixelRatio(1)
          if(fallback===1)effects()?.setSteamEnabled?.(false)
          if(fallback===2)effects()?.object3D.traverse(object=>{if(/glow/i.test(object.name))object.visible=false})
          fallback=Math.min(4,fallback+1)
          observe('quality-fallback',{quality:fallback})
        }windowStart=now;frames=0
      }
    }else{windowStart=null;frames=0}
    const wallAssets=Object.fromEntries([...records].map(([id,record])=>[id,{status:record.assetsState,gpuWarmed:record.gpuWarmed}]))
    diagnostics={mode,wall:'collection',activeWall:activeId,wallId:experience.panel.wallId,wallAssets,
      assetsState:[...records.values()].every(record=>record.assetsState==='ready')?'ready':[...records.values()].some(record=>record.assetsState==='error')?'error':'loading',
      gpuWarmed:current()?.gpuWarmed || false,fullWall:!!experience.fullWall,overdrive:until>0,reducedMotion:reduced,
      canvasCount:document.querySelectorAll('canvas.a-canvas').length,fallback,performanceFailed:fallback===4,trial:trial?{variant:trial.variant,worldTracking}:null,
      fullWallDiagnostics:experience.fullWall?effects()?.getDiagnostics?.() || null:null,tracking,worldSnow:worldSnow?.getDiagnostics() || null,
      effectResources:effects()?.object3D.userData.performance || null}
    if(now>=nextDiagnostics){
      fieldSession.sampleMemory();diagnostics.fieldSession=fieldSession.snapshot();scene.dataset.diagnostics=JSON.stringify(diagnostics);nextDiagnostics=now+1000
      if(trackingDebug)trackingDebug.textContent=JSON.stringify({activeWall:activeId,assets:wallAssets,tracking:diagnostics.tracking},null,2)
    }
  }
  async function teardown(){
    if(disposed)return
    if(mode==='tracked')observe('render-hidden',{reason:'teardown'})
    observe('tracking-stopped',{reason:'teardown'});disposed=true;fieldSession.stop();renderBenchmark?.dispose();invalidate();tick=()=>{};measureButton?.remove();trackingDebug?.remove()
    canvas?.removeEventListener('pointerdown',pointerDown);canvas?.removeEventListener('pointerup',pointerUp);canvas?.removeEventListener('pointercancel',pointerCancel)
    document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',fit)
    window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',pageshow);motionQuery.removeEventListener?.('change',applySystemMotion)
    await tracker.stop();park();removePreview();releaseAll();worldSnow?.dispose();ui.dispose();await tracker.dispose()
  }
  function pagehide(event){if(!event.persisted){teardown();return}observe('tracking-paused',{reason:'page-cache'});suspended=true;pauseField();invalidate();mode='transition';tracker.stop();park();removePreview();releaseAll()}
  function pageshow(event){if(!event.persisted || disposed)return;suspended=false;invalidate();mode='transition';tracker.stop().then(()=>{if(!disposed && mode==='transition'){activate(activeId);state('landing');preload()}})}
  window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',pageshow)
  preload()
  if(new URLSearchParams(location.search).has('qa')){
    const pre=document.createElement('pre');pre.id='qa-results';pre.style.cssText='position:fixed;inset:0;z-index:100;background:white;color:black;overflow:auto;pointer-events:none'
    try{pre.textContent=JSON.stringify(runEffectsContractChecks({THREE,spec}),null,2)}catch(error){pre.textContent=error.stack}document.body.appendChild(pre)
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot()
