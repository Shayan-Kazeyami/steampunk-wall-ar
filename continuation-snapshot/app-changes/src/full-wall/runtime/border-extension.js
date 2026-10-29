// Source-topology Boundary.040/.049 outer contour, in the existing normalized
// camera frame. The lower edge is sloped in the authored artwork. Do not replace
// it with a rectangular box or use guessed physical measurements.
export const DRIVEWAY_BORDER_CONTOUR=[[-.49999984,-.22116711],[.49999987,-.16688943],[.49999993,.22116553],[-.49999984,.22116553]]
export const DRIVEWAY_BORDER_FRONT_Z=.02749649

// Close the empty gap behind the thin authored perimeter plate. Front geometry,
// atlas, machinery and print backing remain intact. Each return uses colours
// sampled from that same authored perimeter's atlas coordinates.
export function createBorderExtension({THREE,model}){
  const state={status:'unsupported-model',sides:0,triangles:0,frontZ:DRIVEWAY_BORDER_FRONT_Z,backZ:null,atlasSamples:0}
  let mesh=null,disposed=false
  if(!THREE || !model)return {state,dispose(){}}
  let backing=null,atlasMesh=null
  model.traverse(object=>{
    if(['mobile_3 | DRIVEWAY WALL','mobile_3_|_DRIVEWAY_WALL'].includes(object.name) && object.isMesh)backing=object
    if(!object.isMesh || Array.isArray(object.material) || object.material?.name!=='Driveway_Mobile_Atlas')return
    let parent=object
    while(parent && parent!==model && !parent.name.startsWith('Polished_Static_Fittings'))parent=parent.parent
    if(parent?.name.startsWith('Polished_Static_Fittings'))atlasMesh=object
  })
  if(!backing || !atlasMesh?.geometry?.attributes?.uv || model.getObjectByName('SourceBorderSideReturns'))return {state,dispose(){}}
  model.updateWorldMatrix(true,true)
  const inverse=model.matrixWorld.clone().invert(),transform=new THREE.Matrix4(),point=new THREE.Vector3()
  transform.multiplyMatrices(inverse,backing.matrixWorld)
  const wallPosition=backing.geometry.attributes.position
  let backZ=Infinity,minX=Infinity,maxX=-Infinity
  for(let i=0;i<wallPosition.count;i++){
    point.fromBufferAttribute(wallPosition,i).applyMatrix4(transform)
    backZ=Math.min(backZ,point.z);minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x)
  }
  // Fail closed for other assets or coordinate systems, rather than placing a
  // familiar-looking frame over an unrelated wall.
  if(Math.abs(minX+.5)>.001 || Math.abs(maxX-.5)>.001 || !(backZ<0 && backZ>-.02))return {state,dispose(){}}
  transform.multiplyMatrices(inverse,atlasMesh.matrixWorld)
  const position=atlasMesh.geometry.attributes.position,uv=atlasMesh.geometry.attributes.uv,samples=[]
  for(let i=0;i<position.count;i++){
    point.fromBufferAttribute(position,i).applyMatrix4(transform)
    if(Math.abs(point.z-DRIVEWAY_BORDER_FRONT_Z)>.00005)continue
    const lower=-.22116711+(point.x+.49999984)*(.05427768/.99999971)
    if(Math.min(Math.abs(point.x+.49999984),Math.abs(point.x-.49999993),Math.abs(point.y-.22116553),Math.abs(point.y-lower))>.00005)continue
    samples.push([point.x,point.y,uv.getX(i),uv.getY(i)])
  }
  if(samples.length<8){state.status='missing-authored-border-atlas';return {state,dispose(){}}}
  const vertices=[],uvs=[],indices=[],segments=32
  for(let side=0;side<4;side++){
    const a=DRIVEWAY_BORDER_CONTOUR[side],b=DRIVEWAY_BORDER_CONTOUR[(side+1)%4],offset=vertices.length/3
    for(let i=0;i<=segments;i++){
      const t=i/segments,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t
      let nearest=samples[0],distance=Infinity
      for(const sample of samples){const d=(sample[0]-x)**2+(sample[1]-y)**2;if(d<distance){distance=d;nearest=sample}}
      // Depth repeats the actual edge colour. UV coordinates are intentionally
      // constant across depth; a face normal map would be invalid on this return.
      vertices.push(x,y,DRIVEWAY_BORDER_FRONT_Z,x,y,backZ)
      uvs.push(nearest[2],nearest[3],nearest[2],nearest[3])
      if(i<segments){const j=offset+i*2;indices.push(j,j+1,j+2,j+2,j+1,j+3)}
    }
  }
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox()
  const material=atlasMesh.material.clone();material.name='Source_Border_Return_Atlas';material.normalMap=null;material.aoMap=null;material.vertexColors=false;material.side=THREE.DoubleSide
  mesh=new THREE.Mesh(geometry,material);mesh.name='SourceBorderSideReturns'
  mesh.userData.source_border=['Boundary.040','Boundary.049'];mesh.userData.source_supported_extension=true
  model.add(mesh)
  Object.assign(state,{status:'ready',sides:4,triangles:indices.length/3,backZ,atlasSamples:samples.length,sourceContour:DRIVEWAY_BORDER_CONTOUR.map(p=>p.slice())})
  return {state,object3D:mesh,dispose(){if(disposed)return;disposed=true;mesh.removeFromParent();geometry.dispose();material.dispose();state.status='disposed'}}
}
