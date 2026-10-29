const assert = require('node:assert/strict')

module.exports = async function previewLoader({load}) {
  const {loadPreviewTexture} = load('src/shared/load-preview.js',['loadPreviewTexture'])
  const results = []
  let lateLoad
  const pendingThree = {TextureLoader:class {
    load(url,onLoad) { lateLoad = onLoad }
  }}
  const within = async promise => {
    let timer
    try {
      return await Promise.race([promise,new Promise((_,reject) => {
        timer = setTimeout(() => reject(new Error('Preview operation did not settle within 250ms')),250)
      })])
    } finally { clearTimeout(timer) }
  }
  const controller = new AbortController()
  const pending = loadPreviewTexture({THREE:pendingThree,url:'assets/test.jpg',signal:controller.signal,timeoutMs:5000})
  const rejected = assert.rejects(pending, error => error.name === 'AbortError')
  controller.abort()
  await within(rejected)
  let disposed = 0
  lateLoad({dispose() { disposed++ }})
  assert.equal(disposed,1,'A texture arriving after abort must be disposed')
  results.push({id:'preview-texture-abort-late-disposal',result:'pass',detail:'Aborted load rejects within250ms and disposes a texture arriving later; loader mocked.'})
  await within(assert.rejects(loadPreviewTexture({THREE:pendingThree,url:'assets/test.jpg',timeoutMs:20})))
  results.push({id:'preview-texture-bounded-timeout',result:'pass',detail:'Never-answering texture load rejects within bounded timeout; network mocked.'})
  const texture = {dispose() { throw new Error('Successful texture must remain owned by caller') }}
  const immediateThree = {TextureLoader:class {load(url,onLoad) { onLoad(texture) }}}
  assert.equal(await loadPreviewTexture({THREE:immediateThree,url:'assets/test.jpg',timeoutMs:20}),texture)
  results.push({id:'preview-texture-success-ownership',result:'pass',detail:'Successful texture returned to caller without disposal; loader mocked.'})
  return results
}
