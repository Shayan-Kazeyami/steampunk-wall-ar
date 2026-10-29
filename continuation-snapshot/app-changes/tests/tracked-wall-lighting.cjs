'use strict'
// Real full-wall output/runtimes, controlled qualified matcher and room samples.
// Checks linear material multiplication/lifecycle; no camera-fit accuracy claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
function load(file,names,extras={}){const context={console,AbortController,...extras};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/^import .*$/mg,'').replace(/export (const|function|class)/g,'$1')+'\nglobalThis.result={'+names.join(',')+'}',context);return context.result}
const factories={}
for(const[file,name]of[['animation-runtime','createWallAnimation'],['machine-effects','createMachineEffects'],['experience-polish','createExperiencePolish'],['environment-lighting','createEnvironmentLighting'],['connector-appearance','applyConnectorAppearance']])factories[name]=load('src/full-wall/runtime/'+file+'.js',[name])[name]
const {createFullWallEffects}=load('src/full-wall/index.js',['createFullWallEffects'],factories)
const model=new THREE.Group(),backing=new THREE.MeshBasicMaterial({color:new THREE.Color(.35,.2,.08)}),bakedPbr=new THREE.MeshStandardMaterial({color:new THREE.Color(.22,.31,.4)}),pbr=new THREE.MeshStandardMaterial({color:new THREE.Color(.5,.4,.3)})
for(const[material,baked]of[[backing,false],[bakedPbr,true],[pbr,false]]){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.01),material);mesh.userData.baked_lighting=baked;model.add(mesh)}
const originals=new Map([backing,bakedPbr,pbr].map(material=>[material,material.color.clone()]))
const document={hidden:false,addEventListener(){},removeEventListener(){}},sceneEl={object3D:new THREE.Scene(),camera:new THREE.PerspectiveCamera()},ratio=[.72,1.1,1.35]
let clock=0
const fx=createFullWallEffects({THREE,model,sceneEl,document,now:()=>clock}),raw={source:'camera-rgb',gain:.4,color:[1.2,.85,.75],confidence:1}
const matched={source:'tracked-wall-reference',wallId:3,candidateId:'driveway-sign',gain:.35,color:[1.2,.75,1.1],wallColorMultiplier:ratio,confidence:.9}
function step(count,sample){for(let i=0;i<count;i++){if(sample)fx.setCameraLighting(sample);clock+=20;fx.update({deltaMs:20,nowMs:clock})}}
function exactMaterialRatio(){const multiplier=fx.getDiagnostics().cameraLighting.wallColorMultiplier;for(const material of[backing,bakedPbr]){const base=originals.get(material);for(let channel=0;channel<3;channel++)assert(Math.abs(material.color.toArray()[channel]-base.toArray()[channel]*multiplier[channel])<1e-12,'Authored base × linear wall ratio exactly once; never gain/tint or previous colour')}}
fx.setTracked(true);fx.setLightingMode('camera');step(100,raw)
assert(backing.color.equals(originals.get(backing)) && bakedPbr.color.equals(originals.get(bakedPbr)),'Whole-frame brightness/tint cannot recolour baked artwork')
assert(pbr.envMapIntensity<.4,'PBR reflection intensity still responds independently to camera gain')
const before=backing.color.clone();fx.setCameraLighting(matched);step(1);assert(backing.color.r<before.r && backing.color.r>before.r*ratio[0],'New fit eases rather than jumps');exactMaterialRatio()
step(650,matched);exactMaterialRatio();for(let i=0;i<3;i++)assert(Math.abs(fx.getDiagnostics().cameraLighting.wallColorMultiplier[i]-ratio[i])<1e-6,'Repeated fits converge without cumulative colour drift')
assert(pbr.color.equals(originals.get(pbr)),'Independent dynamic PBR base colour is preserved')
const fitted=backing.color.clone();step(50,raw);assert(Math.abs(backing.color.r-fitted.r)<1e-7,'Raw fallback briefly holds the recent qualified fit')
step(350,raw);assert.equal(fx.getDiagnostics().cameraLighting.wallColorSource,'neutral-fallback');assert(backing.color.toArray().every((value,i)=>Math.abs(value-originals.get(backing).toArray()[i])<.001));exactMaterialRatio()
assert.equal(fx.getDiagnostics().cameraLighting.targetGain,.4,'Raw samples continue to drive lights while stale wall fit fades neutral')
step(100,matched);fx.setCameraLighting({...matched,wallColorMultiplier:[NaN,1,1]});assert.equal(fx.getDiagnostics().cameraLighting.targetWallColorMultiplier[0],ratio[0],'Invalid fit cannot corrupt output')
fx.setCameraLighting({...matched,wallColorMultiplier:[.1,4,1]});assert.deepEqual(Array.from(fx.getDiagnostics().cameraLighting.targetWallColorMultiplier),[.6,1.5,1],'Matcher linear ratio bounds are enforced at output too')
fx.setCameraLighting(matched);step(150,matched);const beforeSuspension=backing.color.clone();fx.suspendTracking();clock+=100;fx.setTracked(true);assert(backing.color.equals(beforeSuspension),'Brief transient loss retains qualified colour without restamping its age')
fx.suspendTracking();clock+=6000;fx.setTracked(true);step(250,raw);assert(Math.abs(backing.color.r-originals.get(backing).r)<.001,'Wall fit age keeps counting while transiently suspended')
step(100,matched);fx.setTracked(false);assert(backing.color.equals(originals.get(backing)),'Committed loss clears the qualified fit immediately while placement is hidden');fx.setTracked(true);step(10,raw);assert(backing.color.equals(originals.get(backing)),'Committed-loss reacquisition cannot reuse old wall colour')
step(100,matched);fx.setLightingMode('studio');assert(backing.color.equals(originals.get(backing)) && bakedPbr.color.equals(originals.get(bakedPbr)),'Studio preview restores exact authored colour');assert.deepEqual(Array.from(fx.getDiagnostics().cameraLighting.wallColorMultiplier),[1,1,1])
fx.setLightingMode('camera');step(10,raw);assert(backing.color.equals(originals.get(backing)),'New camera mode cannot inherit the previous wall fit');fx.dispose();fx.setCameraLighting(matched);assert.equal(fx.getDiagnostics().disposed,true)
console.log('PASS tracked-wall lighting output: authored linear base × qualified ratio once,800ms easing/no drift, raw-fallback isolation with independent PBR/steam adaptation, bounded input, stale/long-loss neutral fade, exact studio/mode reset and disposed guard. Controlled samples; physical wall colour match unmeasured.')
