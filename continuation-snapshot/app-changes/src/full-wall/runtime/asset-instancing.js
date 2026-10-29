// Exact opaque draw batching. Source objects remain the animation/picking anchors.
// Call after animation/machine/polish update and before rendering; dispose BEFORE
// those owners release their geometry/materials. This owner frees only instance GPU data.
export function createAssetInstancing({THREE,model,renderer,enabled=true,paletteEnabled=true}={}) {
  if(!THREE || !model)throw new Error('Asset instancing requires THREE and model')
  const groups=[],palettes=[],rejected=[],candidates=[],inverse=new THREE.Matrix4(),matrix=new THREE.Matrix4()
  const standardSupported=!renderer || renderer.capabilities?.isWebGL2===true || renderer.extensions?.has?.('ANGLE_instanced_arrays')===true
  let disposed=false
  const bytesEqual=(a,b)=>{
    if(a===b)return true
    if(!a || !b || a.constructor!==b.constructor || a.length!==b.length)return false
    for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))return false
    return true
  }
  function sameAttribute(a,b){
    return a===b || !!(a && b && !a.isInterleavedBufferAttribute && !b.isInterleavedBufferAttribute &&
      a.itemSize===b.itemSize && a.normalized===b.normalized && a.count===b.count && a.gpuType===b.gpuType && bytesEqual(a.array,b.array))
  }
  function sameGeometry(a,b){
    if(a===b)return true
    const keys=Object.keys(a.attributes).sort(),other=Object.keys(b.attributes).sort()
    return keys.join('|')===other.join('|') && keys.every(key=>sameAttribute(a.attributes[key],b.attributes[key])) &&
      sameAttribute(a.index,b.index) && a.drawRange.start===b.drawRange.start && a.drawRange.count===b.drawRange.count &&
      JSON.stringify(a.groups)===JSON.stringify(b.groups)
  }
  function geometryShape(g){
    return Object.keys(g.attributes).sort().map(k=>{const a=g.attributes[k];return `${k}:${a.itemSize}:${a.count}:${a.normalized}:${a.array?.constructor.name}`}).join('|')+
      `;index:${g.index?.count || 0};range:${g.drawRange.start}:${g.drawRange.count};groups:${JSON.stringify(g.groups)}`
  }
  const stamp=g=>[['$index',g.index],...Object.entries(g.attributes)].filter(([,a])=>a).map(([key,a])=>[key,a,a.version,a.array])
  const unchanged=entry=>entry.stamp.every(([key,a,version,array])=>(key==='$index'?entry.geometry.index:entry.geometry.attributes[key])===a && a.version===version && a.array===array) &&
    entry.shape===geometryShape(entry.geometry)
  function relative(object){matrix.multiplyMatrices(inverse,object.matrixWorld);return matrix}
  function supportedTransform(m){
    const e=m.elements
    // inverse(modelWorld) * sourceWorld is affine mathematically, but general
    // matrix inversion can leave 1 +/- a few ulps in the homogeneous component.
    // Bound and canonicalize only that affine row; retain all authored TRS data.
    const affineEpsilon=1e-10
    if(!e.every(Number.isFinite) || Math.abs(e[3])>affineEpsilon || Math.abs(e[7])>affineEpsilon || Math.abs(e[11])>affineEpsilon || Math.abs(e[15]-1)>affineEpsilon)return false
    e[3]=0;e[7]=0;e[11]=0;e[15]=1
    if(m.determinant()<=0)return false
    // Instanced normal transforms support TRS; reject sheared nested transforms.
    for(const [a,b] of [[0,4],[0,8],[4,8]]){
      const dot=e[a]*e[b]+e[a+1]*e[b+1]+e[a+2]*e[b+2]
      const lengths=Math.hypot(e[a],e[a+1],e[a+2])*Math.hypot(e[b],e[b+1],e[b+2])
      if(Math.abs(dot)>lengths*1e-10)return false
    }
    return true
  }
  function ancestors(object){
    let visible=true
    for(let p=object;p && p!==model;p=p.parent){
      if(!p.visible)visible=false
      if(p!==object && p.isGroup && p.renderOrder!==0)return null
      if(p.parent===model)return {visible}
    }
    return null
  }
  function reason(object){
    const g=object.geometry,m=object.material
    if(!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh)return 'unsupported-mesh'
    if(!g?.attributes?.position || g.isInstancedBufferGeometry || Object.keys(g.morphAttributes || {}).length)return 'deformed-or-missing-geometry'
    if(Object.values(g.attributes).some(a=>a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute))return 'special-attributes'
    if(Array.isArray(m) || !m || (!m.isMeshStandardMaterial && !m.isMeshBasicMaterial))return 'unsupported-material'
    if(m.transparent || m.opacity<1 || m.transmission>0 || m.alphaHash)return 'transparency-order'
    // Three's object-space normal-map path applies only the common normalMatrix,
    // bypassing both standard instance rotation and the per-gear transform palette.
    if(m.normalMap && m.normalMapType===THREE.ObjectSpaceNormalMap)return 'object-space-normal-map'
    if(m.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile || m.customProgramCacheKey!==THREE.Material.prototype.customProgramCacheKey)return 'custom-material-shader'
    if(object.customDepthMaterial || object.customDistanceMaterial || object.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender || object.onAfterRender!==THREE.Object3D.prototype.onAfterRender)return 'custom-render-behaviour'
    if(!object.layers.mask)return 'disabled-layers'
    if(!ancestors(object))return 'ordered-or-detached-ancestor'
    if(!supportedTransform(relative(object)))return 'mirrored-singular-or-sheared-transform'
    return null
  }
  const renderKey=object=>[object.layers.mask,object.renderOrder,object.castShadow,object.receiveShadow,object.frustumCulled].join('|')
  if(enabled && THREE.InstancedMesh){
    model.updateWorldMatrix(true,true)
    inverse.copy(model.matrixWorld).invert()
    model.traverse(object=>{
      if(!object.isMesh)return
      const why=reason(object)
      if(why){rejected.push({name:object.name,reason:why});return}
      candidates.push({object,geometry:object.geometry,material:object.material,shape:geometryShape(object.geometry),key:renderKey(object),stamp:stamp(object.geometry)})
    })
    const buckets=[]
    for(const entry of candidates){
      let bucket=buckets.find(b=>b[0].material===entry.material && b[0].shape===entry.shape && b[0].key===entry.key && sameGeometry(b[0].geometry,entry.geometry))
      if(!bucket){bucket=[];buckets.push(bucket)}
      bucket.push(entry)
    }
    for(const entries of standardSupported?buckets:[]){
      if(entries.length<2)continue
      const first=entries[0].object,mesh=new THREE.InstancedMesh(entries[0].geometry,entries[0].material,entries.length)
      mesh.name='ExactInstances_'+(first.name || first.id)
      mesh.userData.assetInstancing=true
      mesh.layers.mask=first.layers.mask;mesh.renderOrder=first.renderOrder
      mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;mesh.frustumCulled=first.frustumCulled
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      const group={entries,mesh,active:true,sources:[],reason:null}
      for(const entry of entries){entry.layerMask=entry.object.layers.mask;entry.object.layers.mask=0}
      model.add(mesh);groups.push(group)
    }
    // Authored gears have distinct topology and atlas UVs. They are NOT claimed as
    // repeated geometry. Preserve their complete original arrays in one indexed
    // draw, and select their independent transform with a per-vertex source ID.
    // WebGL2 guarantees Uint32 indices. Keep a large uniform reserve for Three's
    // matrices/lights/fog; unsupported hardware retains the original source draws.
    const caps=renderer?.capabilities,capacity=Math.min(24,Math.floor(((caps?.maxVertexUniforms || 0)-128)/4))
    const shader=THREE.ShaderLib?.standard?.vertexShader || ''
    const tokens=['#include <common>','#include <beginnormal_vertex>','#include <begin_vertex>','#include <project_vertex>']
    const paletteCandidates=candidates.filter(e=>e.object.userData.animation_role==='gear' && !groups.some(g=>g.entries.includes(e)))
    const paletteBuckets=[]
    if(paletteEnabled && caps?.isWebGL2 && capacity>=2 && tokens.every(token=>shader.includes(token))){
      for(const entry of paletteCandidates){
        const {object,geometry:g,material:m}=entry
        if(!m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.displacementMap || object.castShadow || object.receiveShadow ||
          m.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile || m.customProgramCacheKey!==THREE.Material.prototype.customProgramCacheKey ||
          g.attributes.tangent || g.groups.length || g.drawRange.start!==0 || g.drawRange.count!==Infinity || !g.index ||
          Object.values(g.attributes).some(a=>a.normalized || a.array?.constructor.name!=='Float32Array')){
          rejected.push({name:object.name,reason:'palette-unsupported-material-geometry-or-shadows'});continue
        }
        const layout=Object.keys(g.attributes).sort().map(k=>`${k}:${g.attributes[k].itemSize}`).join('|')
        let bucket=paletteBuckets.find(b=>b.length<capacity && b[0].material===m && b[0].key===entry.key && b[0].layout===layout)
        if(!bucket){bucket=[];paletteBuckets.push(bucket)}
        entry.layout=layout;bucket.push(entry)
      }
    }
    for(const entries of paletteBuckets){
      if(entries.length<2)continue
      const source=entries[0].material,first=entries[0].object,geometry=new THREE.BufferGeometry()
      const vertexCount=entries.reduce((n,e)=>n+e.geometry.attributes.position.count,0),indexCount=entries.reduce((n,e)=>n+e.geometry.index.count,0)
      for(const key of Object.keys(entries[0].geometry.attributes)){
        const size=entries[0].geometry.attributes[key].itemSize,array=new Float32Array(vertexCount*size);let offset=0
        for(const entry of entries){array.set(entry.geometry.attributes[key].array,offset);offset+=entry.geometry.attributes[key].array.length}
        geometry.setAttribute(key,new THREE.BufferAttribute(array,size))
      }
      const ids=new Float32Array(vertexCount),indices=new Uint32Array(indexCount);let vertexOffset=0,indexOffset=0
      for(const [id,entry] of entries.entries()){
        const count=entry.geometry.attributes.position.count;ids.fill(id,vertexOffset,vertexOffset+count)
        for(const value of entry.geometry.index.array)indices[indexOffset++]=value+vertexOffset
        entry.vertexOffset=vertexOffset;vertexOffset+=count
      }
      geometry.setAttribute('wallGearIndex',new THREE.BufferAttribute(ids,1));geometry.setIndex(new THREE.BufferAttribute(indices,1))
      const material=source.clone(),uniform={value:entries.map(()=>new THREE.Matrix4())}
      material.onBeforeCompile=program=>{
        program.uniforms.wallGearMatrices=uniform
        program.vertexShader=program.vertexShader
          .replace('#include <common>',`#include <common>\nattribute float wallGearIndex;\nuniform mat4 wallGearMatrices[${entries.length}];`)
          .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>\nmat4 wallGearMatrix=wallGearMatrices[int(wallGearIndex)];\nmat3 wallGearNormal=mat3(wallGearMatrix);\nobjectNormal=wallGearNormal*(objectNormal/vec3(dot(wallGearNormal[0],wallGearNormal[0]),dot(wallGearNormal[1],wallGearNormal[1]),dot(wallGearNormal[2],wallGearNormal[2])));`)
          .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=(wallGearMatrix*vec4(transformed,1.)).xyz;')
          .replace('#include <project_vertex>','#include <project_vertex>\nif(wallGearMatrix[3][3]<.5)gl_Position=vec4(2.,2.,2.,1.);')
      }
      material.customProgramCacheKey=()=>`wall-gear-palette-v1-${entries.length}`
      const mesh=new THREE.Mesh(geometry,material);mesh.name='ExactGearTransformPalette';mesh.userData.assetInstancing=true
      mesh.layers.mask=first.layers.mask;mesh.renderOrder=first.renderOrder;mesh.frustumCulled=first.frustumCulled
      const palette={entries,mesh,source,uniform,sourceVersion:source.version,active:true,visibleCount:0,reason:null,bounds:new THREE.Box3(),box:new THREE.Box3()}
      // Exact triangle picking still returns the authored source object. The main
      // experience uses its existing coarse source bounds and does no triangle cast.
      mesh.raycast=(raycaster,hits)=>{for(const entry of entries)if(ancestors(entry.object)?.visible)entry.object.raycast(raycaster,hits)}
      for(const entry of entries){entry.layerMask=entry.object.layers.mask;entry.object.layers.mask=0}
      model.add(mesh);palettes.push(palette)
    }
  }
  function release(group,why){
    if(!group.active)return
    for(const entry of group.entries)if(entry.object.layers.mask===0)entry.object.layers.mask=entry.layerMask
    group.mesh.removeFromParent();group.mesh.dispose();group.sources.length=0;group.active=false;group.reason=why
  }
  function releasePalette(palette,why){
    if(!palette.active)return
    for(const entry of palette.entries)if(entry.object.layers.mask===0)entry.object.layers.mask=entry.layerMask
    palette.mesh.removeFromParent();palette.mesh.geometry.dispose();palette.mesh.material.dispose();palette.active=false;palette.reason=why;palette.visibleCount=0
  }
  function update(){
    if(disposed || (!groups.some(g=>g.active) && !palettes.some(p=>p.active)))return
    model.updateWorldMatrix(true,true)
    inverse.copy(model.matrixWorld).invert()
    for(const group of groups){
      if(!group.active)continue
      const {mesh,entries}=group
      let invalid=null,count=0,dirty=false
      for(const entry of entries){
        const object=entry.object,chain=ancestors(object)
        // A material clone or geometry mutation invalidates the whole batch. Restore
        // source draws immediately rather than silently sharing independent state.
        if(object.geometry!==entry.geometry || object.material!==entry.material || !unchanged(entry) || !chain || object.layers.mask!==0 ||
          [entry.layerMask,object.renderOrder,object.castShadow,object.receiveShadow,object.frustumCulled].join('|')!==entry.key ||
          object.material.transparent || object.material.opacity<1 || object.material.transmission>0 || object.material.alphaHash ||
          (object.material.normalMap && object.material.normalMapType===THREE.ObjectSpaceNormalMap) ||
          object.material.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile || object.material.customProgramCacheKey!==THREE.Material.prototype.customProgramCacheKey ||
          object.customDepthMaterial || object.customDistanceMaterial || object.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender || object.onAfterRender!==THREE.Object3D.prototype.onAfterRender ||
          !supportedTransform(relative(object))){invalid='source-state-changed';break}
        if(!chain.visible)continue
        group.sources[count]=object
        const e=matrix.elements,offset=count*16,array=mesh.instanceMatrix.array
        for(let i=0;i<16;i++)if(array[offset+i]!==Math.fround(e[i])){dirty=true;break}
        mesh.setMatrixAt(count,matrix);count++
      }
      if(invalid){release(group,invalid);continue}
      if(mesh.count!==count)dirty=true
      mesh.count=count;mesh.visible=count>0;group.sources.length=count
      if(dirty){
        mesh.instanceMatrix.needsUpdate=true
        if(mesh.frustumCulled){mesh.computeBoundingSphere();mesh.computeBoundingBox()}
      }
    }
    for(const palette of palettes){
      if(!palette.active)continue
      const {entries,source,mesh}=palette
      let invalid=false,count=0;palette.bounds.makeEmpty()
      for(const [i,entry] of entries.entries()){
        const object=entry.object,chain=ancestors(object)
        if(object.geometry!==entry.geometry || object.material!==source || !unchanged(entry) || !chain || object.layers.mask!==0 ||
          [entry.layerMask,object.renderOrder,object.castShadow,object.receiveShadow,object.frustumCulled].join('|')!==entry.key ||
          source.version!==palette.sourceVersion || source.transparent || source.opacity<1 || source.transmission>0 || source.alphaHash || source.displacementMap ||
          (source.normalMap && source.normalMapType===THREE.ObjectSpaceNormalMap) ||
          source.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile || source.customProgramCacheKey!==THREE.Material.prototype.customProgramCacheKey ||
          object.customDepthMaterial || object.customDistanceMaterial || object.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender || object.onAfterRender!==THREE.Object3D.prototype.onAfterRender ||
          !supportedTransform(relative(object))){invalid=true;break}
        palette.uniform.value[i].copy(matrix)
        if(chain.visible){
          count++
          if(!entry.geometry.boundingBox)entry.geometry.computeBoundingBox()
          palette.bounds.union(palette.box.copy(entry.geometry.boundingBox).applyMatrix4(matrix))
        }else palette.uniform.value[i].elements[15]=0
      }
      if(invalid){releasePalette(palette,'source-state-changed');continue}
      // Copy source state once, after camera/wall lighting changes. Clone owns its
      // shader only; atlas/texture objects remain shared and are never freed here.
      mesh.material.copy(source)
      mesh.visible=count>0;palette.visibleCount=count
      if(!mesh.geometry.boundingBox)mesh.geometry.boundingBox=new THREE.Box3()
      mesh.geometry.boundingBox.copy(palette.bounds)
      if(!mesh.geometry.boundingSphere)mesh.geometry.boundingSphere=new THREE.Sphere()
      palette.bounds.getBoundingSphere(mesh.geometry.boundingSphere)
    }
  }
  function getDiagnostics(){
    const active=groups.filter(g=>g.active)
    const activePalettes=palettes.filter(p=>p.active)
    return {enabled:!!enabled,disposed,groupCount:active.length+activePalettes.length,standardGroupCount:active.length,paletteGroupCount:activePalettes.length,
      sourceMeshCount:active.reduce((n,g)=>n+g.entries.length,0)+activePalettes.reduce((n,p)=>n+p.entries.length,0),
      drawCallsSaved:active.reduce((n,g)=>n+Math.max(0,g.sources.length-1),0)+activePalettes.reduce((n,p)=>n+Math.max(0,p.visibleCount-1),0),
      groups:groups.map(g=>({name:g.mesh.name,active:g.active,count:g.sources.length,reason:g.reason,sources:g.entries.map(e=>({name:e.object.name,role:e.object.userData.animation_role || null}))})),
      palettes:palettes.map(p=>({name:p.mesh.name,kind:'unique-geometry-transform-palette',active:p.active,count:p.entries.length,visibleCount:p.visibleCount,reason:p.reason,vertices:p.mesh.geometry.attributes.position.count,triangles:p.mesh.geometry.index.count/3,sources:p.entries.map(e=>({name:e.object.name,vertexOffset:e.vertexOffset}))})),
      paletteHardware:{requested:!!paletteEnabled,webgl2:!!renderer?.capabilities?.isWebGL2,maxVertexUniforms:renderer?.capabilities?.maxVertexUniforms || null,reservedVectors:128},
      standardHardware:{rendererProvided:!!renderer,supported:standardSupported},
      unbatched:candidates.filter(e=>!groups.some(g=>g.active && g.entries.includes(e)) && !palettes.some(p=>p.active && p.entries.includes(e))).map(e=>({name:e.object.name,reason:'no-exact-compatible-repeat'})),rejected:rejected.map(e=>({...e}))}
  }
  update()
  return {update,getDiagnostics,
    resolveIntersection(hit){const group=groups.find(g=>g.active && g.mesh===hit?.object);return group?.sources[hit.instanceId] || null},
    dispose(){if(disposed)return;for(const group of groups)release(group,'disposed');for(const palette of palettes)releasePalette(palette,'disposed');disposed=true}}
}
