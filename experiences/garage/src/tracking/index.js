import targetManifestModule from '../../config/target-manifest.json'
import compiledTargetModule from '../../image-targets/steampunk-garage-wide.json'

const targetManifest = targetManifestModule && targetManifestModule.default
  ? targetManifestModule.default
  : targetManifestModule

const compiledTarget = compiledTargetModule && compiledTargetModule.default
  ? compiledTargetModule.default
  : compiledTargetModule

export const TRACKING_STATES = Object.freeze({
  LOADING: 'loading',
  SEARCHING: 'searching',
  TRACKED: 'tracked',
  LOST: 'lost',
  PAUSED: 'paused',
})

export const TRACKING_ERROR_CODES = Object.freeze({
  CAMERA_DENIED: 'CAMERA_DENIED',
  CAMERA_UNAVAILABLE: 'CAMERA_UNAVAILABLE',
  INSECURE_ORIGIN: 'INSECURE_ORIGIN',
  ASSET_LOAD_FAILED: 'ASSET_LOAD_FAILED',
  ENGINE_FAILED: 'ENGINE_FAILED',
})

const TARGET_COMPONENT = 'xrextras-named-image-target'
const SCENE_LOAD_TIMEOUT_MS = 15000
const ENGINE_LOAD_TIMEOUT_MS = 15000
const XREXTRAS_LOAD_TIMEOUT_MS = 10000
const ENTITY_LOAD_TIMEOUT_MS = 10000
const POLL_INTERVAL_MS = 50

const ERROR_MESSAGES = Object.freeze({
  CAMERA_DENIED: 'Camera access was denied. Allow it in browser site settings, then retry.',
  CAMERA_UNAVAILABLE: 'Camera unavailable. Close other camera apps, then retry.',
  INSECURE_ORIGIN: 'Camera requires an HTTPS page.',
  ASSET_LOAD_FAILED: 'The image target data could not be loaded.',
  ENGINE_FAILED: 'The AR engine could not start.',
})

function safeCallback(callback, payload) {
  if (typeof callback !== 'function') return
  try {
    callback(payload)
  } catch (error) {}
}

function messageFrom(error, fallback) {
  if (error && typeof error.message === 'string' && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

function waitForCondition(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false
    let interval = null
    let timer = null

    const finish = (error) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      if (interval !== null) clearInterval(interval)
      if (error) reject(error)
      else resolve()
    }

    const check = () => {
      if (settled) return
      let value = false
      try {
        value = predicate()
      } catch (error) {
        finish(error)
        return
      }
      if (value) finish()
    }

    timer = setTimeout(() => finish(new Error(`${label} timed out`)), timeoutMs)
    check()
    if (!settled) interval = setInterval(check, POLL_INTERVAL_MS)
  })
}

function isInsecureOrigin() {
  if (typeof window === 'undefined') return false
  if (typeof window.isSecureContext === 'boolean') return !window.isSecureContext
  const location = window.location
  if (!location) return false
  if (location.protocol === 'file:') return true
  if (location.protocol !== 'http:') return false
  return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname)
}

function readGeometry(detail) {
  if (!detail) return null
  const geometry = detail.geometry && typeof detail.geometry === 'object'
    ? detail.geometry
    : detail
  const width = Number(geometry.scaledWidth)
  const height = Number(geometry.scaledHeight)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return {width, height}
}

function getCropGeometry() {
  if (!targetManifest) return null
  const crop = targetManifest.sourceCropPx
  const panel = targetManifest.panelImagePx
  if (!Array.isArray(crop) || crop.length !== 4) return null
  if (!Array.isArray(panel) || panel.length !== 2) return null
  const values = [crop[0], crop[1], crop[2], crop[3], panel[0], panel[1]].map(Number)
  if (!values.every(Number.isFinite)) return null
  const [cx, cy, cw, ch, panelWidth, panelHeight] = values
  if (cw <= 0 || ch <= 0 || panelWidth <= 0 || panelHeight <= 0) return null
  return {cx, cy, cw, ch, panelWidth, panelHeight}
}

function manifestProblem() {
  if (!targetManifest || typeof targetManifest !== 'object') return 'Target manifest is missing.'
  if (targetManifest.schemaVersion !== 1 || targetManifest.contractVersion !== '1.0.0') {
    return 'Target manifest contract version does not match 1.0.0.'
  }
  if (!compiledTarget || typeof compiledTarget !== 'object') return 'Compiled target data is missing.'
  if (targetManifest.compiledTargetName !== compiledTarget.name) {
    return 'Compiled target name does not match the manifest.'
  }
  if (!targetManifest.trackingImagePath || targetManifest.trackingImagePath !== compiledTarget.imagePath) {
    return 'Tracking image path does not match the compiled target.'
  }
  if (!getCropGeometry()) return 'Target manifest crop or panel dimensions are invalid.'
  return null
}

function readCalibration() {
  const calibration = targetManifest && targetManifest.targetPoseCalibration
  if (!calibration || calibration.verified !== true) {
    return {
      rotationRadians: 0,
      mirrorX: false,
      offsetPanelX: 0,
      offsetPanelY: 0,
    }
  }
  const rotation = Number(calibration.rotationDeg)
  const offset = Array.isArray(calibration.offsetPanel) ? calibration.offsetPanel : []
  const offsetX = Number(offset[0])
  const offsetY = Number(offset[1])
  return {
    rotationRadians: Number.isFinite(rotation) ? rotation * Math.PI / 180 : 0,
    mirrorX: calibration.mirrorX === true,
    offsetPanelX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetPanelY: Number.isFinite(offsetY) ? offsetY : 0,
  }
}

function classifyRuntimeError(message) {
  const text = String(message || '')
  if (/permission|denied|notallowed/i.test(text)) return TRACKING_ERROR_CODES.CAMERA_DENIED
  if (/camera|device|notfound/i.test(text)) return TRACKING_ERROR_CODES.CAMERA_UNAVAILABLE
  if (/asset|target|404|failed to fetch|network/i.test(text)) return TRACKING_ERROR_CODES.ASSET_LOAD_FAILED
  return TRACKING_ERROR_CODES.ENGINE_FAILED
}

export function createTrackingAdapter({sceneEl, onState, onError} = {}) {
  const documentRef = typeof document !== 'undefined' ? document : null

  let epoch = 0
  let starting = false
  let disposed = false
  let active = false
  let ready = false
  let targetEl = null
  let root = null
  let geometryApplied = false
  let targetFound = false
  let currentState = null
  let lastReportedErrorCode = null
  let sceneListenersAttached = false
  let queue = Promise.resolve()
  let debugGroup = null

  if (sceneEl && typeof sceneEl.removeAttribute === 'function') {
    try {
      sceneEl.removeAttribute('xrweb')
    } catch (error) {}
  }

  function emitState(state) {
    if (disposed) return
    currentState = state
    safeCallback(onState, {
      state,
      root: state === TRACKING_STATES.TRACKED ? root : null,
      targetId: ready && targetManifest ? targetManifest.candidateId : null,
      manifest: ready && targetManifest ? targetManifest : null,
    })
  }

  function reportError(code, message, retryable) {
    if (disposed) return
    if (lastReportedErrorCode === code) return
    lastReportedErrorCode = code
    targetFound = false
    if (root) root.visible = false
    safeCallback(onError, {
      code,
      message: message || ERROR_MESSAGES[code] || ERROR_MESSAGES.ENGINE_FAILED,
      retryable: retryable === true,
    })
  }

  function applyGeometry(geometry) {
    if (!root || geometryApplied || !geometry) return
    const crop = getCropGeometry()
    if (!crop) return
    const {cx, cy, cw, ch, panelWidth, panelHeight} = crop
    const width = geometry.width
    const scale = width * panelWidth / cw
    const baseX = width * (panelWidth / 2 - cx - cw / 2) / cw
    const baseY = width * (cy + ch / 2 - panelHeight / 2) / cw
    const calibration = readCalibration()
    const signedBaseX = calibration.mirrorX ? -baseX : baseX
    const cos = Math.cos(calibration.rotationRadians)
    const sin = Math.sin(calibration.rotationRadians)
    const rotatedX = signedBaseX * cos - baseY * sin
    const rotatedY = signedBaseX * sin + baseY * cos
    const x = rotatedX + calibration.offsetPanelX * scale
    const y = rotatedY + calibration.offsetPanelY * scale

    root.scale.set(calibration.mirrorX ? -scale : scale, scale, scale)
    root.position.set(x, y, 0)
    root.rotation.set(0, 0, calibration.rotationRadians)
    root.userData.cropToPanelApplied = true
    root.userData.scaledCropWidth = width
    root.userData.scaledCropHeight = geometry.height
    root.userData.panelScale = scale
    geometryApplied = true
    if (!debugGroup && new URLSearchParams(window.location.search).has('debug')) {
      const T = window.AFRAME.THREE
      debugGroup = new T.Group()
      const h = panelHeight / panelWidth
      const points = [[-.5,h/2],[.5,h/2],[.5,-h/2],[-.5,-h/2],[-.5,h/2]]
      const geometry = new T.BufferGeometry().setFromPoints(points.map(([x,y]) => new T.Vector3(x,y,.01)))
      debugGroup.add(new T.Line(geometry,new T.LineBasicMaterial({color:0x00ffff})))
      points.slice(0,4).forEach(([x,y],i) => {
        const canvas = documentRef.createElement('canvas'); canvas.width=128;canvas.height=64
        const ctx=canvas.getContext('2d');ctx.fillStyle='#00ffff';ctx.font='bold 40px sans-serif';ctx.fillText(['TL','TR','BR','BL'][i],8,46)
        const sprite=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(canvas),depthTest:false}))
        sprite.position.set(x,y,.02);sprite.scale.set(.1,.05,1);debugGroup.add(sprite)
      })
      root.add(debugGroup)
    }
    if (active && targetFound) onTargetFound()
  }

  function onSceneImageFound(event) {
    if (disposed || !targetManifest) return
    const detail = event && event.detail
    if (!detail || detail.name !== targetManifest.compiledTargetName) return
    const geometry = readGeometry(detail)
    if (geometry) applyGeometry(geometry)
  }

  function onTargetGeometry(event) {
    if (disposed) return
    const detail = event && event.detail
    if (detail && detail.name && detail.name !== targetManifest.compiledTargetName) return
    const geometry = readGeometry(detail)
    if (geometry) applyGeometry(geometry)
  }

  function onTargetFound() {
    if (disposed || !active) return
    targetFound = true
    if (!geometryApplied) return
    if (root) root.visible = true
    emitState(TRACKING_STATES.TRACKED)
  }

  function onTargetLost() {
    if (disposed || !active) return
    targetFound = false
    if (root) root.visible = false
    if (currentState !== TRACKING_STATES.LOST) emitState(TRACKING_STATES.LOST)
  }

  function onCameraStatus(event) {
    if (disposed || (!active && !starting)) return
    const detail = event && event.detail ? event.detail : {}
    const reason = String(detail.reason || '').toUpperCase()
    const status = String(detail.status || '').toUpperCase()

    if (reason === 'DENY_CAMERA' || reason === 'DENIED' || reason === 'PERMISSION_DENIED' ||
      status === 'DENIED' || status === 'PERMISSION_DENIED') {
      reportError(TRACKING_ERROR_CODES.CAMERA_DENIED, ERROR_MESSAGES.CAMERA_DENIED, true)
      return
    }

    if (reason === 'NO_CAMERA' || reason === 'NOT_FOUND' || reason === 'CAMERA_UNAVAILABLE' ||
      status === 'FAILED' || status === 'ERROR') {
      reportError(TRACKING_ERROR_CODES.CAMERA_UNAVAILABLE, ERROR_MESSAGES.CAMERA_UNAVAILABLE, true)
    }
  }

  function onRealityError(event) {
    if (disposed || (!active && !starting)) return
    const error = event && event.detail ? event.detail.error : null
    const raw = error && typeof error === 'object' ? (error.message || error.name) : error
    const message = raw ? String(raw) : ERROR_MESSAGES.ENGINE_FAILED
    reportError(classifyRuntimeError(message), message, true)
  }

  function ensureSceneListeners() {
    if (sceneListenersAttached || !sceneEl || typeof sceneEl.addEventListener !== 'function') return
    sceneEl.addEventListener('xrimagefound', onSceneImageFound)
    sceneEl.addEventListener('camerastatuschange', onCameraStatus)
    sceneEl.addEventListener('realityerror', onRealityError)
    sceneListenersAttached = true
  }

  async function ensureTarget() {
    if (targetEl) {
      if (targetEl.parentNode !== sceneEl) sceneEl.appendChild(targetEl)
      return
    }
    if (typeof window === 'undefined' || !window.AFRAME || !window.AFRAME.THREE) {
      throw new Error('A-Frame THREE instance is unavailable.')
    }
    const AFRAME = window.AFRAME
    await waitForCondition(
      () => AFRAME.components && AFRAME.components[TARGET_COMPONENT],
      XREXTRAS_LOAD_TIMEOUT_MS,
      'xrextras named image target registration',
    )

    let element = null
    let group = null
    try {
      element = documentRef.createElement('a-entity')
      element.setAttribute(TARGET_COMPONENT, {name: targetManifest.compiledTargetName})
      element.addEventListener('xrextrasimagegeometry', onTargetGeometry)
      element.addEventListener('xrextrasfound', onTargetFound)
      element.addEventListener('xrextraslost', onTargetLost)
      sceneEl.appendChild(element)

      await waitForCondition(() => element.hasLoaded, ENTITY_LOAD_TIMEOUT_MS, 'named target entity load')
      if (!element.components || !element.components[TARGET_COMPONENT]) {
        throw new Error('xrextras named image target component did not initialise.')
      }

      group = new AFRAME.THREE.Group()
      const crop = getCropGeometry()
      group.name = 'canonical-full-panel-root'
      group.visible = false
      group.userData.targetId = targetManifest.candidateId
      group.userData.panelImagePx = targetManifest.panelImagePx.slice()
      group.userData.sourceCropPx = targetManifest.sourceCropPx.slice()
      group.userData.panelWidth = 1
      group.userData.panelHeight = crop.panelHeight / crop.panelWidth
      group.userData.cropToPanelApplied = false
      element.object3D.add(group)

      targetEl = element
      root = group
    } catch (error) {
      if (group && group.parent) group.parent.remove(group)
      if (element) {
        element.removeEventListener('xrextrasimagegeometry', onTargetGeometry)
        element.removeEventListener('xrextrasfound', onTargetFound)
        element.removeEventListener('xrextraslost', onTargetLost)
        if (element.parentNode) element.parentNode.removeChild(element)
      }
      throw error
    }
  }

  function configureEngine() {
    if (typeof window === 'undefined' || !window.XR8 || !window.XR8.XrController) {
      throw new Error('XR8.XrController is unavailable.')
    }
    if (typeof window.XR8.XrController.configure !== 'function') {
      throw new Error('XR8.XrController.configure is unavailable.')
    }
    window.XR8.XrController.configure({imageTargetData: [compiledTarget]})
  }

  async function stopRuntime() {
    active = false
    starting = false
    if (!sceneEl) return
    try {
      sceneEl.removeAttribute('xrweb')
    } catch (error) {}
    if (typeof window !== 'undefined' && window.XR8 && typeof window.XR8.stop === 'function') {
      try {
        await Promise.resolve(window.XR8.stop())
      } catch (error) {}
    }
    try {
      sceneEl.removeAttribute('xrconfig')
    } catch (error) {}
  }

  async function doStart(token) {
    const canceled = () => disposed || token !== epoch
    if (canceled()) return
    starting = true
    if (active) {
      if (!lastReportedErrorCode) return
      await stopRuntime()
    }

    lastReportedErrorCode = null
    targetFound = false
    if (root) root.visible = false
    emitState(TRACKING_STATES.LOADING)

    if (isInsecureOrigin()) {
      reportError(TRACKING_ERROR_CODES.INSECURE_ORIGIN, ERROR_MESSAGES.INSECURE_ORIGIN, false)
      return
    }
    if (!sceneEl || typeof sceneEl.setAttribute !== 'function' || typeof window === 'undefined') {
      reportError(TRACKING_ERROR_CODES.ENGINE_FAILED, ERROR_MESSAGES.ENGINE_FAILED, true)
      return
    }

    const problem = manifestProblem()
    if (problem) {
      reportError(TRACKING_ERROR_CODES.ASSET_LOAD_FAILED, problem, true)
      return
    }

    try {
      await waitForCondition(() => sceneEl.hasLoaded, SCENE_LOAD_TIMEOUT_MS, 'scene load')
      if (canceled()) return
      await waitForCondition(
        () => window.XR8 && window.XR8.XrController && window.AFRAME.components.xrweb,
        ENGINE_LOAD_TIMEOUT_MS,
        'XR engine load',
      )
      if (canceled()) return
      ensureSceneListeners()
      await ensureTarget()
      if (canceled()) return
      ready = true
      configureEngine()
    } catch (error) {
      if (canceled()) return
      reportError(
        TRACKING_ERROR_CODES.ENGINE_FAILED,
        messageFrom(error, ERROR_MESSAGES.ENGINE_FAILED),
        true,
      )
      return
    }

    if (canceled()) return

    starting = false
    active = true
    try {
      sceneEl.setAttribute('xrweb', 'disableWorldTracking: true')
    } catch (error) {
      if (canceled()) return
      active = false
      reportError(
        TRACKING_ERROR_CODES.ENGINE_FAILED,
        messageFrom(error, ERROR_MESSAGES.ENGINE_FAILED),
        true,
      )
      return
    }

    if (documentRef && documentRef.visibilityState === 'hidden') {
      await stopRuntime()
      emitState(TRACKING_STATES.PAUSED)
      return
    }

    if (!targetFound) emitState(TRACKING_STATES.SEARCHING)
  }

  async function doStop() {
    await stopRuntime()
    targetFound = false
    if (root) root.visible = false
  }

  async function doDispose() {
    await stopRuntime()
    if (debugGroup) {
      debugGroup.traverse(o => { if(o.geometry)o.geometry.dispose();if(o.material){if(o.material.map)o.material.map.dispose();o.material.dispose()} })
      debugGroup = null
    }

    if (documentRef && typeof documentRef.removeEventListener === 'function') {
      documentRef.removeEventListener('visibilitychange', onVisibilityChange)
    }
    if (sceneEl && typeof sceneEl.removeEventListener === 'function') {
      sceneEl.removeEventListener('xrimagefound', onSceneImageFound)
      sceneEl.removeEventListener('camerastatuschange', onCameraStatus)
      sceneEl.removeEventListener('realityerror', onRealityError)
    }
    sceneListenersAttached = false

    if (targetEl) {
      targetEl.removeEventListener('xrextrasimagegeometry', onTargetGeometry)
      targetEl.removeEventListener('xrextrasfound', onTargetFound)
      targetEl.removeEventListener('xrextraslost', onTargetLost)
    }
    if (root && root.parent) root.parent.remove(root)
    if (targetEl && targetEl.parentNode) targetEl.parentNode.removeChild(targetEl)

    targetEl = null
    root = null
    ready = false
    targetFound = false
    geometryApplied = false
    currentState = null
    active = false
  }

  function onVisibilityChange() {
    if (disposed || !documentRef || documentRef.visibilityState !== 'hidden') return
    if (!active && !starting) return
    epoch++
    starting = false
    if (root) root.visible = false
    enqueue(async () => {
      if (disposed) return
      await stopRuntime()
      targetFound = false
      if (root) root.visible = false
      if (!lastReportedErrorCode && currentState !== TRACKING_STATES.PAUSED) {
        emitState(TRACKING_STATES.PAUSED)
      }
    })
  }

  function enqueue(task) {
    const run = queue.then(task, task)
    queue = run.then(
      () => undefined,
      (error) => {
        reportError(
          TRACKING_ERROR_CODES.ENGINE_FAILED,
          messageFrom(error, ERROR_MESSAGES.ENGINE_FAILED),
          true,
        )
      },
    )
    return queue
  }

  function start() {
    if (disposed) return Promise.resolve()
    const token = ++epoch
    return enqueue(() => doStart(token))
  }

  function retry() {
    if (disposed) return Promise.resolve()
    const token = ++epoch
    return enqueue(async () => {
      await doStop()
      await doStart(token)
    })
  }

  function stop() {
    if (disposed) return Promise.resolve()
    epoch++
    starting = false
    active = false
    targetFound = false
    if (root) root.visible = false
    return enqueue(doStop)
  }

  function dispose() {
    if (disposed) return Promise.resolve()
    epoch++
    disposed = true
    if (root) root.visible = false
    return enqueue(doDispose)
  }

  if (documentRef && typeof documentRef.addEventListener === 'function') {
    documentRef.addEventListener('visibilitychange', onVisibilityChange)
  }

  return {start, retry, stop, dispose}
}
