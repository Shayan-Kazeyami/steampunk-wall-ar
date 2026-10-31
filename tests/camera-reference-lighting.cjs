'use strict'
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/tracking/camera-lighting.js'),'utf8').replace(/^import .*$/mg,'').replace(/export function/g,'function')+'\nglobalThis.create=createCameraLightingModule',ctx)
const reference={candidateId:'driveway-sign',wallId:3,targetName:'steampunk-driveway-sign'},samples=[]
let time=0,qualified=false,current={...reference,generation:1,panelAspect:.44,panelMatrix:new THREE.Matrix4().elements,viewProjectionMatrix:new THREE.Matrix4().elements,viewport:{offsetX:0,offsetY:0,width:640,height:480},canvasWidth:640,canvasHeight:480,sourceWidth:640,sourceHeight:480,poseStable:true}
const pixels=new Uint8Array(64*48*4);for(let i=0;i<pixels.length;i+=4)pixels.set([45,28,15,255],i)
const api=ctx.create({reference,now:()=>time,getTrackingFrame:()=>current,onLighting:s=>samples.push(s),wallMatcher:()=>qualified?{source:'tracked-wall-reference',gain:1.1,color:[1.15,.95,.9],wallColorMultiplier:[1.265,1.045,.99],confidence:.9}:null})
function tick(){time+=201;api.onUpdate({frameStartResult:{computeTexture:{}},processGpuResult:{camerapixelarray:{pixels,rows:48,cols:64,rowBytes:256}},processCpuResult:{reality:{lighting:{exposure:.3}}}})}
tick();tick();let s=samples.at(-1);assert.equal(s.source,'tracked-wall-neutral-fallback');assert.equal(s.gain,1);assert.deepEqual(Array.from(s.color),[1,1,1]);assert.equal(s.rawFrameGain,.3);assert.equal(s.directionalStrength,0)
qualified=true;tick();s=samples.at(-1);assert.equal(s.source,'tracked-wall-reference');assert.equal(s.gain,1.1);assert.deepEqual(Array.from(s.color),[1.15,.95,.9]);assert.deepEqual(Array.from(s.wallColorMultiplier),[1.265,1.045,.99]);assert.equal(s.directionalStrength,0)
qualified=false;current={...current,candidateId:'other',wallId:8,targetName:'other'};tick();assert.equal(samples.at(-1).gain,.3,'Independent non-reference camera estimator behavior preserved')
assert.equal(api.getDiagnostics().reason,'reference-identity-mismatch')
assert(api.getDiagnostics().accepted>=1);assert(api.getDiagnostics().rejected>=1)
const copied=api.getDiagnostics();copied.reasonCounts.changed=99;assert.equal(api.getDiagnostics().reasonCounts.changed,undefined)
console.log('PASS known-artwork camera fallback: dark pigments/native exposure do not darken3D without qualified correspondence; valid camera/reference gain/tint preserved; painted brightness gradients never claim light direction; unrelated camera sampling retained.')
