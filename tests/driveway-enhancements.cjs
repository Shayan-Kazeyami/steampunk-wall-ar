'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
const {JSDOM}=require('../tools/verification/node_modules/jsdom')
function load(file,names,extras={}){
  const context={console,AbortController,...extras};vm.createContext(context)
  const code=fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/^import .*$/mg,'').replace(/export (const|function|class)/g,'$1')
  vm.runInContext(code+'\nglobalThis.result={'+names.join(',')+'}',context);return context.result
}
const {sampleCameraLighting}=load('src/tracking/camera-lighting.js',['sampleCameraLighting'])
function frame(flip=false){
  const pixels=new Uint8Array(16*16*4)
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const bright=flip?x>=8:x<8,value=bright?190:60,i=(y*16+x)*4
    pixels.set([value,value,value,255],i)
  }
  return {pixels,cols:16,rows:16,rowBytes:64}
}
const left=sampleCameraLighting(frame()),right=sampleCameraLighting(frame(true))
assert(left.direction[0]<-.2 && right.direction[0]>.2,'Bright-side estimate follows the actual frame')
assert(Math.abs(left.direction[1])<.001);assert(left.directionalStrength>0 && left.directionalStrength<=.65)
assert.equal(left.confidence,1)
assert.equal(left.directionSource,'screen-brightness-estimate','Never claim true light reconstruction')
const mixed=frame();for(let i=0;i<240;i++)mixed.pixels.set([160,45,10,255],i*4)
const estimate=sampleCameraLighting(mixed)
assert(Math.abs(estimate.color[0]-estimate.color[2])<.01,'Neutral samples reduce bias from a predominantly brass/brick frame')
const factories={}
for(const [file,name]of [['animation-runtime','createWallAnimation'],['machine-effects','createMachineEffects'],['experience-polish','createExperiencePolish'],['environment-lighting','createEnvironmentLighting'],['connector-appearance','applyConnectorAppearance']])factories[name]=load('src/full-wall/runtime/'+file+'.js',[name])[name]
const {createFullWallEffects}=load('src/full-wall/index.js',['createFullWallEffects'],factories)
const document={hidden:false,addEventListener(){},removeEventListener(){}}
const model=new THREE.Group(),fixed=new THREE.Mesh(new THREE.BoxGeometry(1,.6,.02),new THREE.MeshBasicMaterial({color:0xffffff}));fixed.position.z=-.05;model.add(fixed)
const valve=new THREE.Mesh(new THREE.TorusGeometry(.055,.008,8,24),new THREE.MeshStandardMaterial());valve.position.set(-.23,0,.04);valve.name='source-valve';valve.userData.animation_role='valve_wheel';model.add(valve)
const gear=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,.02,32).rotateX(Math.PI/2),new THREE.MeshStandardMaterial());gear.position.set(.23,0,.04);gear.name='source-gear';gear.userData.animation_role='gear';model.add(gear)
const gauge=new THREE.Mesh(new THREE.BoxGeometry(.02,.05,.01),new THREE.MeshStandardMaterial());gauge.position.set(0,.2,.05);gauge.name='mobile_Steam Pressure Gauge.033_Needle';gauge.userData.animation_role='pressure_needle';model.add(gauge)
let clock=0
const sceneEl={object3D:new THREE.Scene(),camera:new THREE.PerspectiveCamera(50,1,.01,100)};sceneEl.camera.position.z=2
const fx=createFullWallEffects({THREE,model,sceneEl,document,now:()=>clock});sceneEl.object3D.add(fx.object3D)
const step=n=>{for(let i=0;i<n;i++){clock+=20;fx.update({deltaMs:20,nowMs:clock})}}
const fixedPose=fixed.matrix.clone(),valveBase=valve.quaternion.clone()
assert(!fx.interact('release'),'Untracked interactions are rejected')
fx.setTracked(true);step(1);assert(fx.getDiagnostics().startup>0 && fx.getDiagnostics().startup<.02)
step(150);assert.equal(fx.getDiagnostics().startup,1)
const idle=fx.getDiagnostics().machine.pressure
assert(fx.interact('valve',valve.name));step(30)
assert(fx.getDiagnostics().machine.releasing)
assert(fx.getDiagnostics().machine.pressure<idle-.1,'Valve opening reduces pressure, not only a UI label')
assert(fx.getDiagnostics().machine.activeParticles>0)
assert(valve.quaternion.angleTo(valveBase)>.4,'Touched valve visibly turns')
assert(fx.getDiagnostics().machine.gauges[0].target<6,'Gauge responds to pressure release')
step(200);assert(!fx.getDiagnostics().machine.releasing);assert(Math.abs(fx.getDiagnostics().machine.pressure-idle)<.01,'Pressure recovers after finite release')
assert(fixed.matrix.equals(fixedPose),'Fixed source backing never vibrates or moves')
const canvas={getBoundingClientRect:()=>({left:50,top:40,width:600,height:600})}
function tap(object){const p=object.getWorldPosition(new THREE.Vector3()).project(sceneEl.camera);return fx.interactAt(50+(p.x+1)*300,40+(1-p.y)*300,canvas)}
sceneEl.camera.updateMatrixWorld(true)
assert.equal(tap(valve)?.action,'valve','Actual screen ray selects the source valve bounds')
assert.equal(tap(gear)?.action,'gear');assert(fx.getDiagnostics().overdrive)
assert.equal(tap(gauge)?.action,'release')
assert.equal(fx.interactAt(-10,0,canvas),null)
fx.setLightingMode('camera');fx.setCameraLighting({...left,gain:.5,color:[1.12,1,.85]});step(75)
const d=fx.getDiagnostics()
assert(d.cameraLighting.gain<.7 && d.cameraLighting.gain>.5,'Lighting changes smoothly')
assert(d.cameraLighting.direction[0]<-.2 && d.cameraLighting.directionalStrength>0)
assert(d.machine.steamColor[0]>d.machine.steamColor[2],'Steam also receives camera tint')
assert(d.machine.steamColor[0]<.88,'Steam dims with the room')
fx.setCameraLighting({gain:2,color:[.75,1,1.25],confidence:.01});assert.equal(fx.getDiagnostics().cameraLighting.targetGain,.5,'Low confidence sample is ignored')
step(250);assert.equal(fx.getDiagnostics().cameraLighting.source,'studio-fallback')
fx.setLightingMode('studio');assert.equal(fx.getDiagnostics().cameraLighting.gain,1)
assert.deepEqual(Array.from(fx.getDiagnostics().cameraLighting.color),[1,1,1])
fx.setReducedMotion(true);assert(!fx.interact('valve'));assert.equal(tap(valve),null);step(10)
assert.equal(fx.getDiagnostics().machine.activeParticles,0);assert.equal(fx.getDiagnostics().releaseRemaining,0)
assert(valve.quaternion.angleTo(valveBase)<1e-7)
fx.setReducedMotion(false);fx.setTracked(false);assert(!fx.interact('release'));fx.setTracked(true)
fx.interact('release');document.hidden=true;step(1);assert.equal(fx.getDiagnostics().tracked,false);assert(!fx.interact('restart'))
document.hidden=false;fx.setTracked(true);fx.interact('restart');assert.equal(fx.getDiagnostics().startup,0)
fx.dispose();assert(!fx.interact('release'));assert.equal(fx.interactAt(350,340,canvas),null)

// Real optional UI: legacy views remain untouched; keyboard controls use the
// same guarded callback as touch, including loss/reduced/visibility cleanup.
const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true})
Object.defineProperty(dom.window.document,'hidden',{configurable:true,writable:true,value:false})
const {createUIController}=load('src/ui/controller.js',['createUIController'],{window:dom.window,document:dom.window.document})
const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/shared/spec.json')))
const calls=[],ui=createUIController({mount:dom.window.document.querySelector('#mount'),spec,onMachineAction:action=>{calls.push(action);return true}})
const group=dom.window.document.querySelector('[aria-label="Machine interactions"]'),button=group.querySelector('[data-machine-action="release"]')
assert(group.hidden);ui.setState({state:'preview'});assert(!group.hidden && !button.disabled);button.click();assert.deepEqual(calls,['release'])
assert(!dom.window.document.querySelector('.steampunk-ui__machine-status').hidden)
ui.setReducedMotion(true);assert(button.disabled);button.click();assert.equal(calls.length,1)
ui.setReducedMotion(false);ui.setState({state:'lost'});assert(group.hidden)
ui.setState({state:'tracked'});dom.window.document.hidden=true;dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));assert(button.disabled)
dom.window.document.hidden=false;dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));assert(!button.disabled)
ui.dispose();button.click();assert.equal(calls.length,1,'Disposed UI has no active event listeners');dom.window.close()
console.log('PASS Driveway enhancements: neutral-weighted/directional camera estimates, bounded smoothing/fallback, steam tint, real valve/gear/gauge screen picking, finite pressure release/recovery, startup, fixed artwork and reduced/lost/hidden/disposed cleanup, accessible optional controls.')
