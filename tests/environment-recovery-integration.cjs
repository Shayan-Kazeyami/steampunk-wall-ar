'use strict'
// Actual full-wall/runtime ownership with real Three CPU objects and a PMREM
// double. This checks startup/recovery races, not real WebGL output.
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const BaseTHREE=require('../tools/verification/node_modules/three/build/three.cjs')
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve()}
function hdr(){return Uint8Array.from(Buffer.concat([
  Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n'),Buffer.from([128,100,60,129]),
])).buffer}
function load(file,name,extras={}){
  const context={console,AbortController,setTimeout,clearTimeout,...extras};vm.createContext(context)
  const source=fs.readFileSync(path.join(__dirname,'../src/full-wall',file),'utf8')
    .replace(/^import .*$/mg,'').replace(/export (function|const|class)/g,'$1')
  vm.runInContext(source+'\nglobalThis.result='+name,context,{filename:file});return context.result
}
const dependencies={}
for(const [file,name] of [
  ['animation-runtime','createWallAnimation'],['machine-effects','createMachineEffects'],
  ['experience-polish','createExperiencePolish'],['environment-lighting','createEnvironmentLighting'],['connector-appearance','applyConnectorAppearance'],
  ['border-extension','createBorderExtension'],['asset-instancing','createAssetInstancing'],
])dependencies[name]=load('runtime/'+file+'.js',name)
const createFullWallEffects=load('index.js','createFullWallEffects',dependencies)

function fixture({fetchFailure=false}={}){
  const body=deferred(),canvasListeners=new Map(),documentListeners=new Map()
  const counts={fetch:0,generation:0,targetDisposed:0,temporaryTexture:0,temporaryTextureDisposed:0,generatorDisposed:0}
  let lost=false,environment
  const canvas={
    addEventListener(type,callback){if(!canvasListeners.has(type))canvasListeners.set(type,new Set());canvasListeners.get(type).add(callback)},
    removeEventListener(type,callback){canvasListeners.get(type)?.delete(callback)},
  }
  const THREE={...BaseTHREE,
    DataTexture:class extends BaseTHREE.DataTexture {
      constructor(...args){super(...args);counts.temporaryTexture++}
      dispose(){counts.temporaryTextureDisposed++;super.dispose()}
    },
    PMREMGenerator:class {
      compileEquirectangularShader(){assert(!lost,'Cannot generate while lost')}
      fromEquirectangular(){
        assert(!lost);counts.generation++
        const texture=new BaseTHREE.Texture();let disposed=false
        return {texture,dispose(){assert(!disposed,'Owned target disposed once');disposed=true;counts.targetDisposed++;texture.dispose()}}
      }
      dispose(){counts.generatorDisposed++}
    },
  }
  const model=new THREE.Group(),atlas=new THREE.Texture(),material=new THREE.MeshStandardMaterial({map:atlas})
  material.envMapIntensity=2
  const geometry=new THREE.BoxGeometry(.1,.12,.02);geometry.clearGroups()
  const a=new THREE.Mesh(geometry,material),b=new THREE.Mesh(geometry.clone(),material)
  b.geometry.attributes.uv.array[0]+=.2;a.position.x=-.2;b.position.x=.2
  a.userData.animation_role=b.userData.animation_role='gear';model.add(a,b)
  const document={hidden:false,
    addEventListener(type,callback){if(!documentListeners.has(type))documentListeners.set(type,new Set());documentListeners.get(type).add(callback)},
    removeEventListener(type,callback){documentListeners.get(type)?.delete(callback)},
  }
  const priorEnvironment=new THREE.Texture(),scene=new THREE.Scene();scene.environment=priorEnvironment
  const sceneEl={object3D:scene,renderer:{domElement:canvas,getContext(){return {isContextLost:()=>lost}},
    capabilities:{isWebGL2:true,maxVertexUniforms:256},toneMapping:THREE.NoToneMapping,toneMappingExposure:1}}
  const effects=createFullWallEffects({THREE,model,sceneEl,document,environmentUrl:'fixture.hdr',now:()=>1000,
    factories:{createEnvironmentLighting(options){
      environment=dependencies.createEnvironmentLighting({...options,fetch(){
        counts.fetch++
        return fetchFailure?Promise.reject(new Error('independent HDR failure'))
          :Promise.resolve({ok:true,arrayBuffer:()=>body.promise})
      }})
      return environment
    }},
  })
  const palette=model.children.find(object=>object.name==='ExactGearTransformPalette')
  assert(palette)
  return {THREE,effects,environment,body,scene,priorEnvironment,material,palette,counts,canvasListeners,documentListeners,
    attach(){scene.add(effects.object3D)},
    lose(){lost=true;for(const callback of canvasListeners.get('webglcontextlost')||[])callback({preventDefault(){}})},
    restore(){lost=false;for(const callback of canvasListeners.get('webglcontextrestored')||[])callback()},
  }
}
function materialState(material){return {
  intensity:material.envMapIntensity,version:material.version,color:material.color.toArray(),
  emissive:material.emissive.toArray(),emissiveIntensity:material.emissiveIntensity,
  metalness:material.metalness,roughness:material.roughness,map:material.map,
}}
function assertIntensity(h,value){
  assert.equal(h.material.envMapIntensity,value,'Authored source multiplier')
  assert.equal(h.palette.material.envMapIntensity,value,'Palette clone multiplier')
}
function assertReleased(h){
  assert.equal(h.environment.state.sourceBytes,0)
  assert.equal(h.counts.targetDisposed,h.counts.generation)
  assert.equal(h.counts.temporaryTextureDisposed,h.counts.temporaryTexture)
  assert.equal(h.counts.generatorDisposed,h.counts.generation)
  assert.equal([...h.canvasListeners.values()].reduce((sum,set)=>sum+set.size,0),0)
  assert.equal([...h.documentListeners.values()].reduce((sum,set)=>sum+set.size,0),0)
}

async function main(){
  const results=[]
  // Regression: lost preload resolves before attachment. The coordinator must
  // initialize its authored .72 even though the GPU owner is not ready yet.
  for(const cameraMode of [false,true]){
    const h=fixture();h.lose();h.body.resolve(hdr())
    const state=await h.effects.ready
    assert.equal(state.status,'context-lost');assert.equal(h.counts.generation,0)
    assertIntensity(h,2*.72);h.attach();h.effects.setTracked(true)
    if(cameraMode){
      h.effects.setLightingMode('camera')
      h.effects.setCameraLighting({source:'camera-rgb',gain:1.4,color:[1.1,.95,.9]})
      h.effects.update({deltaMs:100,nowMs:1000})
      const gain=h.effects.getDiagnostics().cameraLighting.gain
      assert(gain>1);assertIntensity(h,2*.72*gain)
    }
    const sourceBefore=materialState(h.material),cloneBefore=materialState(h.palette.material)
    const lightingBefore=JSON.stringify(h.effects.getDiagnostics().cameraLighting)
    h.restore();await flush()
    assert.equal(h.environment.state.status,'ready');assert.equal(h.environment.state.restorations,1)
    assert.deepEqual(materialState(h.material),sourceBefore)
    assert.deepEqual(materialState(h.palette.material),cloneBefore)
    assert.equal(JSON.stringify(h.effects.getDiagnostics().cameraLighting),lightingBefore)
    for(let i=0;i<3;i++){h.lose();h.restore();await flush()}
    assert.equal(h.counts.fetch,1);assert.equal(h.counts.generation,4)
    assert.deepEqual(materialState(h.material),sourceBefore)
    assert.deepEqual(materialState(h.palette.material),cloneBefore)
    h.effects.dispose();h.effects.dispose();assertReleased(h)
    results.push(cameraMode?'lost preload + camera calibration + four restores':'lost preload + authored studio light + four restores')
  }
  // Fallback still initializes full-wall-owned material values.
  {
    const h=fixture({fetchFailure:true}),state=await h.effects.ready
    assert.equal(state.status,'error');assert.match(state.error,/independent HDR failure/)
    assertIntensity(h,2*.72);assert.equal(h.scene.environment,h.priorEnvironment)
    h.lose();h.restore();await flush();assert.equal(h.counts.generation,0)
    h.effects.dispose();assertReleased(h);results.push('initial HDR failure retains correct authored fallback multipliers')
  }
  // Pending source cannot revive a disposed coordinator or leak listeners.
  {
    const h=fixture();h.lose();h.effects.dispose()
    assert.equal((await h.effects.ready).status,'disposed')
    h.body.resolve(hdr());await flush();assert.equal(h.counts.generation,0)
    h.restore();await flush();assert.equal(h.environment.state.status,'disposed')
    assertReleased(h);results.push('dispose during pending lost preload excludes all late GPU work')
  }
  // Normal ready state followed by another environment owner remains owned by
  // that later owner through loss/restore and source disposal.
  {
    const h=fixture();h.body.resolve(hdr());await h.effects.ready;h.attach()
    const external=new h.THREE.Texture();let externalDisposed=0
    external.addEventListener('dispose',()=>externalDisposed++)
    h.scene.environment=external;const before=materialState(h.material)
    h.lose();h.restore();await flush()
    assert.equal(h.environment.state.status,'superseded');assert.equal(h.scene.environment,external)
    assert.deepEqual(materialState(h.material),before)
    h.effects.dispose();assert.equal(h.scene.environment,external);assert.equal(externalDisposed,0)
    assertReleased(h);results.push('later scene-environment owner survives restoration and disposal')
  }
  console.log(JSON.stringify({status:'PASS',scope:'Independent actual full-wall CPU recovery integration; no WebGL or phone acceptance',results},null,2))
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={main}
