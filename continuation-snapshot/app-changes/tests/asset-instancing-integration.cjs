'use strict'
// Independent CPU integration with the real runtime modules. A renderer capability
// fixture permits shader construction; it does not compile GLSL or prove GPU output.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')

function load(file,name,extras={}){
  const context={console,AbortController,...extras}
  vm.createContext(context)
  const source=fs.readFileSync(path.join(__dirname,'../src/full-wall',file),'utf8')
    .replace(/^import .*$/mg,'').replace(/export (function|const|class)/g,'$1')
  vm.runInContext(source+'\nglobalThis.result='+name,context,{filename:file})
  return context.result
}
const dependencies={}
for(const [file,name] of [
  ['animation-runtime','createWallAnimation'],['machine-effects','createMachineEffects'],
  ['experience-polish','createExperiencePolish'],['environment-lighting','createEnvironmentLighting'],['connector-appearance','applyConnectorAppearance'],
  ['border-extension','createBorderExtension'],['asset-instancing','createAssetInstancing'],
])dependencies[name]=load('runtime/'+file+'.js',name)
const createFullWallEffects=load('index.js','createFullWallEffects',dependencies)
const rendererCapabilities={capabilities:{isWebGL2:true,maxVertexUniforms:256}}

function fixture(unique=true){
  const model=new THREE.Group(),texture=new THREE.Texture()
  const material=new THREE.MeshStandardMaterial({map:texture})
  const geometry=new THREE.BoxGeometry(.1,.12,.02);geometry.clearGroups()
  const a=new THREE.Mesh(geometry,material),b=new THREE.Mesh(unique?geometry.clone():geometry,material)
  if(unique)b.geometry.attributes.uv.array[0]+=.2
  a.name='independent-gear-A';b.name='independent-gear-B'
  a.userData.animation_role=b.userData.animation_role='gear'
  a.position.x=-.2;b.position.set(.2,.1,.03);model.add(a,b)
  return {model,texture,material,geometry,a,b}
}

function movingParentOracle(){
  let sourceChecks=0,maxNormalError=0,maxPositionError=0
  for(const unique of [false,true]){
    const f=fixture(unique)
    f.model.rotation.set(.13,.21,.017);f.model.scale.set(.8,1.1,.65)
    const owner=dependencies.createAssetInstancing({THREE,model:f.model,renderer:rendererCapabilities})
    const batch=f.model.children.find(object=>object.userData.assetInstancing)
    assert(batch,'Valid affine rounding must not reject batch creation')
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader}
    if(unique)batch.material.onBeforeCompile(shader)
    for(let i=1;i<=80;i++){
      f.model.position.set(i*.01,-.3,.2)
      f.model.rotation.set(.13,.21,i*.017);f.model.scale.set(.8+i*.001,1.1,.65)
      f.a.rotation.set(i*.003,i*.005,i*.013)
      f.b.rotation.set(i*.005,i*.002,-i*.011);f.b.scale.set(.6+i*.005,1.3,.8)
      owner.update()
      assert.equal(owner.getDiagnostics().groupCount,1,'Moving tracked ancestor retains batching')
      for(const [index,source] of [f.a,f.b].entries()){
        const local=unique?shader.uniforms.wallGearMatrices.value[index]:new THREE.Matrix4()
        if(!unique)batch.getMatrixAt(index,local)
        const elements=local.elements,normal=new THREE.Vector3(.23,.68,.31).normalize()
        const expected=normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(source.matrixWorld)).normalize()
        const actual=normal.clone().divide(new THREE.Vector3(
          elements[0]**2+elements[1]**2+elements[2]**2,
          elements[4]**2+elements[5]**2+elements[6]**2,
          elements[8]**2+elements[9]**2+elements[10]**2,
        )).applyMatrix3(new THREE.Matrix3().setFromMatrix4(local))
          .applyMatrix3(new THREE.Matrix3().getNormalMatrix(batch.matrixWorld)).normalize()
        const normalError=actual.distanceTo(expected)
        maxNormalError=Math.max(maxNormalError,normalError)
        assert(normalError<(unique?1e-10:1e-6),'World normal matches independent inverse-transpose oracle')
        const vertex=new THREE.Vector3(.04,.01,.005)
        const positionError=vertex.clone().applyMatrix4(local).applyMatrix4(batch.matrixWorld)
          .distanceTo(vertex.clone().applyMatrix4(source.matrixWorld))
        maxPositionError=Math.max(maxPositionError,positionError)
        assert(positionError<(unique?1e-10:1e-6),'World vertex placement remains source-identical')
        sourceChecks++
      }
    }
    owner.dispose();assert.equal(f.a.layers.mask,1);assert.equal(f.b.layers.mask,1)
  }
  return {sourceChecks,maxNormalError,maxPositionError}
}

async function integratedLifecycle(){
  const f=fixture(),sign=new THREE.Mesh(new THREE.BoxGeometry(.3,.1,.01),new THREE.MeshStandardMaterial())
  sign.name='Sign';sign.position.y=.3
  sign.userData={animation_role:'signboard',sign_width:.3,sign_height:.1};f.model.add(sign)
  const listeners=new Map(),document={hidden:false,
    addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(callback)},
    removeEventListener(type,callback){listeners.get(type)?.delete(callback)},
  }
  const camera=new THREE.PerspectiveCamera(40,1,.01,10);camera.position.z=2;camera.updateMatrixWorld()
  const sceneEl={object3D:new THREE.Scene(),camera,
    renderer:{...rendererCapabilities,toneMapping:THREE.NoToneMapping,toneMappingExposure:1}}
  const effects=createFullWallEffects({THREE,model:f.model,sceneEl,document,now:()=>1000})
  sceneEl.object3D.add(effects.object3D);await effects.ready
  let diagnostics=effects.getDiagnostics()
  assert.equal(diagnostics.assetInstancing.paletteGroupCount,1,'Actual index creates the gear palette')
  assert.equal(diagnostics.assetInstancing.standardGroupCount,1,'Actual polish creates exact repeated sign lamps')
  const palette=f.model.children.find(object=>object.name==='ExactGearTransformPalette')
  const disposals={texture:0,material:0,geometry:0,paletteGeometry:0,paletteMaterial:0}
  for(const [resource,key] of [[f.texture,'texture'],[f.material,'material'],[f.geometry,'geometry'],
    [palette.geometry,'paletteGeometry'],[palette.material,'paletteMaterial']]){
    resource.addEventListener('dispose',()=>disposals[key]++)
  }
  effects.setTracked(true)
  for(let i=0;i<80;i++){
    effects.object3D.rotation.set(.02,.03,i*.001);effects.object3D.scale.set(.8,1.1,.65)
    effects.update({deltaMs:16,nowMs:i*16})
    assert.equal(effects.getDiagnostics().assetInstancing.paletteGroupCount,1)
  }
  effects.setLightingMode('camera')
  effects.setCameraLighting({source:'camera-rgb',gain:1.4,color:[1.1,.95,.9]})
  effects.update({deltaMs:100,nowMs:1400})
  assert.equal(palette.material.envMapIntensity,f.material.envMapIntensity,'Camera light reaches palette clone')
  assert(palette.material.color.equals(f.material.color))
  effects.setLightingMode('studio')
  assert.equal(palette.material.envMapIntensity,f.material.envMapIntensity,'Studio reset immediately syncs clone')
  assert(effects.interact('gear',f.a.name));assert(effects.getDiagnostics().overdrive)
  effects.reset();assert(f.a.quaternion.equals(new THREE.Quaternion()))
  effects.setReducedMotion(true);assert(f.a.quaternion.equals(new THREE.Quaternion()))
  effects.setReducedMotion(false);effects.update({deltaMs:16,nowMs:1500})
  const phase=f.a.quaternion.clone()
  assert(effects.suspendTracking());assert(!effects.object3D.visible)
  effects.setTracked(true);assert(f.a.quaternion.equals(phase),'Brief loss preserves source phase')
  effects.setTracked(false);assert(f.a.quaternion.equals(new THREE.Quaternion()),'Stop resets original gear')
  effects.setTracked(true);effects.object3D.rotation.set(0,0,0);effects.object3D.scale.setScalar(1)
  f.model.updateWorldMatrix(true,true)
  const projected=f.a.getWorldPosition(new THREE.Vector3()).project(camera)
  const touch=effects.interactAt((projected.x+1)*250,(1-projected.y)*250,
    {getBoundingClientRect(){return {left:0,top:0,width:500,height:500}}})
  assert(touch&&touch.action==='gear'&&touch.part===f.a.name,'Screen touch resolves authored source identity')
  document.hidden=true
  for(const callback of [...listeners.get('visibilitychange')])callback()
  assert(!effects.object3D.visible);assert.equal(effects.getDiagnostics().tracked,false)
  effects.dispose();effects.dispose()
  assert.deepEqual(disposals,{texture:1,material:1,geometry:1,paletteGeometry:1,paletteMaterial:1})
  assert.equal([...listeners.values()].reduce((sum,set)=>sum+set.size,0),0)
  assert.equal(sceneEl.renderer.toneMapping,THREE.NoToneMapping)
  return {touch,disposals}
}

async function main(){
  const oracle=movingParentOracle(),lifecycle=await integratedLifecycle()
  console.log(JSON.stringify({status:'PASS',scope:'Independent actual-runtime CPU integration; no GLSL compilation, GPU/visual or phone acceptance',oracle,lifecycle},null,2))
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={movingParentOracle,integratedLifecycle}
