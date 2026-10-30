import {createWallAnimation} from './runtime/animation-runtime.js'
import {createMachineEffects} from './runtime/machine-effects.js'
import {createExperiencePolish} from './runtime/experience-polish.js'
import {createEnvironmentLighting} from './runtime/environment-lighting.js'
import {createBorderExtension} from './runtime/border-extension.js'
import {createAssetInstancing} from './runtime/asset-instancing.js'
import {applyConnectorAppearance} from './runtime/connector-appearance.js'

// Takes ownership of an already loaded normalized GLB. Parent tracking applies
// crop-to-panel placement once; the source mesh stays in its authored XY/+Z frame.
export function createFullWallEffects(options) {
  const {THREE,model,sceneEl,environmentUrl,onSoundState}=options
  if(!THREE || !model || !sceneEl?.object3D)throw new Error('Full wall requires THREE, loaded model and sceneEl')
  const document=options.document || globalThis.document
  const now=options.now || (()=>globalThis.performance?.now() || 0)
  const factories={createWallAnimation,createMachineEffects,createExperiencePolish,createEnvironmentLighting,...options.factories}
  const object3D=new THREE.Group()
  object3D.name='SourceDerivedFullWall'
  object3D.userData.fullWall=true
  object3D.add(model)
  object3D.visible=false
  let disposed=false,tracked=false,trackingSuspended=false,reducedMotion=false,steamEnabled=true,lastNow=0
  const renderer=sceneEl.renderer
  const rendererOriginal=renderer?{toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure}:null
  if(renderer){renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1}
  const borderExtension=typeof createBorderExtension==='function'?createBorderExtension({THREE,model}):null
  // Source-identified connectors need the brass correction on both atlas paths.
  const appearance={exposure:1,environmentIntensity:.72,...applyConnectorAppearance({THREE,model})}
  model.traverse(object=>{
    if(!object.isMesh)return
    const materials=Array.isArray(object.material)?object.material:[object.material]
    const baked=object.userData.animation_role==='backwall' || object.userData.baked_lighting===true
    for(const material of materials){
      if(!material)continue
      // KHR_materials_unlit imports as MeshBasicMaterial. Source beauty already
      // contains ACES/exposure; applying renderer tone mapping a second time fades it.
      if(baked || material.isMeshBasicMaterial)material.toneMapped=false
    }
  })
  // Same soft studio fill used by the inspected comparison viewer, attached to
  // this wall so replacing the experience removes every added light as well.
  const lightRig=new THREE.Group();lightRig.name='FullWallStudioFill'
  lightRig.add(new THREE.AmbientLight('#b9c7d2',.25))
  for(const [color,intensity,x,y,z] of [['#ffe1b6',.85,-1,2,3],['#c8d8ef',.38,2,.5,2],['#ffb85e',.6,0,2,-1]]){
    const light=new THREE.DirectionalLight(color,intensity);light.position.set(x,y,z)
    lightRig.add(light);lightRig.add(light.target)
  }
  object3D.add(lightRig)
  const authoredLights=lightRig.children.filter(light=>light.isLight).map(light=>({light,intensity:light.intensity,color:light.color.clone()}))
  const bakedColors=new Map()
  model.traverse(object=>{if(object.isMesh)for(const material of(Array.isArray(object.material)?object.material:[object.material])){
    if(material?.color && (material.isMeshBasicMaterial || object.userData.animation_role==='backwall' || object.userData.baked_lighting===true))bakedColors.set(material,material.color.clone())
  }})
  const cameraLighting={mode:'studio',source:'studio',gain:1,color:[1,1,1],targetGain:1,targetColor:[1,1,1],sampleAt:-Infinity,
    direction:[0,0,1.5],targetDirection:[0,0,1.5],directionalStrength:0,targetDirectionalStrength:0,confidence:0,directionSource:'none',adaptation:0,targetAdaptation:0,
    wallColorMultiplier:[1,1,1],targetWallColorMultiplier:[1,1,1],wallSampleAt:-Infinity,wallColorSource:'neutral'}
  const tint=new THREE.Color(),wallTint=new THREE.Color(),neutral=new THREE.Color(1,1,1),direction=new THREE.Vector3(),cameraQuaternion=new THREE.Quaternion(),wallQuaternion=new THREE.Quaternion()
  const cameraKey=authoredLights.find(entry=>entry.light.isDirectionalLight)
  const keyPosition=cameraKey?.light.position.clone()
  const animation=factories.createWallAnimation({THREE,model})
  const machine=factories.createMachineEffects({THREE,model})
  const polish=factories.createExperiencePolish({THREE,model,document,AudioContext:options.AudioContext})
  // Coarse source-part bounds make touch picking independent of the 2M-triangle
  // artwork. No invisible meshes, extra draw calls or per-frame triangle casts.
  const interactiveParts=[],pickBox=new THREE.Box3(),pickSphere=new THREE.Sphere(),pickScale=new THREE.Vector3()
  model.updateWorldMatrix(true,true)
  model.traverse(object=>{
    const role=object.userData.animation_role
    if(!['gear','valve_wheel','pressure_needle'].includes(role))return
    pickBox.setFromObject(object)
    if(pickBox.isEmpty())return
    pickBox.getBoundingSphere(pickSphere);object.getWorldScale(pickScale)
    const scale=Math.max(pickScale.x,pickScale.y,pickScale.z,1e-6)
    const gaugeRadius=role==='pressure_needle' && Number.isFinite(object.userData.gauge_radius)?object.userData.gauge_radius:0
    interactiveParts.push({object,role,center:gaugeRadius>0?new THREE.Vector3():object.worldToLocal(pickSphere.center.clone()),radius:Math.max(.004,gaugeRadius,pickSphere.radius/scale)})
  })
  for(const runtime of [machine,polish,animation])for(const target of runtime.getInteractionTargets?.() || [])interactiveParts.push(target)
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),hitPoint=new THREE.Vector3()
  const localPickRay=new THREE.Ray(),localPickHit=new THREE.Vector3(),localPickInverse=new THREE.Matrix4()
  const interaction={count:0,lastAction:null,lastPart:null}
  animation.setSteamEnabled(false)
  animation.setTracked(false)
  let environment=null
  const modelEnvironmentIntensity=new Map()
  model.traverse(object=>{if(object.isMesh)for(const material of(Array.isArray(object.material)?object.material:[object.material])){
    if(material && typeof material.envMapIntensity==='number')modelEnvironmentIntensity.set(material,material.envMapIntensity)
  }})
  // Preserve the authored objects for animation and coarse touch picking. Only
  // compatible rendering is batched; source materials still own camera lighting.
  const assetInstancing=typeof createAssetInstancing==='function'
    ?createAssetInstancing({THREE,model,renderer,enabled:options.assetInstancing!==false}):null
  const environmentReady=environmentUrl && renderer
    ? ((environment=factories.createEnvironmentLighting({THREE,scene:sceneEl.object3D,renderer,url:environmentUrl,intensity:.72})).ready)
    : Promise.resolve({status:'disabled'})
  const ready=Promise.resolve(environmentReady).then(state=>{
    // Creation can finish before the coordinator attaches the model to scene.
    // Apply authored material multipliers directly rather than assuming attachment.
    // Authored multipliers belong to this model even if HDR loading falls back
    // or finishes during context loss. GPU recovery must not apply them twice.
    if(!disposed){applyLighting();assetInstancing?.update()}
    return state
  })
  function soundState(){return {enabled:!!polish.soundEnabled,status:polish.state.audioStatus,error:polish.state.audioError}}
  function notifySound(){if(onSoundState)onSoundState(soundState())}
  function stop(){animation.setRunning(false);animation.setTracked(false);machine.reset();polish.reset();notifySound()}
  function reset(){
    if(disposed)return
    trackingSuspended=false;machine.setSteamEnabled(steamEnabled)
    animation.reset();machine.reset();polish.reset();notifySound();assetInstancing?.update()
  }
  function suspendTracking(){
    if(disposed || (!tracked && !trackingSuspended))return false
    tracked=false;trackingSuspended=true;object3D.visible=false
    // Hide uncertain placement immediately, preserve machine phase only inside
    // the adapter's bounded brief-loss window. Audio/boost/steam never linger.
    animation.pause();machine.setSteamEnabled(false);polish.setSoundEnabled(false);notifySound()
    return true
  }
  function setTracked(value){
    if(disposed)return
    tracked=!!value && !document?.hidden
    object3D.visible=tracked
    if(!tracked){
      trackingSuspended=false;machine.setSteamEnabled(steamEnabled);stop()
      cameraLighting.wallColorMultiplier=[1,1,1];cameraLighting.targetWallColorMultiplier=[1,1,1]
      cameraLighting.wallSampleAt=-Infinity;cameraLighting.wallColorSource='neutral';applyLighting();assetInstancing?.update();return
    }
    if(trackingSuspended){trackingSuspended=false;machine.setSteamEnabled(steamEnabled)}
    animation.setTracked(true);animation.setRunning(true);assetInstancing?.update()
  }
  function setReducedMotion(value){
    if(disposed)return
    reducedMotion=!!value;animation.setReducedMotion(reducedMotion)
    if(reducedMotion){machine.reset();polish.reset();notifySound()}
    assetInstancing?.update()
  }
  function setOverdrive(value){
    if(disposed)return
    if(value && tracked && !reducedMotion)animation.triggerOverdrive(now())
    else {animation.state.overdrive=false;animation.state.overdriveUntil=0}
  }
  function setSteamEnabled(value){
    if(disposed)return
    steamEnabled=!!value
    // Disabling the enhanced emitter clears its live particle pool. Retain
    // gauges/lamp updates with a steam-specific state flag in the copied runtime.
    machine.setSteamEnabled(steamEnabled && !trackingSuspended)
  }
  function applyLighting(){
    const gain=cameraLighting.gain
    tint.setRGB(...cameraLighting.color)
    const cameraMode=cameraLighting.mode==='camera',adaptation=cameraLighting.adaptation
    for(const {light,intensity,color} of authoredLights){
      light.intensity=intensity*gain*(cameraMode?(light===cameraKey?.light?1+cameraLighting.directionalStrength:1-.15*adaptation):1)
      light.color.copy(color).lerp(neutral,.8*adaptation).multiply(tint)
    }
    if(cameraKey){
      if(cameraMode && sceneEl.camera){
        direction.set(...cameraLighting.direction).normalize()
        sceneEl.camera.getWorldQuaternion(cameraQuaternion);object3D.getWorldQuaternion(wallQuaternion).invert()
        direction.applyQuaternion(cameraQuaternion).applyQuaternion(wallQuaternion).multiplyScalar(3)
        cameraKey.light.position.copy(keyPosition).lerp(direction,cameraLighting.directionalStrength)
      }else cameraKey.light.position.copy(keyPosition)
    }
    machine.setLighting?.(gain,cameraLighting.color)
    for(const [material,base] of modelEnvironmentIntensity)material.envMapIntensity=base*.72*gain
    // Ratios compare camera artwork pixels with the same authored artwork. Apply
    // the linear ratio once; room tint/gain would count the printed pigment twice.
    wallTint.setRGB(...cameraLighting.wallColorMultiplier)
    for(const [material,color] of bakedColors)material.color.copy(color).multiply(wallTint)
  }
  function setLightingMode(mode){
    if(disposed)return
    cameraLighting.mode=mode==='camera'?'camera':'studio'
    cameraLighting.source=cameraLighting.mode==='camera'?'waiting-for-camera':'studio'
    cameraLighting.sampleAt=-Infinity;cameraLighting.gain=cameraLighting.targetGain=1
    cameraLighting.color=[1,1,1];cameraLighting.targetColor=[1,1,1]
    cameraLighting.direction=[0,0,1.5];cameraLighting.targetDirection=[0,0,1.5]
    cameraLighting.directionalStrength=cameraLighting.targetDirectionalStrength=0;cameraLighting.confidence=0;cameraLighting.directionSource='none'
    cameraLighting.adaptation=cameraLighting.targetAdaptation=0
    cameraLighting.wallColorMultiplier=[1,1,1];cameraLighting.targetWallColorMultiplier=[1,1,1]
    cameraLighting.wallSampleAt=-Infinity;cameraLighting.wallColorSource='neutral';applyLighting();assetInstancing?.update()
  }
  function setCameraLighting(sample){
    if(disposed || cameraLighting.mode!=='camera' || !sample || !Number.isFinite(sample.gain))return
    if(!Array.isArray(sample.color) || sample.color.length!==3 || !sample.color.every(Number.isFinite))return
    if(Number.isFinite(sample.confidence) && sample.confidence<.08)return
    cameraLighting.targetGain=Math.max(.25,Math.min(2,sample.gain))
    cameraLighting.targetColor=sample.color.map(value=>Math.max(.75,Math.min(1.25,value)))
    cameraLighting.source=sample.source;cameraLighting.sampleAt=now()
    cameraLighting.targetAdaptation=1
    cameraLighting.confidence=sample.confidence ?? 1
    if(sample.source==='tracked-wall-reference' && Array.isArray(sample.wallColorMultiplier) && sample.wallColorMultiplier.length===3 && sample.wallColorMultiplier.every(value=>Number.isFinite(value) && value>0)){
      cameraLighting.targetWallColorMultiplier=sample.wallColorMultiplier.map(value=>Math.max(.6,Math.min(1.5,value)))
      cameraLighting.wallSampleAt=now();cameraLighting.wallColorSource='tracked-wall-reference'
    }
    if(Array.isArray(sample.direction) && sample.direction.length===3 && sample.direction.every(Number.isFinite) && Number.isFinite(sample.directionalStrength)){
      cameraLighting.targetDirection=sample.direction.map(value=>Math.max(-2,Math.min(2,value)))
      cameraLighting.targetDirectionalStrength=Math.max(0,Math.min(.65,sample.directionalStrength))*cameraLighting.confidence
      cameraLighting.directionSource=sample.directionSource || 'screen-brightness-estimate'
    }else{cameraLighting.targetDirectionalStrength=0;cameraLighting.directionSource='none'}
  }
  function interact(action,name){
    if(disposed || !tracked || document?.hidden || reducedMotion)return false
    let accepted=false
    if(action==='release')accepted=!!animation.triggerRelease?.()
    if(action==='valve')accepted=!!animation.turnValve?.(name)
    if(action==='handle')accepted=!!animation.turnHandle?.(name)
    if(action==='lamp')accepted=!!machine.interact?.(action,name)
    if(action==='sign')accepted=!!polish.interact?.(action,name)
    if(action==='gear'){animation.triggerOverdrive(now());accepted=!!animation.state.overdrive}
    if(action==='restart'){reset();accepted=true}
    if(accepted){interaction.count++;interaction.lastAction=action;interaction.lastPart=name || null}
    return accepted
  }
  function interactAt(clientX,clientY,canvas,camera=sceneEl.camera){
    if(disposed || !tracked || reducedMotion || document?.hidden || !camera || !Number.isFinite(clientX) || !Number.isFinite(clientY))return null
    const rect=canvas?.getBoundingClientRect?.()
    if(!rect?.width || !rect?.height || clientX<rect.left || clientX>rect.left+rect.width || clientY<rect.top || clientY>rect.top+rect.height)return null
    pointer.set((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2)
    camera.updateWorldMatrix(true,false);model.updateWorldMatrix(true,true);raycaster.setFromCamera(pointer,camera)
    let selected=null,nearest=Infinity
    for(const part of interactiveParts){
      if(!part.object.visible)continue
      part.object.getWorldScale(pickScale)
      pickSphere.center.copy(part.center).applyMatrix4(part.object.matrixWorld)
      pickSphere.radius=part.radius*Math.max(pickScale.x,pickScale.y,pickScale.z)
      if(part.action && part.object.geometry?.boundingBox){
        // A broad sign sphere can steal taps from nearby lamps. Test the actual
        // source-local box, then compare world distances with the other targets.
        localPickRay.copy(raycaster.ray).applyMatrix4(localPickInverse.copy(part.object.matrixWorld).invert())
        if(!localPickRay.intersectBox(part.object.geometry.boundingBox,localPickHit))continue
        hitPoint.copy(localPickHit).applyMatrix4(part.object.matrixWorld)
      }else if(!raycaster.ray.intersectSphere(pickSphere,hitPoint))continue
      const distance=raycaster.ray.origin.distanceToSquared(hitPoint)
      if(distance<nearest){nearest=distance;selected=part}
    }
    if(!selected)return null
    const action=selected.action || (selected.role==='valve_wheel'?'valve':selected.role==='gear'?'gear':'release')
    return interact(action,selected.object.name)?{action,part:selected.object.name}:null
  }
  function update({deltaMs=0,nowMs=now()}={}){
    if(disposed)return
    if(document?.hidden){setTracked(false);return}
    lastNow=nowMs
    if(cameraLighting.mode==='camera'){
      if(nowMs-cameraLighting.sampleAt>3000){cameraLighting.targetGain=1;cameraLighting.targetColor=[1,1,1];cameraLighting.targetDirectionalStrength=0;cameraLighting.targetAdaptation=0;cameraLighting.source='studio-fallback'}
      const amount=1-Math.exp(-Math.max(0,Math.min(100,deltaMs))/800)
      cameraLighting.gain+=(cameraLighting.targetGain-cameraLighting.gain)*amount
      cameraLighting.color=cameraLighting.color.map((value,i)=>value+(cameraLighting.targetColor[i]-value)*amount)
      cameraLighting.direction=cameraLighting.direction.map((value,i)=>value+(cameraLighting.targetDirection[i]-value)*amount)
      cameraLighting.directionalStrength+=(cameraLighting.targetDirectionalStrength-cameraLighting.directionalStrength)*amount
      cameraLighting.adaptation+=(cameraLighting.targetAdaptation-cameraLighting.adaptation)*amount
      // Raw-frame fallback can keep lights responsive, but cannot extend the age
      // of an artwork fit or recolour its backing when no fit is trustworthy.
      if(nowMs-cameraLighting.wallSampleAt>1800){cameraLighting.targetWallColorMultiplier=[1,1,1];cameraLighting.wallColorSource='neutral-fallback'}
      cameraLighting.wallColorMultiplier=cameraLighting.wallColorMultiplier.map((value,i)=>value+(cameraLighting.targetWallColorMultiplier[i]-value)*amount)
      applyLighting()
    }
    animation.update(deltaMs,nowMs)
    machine.update(deltaMs,nowMs,animation.state)
    polish.update(deltaMs,nowMs,animation.state)
    assetInstancing?.update()
  }
  async function setSoundEnabled(value){
    if(disposed)return false
    if(value && (!tracked || document?.hidden))return false
    const result=await polish.setSoundEnabled(!!value)
    if(disposed)return false
    notifySound();return result
  }
  function onHidden(){if(document?.hidden)setTracked(false)}
  document?.addEventListener?.('visibilitychange',onHidden)
  function dispose(){
    if(disposed)return
    setTracked(false);disposed=true
    document?.removeEventListener?.('visibilitychange',onHidden)
    // Restore lamp originals before collecting model-owned resources. Runtime
    // effects dispose their own clones/overlays; no shared atlas is freed twice.
    assetInstancing?.dispose();environment?.dispose();polish.dispose();machine.dispose();animation.dispose();borderExtension?.dispose()
    const geometries=new Set(),materials=new Set(),textures=new Set()
    model.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry)
      if(object.material)for(const material of(Array.isArray(object.material)?object.material:[object.material]))if(material)materials.add(material)
    })
    for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value)
    for(const geometry of geometries)geometry.dispose()
    for(const material of materials)material.dispose()
    for(const texture of textures)texture.dispose()
    object3D.removeFromParent();object3D.clear()
    if(rendererOriginal && renderer){
      if(renderer.toneMapping===THREE.ACESFilmicToneMapping)renderer.toneMapping=rendererOriginal.toneMapping
      if(renderer.toneMappingExposure===1)renderer.toneMappingExposure=rendererOriginal.exposure
    }
  }
  function getDiagnostics(){return {fullWall:true,appearance:{...appearance},borderExtension:borderExtension?{...borderExtension.state}:null,assetInstancing:assetInstancing?.getDiagnostics() || null,disposed,tracked,trackingSuspended,reducedMotion,steamEnabled,lastNow,
    gearCount:animation.state.gearCount,valveCount:animation.state.valveCount,
    gearContacts:animation.state.gearContacts,gearComponents:animation.state.gearComponents,
    gearConflicts:animation.state.gearConflicts,overdrive:animation.state.overdrive,
    startup:animation.state.startup,releaseRemaining:animation.state.releaseRemaining,valveTurns:animation.state.valveTurns,interaction:{...interaction,partCount:interactiveParts.length},
    machine:machine.getDiagnostics(),sound:soundState(),cameraLighting:{...cameraLighting},environment:environment?.state || {status:'disabled'}}}
  return {object3D,ready,setTracked,suspendTracking,setReducedMotion,setOverdrive,setSteamEnabled,setCameraLighting,setLightingMode,update,reset,dispose,setSoundEnabled,getDiagnostics,interact,interactAt,
    get soundEnabled(){return !!polish.soundEnabled}}
}
