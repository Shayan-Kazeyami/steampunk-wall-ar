import {createTrackingAdapter} from './tracking/index.js'
import {createEffects} from './effects/index.js'
import {createUI} from './ui/index.js'
import {runEffectsContractChecks} from './effects/evidence/contract-check.js'
import spec from './shared/spec.json'
import manifest from '../config/target-manifest.json'

const A = window.AFRAME
let tick = () => {}
A.registerComponent('steampunk-coordinator', {tick(time, delta) { tick(time, delta) }})

function boot() {
  const scene = document.querySelector('a-scene')
  if (!scene.hasLoaded) { scene.addEventListener('loaded', boot, {once:true}); return }
  const THREE = A.THREE
  const panel = Object.values(spec.panels).find(p => p.wallId === manifest.wallId)
  const effects = createEffects({THREE, config:{...spec.effects, panel}})
  const cameraEl = document.querySelector('#main-camera')
  let retryAction = 'ar'
  let mode = 'landing', until = 0, epoch = 0, disposed = false, preview = null
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  let lowSince = null, fallback = 0, queue = Promise.resolve()
  let texture = null, diagnostics = {}
  Object.defineProperty(window, '__steampunkDiagnostics', {get:() => Object.freeze({...diagnostics})})
  function boost(value) { effects.setOverdrive(value); ui.setOverdrive(value); if (!value) until = 0 }
  function state(next, extra={}) { mode = next; ui.setState({state:next, targetLabel:panel.label, ...extra}) }
  function cancel() { boost(false); effects.setTracked(false) }
  const tracker = createTrackingAdapter({sceneEl:scene,
    onState(event) {
      if (disposed || mode === 'preview' || mode === 'landing' || mode === 'transition') return
      cancel()
      if (event.state === 'tracked' && event.root) {
        event.root.add(effects.object3D); effects.setTracked(true)
      }
      state(event.state)
    },
    onError(error) {
      if (disposed || mode === 'preview' || mode === 'landing' || mode === 'transition') return
      cancel(); state('error', {message:spec.ui.errorMessages[error.code] || error.message, canRetry:error.retryable})
    },
  })
  function removePreview() {
    if (preview) { preview.remove(effects.object3D); scene.object3D.remove(preview); preview.traverse(o => { if(o.geometry)o.geometry.dispose(); if(o.material)o.material.dispose() }); preview = null }
    if (texture) { texture.dispose(); texture = null }
    scene.object3D.background = null
  }
  function request(action) {
    if (action === 'ar' || action === 'preview') retryAction = action
    const token = ++epoch
    mode = 'transition'; cancel()
    // Invalidate any camera start synchronously, before queued UI transitions.
    const stopped = tracker.stop()
    queue = queue.then(async () => {
      await stopped
      if (disposed || token !== epoch) return
      removePreview()
      if (action === 'landing') { state('landing'); return }
      if (action === 'preview') {
        state('preview')
        const loaded = await new Promise((resolve,reject) => new THREE.TextureLoader().load('assets/garage-left.jpg',resolve,undefined,reject))
        if (disposed || token !== epoch) { loaded.dispose(); return }
        texture = loaded
        if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace
        else texture.encoding = THREE.sRGBEncoding
        preview = new THREE.Group()
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(1,panel.imagePx[1]/panel.imagePx[0]),new THREE.MeshBasicMaterial({map:texture}))
        plane.position.z = -0.001; preview.add(plane); preview.add(effects.object3D)
        scene.object3D.add(preview); scene.object3D.background = new THREE.Color('#15120F')
        cameraEl.object3D.position.set(0,0,2); cameraEl.object3D.rotation.set(0,0,0)
        fit(); effects.setTracked(true); return
      }
      state('loading')
      await tracker.start()
    }).catch(error => {
      if (disposed || token !== epoch) return
      cancel(); state('error',{message:spec.ui.errorMessages.ASSET_LOAD_FAILED,canRetry:true})
      console.error(error)
    })
    return queue
  }
  const ui = createUI({mount:document.querySelector('#ui'),
    onStart:() => request('ar'), onRetry:() => request(retryAction),
    onPreview:() => request('preview'), onClosePreview:() => request('landing'),
    onReset:() => boost(false),
    onOverdrive:() => { if(mode !== 'tracked' && mode !== 'preview')return; until = performance.now()+3000; boost(true) },
    onReducedMotionChange:value => { reduced = value; effects.setReducedMotion(value); ui.setReducedMotion(value) },
  })
  ui.setReducedMotion(reduced); effects.setReducedMotion(reduced); state('landing')
  function fit() {
    if(mode !== 'preview' || !scene.camera)return
    const camera = scene.camera
    const usableHeight = Math.max(0.35, 1 - 240 / innerHeight)
    const distance = Math.max((panel.imagePx[1]/panel.imagePx[0]) / usableHeight, 1 / camera.aspect) / (2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))) * 1.12
    cameraEl.object3D.position.set(0,0,distance)
  }
  window.addEventListener('resize',fit)
  function visibility() {
    if(document.hidden && mode !== 'landing' && mode !== 'preview') {
      ++epoch; mode = 'transition'; cancel(); tracker.stop().then(() => { if(!disposed && mode === 'transition') state('paused') })
    }
  }
  document.addEventListener('visibilitychange',visibility)
  if(scene.renderer) scene.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5))
  tick = (time,delta) => {
    if(disposed)return
    const now = performance.now()
    if(until && now >= until) boost(false)
    effects.update({deltaMs:delta,nowMs:now})
    if(mode === 'preview' || mode === 'tracked') {
      if(delta > 40) {
        if(lowSince === null)lowSince=now
        if(now-lowSince >= 10000) {
          if(fallback === 0)scene.renderer.setPixelRatio(1)
          if(fallback === 1)effects.object3D.traverse(o => { if(/glow/i.test(o.name))o.visible=false })
          fallback=Math.min(3,fallback+1);lowSince=null
        }
      } else lowSince=null
    } else lowSince=null
    diagnostics={mode,overdrive:until>0,reducedMotion:reduced,canvasCount:document.querySelectorAll('canvas.a-canvas').length,fallback,performanceFailed:fallback===3}
  }
  async function teardown() {
    if(disposed)return
    disposed=true; ++epoch; tick=()=>{}
    document.removeEventListener('visibilitychange',visibility); window.removeEventListener('resize',fit)
    await tracker.stop(); removePreview(); effects.dispose(); ui.dispose(); await tracker.dispose()
  }
  window.addEventListener('pagehide',teardown,{once:true})
  if(new URLSearchParams(location.search).has('qa')) {
    const pre=document.createElement('pre');pre.id='qa-results';pre.style.cssText='position:fixed;inset:0;z-index:100;background:white;color:black;overflow:auto;pointer-events:none'
    try {pre.textContent=JSON.stringify(runEffectsContractChecks({THREE,spec}),null,2)}catch(e){pre.textContent=e.stack}
    document.body.appendChild(pre)
  }
}
if(document.readyState === 'loading')document.addEventListener('DOMContentLoaded',boot,{once:true})
else boot()
