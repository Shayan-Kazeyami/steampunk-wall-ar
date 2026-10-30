// Cancel the consumer promptly; dispose a TextureLoader result arriving late.
export function loadPreviewTexture({THREE,url,signal,timeoutMs=10000}) {
  return new Promise((resolve,reject)=>{
    let settled=false,timer,returnedTexture,deliveredTexture,failed=false
    const disposedTextures=new Set()
    function disposeOnce(texture){if(texture && !disposedTextures.has(texture)){disposedTextures.add(texture);texture.dispose()}}
    function finish(error,texture) {
      if(settled){if(texture!==deliveredTexture)disposeOnce(texture);return}
      settled=true;failed=Boolean(error);clearTimeout(timer)
      if(signal)signal.removeEventListener('abort',abort)
      if(error){disposeOnce(returnedTexture);disposeOnce(texture);reject(error)}else{deliveredTexture=texture;resolve(texture)}
    }
    function abort(){const error=new Error('Preview canceled');error.name='AbortError';finish(error)}
    if(signal && signal.aborted){abort();return}
    if(signal)signal.addEventListener('abort',abort,{once:true})
    timer=setTimeout(()=>finish(new Error('Preview image timed out')),timeoutMs)
    try{returnedTexture=new THREE.TextureLoader().load(url,texture=>finish(null,texture),undefined,error=>finish(error || new Error('Preview image could not load')));if(settled && failed)disposeOnce(returnedTexture)}catch(error){finish(error)}
  })
}
