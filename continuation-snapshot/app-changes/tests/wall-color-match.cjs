'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
const root=path.resolve(__dirname,'..'),context=vm.createContext({})
vm.runInContext(fs.readFileSync(path.join(root,'src/tracking/wall-color-match.js'),'utf8').replace('export function','function')+'\nglobalThis.sample=sampleWallColorMatch',context)
const sample=context.sample
const linear=c=>c/255<=.04045?c/255/12.92:Math.pow((c/255+.055)/1.055,2.4)
const encode=c=>Math.round(255*(c<=.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-.055))
const reference={schemaVersion:1,candidateId:'driveway-sign',wallId:3,targetName:'steampunk-driveway-sign',panelAspect:1,regionUv:[0,0,1,1],patches:[]}
for(let y=0;y<6;y++)for(let x=0;x<8;x++)reference.patches.push({u:(x+.5)/8,v:(y+.5)/6,rgb:[95+(x*31+y*17)%95,100+(x*13+y*29)%85,90+(x*23+y*11)%100]})
function fixture({canvasWidth=640,canvasHeight=480,viewport={offsetX:0,offsetY:0,width:640,height:480},rotation=0,ratio=[1.2,.8,1.1],corrupt=0,frameSize=96}={}){
 const panelMatrix=new THREE.Matrix4().makeScale(1.6,1.6,1),viewProjectionMatrix=new THREE.Matrix4().makeRotationZ(rotation)
 const frame={rows:frameSize,cols:frameSize,rowBytes:frameSize*4+16,pixels:new Uint8Array(frameSize*(frameSize*4+16))}
 for(let y=0;y<frame.rows;y++)for(let x=0;x<frame.cols;x++){const i=y*frame.rowBytes+x*4;frame.pixels.set([20,40,230,255],i)}
 reference.patches.forEach((patch,index)=>{
  const clip=new THREE.Vector4(patch.u-.5,.5-patch.v,0,1).applyMatrix4(panelMatrix).applyMatrix4(viewProjectionMatrix)
  const sx=((clip.x/clip.w+1)*canvasWidth/2-viewport.offsetX)/viewport.width
  const sy=1-((clip.y/clip.w+1)*canvasHeight/2-viewport.offsetY)/viewport.height
  const px=Math.floor(sx*frame.cols-.5),py=Math.floor(sy*frame.rows-.5)
  const rgb=index<corrupt?[235,35,200]:patch.rgb.map((c,i)=>encode(Math.min(1,linear(c)*ratio[i])))
  for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++)if(px+dx>=0&&py+dy>=0&&px+dx<frame.cols&&py+dy<frame.rows)frame.pixels.set([...rgb,255],(py+dy)*frame.rowBytes+(px+dx)*4)
 })
 return {frame,viewport,canvasWidth,canvasHeight,reference,panelMatrix:panelMatrix.elements,viewProjectionMatrix:viewProjectionMatrix.elements,
  candidateId:'driveway-sign',wallId:3,targetName:'steampunk-driveway-sign',frameAligned:true,poseStable:true}
}
function closeVector(actual,expected,tolerance=.025){actual.forEach((value,i)=>assert(Math.abs(value-expected[i])<tolerance,`${value} vs ${expected[i]}`))}
function run(){
 const reasons=[]
 assert.equal(sample({...fixture(),poseStable:false,onDiagnostic:d=>reasons.push(d)}),null)
 assert.equal(reasons.at(-1).reason,'pose-moving')
 const hidden=fixture();hidden.frame.pixels.fill(0)
 assert.equal(sample({...hidden,onDiagnostic:d=>reasons.push(d)}),null)
 assert.equal(reasons.at(-1).reason,'insufficient-visible-unclipped-patches')
 assert(sample({...fixture(),onDiagnostic:d=>reasons.push(d)}))
 assert.equal(reasons.at(-1).reason,'qualified-reference-fit')
 assert(!JSON.stringify(reasons).includes('pixels'),'diagnostics never retain camera pixels')
 for(const options of [
  {},{canvasWidth:390,canvasHeight:844,viewport:{offsetX:-367.5,offsetY:0,width:1125,height:844}},
  {canvasWidth:844,canvasHeight:390,viewport:{offsetX:0,offsetY:-121.5,width:844,height:633}},
  {canvasWidth:800,canvasHeight:600,viewport:{offsetX:100,offsetY:75,width:600,height:450}},
  {rotation:Math.PI/2},{rotation:-Math.PI/2},{rotation:Math.PI},
 ]){
  const result=sample(fixture(options));assert(result,'valid asymmetric grid must fit across viewport orientation/crop')
  assert.equal(result.source,'tracked-wall-reference');assert.equal(result.candidateId,'driveway-sign');assert.equal(result.wallId,3)
  assert.equal(result.targetName,'steampunk-driveway-sign')
  closeVector(result.wallColorMultiplier,[1.2,.8,1.1]);assert(result.confidence>.65)
 }
 closeVector(sample(fixture({ratio:[.8,.8,.8]})).wallColorMultiplier,[.8,.8,.8])
 closeVector(sample(fixture({ratio:[1,1,1]})).wallColorMultiplier,[1,1,1])
 closeVector(sample(fixture({ratio:[1.8,.45,1.1]})).wallColorMultiplier,[1.5,.6,1.1])
 const robust=sample(fixture({corrupt:8}));assert(robust);closeVector(robust.wallColorMultiplier,[1.2,.8,1.1])
 assert.equal(sample(fixture({corrupt:30})),null,'widespread occlusion/colour inconsistency rejected')
 assert.equal(sample({...fixture(),frameAligned:false}),null,'unmatched previous-FBO pose cannot be used')
 assert.equal(sample({...fixture(),poseStable:false}),null,'unstable pose cannot drive colour feedback')
 assert.equal(sample({...fixture(),candidateId:'garage-wide'}),null,'a switched target cannot reuse Driveway reference')
 assert.equal(sample({...fixture(),wallId:5}),null)
 assert.equal(sample({...fixture(),targetName:'steampunk-garage-wide'}),null)
 assert.equal(sample({...fixture(),viewport:{offsetX:0,offsetY:0,width:0,height:400}}),null)
 assert.equal(sample({...fixture(),panelMatrix:[NaN]}),null)
 assert.equal(sample({...fixture(),reference:{...reference,patches:reference.patches.slice(0,10)}}),null)
 const black=fixture();black.frame.pixels.fill(0);assert.equal(sample(black),null)
 const clipped=fixture();clipped.frame.pixels.fill(255);assert.equal(sample(clipped),null)
 const flipped=fixture(),original=flipped.frame.pixels.slice()
 for(let y=0;y<flipped.frame.rows;y++)flipped.frame.pixels.set(original.subarray((flipped.frame.rows-y-1)*flipped.frame.rowBytes,(flipped.frame.rows-y)*flipped.frame.rowBytes),y*flipped.frame.rowBytes)
 assert.equal(sample(flipped),null,'asymmetric fixture detects incorrect camera row origin')
 const narrow=fixture();narrow.panelMatrix=new THREE.Matrix4().makeScale(.04,.04,1).elements
 assert.equal(sample(narrow),null,'insufficient distinct camera support rejected')
 const real=JSON.parse(fs.readFileSync(path.join(root,'config/wall-color-reference.json'),'utf8'))
 assert.equal(real.sourceSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,real.source))).digest('hex'))
 assert(real.patches.length>=12 && real.patches.length<=96)
 for(const patch of real.patches){assert(patch.u>=real.regionUv[0]&&patch.u<=real.regionUv[2]);assert(patch.v>=real.regionUv[1]&&patch.v<=real.regionUv[3])}
 const artwork=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/wall-color-artwork.json'),'utf8'))
 assert.equal(artwork.sourceSha256,real.sourceSha256)
 const actualPixels=require('node:zlib').inflateSync(Buffer.from(artwork.rgbaZlibBase64,'base64'))
 for(const ratio of [[1,1,1],[.8,.8,.8],[1.18,.9,1.1]]){
  const pixels=Uint8Array.from(actualPixels)
  for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)pixels[i+c]=encode(Math.min(1,linear(pixels[i+c])*ratio[c]))
  const f=fixture()
  Object.assign(f,{reference:real,frame:{rows:artwork.rows,cols:artwork.cols,rowBytes:artwork.rowBytes,pixels},
    viewProjectionMatrix:new THREE.Matrix4().makeScale(1,4/3,1).elements})
  const matched=sample(f)
  assert(matched,'coarse source-backed front-facing cells should qualify')
  closeVector(matched.wallColorMultiplier,ratio,.05)
 }
 // Inaccurate/thin/small projections may reject; they must never fabricate a
 // dark correction from an unchanged source. This guards the initial .6 bug.
 for(const scale of [1.55,1.65]){
  const f=fixture();Object.assign(f,{reference:real,frame:{rows:artwork.rows,cols:artwork.cols,rowBytes:artwork.rowBytes,pixels:actualPixels},
   panelMatrix:new THREE.Matrix4().makeScale(scale,scale,1).elements,viewProjectionMatrix:new THREE.Matrix4().makeScale(1,4/3,1).elements})
  const matched=sample(f);if(matched)closeVector(matched.wallColorMultiplier,[1,1,1],.05)
 }
 for(const rgb of [[64,52,35],[20,40,230],[230,180,100]]){
  const pixels=Uint8Array.from(actualPixels)
  for(let i=0;i<pixels.length;i+=4)pixels.set([...rgb,255],i)
  const f=fixture();Object.assign(f,{reference:real,frame:{rows:artwork.rows,cols:artwork.cols,rowBytes:artwork.rowBytes,pixels},viewProjectionMatrix:new THREE.Matrix4().makeScale(1,4/3,1).elements})
  assert.equal(sample(f),null,'a flat foreground/background cannot fit the actual spatial artwork')
 }
 console.log('PASS wall reference match: linear RGB/exposure ratios, bounded output, asymmetric cover/letterbox/portrait/landscape projection and padded rows; contamination/outlier rejection; clipping, support, pose/frame/identity gates; deterministic source-backed reference grid.')
}
if(require.main===module)run()
module.exports=run
