'use strict'
// Real Three matrices/projections; recognition events below are controlled doubles.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const ROOT=path.resolve(__dirname,'..'),T=require('../tools/verification/node_modules/three/build/three.cjs')
const {JSDOM}=require('../tools/verification/node_modules/jsdom')
const data=path.resolve(ROOT,'../Models/coverage-wave-2026-10-25/tracking')
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'))
const target=id=>{const manifest=read(path.join(data,id,'target-manifest.json'));return {manifest,compiledTarget:read(path.join(data,id,manifest.compiledJsonPath))}}
const centre=target('centre'),left=target('left'),right=target('right')
const moduleSource=fs.readFileSync(path.join(ROOT,'src/tracking/wall-coverage.js'),'utf8').replace(/export (function|const)/g,'$1')
const policy={};vm.createContext(policy);vm.runInContext(moduleSource+'\nglobalThis.api={panelCropTransform,createWallCoverageArbiter}',policy)
const {panelCropTransform,createWallCoverageArbiter}=policy.api
let checks=0
const check=(value,message)=>{assert(value,message);checks++}
const arb=createWallCoverageArbiter({names:['left','centre','right'],staleAfterMs:1000})
arb.observe('left',{now:0});check(arb.choose(0)==='left','Acquire available reference')
arb.observe('right',{now:20});check(arb.choose(20)==='left','Background overlap cannot steal healthy focus')
arb.lose('left');check(arb.choose(21)==='right','Native loss selects fresh remaining reference')
check(arb.choose(1021)===null,'Stale references cannot become pretend detections')
arb.reset();check(arb.choose(0)===null,'Stop resets availability and clock epoch')
assert.throws(()=>arb.observe('right',{now:-1}),/monotonic/);checks++
for(const entry of [left,centre,right]){
 const m=entry.manifest,cal=panelCropTransform(m.panelImagePx,m.sourceCropPx,.7)
 const [pw,ph]=m.panelImagePx,[x,y,w,h]=m.sourceCropPx
 for(const [px,py]of [[0,0],[pw,0],[pw,ph],[0,ph],[x,y],[x+w,y+h]]){
  const panel=[px/pw-.5,(ph/2-py)/pw]
  check(Math.abs(panel[0]*cal.scale+cal.position[0]-.7*((px-x)/w-.5))<1e-12,'Exact horizontal crop mapping')
  check(Math.abs(panel[1]*cal.scale+cal.position[1]-.7*((y+h/2-py)/w))<1e-12,'Exact vertical crop mapping')
 }
}
assert.throws(()=>panelCropTransform([10,10],[0,0,11,10]),/Invalid/);checks++
async function run(){
 const dom=new JSDOM('<a-scene></a-scene>',{url:'https://test.invalid/',pretendToBeVisual:true}),{window}=dom,{document}=window
 let now=0;Object.defineProperty(window.performance,'now',{value:()=>now})
 const scene=document.querySelector('a-scene');scene.hasLoaded=true;scene.object3D=new T.Scene()
 const create=document.createElement.bind(document)
 document.createElement=tag=>{const el=create(tag);if(tag==='a-entity'){el.hasLoaded=true;el.object3D=new T.Group();el.components={'xrextras-named-image-target':{}};const set=el.setAttribute.bind(el);el.setAttribute=(key,value)=>{if(key==='xrextras-named-image-target')el.targetName=value.name;set(key,value)}}return el}
 const states=[],observations=[],configs=[],errors=[]
 window.AFRAME={THREE:T,components:{xrweb:{},'xrextras-named-image-target':{}}};window.XR8={XrController:{configure:v=>configs.push(v)},stop(){}}
 const context={window,document,console,URLSearchParams,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,targetManifestModule:centre.manifest,compiledTargetModule:centre.compiledTarget}
 vm.createContext(context);vm.runInContext(moduleSource+'\n'+fs.readFileSync(path.join(ROOT,'src/tracking/index.js'),'utf8').replace(/^import .*$/mg,'').replace(/export (const|function)/g,'$1')+'\nglobalThis.create=createTrackingAdapter',context)
 const tracker=context.create({sceneEl:scene,manifest:centre.manifest,compiledTarget:centre.compiledTarget,coverageTargets:[left,right],onState:v=>states.push(v),onObservation:v=>observations.push(v),onError:v=>errors.push(v)})
 const el=entry=>[...scene.querySelectorAll('a-entity')].find(e=>e.targetName===entry.manifest.compiledTargetName)
 const event=(object,type,detail)=>object.dispatchEvent(new window.CustomEvent(type,{detail}))
 const update=entry=>event(scene,'xrimageupdated',{name:entry.manifest.compiledTargetName,scaledWidth:1,scaledHeight:1222/1630})
 const lose=entry=>event(scene,'xrimagelost',{name:entry.manifest.compiledTargetName})
 const common=new T.Matrix4().compose(new T.Vector3(.2,-.08,-2.1),new T.Quaternion().setFromEuler(new T.Euler(.12,-.15,.07)),new T.Vector3(.8,.8,.8))
 const setPose=entry=>{const m=entry.manifest,c=panelCropTransform(m.panelImagePx,m.sourceCropPx),crop=new T.Matrix4().compose(new T.Vector3(...c.position),new T.Quaternion(),new T.Vector3(c.scale,c.scale,c.scale)),native=common.clone().multiply(crop.invert());native.decompose(el(entry).object3D.position,el(entry).object3D.quaternion,el(entry).object3D.scale)}
 let content
 try{
  await tracker.start();check(configs.length===1&&configs[0].imageTargetData.length===3,'One engine configuration for three references')
  for(const entry of [left,centre,right])setPose(entry)
  update(left);content=states.at(-1).root;content.add(new T.Object3D())
  const canonical=content,child=content.children[0],firstCount=states.length
  for(let i=0;i<20;i++){now+=10;update(centre);update(right);update(left)}
  check(states.length===firstCount,'Overlapping found/updated references do not ping-pong or restart content')
  const camera=new T.PerspectiveCamera(58,390/844,.01,100);camera.updateProjectionMatrix();camera.updateMatrixWorld(true)
  function corners(){content.updateWorldMatrix(true,false);for(const [x,y]of [[-.5,-1222/5526],[-.5,1222/5526],[.5,-1222/5526],[.5,1222/5526]]){
   const actual=new T.Vector3(x,y,0).applyMatrix4(content.matrixWorld),expected=new T.Vector3(x,y,0).applyMatrix4(common)
   check(actual.distanceTo(expected)<1e-10,'All full-panel corners align in common3D frame')
   for(const aspect of [390/844,844/390,1]){camera.aspect=aspect;camera.updateProjectionMatrix();check(actual.clone().project(camera).distanceTo(expected.clone().project(camera))<1e-10,'All corners project consistently in portrait/landscape/square camera')}
  }}
  corners();lose(left)
  check(states.at(-1).root===canonical&&states.at(-1).coverageHandoff===true&&states.at(-1).resumed===true,'Native loss hands same object root to fresh reference, preserving effect phase')
  check(content.children[0]===child,'Existing model child survives handoff without duplication')
  corners();const focused=tracker.getDiagnostics().activeTarget
  const handoffStates=states.length
  event(el(left),'xrextraslost',{name:left.manifest.compiledTargetName})
  check(states.length===handoffStates&&content.visible,'Duplicate named loss after raw loss does not hide the shared canonical content')
  lose(left);check(content.visible&&tracker.getDiagnostics().activeTarget===focused,'Late old-reference loss cannot hide active shared root')
  event(el(right),'xrextrasfound',{name:'wrong-reference'})
  check(tracker.getDiagnostics().activeTarget===focused,'Mismatched native reference identity ignored')
  now+=10;update(right);lose(centre);corners()
  check(tracker.getDiagnostics().targets.filter(t=>t.visible).length===1,'Only one canonical wall render is visible')
  now+=1001;tracker.update(0,16)
  check(!content.visible&&states.at(-1).state==='lost','Missed native loss expires pose; no frozen pose persistence')
  const count=states.length;now+=10;update(left);check(states.length===count+1&&states.at(-1).root===canonical,'Fresh native update reacquires same content object')
  await tracker.stop();const stopped=states.length;update(right);check(states.length===stopped&&!content.visible,'Stop ignores stale queued updates')
  check(errors.length===0,'No adapter errors')
  check(observations.some(o=>o.type==='coverage-handoff'),'Handoff has separate observation evidence')
 }finally{await tracker.dispose();check(scene.object3D.children.length===0,'Disposal removes every render anchor');dom.window.close()}
 const manifest=read(path.join(data,'coverage-manifest.json')),rows=new Uint8Array(2763*1222)
 for(const target of manifest.targets){const[x,y,w,h]=target.crop;for(let py=y;py<y+h;py++)rows.fill(1,py*2763+x,py*2763+x+w)}
 check(rows.every(x=>x===1),'Every source pixel belongs to at least one exact reference')
 console.log(`PASS wall coverage: ${checks} checks; exact crop/corner/projection mappings, native-event-double sticky arbitration, shared root/model child, loss/staleness/Stop/disposal. Native detection and physical-print alignment NOT measured.`)
}
run().catch(error=>{console.error(error);process.exitCode=1})
