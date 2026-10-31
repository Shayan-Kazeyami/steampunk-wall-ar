'use strict'
const assert=require('node:assert/strict'),{harness}=require('./two-wall-coordinator.cjs')
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))}
const target='steampunk-driveway-sign',sample=h=>h.window.__steampunkFieldSession.snapshot().trackingTrials.targets[target]
async function main(){
 const h=harness();try{
  await flush();assert.equal(sample(h).status,'NOT_STARTED');h.click('start');await flush();assert.equal(h.trackerOptions.worldTracking,false)
  h.observe('camera-ready');h.observe('search-started');h.tick(100);h.observe('target-found',{target});h.track('driveway')
  h.tick(50);h.observe('target-lost',{target});h.observe('target-lost',{target});h.lost(true);h.tick(80);h.observe('target-found',{target});h.track('driveway')
  const s=sample(h);assert.equal(s.counts.rawLostCallbacks,2);assert.equal(s.counts.lossTransitions,1);assert.equal(s.counts.duplicateLost,1);assert.equal(s.summary.reacquisition.completed.count,1)
  assert.equal(s.summary.reacquisition.completed.totalMs,80);assert(s.events.some(e=>e.type==='render-hidden'));assert(s.events.some(e=>e.type==='render-visible'))
  h.click('stop');await flush();assert.equal(sample(h).status,'PAUSED','Stop request alone cannot certify camera shutdown');h.observe('tracking-stopped',{reason:'confirmed-test-stop'});assert.equal(sample(h).status,'STOPPED');assert.equal(sample(h).events.filter(e=>e.channel==='rendered-continuity').at(-1).type,'render-hidden')
  assert.deepEqual(JSON.parse(h.window.__steampunkFieldSession.exportJSON()).trackingTrials.targets[target].counts,JSON.parse(JSON.stringify(sample(h).counts)))
  h.options.onPreviewWall('driveway');await flush();assert.equal(sample(h).summary.reacquisition.completed.count,1,'Preview cannot count as recognition')
 }finally{await h.close()}
 const p=harness({pendingModel:true});try{
  p.click('start');await flush();assert.equal(sample(p).status,'ACTIVE');p.progress({phase:'download',status:'loading',loadedBytes:2,totalBytes:4});assert(!p.document.querySelector('.steampunk-ui__loading-progress').hidden)
  p.click('cancel');await flush();assert.equal(sample(p).status,'PAUSED','Cancel request censors acquisition without claiming engine shutdown');p.progress({phase:'decode',status:'loading'});assert(p.document.querySelector('.steampunk-ui__loading-progress').hidden)
  p.lateModel();await flush();assert.equal(p.mode(),'landing');assert.equal(p.starts,0)
 }finally{await p.close()}
 for(const [url,expected]of [['https://test.invalid/ar/?trial=world',false],['https://test.invalid/Models/driveway-target-trials/runtime/world.html',true]]){
  const t=harness({pageUrl:url,trialConfig:{schemaVersion:1,worldTracking:true,variant:'B0',bundleHash:'test'}});try{await flush();t.click('start');await flush();assert.equal(t.trackerOptions.worldTracking,expected);assert.equal(sample(t).metadata.engineMode,expected?'image-plus-world':'image-only');
    assert.equal(t.tick().worldSnow?.visible || false,false)
    t.worldPose(true);assert.equal(t.tick().worldSnow?.visible || false,expected)
    if(expected){t.options.onReducedMotionChange(true);assert.equal(t.tick().worldSnow.visible,false);t.options.onReducedMotionChange(false);assert.equal(t.tick().worldSnow.visible,true);t.worldPose(false);assert.equal(t.tick().worldSnow.visible,false);t.options.onStop();await flush();assert.equal(t.tick().worldSnow.visible,false)}
  }finally{await t.close()}
 }
 console.log('PASS coordinator raw/export/cancelled-preload/private-mode boundaries; XR controlled')
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
