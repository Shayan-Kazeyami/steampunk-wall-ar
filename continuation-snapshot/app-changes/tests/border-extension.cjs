'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
const context={};vm.createContext(context)
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/full-wall/runtime/border-extension.js'),'utf8').replace(/export (const|function)/g,'$1')+'\nglobalThis.api={createBorderExtension,DRIVEWAY_BORDER_CONTOUR,DRIVEWAY_BORDER_FRONT_Z}',context)
const{createBorderExtension,DRIVEWAY_BORDER_CONTOUR:contour,DRIVEWAY_BORDER_FRONT_Z:z}=context.api
assert.equal(createBorderExtension({THREE,model:new THREE.Group()}).state.status,'unsupported-model')
function fixture(){
 const model=new THREE.Group(),backing=new THREE.Mesh(new THREE.BoxGeometry(1,.44,.0042),new THREE.MeshBasicMaterial());backing.name='mobile_3_|_DRIVEWAY_WALL';backing.position.z=-.0021;model.add(backing)
 const vertices=[],uv=[];for(const p of contour)for(let i=0;i<2;i++){vertices.push(p[0],p[1],z);uv.push((p[0]+.5)*.3+.1,(p[1]+.23)*.3+.5)}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))
 const texture=new THREE.Texture(),mat=new THREE.MeshStandardMaterial({map:texture,normalMap:texture,aoMap:texture,metalness:.7,roughness:.6});mat.name='Driveway_Mobile_Atlas'
 const group=new THREE.Group(),mesh=new THREE.Mesh(geometry,mat);group.name='Polished_Static_Fittings';group.add(mesh);model.add(group)
 return{model,geometry,mat,texture,backing}
}
const{model,geometry,mat,texture}=fixture(),before=Array.from(geometry.attributes.position.array)
model.position.set(2,3,4);model.rotation.y=.6;model.scale.setScalar(2)
const ext=createBorderExtension({THREE,model});assert.equal(ext.state.status,'ready');assert.equal(ext.state.triangles,256);assert.equal(ext.state.sides,4);assert(Math.abs(ext.state.backZ+.0042)<1e-6)
assert.deepEqual(Array.from(geometry.attributes.position.array),before,'Authored front geometry unchanged')
assert.equal(mat.normalMap,texture);assert.notEqual(ext.object3D.material,mat);assert.equal(ext.object3D.material.map,texture);assert.equal(ext.object3D.material.normalMap,null)
const p=ext.object3D.geometry.attributes.position
for(let side=0;side<4;side++){
 const start=side*66,end=start+64,next=(side+1)%4*66
 for(let axis=0;axis<3;axis++)assert(Math.abs(p.array[end*3+axis]-p.array[next*3+axis])<1e-6,'Adjacent side endpoints coincide')
 for(let i=start;i<start+66;i+=2){assert(Math.abs(p.getZ(i)-z)<1e-6);assert(Math.abs(p.getZ(i+1)-ext.state.backZ)<1e-6)}
}
assert.equal(createBorderExtension({THREE,model}).state.status,'unsupported-model','Duplicate creation is no-op')
let disposedGeometry=0,disposedMaterial=0,disposedTexture=0
ext.object3D.geometry.addEventListener('dispose',()=>disposedGeometry++);ext.object3D.material.addEventListener('dispose',()=>disposedMaterial++);texture.addEventListener('dispose',()=>disposedTexture++)
ext.dispose();ext.dispose();assert.equal(disposedGeometry,1);assert.equal(disposedMaterial,1);assert.equal(disposedTexture,0);assert.equal(model.getObjectByName('SourceBorderSideReturns'),undefined)
const invalid=fixture();invalid.backing.scale.x=3;assert.equal(createBorderExtension({THREE,model:invalid.model}).state.status,'unsupported-model')
console.log('PASS border extension: four closed source-contour returns; real backing depth under parent transforms; front geometry/material preserved; shared texture retained; idempotent disposal; unsupported assets fail closed. Browser visual gate separate.')
