'use strict';
// Canonical panel attachment and cancellation checks. XR pose events are mocked;
// these assertions do not certify physical corner alignment or camera performance.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const THREE=require('../tools/verification/node_modules/three/build/three.cjs');
const {JSDOM}=require('../tools/verification/node_modules/jsdom');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'config/targets/driveway.json')));
const compiled=JSON.parse(fs.readFileSync(path.join(root,'image-targets/steampunk-driveway-sign.json')));
const code=fs.readFileSync(path.join(root,'src/tracking/index.js'),'utf8').replace(/^import .*$/mg,'').replace(/export (function|const|class)/g,'$1');
function harness(customManifest=manifest,onLighting,extras={}){
 const dom=new JSDOM('<a-scene></a-scene>',{url:'https://test.invalid/',pretendToBeVisual:true});
 const {window}=dom,{document}=window,scene=document.querySelector('a-scene');scene.hasLoaded=true;scene.object3D=new THREE.Scene();
 const create=document.createElement.bind(document),states=[],errors=[],attrs=[];let cameraStops=0;
 document.createElement=tag=>{const el=create(tag);if(tag==='a-entity'){el.hasLoaded=true;el.object3D=new THREE.Group();el.components={'xrextras-named-image-target':{}}}return el};
 const set=scene.setAttribute.bind(scene);scene.setAttribute=(key,value)=>{attrs.push(key);set(key,value)};
 const modules=new Map();
 window.AFRAME={THREE,components:{xrweb:{},'xrextras-named-image-target':{}}};window.XR8={XrController:{configure(){},},stop(){cameraStops++},CameraPixelArray:{pipelineModule:()=>({name:'camerapixelarray'})},addCameraPipelineModule:m=>modules.set(m.name,m),removeCameraPipelineModule:name=>modules.delete(name)};
 const ctx={window,document,console,performance:{now:()=>0},setTimeout,clearTimeout,setInterval,clearInterval,URLSearchParams,AbortController,targetManifestModule:customManifest,compiledTargetModule:compiled,...extras};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'src/tracking/camera-lighting.js'),'utf8').replace(/^import .*$/mg,'').replace(/export function/g,'function'),ctx);
 vm.runInContext(code+'\nglobalThis.factory=createTrackingAdapter;',ctx);
 const tracker=ctx.factory({sceneEl:scene,onState:e=>states.push(e),onError:e=>errors.push(e),onLighting});
 return {dom,window,document,scene,states,errors,attrs,tracker,modules,get stops(){return cameraStops},event(el,name,detail){el.dispatchEvent(new window.CustomEvent(name,{detail}))}};
}
function close(a,b,message){assert(Math.abs(a-b)<1e-10,message+`: ${a} != ${b}`)}
async function main(){
 {const h=harness();try{
  await h.tracker.start();const target=h.scene.querySelector('a-entity');
  h.event(h.scene,'xrimagescanning',{imageTargets:[{name:manifest.compiledTargetName,type:'PLANAR',geometry:{scaledWidth:1,scaledHeight:.75}}]});
  let diagnostics=h.tracker.getDiagnostics();assert.equal(diagnostics.expectedTargetDeclared,true);assert.equal(diagnostics.eventCounts.imageScanning,1);assert.equal(diagnostics.scanningTargets[0].validGeometry,true);
  h.event(h.scene,'xrimagefound',{name:'x'.repeat(1000),width:1,height:.75,privatePixels:new Uint8Array(1024)});
  diagnostics=h.tracker.getDiagnostics();assert.equal(diagnostics.lastRawImageEvent.name.length,120);assert.equal(diagnostics.eventCounts.imageFound,1);assert.equal(diagnostics.geometryApplied,false);assert(!JSON.stringify(diagnostics).includes('privatePixels":{'),'Diagnostics never retain event objects/pixels');
  h.event(target,'xrextrasfound');diagnostics=h.tracker.getDiagnostics();assert.equal(diagnostics.waitingForGeometry,true);assert.equal(diagnostics.rootVisible,false,'Found without geometry remains hidden');
  h.event(h.scene,'xrimagefound',{name:manifest.compiledTargetName,scaledWidth:.4,scaledHeight:.3});
  diagnostics=h.tracker.getDiagnostics();assert.equal(diagnostics.geometryApplied,true);assert.equal(diagnostics.rootVisible,true);assert.equal(diagnostics.lastGeometry.valid,true);assert.equal(diagnostics.eventCounts.namedFound,2);
  diagnostics.eventCounts.imageFound=999;diagnostics.scanningTargets[0].name='mutated';diagnostics.lastRawImageEvent.keys.push('mutated');
  assert.equal(h.tracker.getDiagnostics().eventCounts.imageFound,2);assert.equal(h.tracker.getDiagnostics().scanningTargets[0].name,manifest.compiledTargetName);assert(!h.tracker.getDiagnostics().lastRawImageEvent.keys.includes('mutated'));
  h.event(h.scene,'xrimageupdated',{name:manifest.compiledTargetName});assert.equal(h.tracker.getDiagnostics().eventCounts.imageUpdated,1);
  await h.tracker.stop();assert.equal(h.tracker.getDiagnostics().active,false);assert.equal(h.tracker.getDiagnostics().rootVisible,false);
 }finally{await h.tracker.dispose();h.dom.window.close()}}
 {const samples=[],h=harness(manifest,sample=>samples.push(sample));try{
  await h.tracker.start();assert.equal(h.modules.size,2,'One RGB sampler and one lighting listener');
  const lighting=h.modules.get('steampunk-camera-lighting');lighting.onUpdate({processCpuResult:{reality:{lighting:{exposure:1.1}}}});
  assert.equal(samples.length,1);assert.equal(samples[0].source,'engine-exposure');
  await h.tracker.stop();assert.equal(h.modules.size,0,'Camera lighting resources released on Stop');
  await h.tracker.start();assert.equal(h.modules.size,2,'Restart installs exactly one copy of each module');
 }finally{await h.tracker.dispose();assert.equal(h.modules.size,0);h.dom.window.close()}}
 assert.equal(manifest.targetPoseCalibration.verified,false,'Physical calibration must remain provisional');
 const variants=[manifest,{...manifest,targetPoseCalibration:{verified:false,rotationDeg:90,mirrorX:true,offsetPanel:[.2,.3]}},{...manifest,targetPoseCalibration:{verified:true,rotationDeg:90,mirrorX:true,offsetPanel:[.02,-.03]}}];
 for(let i=0;i<variants.length;i++){
  const current=variants[i],h=harness(current);
  try{
   await h.tracker.start();const target=h.scene.querySelector('a-entity');
   h.event(target,'xrextrasfound');assert(!h.states.some(s=>s.state==='tracked'),'Found cannot expose geometry before crop dimensions');
   const width=.413;h.event(h.scene,'xrimagefound',{name:current.compiledTargetName,scaledWidth:width,scaledHeight:width*.75});
   const panelRoot=h.states.find(s=>s.state==='tracked').root;assert(panelRoot.visible);assert.equal(panelRoot.userData.cropToPanelApplied,true);
   const [pw,ph]=current.panelImagePx,[cx,cy,cw,ch]=current.sourceCropPx;
   const calibration=current.targetPoseCalibration.verified?current.targetPoseCalibration:{rotationDeg:0,mirrorX:false,offsetPanel:[0,0]};
   const angle=calibration.rotationDeg*Math.PI/180,scale=width*pw/cw;panelRoot.updateMatrixWorld(true);
   for(const [px,py]of [[0,0],[pw,0],[pw,ph],[0,ph],[cx+cw/2,cy+ch/2]]){
    const local=new THREE.Vector3(px/pw-.5,(ph/2-py)/pw,.01),actual=local.applyMatrix4(panelRoot.matrixWorld);
    const cropX=((px-cx)/cw-.5)*width*(calibration.mirrorX?-1:1),cropY=((cy+ch/2-py)/cw)*width;
    close(actual.x,cropX*Math.cos(angle)-cropY*Math.sin(angle)+calibration.offsetPanel[0]*scale,'Pixel X maps through canonical root');
    close(actual.y,cropX*Math.sin(angle)+cropY*Math.cos(angle)+calibration.offsetPanel[1]*scale,'Pixel Y maps through canonical root');
    close(actual.z,.01*scale,'Fullwall source Z retains outward positive depth');
   }
   h.event(target,'xrextraslost');assert.equal(panelRoot.visible,false);
   h.event(target,'xrextrasfound');assert.equal(panelRoot.visible,true);
   await h.tracker.stop();assert.equal(panelRoot.visible,false);const previous=h.states.length;
   h.event(target,'xrextrasfound');assert.equal(h.states.length,previous,'Late events after Stop cannot reacquire');
   assert.equal(h.errors.length,0);assert(h.stops>0);
  }finally{await h.tracker.dispose();h.dom.window.close()}
 }
 const h=harness();h.scene.hasLoaded=false;
 try{const started=h.tracker.start();await new Promise(r=>setTimeout(r,10));await Promise.all([started,h.tracker.stop()]);assert(!h.attrs.includes('xrweb'),'Cancel during pending load prevents camera activation')}
 finally{await h.tracker.dispose();h.dom.window.close()}
 const bundle=fs.readFileSync(path.join(root,'external/scripts/8frame-1.5.0.min.js'),'utf8');
 assert(bundle.includes('ag.GLTFLoader=class'));assert(bundle.includes('ag.DRACOLoader=class'));assert(bundle.includes('getDRACOLoader:function(){return this.dracoLoader}'));
 console.log('PASS fullwall tracking: actual Driveway crop corners, centered width1/+Yup/+Zoutward, unverified pose ignored, explicit pose applied, geometry gate, loss/reacquisition, Stop/late events, pending-start cancel, bundled GLTF/Draco loader availability. Physical camera calibration NOT tested.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
