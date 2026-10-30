// Local, bounded observations of the coordinator frame loop. This never uploads data
// and does not turn a browser session into physical-device or print acceptance.
export function createFieldSession(options={}) {
  const now=options.now || (()=>globalThis.performance.now())
  const wallClock=options.wallClock || (()=>new Date().toISOString())
  const navigator=options.navigator || globalThis.navigator || {}
  const capacity=Math.max(1,Math.min(600,Math.floor(Number(options.maxSamples)||180)))
  const sampleMs=Math.max(100,Number(options.sampleMs)||1000)
  const maxGapMs=Math.max(sampleMs,Number(options.maxFrameGapMs)||2000)
  let metadata,startedAt,startedMs,stoppedMs,active,lastFrame,intervals,elapsedMs
  let excludedGapMs,invalidTimestamps,minFrameMs,maxFrameMs,bucketMs,bucketFrames
  let samples,sampleCursor,marks,memory,histogram
  function start(extra={}) {
    metadata={build:options.build || 'UNKNOWN',wall:options.wall || 'UNKNOWN',
      context:options.context || 'UNCLASSIFIED_BROWSER_SESSION',
      device:options.device || 'NOT RECORDED',
      browser:{userAgent:String(navigator.userAgent || 'NOT RECORDED'),
        platform:String(navigator.platform || 'NOT RECORDED')},...extra}
    startedAt=wallClock();startedMs=now();stoppedMs=null;active=true;lastFrame=null
    intervals=0;elapsedMs=0;excludedGapMs=0;invalidTimestamps=0
    minFrameMs=Infinity;maxFrameMs=0;bucketMs=0;bucketFrames=0
    samples=[];sampleCursor=0;marks=new Map();memory=null
    histogram=new Uint32Array(1001)
    return api
  }
  function frame(timestamp=now()) {
    if(stoppedMs!==null || !active)return
    if(!Number.isFinite(timestamp) || timestamp<startedMs){invalidTimestamps++;return}
    if(lastFrame===null){lastFrame=timestamp;return}
    const delta=timestamp-lastFrame
    if(delta<=0){invalidTimestamps++;return}
    lastFrame=timestamp
    if(delta>maxGapMs){excludedGapMs+=delta;return}
    intervals++;elapsedMs+=delta;bucketFrames++;bucketMs+=delta
    minFrameMs=Math.min(minFrameMs,delta);maxFrameMs=Math.max(maxFrameMs,delta)
    histogram[Math.min(1000,Math.floor(delta))]++
    if(bucketMs>=sampleMs){
      const sample={elapsedMs:timestamp-startedMs,durationMs:bucketMs,
        intervals:bucketFrames,fps:bucketFrames*1000/bucketMs}
      if(samples.length<capacity)samples.push(sample)
      else {samples[sampleCursor]=sample;sampleCursor=(sampleCursor+1)%capacity}
      bucketMs=0;bucketFrames=0
    }
  }
  function setActive(value) {active=Boolean(value);lastFrame=null;return api}
  function mark(name,timestamp=now()) {
    if(stoppedMs!==null || typeof name!=='string' || !name || name.length>80 ||
      !Number.isFinite(timestamp) || timestamp<startedMs)return false
    if(!marks.has(name) && marks.size>=64)return false
    marks.set(name,timestamp-startedMs);return true
  }
  function sampleMemory(observed=options.performance?.memory) {
    if(!observed)return false
    const fields=['usedJSHeapSize','totalJSHeapSize','jsHeapSizeLimit']
    const values={}
    for(const field of fields){
      const value=observed[field]
      if(typeof value!=='number' || !Number.isFinite(value) || value<0)return false
      values[field]=value
    }
    memory={status:'OBSERVED',source:'nonstandard performance.memory; JavaScript heap only',
      elapsedMs:now()-startedMs,...values}
    return true
  }
  function percentileFrameMs(percentile) {
    if(!intervals)return null
    const threshold=Math.ceil(intervals*percentile)
    let count=0
    for(let i=0;i<histogram.length;i++){count+=histogram[i];if(count>=threshold)return i}
    return null
  }
  function snapshot() {
    const ordered=samples.length===capacity && sampleCursor
      ? samples.slice(sampleCursor).concat(samples.slice(0,sampleCursor)) : samples.slice()
    return {
      schemaVersion:1,scope:'Local coordinator frame-loop observations; not presented-frame/GPU FPS or acceptance proof',
      metadata:JSON.parse(JSON.stringify(metadata)),startedAt,
      elapsedMs:Math.max(0,(stoppedMs===null?now():stoppedMs)-startedMs),
      stopped:stoppedMs!==null,active:stoppedMs===null && active,
      frameLoop:{status:intervals?'OBSERVED':'NOT MEASURED',intervals,sampledDurationMs:elapsedMs,
        meanFps:elapsedMs?intervals*1000/elapsedMs:null,
        meanFrameMs:intervals?elapsedMs/intervals:null,
        minFrameMs:intervals?minFrameMs:null,maxFrameMs:intervals?maxFrameMs:null,
        p95FrameMsLowerBound:percentileFrameMs(.95),histogramBinMs:1,histogramOverflowMs:1000,
        excludedGapMs,invalidTimestamps,maxAcceptedGapMs:maxGapMs,
        samples:ordered.map(sample=>({...sample})),retainedSampleLimit:capacity},
      timings:{status:marks.size?'OBSERVED':'NOT MEASURED',clock:'milliseconds since session start',
        marks:Object.fromEntries(marks)},
      memory:memory?{...memory}:{status:'UNAVAILABLE',reason:'No browser JavaScript heap measurement supplied'},
      physicalChecks:{phoneTest:'NOT VERIFIED',temperature:'NOT MEASURED',audio:'NOT MEASURED',
        printAlignment:'NOT MEASURED',trackingAcquisition:'NOT MEASURED',
        trackingReacquisition:'NOT MEASURED'},
      transport:'Local JSON only; no storage or upload performed',
    }
  }
  function stop(timestamp=now()) {
    if(stoppedMs===null){stoppedMs=Number.isFinite(timestamp)?Math.max(startedMs,timestamp):now();lastFrame=null;active=false}
    return snapshot()
  }
  const api={start,frame,setActive,mark,sampleMemory,snapshot,stop,
    exportJSON:()=>JSON.stringify(snapshot(),null,2)}
  return start()
}
