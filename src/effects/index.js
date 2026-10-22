const ROOT_RADIUS_RATIO = 0.82
const HOLE_RADIUS_RATIO = 0.56
const HUB_RADIUS_RATIO = 0.16
const SPOKE_WIDTH_RATIO = 0.08
const SPOKE_THICKNESS_RATIO = 0.8
const SPOKE_OVERLAP_RATIO = 0.02
const TOOTH_TIP_HALF_PITCH = 0.16
const TOOTH_ROOT_HALF_PITCH = 0.3
const GLOW_TEXTURE_EDGE = 64

function readFiniteNumber(value, label) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) {
    throw new TypeError(`createEffects: ${label} must be a finite number`)
  }
  return number
}

function readPositiveNumber(value, label) {
  const number = readFiniteNumber(value, label)
  if (number <= 0) {
    throw new RangeError(`createEffects: ${label} must be greater than zero`)
  }
  return number
}

function readPositiveInteger(value, label) {
  const number = readPositiveNumber(value, label)
  if (!Number.isInteger(number)) {
    throw new RangeError(`createEffects: ${label} must be an integer`)
  }
  return number
}

function readColor(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`createEffects: ${label} must be a CSS colour string`)
  }
  return value
}

function readAnchor(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new TypeError(`createEffects: ${label} must be [u, v]`)
  }
  return [readFiniteNumber(value[0], `${label}[0]`), readFiniteNumber(value[1], `${label}[1]`)]
}

function readOpacityPair(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new TypeError(`createEffects: ${label} must be [minimum, maximum]`)
  }
  const minimum = Math.min(1, Math.max(0, readFiniteNumber(value[0], `${label}[0]`)))
  const maximum = Math.min(1, Math.max(0, readFiniteNumber(value[1], `${label}[1]`)))
  return minimum <= maximum ? [minimum, maximum] : [maximum, minimum]
}

function createGearShape(THREE, radius, teeth) {
  const shape = new THREE.Shape()
  const pitch = (Math.PI * 2) / teeth
  const rootRadius = radius * ROOT_RADIUS_RATIO
  const tipHalfAngle = pitch * TOOTH_TIP_HALF_PITCH
  const rootHalfAngle = pitch * TOOTH_ROOT_HALF_PITCH

  for (let index = 0; index < teeth; index += 1) {
    const centre = index * pitch
    const rootStart = centre - rootHalfAngle
    const tipStart = centre - tipHalfAngle
    const tipEnd = centre + tipHalfAngle
    const rootEnd = centre + rootHalfAngle
    const rootStartX = Math.cos(rootStart) * rootRadius
    const rootStartY = Math.sin(rootStart) * rootRadius

    if (index === 0) {
      shape.moveTo(rootStartX, rootStartY)
    } else {
      shape.lineTo(rootStartX, rootStartY)
    }

    shape.lineTo(Math.cos(tipStart) * radius, Math.sin(tipStart) * radius)
    shape.lineTo(Math.cos(tipEnd) * radius, Math.sin(tipEnd) * radius)
    shape.lineTo(Math.cos(rootEnd) * rootRadius, Math.sin(rootEnd) * rootRadius)
  }

  shape.closePath()

  const holeRadius = radius * HOLE_RADIUS_RATIO
  const hole = new THREE.Path()
  const holeSegments = 48

  for (let index = 0; index < holeSegments; index += 1) {
    const angle = -(index / holeSegments) * Math.PI * 2
    const x = Math.cos(angle) * holeRadius
    const y = Math.sin(angle) * holeRadius

    if (index === 0) {
      hole.moveTo(x, y)
    } else {
      hole.lineTo(x, y)
    }
  }

  hole.closePath()
  shape.holes.push(hole)
  return shape
}

function createGlowTexture(THREE) {
  const size = GLOW_TEXTURE_EDGE
  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const normalX = ((x + 0.5) / size) * 2 - 1
      const normalY = ((y + 0.5) / size) * 2 - 1
      const distance = Math.min(1, Math.sqrt(normalX * normalX + normalY * normalY))
      const falloff = Math.max(0, 1 - distance)
      const alpha = Math.round(255 * Math.pow(falloff, 2.2))
      const offset = (y * size + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = alpha
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export function createEffects({ THREE, config } = {}) {
  if (!THREE || typeof THREE.Group !== 'function') {
    throw new TypeError('createEffects requires the injected THREE instance')
  }
  if (!config || !config.panel) {
    throw new TypeError('createEffects requires config.panel')
  }

  const panel = config.panel
  const imagePx = panel.imagePx

  if (!Array.isArray(imagePx) || imagePx.length < 2) {
    throw new TypeError('createEffects: panel.imagePx must be [width, height]')
  }

  const imageWidth = readPositiveNumber(imagePx[0], 'panel.imagePx[0]')
  const imageHeight = readPositiveNumber(imagePx[1], 'panel.imagePx[1]')
  const panelHeight = imageHeight / imageWidth

  const teeth = readPositiveInteger(config.teeth, 'teeth')
  const spokeCount = readPositiveInteger(config.spokes, 'spokes')
  const gearThickness = readPositiveNumber(config.gearThickness, 'gearThickness')
  const gearZ = readFiniteNumber(config.gearZ, 'gearZ')
  const gearRadius = readPositiveNumber(panel.gearRadius, 'panel.gearRadius')
  const glowRadius = readPositiveNumber(panel.glowRadius, 'panel.glowRadius')
  const idleDegreesPerSecond = readFiniteNumber(config.idleDegreesPerSecond, 'idleDegreesPerSecond')
  const overdriveDegreesPerSecond = readFiniteNumber(
    config.overdriveDegreesPerSecond,
    'overdriveDegreesPerSecond',
  )
  const pulsePeriodMs = readPositiveNumber(config.pulsePeriodMs, 'pulsePeriodMs')
  const maxDeltaMs = Math.max(0, readFiniteNumber(config.maxDeltaMs, 'maxDeltaMs'))
  const [glowIdleMinimum, glowIdleMaximum] = readOpacityPair(config.glowIdleOpacity, 'glowIdleOpacity')
  const glowOverdriveOpacity = Math.min(
    1,
    Math.max(0, readFiniteNumber(config.glowOverdriveOpacity, 'glowOverdriveOpacity')),
  )
  const reducedMotionIdleOpacity = Math.min(
    1,
    Math.max(0, readFiniteNumber(config.reducedMotionIdleOpacity, 'reducedMotionIdleOpacity')),
  )
  const reducedMotionOverdriveOpacity = Math.min(
    1,
    Math.max(0, readFiniteNumber(config.reducedMotionOverdriveOpacity, 'reducedMotionOverdriveOpacity')),
  )
  const brassHex = readColor(config.brassHex, 'brassHex')
  const amberHex = readColor(config.amberHex, 'amberHex')
  const gearAnchor = readAnchor(panel.gearAnchorUV, 'panel.gearAnchorUV')

  if (!Array.isArray(panel.glowAnchorsUV) || panel.glowAnchorsUV.length === 0) {
    throw new TypeError('createEffects: panel.glowAnchorsUV must contain at least one [u, v] anchor')
  }

  const glowAnchors = panel.glowAnchorsUV.map((anchor, index) =>
    readAnchor(anchor, `panel.glowAnchorsUV[${index}]`),
  )

  const object3D = new THREE.Group()
  object3D.name = 'effectsRoot'
  object3D.visible = false
  object3D.userData = {
    panelLabel: typeof panel.label === 'string' ? panel.label : null,
    glowCount: glowAnchors.length,
    teeth,
    spokes: spokeCount,
    gearRadius,
    glowRadius,
    panelHeight,
  }

  const brassMaterial = new THREE.MeshStandardMaterial({
    color: brassHex,
    metalness: 0.35,
    roughness: 0.45,
  })

  const gear = new THREE.Group()
  gear.name = 'brassGear'
  gear.position.set(gearAnchor[0] - 0.5, (0.5 - gearAnchor[1]) * panelHeight, gearZ)
  object3D.add(gear)

  const ringGeometry = new THREE.ExtrudeGeometry(createGearShape(THREE, gearRadius, teeth), {
    depth: gearThickness,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  })
  ringGeometry.translate(0, 0, -gearThickness / 2)
  const ring = new THREE.Mesh(ringGeometry, brassMaterial)
  ring.name = 'gearRing'
  gear.add(ring)

  const holeRadius = gearRadius * HOLE_RADIUS_RATIO
  const hubRadius = gearRadius * HUB_RADIUS_RATIO
  const spokeOverlap = gearRadius * SPOKE_OVERLAP_RATIO
  const spokeLength = holeRadius - hubRadius + spokeOverlap * 2
  const spokeWidth = gearRadius * SPOKE_WIDTH_RATIO
  const spokeMidRadius = (hubRadius + holeRadius) / 2
  const spokeGeometry = new THREE.BoxGeometry(
    spokeLength,
    spokeWidth,
    gearThickness * SPOKE_THICKNESS_RATIO,
  )

  for (let index = 0; index < spokeCount; index += 1) {
    const angle = (index / spokeCount) * Math.PI * 2
    const spoke = new THREE.Mesh(spokeGeometry, brassMaterial)
    spoke.name = `gearSpoke${index}`
    spoke.position.set(Math.cos(angle) * spokeMidRadius, Math.sin(angle) * spokeMidRadius, 0)
    spoke.rotation.z = angle
    gear.add(spoke)
  }

  const hubGeometry = new THREE.CylinderGeometry(hubRadius, hubRadius, gearThickness, 24)
  const hub = new THREE.Mesh(hubGeometry, brassMaterial)
  hub.name = 'gearHub'
  hub.rotation.x = Math.PI / 2
  gear.add(hub)

  const glowTexture = createGlowTexture(THREE)
  const glowMaterial = new THREE.MeshBasicMaterial({
    map: glowTexture,
    color: new THREE.Color(amberHex),
    transparent: true,
    opacity: glowIdleMinimum,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const glowGeometry = new THREE.PlaneGeometry(glowRadius * 2, glowRadius * 2)

  glowAnchors.forEach((anchor, index) => {
    const glow = new THREE.Mesh(glowGeometry, glowMaterial)
    glow.name = `amberGlow${index}`
    glow.position.set(anchor[0] - 0.5, (0.5 - anchor[1]) * panelHeight, gearZ)
    glow.renderOrder = 1
    object3D.add(glow)
  })

  let tracked = false
  let overdrive = false
  let reducedMotion = false
  let lastNowMs = 0
  let disposed = false

  function applyGlowOpacity(nowMs) {
    let opacity

    if (reducedMotion) {
      opacity = overdrive ? reducedMotionOverdriveOpacity : reducedMotionIdleOpacity
    } else if (overdrive) {
      opacity = glowOverdriveOpacity
    } else {
      const safeNowMs = Number.isFinite(nowMs) ? nowMs : 0
      const phase = (((safeNowMs % pulsePeriodMs) + pulsePeriodMs) % pulsePeriodMs) / pulsePeriodMs
      const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
      opacity = glowIdleMinimum + (glowIdleMaximum - glowIdleMinimum) * wave
    }

    glowMaterial.opacity = opacity
  }

  function setTracked(value) {
    if (disposed) {
      return
    }
    tracked = Boolean(value)
    object3D.visible = tracked
    if (!tracked) {
      overdrive = false
    }
    applyGlowOpacity(lastNowMs)
  }

  function setOverdrive(value) {
    if (disposed) {
      return
    }
    overdrive = Boolean(value)
    applyGlowOpacity(lastNowMs)
  }

  function setReducedMotion(value) {
    if (disposed) {
      return
    }
    reducedMotion = Boolean(value)
    applyGlowOpacity(lastNowMs)
  }

  function update(frame) {
    if (disposed) {
      return
    }

    const deltaMs = frame && Number.isFinite(frame.deltaMs) ? frame.deltaMs : 0
    lastNowMs = frame && Number.isFinite(frame.nowMs) ? frame.nowMs : 0

    if (!object3D.visible) {
      return
    }

    const clampedDeltaMs = Math.min(Math.max(deltaMs, 0), maxDeltaMs)

    if (!reducedMotion && clampedDeltaMs > 0) {
      const speed = overdrive ? overdriveDegreesPerSecond : idleDegreesPerSecond
      const radians = ((speed * clampedDeltaMs) / 1000) * (Math.PI / 180)
      gear.rotation.z = (gear.rotation.z + radians) % (Math.PI * 2)
    }

    applyGlowOpacity(lastNowMs)
  }

  function dispose() {
    if (disposed) {
      return
    }
    disposed = true
    object3D.visible = false

    if (object3D.parent) {
      object3D.parent.remove(object3D)
    }

    const geometries = new Set()
    const materials = new Set()

    object3D.traverse((node) => {
      if (node.geometry) {
        geometries.add(node.geometry)
      }

      if (Array.isArray(node.material)) {
        node.material.forEach((material) => materials.add(material))
      } else if (node.material) {
        materials.add(node.material)
      }
    })

    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
    glowTexture.dispose()

    tracked = false
    overdrive = false
  }

  applyGlowOpacity(lastNowMs)

  return {
    object3D,
    setTracked,
    setOverdrive,
    setReducedMotion,
    update,
    dispose,
  }
}
