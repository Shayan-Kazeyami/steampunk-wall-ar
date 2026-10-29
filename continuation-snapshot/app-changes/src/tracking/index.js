import targetManifestModule from '../../config/target-manifest.json'
import compiledTargetModule from '../../image-targets/steampunk-garage-wide.json'
import {createCameraLightingModule} from './camera-lighting.js'
import {createWallCoverageArbiter} from './wall-coverage.js'

const defaultTargetManifest = targetManifestModule && targetManifestModule.default
  ? targetManifestModule.default
  : targetManifestModule

const defaultCompiledTarget = compiledTargetModule && compiledTargetModule.default
  ? compiledTargetModule.default
  : compiledTargetModule

export const TRACKING_STATES = Object.freeze({
  LOADING: 'loading',
  SEARCHING: 'searching',
  TRACKED: 'tracked',
  LOST: 'lost',
  PAUSED: 'paused',
})

export const TRACKING_ERROR_CODES = Object.freeze({
  CAMERA_DENIED: 'CAMERA_DENIED',
  CAMERA_UNAVAILABLE: 'CAMERA_UNAVAILABLE',
  INSECURE_ORIGIN: 'INSECURE_ORIGIN',
  ASSET_LOAD_FAILED: 'ASSET_LOAD_FAILED',
  ENGINE_FAILED: 'ENGINE_FAILED',
})

const TARGET_COMPONENT = 'xrextras-named-image-target'
const SCENE_LOAD_TIMEOUT_MS = 15000
const ENGINE_LOAD_TIMEOUT_MS = 15000
const XREXTRAS_LOAD_TIMEOUT_MS = 10000
const ENTITY_LOAD_TIMEOUT_MS = 10000
const POLL_INTERVAL_MS = 50
const TARGET_LOAD_TIMEOUT_MS = 30000

const ERROR_MESSAGES = Object.freeze({
  CAMERA_DENIED: 'Camera access was denied. Allow it in browser site settings, then retry.',
  CAMERA_UNAVAILABLE: 'Camera unavailable. Close other camera apps, then retry.',
  INSECURE_ORIGIN: 'Camera requires an HTTPS page.',
  ASSET_LOAD_FAILED: 'The image target data could not be loaded.',
  ENGINE_FAILED: 'The AR engine could not start.',
})

function safeCallback(callback, payload) {
  if (typeof callback !== 'function') return
  try {
    callback(payload)
  } catch (error) {}
}

function messageFrom(error, fallback) {
  if (error && typeof error.message === 'string' && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

function waitForCondition(predicate, timeoutMs, label, signal) {
  return new Promise((resolve, reject) => {
    let settled = false
    let interval = null
    let timer = null

    const finish = (error) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      if (interval !== null) clearInterval(interval)
      if (signal) signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }

    const onAbort = () => {
      const error = new Error(`${label} canceled`)
      error.name = 'AbortError'
      finish(error)
    }

    const check = () => {
      if (settled) return
      let value = false
      try {
        value = predicate()
      } catch (error) {
        finish(error)
        return
      }
      if (value) finish()
    }

    if (signal && signal.aborted) { onAbort(); return }
    if (signal) signal.addEventListener('abort', onAbort, {once: true})
    timer = setTimeout(() => finish(new Error(`${label} timed out`)), timeoutMs)
    check()
    if (!settled) interval = setInterval(check, POLL_INTERVAL_MS)
  })
}

function isInsecureOrigin() {
  if (typeof window === 'undefined') return false
  if (typeof window.isSecureContext === 'boolean') return !window.isSecureContext
  const location = window.location
  if (!location) return false
  if (location.protocol === 'file:') return true
  if (location.protocol !== 'http:') return false
  return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname)
}

function readGeometry(detail) {
  if (!detail) return null
  const geometry = detail.geometry && typeof detail.geometry === 'object'
    ? detail.geometry
    : detail
  const width = Number(geometry.scaledWidth)
  const height = Number(geometry.scaledHeight)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return {width, height}
}

function getCropGeometry(targetManifest) {
  if (!targetManifest) return null
  const crop = targetManifest.sourceCropPx
  const panel = targetManifest.panelImagePx
  if (!Array.isArray(crop) || crop.length !== 4) return null
  if (!Array.isArray(panel) || panel.length !== 2) return null
  const values = [crop[0], crop[1], crop[2], crop[3], panel[0], panel[1]].map(Number)
  if (!values.every(Number.isFinite)) return null
  const [cx, cy, cw, ch, panelWidth, panelHeight] = values
  if (cw <= 0 || ch <= 0 || panelWidth <= 0 || panelHeight <= 0 || cx < 0 || cy < 0 ||
    cx + cw > panelWidth || cy + ch > panelHeight) return null
  return {cx, cy, cw, ch, panelWidth, panelHeight}
}

function manifestProblem(targetManifest, compiledTarget) {
  if (!targetManifest || typeof targetManifest !== 'object') return 'Target manifest is missing.'
  if (targetManifest.schemaVersion !== 1 || targetManifest.contractVersion !== '1.0.0') {
    return 'Target manifest contract version does not match 1.0.0.'
  }
  if (typeof targetManifest.candidateId !== 'string' || !targetManifest.candidateId.trim() ||
    typeof targetManifest.compiledTargetName !== 'string' || !targetManifest.compiledTargetName.trim()) {
    return 'Target identity is missing.'
  }
  if (!compiledTarget || typeof compiledTarget !== 'object') return 'Compiled target data is missing.'
  if (targetManifest.compiledTargetName !== compiledTarget.name) {
    return 'Compiled target name does not match the manifest.'
  }
  if (!targetManifest.trackingImagePath || targetManifest.trackingImagePath !== compiledTarget.imagePath) {
    return 'Tracking image path does not match the compiled target.'
  }
  if (!getCropGeometry(targetManifest)) return 'Target manifest crop or panel dimensions are invalid.'
  return null
}

function readCalibration(targetManifest) {
  const calibration = targetManifest && targetManifest.targetPoseCalibration
  if (!calibration || calibration.verified !== true) {
    return {
      rotationRadians: 0,
      mirrorX: false,
      offsetPanelX: 0,
      offsetPanelY: 0,
    }
  }
  const rotation = Number(calibration.rotationDeg)
  const offset = Array.isArray(calibration.offsetPanel) ? calibration.offsetPanel : []
  const offsetX = Number(offset[0])
  const offsetY = Number(offset[1])
  return {
    rotationRadians: Number.isFinite(rotation) ? rotation * Math.PI / 180 : 0,
    mirrorX: calibration.mirrorX === true,
    offsetPanelX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetPanelY: Number.isFinite(offsetY) ? offsetY : 0,
  }
}

function classifyRuntimeError(message) {
  const text = String(message || '')
  if (/permission|denied|notallowed/i.test(text)) return TRACKING_ERROR_CODES.CAMERA_DENIED
  if (/camera|device|notfound/i.test(text)) return TRACKING_ERROR_CODES.CAMERA_UNAVAILABLE
  if (/asset|target|404|failed to fetch|network/i.test(text)) return TRACKING_ERROR_CODES.ASSET_LOAD_FAILED
  return TRACKING_ERROR_CODES.ENGINE_FAILED
}

export function createTrackingAdapter({
  sceneEl,
  onState,
  onError,
  onLighting,
  onObservation,
  worldTracking = false,
  manifest: targetManifest = defaultTargetManifest,
  compiledTarget = defaultCompiledTarget,
  additionalTargets = [],
  coverageTargets = [],
  coverageStaleAfterMs = 1000,
  transientLossMs = 0,
} = {}) {
  const documentRef = typeof document !== 'undefined' ? document : null
  // Fixed for this adapter's lifetime. A different mode needs a fresh session;
  // never change XR8's world mode while its controller is running.
  const worldTrackingEnabled = worldTracking === true

  let epoch = 0
  let starting = false
  let disposed = false
  let active = false
  let ready = false
  let targetEl = null
  let root = null
  let primaryRawRoot=null,primaryRenderAnchor=null
  const primaryPose={valid:false,lastTime:null,resets:0,updates:0}
  const lossDelay=Math.max(0,Math.min(150,Number(transientLossMs)||0))
  let pendingLoss=null,lossTimer=null,lossEpoch=0,matchingGeneration=0
  let geometryApplied = false
  let targetFound = false
  let currentState = null
  let lastReportedErrorCode = null
  let sceneListenersAttached = false
  let queue = Promise.resolve()
  let debugGroup = null
  let startupController = null
  let pendingGeometry = null
  let lightingInstalled = false
  let pixelModuleInstalled = false
  let lightingModule = null
  let worldObservationInstalled=false,worldObservationGeneration=0
  let worldTrackingStatus='UNKNOWN',worldTrackingValid=null
  let searchObserved=false,observationPaused=false
  const eventCounts={imageLoading:0,imageScanning:0,imageFound:0,imageUpdated:0,imageLost:0,namedFound:0,namedLost:0,namedGeometry:0,cameraStatus:0,runtimeError:0}
  let lastEvent=null,lastRawImageEvent=null,lastCameraStatus=null,lastGeometry=null,scanningTargets=[]
  let scanningDeclarationObserved=false
  let targetLoadingObserved=false,cameraHasVideo=false,targetLoadTimer=null,targetLoadWatchEpoch=0
  // One engine/camera session, with a canonical attachment root for each wall.
  // A late loss event from the previous wall must never hide the new wall.
  const coverageEntries=Array.isArray(coverageTargets)?coverageTargets:[null]
  const extraTargets=[...(Array.isArray(additionalTargets)?additionalTargets:[null]).map(item=>({...item,coverage:false})),
    ...coverageEntries.map(item=>({...item,coverage:true}))].map(item=>({manifest:item?.manifest,compiledTarget:item?.compiledTarget,coverage:item.coverage,
    element:null,root:null,rawRoot:null,renderAnchor:null,pose:{valid:false,lastTime:null,resets:0,updates:0},found:false,geometryApplied:false,pendingGeometry:null,handlers:null}))
  const coverageEnabled=coverageEntries.length>0
  const coverageNames=[targetManifest?.compiledTargetName,...extraTargets.filter(item=>item.coverage).map(item=>item.manifest?.compiledTargetName)]
  // Invalid entries are reported through the ordinary startup error path below.
  const coverageArbiter=coverageEnabled && coverageNames.every(name=>typeof name==='string' && name) && new Set(coverageNames).size===coverageNames.length
    ? createWallCoverageArbiter({names:coverageNames,staleAfterMs:coverageStaleAfterMs}) : null
  const coverageNow=()=>window.performance?.now?.() ?? Date.now()
  const isCoverage=item=>coverageEnabled && (item?.manifest===targetManifest || item?.coverage===true)
  const contentRoot=item=>isCoverage(item)?root:item?.root
  let primaryGeometry=null
  let focusedTargetName=null
  let lastFocusedTargetName=null
  const primary=()=>({manifest:targetManifest,compiledTarget,element:targetEl,root,rawRoot:primaryRawRoot,renderAnchor:primaryRenderAnchor,pose:primaryPose,found:targetFound,geometryApplied})
  const allTargets=()=>[primary(),...extraTargets]
  const findTarget=name=>allTargets().find(item=>item.manifest?.compiledTargetName===name)
  function hideTargets(clearFound=false){
    if(root)root.visible=false
    if(primaryRenderAnchor)primaryRenderAnchor.visible=false
    for(const item of extraTargets){if(item.root)item.root.visible=false;if(item.renderAnchor)item.renderAnchor.visible=false;if(clearFound){item.found=false;item.pose.valid=false}}
    if(clearFound){targetFound=false;primaryPose.valid=false;focusedTargetName=null;lastFocusedTargetName=null;coverageArbiter?.reset()}
  }
  function resetMatching(){matchingGeneration++;lightingModule?.reset?.()}
  function clearTransientLoss(){
    lossEpoch++
    if(lossTimer!==null)clearTimeout(lossTimer)
    lossTimer=null;pendingLoss=null
  }
  function selectTarget(item,coverageFrom=null){
    if(!active || disposed || lastReportedErrorCode || !item?.found || !item.geometryApplied || !item.root)return
    const name=item.manifest.compiledTargetName
    if(isCoverage(item)){
      coverageArbiter?.observe(name,{now:coverageNow(),usable:item.geometryApplied})
      const selected=coverageArbiter?.choose(coverageNow())
      if(selected && selected!==name)return
    }
    if(focusedTargetName===name && contentRoot(item)?.visible && currentState===TRACKING_STATES.TRACKED)return
    const previous=coverageFrom || findTarget(focusedTargetName)
    const coverageHandoff=isCoverage(item) && (isCoverage(previous) || isCoverage(pendingLoss)) &&
      (previous?.manifest.compiledTargetName || pendingLoss?.manifest.compiledTargetName)!==name
    const resumed=(!!pendingLoss && pendingLoss.manifest.compiledTargetName===name) || coverageHandoff
    const previousCoverageName=previous?.manifest.compiledTargetName || pendingLoss?.manifest.compiledTargetName
    clearTransientLoss();resetMatching()
    hideTargets();focusedTargetName=name;lastFocusedTargetName=name
    const visibleRoot=contentRoot(item)
    if(isCoverage(item)){
      item.renderAnchor.add(visibleRoot)
      transformPanel(visibleRoot,item.manifest,item.manifest===targetManifest?primaryGeometry:item.geometry)
      visibleRoot.userData.activeCoverageTarget=name
    }
    item.pose.valid=false;visibleRoot.visible=true;if(item.renderAnchor)item.renderAnchor.visible=true
    update()
    if(coverageHandoff)emitObservation('coverage-handoff',{target:name,previousTarget:previousCoverageName,reason:'native-reference-loss-or-staleness'})
    emitState(TRACKING_STATES.TRACKED,{...item,root:visibleRoot},{resumed,coverageHandoff})
  }
  function lostTarget(item){
    if(!active || disposed || lastReportedErrorCode)return
    if(item.root && (!isCoverage(item) || focusedTargetName===item.manifest.compiledTargetName))item.root.visible=false
    if(isCoverage(item) && focusedTargetName===item.manifest.compiledTargetName && root)root.visible=false
    if(item.renderAnchor)item.renderAnchor.visible=false
    if(item.element?.object3D)item.element.object3D.visible=false
    item.pose.valid=false
    if(isCoverage(item))coverageArbiter?.lose(item.manifest.compiledTargetName)
    if(focusedTargetName!==item.manifest.compiledTargetName)return
    focusedTargetName=null;resetMatching();clearTransientLoss()
    const nextCoverage=coverageArbiter?.choose(coverageNow())
    const available=(nextCoverage && findTarget(nextCoverage)) || allTargets().find(candidate=>candidate.found && candidate.geometryApplied && !isCoverage(candidate))
    if(available){selectTarget(available,item);return}
    emitState(TRACKING_STATES.LOST,item,{transient:lossDelay>0})
    if(lossDelay){
      pendingLoss=item
      const token=lossEpoch
      lossTimer=setTimeout(()=>{
        lossTimer=null
        if(token!==lossEpoch || disposed || !active || focusedTargetName || !pendingLoss)return
        const lost=pendingLoss;pendingLoss=null
        emitState(TRACKING_STATES.LOST,lost,{transient:false})
      },lossDelay)
    }
  }
  function createAnchors(element,panelRoot,manifest){
    const T=window.AFRAME.THREE,rawRoot=new T.Group(),renderAnchor=new T.Group()
    rawRoot.name='raw-panel-reference-'+manifest.candidateId
    renderAnchor.name='stabilized-render-anchor-'+manifest.candidateId;renderAnchor.visible=false
    element.object3D.add(rawRoot);sceneEl.object3D.add(renderAnchor);renderAnchor.add(panelRoot)
    return {rawRoot,renderAnchor}
  }
  function update(timestamp,delta){
    const item=findTarget(focusedTargetName)
    if(active && isCoverage(item) && coverageArbiter && !coverageArbiter.fresh(focusedTargetName,coverageNow())){
      setFound(item,false);lostTarget(item);return
    }
    if(!active || disposed || !item?.found || !contentRoot(item)?.visible || !item.renderAnchor || !item.element?.object3D)return
    const T=window.AFRAME.THREE,p=item.pose,raw=item.element.object3D
    raw.updateWorldMatrix?.(true,false);raw.updateMatrixWorld(true)
    if(!p.position){p.position=new T.Vector3();p.rotation=new T.Quaternion();p.scale=new T.Vector3();p.rawPosition=new T.Vector3();p.rawRotation=new T.Quaternion();p.rawScale=new T.Vector3()}
    raw.matrixWorld.decompose(p.rawPosition,p.rawRotation,p.rawScale)
    const time=Number.isFinite(timestamp)?timestamp:(window.performance?.now?.() ?? Date.now())
    const unit=Math.max(.0001,Math.abs(p.rawScale.x)),distance=p.position.distanceTo(p.rawPosition)/unit
    const angle=p.rotation.angleTo(p.rawRotation),scaleChange=Math.abs(Math.log(Math.max(.0001,Math.abs(p.scale.x))/unit))
    const discontinuity=p.valid && (distance>.25 || angle>.45 || scaleChange>.18)
    const elapsed=p.lastTime===null?16:time-p.lastTime
    // AFrame scene time and performance.now have different origins at initial
    // acquisition; supplied frame delta prevents a frozen filter at that switch.
    const dt=Number.isFinite(delta) && delta>0?Math.min(50,delta):elapsed<0?16:Math.max(0,Math.min(50,elapsed))
    if(!p.valid || discontinuity){
      p.position.copy(p.rawPosition);p.rotation.copy(p.rawRotation);p.scale.copy(p.rawScale);p.resets++
    }else if(dt>0){
      const motion=Math.max(distance/.025,angle/.06,scaleChange/.04)
      const alpha=Math.min(1,(1-Math.exp(-dt/65))+.7*Math.min(1,motion))
      p.position.lerp(p.rawPosition,alpha);p.rotation.slerp(p.rawRotation,alpha);p.scale.lerp(p.rawScale,alpha)
      // Bound lag while following real movement: at most1.5% of target width,
      //1.5degrees rotation and2% scale. Discontinuities bypass filtering.
      const residual=p.position.distanceTo(p.rawPosition)/unit
      if(residual>.015)p.position.lerp(p.rawPosition,1-.015/residual)
      const rotationResidual=p.rotation.angleTo(p.rawRotation)
      if(rotationResidual>Math.PI/120)p.rotation.slerp(p.rawRotation,1-(Math.PI/120)/rotationResidual)
      const scaleResidual=Math.abs(Math.log(Math.max(.0001,Math.abs(p.scale.x))/unit))
      if(scaleResidual>.02)p.scale.lerp(p.rawScale,1-.02/scaleResidual)
    }
    p.valid=true;p.lastTime=time;p.updates++
    const world=new T.Matrix4().compose(p.position,p.rotation,p.scale)
    if(item.renderAnchor.parent){item.renderAnchor.parent.updateMatrixWorld(true);world.premultiply(item.renderAnchor.parent.matrixWorld.clone().invert())}
    world.decompose(item.renderAnchor.position,item.renderAnchor.quaternion,item.renderAnchor.scale)
    item.renderAnchor.updateMatrixWorld(true)
  }
  const bounded=value=>typeof value==='string'?value.slice(0,120):null
  function emitObservation(type,detail={}){
    safeCallback(onObservation,{type,detail:{...detail}})
  }
  function observeRawTarget(kind,event,expectedName){
    // Internal geometry-driven calls have no DOM event. They are render recovery,
    // not another recognizer acquisition. Preserve every actual duplicate callback.
    if(!event || disposed || (!active && !starting) || lastReportedErrorCode)return
    const name=event.detail?.name || expectedName
    if(!name || (expectedName && name!==expectedName) || !findTarget(name))return
    const type=kind==='imageFound' || kind==='namedFound'?'target-found'
      :kind==='imageLost' || kind==='namedLost'?'target-lost':null
    if(type)emitObservation(type,{target:name,reason:kind})
  }
  function observe(kind,event,expectedName){
    observeRawTarget(kind,event,expectedName)
    eventCounts[kind]=Math.min(1000000000,eventCounts[kind]+1)
    const detail=event?.detail
    lastEvent={kind,name:bounded(detail?.name),keys:detail && typeof detail==='object'?Object.keys(detail).slice(0,16).map(key=>key.slice(0,60)):[]}
    if(['imageFound','imageUpdated','imageLost'].includes(kind))lastRawImageEvent={...lastEvent,keys:[...lastEvent.keys]}
    if(kind==='imageFound' || kind==='namedGeometry'){
      const geometry=detail?.geometry && typeof detail.geometry==='object'?detail.geometry:detail
      const number=value=>typeof value==='number' && Number.isFinite(value)?value:null
      lastGeometry={scaledWidth:number(geometry?.scaledWidth),scaledHeight:number(geometry?.scaledHeight),
        width:number(geometry?.width),height:number(geometry?.height),valid:!!readGeometry(detail)}
    }
  }
  function getDiagnostics(){
    const selected=findTarget(focusedTargetName || lastFocusedTargetName) || primary()
    const declared=name=>scanningTargets.some(target=>target.name===name)
    return {state:currentState,active,starting,ready,disposed,
      worldTracking:worldTrackingEnabled,worldTrackingStatus,worldTrackingValid,
      activeTarget:focusedTargetName,lastActiveTarget:lastFocusedTargetName,targetCount:1+extraTargets.length,
      lossPending:!!pendingLoss,stabilization:{enabled:true,lagMaxTargetWidth:.015,lagMaxRotationDegrees:1.5},
      primaryTarget:bounded(targetManifest?.compiledTargetName),
      targets:allTargets().map(item=>({name:item.manifest?.compiledTargetName,targetId:item.manifest?.candidateId,
        found:item.found,geometryApplied:item.geometryApplied,visible:focusedTargetName===item.manifest?.compiledTargetName && !!contentRoot(item)?.visible,
        waitingForGeometry:item.found && !item.geometryApplied,poseUpdates:item.pose.updates,poseResets:item.pose.resets,declared:declared(item.manifest?.compiledTargetName)})),
      expectedTarget:bounded(selected.manifest?.compiledTargetName),trackingImagePath:bounded(selected.manifest?.trackingImagePath),
      targetFound:selected.found,geometryApplied:selected.geometryApplied,
      pendingGeometry:!!(selected.manifest===targetManifest?pendingGeometry:selected.pendingGeometry),
      rootPresent:!!contentRoot(selected),rootVisible:!!contentRoot(selected)?.visible,
      waitingForGeometry:selected.found && !selected.geometryApplied,lastErrorCode:lastReportedErrorCode,
      lightingInstalled,pixelModuleInstalled,eventCounts:{...eventCounts},
      colorMatch:lightingModule?.getDiagnostics?.() || {status:'not-measured',reason:'lighting-module-inactive'},
      coverage:coverageArbiter?{enabled:true,...coverageArbiter.diagnostics(coverageNow()),canonicalRootId:targetManifest?.candidateId}: {enabled:false},
      lastEvent:lastEvent?{...lastEvent,keys:[...lastEvent.keys]}:null,
      lastRawImageEvent:lastRawImageEvent?{...lastRawImageEvent,keys:[...lastRawImageEvent.keys]}:null,
      expectedTargetDeclared:declared(selected.manifest?.compiledTargetName),
      allTargetsDeclared:allTargets().every(item=>declared(item.manifest?.compiledTargetName)),
      targetLoadPending:targetLoadTimer!==null,cameraHasVideo,
      scanningTargets:scanningTargets.map(target=>({...target})),
      targetImageLoad:scanningDeclarationObserved?'ENGINE_SCANNING_DECLARATION_OBSERVED':'NOT_OBSERVED',
      lastCameraStatus:lastCameraStatus?{...lastCameraStatus}:null,lastGeometry:lastGeometry?{...lastGeometry}:null}
  }

  function cancelTargetLoadWatch(){
    targetLoadWatchEpoch++
    if(targetLoadTimer!==null)clearTimeout(targetLoadTimer)
    targetLoadTimer=null
  }
  function targetsDeclared(){
    return allTargets().every(item=>scanningTargets.some(target=>target.name===item.manifest?.compiledTargetName))
  }
  function observeSearchReady(){
    if(searchObserved || disposed || (!active && !starting) || lastReportedErrorCode ||
      !cameraHasVideo || !scanningDeclarationObserved || !targetsDeclared())return
    searchObserved=true
    emitObservation('search-started',{reason:'camera-video-and-engine-scanning-declaration'})
  }
  function watchTargetLoading(){
    // Permission prompts can remain open indefinitely. Count only actual target
    // loading after the camera has video, and never extend a stalled load on
    // repeated loading events.
    if(disposed || (!active && !starting) || !cameraHasVideo || !targetLoadingObserved ||
      targetsDeclared() || targetLoadTimer!==null)return
    const watchEpoch=targetLoadWatchEpoch
    targetLoadTimer=setTimeout(()=>{
      if(watchEpoch!==targetLoadWatchEpoch)return
      targetLoadTimer=null
      if(disposed || (!active && !starting) || targetsDeclared())return
      reportError(TRACKING_ERROR_CODES.ASSET_LOAD_FAILED,
        'Artwork recognition could not finish loading. Check your connection, then retry.',true)
    },TARGET_LOAD_TIMEOUT_MS)
  }

  function removeLighting() {
    const engine=typeof window!=='undefined' && window.XR8
    try{if(lightingInstalled)engine?.removeCameraPipelineModule?.('steampunk-camera-lighting')}catch(error){}
    try{if(pixelModuleInstalled)engine?.removeCameraPipelineModule?.('camerapixelarray')}catch(error){}
    lightingInstalled=false;pixelModuleInstalled=false;lightingModule=null
  }
  function removeWorldObservation(){
    worldObservationGeneration++
    const engine=typeof window!=='undefined' && window.XR8
    try{if(worldObservationInstalled)engine?.removeCameraPipelineModule?.('steampunk-world-observation')}catch(error){}
    worldObservationInstalled=false
    worldTrackingStatus='UNKNOWN';worldTrackingValid=null
  }
  function installWorldObservation(engine){
    if(!worldTrackingEnabled || worldObservationInstalled || !engine.addCameraPipelineModule)return
    const generation=++worldObservationGeneration
    engine.addCameraPipelineModule({name:'steampunk-world-observation',onUpdate({processCpuResult}={}){
      if(generation!==worldObservationGeneration || disposed || !active || lastReportedErrorCode)return
      const reality=processCpuResult?.reality
      // The pinned binary returns these strings from XrTrackingState. A pose by
      // itself (also present in image-only mode) cannot establish world validity.
      const status=reality?.trackingStatus
      if(!['NORMAL','LIMITED','NOT_AVAILABLE','UNSPECIFIED'].includes(status)){
        worldTrackingStatus='UNKNOWN';worldTrackingValid=null;return
      }
      const position=reality.position,rotation=reality.rotation
      const poseFinite=position && rotation &&
        ['x','y','z'].every(key=>Number.isFinite(position[key])) &&
        ['x','y','z','w'].every(key=>Number.isFinite(rotation[key])) &&
        rotation.x**2+rotation.y**2+rotation.z**2+rotation.w**2>0
      const valid=status==='NORMAL' && !!poseFinite
      const changed=worldTrackingValid!==valid
      worldTrackingStatus=status;worldTrackingValid=valid
      if(changed)emitObservation(valid?'world-tracking-valid':'world-tracking-invalid',{
        reason:bounded(reality.trackingReason) || (status==='NORMAL' && !poseFinite?'NORMAL-with-invalid-pose':status),
        worldTrackingValid:valid,
      })
    }})
    worldObservationInstalled=true
  }

  function cancelStartup() {
    if (startupController) startupController.abort()
    startupController = null
  }

  if (sceneEl && typeof sceneEl.removeAttribute === 'function') {
    try {
      sceneEl.removeAttribute('xrweb')
    } catch (error) {}
  }

  function emitState(state,selected,metadata={}) {
    if (disposed) return
    currentState = state
    safeCallback(onState, {
      state,
      ...metadata,
      root: state === TRACKING_STATES.TRACKED ? (selected?.root || root) : null,
      targetId: ready ? (selected?.manifest || targetManifest)?.candidateId : null,
      manifest: ready ? (selected?.manifest || targetManifest) : null,
    })
  }

  function reportError(code, message, retryable) {
    if (disposed) return
    if (lastReportedErrorCode === code) return
    lastReportedErrorCode = code
    // A failed session stays failed until an explicit start/retry. Late target
    // events and a still-pending startup must not turn the error into tracking.
    epoch++
    cancelTargetLoadWatch()
    clearTransientLoss();resetMatching()
    cancelStartup()
    active = false
    starting = false
    targetFound = false
    if (root) root.visible = false
    hideTargets(true)
    enqueue(doStop)
    safeCallback(onError, {
      code,
      message: message || ERROR_MESSAGES[code] || ERROR_MESSAGES.ENGINE_FAILED,
      retryable: retryable === true,
    })
  }

  function transformPanel(panelRoot,manifest,geometry){
    const crop = getCropGeometry(manifest)
    if (!crop) return
    const {cx, cy, cw, ch, panelWidth, panelHeight} = crop
    const width = geometry.width
    const scale = width * panelWidth / cw
    const baseX = width * (panelWidth / 2 - cx - cw / 2) / cw
    const baseY = width * (cy + ch / 2 - panelHeight / 2) / cw
    const calibration = readCalibration(manifest)
    const signedBaseX = calibration.mirrorX ? -baseX : baseX
    const cos = Math.cos(calibration.rotationRadians)
    const sin = Math.sin(calibration.rotationRadians)
    const rotatedX = signedBaseX * cos - baseY * sin
    const rotatedY = signedBaseX * sin + baseY * cos
    const x = rotatedX + calibration.offsetPanelX * scale
    const y = rotatedY + calibration.offsetPanelY * scale

    panelRoot.scale.set(calibration.mirrorX ? -scale : scale, scale, scale)
    panelRoot.position.set(x, y, 0)
    panelRoot.rotation.set(0, 0, calibration.rotationRadians)
    panelRoot.userData.cropToPanelApplied = true
    panelRoot.userData.scaledCropWidth = width
    panelRoot.userData.scaledCropHeight = geometry.height
    panelRoot.userData.panelScale = scale
    return crop
  }
  function applyExtraGeometry(item,geometry,allowSelection=true){
    if(item.geometryApplied || !geometry)return
    if(!item.root){item.pendingGeometry=geometry;return}
    if(!transformPanel(item.root,item.manifest,geometry))return
    if(item.rawRoot)transformPanel(item.rawRoot,item.manifest,geometry)
    item.geometryApplied=true;item.pendingGeometry=null;item.geometry=geometry
    if(allowSelection && item.found)selectTarget(item)
  }
  function applyGeometry(geometry,allowSelection=true) {
    if (geometryApplied || !geometry) return
    if (!root) { pendingGeometry = geometry; return }
    const crop=coverageEnabled && focusedTargetName && focusedTargetName!==targetManifest.compiledTargetName
      ? getCropGeometry(targetManifest) : transformPanel(root,targetManifest,geometry)
    if(primaryRawRoot)transformPanel(primaryRawRoot,targetManifest,geometry)
    if(!crop)return
    const {panelWidth,panelHeight}=crop
    geometryApplied = true
    primaryGeometry=geometry
    pendingGeometry = null
    if (!debugGroup && new URLSearchParams(window.location.search).has('debug')) {
      const T = window.AFRAME.THREE
      debugGroup = new T.Group()
      const h = panelHeight / panelWidth
      const points = [[-.5,h/2],[.5,h/2],[.5,-h/2],[-.5,-h/2],[-.5,h/2]]
      const geometry = new T.BufferGeometry().setFromPoints(points.map(([x,y]) => new T.Vector3(x,y,.01)))
      debugGroup.add(new T.Line(geometry,new T.LineBasicMaterial({color:0x00ffff})))
      points.slice(0,4).forEach(([x,y],i) => {
        const canvas = documentRef.createElement('canvas'); canvas.width=128;canvas.height=64
        const ctx=canvas.getContext('2d');ctx.fillStyle='#00ffff';ctx.font='bold 40px sans-serif';ctx.fillText(['TL','TR','BR','BL'][i],8,46)
        const sprite=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(canvas),depthTest:false}))
        sprite.position.set(x,y,.02);sprite.scale.set(.1,.05,1);debugGroup.add(sprite)
      })
      root.add(debugGroup)
    }
    if (allowSelection && active && targetFound) onTargetFound()
  }

  function onSceneImageFound(event) {
    observe('imageFound',event)
    if (disposed || (!active && !starting) || !targetManifest) return
    const detail = event && event.detail
    if (!detail)return
    if(detail.name!==targetManifest.compiledTargetName){
      const item=extraTargets.find(item=>item.manifest?.compiledTargetName===detail.name)
      if(item)applyExtraGeometry(item,readGeometry(detail))
      return
    }
    const geometry = readGeometry(detail)
    if (geometry) applyGeometry(geometry)
  }

  function onTargetGeometry(event) {
    observe('namedGeometry',event)
    if (disposed || (!active && !starting)) return
    const detail = event && event.detail
    if (detail && detail.name && detail.name !== targetManifest.compiledTargetName) return
    const geometry = readGeometry(detail)
    if (geometry) applyGeometry(geometry)
  }

  function onTargetFound(event) {
    observe('namedFound',event,targetManifest.compiledTargetName)
    if(event?.detail?.name && event.detail.name!==targetManifest.compiledTargetName)return
    if (disposed || !active || lastReportedErrorCode) return
    targetFound = true
    if (!geometryApplied) return
    selectTarget(primary())
  }

  function onTargetLost(event) {
    observe('namedLost',event,targetManifest.compiledTargetName)
    if(event?.detail?.name && event.detail.name!==targetManifest.compiledTargetName)return
    if (disposed || !active || lastReportedErrorCode) return
    targetFound = false
    lostTarget(primary())
  }

  function onCameraStatus(event) {
    observe('cameraStatus',event)
    lastCameraStatus={status:bounded(event?.detail?.status),reason:bounded(event?.detail?.reason)}
    if (disposed || (!active && !starting)) return
    const detail = event && event.detail ? event.detail : {}
    const reason = String(detail.reason || '').toUpperCase()
    const status = String(detail.status || '').toUpperCase()
    if(status==='HASVIDEO' || status==='HAS_VIDEO'){
      if(!cameraHasVideo)emitObservation('camera-ready',{reason:status})
      cameraHasVideo=true;watchTargetLoading();observeSearchReady()
    }

    if (reason === 'DENY_CAMERA' || reason === 'DENIED' || reason === 'PERMISSION_DENIED' ||
      status === 'DENIED' || status === 'PERMISSION_DENIED') {
      reportError(TRACKING_ERROR_CODES.CAMERA_DENIED, ERROR_MESSAGES.CAMERA_DENIED, true)
      return
    }

    if (reason === 'NO_CAMERA' || reason === 'NOT_FOUND' || reason === 'CAMERA_UNAVAILABLE' ||
      status === 'FAILED' || status === 'ERROR') {
      reportError(TRACKING_ERROR_CODES.CAMERA_UNAVAILABLE, ERROR_MESSAGES.CAMERA_UNAVAILABLE, true)
    }
  }

  function onRealityError(event) {
    observe('runtimeError',event)
    if (disposed || (!active && !starting)) return
    const error = event && event.detail ? event.detail.error : null
    const raw = error && typeof error === 'object' ? (error.message || error.name) : error
    const message = raw ? String(raw) : ERROR_MESSAGES.ENGINE_FAILED
    reportError(classifyRuntimeError(message), message, true)
  }

  function ensureSceneListeners() {
    if (sceneListenersAttached || !sceneEl || typeof sceneEl.addEventListener !== 'function') return
    sceneEl.addEventListener('xrimagefound', onSceneImageFound)
    sceneEl.addEventListener('xrimagescanning', onSceneImageScanning)
    sceneEl.addEventListener('xrimageloading', onSceneImageLoading)
    sceneEl.addEventListener('xrimageupdated', onSceneImageUpdated)
    sceneEl.addEventListener('xrimagelost', onSceneImageLost)
    sceneEl.addEventListener('camerastatuschange', onCameraStatus)
    sceneEl.addEventListener('realityerror', onRealityError)
    sceneListenersAttached = true
  }
  function setFound(item,found){
    if(item.manifest===targetManifest)targetFound=found
    else item.found=found
  }
  function onSceneImageUpdated(event){
    observe('imageUpdated',event)
    if(disposed || !active || lastReportedErrorCode)return
    const item=findTarget(event?.detail?.name)
    if(!item)return
    // XRExtras updates target pose on every frame, without another named-found
    // event. Recover missed acquisition, but background updates must not steal
    // focus from the current wall or alternate experiences every frame.
    setFound(item,true)
    const geometry=readGeometry(event.detail)
    if(item.manifest===targetManifest){if(geometry)applyGeometry(geometry,false)}
    else if(geometry)applyExtraGeometry(item,geometry,false)
    if(isCoverage(item))coverageArbiter?.observe(item.manifest.compiledTargetName,{now:coverageNow(),usable:item.manifest===targetManifest?geometryApplied:item.geometryApplied})
    if(!focusedTargetName || focusedTargetName===item.manifest.compiledTargetName){
      selectTarget(findTarget(item.manifest.compiledTargetName))
    }
  }
  function onSceneImageLost(event){
    observe('imageLost',event)
    if(disposed || !active || lastReportedErrorCode)return
    const item=findTarget(event?.detail?.name)
    if(!item)return
    setFound(item,false)
    lostTarget(findTarget(item.manifest.compiledTargetName))
  }
  function onSceneImageLoading(event){
    observe('imageLoading',event)
    if(disposed || (!active && !starting))return
    targetLoadingObserved=true
    watchTargetLoading()
  }
  function onSceneImageScanning(event){
    observe('imageScanning',event)
    if(disposed || (!active && !starting))return
    scanningDeclarationObserved=true
    const targets=Array.isArray(event?.detail?.imageTargets)?event.detail.imageTargets:[]
    scanningTargets=targets.slice(0,32).map(target=>({name:bounded(target?.name),type:bounded(target?.type),validGeometry:!!readGeometry(target)}))
    if(targetsDeclared())cancelTargetLoadWatch()
    observeSearchReady()
  }

  async function ensureExtraTargets(signal){
    for(const item of extraTargets){
      if(item.element){if(item.element.parentNode!==sceneEl)sceneEl.appendChild(item.element);continue}
      const element=documentRef.createElement('a-entity')
      item.handlers={
        geometry:event=>{observe('namedGeometry',event);if(disposed || (!active && !starting))return;if(event.detail?.name && event.detail.name!==item.manifest.compiledTargetName)return;applyExtraGeometry(item,readGeometry(event.detail))},
        found:event=>{observe('namedFound',event,item.manifest.compiledTargetName);if(event?.detail?.name && event.detail.name!==item.manifest.compiledTargetName)return;if(disposed || !active || lastReportedErrorCode)return;item.found=true;selectTarget(item)},
        lost:event=>{observe('namedLost',event,item.manifest.compiledTargetName);if(event?.detail?.name && event.detail.name!==item.manifest.compiledTargetName)return;if(disposed || !active || lastReportedErrorCode)return;item.found=false;lostTarget(item)},
      }
      element.setAttribute(TARGET_COMPONENT,{name:item.manifest.compiledTargetName})
      element.addEventListener('xrextrasimagegeometry',item.handlers.geometry)
      element.addEventListener('xrextrasfound',item.handlers.found)
      element.addEventListener('xrextraslost',item.handlers.lost)
      sceneEl.appendChild(element)
      item.element=element
      try{
        await waitForCondition(()=>element.hasLoaded,ENTITY_LOAD_TIMEOUT_MS,'named target entity load',signal)
        if(signal.aborted)throw new Error('Target creation canceled')
        if(!element.components?.[TARGET_COMPONENT])throw new Error('Named target component did not initialise.')
        const group=new window.AFRAME.THREE.Group(),crop=getCropGeometry(item.manifest)
        group.name='canonical-panel-root-'+item.manifest.candidateId;group.visible=false
        group.userData.targetId=item.manifest.candidateId
        group.userData.panelImagePx=item.manifest.panelImagePx.slice();group.userData.sourceCropPx=item.manifest.sourceCropPx.slice()
        group.userData.panelWidth=1;group.userData.panelHeight=crop.panelHeight/crop.panelWidth;group.userData.cropToPanelApplied=false
        const anchors=createAnchors(element,group,item.manifest)
        item.rawRoot=anchors.rawRoot;item.renderAnchor=anchors.renderAnchor;item.root=group
        if(item.pendingGeometry)applyExtraGeometry(item,item.pendingGeometry)
      }catch(error){
        element.removeEventListener('xrextrasimagegeometry',item.handlers.geometry)
        element.removeEventListener('xrextrasfound',item.handlers.found)
        element.removeEventListener('xrextraslost',item.handlers.lost)
        element.remove();item.element=null;item.root=null;item.handlers=null;throw error
      }
    }
  }

  async function ensureTarget(signal) {
    if (targetEl) {
      if (targetEl.parentNode !== sceneEl) sceneEl.appendChild(targetEl)
      return
    }
    if (typeof window === 'undefined' || !window.AFRAME || !window.AFRAME.THREE) {
      throw new Error('A-Frame THREE instance is unavailable.')
    }
    const AFRAME = window.AFRAME
    await waitForCondition(
      () => AFRAME.components && AFRAME.components[TARGET_COMPONENT],
      XREXTRAS_LOAD_TIMEOUT_MS,
      'xrextras named image target registration',
      signal,
    )

    let element = null
    let group = null
    try {
      element = documentRef.createElement('a-entity')
      element.setAttribute(TARGET_COMPONENT, {name: targetManifest.compiledTargetName})
      element.addEventListener('xrextrasimagegeometry', onTargetGeometry)
      element.addEventListener('xrextrasfound', onTargetFound)
      element.addEventListener('xrextraslost', onTargetLost)
      sceneEl.appendChild(element)

      await waitForCondition(() => element.hasLoaded, ENTITY_LOAD_TIMEOUT_MS, 'named target entity load', signal)
      if (signal.aborted) throw new Error('Target creation canceled')
      if (!element.components || !element.components[TARGET_COMPONENT]) {
        throw new Error('xrextras named image target component did not initialise.')
      }

      group = new AFRAME.THREE.Group()
      const crop = getCropGeometry(targetManifest)
      group.name = 'canonical-full-panel-root'
      group.visible = false
      group.userData.targetId = targetManifest.candidateId
      group.userData.panelImagePx = targetManifest.panelImagePx.slice()
      group.userData.sourceCropPx = targetManifest.sourceCropPx.slice()
      group.userData.panelWidth = 1
      group.userData.panelHeight = crop.panelHeight / crop.panelWidth
      group.userData.cropToPanelApplied = false
      const anchors=createAnchors(element,group,targetManifest)
      primaryRawRoot=anchors.rawRoot;primaryRenderAnchor=anchors.renderAnchor

      targetEl = element
      root = group
      if (pendingGeometry) applyGeometry(pendingGeometry)
    } catch (error) {
      if (group && group.parent) group.parent.remove(group)
      if (element) {
        element.removeEventListener('xrextrasimagegeometry', onTargetGeometry)
        element.removeEventListener('xrextrasfound', onTargetFound)
        element.removeEventListener('xrextraslost', onTargetLost)
        if (element.parentNode) element.parentNode.removeChild(element)
      }
      pendingGeometry = null
      throw error
    }
  }

  function captureTrackingFrame({frameStartResult={},processGpuResult,processCpuResult,canvasWidth,canvasHeight}={}){
    const item=findTarget(focusedTargetName),reality=processCpuResult?.reality
    if(!active || disposed || !item?.found || !item.rawRoot || !item.geometryApplied || !reality?.intrinsics ||
      reality.intrinsics.length!==16 || !reality.position || !reality.rotation)return null
    const width=sceneEl.canvas?.width || canvasWidth,height=sceneEl.canvas?.height || canvasHeight
    const sourceWidth=frameStartResult.textureWidth,sourceHeight=frameStartResult.textureHeight
    if(!(width>0 && height>0 && sourceWidth>0 && sourceHeight>0))return null
    let viewport=processGpuResult?.gltexturerenderer?.viewport
    if(!viewport || !(viewport.width>0 && viewport.height>0)){
      // Exact engine helper and actual drawing-buffer/source texture dimensions:
      // the same path used by native AFrame, never CSS/handwritten crop math.
      viewport=window.XR8?.GlTextureRenderer?.fillTextureViewport?.(sourceWidth,sourceHeight,width,height)
    }
    if(!viewport || !['offsetX','offsetY','width','height'].every(key=>Number.isFinite(viewport[key])) || viewport.width<=0 || viewport.height<=0)return null
    const T=window.AFRAME.THREE,position=new T.Vector3(reality.position.x,reality.position.y,reality.position.z)
    const rotation=new T.Quaternion(reality.rotation.x,reality.rotation.y,reality.rotation.z,reality.rotation.w)
    const cameraWorld=new T.Matrix4().compose(position,rotation,new T.Vector3(1,1,1))
    sceneEl.object3D.updateMatrixWorld(true);cameraWorld.premultiply(sceneEl.object3D.matrixWorld)
    const projection=new T.Matrix4().fromArray(reality.intrinsics)
    const viewProjection=projection.multiply(cameraWorld.invert())
    item.rawRoot.updateWorldMatrix?.(true,false);item.rawRoot.updateMatrixWorld(true)
    const panelMatrix=item.rawRoot.matrixWorld.elements.slice(),viewProjectionMatrix=viewProjection.elements.slice()
    if(!panelMatrix.every(Number.isFinite) || !viewProjectionMatrix.every(Number.isFinite))return null
    return {candidateId:item.manifest.candidateId,wallId:item.manifest.wallId,targetName:item.manifest.compiledTargetName,
      generation:matchingGeneration,panelAspect:item.manifest.panelImagePx[1]/item.manifest.panelImagePx[0],
      panelMatrix,viewProjectionMatrix,viewport:{...viewport},canvasWidth:width,canvasHeight:height,sourceWidth,sourceHeight,poseStable:true}
  }

  function configureEngine() {
    if (typeof window === 'undefined' || !window.XR8 || !window.XR8.XrController) {
      throw new Error('XR8.XrController is unavailable.')
    }
    if (typeof window.XR8.XrController.configure !== 'function') {
      throw new Error('XR8.XrController.configure is unavailable.')
    }
    window.XR8.XrController.configure({disableWorldTracking:!worldTrackingEnabled,
      imageTargetData: [compiledTarget,...extraTargets.map(item=>item.compiledTarget)]})
    const engine=window.XR8
    installWorldObservation(engine)
    if(onLighting && !lightingInstalled && engine.addCameraPipelineModule){
      try {
        if(engine.CameraPixelArray?.pipelineModule){
          engine.addCameraPipelineModule(engine.CameraPixelArray.pipelineModule({luminance:false,maxDimension:64}))
          pixelModuleInstalled=true
        }
        lightingModule=createCameraLightingModule({getTrackingFrame:captureTrackingFrame,onLighting:sample=>{
          if(!active || disposed)return
          const selected=findTarget(focusedTargetName)
          if(sample.source==='tracked-wall-reference' && (!selected || sample.candidateId!==selected.manifest.candidateId ||
            sample.wallId!==selected.manifest.wallId || sample.targetName!==selected.manifest.compiledTargetName))return
          onLighting(sample)
        }})
        engine.addCameraPipelineModule(lightingModule);lightingInstalled=true
      } catch(error) { removeLighting() }
    }
  }

  async function stopRuntime() {
    clearTransientLoss();resetMatching()
    cancelTargetLoadWatch()
    cameraHasVideo=false
    active = false
    starting = false
    hideTargets(true)
    removeLighting()
    removeWorldObservation()
    if (!sceneEl) return
    try {
      sceneEl.removeAttribute('xrweb')
    } catch (error) {}
    if (typeof window !== 'undefined' && window.XR8 && typeof window.XR8.stop === 'function') {
      try {
        await Promise.resolve(window.XR8.stop())
      } catch (error) {}
    }
    try {
      sceneEl.removeAttribute('xrconfig')
    } catch (error) {}
  }

  async function doStart(token) {
    const canceled = () => disposed || token !== epoch
    if (canceled()) return
    if (active) {
      if (!lastReportedErrorCode) return
      await stopRuntime()
    }
    if (canceled()) return
    startupController = new AbortController()
    const signal = startupController.signal
    starting = true

    lastReportedErrorCode = null
    clearTransientLoss();resetMatching()
    cancelTargetLoadWatch()
    cameraHasVideo=false;targetLoadingObserved=false;searchObserved=false
    scanningTargets=[]
    scanningDeclarationObserved=false
    targetFound = false
    if (root) root.visible = false
    hideTargets(true)
    emitState(TRACKING_STATES.LOADING)

    if (isInsecureOrigin()) {
      reportError(TRACKING_ERROR_CODES.INSECURE_ORIGIN, ERROR_MESSAGES.INSECURE_ORIGIN, false)
      return
    }
    if (!sceneEl || typeof sceneEl.setAttribute !== 'function' || typeof window === 'undefined') {
      reportError(TRACKING_ERROR_CODES.ENGINE_FAILED, ERROR_MESSAGES.ENGINE_FAILED, true)
      return
    }

    const names=allTargets().map(item=>item.manifest?.compiledTargetName)
    const ids=allTargets().map(item=>item.manifest?.candidateId)
    const problem = allTargets().map(item=>manifestProblem(item.manifest,item.compiledTarget)).find(Boolean) ||
      (coverageEnabled && (!coverageArbiter || extraTargets.filter(item=>item.coverage).some(item=>item.manifest?.wallId!==targetManifest?.wallId ||
        item.manifest?.panelImagePx?.join(',')!==targetManifest?.panelImagePx?.join(',')))?'Coverage references must describe the same full artwork.':null) ||
      (new Set(names).size!==names.length?'Duplicate tracking target names.':null) ||
      (new Set(ids).size!==ids.length?'Duplicate tracking target identities.':null)
    if (problem) {
      reportError(TRACKING_ERROR_CODES.ASSET_LOAD_FAILED, problem, true)
      return
    }

    try {
      await waitForCondition(() => sceneEl.hasLoaded, SCENE_LOAD_TIMEOUT_MS, 'scene load', signal)
      if (canceled()) return
      await waitForCondition(
        () => window.XR8 && window.XR8.XrController && window.AFRAME && window.AFRAME.components && window.AFRAME.components.xrweb,
        ENGINE_LOAD_TIMEOUT_MS,
        'XR engine load',
        signal,
      )
      if (canceled()) return
      ensureSceneListeners()
      await ensureTarget(signal)
      await ensureExtraTargets(signal)
      if (canceled()) return
      ready = true
      configureEngine()
    } catch (error) {
      if (canceled()) return
      reportError(
        TRACKING_ERROR_CODES.ENGINE_FAILED,
        messageFrom(error, ERROR_MESSAGES.ENGINE_FAILED),
        true,
      )
      return
    }

    if (canceled()) return

    starting = false
    startupController = null
    active = true
    if(observationPaused){observationPaused=false;emitObservation('tracking-resumed',{reason:'explicit-start-after-hidden'})}
    try {
      sceneEl.setAttribute('xrweb', `disableWorldTracking: ${!worldTrackingEnabled}`)
    } catch (error) {
      if (canceled()) return
      active = false
      reportError(
        TRACKING_ERROR_CODES.ENGINE_FAILED,
        messageFrom(error, ERROR_MESSAGES.ENGINE_FAILED),
        true,
      )
      return
    }

    if (canceled() || lastReportedErrorCode) return
    if (documentRef && documentRef.visibilityState === 'hidden') {
      observationPaused=true;emitObservation('tracking-paused',{reason:'document-hidden'})
      await stopRuntime()
      emitState(TRACKING_STATES.PAUSED)
      return
    }

    if (!focusedTargetName) emitState(TRACKING_STATES.SEARCHING)
  }

  async function doStop() {
    await stopRuntime()
    targetFound = false
    if (root) root.visible = false
  }

  async function doDispose() {
    await stopRuntime()
    if (debugGroup) {
      debugGroup.traverse(o => { if(o.geometry)o.geometry.dispose();if(o.material){if(o.material.map)o.material.map.dispose();o.material.dispose()} })
      debugGroup = null
    }

    if (documentRef && typeof documentRef.removeEventListener === 'function') {
      documentRef.removeEventListener('visibilitychange', onVisibilityChange)
    }
    if (sceneEl && typeof sceneEl.removeEventListener === 'function') {
      sceneEl.removeEventListener('xrimagefound', onSceneImageFound)
      sceneEl.removeEventListener('xrimagescanning', onSceneImageScanning)
      sceneEl.removeEventListener('xrimageloading', onSceneImageLoading)
      sceneEl.removeEventListener('xrimageupdated', onSceneImageUpdated)
      sceneEl.removeEventListener('xrimagelost', onSceneImageLost)
      sceneEl.removeEventListener('camerastatuschange', onCameraStatus)
      sceneEl.removeEventListener('realityerror', onRealityError)
    }
    sceneListenersAttached = false

    if (targetEl) {
      targetEl.removeEventListener('xrextrasimagegeometry', onTargetGeometry)
      targetEl.removeEventListener('xrextrasfound', onTargetFound)
      targetEl.removeEventListener('xrextraslost', onTargetLost)
    }
    if (root && root.parent) root.parent.remove(root)
    primaryRawRoot?.removeFromParent();primaryRenderAnchor?.removeFromParent()
    primaryRawRoot=null;primaryRenderAnchor=null;primaryPose.valid=false
    if (targetEl && targetEl.parentNode) targetEl.parentNode.removeChild(targetEl)
    for(const item of extraTargets){
      if(item.element){
        item.element.removeEventListener('xrextrasimagegeometry',item.handlers.geometry)
        item.element.removeEventListener('xrextrasfound',item.handlers.found)
        item.element.removeEventListener('xrextraslost',item.handlers.lost)
        item.element.remove()
      }
      item.root?.removeFromParent();item.rawRoot?.removeFromParent();item.renderAnchor?.removeFromParent();item.rawRoot=null;item.renderAnchor=null;item.pose.valid=false;item.element=null;item.root=null;item.handlers=null;item.pendingGeometry=null;item.geometryApplied=false;item.found=false
    }

    targetEl = null
    root = null
    ready = false
    targetFound = false
    geometryApplied = false
    pendingGeometry = null
    currentState = null
    active = false
    hideTargets(true)
  }

  function onVisibilityChange() {
    if (disposed || !documentRef || documentRef.visibilityState !== 'hidden') return
    if (!active && !starting) return
    observationPaused=true;emitObservation('tracking-paused',{reason:'document-hidden'})
    epoch++
    cancelTargetLoadWatch()
    clearTransientLoss();resetMatching()
    cancelStartup()
    starting = false
    active = false
    if (root) root.visible = false
    hideTargets(true)
    enqueue(async () => {
      if (disposed) return
      await stopRuntime()
      targetFound = false
      if (root) root.visible = false
      if (!lastReportedErrorCode && currentState !== TRACKING_STATES.PAUSED) {
        emitState(TRACKING_STATES.PAUSED)
      }
    })
  }

  function enqueue(task) {
    const run = queue.then(task, task)
    queue = run.then(
      () => undefined,
      (error) => {
        reportError(
          TRACKING_ERROR_CODES.ENGINE_FAILED,
          messageFrom(error, ERROR_MESSAGES.ENGINE_FAILED),
          true,
        )
      },
    )
    return queue
  }

  function start() {
    if (disposed) return Promise.resolve()
    cancelStartup()
    const token = ++epoch
    return enqueue(() => doStart(token))
  }

  function retry() {
    if (disposed) return Promise.resolve()
    cancelStartup()
    const token = ++epoch
    return enqueue(async () => {
      await doStop()
      await doStart(token)
    })
  }

  function stop() {
    if (disposed) return Promise.resolve()
    if(active || starting || observationPaused)emitObservation('tracking-stopped',{reason:'explicit-stop'})
    observationPaused=false
    epoch++
    cancelTargetLoadWatch()
    clearTransientLoss();resetMatching()
    cancelStartup()
    starting = false
    active = false
    targetFound = false
    if (root) root.visible = false
    hideTargets(true)
    return enqueue(doStop)
  }

  function dispose() {
    if (disposed) return Promise.resolve()
    if(active || starting || observationPaused)emitObservation('tracking-stopped',{reason:'dispose'})
    observationPaused=false
    epoch++
    cancelTargetLoadWatch()
    clearTransientLoss();resetMatching()
    cancelStartup()
    disposed = true
    if (root) root.visible = false
    hideTargets(true)
    return enqueue(doDispose)
  }

  if (documentRef && typeof documentRef.addEventListener === 'function') {
    documentRef.addEventListener('visibilitychange', onVisibilityChange)
  }

  return {start, retry, stop, dispose, update, getDiagnostics}
}
