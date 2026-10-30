// Decorative world-space snow. The caller owns native pose qualification and lifecycle.
export function createWorldSnow({THREE, scene, count = 160, random = Math.random} = {}) {
  if (!THREE || !scene) throw new Error('World snow requires THREE and a scene')
  const particleCount = Math.max(120, Math.min(200, Math.floor(Number(count) || 160)))
  const positions = new Float32Array(particleCount * 3)
  const speeds = new Float32Array(particleCount)
  const phases = new Float32Array(particleCount)
  const geometry = new THREE.BufferGeometry()
  const attribute = new THREE.BufferAttribute(positions, 3)
  if (attribute.setUsage && THREE.DynamicDrawUsage !== undefined) attribute.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', attribute)
  // Small procedural feathered disc: no download, canvas, or image decoder.
  const edge = 32, pixels = new Uint8Array(edge * edge * 4)
  for (let y = 0; y < edge; y++) for (let x = 0; x < edge; x++) {
    const radius = Math.hypot((x + .5) / edge * 2 - 1, (y + .5) / edge * 2 - 1)
    const alpha = Math.max(0, Math.min(1, (1 - radius) / .65))
    const offset = (y * edge + x) * 4
    pixels[offset] = 235; pixels[offset + 1] = 245; pixels[offset + 2] = 255
    pixels[offset + 3] = Math.round(alpha * alpha * 255)
  }
  const texture = new THREE.DataTexture(pixels, edge, edge, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false; texture.needsUpdate = true
  const material = new THREE.PointsMaterial({map: texture, color: 0xffffff, size: .035,
    sizeAttenuation: true, transparent: true, opacity: .68, depthTest: true,
    depthWrite: false, alphaTest: .015})
  const points = new THREE.Points(geometry, material)
  points.name = 'driveway-world-snow'; points.visible = false; points.frustumCulled = false
  scene.add(points)
  let active = false, reducedMotion = false, seeded = false, disposed = false
  let lastPoseValid = false, lastCamera = null, resetCount = 0, updateCount = 0
  const sample = () => Math.max(0, Math.min(.999999, Number(random()) || 0))
  function reset() {
    if (points.visible || seeded || lastPoseValid || lastCamera) resetCount++
    points.visible = false; seeded = false; lastPoseValid = false; lastCamera = null
  }
  function seed(camera) {
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = camera.x + (sample() - .5) * 8
      positions[i * 3 + 1] = camera.y - 2 + sample() * 6
      positions[i * 3 + 2] = camera.z + (sample() - .5) * 8
      speeds[i] = .25 + sample() * .35; phases[i] = sample() * Math.PI * 2
    }
    seeded = true; attribute.needsUpdate = true
  }
  return {
    setActive(value) {active = !!value; if (!active) reset()},
    setReducedMotion(value) {reducedMotion = !!value; if (reducedMotion) reset()},
    reset,
    update(nowMs, deltaSeconds, camera, worldPoseValid = false) {
      if (disposed) return false
      const valid = worldPoseValid === true && camera &&
        [camera.x, camera.y, camera.z].every(Number.isFinite)
      if (!active || reducedMotion || !valid) {reset(); return false}
      // A discontinuous native coordinate frame starts a fresh local field; never interpolate a pose.
      if (lastCamera && Math.hypot(camera.x - lastCamera.x, camera.y - lastCamera.y,
        camera.z - lastCamera.z) > 12) reset()
      if (!seeded) seed(camera)
      lastPoseValid = true
      lastCamera = {x: camera.x, y: camera.y, z: camera.z}
      const dt = Math.max(0, Math.min(.05, Number(deltaSeconds) || 0))
      const time = (Number.isFinite(nowMs) ? nowMs : 0) * .001
      for (let i = 0; i < particleCount; i++) {
        const offset = i * 3
        positions[offset] += Math.sin(time * .4 + phases[i]) * .045 * dt
        positions[offset + 1] -= speeds[i] * dt
        // Wrap only outlying flakes. In-range flakes remain fixed in native world coordinates.
        for (let axis = 0; axis < 3; axis++) {
          const center = axis === 0 ? camera.x : axis === 1 ? camera.y : camera.z
          const span = axis === 1 ? 6 : 8, low = axis === 1 ? -2 : -4
          const minimum = center + low
          if (positions[offset + axis] < minimum || positions[offset + axis] >= minimum + span) {
            positions[offset + axis] = minimum + ((positions[offset + axis] - minimum) % span + span) % span
          }
        }
      }
      attribute.needsUpdate = true; points.visible = true; updateCount++
      return true
    },
    getDiagnostics() {return {active, reducedMotion, visible: points.visible, worldPoseValid: lastPoseValid,
      seeded, particleCount, resetCount, updateCount, disposed}},
    dispose() {
      if (disposed) return
      reset(); disposed = true; active = false
      scene.remove(points); geometry.dispose(); material.dispose(); texture.dispose()
    },
  }
}


