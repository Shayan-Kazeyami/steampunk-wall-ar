const CONTROL_DEFINITIONS = [
  {key: 'start', label: 'Start', callback: 'onStart'},
  {key: 'overdrive', label: 'Overdrive', callback: 'onOverdrive'},
  {key: 'retry', label: 'Retry', callback: 'onRetry'},
  {key: 'preview', label: 'Preview animation', callback: 'onPreview'},
  {key: 'exitPreview', label: 'Exit preview', callback: 'onClosePreview'},
  {key: 'reset', label: 'Reset', callback: 'onReset'},
]

const CONTROL_INDEX = {
  start: 0,
  overdrive: 1,
  retry: 2,
  preview: 3,
  exitPreview: 4,
  reset: 5,
  reduceMotion: 6,
}

const CONTROL_KEY_BY_LABEL = Object.fromEntries(CONTROL_DEFINITIONS.map(item => [item.label, item.key]))
CONTROL_KEY_BY_LABEL['Reduce motion'] = 'reduceMotion'

const HELPER_TEXT = {
  landing: 'Preview animation needs no camera. For AR, open this HTTPS page in a camera-enabled mobile browser and scan the Garage Left artwork. Internet access is required.',
  loading: 'Allow camera access when your browser asks.',
  searching: 'Fill the frame with the print.',
  tracked: 'Turn away to release; aim back to reacquire.',
  lost: '',
  paused: '',
  error: 'Preview animation is available without the camera.',
  preview: 'Explore the gear without AR. Exit preview returns to Start.',
}

let uiInstanceCount = 0

function stopPropagation(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

function firstIdentifier(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

export function createUIController({
  mount,
  spec,
  onStart,
  onOverdrive,
  onRetry,
  onPreview,
  onClosePreview,
  onReset,
  onReducedMotionChange,
}) {
  if (!mount || typeof mount.appendChild !== 'function') {
    throw new TypeError('createUI requires a mount HTMLElement')
  }
  if (!spec || !spec.ui) {
    throw new Error('createUI requires the frozen shared spec with ui configuration')
  }

  if (spec.schemaVersion !== 1 || spec.contractVersion !== '1.0.0') {
    throw new Error('createUI received an unsupported spec version')
  }

  const uiSpec = spec.ui
  if (!uiSpec.stateMessages || !uiSpec.errorMessages || !uiSpec.visibleControlsByState || !Array.isArray(uiSpec.controls)) {
    throw new Error('createUI requires the frozen ui state, error and visibility contract')
  }

  const doc = mount.ownerDocument || document
  const view = doc.defaultView || window
  const stateMessages = uiSpec.stateMessages || {}
  const errorMessages = uiSpec.errorMessages || {}
  const visibleByState = uiSpec.visibleControlsByState || {}
  const validStates = new Set([...(uiSpec.trackingStates || []), ...(uiSpec.extraStates || [])])
  const initialReducedMotion = (() => {
    try {
      return typeof view.matchMedia === 'function'
        ? view.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false
    } catch (error) {
      return false
    }
  })()

  let currentState = 'landing'
  let canRetry = false
  let overdriveActive = false
  let disposed = false
  const listeners = []
  const buttons = {}

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options)
    listeners.push(() => target.removeEventListener(type, handler, options))
  }

  function createElement(tag, className, text) {
    const element = doc.createElement(tag)
    if (className) element.className = className
    if (typeof text === 'string') element.textContent = text
    return element
  }

  function controlLabel(key, fallback) {
    const labels = Array.isArray(uiSpec.controls) ? uiSpec.controls : []
    const label = labels[CONTROL_INDEX[key]]
    return typeof label === 'string' && label.length > 0 ? label : fallback
  }

  const controlKeyByLabel = {}
  for (const key of Object.keys(CONTROL_INDEX)) {
    const label = controlLabel(key, null)
    if (label) controlKeyByLabel[label] = key
  }

  const root = createElement('div', 'steampunk-ui')
  root.dataset.state = currentState
  root.dataset.overdrive = 'false'
  root.dataset.reducedMotion = initialReducedMotion ? 'true' : 'false'
  root.dataset.contractVersion = spec.contractVersion || '1.0.0'
  root.classList.toggle('is-reduced-motion', initialReducedMotion)

  if (typeof uiSpec.backgroundHex === 'string') root.style.setProperty('--sp-bg', uiSpec.backgroundHex)
  if (typeof uiSpec.textHex === 'string') root.style.setProperty('--sp-text', uiSpec.textHex)
  if (Number.isFinite(uiSpec.minButtonPx)) root.style.setProperty('--sp-min', `${uiSpec.minButtonPx}px`)
  if (spec.effects && typeof spec.effects.brassHex === 'string') root.style.setProperty('--sp-brass', spec.effects.brassHex)
  if (spec.effects && typeof spec.effects.amberHex === 'string') root.style.setProperty('--sp-amber', spec.effects.amberHex)

  const atmosphere = createElement('div', 'steampunk-ui__atmosphere')
  atmosphere.setAttribute('aria-hidden', 'true')

  const top = createElement('div', 'steampunk-ui__top')
  const hud = createElement('div', 'steampunk-ui__hud')

  const brand = createElement('div', 'steampunk-ui__brand')
  const brandMark = createElement('span', 'steampunk-ui__brand-mark')
  brandMark.setAttribute('aria-hidden', 'true')
  const brandName = createElement('span', 'steampunk-ui__brand-name', 'Steampunk Wall')
  brand.append(brandMark, brandName)

  const previewFlag = createElement(
    'p',
    'steampunk-ui__preview-flag',
    typeof uiSpec.previewLabel === 'string' ? uiSpec.previewLabel : 'Animation preview — not live AR.',
  )
  previewFlag.hidden = true

  const status = createElement('p', 'steampunk-ui__status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.setAttribute('aria-atomic', 'true')
  status.setAttribute('tabindex', '-1')
  const statusDot = createElement('span', 'steampunk-ui__status-dot')
  statusDot.setAttribute('aria-hidden', 'true')
  const statusText = createElement('span', 'steampunk-ui__status-text')
  status.append(statusDot, statusText)

  const helper = createElement('p', 'steampunk-ui__helper')
  helper.hidden = true

  const artwork = createElement('a', 'steampunk-ui__helper', 'View or print the Garage Left artwork')
  artwork.href = './assets/target-sample.html'
  artwork.target = '_blank'
  artwork.rel = 'noopener'
  artwork.style.pointerEvents = 'auto'
  artwork.style.color = 'inherit'
  artwork.setAttribute('aria-label', 'View or print the Garage Left artwork (opens a new tab)')
  hud.append(brand, previewFlag, status, helper, artwork)
  top.append(hud)

  const dock = createElement('div', 'steampunk-ui__dock')
  const controls = createElement('div', 'steampunk-ui__controls')
  controls.setAttribute('role', 'group')
  controls.setAttribute('aria-label', 'Demo controls')

  for (const definition of CONTROL_DEFINITIONS) {
    const button = createElement('button', 'steampunk-ui__button', controlLabel(definition.key, definition.label))
    button.type = 'button'
    button.dataset.control = definition.key
    if (definition.key === 'overdrive') button.setAttribute('aria-pressed', 'false')
    listen(button, 'pointerdown', stopPropagation)
    listen(button, 'click', event => {
      stopPropagation(event)
      const callback = {onStart, onOverdrive, onRetry, onPreview, onClosePreview, onReset}[definition.callback]
      if (typeof callback === 'function') callback()
    })
    buttons[definition.key] = button
    controls.append(button)
  }

  const motion = createElement('label', 'steampunk-ui__motion')
  motion.dataset.control = 'reduceMotion'
  const motionInput = createElement('input', 'steampunk-ui__motion-input')
  motionInput.type = 'checkbox'
  motionInput.id = `steampunk-ui-motion-${++uiInstanceCount}`
  const motionBox = createElement('span', 'steampunk-ui__motion-box')
  motionBox.setAttribute('aria-hidden', 'true')
  const motionText = createElement('span', 'steampunk-ui__motion-text', controlLabel('reduceMotion', 'Reduce motion'))
  motion.append(motionInput, motionBox, motionText)

  listen(motion, 'pointerdown', stopPropagation)
  listen(motion, 'click', stopPropagation)
  listen(motionInput, 'change', () => {
    const next = motionInput.checked
    applyReducedMotion(next)
    if (typeof onReducedMotionChange === 'function') onReducedMotionChange(next)
  })

  controls.append(motion)
  dock.append(controls)
  root.append(atmosphere, top, dock)

  function applyReducedMotion(value) {
    const next = Boolean(value)
    motionInput.checked = next
    root.dataset.reducedMotion = next ? 'true' : 'false'
    root.classList.toggle('is-reduced-motion', next)
  }

  function applyOverdrive(value) {
    overdriveActive = Boolean(value)
    root.dataset.overdrive = overdriveActive ? 'true' : 'false'
    buttons.overdrive.setAttribute('aria-pressed', overdriveActive ? 'true' : 'false')
    buttons.overdrive.classList.toggle('is-active', overdriveActive)
  }

  function resolveTargetLabel(value) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    const panels = spec.panels || {}
    const candidates = Array.isArray(spec.candidates) ? spec.candidates : []
    const primary = candidates[0]
    if (primary && panels[primary.panelKey] && typeof panels[primary.panelKey].label === 'string') {
      return panels[primary.panelKey].label
    }
    return 'printed'
  }

  function resolveMessage(state, explicitMessage, code, targetLabel) {
    if (explicitMessage) return explicitMessage
    if (state === 'error' && code && typeof errorMessages[code] === 'string') return errorMessages[code]
    const template = stateMessages[state]
    if (typeof template !== 'string') return ''
    if (state === 'searching') {
      return template.replace('{targetLabel}', () => resolveTargetLabel(targetLabel))
    }
    return template
  }

  function resolveVisible(state, allowRetry) {
    const names = Array.isArray(visibleByState[state]) ? visibleByState[state] : []
    const visible = new Set()
    for (const name of names) {
      if (name === 'Retry_if_canRetry') {
        if (allowRetry) visible.add('retry')
        continue
      }
      if (CONTROL_KEY_BY_LABEL[name]) visible.add(CONTROL_KEY_BY_LABEL[name])
    }
    return visible
  }

  function isHidden(element) {
    if (!element || !element.isConnected) return true
    if (element.hidden) return true
    if (element.closest && element.closest('[hidden]')) return true
    try {
      const style = view.getComputedStyle(element)
      return style.display === 'none' || style.visibility === 'hidden'
    } catch (error) {
      return false
    }
  }

  function firstVisibleControl() {
    for (const definition of CONTROL_DEFINITIONS) {
      const button = buttons[definition.key]
      if (!isHidden(button) && !button.disabled) return button
    }
    if (!isHidden(motionInput) && !motionInput.disabled) return motionInput
    return null
  }

  function keepFocusVisible(previousActive) {
    if (!previousActive || !root.contains(previousActive)) return
    if (!isHidden(previousActive) && !previousActive.disabled) return
    const next = firstVisibleControl()
    if (!next || next === previousActive || typeof next.focus !== 'function') return
    try {
      next.focus({preventScroll: true})
    } catch (error) {
      next.focus()
    }
  }

  function setState(payload) {
    if (disposed) return
    const previousActive = doc.activeElement
    const next = payload && typeof payload === 'object' ? payload : {}
    const requested = next.state
    if (typeof requested === 'string' && validStates.has(requested)) currentState = requested

    const errorInfo = next.error && typeof next.error === 'object' ? next.error : null
    const code = firstIdentifier(next.code, next.errorCode, errorInfo && errorInfo.code)
    const explicitMessage = firstText(next.message, errorInfo && errorInfo.message)
    const explicitRetry = typeof next.canRetry === 'boolean'
      ? next.canRetry
      : typeof next.retryable === 'boolean'
        ? next.retryable
        : errorInfo && typeof errorInfo.retryable === 'boolean'
          ? errorInfo.retryable
          : null

    canRetry = explicitRetry !== null
      ? explicitRetry
      : currentState === 'error' && code
        ? code !== 'INSECURE_ORIGIN'
        : false

    const message = resolveMessage(currentState, explicitMessage, code, next.targetLabel)
    root.dataset.state = currentState
    root.dataset.canRetry = canRetry ? 'true' : 'false'
    status.setAttribute('aria-busy', currentState === 'loading' ? 'true' : 'false')

    if (statusText.textContent !== message) statusText.textContent = message

    const helperText = HELPER_TEXT[currentState] || ''
    if (helper.textContent !== helperText) helper.textContent = helperText
    helper.hidden = helperText === ''

    previewFlag.hidden = currentState !== 'preview'
    artwork.hidden = !['landing', 'error'].includes(currentState)

    const visible = resolveVisible(currentState, canRetry)
    for (const definition of CONTROL_DEFINITIONS) {
      buttons[definition.key].hidden = !visible.has(definition.key)
    }
    motion.hidden = !visible.has('reduceMotion')

    const overdriveAllowed = currentState === 'tracked' || currentState === 'preview'
    buttons.overdrive.disabled = !overdriveAllowed
    if (!overdriveAllowed) applyOverdrive(false)

    keepFocusVisible(previousActive)
  }

  function setOverdrive(value) {
    if (disposed) return
    const allowed = currentState === 'tracked' || currentState === 'preview'
    applyOverdrive(allowed ? Boolean(value) : false)
  }

  function setReducedMotion(value) {
    if (disposed) return
    applyReducedMotion(Boolean(value))
  }

  function dispose() {
    if (disposed) return
    disposed = true
    while (listeners.length > 0) {
      const remove = listeners.pop()
      remove()
    }
    if (root.parentNode) root.parentNode.removeChild(root)
  }

  applyReducedMotion(initialReducedMotion)
  mount.appendChild(root)
  setState({state: 'landing'})

  return {setState, setOverdrive, setReducedMotion, dispose}
}
