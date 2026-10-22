import { createEffects } from '../index.js'

const DEGREES = 180 / Math.PI

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function approximately(actual, expected, tolerance = 1e-6) {
  return Math.abs(actual - expected) <= tolerance
}

function countMeshes(root) {
  let count = 0
  root.traverse((node) => {
    if (node.isMesh) {
      count += 1
    }
  })
  return count
}

function pointFor(panel, anchor) {
  return {
    x: anchor[0] - 0.5,
    y: (0.5 - anchor[1]) * (panel.imagePx[1] / panel.imagePx[0]),
  }
}

export function runEffectsContractChecks({ THREE, spec, logger = console } = {}) {
  if (!THREE || typeof THREE.Group !== 'function') {
    throw new TypeError('runEffectsContractChecks requires THREE')
  }
  if (!spec || !spec.effects || !spec.panels) {
    throw new TypeError('runEffectsContractChecks requires spec')
  }

  const results = []

  function check(id, run) {
    try {
      const detail = run()
      results.push({ id, result: 'pass', detail: detail || '' })
    } catch (error) {
      results.push({ id, result: 'fail', detail: String((error && error.message) || error) })
    }
  }

  const panelKeys = ['garageLeft', 'driveway']

  panelKeys.forEach((panelKey) => {
    const panel = spec.panels[panelKey]
    const config = { ...spec.effects, panel }

    check(`geometry:${panelKey}`, () => {
      const effects = createEffects({ THREE, config })
      const root = effects.object3D
      const gear = root.getObjectByName('brassGear')

      assert(root && root.isGroup, 'object3D must be a THREE.Group')
      assert(root.visible === false, 'effects root must start hidden')
      assert(gear, 'brassGear is missing')
      assert(root.getObjectByName('gearRing'), 'gearRing is missing')
      assert(root.getObjectByName('gearHub'), 'gearHub is missing')

      for (let index = 0; index < config.spokes; index += 1) {
        assert(root.getObjectByName(`gearSpoke${index}`), `gearSpoke${index} is missing`)
      }

      panel.glowAnchorsUV.forEach((anchor, index) => {
        const glow = root.getObjectByName(`amberGlow${index}`)
        assert(glow, `amberGlow${index} is missing`)
        const expected = pointFor(panel, anchor)
        assert(approximately(glow.position.x, expected.x), `amberGlow${index} x is wrong`)
        assert(approximately(glow.position.y, expected.y), `amberGlow${index} y is wrong`)
        assert(approximately(glow.position.z, config.gearZ), `amberGlow${index} z is wrong`)
      })

      const gearAnchor = pointFor(panel, panel.gearAnchorUV)
      assert(approximately(gear.position.x, gearAnchor.x), 'gear x is wrong')
      assert(approximately(gear.position.y, gearAnchor.y), 'gear y is wrong')
      assert(approximately(gear.position.z, config.gearZ), 'gear z is wrong')

      const ring = root.getObjectByName('gearRing')
      const hub = root.getObjectByName('gearHub')
      const spoke = root.getObjectByName('gearSpoke0')
      const glow0 = root.getObjectByName('amberGlow0')
      const glow1 = root.getObjectByName('amberGlow1')

      assert(ring.material.isMeshStandardMaterial, 'gear must use MeshStandardMaterial')
      assert(ring.material === hub.material && ring.material === spoke.material, 'brass material must be shared')
      assert(glow0.material === glow1.material, 'glow material must be shared')
      assert(glow0.geometry === glow1.geometry, 'glow geometry must be shared')
      assert(glow0.material.map === glow1.material.map, 'glow texture must be shared')

      const meshes = countMeshes(root)
      assert(meshes <= 20, `expected at most 20 custom meshes, found ${meshes}`)
      assert(root.userData.glowCount === panel.glowAnchorsUV.length, 'glow count metadata is wrong')
      assert(root.userData.teeth === config.teeth, 'teeth metadata is wrong')
      assert(root.userData.spokes === config.spokes, 'spoke metadata is wrong')

      const detail = `${meshes} meshes, ${panel.glowAnchorsUV.length} glows, teeth ${config.teeth}`
      effects.dispose()
      return detail
    })

    check(`motion:${panelKey}`, () => {
      const effects = createEffects({ THREE, config })
      const gear = effects.object3D.getObjectByName('brassGear')
      effects.setTracked(true)

      const idleStart = gear.rotation.z
      effects.update({ deltaMs: 1000, nowMs: 0 })
      const idleDegrees = (gear.rotation.z - idleStart) * DEGREES
      const expectedIdle = config.idleDegreesPerSecond * (config.maxDeltaMs / 1000)
      assert(approximately(idleDegrees, expectedIdle, 1e-9), `idle delta ${idleDegrees} != ${expectedIdle}`)

      const overdriveStart = gear.rotation.z
      effects.setOverdrive(true)
      effects.update({ deltaMs: 1000, nowMs: 0 })
      const overdriveDegrees = (gear.rotation.z - overdriveStart) * DEGREES
      const expectedOverdrive = config.overdriveDegreesPerSecond * (config.maxDeltaMs / 1000)
      assert(
        approximately(overdriveDegrees, expectedOverdrive, 1e-9),
        `overdrive delta ${overdriveDegrees} != ${expectedOverdrive}`,
      )

      effects.setOverdrive(true)
      const repeatedStart = gear.rotation.z
      effects.update({ deltaMs: 1000, nowMs: 0 })
      const repeatedDegrees = (gear.rotation.z - repeatedStart) * DEGREES
      assert(
        approximately(repeatedDegrees, expectedOverdrive, 1e-9),
        'repeated overdrive activation must stay at overdrive speed',
      )

      effects.setOverdrive(false)
      const resetStart = gear.rotation.z
      effects.update({ deltaMs: 1000, nowMs: 0 })
      const resetDegrees = (gear.rotation.z - resetStart) * DEGREES
      assert(
        approximately(resetDegrees, expectedIdle, 1e-9),
        'reset must return the gear to idle speed',
      )

      effects.dispose()
      return `idle ${idleDegrees.toFixed(4)} deg, overdrive ${overdriveDegrees.toFixed(4)} deg, reset ${resetDegrees.toFixed(4)} deg at clamped delta`
    })

    check(`pulse:${panelKey}`, () => {
      const effects = createEffects({ THREE, config })
      const glow = effects.object3D.getObjectByName('amberGlow0')
      effects.setTracked(true)

      effects.update({ deltaMs: 0, nowMs: 0 })
      const atMinimum = glow.material.opacity
      effects.update({ deltaMs: 0, nowMs: config.pulsePeriodMs / 2 })
      const atMaximum = glow.material.opacity
      effects.update({ deltaMs: 0, nowMs: config.pulsePeriodMs })
      const atPeriod = glow.material.opacity

      const [minimum, maximum] = config.glowIdleOpacity
      assert(approximately(atMinimum, minimum, 1e-9), `pulse minimum ${atMinimum} != ${minimum}`)
      assert(approximately(atMaximum, maximum, 1e-9), `pulse maximum ${atMaximum} != ${maximum}`)
      assert(approximately(atPeriod, atMinimum, 1e-9), 'pulse period does not repeat')

      effects.setOverdrive(true)
      effects.update({ deltaMs: 0, nowMs: config.pulsePeriodMs / 2 })
      assert(
        approximately(glow.material.opacity, config.glowOverdriveOpacity, 1e-9),
        'overdrive glow opacity is wrong',
      )

      effects.dispose()
      return `pulse ${minimum}-${maximum}, overdrive ${config.glowOverdriveOpacity}`
    })

    check(`reduced-motion:${panelKey}`, () => {
      const effects = createEffects({ THREE, config })
      const gear = effects.object3D.getObjectByName('brassGear')
      const glow = effects.object3D.getObjectByName('amberGlow0')
      effects.setTracked(true)
      effects.setReducedMotion(true)

      const before = gear.rotation.z
      effects.update({ deltaMs: 50, nowMs: 0 })
      assert(gear.rotation.z === before, 'gear must not rotate under reduced motion')
      assert(
        approximately(glow.material.opacity, config.reducedMotionIdleOpacity, 1e-9),
        'reduced-motion idle opacity is wrong',
      )

      effects.setOverdrive(true)
      effects.update({ deltaMs: 50, nowMs: config.pulsePeriodMs / 2 })
      assert(gear.rotation.z === before, 'gear must not rotate under reduced-motion overdrive')
      assert(
        approximately(glow.material.opacity, config.reducedMotionOverdriveOpacity, 1e-9),
        'reduced-motion overdrive opacity is wrong',
      )

      effects.dispose()
      return `static gear, opacity ${config.reducedMotionIdleOpacity}/${config.reducedMotionOverdriveOpacity}`
    })

    check(`tracking-lifecycle:${panelKey}`, () => {
      const effects = createEffects({ THREE, config })
      const gear = effects.object3D.getObjectByName('brassGear')
      effects.setTracked(true)
      effects.setOverdrive(true)
      effects.setTracked(false)

      assert(effects.object3D.visible === false, 'root must hide when tracking is lost')

      effects.setTracked(true)
      const before = gear.rotation.z
      effects.update({ deltaMs: 50, nowMs: 0 })
      const degrees = (gear.rotation.z - before) * DEGREES
      const expectedIdle = config.idleDegreesPerSecond * (config.maxDeltaMs / 1000)
      assert(
        approximately(degrees, expectedIdle, 1e-9),
        'tracking loss must clear overdrive',
      )

      effects.dispose()
      return 'hidden on loss, overdrive cleared, idle resumed on reacquisition'
    })

    check(`dispose:${panelKey}`, () => {
      const effects = createEffects({ THREE, config })
      const gear = effects.object3D.getObjectByName('brassGear')
      const parent = new THREE.Group()
      parent.add(effects.object3D)
      effects.setTracked(true)

      effects.dispose()
      assert(parent.children.length === 0, 'dispose must detach object3D')
      const before = gear.rotation.z
      effects.dispose()
      effects.update({ deltaMs: 50, nowMs: 1000 })
      assert(effects.object3D.visible === false, 'update after dispose must not show the root')
      assert(gear.rotation.z === before, 'update after dispose must not animate')

      return 'double dispose safe, detach and post-dispose update verified'
    })
  })

  results.forEach((result) => {
    const line = `[${result.result}] ${result.id}: ${result.detail}`
    if (result.result === 'pass') {
      logger.log(line)
    } else {
      logger.error(line)
    }
  })

  return results
}
