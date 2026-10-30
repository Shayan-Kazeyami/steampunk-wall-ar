const assert = require('node:assert/strict')

module.exports = async function runtimeRegressions({load, THREE, JSDOM, spec, manifest, compiled, results = []}) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  async function within(promise, ms = 250) {
    let timer
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Operation did not settle within ${ms} ms`)), ms)
      })])
    } finally { clearTimeout(timer) }
  }
  function harness({sceneReady = true, engineReady = true, earlyGeometry = false} = {}) {
    const dom = new JSDOM('<a-scene></a-scene>', {url:'https://test.invalid/', pretendToBeVisual:true})
    const {window} = dom, {document} = window
    const scene = document.querySelector('a-scene')
    scene.hasLoaded = sceneReady
    scene.object3D = new THREE.Scene()
    const attrs = [], states = [], errors = []
    const set = scene.setAttribute.bind(scene)
    scene.setAttribute = (key, value) => { attrs.push(key); set(key, value) }
    const create = document.createElement.bind(document)
    document.createElement = tag => {
      const element = create(tag)
      if (tag === 'a-entity') {
        element.hasLoaded = true
        element.object3D = new THREE.Group()
        element.components = {'xrextras-named-image-target': {}}
      }
      return element
    }
    const append = scene.appendChild.bind(scene)
    scene.appendChild = element => {
      const result = append(element)
      if (earlyGeometry) element.dispatchEvent(new window.CustomEvent('xrextrasimagegeometry', {
        detail:{scaledWidth:2, scaledHeight:1.5},
      }))
      return result
    }
    window.AFRAME = {THREE, components:{xrweb:{}, 'xrextras-named-image-target':{}}}
    if (engineReady) window.XR8 = {XrController:{configure() {}}, stop() {}}
    const {createTrackingAdapter} = load('src/tracking/index.js', ['createTrackingAdapter'], {
      document, window, targetManifestModule:manifest, compiledTargetModule:compiled,
    })
    const adapter = createTrackingAdapter({sceneEl:scene, engineStopTimeoutMs:10, onState:event => states.push(event), onError:error => errors.push(error)})
    return {dom, window, document, scene, attrs, states, errors, adapter}
  }
  for (const stalled of ['scene', 'engine']) {
    for (const action of ['stop', 'dispose']) {
      const h = harness({sceneReady:stalled !== 'scene', engineReady:stalled !== 'engine'})
      try {
        const started = h.adapter.start()
        await sleep(10)
        await within(Promise.all([started, h.adapter[action]()]))
        assert(!h.attrs.includes('xrweb'), `${stalled}/${action} activated XR`)
        assert.equal(h.errors.length, 0, 'Cancellation must not surface as an error')
        await within(h.adapter.dispose())
        results.push({id:`tracking-stalled-${stalled}-${action}`, result:'pass', detail:'Stalled startup and cancellation settle within 250ms; mocked runtime only.'})
      } finally { h.dom.window.close() }
    }
  }
  const h = harness({earlyGeometry:true})
  try {
    await within(h.adapter.start())
    const target = h.scene.querySelector('a-entity')
    target.dispatchEvent(new h.window.CustomEvent('xrextrasfound'))
    const acquired = h.states.find(event => event.state === 'tracked')
    assert(acquired, 'Geometry emitted before root creation must survive until acquisition')
    assert.equal(acquired.root.userData.cropToPanelApplied, true)
    const expectedScale = 2 * manifest.panelImagePx[0] / manifest.sourceCropPx[2]
    assert(Math.abs(acquired.root.scale.x - expectedScale) < 1e-8)
    results.push({id:'tracking-early-geometry-retained', result:'pass', detail:'Real adapter retains pre-root geometry and applies crop normalization; pose events mocked.'})
    h.scene.dispatchEvent(new h.window.CustomEvent('realityerror', {detail:{error:{message:'Camera permission denied'}}}))
    assert.equal(h.errors.length, 1)
    assert.equal(h.errors[0].code, 'CAMERA_DENIED')
    assert.equal(acquired.root.visible, false)
    const afterError = h.states.length
    target.dispatchEvent(new h.window.CustomEvent('xrextrasfound'))
    target.dispatchEvent(new h.window.CustomEvent('xrextraslost'))
    await sleep(10)
    assert.equal(h.states.length, afterError, 'Late target events must not erase failure')
    await within(h.adapter.retry())
    target.dispatchEvent(new h.window.CustomEvent('xrextrasfound'))
    assert.equal(h.states.at(-1).state, 'tracked', 'Explicit retry must clear error latch')
    results.push({id:'tracking-error-latched-until-retry', result:'pass', detail:'Late found/lost events cannot erase camera error; explicit retry permits acquisition.'})
  } finally { await within(h.adapter.dispose()); h.dom.window.close() }

  // A stopped UI is not evidence that XR8 actually released the camera.
  // Exercise the real adapter queue with controllable stop promises.
  for (const outcome of ['resolved', 'rejected', 'pending']) {
    const camera = harness()
    let configureCalls = 0, stopCalls = 0, resolveStop
    const pendingStop = new Promise(resolve => { resolveStop = resolve })
    camera.window.XR8.XrController.configure = () => { configureCalls++ }
    camera.window.XR8.stop = () => {
      stopCalls++
      if (outcome === 'rejected') return Promise.reject(new Error('stop failed'))
      if (outcome === 'pending') return pendingStop
      return Promise.resolve()
    }
    try {
      await within(camera.adapter.start())
      assert.equal(configureCalls, 1)
      const stopped = camera.adapter.stop()
      // An intervening restart must never configure a second session before stop settles.
      const restart = camera.adapter.start()
      await sleep(20)
      if (outcome === 'pending') assert.equal(configureCalls, 1)
      await within(Promise.all([stopped, restart]), 5000)
      if (outcome === 'resolved') {
        assert.equal(configureCalls, 2, 'confirmed stop permits restart')
      } else {
        assert.equal(configureCalls, 1, `${outcome} stop must block restart`)
        assert(camera.errors.some(error => error.code === 'ENGINE_STOP_UNCERTAIN' && error.retryable === false), `${outcome} stop must report an actionable failure`)
        assert.equal(camera.adapter.getDiagnostics().engineStopUncertain, true)
        const attempts = camera.attrs.filter(key => key === 'xrweb').length
        await within(camera.adapter.start(), 5000)
        assert.equal(camera.attrs.filter(key => key === 'xrweb').length, attempts, 'repeat Start cannot overlap an uncertain camera')
        assert.equal(configureCalls, 1)
      }
      assert(stopCalls >= 1)
      if (outcome === 'pending') {
        resolveStop()
        await sleep(20)
        assert.equal(camera.adapter.getDiagnostics().engineStopUncertain, false)
        await within(camera.adapter.start(), 5000)
        assert.equal(configureCalls, 2, 'a later confirmed stop permits a new camera session')
      }
      results.push({id:`tracking-xr-stop-${outcome}`, result:'pass', detail:'Real adapter queue and mocked XR stop; no camera hardware claim.'})
    } finally {
      resolveStop()
      await within(camera.adapter.dispose(), 5000)
      camera.dom.window.close()
    }
  }

  const dom = new JSDOM('<div id="mount"></div>', {url:'https://test.invalid/'})
  try {
    const {document} = dom.window
    const {createUIController} = load('src/ui/controller.js', ['createUIController'], {document, window:dom.window})
    const calls = []
    const ui = createUIController({mount:document.querySelector('#mount'), spec, onCancel:() => calls.push('cancel'), onStop:() => calls.push('stop')})
    const click = label => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent === label)
      assert(button && !button.hidden && !button.disabled, `${label} must be usable`)
      button.click()
    }
    ui.setState({state:'loading'}); click('Cancel')
    ui.setState({state:'searching'}); click('Stop camera')
    ui.setState({state:'tracked'}); click('Stop camera')
    assert.deepEqual(calls, ['cancel','stop','stop'])
    ui.dispose(); ui.dispose()
    results.push({id:'ui-cancel-stop-callbacks', result:'pass', detail:'Visible loading Cancel and active camera Stop controls call their optional callbacks.'})
  } finally { dom.window.close() }
  return results
}
