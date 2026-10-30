import {sampleWallColorMatch} from './wall-color-match.js'
import wallColorReferenceModule from '../../config/wall-color-reference.json'

// Tiny, local camera-frame averages. Pixels never leave the AR engine or get stored.
export function sampleCameraLighting(frame, exposure) {
  const pixels=frame?.pixels,rows=frame?.rows,cols=frame?.cols,rowBytes=frame?.rowBytes
  let r=0,g=0,b=0,count=0,weight=0,horizontal=0,vertical=0,neutralWeight=0,nr=0,ng=0,nb=0
  if(pixels && rows>0 && cols>0 && rowBytes>=cols*4 && pixels.length>=rows*rowBytes){
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const i=y*rowBytes+x*4,rr=pixels[i]/255,gg=pixels[i+1]/255,bb=pixels[i+2]/255
      const l=.2126*rr+.7152*gg+.0722*bb
      // Avoid a single clipped lamp or black camera border dominating the estimate.
      if(pixels[i+3]===0 || l<.015 || l>.97)continue
      r+=rr;g+=gg;b+=bb;count++
      // Soft neutral-pixel weighting limits the printed brass/brick bias. This is
      // a frame estimate, not a measurement of illuminant colour or light depth.
      const saturation=(Math.max(rr,gg,bb)-Math.min(rr,gg,bb))/Math.max(.05,rr,gg,bb)
      const neutral=Math.pow(1-saturation,4)
      nr+=rr*neutral;ng+=gg*neutral;nb+=bb*neutral;neutralWeight+=neutral
      weight+=l;horizontal+=l*((x+.5)/cols*2-1);vertical+=l*(1-(y+.5)/rows*2)
    }
  }
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n))
  if(count){
    r/=count;g/=count;b/=count
    const luminance=.2126*r+.7152*g+.0722*b
    const hasExposure=Number.isFinite(exposure) && exposure>0
    if(neutralWeight>=Math.max(2,count*.04)){r=nr/neutralWeight;g=ng/neutralWeight;b=nb/neutralWeight}
    const tintLuminance=.2126*r+.7152*g+.0722*b
    const confidence=clamp(count/(rows*cols),0,1)
    return {source:hasExposure?'camera-rgb+engine-exposure':'camera-rgb',gain:clamp(hasExposure?exposure:luminance/.4,.25,2),
      color:[clamp(r/Math.max(.05,tintLuminance),.75,1.25),clamp(g/Math.max(.05,tintLuminance),.75,1.25),clamp(b/Math.max(.05,tintLuminance),.75,1.25)],
      confidence,direction:[clamp(horizontal/weight*4,-1,1),clamp(vertical/weight*4,-1,1),1.5],
      directionalStrength:clamp(Math.hypot(horizontal,vertical)/weight*3,0,.65),
      directionSource:'screen-brightness-estimate'}
  }
  if(Number.isFinite(exposure) && exposure>0)return {source:'engine-exposure',gain:clamp(exposure,.25,2),color:[1,1,1]}
  return null
}

// Compare projected panel points, rather than filtered render poses, to reject
// rapid camera/target movement from reference-colour qualification.
function correspondenceStable(previous,current){
  if(!previous || !current)return false
  const project=(context,x,y)=>{
    const a=context.panelMatrix?.elements || context.panelMatrix,b=context.viewProjectionMatrix?.elements || context.viewProjectionMatrix
    if(!a || !b || a.length!==16 || b.length!==16)return null
    const p=[a[0]*x+a[4]*y+a[12],a[1]*x+a[5]*y+a[13],a[2]*x+a[6]*y+a[14],a[3]*x+a[7]*y+a[15]]
    const clip=[0,1,2,3].map(row=>b[row]*p[0]+b[row+4]*p[1]+b[row+8]*p[2]+b[row+12]*p[3])
    return clip.every(Number.isFinite) && clip[3]>0?[clip[0]/clip[3],clip[1]/clip[3]]:null
  }
  const aspect=Number(current.panelAspect)
  if(!Number.isFinite(aspect) || aspect<=0)return false
  for(const [x,y] of [[0,0],[-.4,-aspect*.4],[.4,-aspect*.4],[-.4,aspect*.4],[.4,aspect*.4]]){
    const a=project(previous,x,y),b=project(current,x,y)
    if(!a || !b || Math.hypot(a[0]-b[0],a[1]-b[1])>.03)return false
  }
  return true
}

export function createCameraLightingModule({onLighting,now=()=>performance.now(),getTrackingFrame,
  wallMatcher=typeof sampleWallColorMatch==='function'?sampleWallColorMatch:null,
  reference=typeof wallColorReferenceModule!=='undefined'?(wallColorReferenceModule.default || wallColorReferenceModule):null,
}={}) {
  let last=-Infinity,previous=null,canvasWidth=0,canvasHeight=0
  let diagnostics={status:'not-measured',reason:'no-camera-update',attempts:0,accepted:0,rejected:0,reasonCounts:{}}
  const report=result=>{
    const reason=String(result.reason || 'unspecified')
    diagnostics={...result,attempts:diagnostics.attempts+1,
      accepted:diagnostics.accepted+(result.status==='accepted'?1:0),rejected:diagnostics.rejected+(result.status==='rejected'?1:0),
      reasonCounts:{...diagnostics.reasonCounts,[reason]:(diagnostics.reasonCounts[reason] || 0)+1}}
  }
  const reset=()=>{previous=null;last=-Infinity;diagnostics={status:'waiting',reason:'frame-history-reset',attempts:diagnostics.attempts,accepted:diagnostics.accepted,rejected:diagnostics.rejected,reasonCounts:diagnostics.reasonCounts}}
  const dimensions=event=>{
    if(event?.canvasWidth>0)canvasWidth=event.canvasWidth
    if(event?.canvasHeight>0)canvasHeight=event.canvasHeight
    reset()
  }
  return {name:'steampunk-camera-lighting',reset,getDiagnostics:()=>JSON.parse(JSON.stringify(diagnostics)),onAttach:dimensions,onCanvasSizeChange:dimensions,
    onVideoSizeChange:dimensions,onDeviceOrientationChange:reset,onDetach:reset,
    onUpdate({frameStartResult={},processGpuResult,processCpuResult}={}){
      const time=now(),prior=previous
      const current=typeof getTrackingFrame==='function'?getTrackingFrame({frameStartResult,processGpuResult,processCpuResult,canvasWidth,canvasHeight}):null
      // CameraPixelArray returns the preceding FBO, then renders the current
      // compute texture. Keep exactly one raw-pose snapshot every engine frame,
      // even while output is throttled to5Hz. Never retain camera pixels.
      previous=frameStartResult.computeTexture && current?current:null
      if(time-last<200)return
      last=time
      const frame=processGpuResult?.camerapixelarray
      let sample=sampleCameraLighting(frame,processCpuResult?.reality?.lighting?.exposure)
      const observingReference=current && reference && current.candidateId===reference.candidateId &&
        current.wallId===reference.wallId && current.targetName===reference.targetName
      // Brass/brick pixels encode pigment and painted highlights. While looking
      // at known artwork they cannot independently measure illumination: a dark
      // print must not cut the machinery's lights to25% during fit rejection.
      // Only a qualified corresponding camera/reference fit may change colour.
      if(sample && observingReference)sample={...sample,source:'tracked-wall-neutral-fallback',
        rawFrameGain:sample.gain,gain:1,color:[1,1,1],directionalStrength:0,directionSource:'reference-artwork-no-light-direction'}
      const sameWall=prior && current && prior.candidateId===current.candidateId && prior.wallId===current.wallId &&
        prior.targetName===current.targetName && prior.generation===current.generation
      const sameFrameGeometry=sameWall && prior.sourceWidth===current.sourceWidth && prior.sourceHeight===current.sourceHeight &&
        prior.canvasWidth===current.canvasWidth && prior.canvasHeight===current.canvasHeight &&
        ['offsetX','offsetY','width','height'].every(key=>prior.viewport?.[key]===current.viewport?.[key])
      if(frame?.pixels && wallMatcher && reference && sameFrameGeometry && prior.candidateId===reference.candidateId &&
        prior.wallId===reference.wallId && prior.targetName===reference.targetName){
        let reported=false
        const match=wallMatcher({frame,reference,...prior,frameAligned:true,
          poseStable:prior.poseStable===true && current.poseStable===true && correspondenceStable(prior,current),
          onDiagnostic:result=>{reported=true;report(result)}})
        if(!reported)report({status:match?'accepted':'rejected',reason:match?'qualified-reference-fit':'matcher-rejected'})
        if(match)sample={...sample,...match,directionalStrength:0,directionSource:'reference-artwork-no-light-direction'}
      }else report({status:'rejected',reason:!frame?.pixels?'camera-pixels-unavailable':!current?'no-tracked-panel':!reference?'reference-unavailable':
        !observingReference?'reference-identity-mismatch':!sameWall?'waiting-for-corresponding-frame':!sameFrameGeometry?'frame-geometry-changed':'matcher-unavailable'})
      if(sample){
        // Tag every sample with the currently observed wall so a delayed sample
        // cannot colour a different wall after automatic handoff.
        if(current)sample={...sample,candidateId:current.candidateId,wallId:current.wallId,targetName:current.targetName}
        onLighting(sample)
      }
    },
  }
}
