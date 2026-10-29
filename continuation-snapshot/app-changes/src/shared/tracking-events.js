// Local lifecycle observations only. This module does not subscribe to XR, read
// camera frames/sensors, store/upload data, or establish phone/print acceptance.
const UNKNOWN='UNKNOWN'
const TYPES=new Set(['scan-requested','camera-ready','search-started','target-found',
  'target-lost','tracking-paused','tracking-resumed','tracking-stopped',
  'quality-fallback','world-tracking-valid','world-tracking-invalid',
  'render-visible','render-hidden','coverage-handoff'])
const META=['build','bundleHash','targetHash','modelHash','target','engineMode',
  'trackingMode','lossPolicy','device','browser','scanMedium']
const DETAIL=['target','previousTarget','reason','quality','worldTrackingValid']

// Limit retained payloads as well as event count. Only named observation fields
// are accepted; a camera/frame/GPS/audio payload is never retained.
function copyValue(value,depth=0) {
  if(value===null || typeof value==='boolean')return value
  if(typeof value==='string')return value.slice(0,2048)
  if(typeof value==='number')return Number.isFinite(value)?value:UNKNOWN
  if(depth>=3 || typeof value!=='object')return UNKNOWN
  if(Array.isArray(value))return value.slice(0,16).map(item=>copyValue(item,depth+1))
  const result={}
  for(const key of Object.keys(value).slice(0,32)) {
    if(key==='__proto__' || key==='constructor' || key==='prototype')continue
    result[key.slice(0,80)]=copyValue(value[key],depth+1)
  }
  return result
}
function fields(input,names,defaults=false) {
  const result={}
  for(const name of names) {
    if(input && Object.prototype.hasOwnProperty.call(input,name) && input[name]!=null)
      result[name]=copyValue(input[name])
    else if(defaults)result[name]=UNKNOWN
  }
  return result
}
function ring(limit) {
  const values=[];let cursor=0,overflow=0
  return {
    push(value) {
      if(values.length<limit)values.push(value)
      else {values[cursor]=value;cursor=(cursor+1)%limit;overflow++}
    },
    snapshot:()=>({overflow,items:copyValueList(cursor
      ? values.slice(cursor).concat(values.slice(0,cursor)):values)}),
  }
}
const copyValueList=values=>values.map(value=>JSON.parse(JSON.stringify(value)))
function metric() {return {count:0,totalMs:0,minMs:null,maxMs:null}}
function addMetric(value,duration) {
  value.count++;value.totalMs+=duration
  value.minMs=value.minMs===null?duration:Math.min(value.minMs,duration)
  value.maxMs=value.maxMs===null?duration:Math.max(value.maxMs,duration)
}
function metricSnapshot(value) {
  return {...value,meanMs:value.count?value.totalMs/value.count:null}
}

export function createTrackingEventRecorder({now=()=>globalThis.performance.now(),capacity=256}={}) {
  if(typeof now!=='function')throw new TypeError('now must be a monotonic clock function')
  const requested=Number(capacity)
  const limit=Number.isFinite(requested)?Math.max(1,Math.min(2048,Math.floor(requested))):256
  let clock=null,session=0,data=null,previousSession=null

  function readClock() {
    let value
    try {value=now()} catch {if(data)data.rejected.invalidTime++;return null}
    if(typeof value!=='number' || !Number.isFinite(value) || value<0 || (clock!==null && value<clock)) {
      if(data)data.rejected.invalidTime++
      return null
    }
    clock=value
    return value
  }
  function elapsed(timestamp) {return timestamp-data.startedMs}
  function startTrial(kind,timestamp) {
    data.pending={id:++data.trialSequence,kind,startedMs:timestamp,
      startedElapsedMs:elapsed(timestamp)}
  }
  function closeTrial(outcome,timestamp,reason) {
    if(!data.pending)return
    const pending=data.pending,durationMs=timestamp-pending.startedMs
    const trial={id:pending.id,kind:pending.kind,startedElapsedMs:pending.startedElapsedMs,
      endedElapsedMs:elapsed(timestamp),durationMs,outcome,reason}
    data.trials.push(trial)
    const summary=data.summary[pending.kind]
    addMetric(summary[outcome],durationMs)
    data.pending=null
  }
  function pushEvent(type,detail,timestamp,classification) {
    const channel=type==='target-found' || type==='target-lost'?'raw-target'
      : type.startsWith('render-')?'rendered-continuity'
      : type.startsWith('world-')?'world-tracking':type==='coverage-handoff'?'reference-handoff':'lifecycle'
    data.events.push({sequence:++data.sequence,type,channel,elapsedMs:elapsed(timestamp),
      classification,detail})
  }
  function begin(metadata={}) {
    const timestamp=readClock()
    if(timestamp===null)return false
    if(data) {
      const cancelled=data.pending?{...data.pending}:null
      if(data.state!=='stopped') {
        closeTrial('censored',timestamp,'new-session')
        if(data.pausedAt!==null)data.pausedMs+=timestamp-data.pausedAt
        data.pausedAt=null;data.stoppedMs=timestamp;data.state='stopped'
      }
      // Retain just the previous session's cancellation/summary, not an unbounded
      // session history. Export snapshots externally if individual trials matter.
      previousSession={session:data.session,elapsedMs:elapsed(data.stoppedMs),
        replacedPendingTrial:cancelled?{id:cancelled.id,kind:cancelled.kind,
          durationMs:timestamp-cancelled.startedMs,outcome:'censored',reason:'new-session'}:null,
        summary:JSON.parse(JSON.stringify(data.summary))}
    }
    data={metadata:fields(metadata,META,true),startedMs:timestamp,stoppedMs:null,
      state:'active',pausedAt:null,pausedMs:0,tracked:false,everFound:false,
      searchStarted:false,pending:null,sequence:0,trialSequence:0,
      events:ring(limit),trials:ring(limit),session:++session,
      counts:{rawFoundCallbacks:0,rawLostCallbacks:0,foundTransitions:0,lossTransitions:0,
        duplicateFound:0,duplicateLost:0,unmeasuredFound:0,pausedTargetCallbacks:0,
        duplicateLifecycle:0,qualityFallbacks:0,coverageHandoffs:0},
      rejected:{invalidTime:0,invalidType:0,inactive:0,targetMismatch:0},
      summary:{'first-acquisition':{completed:metric(),censored:metric()},
        'reacquisition':{completed:metric(),censored:metric()},
        'resume-acquisition':{completed:metric(),censored:metric()}}}
    return true
  }
  function record(type,detail={}) {
    if(!data)return false
    if(data.state==='stopped'){data.rejected.inactive++;return false}
    if(!TYPES.has(type)){data.rejected.invalidType++;return false}
    const timestamp=readClock()
    if(timestamp===null)return false
    const observed=fields(detail,DETAIL)
    // One recorder observes one configured target stream. A different target
    // needs another recorder/session rather than a fabricated reacquisition.
    if((type==='target-found' || type==='target-lost' || type==='coverage-handoff') && observed.target &&
      data.metadata.target!==UNKNOWN && observed.target!==data.metadata.target) {
      data.rejected.targetMismatch++;return false
    }
    let classification='observed'
    if(type==='tracking-stopped') {
      closeTrial('censored',timestamp,'tracking-stopped')
      if(data.pausedAt!==null)data.pausedMs+=timestamp-data.pausedAt
      data.pausedAt=null;data.tracked=false;data.state='stopped';data.stoppedMs=timestamp
    } else if(type==='tracking-paused') {
      if(data.state==='paused'){data.counts.duplicateLifecycle++;classification='duplicate'}
      else {
        closeTrial('censored',timestamp,'tracking-paused')
        data.state='paused';data.pausedAt=timestamp;data.tracked=false
      }
    } else if(type==='tracking-resumed') {
      if(data.state!=='paused'){data.counts.duplicateLifecycle++;classification='duplicate'}
      else {
        data.pausedMs+=timestamp-data.pausedAt;data.pausedAt=null;data.state='active'
        if(data.searchStarted)startTrial(data.everFound?'resume-acquisition':'first-acquisition',timestamp)
      }
    } else if(type==='target-found' || type==='target-lost') {
      const found=type==='target-found'
      data.counts[found?'rawFoundCallbacks':'rawLostCallbacks']++
      if(data.state==='paused'){data.counts.pausedTargetCallbacks++;classification='ignored-while-paused'}
      else if(found===data.tracked) {
        data.counts[found?'duplicateFound':'duplicateLost']++;classification='duplicate'
      } else if(found) {
        data.counts.foundTransitions++
        if(data.pending)closeTrial('completed',timestamp,'target-found')
        else {data.counts.unmeasuredFound++;classification='found-without-search-window'}
        data.tracked=true;data.everFound=true
      } else {
        data.counts.lossTransitions++;data.tracked=false
        startTrial('reacquisition',timestamp)
      }
    } else if(type==='search-started') {
      if(data.state==='paused')classification='ignored-while-paused'
      else if(data.pending || data.tracked){data.counts.duplicateLifecycle++;classification='duplicate'}
      else {data.searchStarted=true;startTrial(data.everFound?'resume-acquisition':'first-acquisition',timestamp)}
    } else if(type==='quality-fallback')data.counts.qualityFallbacks++
    else if(type==='coverage-handoff')data.counts.coverageHandoffs++
    pushEvent(type,observed,timestamp,classification)
    return true
  }
  function snapshot() {
    if(!data)return {schemaVersion:1,status:'NOT_STARTED',session:0,capacity:limit}
    // A snapshot may extend an incomplete interval, never complete a trial.
    if(data.state!=='stopped')readClock()
    const timestamp=data.stoppedMs===null?clock:data.stoppedMs
    const pausedMs=data.pausedMs+(data.pausedAt===null?0:timestamp-data.pausedAt)
    const events=data.events.snapshot(),trials=data.trials.snapshot()
    const summary={}
    for(const [kind,aggregate] of Object.entries(data.summary))summary[kind]={
      completed:metricSnapshot(aggregate.completed),censored:metricSnapshot(aggregate.censored)}
    return {
      schemaVersion:1,status:data.state.toUpperCase(),session:data.session,capacity:limit,
      scope:'Local supplied lifecycle events; not native recognition, GPU performance or physical acceptance proof',
      metadata:JSON.parse(JSON.stringify(data.metadata)),clock:'one monotonic clock; milliseconds',
      elapsedMs:elapsed(timestamp),activeElapsedMs:elapsed(timestamp)-pausedMs,excludedPausedMs:pausedMs,
      durationsAsOf:'last valid monotonic clock read; invalid clock reads rejected',
      rawTargetTracked:data.tracked,counts:{...data.counts},rejected:{...data.rejected},
      events:events.items,eventOverflow:events.overflow,trials:trials.items,trialOverflow:trials.overflow,
      pendingTrial:data.pending?{id:data.pending.id,kind:data.pending.kind,
        startedElapsedMs:data.pending.startedElapsedMs,durationMs:timestamp-data.pending.startedMs,
        outcome:'incomplete',reason:'No completing target-found or censoring lifecycle event observed'}:null,
      summary:{scope:'All session trials including overwritten ring entries; no percentile/distribution estimate',
        pausePolicy:'Pause censors current trial; resume opens a separately labelled window; paused duration excluded',
        ...summary},
      firstAcquisition:'Only a first-acquisition trial completed by a raw target-found event; never session-relative without search-started',
      acceptance:{phoneQuality:'NOT VERIFIED',printAlignment:'NOT VERIFIED',temperature:'NOT MEASURED'},
      previousSession:previousSession?JSON.parse(JSON.stringify(previousSession)):null,
      transport:'Local memory only; no storage or upload',
    }
  }
  function stop() {
    if(!data || data.state==='stopped')return snapshot()
    if(!record('tracking-stopped'))return false
    return snapshot()
  }
  return {begin,record,snapshot,stop}
}
