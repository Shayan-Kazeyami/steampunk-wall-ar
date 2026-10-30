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

function createGearShape(THREE, radius, teeth, holeSegments = 48) {
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

// Construction-only merger. Keep one injected THREE version and preserve normals
// and UVs without adding a geometry utility bundle or material groups.
function mergeGeometry(THREE, parts) {
  const expanded = parts.map(part => {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone()
    if (part.matrix) geometry.applyMatrix4(part.matrix)
    return geometry
  })
  const merged = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv']) {
    const size = name === 'uv' ? 2 : 3
    let length = 0
    expanded.forEach(geometry => { length += geometry.attributes[name].array.length })
    const array = new Float32Array(length)
    let offset = 0
    expanded.forEach(geometry => {
      array.set(geometry.attributes[name].array, offset)
      offset += geometry.attributes[name].array.length
    })
    merged.setAttribute(name, new THREE.BufferAttribute(array, size))
  }
  expanded.forEach(geometry => geometry.dispose())
  merged.computeBoundingSphere()
  return merged
}

function collapseGear(THREE, gear) {
  const parts = []
  const originals = new Set()
  gear.children.forEach(mesh => {
    mesh.updateMatrix()
    parts.push({geometry: mesh.geometry, matrix: mesh.matrix})
    originals.add(mesh.geometry)
  })
  const material = gear.children[0].material
  const geometry = mergeGeometry(THREE, parts)
  originals.forEach(original => original.dispose())
  while (gear.children.length) gear.remove(gear.children[0])
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'mergedBrassGear'
  gear.add(mesh)
}

function performanceBudget(root, particles) {
  const materials = new Set(), textures = new Set()
  let drawCalls = 0, triangles = 0
  root.traverse(node => {
    if (!node.isMesh) return
    const list = Array.isArray(node.material) ? node.material : [node.material]
    list.forEach(material => {
      materials.add(material)
      if (material.map) textures.add(material.map)
    })
    drawCalls += node.geometry.groups.length && Array.isArray(node.material) ? node.geometry.groups.length : 1
    const vertices = node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count
    triangles += vertices / 3 * (node.isInstancedMesh ? node.instanceMatrix.count : 1)
  })
  return {drawCalls, triangles, materials: materials.size, textures: textures.size, particles}
}

function createDrivewayExtension(THREE, root, panelHeight, config, brassMaterial, softTexture) {
  const valvesConfig = config.valves || {}, steamConfig = config.steam || {}
  const valveEnabled = !!config.valves && valvesConfig.enabled !== false
  const steamConfigured = !!config.steam && steamConfig.enabled !== false
  const dummy = new THREE.Object3D()
  let valves = null, hubs = null, steam = null, steamEnabled = true, valveAngle = 0, steamTimeMs = 0
  const anchors = (valvesConfig.anchorsUV || [[.102,.547],[.318,.361],[.658,.643],[.830,.128]])
    .map((anchor, i) => readAnchor(anchor, `valves.anchorsUV[${i}]`))
  const radii = (valvesConfig.radii || [.018,.019,.018,.020])
    .map((radius, i) => readPositiveNumber(radius, `valves.radii[${i}]`))
  const z = readFiniteNumber(valvesConfig.z === undefined ? .018 : valvesConfig.z, 'valves.z')
  const amplitude = readFiniteNumber(valvesConfig.idleAmplitudeDeg === undefined ? 8 : valvesConfig.idleAmplitudeDeg, 'valves.idleAmplitudeDeg') * Math.PI / 180
  const period = readPositiveNumber(valvesConfig.idlePeriodMs || 4000, 'valves.idlePeriodMs')
  const speed = readFiniteNumber(valvesConfig.overdriveDegreesPerSecond === undefined ? 120 : valvesConfig.overdriveDegreesPerSecond, 'valves.overdriveDegreesPerSecond') * Math.PI / 180
  if (valveEnabled) {
    if (anchors.length !== 4 || radii.length !== 4) throw new Error('Driveway requires four valve anchors and radii')
    // Smooth curved silhouettes without extra draws or texture downloads.
    const ring = new THREE.TorusGeometry(1, .12, 10, 48)
    const spoke = new THREE.BoxGeometry(.14, 1.82, .20)
    const parts = [{geometry: ring}]
    for (let i = 0; i < 3; i++) parts.push({geometry: spoke, matrix: new THREE.Matrix4().makeRotationZ(i * Math.PI / 3)})
    const wheel = mergeGeometry(THREE, parts)
    ring.dispose(); spoke.dispose()
    const iron = new THREE.MeshStandardMaterial({color: valvesConfig.colorHex || '#71332B', metalness:.18, roughness:.38})
    valves = new THREE.InstancedMesh(wheel, iron, 4)
    valves.name = 'drivewayValveWheels'; valves.frustumCulled = false
    const hub = new THREE.CylinderGeometry(.19, .19, .25, 48)
    hub.rotateX(Math.PI / 2)
    hubs = new THREE.InstancedMesh(hub, brassMaterial, 4)
    hubs.name = 'drivewayValveHubs'; hubs.frustumCulled = false
    if (valves.instanceMatrix.setUsage && THREE.DynamicDrawUsage) valves.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    root.add(valves); root.add(hubs)
  }
  const emitters = (steamConfig.emittersUV || [[.740,.290],[.516,.670]])
    .map((anchor, i) => readAnchor(anchor, `steam.emittersUV[${i}]`))
  const capacity = steamConfigured ? Math.min(24, readPositiveInteger(steamConfig.maxParticles || 24, 'steam.maxParticles')) : 0
  const idleCount = Math.min(capacity, readPositiveInteger(steamConfig.idleParticles || 8, 'steam.idleParticles'))
  const boostCount = Math.min(capacity, readPositiveInteger(steamConfig.overdriveParticles || 24, 'steam.overdriveParticles'))
  const rise = Math.min(.065, readPositiveNumber(steamConfig.rise || .065, 'steam.rise'))
  const steamZ = readFiniteNumber(steamConfig.z === undefined ? .03 : steamConfig.z, 'steam.z')
  const idleLife = readPositiveNumber(steamConfig.idleLifetimeMs || 1400, 'steam.idleLifetimeMs')
  const boostLife = readPositiveNumber(steamConfig.overdriveLifetimeMs || 900, 'steam.overdriveLifetimeMs')
  const seeds = new Float32Array(capacity * 3)
  let seed = 7271
  for (let i = 0; i < seeds.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    seeds[i] = seed / 4294967296
  }
  if (steamConfigured) {
    if (emitters.length !== 2) throw new Error('Driveway requires two steam emitters')
    const material = new THREE.MeshBasicMaterial({map:softTexture,color:'#E7DDD0',transparent:true,opacity:.20,depthWrite:false})
    steam = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, capacity)
    steam.name = 'drivewaySteam'; steam.renderOrder = 2; steam.frustumCulled = false
    if (steam.instanceMatrix.setUsage && THREE.DynamicDrawUsage) steam.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    root.add(steam)
  }
  function updateValves(deltaMs, nowMs, overdrive, reduced) {
    if (!valves || reduced) return
    if (overdrive) valveAngle = (valveAngle + speed * deltaMs / 1000) % (Math.PI * 2)
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i], radius = radii[i]
      dummy.position.set(anchor[0]-.5, (.5-anchor[1])*panelHeight, z)
      dummy.rotation.set(0,0,overdrive ? valveAngle : amplitude*Math.sin(nowMs/period*Math.PI*2+i*.8))
      dummy.scale.set(radius,radius,radius); dummy.updateMatrix()
      valves.setMatrixAt(i,dummy.matrix); hubs.setMatrixAt(i,dummy.matrix)
    }
    valves.instanceMatrix.needsUpdate = true; hubs.instanceMatrix.needsUpdate = true
  }
  function syncSteam(overdrive, reduced) {
    if (!steam) return
    steam.visible = steamEnabled && !reduced
    steam.count = overdrive ? boostCount : idleCount
    steam.material.opacity = overdrive ? .28 : .20
    root.userData.activeParticles = root.visible && steam.visible ? steam.count : 0
  }
  function update(deltaMs, nowMs, overdrive, reduced) {
    updateValves(deltaMs, nowMs, overdrive, reduced)
    syncSteam(overdrive, reduced)
    if (!steam || !steam.visible) return
    steamTimeMs += deltaMs
    const life = overdrive ? boostLife : idleLife
    for (let i = 0; i < steam.count; i++) {
      const emitter = emitters[i % emitters.length]
      const phase = (steamTimeMs / life + seeds[i*3]) % 1
      const envelope = Math.sin(phase * Math.PI)
      const radius = (.014 + phase*.020) * envelope
      const drift = (seeds[i*3+1]-.5)*.018*phase
      dummy.position.set(emitter[0]-.5+drift, (.5-emitter[1])*panelHeight+rise*phase, steamZ+seeds[i*3+2]*.004)
      dummy.rotation.set(0,0,seeds[i*3+2]*Math.PI)
      dummy.scale.set(radius,radius*1.25,1); dummy.updateMatrix()
      steam.setMatrixAt(i,dummy.matrix)
    }
    steam.instanceMatrix.needsUpdate = true
  }
  update(0,0,false,false)
  return {
    update,
    sync(overdrive,reduced) { syncSteam(overdrive,reduced) },
    setSteamEnabled(value,overdrive,reduced) { steamEnabled=Boolean(value); syncSteam(overdrive,reduced) },
    capacity,
  }
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

  const enhancedDriveway = panel.wallId === 3 && (
    (config.valves && config.valves.enabled !== false) ||
    (config.steam && config.steam.enabled !== false)
  )
  const brassMaterial = new THREE.MeshStandardMaterial({
    color: brassHex,
    // Moderate metalness retains readable diffuse brass without an environment
    // map; the finer bevels supply directional highlights under existing lights.
    metalness: enhancedDriveway ? .28 : .35,
    roughness: enhancedDriveway ? .32 : .45,
  })

  const gear = new THREE.Group()
  gear.name = 'brassGear'
  gear.position.set(gearAnchor[0] - 0.5, (0.5 - gearAnchor[1]) * panelHeight, gearZ)
  object3D.add(gear)

  const ringGeometry = new THREE.ExtrudeGeometry(createGearShape(THREE, gearRadius, teeth, enhancedDriveway ? 96 : 48), {
    depth: gearThickness,
    bevelEnabled: enhancedDriveway,
    bevelThickness: Math.min(gearThickness*.12, gearRadius*.02),
    bevelSize: Math.min(gearThickness*.06, gearRadius*.012),
    bevelSegments: 3,
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

  const hubGeometry = new THREE.CylinderGeometry(hubRadius, hubRadius, gearThickness, enhancedDriveway ? 48 : 24)
  const hub = new THREE.Mesh(hubGeometry, brassMaterial)
  hub.name = 'gearHub'
  hub.rotation.x = Math.PI / 2
  gear.add(hub)

  if (enhancedDriveway) collapseGear(THREE, gear)

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

  if (enhancedDriveway) {
    const lamps = new THREE.InstancedMesh(glowGeometry, glowMaterial, glowAnchors.length)
    lamps.name = 'amberGlowInstances'; lamps.renderOrder = 1; lamps.frustumCulled = false
    const lampTransform = new THREE.Object3D()
    glowAnchors.forEach((anchor, index) => {
      lampTransform.position.set(anchor[0] - .5, (.5 - anchor[1]) * panelHeight, gearZ)
      lampTransform.updateMatrix(); lamps.setMatrixAt(index, lampTransform.matrix)
    })
    lamps.instanceMatrix.needsUpdate = true
    object3D.add(lamps)
  } else {
    glowAnchors.forEach((anchor, index) => {
      const glow = new THREE.Mesh(glowGeometry, glowMaterial)
      glow.name = `amberGlow${index}`
      glow.position.set(anchor[0] - 0.5, (0.5 - anchor[1]) * panelHeight, gearZ)
      glow.renderOrder = 1
      object3D.add(glow)
    })
  }
  const extension = enhancedDriveway
    ? createDrivewayExtension(THREE, object3D, panelHeight, config, brassMaterial, glowTexture)
    : null
  const budget = performanceBudget(object3D, extension ? extension.capacity : 0)
  object3D.userData.performance = Object.freeze(budget)
  Object.assign(object3D.userData, budget)
  object3D.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false } })

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
    if (extension) extension.sync(overdrive, reducedMotion)
    applyGlowOpacity(lastNowMs)
  }

  function setOverdrive(value) {
    if (disposed) {
      return
    }
    overdrive = Boolean(value)
    if (extension) extension.sync(overdrive, reducedMotion)
    applyGlowOpacity(lastNowMs)
  }

  function setReducedMotion(value) {
    if (disposed) {
      return
    }
    reducedMotion = Boolean(value)
    if (extension) extension.sync(overdrive, reducedMotion)
    applyGlowOpacity(lastNowMs)
  }

  function setSteamEnabled(value) {
    if (!disposed && extension) extension.setSteamEnabled(value, overdrive, reducedMotion)
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
    if (extension) extension.update(clampedDeltaMs, lastNowMs, overdrive, reducedMotion)
  }

  function dispose() {
    if (disposed) {
      return
    }
    disposed = true
    object3D.visible = false
    object3D.userData.activeParticles = 0

    if (object3D.parent) {
      object3D.parent.remove(object3D)
    }

    const geometries = new Set()
    const materials = new Set()
    const textures = new Set()

    object3D.traverse((node) => {
      if (node.isInstancedMesh && typeof node.dispose === 'function') node.dispose()
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
    materials.forEach((material) => {
      if (material.map) textures.add(material.map)
      material.dispose()
    })
    textures.forEach(texture => texture.dispose())

    tracked = false
    overdrive = false
  }

  applyGlowOpacity(lastNowMs)

  return {
    object3D,
    setTracked,
    setOverdrive,
    setReducedMotion,
    setSteamEnabled,
    update,
    dispose,
  }
}
