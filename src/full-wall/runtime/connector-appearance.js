// Source-derived connector bounds in the normalized model frame (pipe_chamber_small_metal.072 and .091–.099).
// Atlas emission is baked colour: Three's default vertex colours affect only the
// base-colour path, leaving that emission grey. Tint both paths exactly once.
export const CONNECTOR_BOUNDS=[
  [
    -0.38035530783236027,
    -0.030403008684515953,
    0.016225875355303288,
    -0.35460363794118166,
    -0.012336059473454952,
    0.034292830154299736
  ],
  [
    0.149894286878407,
    -0.10658464580774307,
    0.01622611377388239,
    0.16796124260872602,
    -0.08083298336714506,
    0.03429306857287884
  ],
  [
    -0.41032500192523,
    -0.03039467055350542,
    0.016225875355303288,
    -0.3845733320340514,
    -0.01232772134244442,
    0.034292830154299736
  ],
  [
    0.31561847403645515,
    0.155600325204432,
    0.016225875355303288,
    0.34137014392763376,
    0.173667274415493,
    0.034292830154299736
  ],
  [
    0.14993610698729753,
    -0.07581309136003256,
    0.01622611377388239,
    0.16800306271761656,
    -0.050061426125466824,
    0.03429306857287884
  ],
  [
    -0.19102111738175154,
    0.0472505958750844,
    0.016225875355303288,
    -0.17295416165143251,
    0.07300226110965014,
    0.034292830154299736
  ],
  [
    -0.27222700230777264,
    -0.16182164289057255,
    0.01622611377388239,
    -0.24553476087749004,
    -0.14381167106330395,
    0.03429306857287884
  ],
  [
    0.05005950294435024,
    -0.035107141360640526,
    0.01622611377388239,
    0.07581117283552885,
    -0.017040192149579525,
    0.03429306857287884
  ],
  [
    -0.19102111738175154,
    -0.04108064342290163,
    0.01622611377388239,
    -0.17295416165143251,
    -0.015328978188335896,
    0.03429306857287884
  ],
  [
    0.2624150402843952,
    0.155600325204432,
    0.016225875355303288,
    0.2881667101755738,
    0.173667274415493,
    0.034292830154299736
  ]
]
export function applyConnectorAppearance({THREE,model}){
  const state={connectorVertices:0,connectorMeshes:0,connectorEmissiveMeshes:0,connectorCorrection:'triangle-base-and-emissive-v3'}
  model.updateWorldMatrix(true,true)
  const inverse=model.matrixWorld.clone().invert(),point=new THREE.Vector3(),matrix=new THREE.Matrix4()
  model.traverse(object=>{
    if(!object.isMesh || object.userData.connectorAppearanceApplied)return
    let node=object
    while(node && node!==model && !node.name.startsWith('Polished_Static_Fittings'))node=node.parent
    if(!node?.name.startsWith('Polished_Static_Fittings'))return
    const material=object.material,position=object.geometry?.attributes?.position
    if(!position || Array.isArray(material) || material?.name!=='Driveway_Mobile_Atlas')return
    matrix.multiplyMatrices(inverse,object.matrixWorld)
    // A triangle receives colour only when every vertex belongs to the SAME
    // convex source envelope. Split shared boundary vertices so an adjacent
    // long pipe triangle cannot interpolate the tint away from a union.
    const membership=new Uint16Array(position.count)
    for(let i=0;i<position.count;i++){
      point.fromBufferAttribute(position,i).applyMatrix4(matrix)
      const {x,y,z}=point,e=.000025
      for(let r=0;r<CONNECTOR_BOUNDS.length;r++){
        const b=CONNECTOR_BOUNDS[r]
        if(x>=b[0]-e&&y>=b[1]-e&&z>=b[2]-e&&x<=b[3]+e&&y<=b[4]+e&&z<=b[5]+e)membership[i]|=1<<r
      }
    }
    const original=object.geometry,index=original.index
    const count=index?index.count:position.count,indices=new Uint32Array(count)
    const selectedUse=new Uint8Array(position.count),plainUse=new Uint8Array(position.count),triangles=new Uint8Array(Math.floor(count/3))
    let selectedTriangles=0
    for(let i=0;i+2<count;i+=3){
      const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2
      indices[i]=a;indices[i+1]=b;indices[i+2]=c
      const selected=!!(membership[a]&membership[b]&membership[c])
      triangles[i/3]=selected?1:0
      if(selected)selectedTriangles++
      const use=selected?selectedUse:plainUse;use[a]=1;use[b]=1;use[c]=1
    }
    if(!selectedTriangles)return
    const duplicates=new Map();let vertexCount=position.count,selected=0
    for(let i=0;i<position.count;i++)if(selectedUse[i]){
      selected++;if(plainUse[i])duplicates.set(i,vertexCount++)
    }
    const geometry=original.clone()
    for(const [name,attribute] of Object.entries(original.attributes)){
      // GLTF/Draco attributes are ordinary BufferAttributes; also preserve
      // interleaved inputs without changing stored component representation.
      const source=attribute.isInterleavedBufferAttribute?attribute.data.array:attribute.array
      const values=new source.constructor(vertexCount*attribute.itemSize)
      const copy=(from,to)=>{for(let c=0;c<attribute.itemSize;c++)values[to*attribute.itemSize+c]=attribute.isInterleavedBufferAttribute?source[from*attribute.data.stride+attribute.offset+c]:source[from*attribute.itemSize+c]}
      for(let i=0;i<position.count;i++)copy(i,i)
      for(const [from,to] of duplicates)copy(from,to)
      geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize,attribute.normalized))
    }
    const colors=new Float32Array(vertexCount*3);colors.fill(1)
    for(let i=0;i<position.count;i++)if(selectedUse[i]){
      const target=duplicates.get(i)??i
      colors[target*3]=1.65;colors[target*3+1]=.9;colors[target*3+2]=.28
    }
    for(let i=0;i+2<count;i+=3)if(triangles[i/3])for(let c=0;c<3;c++)indices[i+c]=duplicates.get(indices[i+c])??indices[i+c]
    geometry.setIndex(new THREE.BufferAttribute(indices,1))
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3))
    object.geometry=geometry
    // This model is owned by the full-wall runtime. Release an unshared old
    // geometry now; shared originals remain reachable for normal disposal.
    let references=0;model.traverse(other=>{if(other.isMesh&&other.geometry===original)references++})
    if(!references)original.dispose()
    const corrected=material.clone()
    corrected.vertexColors=true
    // Preserve maps, normal, metalness and roughness; a global material change
    // would also recolour unrelated gears/pipes sharing this merged primitive.
    const originalHook=material.onBeforeCompile
    corrected.onBeforeCompile=function(shader,renderer){
      originalHook?.call(this,shader,renderer)
      const marker='#include <emissivemap_fragment>'
      if(!shader.fragmentShader.includes(marker))throw new Error('Connector shader missing emissive hook')
      shader.fragmentShader=shader.fragmentShader.replace(marker,marker+'\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif')
    }
    corrected.customProgramCacheKey=()=> 'connector-triangle-base-emissive-v3'
    object.material=corrected
    object.userData.connectorAppearanceApplied=true
    state.connectorVertices+=selected;state.connectorMeshes++;state.connectorTriangles=(state.connectorTriangles||0)+selectedTriangles;state.connectorBoundaryDuplicates=(state.connectorBoundaryDuplicates||0)+duplicates.size
    if(material.emissiveMap)state.connectorEmissiveMeshes++
  })
  return state
}
