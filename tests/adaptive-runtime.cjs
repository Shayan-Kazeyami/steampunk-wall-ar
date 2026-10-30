'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
const root=path.resolve(__dirname,'..')
function load(file,names,extra={}){
 const ctx={console,AbortController,performance:{now:()=>0},...extra};vm.createContext(ctx)
 vm.runInContext(fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*$/mg,'').replace(/export (const|function|class)/g,'$1')+'\nglobalThis.api={'+names.join(',')+'}',ctx)
 return ctx.api
}
const {sampleCameraLighting,createCameraLightingModule}=load('src/tracking/camera-lighting.js',['sampleCameraLighting','createCameraLightingModule'])
assert.equal(sampleCameraLighting(null,null),null)
assert.equal(sampleCameraLighting(null,1.2).source,'engine-exposure')
assert.equal(sampleCameraLighting(null,-1),null)
const pixels=new Uint8Array([180,140,100,255,180,140,100,255,0,0,0,0,0,0,0,0])
const sample=sampleCameraLighting({pixels,cols:2,rows:1,rowBytes:16})
assert.equal(sample.source,'camera-rgb');assert(sample.color[0]>sample.color[2]);assert(sample.gain>1)
assert.equal(sampleCameraLighting({pixels,cols:2,rows:1,rowBytes:16},.7).gain,.7,'Prefer native exposure when supplied')
const samples=[];let time=0
const moduleInstance=createCameraLightingModule({onLighting:value=>samples.push(value),now:()=>time})
moduleInstance.onUpdate({processGpuResult:{camerapixelarray:{pixels,cols:2,rows:1,rowBytes:16}}})
time=100;moduleInstance.onUpdate({processCpuResult:{reality:{lighting:{exposure:1}}}});assert.equal(samples.length,1)
time=201;moduleInstance.onUpdate({processCpuResult:{reality:{lighting:{exposure:1}}}});assert.equal(samples.length,2)
const {createMachineEffects}=load('src/full-wall/runtime/machine-effects.js',['createMachineEffects'])
const model=new THREE.Group();model.add(new THREE.Mesh(new THREE.BoxGeometry(1,.4,.01),new THREE.MeshStandardMaterial()))
const names=['033','034','035'].map(id=>'mobile_Steam Pressure Gauge.'+id+'_Needle')
const needles=names.map(name=>{const n=new THREE.Group();n.name=name;n.userData.animation_role='pressure_needle';model.add(n);return n})
const fx=createMachineEffects({THREE,model})
const running={running:true,tracked:true,reducedMotion:false,overdrive:false,elapsed:1}
for(let i=0;i<600;i++)fx.update(20,i*20,running)
fx.getDiagnostics().gauges.forEach((g,i)=>assert(Math.abs(g.value-[12,15,18][i])<2.31))
const marks=[235.3142857143,192.4,142.9333333333,92.15,41,-9,-59.8]
for(let i=0;i<=6;i++){
 assert(fx.setGaugeValue(names[0],i*5))
 for(let j=0;j<900;j++)fx.update(20,j*20,running)
 const g=fx.getDiagnostics().gauges[0]
 assert(Math.abs(g.value-i*5)<.0001)
 assert(Math.abs(g.angleDegrees-marks[i])<.001,'Needle must hit its actual printed tick')
 const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),(marks[i]+41.54468349)*Math.PI/180)
 assert(needles[0].quaternion.angleTo(q)<.0001,'Actual mesh orientation follows calibrated scale')
}
assert(!fx.setGaugeValue(names[0],NaN));assert(!fx.setGaugeValue('missing',10))
fx.setGaugeValue(names[0],100)
for(let j=0;j<1000;j++)fx.update(20,j*20,running)
assert(Math.abs(fx.getDiagnostics().gauges[0].value-30)<.0001)
const before=needles[0].quaternion.clone();fx.update(20,0,{...running,running:false,elapsed:2});assert(needles[0].quaternion.equals(before))
fx.reset();for(const g of fx.getDiagnostics().gauges)assert.equal(g.value,30)
fx.dispose()
const {warmWallModel}=load('src/shared/load-wall.js',['warmWallModel'],{URL,setTimeout,clearTimeout})
const wall=new THREE.Group(),parent=new THREE.Group();parent.add(wall);wall.visible=false
const current={id:'original-framebuffer'},viewport=new THREE.Vector4(1,2,300,400),scissor=new THREE.Vector4(2,3,100,200)
let target=current,scissorTest=true,draws=0
const renderer={getRenderTarget:()=>target,setRenderTarget:value=>{target=value},getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>scissorTest,setViewport(){},setScissor(){},setScissorTest:v=>{scissorTest=v},render(scene){assert(target!==current);assert(wall.visible);assert.equal(wall.parent,scene);draws++}}
assert(warmWallModel({THREE,sceneEl:{renderer,camera:new THREE.PerspectiveCamera(),object3D:new THREE.Scene()},object3D:wall}))
assert.equal(draws,1);assert.equal(target,current);assert.equal(wall.parent,parent);assert.equal(wall.visible,false);assert(scissorTest)
renderer.getContext=()=>({isContextLost:()=>true})
assert.equal(warmWallModel({THREE,sceneEl:{renderer,camera:new THREE.PerspectiveCamera(),object3D:new THREE.Scene()},object3D:wall}),false,'A lost context cannot be reported GPU-warmed')
let lostDuringWarm=false
renderer.getContext=()=>({isContextLost:()=>lostDuringWarm})
const renderBeforeLoss=renderer.render
renderer.render=function(...args){renderBeforeLoss.apply(this,args);lostDuringWarm=true}
assert.equal(warmWallModel({THREE,sceneEl:{renderer,camera:new THREE.PerspectiveCamera(),object3D:new THREE.Scene()},object3D:wall}),false,'Loss during the draw cannot be reported GPU-warmed')
console.log('PASS camera RGB/exposure fallback/throttle; separate dial readings; all seven printed tick angles/clamping/pause; offscreen GPU warm-up state restoration and lost-context exclusion (mock renderer).')

