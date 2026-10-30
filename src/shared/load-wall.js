// The decoder belongs to A-Frame's shared glTF system, not to an individual request.
export function disposeWallModel(model) {
  const geometries=new Set(),materials=new Set(),textures=new Set()
  model?.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry)
    for(const material of (Array.isArray(object.material)?object.material:[object.material])){
      if(!material)continue
      materials.add(material)
      for(const value of Object.values(material))if(value?.isTexture)textures.add(value)
    }
  })
  geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());textures.forEach(value=>value.dispose())
  model?.removeFromParent()
}

export function loadWallModel({THREE,sceneEl,url,signal,timeoutMs=60000,fetchFile=fetch,onProgress}) {
  return new Promise((resolve,reject)=>{
    let settled=false,delivered=null,reader=null,lastProgress=-Infinity,lastPhase=''
    function progress(phase,status,loadedBytes=null,totalBytes=null) {
      if(settled || typeof onProgress!=='function')return
      const time=Date.now(),key=phase+':'+status
      if(key===lastPhase && status==='loading' && time-lastProgress<200)return
      lastProgress=time;lastPhase=key
      try{onProgress({phase,status,loadedBytes,totalBytes})}catch(error){/* An observer never owns loading. */}
    }
    function cancelReader() {
      try{Promise.resolve(reader?.cancel()).catch(()=>{})}catch(error){}
    }
    const controller=new AbortController()
    const aborted=()=>{const error=new Error('Wall loading canceled');error.name='AbortError';return error}
    function finish(error,model) {
      if(settled){if(model && model!==delivered)disposeWallModel(model);return}
      settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort)
      if(error){controller.abort();cancelReader();if(model)disposeWallModel(model);reject(error)}
      else{delivered=model;resolve(model)}
    }
    function abort(){finish(aborted())}
    const timer=setTimeout(()=>finish(new Error('Wall model loading timed out')),timeoutMs)
    if(signal?.aborted){abort();return}
    signal?.addEventListener('abort',abort,{once:true})
    ;(async()=>{
      const loader=new THREE.GLTFLoader()
      const system=sceneEl.systems?.['gltf-model']
      if(!system?.getDRACOLoader)throw new Error('The A-Frame Draco decoder is unavailable')
      loader.setDRACOLoader(system.getDRACOLoader())
      progress('download','loading',0,null)
      if(settled)return
      const response=await fetchFile(url,{signal:controller.signal})
      if(!response.ok)throw new Error('Wall model HTTP '+response.status)
      if(settled)return
      const length=response.headers?.get?.('content-length'),encoding=response.headers?.get?.('content-encoding')
      let total=typeof length==='string' && /^[0-9]+$/.test(length) && Number.isSafeInteger(Number(length)) && Number(length)>0 && (!encoding || encoding==='identity')?Number(length):null
      let buffer,loaded=0
      if(typeof response.body?.getReader==='function'){
        reader=response.body.getReader()
        const chunks=[]
        try{
          while(!settled){
            const result=await reader.read()
            if(settled)return
            if(result.done)break
            const chunk=result.value
            if(!chunk || !Number.isSafeInteger(chunk.byteLength))throw new Error('Invalid wall download chunk')
            chunks.push(chunk);loaded+=chunk.byteLength
            if(total!==null && loaded>total)total=null
            progress('download','loading',loaded,total)
          }
          if(settled)return
          const bytes=new Uint8Array(loaded);let offset=0
          for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
          buffer=bytes.buffer
        }finally{try{reader.releaseLock?.()}catch(error){}reader=null}
      }else{buffer=await response.arrayBuffer();loaded=buffer.byteLength}
      if(settled)return
      if(total!==loaded)total=null
      progress('download','complete',loaded,total)
      if(settled)return
      progress('decode','loading')
      if(settled)return
      const base=new URL('.',new URL(url,sceneEl.ownerDocument.baseURI)).href
      // Draco work can finish after cancellation; finish() releases that late model.
      const gltf=await loader.parseAsync(buffer,base)
      if(!gltf.scene)throw new Error('Wall model contains no scene')
      progress('decode','complete')
      finish(null,gltf.scene)
    })().catch(error=>finish(error))
  })
}

// One tiny off-screen draw uploads geometry/textures and compiles materials before
// the first image-found event. The visible camera framebuffer is never rendered here.
export function warmWallModel({THREE,sceneEl,object3D}) {
  const renderer=sceneEl.renderer,camera=sceneEl.camera
  if(!renderer?.render || !renderer.setRenderTarget || !camera || !THREE.WebGLRenderTarget)return false
  if(renderer.getContext?.()?.isContextLost?.())return false
  const target=new THREE.WebGLRenderTarget(4,4,{depthBuffer:true})
  const previousTarget=renderer.getRenderTarget(),visible=object3D.visible,parent=object3D.parent
  const scratch=new THREE.Scene();scratch.environment=sceneEl.object3D.environment
  const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest()
  try{
    scratch.add(object3D);object3D.visible=true
    renderer.setRenderTarget(target);renderer.setViewport(0,0,4,4);renderer.setScissorTest(false)
    renderer.render(scratch,camera)
    return !renderer.getContext?.()?.isContextLost?.()
  } finally {
    scratch.remove(object3D);if(parent)parent.add(object3D);object3D.visible=visible
    renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest)
    target.dispose()
  }
}
