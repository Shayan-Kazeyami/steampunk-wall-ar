'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
const source=fs.readFileSync(path.resolve(__dirname,'../src/tracking/camera-lighting.js'),'utf8').replace(/^import .*$/mg,'').replace(/export function/g,'function')
const context={console,performance:{now:()=>0}};vm.createContext(context);vm.runInContext(source+'\nglobalThis.create=createCameraLightingModule',context)
const reference={candidateId:'driveway-sign',wallId:3,targetName:'steampunk-driveway-sign'},calls=[],samples=[]
let time=0,current
const createContext=(x=0,identity=reference)=>({candidateId:identity.candidateId,wallId:identity.wallId,targetName:identity.targetName,
  generation:1,panelAspect:.44,panelMatrix:new THREE.Matrix4().makeTranslation(x,0,-2).elements.slice(),
  viewProjectionMatrix:new THREE.PerspectiveCamera(60,1,.1,100).projectionMatrix.elements.slice(),
  viewport:{offsetX:-40,offsetY:-12,width:800,height:600},canvasWidth:390,canvasHeight:844,sourceWidth:960,sourceHeight:720,poseStable:true})
const api=context.create({onLighting:sample=>samples.push(sample),now:()=>time,getTrackingFrame:()=>current,reference,
  wallMatcher:args=>{calls.push(args);return args.poseStable?{source:'tracked-wall-reference',...reference,wallColorMultiplier:[1,1,1]}:null}})
const pixels=new Uint8Array(64*48*4).fill(128);for(let i=3;i<pixels.length;i+=4)pixels[i]=255
const frame={rows:48,cols:64,rowBytes:64*4,pixels}
const tick=()=>api.onUpdate({frameStartResult:{computeTexture:{name:'current-camera-texture'}},processGpuResult:{camerapixelarray:frame}})
current=createContext();tick();assert.equal(calls.length,0,'First FBO has no paired pose history')
const preceding=current;current=createContext(.002);time=201;tick()
assert.equal(calls.length,1);assert.equal(calls[0].frameAligned,true);assert.equal(calls[0].poseStable,true)
assert.deepEqual(Array.from(calls[0].panelMatrix),preceding.panelMatrix,'Pixels pair with preceding raw panel pose, never current/filtered pose')
assert.equal(calls[0].viewport.offsetX,-40,'True engine viewport retained, including crop offsets')
assert.equal(samples.at(-1).source,'tracked-wall-reference')
current=createContext(.3);time=402;tick();assert.equal(calls.at(-1).poseStable,false,'Rapid projected movement rejects fit')
api.reset();current=createContext();time=603;tick();assert.notEqual(samples.at(-1).source,'tracked-wall-reference','Reset drops prior-FBO correspondence')
current=null;time=804;tick();const before=calls.length
current=createContext();time=1005;tick();assert.equal(calls.length,before,'Loss clears matching history before regain')
current=createContext(0,{candidateId:'garage-wide',wallId:5,targetName:'steampunk-garage-wide'});time=1206;tick()
time=1407;tick();assert.equal(calls.length,before,'Other wall never borrows Driveway reference')
api.reset();current=createContext();time=1608;tick();api.onCanvasSizeChange({canvasWidth:844,canvasHeight:390});time=1809;tick()
assert.equal(calls.length,before,'Orientation/size changes discard buffered correspondence')
console.log('PASS wall-camera integration: previous-FBO/raw-pose pairing, exact viewport, first-frame/motion/loss/handoff/resize rejection and local wall identity. No camera pixels stored or uploaded.')

// Exercise actual adapter-to-lighting wiring as well as the pure module boundary.
async function adapterIntegration(){
  const file=path.resolve(__dirname,'full-wall-tracking.cjs')
  const fixture=fs.readFileSync(file,'utf8').split('async function main(){')[0]+'\nmodule.exports={harness,manifest}'
  const scope={require:require('node:module').createRequire(file),__dirname,module:{exports:{}},console,URLSearchParams,AbortController,setTimeout,clearTimeout,setInterval,clearInterval}
  vm.createContext(scope);vm.runInContext(fixture,scope)
  const {harness,manifest}=scope.module.exports
  const reference={candidateId:manifest.candidateId,wallId:manifest.wallId,targetName:manifest.compiledTargetName},seen=[],viewports=[]
  let now=0
  const h=harness(manifest,()=>{},{performance:{now:()=>now},wallColorReferenceModule:reference,
    sampleWallColorMatch:args=>{seen.push(args);return null}})
  try{
    h.window.XR8.GlTextureRenderer={fillTextureViewport(...args){viewports.push(args);return {offsetX:-250,offsetY:0,width:900,height:844}}}
    await h.tracker.start()
    const target=h.scene.querySelector('a-entity');target.object3D.position.z=-2
    h.event(h.scene,'xrimagefound',{name:manifest.compiledTargetName,scaledWidth:1,scaledHeight:.75});h.event(target,'xrextrasfound')
    const render=h.states.at(-1).root.parent
    const raw=target.object3D.children.find(item=>item.name.startsWith('raw-panel-reference-'))
    const lighting=h.modules.get('steampunk-camera-lighting');lighting.onAttach({canvasWidth:390,canvasHeight:844})
    const projection=new THREE.PerspectiveCamera(60,390/844,.1,100).projectionMatrix.elements.slice()
    const update=()=>lighting.onUpdate({frameStartResult:{textureWidth:960,textureHeight:720,computeTexture:{}},
      processGpuResult:{camerapixelarray:frame},processCpuResult:{reality:{intrinsics:projection,position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0,w:1}}}})
    update()
    target.object3D.position.x=.003;h.tracker.update(1000);now=201;update()
    // Returned pixels belong to the initial pose, not current raw or filtered pose.
    assert.equal(seen.length,1)
    assert(Math.abs(seen[0].panelMatrix[12]-raw.position.x)<1e-10)
    assert.deepEqual(Array.from(viewports[0]),[960,720,390,844],'Uses exact native engine helper with texture/drawing buffer dimensions')
    assert.equal(seen[0].viewport.offsetX,-250)
    assert.notEqual(render,raw)
    const previous=seen.length;h.event(target,'xrextraslost');now=402;update()
    assert.equal(seen.length,previous,'Actual loss drops buffered matching immediately')
  }finally{await h.tracker.dispose();h.dom.window.close()}
  console.log('PASS actual adapter camera-fit wiring: engine viewport API, unfiltered native panel history and loss reset.')
}
adapterIntegration().catch(error=>{console.error(error);process.exitCode=1})
