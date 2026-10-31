'use strict'
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
const context={};vm.createContext(context)
vm.runInContext(fs.readFileSync(__dirname+'/../src/full-wall/runtime/connector-appearance.js','utf8').replace(/export (const|function)/g,'$1')+'\nglobalThis.apply=applyConnectorAppearance;globalThis.bounds=CONNECTOR_BOUNDS',context)
assert.equal(context.bounds.length,10)
const model=new THREE.Group(),group=new THREE.Group();group.name='Polished_Static_Fittings';model.add(group)
const mat=new THREE.MeshStandardMaterial({metalness:.6,roughness:.42}),map=new THREE.Texture();mat.name='Driveway_Mobile_Atlas';mat.map=map;mat.emissiveMap=map
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.367,-.021,.025,-.366,-.021,.025,-.367,-.020,.025,0,0,0,-.286543,.032181,.025647],3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,.1,0,0,.1,.5,.5,1,1],2));geometry.setIndex([0,1,2,0,3,4])
let released=false;geometry.addEventListener('dispose',()=>released=true)
const mesh=new THREE.Mesh(geometry,mat);mesh.name='Plane046';group.add(mesh)
const unrelated=new THREE.Mesh(new THREE.BoxGeometry(),mat);model.add(unrelated)
const state=context.apply({THREE,model})
assert.equal(state.connectorVertices,3);assert.equal(state.connectorTriangles,1);assert.equal(state.connectorBoundaryDuplicates,1);assert.equal(state.connectorEmissiveMeshes,1)
assert.notEqual(mesh.material,mat);assert.equal(unrelated.material,mat);assert.equal(released,true)
assert.equal(mesh.material.map,map);assert.equal(mesh.material.emissiveMap,map);assert.equal(mesh.material.metalness,.6);assert.equal(mesh.material.roughness,.42)
assert.notEqual(mesh.geometry,geometry);assert.equal(mesh.geometry.attributes.position.count,6)
const index=mesh.geometry.index,colors=mesh.geometry.attributes.color
for(let tri=0;tri<2;tri++)for(let c=0;c<3;c++){
 const before=geometry.index.getX(tri*3+c),after=index.getX(tri*3+c)
 for(const key of ['position','uv'])for(let k=0;k<geometry.attributes[key].itemSize;k++)assert.equal(mesh.geometry.attributes[key].array[after*geometry.attributes[key].itemSize+k],geometry.attributes[key].array[before*geometry.attributes[key].itemSize+k],'Source triangle attributes must be identical')
 if(tri===0)assert(colors.getX(after)>colors.getY(after)&&colors.getY(after)>colors.getZ(after))
 else assert.deepEqual([colors.getX(after),colors.getY(after),colors.getZ(after)],[1,1,1],'Adjacent long pipe triangle stays uniformly white; no interpolated tint')
}
const shader={fragmentShader:'#include <emissivemap_fragment>\nvec3 outgoingLight=totalEmissiveRadiance;'};mesh.material.onBeforeCompile(shader,{})
assert.equal(shader.fragmentShader.match(/totalEmissiveRadiance \*= vColor.rgb/g).length,1)
const material=mesh.material;context.apply({THREE,model});assert.equal(mesh.material,material)
assert.throws(()=>mesh.material.onBeforeCompile({fragmentShader:'missing'},{}),/missing emissive hook/)
// Nonindexed source path retains source triangle order and contents.
const model2=new THREE.Group(),m2=new THREE.Mesh(geometry.toNonIndexed(),mat);m2.name='Polished_Static_Fittings';model2.add(m2);const s2=context.apply({THREE,model:model2});assert.equal(s2.connectorTriangles,1);assert.equal(s2.connectorBoundaryDuplicates,0)
console.log('PASS connector triangle appearance: same-envelope triangles only; shared boundary split removes interpolation smear; exact source position/UV order preserved; clone disposal; PBR/maps retained; emissive once; nonindexed input; idempotence.')
