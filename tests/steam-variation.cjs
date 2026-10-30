'use strict'
// Independent Three r158 particle/lifecycle checks, without WebGL or phone claims.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
const source=fs.readFileSync(path.join(__dirname,'../src/full-wall/runtime/machine-effects.js'),'utf8')
const context={};vm.createContext(context)
vm.runInContext(source.replace('export const createMachineEffects','const createMachineEffects')+'\nglobalThis.create=createMachineEffects',context)
const run={running:true,tracked:true,reducedMotion:false,overdrive:false,elapsed:1}
function fixture({outlets=4,count=96}={}){
  const model=new THREE.Group();model.position.set(12,-7,4);model.rotation.set(.1,.4,.2);model.scale.setScalar(1.8)
  const wall=new THREE.Mesh(new THREE.BoxGeometry(1,1,.04),new THREE.MeshStandardMaterial());model.add(wall)
  const anchors=[]
  for(let i=0;i<outlets;i++){
    const parent=new THREE.Group();parent.position.set(i%2?.3:-.3,i<2?-.2:.2,.08);parent.rotation.z=i%2?Math.PI/2:0
    const outlet=new THREE.Group();outlet.userData={animation_role:'steam_outlet',steam_direction:[1,0,.1]};parent.add(outlet);model.add(parent);anchors.push(parent.position.clone())
  }
  const effect=context.create({THREE,model,particleCount:count})
  return{model,wall,anchors,effect,close(){effect.dispose();wall.geometry.dispose();wall.material.dispose()}}
}
function attributes(effect){return effect.steam.geometry.attributes}
function frame(effect,delta,overdrive=false){effect.update(delta,0,{...run,overdrive})}
function particles(effect){const a=attributes(effect),result=[];for(let i=0;i<a.puffSize.count;i++)if(a.puffAlpha.array[i]>.00001)result.push({i,p:Array.from(a.position.array.slice(i*3,i*3+3)),size:a.puffSize.array[i],alpha:a.puffAlpha.array[i]});return result}
function validate(effect){
  const a=attributes(effect),d=effect.getDiagnostics()
  assert(d.activeParticles>=0&&d.activeParticles<=96,'Pool stays inside fixed mobile budget')
  assert(a.position.array.every(Number.isFinite));assert(a.puffSize.array.every(value=>Number.isFinite(value)&&value>=0))
  assert(a.puffAlpha.array.every(value=>Number.isFinite(value)&&value>=0&&value<=.4),'Steam stays translucent')
  assert(effect.steam.geometry.drawRange.count<=96)
}

// Tagged outlet positions remain model-local despite translation/rotation/scale.
{
  const h=fixture();try{
    frame(h.effect,16,true);const p=particles(h.effect);assert(p.length>0,'Overload produces a prompt source-mounted release')
    assert(p.every(puff=>h.anchors.some(anchor=>new THREE.Vector3(...puff.p).distanceTo(anchor)<.07)),'New puffs originate at real tagged joints')
    assert(p.every(puff=>puff.p.every(value=>Math.abs(value)<1)),'World transform is not applied twice to particle positions')
    const profiles=h.effect.getDiagnostics().steamProfiles
    assert.equal(new Set(profiles).size,4,'Four source joints receive distinct release profiles')
    validate(h.effect)
  }finally{h.close()}
}

// Meaningful changing clouds: varied sizes/opacity and curved trajectory, stable pools.
{
  const h=fixture();try{
    const a=attributes(h.effect),buffers=Object.fromEntries(Object.entries(a).map(([name,attribute])=>[name,attribute.array]))
    let variedSize=false,variedOpacity=false,offAxis=false,emittingStates=new Set()
    for(let i=0;i<650;i++){
      frame(h.effect,20,i>=350);validate(h.effect)
      const p=particles(h.effect)
      if(new Set(p.map(puff=>Math.round(puff.size*100000))).size>4)variedSize=true
      if(new Set(p.map(puff=>Math.round(puff.alpha*100000))).size>4)variedOpacity=true
      if(p.some(puff=>h.anchors.every(anchor=>Math.abs(puff.p[2]-anchor.z)>.0005)))offAxis=true
      emittingStates.add(h.effect.getDiagnostics().emittingOutlets)
    }
    assert(variedSize&&variedOpacity,'Cloud puffs vary beyond one uniform size and opacity')
    assert(offAxis,'Release trajectories develop depth instead of a flat static sprite column')
    assert(emittingStates.size>1,'Idle release duty cycles vary over time')
    for(const [name,array]of Object.entries(buffers))assert.equal(attributes(h.effect)[name].array,array,'No particle buffer reallocation: '+name)
    assert(h.effect.getDiagnostics().emittedParticles>100,'Pool recycles during sustained activity')
  }finally{h.close()}
}

// Boost produces more release activity than idle over a complete multi-profile cycle.
{
  const idle=fixture(),boost=fixture();try{
    let idleOccupancy=0,boostOccupancy=0
    for(let i=0;i<500;i++){
      frame(idle.effect,20);frame(boost.effect,20,true)
      idleOccupancy+=idle.effect.state.activeParticles;boostOccupancy+=boost.effect.state.activeParticles
    }
    assert(boostOccupancy>idleOccupancy*1.1,'Overload visibly raises cloud density')
    assert(boost.effect.getDiagnostics().emittedParticles>idle.effect.getDiagnostics().emittedParticles,'Overload increases emission, not only stale-particle visibility')
  }finally{idle.close();boost.close()}
}

// Reset is deterministic; disabled/reduced/lost/paused states clear every visible puff.
{
  const h=fixture();try{
    const sample=()=>{for(let i=0;i<25;i++)frame(h.effect,20,true);return Object.fromEntries(Object.entries(attributes(h.effect)).map(([name,a])=>[name,Array.from(a.array)]))}
    const first=sample();h.effect.reset();assert.equal(h.effect.getDiagnostics().emittedParticles,0)
    assert.deepEqual(sample(),first,'Reset clears pool cursor/seed state and reproduces deterministic release')
    h.effect.setSteamEnabled(false);assert.equal(h.effect.steam.visible,false);assert.equal(h.effect.state.activeParticles,0)
    for(let i=0;i<20;i++)frame(h.effect,20,true)
    assert.equal(h.effect.state.activeParticles,0,'Disabled steam cannot emit on a boost transition')
    h.effect.setSteamEnabled(true)
    for(const paused of [{tracked:false},{reducedMotion:true},{running:false,elapsed:0},{running:false,elapsed:1}]){
      frame(h.effect,100,true);h.effect.update(20,0,{...run,overdrive:true,...paused})
      assert.equal(h.effect.steam.visible,false);assert.equal(h.effect.state.activeParticles,0);assert.equal(h.effect.steam.geometry.drawRange.count,0)
    }
    const a=attributes(h.effect),before=Array.from(a.position.array);h.effect.update(NaN,0,run);validate(h.effect)
    assert.deepEqual(Array.from(a.position.array),before,'Invalid delta does not advance particle positions')
    let geometryDisposed=0,materialDisposed=0
    h.effect.steam.geometry.addEventListener('dispose',()=>geometryDisposed++);h.effect.steam.material.addEventListener('dispose',()=>materialDisposed++)
    h.effect.dispose();h.effect.dispose();frame(h.effect,100,true)
    assert.equal(geometryDisposed,1);assert.equal(materialDisposed,1);assert.equal(h.effect.steam.parent,null)
  }finally{h.close()}
}

// Large frame gaps use the same bounded simulation step; untagged walls emit nothing.
{
  const a=fixture(),b=fixture(),bare=fixture({outlets:0});try{
    frame(a.effect,100,true);frame(b.effect,60000,true)
    for(const name of Object.keys(attributes(a.effect)))assert.deepEqual(Array.from(attributes(a.effect)[name].array),Array.from(attributes(b.effect)[name].array),'Long-gap clamp preserves bounded particle step: '+name)
    for(let i=0;i<100;i++)frame(bare.effect,20,true)
    assert.equal(bare.effect.getDiagnostics().outletCount,0);assert.equal(bare.effect.state.activeParticles,0)
  }finally{a.close();b.close();bare.close()}
}
// Isolate the third outlet by subtracting identical first/second-outlet fixtures.
// A double pulse must produce actual separated emission groups, not merely carry a name.
{
  const three=fixture({outlets:3}),two=fixture({outlets:2});try{
    let previous=0;const times=[]
    for(let i=1;i<=1000;i++){
      frame(three.effect,10);frame(two.effect,10)
      const total=three.effect.getDiagnostics().emittedParticles-two.effect.getDiagnostics().emittedParticles
      assert(total>=previous)
      if(total>previous)times.push(i*.01)
      previous=total
    }
    const releases=[]
    for(const time of times){if(!releases.length||time-releases.at(-1).at(-1)>.9)releases.push([]);releases.at(-1).push(time)}
    assert(releases.some(release=>release.length>=8&&release.some((time,i)=>i>=3&&release.length-i>=3&&time-release[i-1]>.15&&time-release[i-1]<.5)),
      'A complete release has two real dense emission groups separated by a quiet middle')
  }finally{three.close();two.close()}
}

// Independent gear mechanics: source radii, not runtime drive metadata, determine
// pitch-line displacement. Source phases deliberately start at nonzero angles.
{
  const animationContext={};vm.createContext(animationContext)
  const animationSource=fs.readFileSync(path.join(__dirname,'../src/full-wall/runtime/animation-runtime.js'),'utf8')
  vm.runInContext(animationSource.replace('export const createWallAnimation','const createWallAnimation')+'\nglobalThis.create=createWallAnimation',animationContext)
  function gears(){
    const model=new THREE.Group(),fixed=new THREE.Mesh(new THREE.BoxGeometry(1,1,.02),new THREE.MeshStandardMaterial())
    fixed.position.set(.1,-.1,-.1);fixed.rotation.set(.1,.2,.3);model.add(fixed)
    const parts=[]
    for(const [radius,x,phase] of [[.12,-.12,Math.PI/2],[.24,.24,Math.PI]]){
      const object=new THREE.Group();object.name='source_gear_'+radius;object.position.set(x,0,.05);object.rotation.z=phase;object.userData.animation_role='gear'
      const geometry=new THREE.CylinderGeometry(radius,radius,.02,128);geometry.rotateX(Math.PI/2)
      object.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()));model.add(object);parts.push(object)
    }
    const bases=parts.map(object=>object.quaternion.clone()),fixedPose={position:fixed.position.clone(),quaternion:fixed.quaternion.clone(),scale:fixed.scale.clone()}
    const animation=animationContext.create({THREE,model});animation.setSteamEnabled(false);animation.setRunning(true);animation.setTracked(true)
    return{model,fixed,fixedPose,parts,bases,animation,close(){animation.dispose();model.traverse(o=>{o.geometry?.dispose();o.material?.dispose()})}}
  }
  const angle=(from,to)=>{const delta=from.clone().invert().multiply(to);return 2*Math.atan2(delta.z,delta.w)}
  const idle=gears(),boost=gears()
  try{
    assert.equal(idle.animation.state.gearContacts.length,1,'Fixture is one real touching pair')
    assert.equal(idle.animation.state.gearComponents.length,1)
    assert.equal(idle.animation.state.gearConflicts.length,0)
    let previous=idle.parts.map(object=>object.quaternion.clone()),now=0;const speeds=[]
    for(const delta of [16,25,60,100,33,40,80,20,70,90,50,100]){
      now+=delta;idle.animation.update(delta,now)
      const movement=idle.parts.map((object,i)=>angle(previous[i],object.quaternion))
      assert(movement[0]*movement[1]<0,'Touching gears counter-rotate at each variable-cadence step')
      assert(Math.abs(movement[0]*.12+movement[1]*.24)<1e-7,'Equal/opposite pitch-line travel under shared cadence')
      speeds.push(Math.abs(movement[0])/delta*1000)
      previous=idle.parts.map(object=>object.quaternion.clone())
    }
    assert(Math.max(...speeds)-Math.min(...speeds)>.005,'Cadence genuinely varies rather than remaining a fixed angular speed')
    assert(idle.fixed.position.equals(idle.fixedPose.position));assert(idle.fixed.quaternion.equals(idle.fixedPose.quaternion));assert(idle.fixed.scale.equals(idle.fixedPose.scale),'Fixed source wall remains unchanged')
    idle.animation.reset();boost.animation.reset();assert(boost.animation.triggerOverdrive(0))
    let idleTravel=0,boostTravel=0,lastIdle=idle.parts[0].quaternion.clone(),lastBoost=boost.parts[0].quaternion.clone()
    for(let i=1;i<=30;i++){
      idle.animation.update(20,i*20);boost.animation.update(20,i*20)
      idleTravel+=Math.abs(angle(lastIdle,idle.parts[0].quaternion));boostTravel+=Math.abs(angle(lastBoost,boost.parts[0].quaternion))
      lastIdle=idle.parts[0].quaternion.clone();lastBoost=boost.parts[0].quaternion.clone()
    }
    assert(boostTravel>idleTravel*2,'Overload visibly speeds the same gear train')
    const restored=()=>idle.parts.forEach((object,i)=>assert(object.quaternion.angleTo(idle.bases[i])<1e-7,'Source gear phase restored'))
    idle.animation.reset();restored()
    idle.animation.update(50,1000);idle.animation.setReducedMotion(true);restored();assert(!idle.animation.triggerOverdrive(1000))
    idle.animation.update(100,1100);restored();idle.animation.setReducedMotion(false)
    idle.animation.update(50,1200);idle.animation.setTracked(false);restored();idle.animation.update(100,1300);restored()
    idle.animation.setTracked(true);idle.animation.update(50,1400);idle.animation.setRunning(false);restored()
  }finally{idle.close();boost.close()}
}
console.log('PASS steam/gear variation: source joint clouds, real double pulses, varied duty/boost, fixed pools/lifecycle, touching gears equal/opposite pitch travel with variable cadence, source phases restored; no GPU/phone claim')
