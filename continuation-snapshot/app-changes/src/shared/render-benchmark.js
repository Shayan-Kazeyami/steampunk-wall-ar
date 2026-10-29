// Opt-in instrumentation of real THREE renderer submissions. No camera pixels,
// recognition events or network uploads. CPU submission timing is not GPU timing.
export function createRenderBenchmark({renderer,now=()=>performance.now(),performance:perf=globalThis.performance,navigator:nav=globalThis.navigator,isActive=()=>true,state=()=>({}),maxSamples=40000}={}){
  if(!renderer?.render)throw new Error('A real renderer is required')
  const original=renderer.render,capacity=Math.max(60,Math.min(100000,maxSamples))
  let running=false,label='unclassified',started=0,ended=null,last=null,first=null,frames=0,discarded=0,excluded=0,bucketStart=null,bucketFrames=0
  let intervals=[],submissionMs=[],windows=[],samples=[],errors=0,lastState=null
  let rafId=null,lastRAF=null,rafStart=null,rafCount=0,rafBucket=0,rafIntervals=[],rafWindows=[]
  const round=value=>Number.isFinite(value)?Math.round(value*1000)/1000:null
  const visibilityDocument=globalThis.document
  function visibilityChange(){
    if(!running)return
    if(last!==null)excluded++
    last=null;bucketStart=null;bucketFrames=0
    lastRAF=null;rafStart=null;rafBucket=0
  }
  // Hidden pages can receive no render/rAF callbacks at all. Reset at the
  // lifecycle boundary rather than requiring a callback while hidden.
  visibilityDocument?.addEventListener?.('visibilitychange',visibilityChange)
  function quantile(values,p){if(!values.length)return null;const sorted=values.slice().sort((a,b)=>a-b);return round(sorted[Math.max(0,Math.ceil(p*sorted.length)-1)])}
  function retain(array,value){if(array.length<capacity)array.push(value);else discarded++}
  function metrics(){const info=renderer.info || {};return {calls:info.render?.calls??null,triangles:info.render?.triangles??null,points:info.render?.points??null,lines:info.render?.lines??null,geometries:info.memory?.geometries??null,textures:info.memory?.textures??null,programs:info.programs?.length??null,pixelRatio:renderer.getPixelRatio?.()??null,canvas:{width:renderer.domElement?.width??null,height:renderer.domElement?.height??null}}}
  function render(...args){
    const begin=now(),active=running && !globalThis.document?.hidden && isActive()
    if(running && !active){if(last!==null)excluded++;last=null;bucketStart=null;bucketFrames=0}
    if(active){
      if(first===null)first=begin
      if(last!==null){const delta=begin-last;if(delta>0)retain(intervals,delta)}
      last=begin;frames++;bucketFrames++
      if(bucketStart===null)bucketStart=begin
    }
    let result
    try{result=original.apply(this,args)}catch(error){if(active)errors++;throw error}
    finally{if(active){
      retain(submissionMs,now()-begin)
      if(begin-bucketStart>=1000){
        const m=metrics();lastState=state()
        if(windows.length<600)windows.push({elapsedMs:round(begin-started),durationMs:round(begin-bucketStart),fps:round((bucketFrames-1)*1000/(begin-bucketStart)),...m,state:lastState})
        bucketStart=begin;bucketFrames=1
        if(samples.length<600)samples.push({elapsedMs:round(begin-started),usedJSHeapSize:perf?.memory?.usedJSHeapSize??null,totalJSHeapSize:perf?.memory?.totalJSHeapSize??null,...m})
      }
    }}
    return result
  }
  renderer.render=render
  function animationFrame(timestamp){
    if(!running)return
    if(!globalThis.document?.hidden && isActive()){
      if(lastRAF!==null && timestamp>lastRAF)retain(rafIntervals,timestamp-lastRAF)
      lastRAF=timestamp;rafCount++;rafBucket++
      if(rafStart===null)rafStart=timestamp
      if(timestamp-rafStart>=1000){if(rafWindows.length<600)rafWindows.push({elapsedMs:round(timestamp-started),callbackRate:round((rafBucket-1)*1000/(timestamp-rafStart))});rafStart=timestamp;rafBucket=1}
    }else{lastRAF=null;rafStart=null;rafBucket=0}
    rafId=globalThis.requestAnimationFrame?.(animationFrame)??null
  }
  function start(name='unclassified'){
    if(rafId!==null)globalThis.cancelAnimationFrame?.(rafId)
    label=String(name).slice(0,100);started=now();ended=null;last=null;first=null;frames=0;discarded=0;excluded=0;bucketStart=null;bucketFrames=0;intervals=[];submissionMs=[];windows=[];samples=[];errors=0;lastState=null
    lastRAF=null;rafStart=null;rafCount=0;rafBucket=0;rafIntervals=[];rafWindows=[];running=true;rafId=globalThis.requestAnimationFrame?.(animationFrame)??null;return snapshot()
  }
  function stop(){running=false;if(rafId!==null)globalThis.cancelAnimationFrame?.(rafId);rafId=null;ended=now();last=null;return snapshot()}
  function snapshot(){
    const duration=intervals.reduce((sum,n)=>sum+n,0),m=metrics(),gl=renderer.getContext?.(),debug=gl?.getExtension?.('WEBGL_debug_renderer_info')
    const rafDuration=rafIntervals.reduce((sum,n)=>sum+n,0)
    return {schemaVersion:1,label,running,scope:'Actual THREE renderer.render calls and CPU submission durations; not compositor presented frames, GPU duration or phone acceptance. Multiple render passes can occur per animation frame.',elapsedMs:round((ended??now())-started),environment:{userAgent:nav?.userAgent??null,platform:nav?.platform??null,hardwareConcurrency:nav?.hardwareConcurrency??null,deviceMemoryGiB:nav?.deviceMemory??null,devicePixelRatio:globalThis.devicePixelRatio??null,webglRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,webglVendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null},renderFrames:frames,renderCalls:frames,renderErrors:errors,activeSampledDurationMs:round(duration),renderIntervalMs:{p50:quantile(intervals,.5),p95:quantile(intervals,.95),p99:quantile(intervals,.99),max:intervals.length?round(intervals.reduce((a,b)=>Math.max(a,b),0)):null,mean:round(duration/intervals.length)},meanSubmissionFps:duration?round(intervals.length*1000/duration):null,submissionRateLabel:'renderer.render calls per second; not presented FPS',cpuSubmissionMs:{p50:quantile(submissionMs,.5),p95:quantile(submissionMs,.95),p99:quantile(submissionMs,.99)},slowIntervals:{over16_667Ms:intervals.filter(n=>n>1000/60).length,over33_333Ms:intervals.filter(n=>n>1000/30).length,over50Ms:intervals.filter(n=>n>50).length,over100Ms:intervals.filter(n=>n>100).length},animationFrameCadence:{status:rafCount?'OBSERVED':'UNAVAILABLE',scope:'Independent requestAnimationFrame callback scheduling; not compositor presentation or GPU completion',callbacks:rafCount,retainedIntervals:rafIntervals.length,meanCallbackRate:rafDuration?round(rafIntervals.length*1000/rafDuration):null,intervalMs:{p50:quantile(rafIntervals,.5),p95:quantile(rafIntervals,.95),p99:quantile(rafIntervals,.99)},over33_333Ms:rafIntervals.filter(n=>n>1000/30).length,oneSecondWindows:rafWindows,minOneSecondCallbackRate:rafWindows.length?Math.min(...rafWindows.map(w=>w.callbackRate)):null},oneSecondWindows:windows,minOneSecondFps:windows.length?Math.min(...windows.map(w=>w.fps)):null,retainedIntervalCount:intervals.length,sampleCapacity:capacity,discardedSamples:discarded,inactiveResets:excluded,resources:m,resourceSamples:samples,memoryScope:'performance.memory is nonstandard JavaScript heap only; renderer.info memory counts are object counts, not GPU bytes',state:lastState??state(),phoneGate:{status:'UNASSESSED',goalFps:60,sustainedFloorFps:30,required:'Named physical phone, sustained session, actual tracking and camera; host viewport emulation does not establish phone performance'}}
  }
  return Object.freeze({start,stop,snapshot,dispose(){running=false;if(rafId!==null)globalThis.cancelAnimationFrame?.(rafId);rafId=null;visibilityDocument?.removeEventListener?.('visibilitychange',visibilityChange);if(renderer.render===render)renderer.render=original}})
}
