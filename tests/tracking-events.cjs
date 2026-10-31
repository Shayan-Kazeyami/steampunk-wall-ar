'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const source=fs.readFileSync(path.resolve(__dirname,'../src/shared/tracking-events.js'),'utf8')
const context={};vm.createContext(context)
vm.runInContext(source.replace('export function createTrackingEventRecorder','function createTrackingEventRecorder')+
  '\nglobalThis.createTrackingEventRecorder=createTrackingEventRecorder',context)
const {createTrackingEventRecorder}=context
const plain=value=>JSON.parse(JSON.stringify(value))
let cases=0
function test(name,run) {run();cases++;console.log('PASS '+name)}
function fixture(options={}) {
  let time=0
  const recorder=createTrackingEventRecorder({now:()=>time,...options})
  return {recorder,at(value,type,detail){time=value;return recorder.record(type,detail)},
    time(value){time=value},start(metadata){return recorder.begin(metadata)}}
}

test('Explicit session start, metadata defaults and first acquisition use search clock',()=>{
  const f=fixture(),r=f.recorder
  assert.equal(r.snapshot().status,'NOT_STARTED')
  assert.equal(r.record('target-found'),false)
  assert(f.start())
  assert.equal(r.snapshot().metadata.scanMedium,'UNKNOWN')
  f.at(5,'scan-requested');f.at(40,'camera-ready');f.at(100,'search-started')
  f.time(110);assert.equal(r.snapshot().pendingTrial.durationMs,10)
  assert.equal(r.snapshot().pendingTrial.outcome,'incomplete')
  f.at(250,'target-found')
  const result=r.snapshot()
  assert.equal(result.trials[0].durationMs,150)
  assert.equal(result.trials[0].kind,'first-acquisition')
  assert.equal(result.summary['first-acquisition'].completed.count,1)
  assert.equal(result.summary['reacquisition'].completed.count,0)
  assert.equal(result.acceptance.phoneQuality,'NOT VERIFIED')
})

test('Repeated loss/reacquisition trials and duplicate raw callbacks stay distinct',()=>{
  const f=fixture(),r=f.recorder;f.start({target:'driveway'})
  f.at(10,'search-started');f.at(20,'search-started')
  f.at(100,'target-found',{target:'driveway'});f.at(110,'target-found')
  f.at(200,'target-lost');f.at(220,'target-lost');f.at(250,'target-found')
  f.at(300,'target-lost');f.at(500,'target-found');f.at(510,'target-found')
  const s=r.snapshot()
  assert.equal(s.counts.rawFoundCallbacks,5)
  assert.equal(s.counts.foundTransitions,3)
  assert.equal(s.counts.lossTransitions,2)
  assert.equal(s.counts.duplicateFound,2)
  assert.equal(s.counts.duplicateLost,1)
  assert.equal(s.counts.duplicateLifecycle,1)
  assert.equal(s.summary['reacquisition'].completed.count,2)
  assert.equal(s.summary['reacquisition'].completed.totalMs,250)
  assert.equal(s.summary['reacquisition'].completed.meanMs,125)
  assert.deepEqual(plain(s.trials.map(t=>t.durationMs)),[90,50,200])
})

test('Render continuity and world validity never create raw tracking or acquisition success',()=>{
  const f=fixture(),r=f.recorder;f.start();f.at(10,'search-started')
  f.at(20,'render-visible');f.at(25,'world-tracking-valid',{worldTrackingValid:true})
  f.at(30,'quality-fallback',{quality:'low',reason:'observed frame-loop fallback'})
  let s=r.snapshot()
  assert.equal(s.rawTargetTracked,false);assert.equal(s.trials.length,0)
  assert.equal(s.events[1].channel,'rendered-continuity')
  assert.equal(s.events[2].channel,'world-tracking')
  assert.equal(s.pendingTrial.outcome,'incomplete')
  f.at(40,'target-found');f.at(50,'target-lost');f.at(60,'render-visible')
  f.at(70,'world-tracking-invalid');f.at(80,'render-hidden')
  s=r.snapshot();assert.equal(s.rawTargetTracked,false)
  assert.equal(s.summary['reacquisition'].completed.count,0)
  assert.equal(s.counts.qualityFallbacks,1)
  assert.equal(s.events.find(e=>e.type==='target-found').channel,'raw-target')
})

test('Pause censors initial search; paused callbacks cannot complete it; paused time excluded',()=>{
  const f=fixture(),r=f.recorder;f.start();f.at(10,'search-started')
  f.at(50,'tracking-paused');f.at(60,'tracking-paused')
  f.at(100,'target-found');f.at(150,'target-lost')
  f.at(300,'tracking-resumed');f.at(310,'tracking-resumed');f.at(350,'target-found')
  const s=r.snapshot()
  assert.equal(s.trials[0].outcome,'censored');assert.equal(s.trials[0].durationMs,40)
  assert.equal(s.trials[0].reason,'tracking-paused')
  assert.equal(s.trials[1].kind,'first-acquisition');assert.equal(s.trials[1].durationMs,50)
  assert.equal(s.summary['first-acquisition'].completed.count,1)
  assert.equal(s.summary['first-acquisition'].censored.count,1)
  assert.equal(s.excludedPausedMs,250);assert.equal(s.activeElapsedMs,100)
  assert.equal(s.counts.pausedTargetCallbacks,2);assert.equal(s.counts.duplicateLifecycle,2)
})

test('Pause after acquisition labels resumed window separately from actual loss reacquisition',()=>{
  const f=fixture(),r=f.recorder;f.start();f.at(0,'search-started');f.at(10,'target-found')
  f.at(20,'target-lost');f.at(30,'tracking-paused');f.at(100,'tracking-resumed')
  f.at(120,'target-found');f.at(150,'target-lost');f.at(180,'target-found')
  const s=r.snapshot()
  assert.equal(s.summary['reacquisition'].censored.count,1)
  assert.equal(s.summary['reacquisition'].censored.totalMs,10)
  assert.equal(s.summary['reacquisition'].completed.totalMs,30)
  assert.equal(s.summary['resume-acquisition'].completed.totalMs,20)
  assert.equal(s.counts.lossTransitions,2)
})

test('Stopped or cancelled search is censored, never a success; stop is idempotent',()=>{
  const f=fixture(),r=f.recorder;f.start();f.at(10,'search-started');f.time(35)
  const stopped=r.stop()
  assert.equal(stopped.status,'STOPPED');assert.equal(stopped.trials[0].outcome,'censored')
  assert.equal(stopped.trials[0].durationMs,25)
  assert.equal(stopped.summary['first-acquisition'].completed.count,0)
  f.time(1000);assert.equal(r.stop().elapsedMs,35)
  assert.equal(r.record('target-found'),false)
  assert.equal(r.snapshot().summary['first-acquisition'].completed.count,0)
  f.start();f.at(1010,'search-started');f.at(1020,'tracking-paused');f.time(1100)
  const pausedStop=r.stop()
  assert.equal(pausedStop.excludedPausedMs,80)
  assert.equal(pausedStop.activeElapsedMs,20)
  assert.equal(pausedStop.trials.length,1)
})

test('New session cancels old pending trial and resets all current measurements',()=>{
  const f=fixture(),r=f.recorder;f.start({build:'first'})
  f.at(10,'search-started');f.at(20,'target-found');f.at(30,'target-lost')
  f.time(100);assert(f.start({build:'next'}))
  let s=r.snapshot()
  assert.equal(s.session,2);assert.equal(s.metadata.build,'next')
  assert.equal(s.trials.length,0);assert.equal(s.events.length,0);assert.equal(s.pendingTrial,null)
  assert.equal(s.previousSession.replacedPendingTrial.kind,'reacquisition')
  assert.equal(s.previousSession.replacedPendingTrial.durationMs,70)
  assert.equal(s.previousSession.summary.reacquisition.censored.count,1)
  f.at(110,'search-started');f.at(120,'target-found');s=r.snapshot()
  assert.equal(s.trials[0].kind,'first-acquisition')
  assert.equal(s.summary['reacquisition'].completed.count,0)
  assert.equal(s.summary['first-acquisition'].completed.totalMs,10)
})

test('Overflow retains chronological bounded rings and unbiased whole-session aggregates',()=>{
  const f=fixture({capacity:3}),r=f.recorder;f.start();f.at(0,'search-started');f.at(10,'target-found')
  for(let i=0;i<10;i++) {
    f.at(20+i*20,'target-lost');f.at(21+i*20+i,'target-found')
  }
  const s=r.snapshot()
  assert.equal(s.capacity,3);assert.equal(s.events.length,3);assert.equal(s.trials.length,3)
  assert.equal(s.eventOverflow,19);assert.equal(s.trialOverflow,8)
  assert.deepEqual(plain(s.trials.map(t=>t.id)),[9,10,11])
  assert(s.events.every((event,i)=>!i || event.sequence>s.events[i-1].sequence))
  assert.equal(s.summary.reacquisition.completed.count,10)
  assert.equal(s.summary.reacquisition.completed.totalMs,55)
  assert.equal(s.summary.reacquisition.completed.meanMs,5.5)
  assert.equal(s.summary.reacquisition.completed.minMs,1)
  assert.equal(s.summary.reacquisition.completed.maxMs,10)
  assert(s.summary.scope.includes('All session trials'))
})

test('Invalid, nonfinite and late timestamps never mutate tracking trials',()=>{
  const f=fixture(),r=f.recorder;f.start();f.at(10,'search-started')
  for(const time of [NaN,Infinity,-Infinity,-1,9,'11'])assert.equal(f.at(time,'target-found'),false)
  f.time(10);let s=r.snapshot()
  assert.equal(s.rejected.invalidTime,6);assert.equal(s.trials.length,0)
  assert.equal(s.pendingTrial.durationMs,0)
  assert.equal(f.at(10,'target-found'),true,'Equal timestamps are valid simultaneous observations')
  f.at(20,'target-lost');f.time(19);assert.equal(r.stop(),false)
  f.time(20);s=r.snapshot();assert.equal(s.status,'ACTIVE')
  assert.equal(s.summary.reacquisition.completed.count,0)
  f.time(30);assert(r.stop())
  f.time(29);assert.equal(f.start(),false,'Clock cannot go backwards across session boundaries')
})

test('Throwing clock and invalid initial clock fail safely',()=>{
  let throwClock=true,time=NaN
  const r=createTrackingEventRecorder({now(){if(throwClock)throw Error('clock');return time}})
  assert.equal(r.begin(),false);assert.equal(r.snapshot().status,'NOT_STARTED')
  throwClock=false;assert.equal(r.begin(),false);time=0;assert(r.begin())
  throwClock=true;assert.equal(r.record('search-started'),false)
  throwClock=false;assert.equal(r.snapshot().rejected.invalidTime,1)
  assert.throws(()=>createTrackingEventRecorder({now:42}),/monotonic clock/)
})

test('Metadata, event detail, trials, summaries and prior-session snapshots are isolated',()=>{
  const f=fixture(),r=f.recorder
  const metadata={build:'hash',browser:{name:'Chrome',versions:[1,2]},target:'driveway',scanMedium:'screen'}
  f.start(metadata);metadata.browser.name='mutated';metadata.browser.versions[0]=99
  const detail={target:'driveway',reason:{nested:'original'},cameraFrame:[255,255],gps:{lat:2}}
  f.at(10,'search-started',detail);detail.reason.nested='mutated'
  f.at(20,'target-found');let s=r.snapshot()
  assert.equal(s.metadata.browser.name,'Chrome');assert.equal(s.metadata.browser.versions[0],1)
  assert.equal(s.events[0].detail.reason.nested,'original')
  assert.equal(s.events[0].detail.cameraFrame,undefined);assert.equal(s.events[0].detail.gps,undefined)
  s.metadata.browser.name='snapshot';s.events[0].detail.reason.nested='snapshot'
  s.trials[0].durationMs=999;s.summary['first-acquisition'].completed.totalMs=999
  s=r.snapshot();assert.equal(s.metadata.browser.name,'Chrome')
  assert.equal(s.events[0].detail.reason.nested,'original');assert.equal(s.trials[0].durationMs,10)
  assert.equal(s.summary['first-acquisition'].completed.totalMs,10)
  f.at(30,'target-lost');f.time(40);f.start();s=r.snapshot()
  s.previousSession.replacedPendingTrial.durationMs=999
  assert.equal(r.snapshot().previousSession.replacedPendingTrial.durationMs,10)
})

test('Foreign targets, unspecified searches and unknown event types do not invent timings',()=>{
  const f=fixture(),r=f.recorder;f.start({target:'driveway'})
  assert.equal(f.at(10,'target-found',{target:'garage'}),false)
  assert.equal(f.at(20,'made-up-event'),false)
  f.at(30,'target-found',{target:'driveway'});let s=r.snapshot()
  assert.equal(s.counts.unmeasuredFound,1);assert.equal(s.trials.length,0)
  assert.equal(s.rejected.targetMismatch,1);assert.equal(s.rejected.invalidType,1)
  assert.equal(s.events[0].classification,'found-without-search-window')
  f.at(40,'target-lost');f.at(50,'target-found');s=r.snapshot()
  assert.equal(s.summary['first-acquisition'].completed.count,0)
  assert.equal(s.summary.reacquisition.completed.totalMs,10)
})

test('Capacity default, minimum and hard maximum remain bounded',()=>{
  for(const [capacity,expected] of [[undefined,256],[NaN,256],[Infinity,256],[0,1],[-5,1],[3.8,3],[9999,2048]]) {
    const r=createTrackingEventRecorder({now:()=>0,capacity});r.begin()
    assert.equal(r.snapshot().capacity,expected)
  }
})

console.log(`PASS tracking event recorder: ${cases} cases; offline instrumentation only, not integrated or physical acceptance`)
