'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
function load(file,name,extras={}){const c={console,AbortController,...extras};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/full-wall/',file),'utf8').replace(/^import .*$/mg,'').replace(/export (const|function)/g,'$1')+'\nglobalThis.result='+name,c);return c.result}
const factories={};for(const[file,name]of[['animation-runtime','createWallAnimation'],['machine-effects','createMachineEffects'],['experience-polish','createExperiencePolish'],['environment-lighting','createEnvironmentLighting'],['connector-appearance','applyConnectorAppearance']])factories[name]=load('runtime/'+file+'.js',name)
const create=load('index.js','createFullWallEffects',factories),model=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:0x888888});material.name='Driveway_Mobile_Atlas'
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.367,-.021,.025,-.366,-.021,.025,-.367,-.020,.025,0,0,0,.01,0,0,0,.01,0],3))
const mesh=new THREE.Mesh(geometry,material);mesh.name='Polished_Static_Fittings_0';model.add(mesh)
const other=new THREE.Mesh(new THREE.BoxGeometry(.01,.01,.01),material);model.add(other)
const sceneEl={object3D:new THREE.Scene(),renderer:{toneMapping:THREE.NoToneMapping,toneMappingExposure:.8}},document={hidden:false,addEventListener(){},removeEventListener(){}}
const fx=create({THREE,model,sceneEl,document});assert.equal(sceneEl.renderer.toneMappingExposure,1)
assert.equal(fx.getDiagnostics().appearance.connectorVertices,3);assert.equal(fx.getDiagnostics().appearance.connectorMeshes,1)
assert.notEqual(mesh.material,material);assert.equal(other.material,material);assert.equal(other.material.vertexColors,false)
const c=mesh.geometry.attributes.color;assert(c.getX(0)>c.getY(0)&&c.getY(0)>c.getZ(0));assert.deepEqual([c.getX(3),c.getY(3),c.getZ(3)],[1,1,1]);assert.equal(mesh.material.map,material.map);assert.equal(mesh.material.roughness,material.roughness)
assert.equal(fx.getDiagnostics().machine.particleCapacity,96);fx.dispose();assert.equal(sceneEl.renderer.toneMappingExposure,.8)
console.log('PASS appearance: measured connector regions receive cloned atlas vertex tint; outside vertices and other metal stay identity; exposure/restoration; fixed96 particle budget. No visual/phone acceptance claim.')
// CPU-only production asset regression: actual Draco positions and glTF node
// transform, with the Group/primitive hierarchy used by GLTFLoader. No GPU.
async function productionAsset(){
 const file=path.join(__dirname,'../src/assets/full-wall/driveway-adaptive.glb'),bytes=fs.readFileSync(file),jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonLength)),binStart=20+jsonLength+8
 const node=gltf.nodes.find(n=>n.name==='Polished_Static_Fittings'),sourceMesh=gltf.meshes[node.mesh]
 assert(sourceMesh.primitives.length>1,'Production source is a multi-primitive node')
 const primitive=sourceMesh.primitives.find(p=>gltf.materials[p.material].name==='Driveway_Mobile_Atlas'),ext=primitive.extensions.KHR_draco_mesh_compression,view=gltf.bufferViews[ext.bufferView]
 const scope={console,setTimeout,clearTimeout,performance,TextDecoder,TextEncoder,WebAssembly,process,require,__dirname};vm.createContext(scope)
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/verification/node_modules/three/examples/jsm/libs/draco/draco_decoder.js'),'utf8'),scope)
 const decoderModule=await scope.DracoDecoderModule({}),decoder=new decoderModule.Decoder(),buffer=new decoderModule.DecoderBuffer(),dracoMesh=new decoderModule.Mesh()
 const packed=bytes.subarray(binStart+(view.byteOffset||0),binStart+(view.byteOffset||0)+view.byteLength);buffer.Init(new Int8Array(packed),packed.length)
 const status=decoder.DecodeBufferToMesh(buffer,dracoMesh);assert(status.ok(),status.error_msg())
 const attribute=decoder.GetAttributeByUniqueId(dracoMesh,ext.attributes.POSITION),decoded=new decoderModule.DracoFloat32Array();assert(decoder.GetAttributeFloatForAllPoints(dracoMesh,attribute,decoded))
 const positions=new Float32Array(dracoMesh.num_points()*3);for(let i=0;i<positions.length;i++)positions[i]=decoded.GetValue(i)
 const faces=new Uint32Array(dracoMesh.num_faces()*3),face=new decoderModule.DracoInt32Array()
 for(let i=0;i<dracoMesh.num_faces();i++){assert(decoder.GetFaceFromMesh(dracoMesh,i,face));for(let c=0;c<3;c++)faces[i*3+c]=face.GetValue(c)}
 const realModel=new THREE.Group(),group=new THREE.Group();group.name=node.name;group.position.fromArray(node.translation);realModel.add(group)
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setIndex(new THREE.BufferAttribute(faces,1));const mat=new THREE.MeshStandardMaterial();mat.name='Driveway_Mobile_Atlas'
 const child=new THREE.Mesh(geo,mat);child.name=sourceMesh.name.replace(/\./g,'');group.add(child)
 const effects=create({THREE,model:realModel,sceneEl:{object3D:new THREE.Scene()},document});const diagnostic=effects.getDiagnostics().appearance
 assert.equal(diagnostic.connectorMeshes,1);assert(diagnostic.connectorVertices>100,'Actual production atlas connector region selects real geometry');assert(diagnostic.connectorTriangles>0);for(let i=0;i<faces.length;i++){const before=faces[i],after=child.geometry.index.getX(i);for(let c=0;c<3;c++)assert.equal(child.geometry.attributes.position.array[after*3+c],positions[before*3+c],'Every actual source triangle position is preserved in original order')} assert(diagnostic.connectorVertices<positions.length/3,'Unrelated atlas vertices remain outside the selection')
 const selected=diagnostic.connectorVertices,total=positions.length/3;effects.dispose()
 for(const value of[face,decoded,dracoMesh,buffer,decoder])decoderModule.destroy(value)
 console.log('PASS production connector selection: '+selected+' of '+total+' vertices; actual Draco/node transform; GLTF multi-primitive parent identity; ten measured pipe chamber unions.')
}
productionAsset().catch(error=>{console.error(error);process.exitCode=1})
