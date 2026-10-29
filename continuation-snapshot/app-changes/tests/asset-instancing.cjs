'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
function load(file,name){const c={console};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/full-wall/runtime/',file+'.js'),'utf8').replace(/export (function|const)/g,'$1')+'\nglobalThis.result='+name,c);return c.result}
const create=load('asset-instancing','createAssetInstancing')
const animCreate=load('animation-runtime','createWallAnimation')
const polishCreate=load('experience-polish','createExperiencePolish')
let cases=0
function check(name,fn){fn();cases++;console.log('PASS '+name)}
function fixture({cloneGeometry=false,cloneMaterial=false}={}){
 const model=new THREE.Group(),geometry=new THREE.BoxGeometry(.1,.12,.02),material=new THREE.MeshStandardMaterial()
 const a=new THREE.Mesh(geometry,material),b=new THREE.Mesh(cloneGeometry?geometry.clone():geometry,cloneMaterial?material.clone():material)
 a.name='A';b.name='B';a.userData.animation_role=b.userData.animation_role='gear';a.position.x=-.2;b.position.set(.2,.1,.03);model.add(a,b)
 return {model,geometry,material,a,b}
}
function batch(model){return model.children.find(c=>c.isInstancedMesh)}
function matrixClose(a,b){a.elements.forEach((v,i)=>assert(Math.abs(v-b.elements[i])<1e-6,`matrix element ${i}: ${v} vs ${b.elements[i]}`))}
check('exact clones batch; source anchors stay visible with same geometry/material and independent matrices',()=>{
 const {model,a,b}=fixture({cloneGeometry:true}),fx=create({THREE,model}),mesh=batch(model)
 assert(mesh);assert.equal(mesh.count,2);assert.equal(fx.getDiagnostics().drawCallsSaved,1)
 assert.equal(a.visible,true);assert.equal(a.layers.mask,0);assert.equal(mesh.layers.mask,1)
 a.rotation.z=.7;b.rotation.z=-.3;b.scale.set(1.5,.8,2);fx.update();const m=new THREE.Matrix4()
 for(const [i,source]of [a,b].entries()){mesh.getMatrixAt(i,m);matrixClose(m,source.matrixWorld)}
 assert.equal(fx.resolveIntersection({object:mesh,instanceId:1}),b);assert.equal(fx.resolveIntersection({object:a,instanceId:0}),null)
 fx.dispose();assert.equal(a.layers.mask,1);assert.equal(b.layers.mask,1);assert.equal(batch(model),undefined)
})
check('nested/model transforms preserve authored vertex placement under batching',()=>{
 const {model,a,b}=fixture();model.position.set(2,-3,4);model.rotation.set(.1,.2,.3);model.scale.setScalar(.4)
 const parent=new THREE.Group();parent.position.set(.01,.07,-.1);parent.rotation.z=.22;model.add(parent);parent.add(b)
 const fx=create({THREE,model}),mesh=batch(model),m=new THREE.Matrix4(),vertex=new THREE.Vector3(.03,.04,.005)
 mesh.getMatrixAt(1,m);const expected=vertex.clone().applyMatrix4(b.matrixWorld),actual=vertex.clone().applyMatrix4(m).applyMatrix4(mesh.matrixWorld)
 assert(actual.distanceTo(expected)<1e-6);fx.dispose()
})
check('child/ancestor visibility compacts instances without changing source visibility or identities',()=>{
 const {model,a,b}=fixture();const parent=new THREE.Group();model.add(parent);parent.add(b);const fx=create({THREE,model}),mesh=batch(model)
 a.visible=false;fx.update();assert.equal(mesh.count,1);assert.equal(fx.resolveIntersection({object:mesh,instanceId:0}),b)
 parent.visible=false;fx.update();assert.equal(mesh.count,0);assert.equal(mesh.visible,false)
 a.visible=true;parent.visible=true;fx.update();assert.equal(mesh.count,2);assert.equal(mesh.visible,true);fx.dispose()
})
check('static instance matrices do not request repeated GPU uploads; moving instances refresh aggregate culling bounds',()=>{
 const {model,b}=fixture(),fx=create({THREE,model}),mesh=batch(model),version=mesh.instanceMatrix.version,radius=mesh.boundingSphere.radius
 fx.update();assert.equal(mesh.instanceMatrix.version,version);b.position.x=3;fx.update();assert(mesh.instanceMatrix.version>version);assert(mesh.boundingSphere.radius>radius);fx.dispose()
})
check('dispose releases only instance resources once; shared geometry/material/texture remain owned by caller',()=>{
 const {model,geometry,material}=fixture(),texture=new THREE.Texture();material.map=texture;const events={g:0,m:0,t:0,i:0}
 geometry.addEventListener('dispose',()=>events.g++);material.addEventListener('dispose',()=>events.m++);texture.addEventListener('dispose',()=>events.t++)
 const fx=create({THREE,model});batch(model).addEventListener('dispose',()=>events.i++);fx.dispose();fx.dispose();fx.update();assert.deepEqual(events,{g:0,m:0,t:0,i:1})
})
for(const [label,alter]of [
 ['different UVs',f=>{f.b.geometry=f.geometry.clone();f.b.geometry.attributes.uv.array[0]+=.125}],
 ['different normals',f=>{f.b.geometry=f.geometry.clone();f.b.geometry.attributes.normal.array[0]=.25}],
 ['different indices',f=>{f.b.geometry=f.geometry.clone();f.b.geometry.index.array[0]=3}],
 ['different cloned materials',f=>f.b.material=f.material.clone()],
 ['transparent material',f=>f.material.transparent=true],
 ['transmissive material',f=>{f.material.transmission=.5}],
 ['object-space normal map',f=>{f.material.normalMap=new THREE.Texture();f.material.normalMapType=THREE.ObjectSpaceNormalMap}],
 ['mirrored transform',f=>f.b.scale.x=-1],
 ['sheared transform',f=>{f.b.matrixAutoUpdate=false;f.b.matrix.makeShear(.1,0,0,0,0,0)}],
 ['projective transform',f=>{f.b.matrixAutoUpdate=false;f.b.matrix.elements[3]=.01}],
 ['non-affine homogeneous component',f=>{f.b.matrixAutoUpdate=false;f.b.matrix.elements[15]=1.1}],
 ['different layers',f=>f.b.layers.set(1)],
 ['different render order',f=>f.b.renderOrder=2],
 ['different shadows',f=>f.b.castShadow=true],
 ['custom rendering',f=>f.b.onBeforeRender=()=>{}],
 ['morph geometry',f=>{f.b.geometry=f.geometry.clone();f.b.geometry.morphAttributes.position=[f.geometry.attributes.position.clone()]}],
 ['ordered ancestor',f=>{const parent=new THREE.Group();parent.renderOrder=3;f.model.add(parent);parent.add(f.b)}]
])check('reject '+label,()=>{const f=fixture();alter(f);const fx=create({THREE,model:f.model});assert.equal(fx.getDiagnostics().groupCount,0);assert.equal(f.a.layers.mask,1);assert.equal(f.b.layers.mask,label==='different layers'?2:1);fx.dispose()})
for(const [label,alter]of [
 ['per-source material clone',f=>f.b.material=f.material.clone()],
 ['geometry update',f=>{f.geometry.attributes.position.array[0]+=.01;f.geometry.attributes.position.needsUpdate=true}],
 ['attribute replacement',f=>f.geometry.setAttribute('position',f.geometry.attributes.position.clone())],
 ['layer edit',f=>f.b.layers.set(2)],
 ['mirrored motion',f=>f.b.scale.x=-1],
 ['detach',f=>f.b.removeFromParent()],
 ['transparency edit',f=>f.material.transparent=true]
 ,['object-space normal-map edit',f=>{f.material.normalMap=new THREE.Texture();f.material.normalMapType=THREE.ObjectSpaceNormalMap}]
])check('restore source draws safely after '+label,()=>{
 const f=fixture(),fx=create({THREE,model:f.model});assert.equal(fx.getDiagnostics().groupCount,1);alter(f);fx.update();assert.equal(fx.getDiagnostics().groupCount,0)
 assert.equal(f.a.layers.mask,1);assert.equal(f.b.layers.mask,label==='layer edit'?4:1);assert.equal(batch(f.model),undefined);fx.dispose()
})
check('real gear animation, reduced motion, tracking loss, reset and stop propagate to matrices',()=>{
 const {model,a,b}=fixture(),animation=animCreate({THREE,model}),fx=create({THREE,model}),mesh=batch(model),m=new THREE.Matrix4()
 const sync=()=>{fx.update();for(const[i,source]of[a,b].entries()){mesh.getMatrixAt(i,m);matrixClose(m,source.matrixWorld)}}
 animation.setTracked(true);animation.setRunning(true);animation.update(100,100);sync();assert(!a.quaternion.equals(new THREE.Quaternion()))
 animation.setReducedMotion(true);sync();assert(a.quaternion.equals(new THREE.Quaternion()))
 animation.setReducedMotion(false);animation.update(100,200);sync();animation.reset();sync()
 animation.setTracked(false);sync();assert(a.quaternion.equals(new THREE.Quaternion()))
 animation.setRunning(false);animation.update(100,300);sync();fx.dispose();animation.dispose()
})
check('real sign decoration six repeated lamps batch while shared animated colour and sign action stay intact',()=>{
 const model=new THREE.Group(),sign=new THREE.Mesh(new THREE.BoxGeometry(.3,.1,.01),new THREE.MeshStandardMaterial());sign.name='Sign';sign.userData={animation_role:'signboard',sign_width:.3,sign_height:.1};model.add(sign)
 const document={hidden:false,addEventListener(){},removeEventListener(){}},polish=polishCreate({THREE,model,document}),fx=create({THREE,model})
 assert.equal(fx.getDiagnostics().sourceMeshCount,6);assert.equal(fx.getDiagnostics().drawCallsSaved,5)
 polish.update(16,16,{running:true,tracked:true,startup:1});assert(polish.interact('sign','Sign'));fx.update();assert.equal(fx.getDiagnostics().groupCount,1)
 assert(polish.getInteractionTargets()[0].object===sign);fx.dispose();polish.dispose()
})
check('disabled mode preserves every source draw',()=>{const {model,a,b}=fixture(),fx=create({THREE,model,enabled:false});assert.equal(fx.getDiagnostics().groupCount,0);assert.equal(a.layers.mask,1);assert.equal(b.layers.mask,1);fx.dispose()})
check('WebGL1 without ANGLE instancing retains original source draws',()=>{
 const {model,a,b}=fixture(),fx=create({THREE,model,renderer:{capabilities:{isWebGL2:false,maxVertexUniforms:256},extensions:{has:()=>false}}})
 assert.equal(fx.getDiagnostics().groupCount,0);assert.equal(a.layers.mask,1);assert.equal(b.layers.mask,1);fx.dispose()
})
check('WebGL1 with ANGLE supports standard instances while gear palettes remain off',()=>{
 const {model}=fixture(),fx=create({THREE,model,renderer:{capabilities:{isWebGL2:false,maxVertexUniforms:256},extensions:{has:name=>name==='ANGLE_instanced_arrays'}}})
 assert.equal(fx.getDiagnostics().standardGroupCount,1);assert.equal(fx.getDiagnostics().paletteGroupCount,0);fx.dispose()
})
const renderer={capabilities:{isWebGL2:true,maxVertexUniforms:256}}
function uniqueFixture(){const f=fixture({cloneGeometry:true});f.geometry.clearGroups();f.b.geometry.clearGroups();f.b.geometry.attributes.uv.array[0]+=.2;f.b.geometry.attributes.position.array[0]+=.01;return f}
for(const palette of [false,true])check(`${palette?'palette':'standard instance'} survives actual affine roundoff and moving rotated/nonuniformly scaled tracked parent`,()=>{
 const f=palette?uniqueFixture():fixture(),parent=new THREE.Group();parent.add(f.model)
 f.model.rotation.set(.13,.21,.017);f.model.scale.set(.8,1.1,.65)
 f.a.rotation.set(.003,.005,.013);f.b.rotation.set(.005,.002,-.011);f.b.scale.set(.605,1.3,.8)
 f.model.updateWorldMatrix(true,true)
 const relative=new THREE.Matrix4().copy(f.model.matrixWorld).invert().multiply(f.b.matrixWorld)
 assert.notEqual(relative.elements[15],1,'fixture must reproduce genuine inverse/multiply floating-point roundoff')
 const fx=create({THREE,model:f.model,renderer}),diagnostics=fx.getDiagnostics()
 assert.equal(palette?diagnostics.paletteGroupCount:diagnostics.standardGroupCount,1)
 const mesh=f.model.children.find(o=>o.userData.assetInstancing),shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader}
 if(palette)mesh.material.onBeforeCompile(shader)
 for(let i=0;i<30;i++){
  parent.rotation.set(.1+i*.007,-.03+i*.013,.19-i*.002);parent.scale.set(.7+i*.001,1.2-i*.001,.9+i*.002);parent.position.set(i*.001,-i*.002,i*.0004)
  f.model.rotation.z+=.003;f.b.rotation.z-=.017;fx.update()
  assert.equal(palette?fx.getDiagnostics().paletteGroupCount:fx.getDiagnostics().standardGroupCount,1,'ordinary parent/gear motion must never release batch')
  for(const[index,source]of[f.a,f.b].entries()){
   const actual=palette?shader.uniforms.wallGearMatrices.value[index]:new THREE.Matrix4()
   if(!palette)mesh.getMatrixAt(index,actual)
   matrixClose(actual,source.matrix);assert.equal(actual.elements[15],1)
  }
 }
 fx.dispose()
})
check('unique authored gear geometry uses an honest transform palette preserving ALL vertex/UV/normal/index values',()=>{
 const f=uniqueFixture(),fx=create({THREE,model:f.model,renderer}),d=fx.getDiagnostics(),mesh=f.model.children.find(c=>c.name==='ExactGearTransformPalette')
 assert.equal(d.standardGroupCount,0);assert.equal(d.paletteGroupCount,1);assert.equal(d.drawCallsSaved,1);assert(mesh)
 const offset=f.geometry.attributes.position.count
 for(const key of Object.keys(f.geometry.attributes)){
  const size=f.geometry.attributes[key].itemSize,combined=mesh.geometry.attributes[key].array
  assert.deepEqual(Array.from(combined.slice(0,offset*size)),Array.from(f.geometry.attributes[key].array))
  assert.deepEqual(Array.from(combined.slice(offset*size)),Array.from(f.b.geometry.attributes[key].array))
 }
 const indices=mesh.geometry.index.array,n=f.geometry.index.count
 assert.deepEqual(Array.from(indices.slice(0,n)),Array.from(f.geometry.index.array))
 assert.deepEqual(Array.from(indices.slice(n)),Array.from(f.b.geometry.index.array,value=>value+offset))
 const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader};mesh.material.onBeforeCompile(shader)
 assert(shader.vertexShader.includes('wallGearMatrices[2]'));assert(shader.vertexShader.includes('objectNormal=wallGearNormal*'))
 f.a.rotation.z=.4;f.b.rotation.z=-.7;f.b.scale.set(1.5,.8,2);fx.update()
 const matrices=shader.uniforms.wallGearMatrices.value
 matrixClose(matrices[0],f.a.matrixWorld);matrixClose(matrices[1],f.b.matrixWorld)
 // Independent normal oracle: inverse-transpose, compared to the shader's TRS rule.
 const normal=new THREE.Vector3(.2,.7,.4).normalize(),m=matrices[1],normalExpected=normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(f.b.matrixWorld)).normalize(),e=m.elements
 const corrected=normal.clone().divide(new THREE.Vector3(e[0]**2+e[1]**2+e[2]**2,e[4]**2+e[5]**2+e[6]**2,e[8]**2+e[9]**2+e[10]**2)).applyMatrix3(new THREE.Matrix3().setFromMatrix4(m)).normalize()
 assert(corrected.distanceTo(normalExpected)<1e-10)
 f.material.color.setRGB(.6,.7,.8);f.material.envMapIntensity=.37;fx.update();assert(mesh.material.color.equals(f.material.color));assert.equal(mesh.material.envMapIntensity,.37)
 f.b.visible=false;fx.update();assert.equal(matrices[1].elements[15],0);assert.equal(d.palettes[0].kind,'unique-geometry-transform-palette')
 fx.dispose();assert.equal(f.a.layers.mask,1);assert.equal(f.b.layers.mask,1)
})
check('palette resources have one owner and shared atlas survives disposal',()=>{
 const f=uniqueFixture(),texture=new THREE.Texture();f.material.map=texture;let shared=0,owned=0
 f.geometry.addEventListener('dispose',()=>shared++);f.material.addEventListener('dispose',()=>shared++);texture.addEventListener('dispose',()=>shared++)
 const fx=create({THREE,model:f.model,renderer}),mesh=f.model.children.find(c=>c.name==='ExactGearTransformPalette')
 mesh.geometry.addEventListener('dispose',()=>owned++);mesh.material.addEventListener('dispose',()=>owned++);fx.dispose();fx.dispose();assert.equal(owned,2);assert.equal(shared,0)
})
for(const [label,modify]of [
 ['WebGL1',o=>o.renderer={capabilities:{isWebGL2:false,maxVertexUniforms:1024}}],
 ['insufficient vertex uniforms',o=>o.renderer={capabilities:{isWebGL2:true,maxVertexUniforms:132}}],
 ['absent renderer capabilities',o=>delete o.renderer],
 ['explicitly disabled palette',o=>o.paletteEnabled=false],
 ['custom source shader',(o,f)=>f.material.onBeforeCompile=()=>{}],
 ['displacement map',(o,f)=>f.material.displacementMap=new THREE.Texture()],
 ['object-space normal map',(o,f)=>{f.material.normalMap=new THREE.Texture();f.material.normalMapType=THREE.ObjectSpaceNormalMap}],
 ['shadow casting',(o,f)=>{f.a.castShadow=true;f.b.castShadow=true}],
 ['incompatible materials',(o,f)=>f.b.material=f.material.clone()]
])check('palette fail closed: '+label,()=>{const f=uniqueFixture(),o={THREE,model:f.model,renderer};modify(o,f);const fx=create(o);assert.equal(fx.getDiagnostics().paletteGroupCount,0);assert.equal(f.a.layers.mask,1);fx.dispose()})
for(const [label,modify]of [
 ['material clone',f=>f.b.material=f.material.clone()],
 ['source shader version',f=>f.material.needsUpdate=true],
 ['source transform mirror',f=>f.b.scale.x=-1],
 ['geometry version',f=>f.geometry.attributes.uv.needsUpdate=true],
 ['source shader edit',f=>f.material.onBeforeCompile=()=>{}]
 ,['object-space normal-map edit',f=>{f.material.normalMap=new THREE.Texture();f.material.normalMapType=THREE.ObjectSpaceNormalMap}]
])check('palette restores original exact draws after '+label,()=>{const f=uniqueFixture(),fx=create({THREE,model:f.model,renderer});assert.equal(fx.getDiagnostics().paletteGroupCount,1);modify(f);fx.update();assert.equal(fx.getDiagnostics().paletteGroupCount,0);assert.equal(f.a.layers.mask,1);assert.equal(f.b.layers.mask,1);fx.dispose()})
check('palette exact raycast returns the original gear and per-source visibility still applies',()=>{
 const f=uniqueFixture(),fx=create({THREE,model:f.model,renderer}),mesh=f.model.children.find(c=>c.name==='ExactGearTransformPalette'),raycaster=new THREE.Raycaster(new THREE.Vector3(-.2,0,1),new THREE.Vector3(0,0,-1)),hits=[]
 mesh.raycast(raycaster,hits);assert(hits.some(hit=>hit.object===f.a));f.a.visible=false;const hidden=[];mesh.raycast(raycaster,hidden);assert.equal(hidden.length,0);fx.dispose()
})
console.log(`PASS asset instancing ${cases} cases; CPU geometry/transform/resource/real-animation checks, no visual or native-phone acceptance claim.`)
