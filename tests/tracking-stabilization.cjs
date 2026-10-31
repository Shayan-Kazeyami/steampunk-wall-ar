'use strict'
// Real Three world transforms; camera poses/events are deterministic doubles.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..'),file=path.join(__dirname,'two-wall-tracking.cjs')
const fixtureCode=fs.readFileSync(file,'utf8').split('async function run(){')[0]+'\nmodule.exports={fixture,driveway,garage,THREE}'
const context={require:require('node:module').createRequire(file),__dirname,module:{exports:{}},console,URLSearchParams,AbortController,setTimeout,clearTimeout,setInterval,clearInterval}
vm.createContext(context);vm.runInContext(fixtureCode,context)
const {fixture,driveway,garage,THREE}=context.module.exports
function timers(){
  let next=0;const pending=new Map()
  return {setTimeout(fn,ms){if(ms!==150)return setTimeout(fn,ms);const key={loss:++next};pending.set(key,fn);return key},
    clearTimeout(key){if(key?.loss)pending.delete(key);else clearTimeout(key)},
    get size(){return pending.size},take(){const out=[...pending.values()];pending.clear();return out},fire(){for(const fn of this.take())fn()}}
}
async function main(){
  const h=fixture()
  try{
    await h.tracker.start();h.geometry(driveway);h.found(driveway)
    const content=h.states.at(-1).root,native=h.target(driveway).object3D,anchor=content.parent
    assert.equal(anchor.parent,h.scene.object3D,'Render anchor belongs to scene, outside native pose branch')
    assert.notEqual(anchor,native)
    const rawPanel=native.children.find(child=>child.name==='raw-panel-reference-driveway-sign')
    assert(rawPanel && rawPanel!==content,'Native branch contains separate empty raw panel reference')
    h.tracker.update(0,16)
    native.position.x=.003;native.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),.005)
    const rawPosition=native.position.clone(),rawRotation=native.quaternion.clone()
    h.tracker.update(16,16)
    assert(anchor.position.x>0 && anchor.position.x<.003,'Small target jitter is filtered')
    assert(native.position.equals(rawPosition) && native.quaternion.equals(rawRotation),'Native raw pose is untouched')
    assert(anchor.position.distanceTo(native.position)<=.015+1e-10)
    assert(anchor.quaternion.angleTo(native.quaternion)<=Math.PI/120+1e-10)
    native.position.x=.4;h.tracker.update(32,16)
    assert(Math.abs(anchor.position.x-.4)<1e-10,'Large genuine discontinuity snaps without drifting through intermediate space')
    native.scale.setScalar(1.3);h.tracker.update(48,16)
    assert(Math.abs(anchor.scale.x-1.3)<1e-10,'Large scale change snaps')
    h.geometry(garage);h.target(garage).object3D.position.set(-.8,.2,.1);h.found(garage)
    const other=h.states.at(-1).root
    assert(!content.visible && !anchor.visible)
    assert.equal(other.parent.parent,h.scene.object3D)
    assert(Math.abs(other.parent.position.x+.8)<1e-10,'Wall handoff starts from its own raw pose')
    h.lost(garage);assert(!other.visible && !other.parent.visible,'Loss immediately removes uncertain render anchor')
  }finally{await h.close();assert.equal(h.scene.object3D.children.length,0,'Disposal releases all scene-owned anchors')}
  const clock=timers(),transient=fixture(garage,clock,{transientLossMs:150})
  try{
    await transient.tracker.start();transient.geometry(driveway);transient.found(driveway)
    const root=transient.states.at(-1).root
    transient.lost(driveway)
    assert.equal(transient.states.at(-1).state,'lost');assert.equal(transient.states.at(-1).transient,true)
    assert(!root.visible && !root.parent.visible,'Debounce never leaves floating content visible')
    assert.equal(transient.tracker.getDiagnostics().state,'lost','Diagnostics report genuine loss immediately')
    assert.equal(clock.size,1)
    transient.found(driveway)
    assert.equal(transient.states.at(-1).resumed,true);assert.equal(clock.size,0)
    transient.lost(driveway);clock.fire()
    assert.equal(transient.states.at(-1).state,'lost');assert.equal(transient.states.at(-1).transient,false)
    transient.found(driveway);assert.equal(transient.states.at(-1).resumed,false,'Expired loss cannot resume paused phase')
    transient.lost(driveway);const stale=clock.take();await transient.tracker.stop()
    const count=transient.states.length;for(const fn of stale)fn()
    assert.equal(transient.states.length,count,'Stop invalidates already queued loss commitment')
  }finally{await transient.close()}
  console.log('PASS tracking stabilization: separate real world parents, untouched raw poses, adaptive/bounded follow, discontinuity/handoff reset, immediate hidden genuine loss, opt-in150ms resume/commit and timer cancellation. Phone stability not measured.')
}
main().catch(error=>{console.error(error);process.exitCode=1})
