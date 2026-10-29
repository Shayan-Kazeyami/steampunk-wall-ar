'use strict'
// Real coordinator/UI; tracker/model/effect boundaries controlled, no native claim.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto')
const {harness}=require('./two-wall-coordinator.cjs')
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))}
const directory=path.resolve(__dirname,'../../Models/coverage-wave-2026-10-25/tracking')
const pair=id=>{const manifest=JSON.parse(fs.readFileSync(path.join(directory,id,'target-manifest.json'),'utf8')),file=path.join(directory,id,manifest.compiledJsonPath),compiledTarget=JSON.parse(fs.readFileSync(file,'utf8'));return {manifest,compiledTarget,targetHash:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),luminanceHash:createHash('sha256').update(fs.readFileSync(path.join(path.dirname(file),compiledTarget.resources.luminanceImage))).digest('hex')}}
const centre=pair('centre'),left=pair('left'),right=pair('right')
const config={schemaVersion:1,worldTracking:false,variant:'COV-three',disableColorMatch:true,target:centre,coverageTargets:[left,right],bundleHash:'b'.repeat(64),coverageManifestHash:'a'.repeat(64)}
async function main(){
 const h=harness({pageUrl:'https://test.invalid/Models/coverage-wave-2026-10-25/tracking/runtime/coverage.html?measure=1',trialConfig:config})
 try{
  await flush();h.click('start');await flush()
  assert.equal(h.trackerOptions.manifest.compiledTargetName,centre.manifest.compiledTargetName)
  assert.equal(h.trackerOptions.coverageTargets.length,2)
  const root=h.track('driveway'),effect=h.effect('driveway'),object=effect.object3D
  h.click('sound');await flush();h.click('overdrive')
  assert(effect.state.sound&&effect.state.boost)
  h.trackerOptions.onState({state:'tracked',root,manifest:left.manifest,resumed:true,coverageHandoff:true})
  h.observe('coverage-handoff',{target:left.manifest.compiledTargetName,previousTarget:centre.manifest.compiledTargetName,reason:'native-reference-loss-or-staleness'})
  assert.equal(h.mode(),'tracked');assert.equal(h.effect('driveway'),effect);assert.equal(object.parent,root)
  assert(effect.state.sound&&effect.state.boost,'Same-root same-wall handoff does not park/reset effects')
  assert.equal(h.downloads,1,'Aliases do not load another model');assert.equal(h.starts,1,'Aliases use one camera start')
  assert.equal(effect.state.light,'studio','All private coverage references use identical studio lighting')
  let snapshot=h.window.__steampunkFieldSession.snapshot().trackingTrials
  for(const target of [centre,left,right])assert(snapshot.targets[target.manifest.compiledTargetName],'Every reference gets its own raw recorder')
  assert.equal(snapshot.targets[left.manifest.compiledTargetName].counts.rawFoundCallbacks,0,'Rendered handoff cannot invent native acquisition')
  const leftSnapshot=snapshot.targets[left.manifest.compiledTargetName]
  assert.equal(leftSnapshot.rejected.invalidType,0)
  assert.equal(leftSnapshot.counts.coverageHandoffs,1)
  const handoff=leftSnapshot.events.find(event=>event.type==='coverage-handoff')
  assert.equal(handoff.channel,'reference-handoff')
  assert.equal(handoff.detail.previousTarget,centre.manifest.compiledTargetName)
  h.observe('target-found',{target:left.manifest.compiledTargetName})
  snapshot=h.window.__steampunkFieldSession.snapshot().trackingTrials
  assert.equal(snapshot.targets[left.manifest.compiledTargetName].counts.rawFoundCallbacks,1)
  assert.equal(snapshot.targets[right.manifest.compiledTargetName].counts.rawFoundCallbacks,0)
  h.lost(true);assert.equal(effect.state.suspensions,1);assert(!effect.state.sound&&!effect.state.boost)
  h.trackerOptions.onState({state:'tracked',root,manifest:right.manifest,resumed:true,coverageHandoff:true})
  assert.equal(object.parent,root);assert(effect.state.tracked);assert.equal(h.downloads,1)
  h.click('stop');await flush();assert.equal(h.mode(),'landing');assert.equal(effect.state.disposals,0)
 }finally{await h.close();assert.equal(h.effect('driveway').state.disposals,1)}
 const publicPage=harness({pageUrl:'https://test.invalid/ar/?coverage=1',trialConfig:config})
 try{await flush();assert.equal(publicPage.trackerOptions.coverageTargets.length,0,'Private injection does not affect normal/public route')}
 finally{await publicPage.close()}
 console.log('PASS coverage coordinator: private route gate, primary/aliases, shared effects/model/camera, phase/audio/boost continuity, studio isolation, per-reference raw recorders, no recognition invented from rendered handoff, transient loss/Stop/disposal. Controlled boundaries; no native camera claim.')
}
main().catch(error=>{console.error(error);process.exitCode=1})
