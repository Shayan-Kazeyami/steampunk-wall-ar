const assert=require('node:assert/strict')

module.exports=async function fullWallEffects({load,THREE}) {
  const factories={}
  for(const [file,name] of [['animation-runtime','createWallAnimation'],['machine-effects','createMachineEffects'],['experience-polish','createExperiencePolish'],['environment-lighting','createEnvironmentLighting'],['connector-appearance','applyConnectorAppearance']]){
    factories[name]=load(`src/full-wall/runtime/${file}.js`,[name])[name]
  }
  const {createFullWallEffects}=load('src/full-wall/index.js',['createFullWallEffects'],factories)
  const listeners=new Map()
  const document={hidden:false,addEventListener(type,cb){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(cb)},
    removeEventListener(type,cb){listeners.get(type)?.delete(cb)}}
  let created=0,closed=0,stopped=0,resolveResume
  class Param {setTargetAtTime(){}cancelScheduledValues(){}setValueAtTime(){}exponentialRampToValueAtTime(){}}
  class Node {constructor(){this.gain=new Param();this.frequency=new Param();this.Q=new Param()}connect(){}start(){}stop(){stopped++}}
  class Audio {
    constructor(){created++;this.sampleRate=8000;this.currentTime=1;this.destination={}}
    createGain(){return new Node()}createOscillator(){return new Node()}createBufferSource(){return new Node()}createBiquadFilter(){return new Node()}
    createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)}}
    resume(){return Audio.defer?new Promise(resolve=>resolveResume=resolve):Promise.resolve()}
    close(){closed++;return Promise.resolve()}
  }
  const model=new THREE.Group(),atlas=new THREE.Texture(),shared=new THREE.MeshStandardMaterial({map:atlas}),geometry=new THREE.BoxGeometry(.1,.1,.02)
  const gear=new THREE.Mesh(geometry,shared);gear.name='gear';gear.userData.animation_role='gear';model.add(gear)
  const fixed=new THREE.Mesh(geometry,shared);fixed.position.set(.3,0,0);model.add(fixed)
  const lamp=new THREE.Mesh(geometry,shared);lamp.userData.animation_role='lamp';model.add(lamp)
  const backingMaterial=new THREE.MeshBasicMaterial({map:atlas})
  const backing=new THREE.Mesh(new THREE.PlaneGeometry(1,.44),backingMaterial);backing.position.z=-.05;model.add(backing)
  const outlet=new THREE.Object3D();outlet.userData.animation_role='steam_outlet';model.add(outlet)
  const sceneEl={object3D:new THREE.Scene(),renderer:{toneMapping:THREE.NoToneMapping,toneMappingExposure:1}}
  let environmentDisposed=0,environmentOptions,clock=0
  const soundEvents=[]
  const fx=createFullWallEffects({THREE,model,sceneEl,document,AudioContext:Audio,environmentUrl:'fixture.hdr',now:()=>clock,
    onSoundState:state=>soundEvents.push(state),factories:{createEnvironmentLighting(options){environmentOptions=options;return {state:{status:'ready'},ready:Promise.resolve({status:'ready'}),dispose(){environmentDisposed++}}}}})
  sceneEl.object3D.add(fx.object3D)
  await fx.ready
  assert.equal(environmentOptions.renderer,sceneEl.renderer,'uses existing renderer')
  assert.equal(environmentOptions.scene,sceneEl.object3D)
  assert.equal(shared.envMapIntensity,.72,'environment intensity applies directly even if model was not attached at initialization')
  assert.equal(backingMaterial.toneMapped,false,'beauty backing avoids a second tone mapping pass')
  fx.setLightingMode('camera');fx.setCameraLighting({source:'camera-rgb',gain:1.5,color:[1.15,1,.8]})
  for(clock=0;clock<2000;clock+=20)fx.update({deltaMs:20,nowMs:clock})
  assert(shared.envMapIntensity>.7,'Camera brightness modulates foreground environment')
  assert.equal(backingMaterial.color.r,backingMaterial.color.b,'Raw camera tint must not recolour authored baked artwork')
  fx.setLightingMode('studio')
  assert.equal(shared.envMapIntensity,.72,'Studio preview restores authored lighting')
  assert.equal(backingMaterial.color.r,backingMaterial.color.b)
  assert.deepEqual(model.rotation.toArray(),[0,0,0,'XYZ'],'normalized source front orientation preserved')
  assert.equal(fx.object3D.visible,false)
  assert.equal(await fx.setSoundEnabled(true),false,'untracked cannot start sound')
  assert.equal(created,0)
  fx.setTracked(true)
  const fixedQuaternion=fixed.quaternion.clone()
  for(clock=0;clock<=1500;clock+=20)fx.update({deltaMs:20,nowMs:clock})
  assert(!gear.quaternion.equals(new THREE.Quaternion()))
  assert(fixed.quaternion.equals(fixedQuaternion),'fixed assembly stays fixed')
  assert(fx.getDiagnostics().machine.activeParticles>0,'source outlet emits pooled steam')
  assert.equal(created,0,'render updates never create sound')
  fx.setSteamEnabled(false)
  assert.equal(fx.getDiagnostics().machine.activeParticles,0)
  fx.update({deltaMs:20,nowMs:clock})
  assert.equal(fx.getDiagnostics().machine.activeParticles,0,'steam remains off')
  assert(fx.getDiagnostics().machine.pressure>0,'gauges continue with steam disabled')
  fx.setOverdrive(true);assert.equal(fx.getDiagnostics().overdrive,true)
  clock+=3000;fx.update({deltaMs:20,nowMs:clock});assert.equal(fx.getDiagnostics().overdrive,false)
  fx.setOverdrive(true);fx.setOverdrive(false);assert.equal(fx.getDiagnostics().overdrive,false)
  assert.equal(await fx.setSoundEnabled(true),true)
  assert.equal(created,1)
  fx.reset()
  assert.equal(fx.getDiagnostics().tracked,true,'Reset retains tracking state')
  assert.equal(fx.soundEnabled,false,'Reset closes sound')
  assert(gear.quaternion.equals(new THREE.Quaternion()))
  fx.update({deltaMs:20,nowMs:clock+20})
  assert(!gear.quaternion.equals(new THREE.Quaternion()),'Reset retains running state')
  await fx.setSoundEnabled(true)
  fx.setTracked(false)
  assert.equal(fx.soundEnabled,false)
  assert.equal(closed,2)
  assert.equal(stopped,8)
  assert.equal(fx.object3D.visible,false)
  assert(gear.quaternion.equals(new THREE.Quaternion()),'tracking loss restores pose')
  fx.setTracked(true);fx.update({deltaMs:20,nowMs:clock+20})
  assert.equal(created,2,'reacquisition never automatically recreates sound')
  for(let i=0;i<150;i++){clock+=20;fx.update({deltaMs:20,nowMs:clock})}
  const suspendedPose=gear.quaternion.clone(),suspendedStartup=fx.getDiagnostics().startup,suspendedPressure=fx.getDiagnostics().machine.pressure
  await fx.setSoundEnabled(true);fx.setOverdrive(true)
  assert.equal(fx.suspendTracking(),true,'Tracked machine can enter bounded transient suspension')
  assert.equal(fx.getDiagnostics().tracked,false);assert.equal(fx.getDiagnostics().trackingSuspended,true)
  assert.equal(fx.object3D.visible,false,'Transient loss hides uncertain placement immediately')
  assert.equal(fx.soundEnabled,false);assert.equal(fx.getDiagnostics().overdrive,false);assert.equal(fx.getDiagnostics().machine.activeParticles,0)
  assert.equal(await fx.setSoundEnabled(true),false,'No audio activation while suspended')
  assert.equal(fx.interact('release'),false)
  clock+=100;fx.setTracked(true)
  assert.equal(fx.getDiagnostics().trackingSuspended,false);assert.equal(fx.getDiagnostics().startup,suspendedStartup)
  assert.equal(fx.getDiagnostics().machine.pressure,suspendedPressure,'Brief recovery preserves machine state')
  assert(gear.quaternion.equals(suspendedPose),'Brief recovery does not snap source gears to authored phase')
  assert.equal(fx.soundEnabled,false,'Audio remains opt-in after recovery')
  fx.update({deltaMs:20,nowMs:clock});assert(!gear.quaternion.equals(suspendedPose),'Recovered machine resumes rather than freezes')
  fx.suspendTracking();fx.setTracked(false)
  assert.equal(fx.getDiagnostics().trackingSuspended,false);assert.equal(fx.getDiagnostics().startup,0)
  assert(gear.quaternion.equals(new THREE.Quaternion()),'Committed loss fully resets source phase')
  assert.equal(fx.suspendTracking(),false,'A fully stopped machine cannot claim preserved phase')
  fx.setTracked(true)
  fx.setReducedMotion(true);fx.setOverdrive(true);fx.update({deltaMs:20,nowMs:clock+40})
  assert(gear.quaternion.equals(new THREE.Quaternion()))
  assert.equal(fx.getDiagnostics().overdrive,false)
  assert.equal(fx.getDiagnostics().machine.activeParticles,0)
  fx.setReducedMotion(false)
  await fx.setSoundEnabled(true)
  document.hidden=true
  for(const callback of [...listeners.get('visibilitychange')])callback()
  assert.equal(fx.soundEnabled,false)
  assert.equal(fx.getDiagnostics().tracked,false)
  document.hidden=false;fx.setTracked(true)
  Audio.defer=true
  const pendingSuspensionSound=fx.setSoundEnabled(true)
  fx.suspendTracking();resolveResume()
  assert.equal(await pendingSuspensionSound,false,'Transient suspension cancels in-flight sound activation')
  fx.setTracked(true);assert.equal(fx.soundEnabled,false)
  fx.setSteamEnabled(false);fx.suspendTracking();fx.setTracked(true)
  fx.update({deltaMs:20,nowMs:clock+60})
  assert.equal(fx.getDiagnostics().machine.activeParticles,0,'Transient recovery preserves a disabled-steam preference')
  fx.setSteamEnabled(true)
  const pending=fx.setSoundEnabled(true)
  let geometryDisposals=0,textureDisposals=0,materialDisposals=0
  geometry.addEventListener('dispose',()=>geometryDisposals++)
  atlas.addEventListener('dispose',()=>textureDisposals++)
  shared.addEventListener('dispose',()=>materialDisposals++)
  fx.dispose();fx.dispose();resolveResume()
  assert.equal(await pending,false,'disposal cancels pending audio resume')
  assert.equal(fx.getDiagnostics().disposed,true)
  assert.equal(geometryDisposals,1,'shared model geometry disposed once')
  assert.equal(textureDisposals,1,'shared atlas disposed once across materials and clones')
  assert.equal(materialDisposals,1)
  assert.equal(lamp.material,shared,'original lamp material restored before final disposal')
  assert.equal(environmentDisposed,1)
  assert.equal([...listeners.values()].reduce((sum,set)=>sum+set.size,0),0)
  assert.equal(fx.object3D.parent,null)
  assert.equal(sceneEl.renderer.toneMapping,THREE.NoToneMapping)
  assert.equal(sceneEl.renderer.toneMappingExposure,1)
  assert.equal(await fx.setSoundEnabled(true),false)
  assert(soundEvents.some(state=>state.enabled))
  return [{id:'full-wall-source-model-effects-lifecycle',result:'pass',detail:'Real runtimes: tracking/reduced/boost/steam, unchanged front frame, baked tone mapping, existing renderer, gesture audio and cancellation, hidden cleanup, deduplicated source disposal.'}]
}

if(require.main===module){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
  const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
  function load(file,names,extras={}){
    const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/^import .*$/mg,'').replace(/export (const|function|class)/g,'$1')
    const context={console,AbortController,...extras};vm.createContext(context)
    vm.runInContext(source+'\nglobalThis.result={'+names.join(',')+'}',context,{filename:file})
    return context.result
  }
  module.exports({load,THREE}).then(results=>console.log(JSON.stringify(results,null,2))).catch(error=>{console.error(error);process.exitCode=1})
}
