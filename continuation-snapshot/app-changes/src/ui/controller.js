const CONTROL_DEFINITIONS = [
  {key: 'start', label: 'Start', callback: 'onStart'},
  {key: 'overdrive', label: 'Overdrive', callback: 'onOverdrive'},
  {key: 'retry', label: 'Retry', callback: 'onRetry'},
  {key: 'preview', label: 'Preview animation', callback: 'onPreview'},
  {key: 'exitPreview', label: 'Exit preview', callback: 'onClosePreview'},
  {key: 'reset', label: 'Reset', callback: 'onReset'},
  {key: 'cancel', label: 'Cancel', callback: 'onCancel'},
  {key: 'stop', label: 'Stop camera', callback: 'onStop'},
]

const CONTROL_INDEX = {
  start: 0,
  overdrive: 1,
  retry: 2,
  preview: 3,
  exitPreview: 4,
  reset: 5,
  reduceMotion: 6,
  cancel: 7,
  stop: 8,
}

const CONTROL_KEY_BY_LABEL = Object.fromEntries(CONTROL_DEFINITIONS.map(item => [item.label, item.key]))
CONTROL_KEY_BY_LABEL['Reduce motion'] = 'reduceMotion'

const HELPER_TEXT = {
  landing: 'Start scans the printed artwork. Preview animation shows the machinery without AR.',
  loading: 'This can take a moment. You can cancel and try again.',
  searching: 'Fill the frame with the print.',
  tracked: 'Turn away to release; aim back to reacquire.',
  lost: '',
  paused: '',
  error: 'Preview animation is available without the camera.',
  preview: 'Explore the machinery without AR. Exit preview returns to Start.',
}

const COLLECTION_HELPER_TEXT = {
  searching: 'Driveway: frame the central JZ Light Show sign and nearby machinery. Garage Left: frame the clock and surrounding gears.',
  lost: 'Bring the sign or clock back into view. Move a little closer if needed, then hold steady.',
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
  onCancel,
  onStop,
  onReducedMotionChange,
  onSoundChange,
  onMachineAction,
  targetImageUrl,
  collection,
  onPreviewWall,
  onHelpChange,
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
  const walls=Array.isArray(collection)?collection:[]
  const isCollection=walls.length>0
  const singleWall=walls.length===1
  const collectionHelper=singleWall?{searching:"Frame the central JZ Light Show sign and nearby machinery.",lost:"Bring the sign and nearby machinery back into view. Hold steady."}:COLLECTION_HELPER_TEXT
  let activeWall=walls[0] || null,machineAvailable=typeof onMachineAction==='function'
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
  let soundAvailable = false
  let soundEnabled = false
  let soundPending = false
  let soundGeneration = 0
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
    if(isCollection){const labels={start:'Start scanning',overdrive:'Boost',preview:singleWall?'Preview Driveway':'Explore walls',exitPreview:singleWall?'Back':'Back to collection',reset:'Restart',stop:'Stop scanning'};if(labels[key])return labels[key]}
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
  root.classList.toggle('is-collection',isCollection)
  root.classList.toggle('is-single-wall',singleWall)
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
  const brandName = createElement('span', 'steampunk-ui__brand-name', isCollection?'JZ LIGHT SHOW':'Steampunk Wall')
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

  const loadingProgress = createElement('div', 'steampunk-ui__loading-progress')
  loadingProgress.hidden = true
  const loadingLabel = createElement('p', 'steampunk-ui__loading-label')
  // Phase changes announce politely; byte updates stay outside this live region.
  loadingLabel.setAttribute('role', 'status')
  loadingLabel.setAttribute('aria-live', 'polite')
  loadingLabel.setAttribute('aria-atomic', 'true')
  const loadingMeter = createElement('div', 'steampunk-ui__loading-meter')
  loadingMeter.setAttribute('role', 'progressbar')
  loadingMeter.setAttribute('aria-label', 'Artwork preparation')
  const loadingFill = createElement('span', 'steampunk-ui__loading-fill')
  loadingFill.setAttribute('aria-hidden', 'true')
  loadingMeter.append(loadingFill)
  const loadingDetail = createElement('p', 'steampunk-ui__loading-detail')
  loadingDetail.setAttribute('aria-hidden', 'true')
  loadingProgress.append(loadingLabel, loadingMeter, loadingDetail)
  hud.append(brand, previewFlag, status, helper, loadingProgress)
  if (targetImageUrl && !isCollection) {
    const targetLink = createElement('a', 'steampunk-ui__target-link', 'Open target image')
    targetLink.href = targetImageUrl
    targetLink.target = '_blank'
    targetLink.rel = 'noopener'
    hud.append(targetLink)
  }
  top.append(hud)
  const landing=createElement('section','collection-landing')
  landing.hidden=true
  const heroCopy=createElement('div','collection-hero-copy')
  const previewTabs=createElement('div','collection-preview-tabs')
  previewTabs.setAttribute('role','group');previewTabs.setAttribute('aria-label','Preview a wall');previewTabs.hidden=true
  const helpDialog=createElement('dialog','collection-help')
  helpDialog.setAttribute('aria-label',singleWall?'How to scan Driveway':'How to scan the walls')
  let helpReturn=null
  let helpOpen=false
  let dismissHelp=()=>{}
  const tabButtons=[]
  if(isCollection){
    const helpButton=createElement('button','collection-help-button','How to scan')
    helpButton.type='button';helpButton.setAttribute('aria-haspopup','dialog');top.append(helpButton)
    const closeHelp=createElement('button','collection-help-close','Close guide');closeHelp.type='button'
    function hideHelp(){
      if(!helpOpen)return
      helpOpen=false
      if(helpDialog.open && helpDialog.close)helpDialog.close()
      helpDialog.removeAttribute('open');helpDialog.hidden=true
      onHelpChange?.(false)
      if(!disposed && helpReturn?.isConnected && !isHidden(helpReturn))helpReturn.focus({preventScroll:true})
    }
    dismissHelp=hideHelp
    listen(helpButton,'click',()=>{
      if(helpOpen)return
      helpReturn=doc.activeElement;helpDialog.hidden=false
      if(helpDialog.showModal)helpDialog.showModal();else helpDialog.setAttribute('open','')
      helpOpen=true;onHelpChange?.(true);closeHelp.focus({preventScroll:true})
    })
    listen(closeHelp,'click',hideHelp)
    listen(helpDialog,'cancel',event=>{event.preventDefault();hideHelp()})
    listen(helpDialog,'close',hideHelp)
    listen(helpDialog,'keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();hideHelp()}
      // Native dialogs contain focus; this also supports older dialog implementations.
      if(event.key==='Tab'){event.preventDefault();closeHelp.focus()}
    })
    helpDialog.hidden=true
    const helpHeading=createElement('h2','',singleWall?'Bring Driveway into view.':'Bring either wall into view.')
    helpHeading.id=`steampunk-scan-guide-${uiInstanceCount+1}`
    helpDialog.setAttribute('aria-labelledby',helpHeading.id)
    const helpHeader=createElement('div','collection-help-header')
    helpHeader.append(createElement('p','collection-eyebrow','YOUR SCANNING GUIDE'),closeHelp)
    const steps=createElement('ol','collection-help-steps')
    for(const [title,detail]of [
      ['Start your camera','Tap Start scanning and allow camera access.'],
      ['Find the artwork',collectionHelper.searching+' Hold steady until the machinery appears.'],
      [singleWall?'Explore the machinery':'Explore and move between walls',singleWall?'Move closer to explore. Tap a valve, gear or gauge to interact.':'Move closer to explore. Aim at the other artwork to switch automatically.'],
    ]){
      const item=createElement('li','')
      item.append(createElement('strong','',title),createElement('span','',detail));steps.append(item)
    }
    helpDialog.append(helpHeader,helpHeading,steps)
    const gallery=createElement('div','collection-targets')
    const eyebrow=createElement('p','collection-eyebrow',singleWall?'THE DRIVEWAY EXPERIENCE':'THE STEAMPUNK COLLECTION')
    const title=createElement('h1','collection-title',singleWall?'Wake the ':'Art that comes alive.')
    if(singleWall)title.append(createElement('em','','machinery.'))
    const intro=createElement('p','collection-intro',singleWall?'Scan the Driveway artwork to bring it to life.':'Discover moving machinery, glowing brass and drifting steam. One camera brings both walls to life.')
    const cards=createElement('div','collection-cards')
    for(const [index,wall]of walls.entries()){
      const card=createElement('button','collection-card');card.type='button';card.dataset.previewWall=wall.id;card.setAttribute('aria-label','Preview '+wall.label)
      const image=createElement('img','collection-card-image');image.src=wall.previewImage;image.alt=wall.label+' artwork';image.decoding='async'
      const caption=createElement('span','collection-card-caption')
      const text=createElement('span','collection-card-copy')
      text.append(createElement('span','collection-card-number','0'+(index+1)),createElement('strong','',wall.label),createElement('span','collection-card-detail',wall.id==='driveway'?'Brass, motion & steam':'Gears, glow & character'))
      const previewHint=createElement('span','collection-card-arrow',singleWall?'Explore preview ↗':'Preview ↗')
      previewHint.setAttribute('aria-hidden','true')
      caption.append(text,previewHint)
      card.append(image,caption);listen(card,'click',()=>onPreviewWall?.(wall.id));cards.append(card)
      const tab=createElement('button','collection-preview-tab',wall.label);tab.type='button';tab.dataset.previewTab=wall.id;tab.setAttribute('aria-pressed','false')
      listen(tab,'click',()=>onPreviewWall?.(wall.id));tabButtons.push(tab);previewTabs.append(tab)
      const figure=createElement('figure','collection-target'),thumb=createElement('img','');thumb.src=wall.previewImage;thumb.alt=wall.label+' target artwork'
      figure.append(thumb,createElement('figcaption','',wall.label));gallery.append(figure)
    }
    helpDialog.append(gallery,createElement('p','collection-help-note',singleWall?'Use even lighting and keep the central sign and nearby machinery in view. Hold steady until the artwork comes alive.':'Use even lighting. If tracking is lost, bring the sign or clock back into view. Move a little closer if needed, then hold steady.'))
    if(singleWall){
      heroCopy.append(eyebrow,title,intro)
      const features=createElement('p','collection-features','Moving gears · Rising steam · Your touch')
      heroCopy.append(features)
      const how=createElement('ol','collection-quick-start')
      how.setAttribute('aria-label','How the experience works')
      for(const [heading,detail]of [
        ['Open your camera','Tap Start scanning and allow camera access.'],
        ['Find the sign','Frame the JZ Light Show sign and nearby machinery.'],
        ['Make it move','Hold steady, then tap a valve, gear or gauge.'],
      ]){
        const step=createElement('li','')
        step.append(createElement('strong','',heading),createElement('span','',detail));how.append(step)
      }
      const share=createElement('details','collection-share')
      share.append(createElement('summary','','QR code & scanning target'))
      const shareBody=createElement('div','collection-share-body')
      for(const [src,alt,label]of [['assets/driveway-qr.png','QR code to open the Driveway experience','Scan to open on your phone'],['assets/driveway-target.png','Driveway central sign and machinery scanning target','Frame this part of the artwork']]){
        const figure=createElement('figure',''),image=createElement('img','')
        image.src=src;image.alt=alt;image.loading='lazy';image.decoding='async'
        const link=createElement('a','',label);link.href=src;link.target='_blank';link.rel='noopener'
        figure.append(image,createElement('figcaption','',label),link)
        link.textContent=src.includes('-qr')?'Open QR code':'Open target image'
        shareBody.append(figure)
      }
      share.append(shareBody)
      landing.append(heroCopy,cards,share,how,createElement('p','collection-ready','JZ LIGHT SHOW / ART IN MOTION'))
    }else landing.append(eyebrow,title,intro,cards,createElement('p','collection-ready','TWO WALLS · AUTOMATIC RECOGNITION'))
  }

  const dock = createElement('div', 'steampunk-ui__dock')
  const controls = createElement('div', 'steampunk-ui__controls')
  controls.setAttribute('role', 'group')
  controls.setAttribute('aria-label', isCollection ? 'Experience controls' : 'Demo controls')

  for (const definition of CONTROL_DEFINITIONS) {
    const button = createElement('button', 'steampunk-ui__button', controlLabel(definition.key, definition.label))
    button.type = 'button'
    button.dataset.control = definition.key
    if (definition.key === 'overdrive') button.setAttribute('aria-pressed', 'false')
    listen(button, 'pointerdown', stopPropagation)
    listen(button, 'click', event => {
      stopPropagation(event)
      if (['stop', 'reset', 'cancel', 'exitPreview'].includes(definition.key)) releaseSound()
      const callback = {onStart, onOverdrive, onRetry, onPreview, onClosePreview, onReset, onCancel, onStop}[definition.callback]
      if (typeof callback === 'function') callback()
    })
    buttons[definition.key] = button
    if(singleWall && definition.key==='preview')button.textContent='Preview without camera'
    controls.append(button)
  }

  const soundButton = createElement('button', 'steampunk-ui__button steampunk-ui__sound', 'Sound off')
  soundButton.type = 'button'
  soundButton.dataset.control = 'sound'
  soundButton.setAttribute('aria-pressed', 'false')
  soundButton.hidden = true
  soundButton.disabled = true
  const soundStatus = createElement('p', 'steampunk-ui__sound-status')
  soundStatus.setAttribute('role', 'status')
  soundStatus.setAttribute('aria-live', 'polite')
  soundStatus.hidden = true
  listen(soundButton, 'pointerdown', stopPropagation)
  listen(soundButton, 'click', async event => {
    stopPropagation(event)
    if (!soundAllowed() || soundPending) return
    const requested = !soundEnabled
    const token = ++soundGeneration
    soundPending = true
    soundStatus.hidden = true
    refreshSoundUI()
    try {
      // Invoke immediately inside the click handler to retain browser audio activation.
      const result = await onSoundChange(requested)
      if (disposed || token !== soundGeneration) return
      soundEnabled = requested && result !== false && soundAllowed()
      if (requested && !soundEnabled) {
        soundStatus.textContent = 'Sound could not start. Tap to try again.'
        soundStatus.hidden = false
      }
    } catch (error) {
      if (disposed || token !== soundGeneration) return
      soundEnabled = false
      soundStatus.textContent = 'Sound could not start. Tap to try again.'
      soundStatus.hidden = false
    } finally {
      if (!disposed && token === soundGeneration) {
        soundPending = false
        refreshSoundUI()
      }
    }
  })
  controls.append(soundButton)

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
  const optionsButton=createElement('button','steampunk-ui__button steampunk-ui__options-toggle','Options')
  optionsButton.type='button';optionsButton.hidden=true
  optionsButton.setAttribute('aria-expanded','false')
  const optionsPanel=createElement('div','steampunk-ui__options-panel')
  optionsPanel.id=`steampunk-options-${uiInstanceCount}`;optionsPanel.hidden=true
  optionsPanel.setAttribute('role','group');optionsPanel.setAttribute('aria-label','More experience options')
  optionsButton.setAttribute('aria-controls',optionsPanel.id)
  let compact=false,optionsOpen=false
  function closeOptions(restoreFocus=false){
    optionsOpen=false;optionsPanel.hidden=true;optionsButton.setAttribute('aria-expanded','false')
    if(restoreFocus && !optionsButton.hidden)optionsButton.focus({preventScroll:true})
  }
  listen(optionsButton,'pointerdown',stopPropagation)
  listen(optionsButton,'click',event=>{
    stopPropagation(event)
    if(optionsOpen){closeOptions();return}
    optionsOpen=true;optionsPanel.hidden=false;optionsButton.setAttribute('aria-expanded','true')
    const first=[...optionsPanel.querySelectorAll('button,input')].find(el=>!el.disabled && !isHidden(el))
    first?.focus({preventScroll:true})
  })
  listen(root,'keydown',event=>{
    if(event.key==='Escape' && optionsOpen){event.preventDefault();event.stopPropagation();closeOptions(true)}
  })
  listen(doc,'pointerdown',event=>{
    if(optionsOpen && !optionsPanel.contains(event.target) && !optionsButton.contains(event.target))closeOptions(optionsPanel.contains(doc.activeElement))
  })
  controls.append(optionsButton)
  const machineControls=createElement('div','steampunk-ui__machine-controls')
  machineControls.setAttribute('role','group');machineControls.setAttribute('aria-label','Machine interactions')
  const machineButtons=[]
  for(const [action,label]of [['valve','Turn valve'],['release','Release steam'],['restart','Restart machine'],...(singleWall?[['lamp','Switch light'],['sign','Light the sign']]:[])]){
    if(isCollection && action==='restart')continue
    const button=createElement('button','steampunk-ui__button',label)
    button.type='button';button.dataset.machineAction=action
    listen(button,'pointerdown',stopPropagation)
    listen(button,'click',event=>{
      stopPropagation(event)
      if(!machineAllowed())return
      if(action==='restart')releaseSound()
      if(onMachineAction?.(action))announceMachine(action)
    })
    machineButtons.push(button);machineControls.append(button)
  }
  const machineStatus=createElement('p','steampunk-ui__machine-status')
  machineStatus.setAttribute('role','status');machineStatus.setAttribute('aria-live','polite');machineStatus.hidden=true
  const cameraNote=createElement('p','collection-camera-note','Camera opens only when you start scanning.')
  cameraNote.hidden=!isCollection
  dock.append(previewTabs,machineControls, controls, optionsPanel,soundStatus,machineStatus,cameraNote)
  const reticle=createElement('div','collection-reticle')
  reticle.setAttribute('aria-hidden','true');reticle.hidden=true
  reticle.append(createElement('span','collection-reticle-label',singleWall?'DRIVEWAY · JZ LIGHT SHOW SIGN':'DRIVEWAY OR GARAGE LEFT'))
  root.append(atmosphere, top, landing,reticle,dock)
  if(isCollection)root.append(helpDialog)

  function layoutControls(){
    if(!singleWall)return
    const next=view.innerWidth<=600 || (view.innerHeight<=500 && view.innerWidth<=900)
    if(next!==compact)closeOptions()
    compact=next;root.classList.toggle('is-compact',compact)
    const secondary=[buttons.overdrive,buttons.reset,soundButton,motion]
    for(const element of secondary){const parent=compact?optionsPanel:controls;if(element.parentNode!==parent)parent.append(element)}
    const soundParent=compact?optionsPanel:dock
    if(soundStatus.parentNode!==soundParent)soundParent.append(soundStatus)
    for(const valve of machineButtons.filter(button=>button.dataset.machineAction!=='release')){
      const parent=compact?optionsPanel:machineControls
      if(valve.parentNode!==parent)parent.append(valve)
      if(compact)optionsPanel.insertBefore(valve,soundButton)
      valve.hidden=compact && (!machineAvailable || !['tracked','preview'].includes(currentState))
    }
    const previewParent=compact && !['error','paused'].includes(currentState)?optionsPanel:controls
    if(buttons.preview.parentNode!==previewParent)previewParent.append(buttons.preview)
    if(previewParent===optionsPanel)optionsPanel.prepend(buttons.preview)
    optionsButton.hidden=!compact || !['landing','searching','lost','tracked','preview'].includes(currentState)
    if(optionsButton.hidden)closeOptions()
  }
  listen(view,'resize',()=>{const previous=doc.activeElement;layoutControls();keepFocusVisible(previous)})

  function soundAllowed() {
    return soundAvailable && !doc.hidden && (currentState === 'tracked' || currentState === 'preview')
  }
  function machineAllowed(){return machineAvailable && typeof onMachineAction==='function' && !doc.hidden && !motionInput.checked && ['tracked','preview'].includes(currentState)}
  function refreshMachineUI(){
    machineControls.hidden=!machineAvailable || typeof onMachineAction!=='function' || !['tracked','preview'].includes(currentState)
    for(const button of machineButtons)button.disabled=!machineAllowed()
    if(!machineAllowed()){machineStatus.hidden=true;machineStatus.textContent=''}
  }
  function setMachineAvailable(value){machineAvailable=!!value;refreshMachineUI();layoutControls()}
  function setActiveWall(id){
    if(!isCollection)return
    activeWall=walls.find(wall=>wall.id===id) || activeWall
    root.dataset.activeWall=activeWall?.id || ''
    for(const tab of tabButtons)tab.setAttribute('aria-pressed',String(tab.dataset.previewTab===activeWall?.id))
  }
  function announceMachine(action){
    if(disposed || !machineAllowed())return
    const message={valve:'Valve opened. Pressure falling; steam releasing.',handle:'Control handle turned.',lamp:'Light switched.',sign:'Sign lighting animation started.',release:'Steam released. Pressure will recover.',gear:'Gear drive boosted.',restart:'Machine restarting.'}[action]
    if(message){machineStatus.textContent=message;machineStatus.hidden=false}
  }

  function refreshSoundUI() {
    soundButton.hidden = !soundAvailable || (isCollection && !['tracked','preview'].includes(currentState))
    soundButton.disabled = !soundAllowed() || soundPending
    soundButton.textContent = soundPending ? 'Starting sound…' : soundEnabled ? 'Sound on' : 'Sound off'
    soundButton.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false')
    root.dataset.sound = soundEnabled ? 'true' : 'false'
  }

  function releaseSound() {
    const needsRelease = soundEnabled || soundPending
    ++soundGeneration
    soundEnabled = false
    soundPending = false
    soundStatus.hidden = true
    refreshSoundUI()
    if (needsRelease && typeof onSoundChange === 'function') {
      try { Promise.resolve(onSoundChange(false)).catch(() => {}) } catch (error) { /* Best-effort audio cleanup. */ }
    }
  }

  function setSoundEnabled(value) {
    if (disposed) return
    ++soundGeneration
    soundEnabled = Boolean(value) && soundAllowed()
    soundPending = false
    soundStatus.hidden = true
    refreshSoundUI()
  }

  function setSoundAvailable(value) {
    if (disposed) return
    soundAvailable = Boolean(value) && typeof onSoundChange === 'function'
    if (!soundAvailable) releaseSound()
    refreshSoundUI()
  }

  listen(doc, 'visibilitychange', () => {
    if (doc.hidden) { releaseSound(); clearLoadingProgress(); closeOptions() }
    refreshSoundUI()
    refreshMachineUI()
  })

  function applyReducedMotion(value) {
    const next = Boolean(value)
    motionInput.checked = next
    root.dataset.reducedMotion = next ? 'true' : 'false'
    root.classList.toggle('is-reduced-motion', next)
    buttons.overdrive.disabled = !overdriveAllowed()
    if (!overdriveAllowed()) applyOverdrive(false)
    refreshMachineUI()
  }

  function overdriveAllowed() {
    return !motionInput.checked && (currentState === 'tracked' || currentState === 'preview')
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
    if(isCollection && state!=='error')return {landing:'Ready to explore',loading:'Preparing your experience…',searching:'Find a wall',tracked:(targetLabel || activeWall?.label || 'The wall')+' is alive',lost:'Looking for the next wall',paused:'Camera paused',preview:(activeWall?.label || 'Wall')+' · Preview'}[state] || ''
    if(isCollection && state==='error')return {
      CAMERA_DENIED:'Camera access is off. Allow it in your browser’s site settings, then tap Retry.',
      CAMERA_UNAVAILABLE:'Your camera is unavailable. Close other camera apps, then tap Retry.',
      INSECURE_ORIGIN:'Open the secure experience link to use your camera.',
      ASSET_LOAD_FAILED:'The artwork could not load. Check your connection, then tap Retry.',
      ENGINE_FAILED:'Scanning could not start. Tap Retry, or explore an artwork preview.',
    }[code] || 'The experience could not start. Try again or explore an artwork preview.'
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
      const key = controlKeyByLabel[name] || CONTROL_KEY_BY_LABEL[name]
      if (key) visible.add(key)
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
    if (!isHidden(soundButton) && !soundButton.disabled) return soundButton
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

  function clearLoadingProgress() {
    loadingProgress.hidden = true
    loadingLabel.textContent = ''
    loadingDetail.textContent = ''
    delete loadingProgress.dataset.phase
    delete loadingProgress.dataset.status
    loadingMeter.removeAttribute('aria-valuenow')
    loadingMeter.removeAttribute('aria-valuemin')
    loadingMeter.removeAttribute('aria-valuemax')
    loadingMeter.removeAttribute('aria-valuetext')
    loadingFill.style.removeProperty('width')
  }

  function setLoadingProgress(update) {
    if (disposed || currentState !== 'loading' || doc.hidden) return false
    if (update == null) { clearLoadingProgress(); return true }
    const labels = {
      download: 'Downloading the artwork…',
      decode: 'Preparing the machinery…',
      environment: 'Preparing the lighting…',
      warmup: 'Getting the artwork ready…',
      camera: 'Opening your camera. Allow access if asked.',
      'target-data': 'Loading the scanning reference…',
    }
    const statuses = ['loading', 'complete', 'fallback', 'skipped']
    if (!Object.prototype.hasOwnProperty.call(labels, update.phase) || !statuses.includes(update.status)) return false
    const settledLabels = {
      download: 'Artwork download complete.',
      decode: 'Machinery prepared.',
      environment: 'Lighting prepared.',
      warmup: 'Artwork prepared.',
      camera: 'Camera opened.',
      'target-data': 'Scanning reference loaded.',
    }
    let label = update.status === 'complete' ? settledLabels[update.phase] : labels[update.phase]
    if (update.status === 'fallback') label = update.phase === 'environment'
      ? 'Continuing with standard lighting.' : 'Continuing with the available artwork settings.'
    if (update.status === 'skipped') label = update.phase === 'warmup'
      ? 'Artwork warm-up skipped. Continuing…' : 'Optional preparation skipped. Continuing…'
    if (loadingLabel.textContent !== label) loadingLabel.textContent = label
    loadingProgress.dataset.phase = update.phase
    loadingProgress.dataset.status = update.status

    const loaded = Number.isFinite(update.loadedBytes) && update.loadedBytes >= 0 ? update.loadedBytes : null
    const total = Number.isFinite(update.totalBytes) && update.totalBytes > 0 ? update.totalBytes : null
    const determinate = update.phase === 'download' && loaded !== null && total !== null && loaded <= total &&
      ['loading', 'complete'].includes(update.status)
    loadingMeter.dataset.indeterminate = determinate ? 'false' : 'true'
    loadingMeter.setAttribute('aria-label', update.phase === 'download' ? 'Artwork download' : 'Artwork preparation')
    loadingMeter.setAttribute('aria-valuetext', label)
    if (determinate) {
      // This percentage describes bytes transferred only, never overall readiness.
      const percent = Math.floor(loaded / total * 100)
      loadingMeter.setAttribute('aria-valuemin', '0')
      loadingMeter.setAttribute('aria-valuemax', '100')
      loadingMeter.setAttribute('aria-valuenow', String(percent))
      loadingMeter.setAttribute('aria-valuetext', `Download ${percent}%`)
      loadingFill.style.width = `${loaded / total * 100}%`
      loadingDetail.textContent = `Download ${percent}% · ${(loaded / 1000000).toFixed(1)} / ${(total / 1000000).toFixed(1)} MB`
    } else {
      loadingMeter.removeAttribute('aria-valuemin')
      loadingMeter.removeAttribute('aria-valuemax')
      loadingMeter.removeAttribute('aria-valuenow')
      loadingFill.style.removeProperty('width')
      loadingDetail.textContent = update.phase === 'download' && loaded !== null
        ? `${(loaded / 1000000).toFixed(1)} MB received` : ''
    }
    loadingDetail.hidden = loadingDetail.textContent === ''
    loadingProgress.hidden = false
    return true
  }

  function setState(payload) {
    if (disposed) return
    const previousState = currentState
    const previousActive = doc.activeElement
    const next = payload && typeof payload === 'object' ? payload : {}
    const requested = next.state
    if (typeof requested === 'string' && validStates.has(requested)) currentState = requested
    if(currentState!==previousState)closeOptions()
    if (currentState !== 'loading' || previousState !== 'loading') clearLoadingProgress()

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

    const helperText = typeof next.helperText === 'string' ? next.helperText : (isCollection && collectionHelper[currentState]) || HELPER_TEXT[currentState] || ''
    if (helper.textContent !== helperText) helper.textContent = helperText
    helper.hidden = helperText === ''

    previewFlag.hidden = currentState !== 'preview'
    if(isCollection){
      // Reuse the same controls and listeners in the hero and the live camera dock.
      const dockParent=singleWall && currentState==='landing'?heroCopy:root
      if(dock.parentNode!==dockParent)dockParent.append(dock)
      landing.hidden=currentState!=='landing';cameraNote.hidden=currentState!=='landing';previewTabs.hidden=singleWall || currentState!=='preview'
      reticle.hidden=!['searching','lost'].includes(currentState)
      status.hidden=currentState==='landing';helper.hidden=currentState==='landing' || helperText===''
      previewFlag.hidden=true
    }
    // Keep the live announcement while showing the identical disclaimer just once.
    const duplicatePreview = currentState === 'preview' && message === previewFlag.textContent
    status.classList.toggle('is-visually-hidden', duplicatePreview)
    if (duplicatePreview) previewFlag.setAttribute('aria-hidden', 'true')
    else previewFlag.removeAttribute('aria-hidden')

    const visible = resolveVisible(currentState, canRetry)
    for (const definition of CONTROL_DEFINITIONS) {
      buttons[definition.key].hidden = !visible.has(definition.key)
    }
    if(isCollection && currentState==='landing')buttons.preview.hidden=!singleWall
    motion.hidden = !visible.has('reduceMotion')

    buttons.overdrive.disabled = !overdriveAllowed()
    if (!overdriveAllowed()) applyOverdrive(false)
    if (!soundAllowed()) releaseSound()
    refreshSoundUI()
    refreshMachineUI()
    layoutControls()

    keepFocusVisible(previousActive)
  }

  function setOverdrive(value) {
    if (disposed) return
    applyOverdrive(overdriveAllowed() ? Boolean(value) : false)
  }

  function setReducedMotion(value) {
    if (disposed) return
    applyReducedMotion(Boolean(value))
  }

  function dispose() {
    if (disposed) return
    releaseSound()
    clearLoadingProgress()
    disposed = true
    dismissHelp()
    while (listeners.length > 0) {
      const remove = listeners.pop()
      remove()
    }
    if (root.parentNode) root.parentNode.removeChild(root)
    if(helpDialog.open && helpDialog.close)helpDialog.close()
  }

  applyReducedMotion(initialReducedMotion)
  mount.appendChild(root)
  setState({state: 'landing'})

  return {setState, setLoadingProgress, setOverdrive, setReducedMotion, setSoundEnabled, setSoundAvailable, setMachineAvailable, setActiveWall, announceMachine, dispose}
}
