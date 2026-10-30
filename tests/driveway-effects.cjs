const assert = require('node:assert/strict')

module.exports = function drivewayEffects({load, THREE, spec}) {
  const results = []
  let allocations = 0
  const instrumented = {...THREE}
  for (const [name, value] of Object.entries(THREE)) {
    if (typeof value === 'function' && /(?:Geometry|Material|Texture|Mesh)$/.test(name)) {
      instrumented[name] = new Proxy(value, {construct(target, args, newTarget) {
        allocations++
        return Reflect.construct(target, args, newTarget)
      }})
    }
  }
  const {createEffects} = load('src/effects/index.js', ['createEffects'])
  const panel = Object.values(spec.panels).find(p => p.wallId === 3)
  assert(panel, 'Driveway panel configuration required')
  const effects = createEffects({THREE:instrumented, config:{...spec.effects, panel,
    steam:{enabled:true, maxParticles:24, idleParticles:8, overdriveParticles:24},
    valves:{enabled:true},
  }})
  try {
    effects.setTracked(true)
    effects.setOverdrive(true)
    const root = effects.object3D
    const geometries = new Set(), materials = new Set(), textures = new Set(), meshes = []
    let triangles = 0
    root.traverse(object => {
      if (!object.isMesh) return
      meshes.push(object)
      geometries.add(object.geometry)
      const entries = Array.isArray(object.material) ? object.material : [object.material]
      entries.forEach(material => {
        materials.add(material)
        for (const value of Object.values(material)) if (value && value.isTexture) textures.add(value)
      })
      const count = object.geometry.index ? object.geometry.index.count : object.geometry.attributes.position.count
      triangles += count / 3 * (object.isInstancedMesh ? object.count : 1)
    })
    assert(meshes.some(mesh => mesh.isInstancedMesh), 'Optimized Driveway requires instanced meshes')
    assert(meshes.length <= 8, `Too many effect meshes/draws: ${meshes.length}`)
    assert(triangles <= 12000, `Triangle budget exceeded: ${triangles}`)
    assert(materials.size <= 6, `Material budget exceeded: ${materials.size}`)
    assert(textures.size <= 2, `Texture budget exceeded: ${textures.size}`)
    assert(root.userData.performance, 'Effects must expose performance inventory')
    assert(root.userData.performance.particles <= 24)
    results.push({id:'driveway-optimized-resource-budget', result:'pass', detail:`${meshes.length} meshes; ${triangles} instanced triangles; ${materials.size} materials; ${textures.size} textures. GPU timing unmeasured.`})
    effects.setOverdrive(false)
    const before = allocations
    for (let frame = 0; frame < 240; frame++) {
      if (frame === 60) effects.setOverdrive(true)
      if (frame === 180) effects.setOverdrive(false)
      effects.update({deltaMs:16, nowMs:frame*16})
    }
    assert.equal(allocations,before,'Updates must not construct mesh, geometry, material or texture resources')
    root.traverse(object => {
      if (object.isMesh) assert(geometries.has(object.geometry), 'Tick replaced geometry')
    })
    results.push({id:'driveway-no-gpu-resource-allocation-per-tick', result:'pass', detail:'240 idle/Overdrive frames allocate no Three mesh/geometry/material/texture resources; JS heap and actual GPU not measured.'})
    effects.setReducedMotion(true)
    const matrices = () => {
      const snapshot = []
      root.updateMatrixWorld(true)
      root.traverse(object => {
        snapshot.push(...object.matrix.elements)
        if (object.isInstancedMesh) snapshot.push(...object.instanceMatrix.array)
      })
      return snapshot
    }
    effects.update({deltaMs:16,nowMs:5000})
    const first = matrices()
    effects.update({deltaMs:16,nowMs:5500})
    assert.deepEqual(matrices(),first,'Reduced motion must stop spatial animation')
    effects.setSteamEnabled(false)
    effects.update({deltaMs:16,nowMs:5600})
    results.push({id:'driveway-reduced-motion-steam-control', result:'pass', detail:'Reduced motion keeps spatial transforms static; steam disable callable.'})
    const resources = [...geometries,...materials,...textures]
    const disposed = new Map(resources.map(resource => [resource,0]))
    for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource,disposed.get(resource)+1))
    const parent = new THREE.Group(); parent.add(root)
    effects.dispose(); effects.dispose()
    assert.equal(root.parent,null)
    for (const [resource,count] of disposed) assert.equal(count,1,`${resource.type} must dispose exactly once`)
    effects.update({deltaMs:16,nowMs:6000})
    results.push({id:'driveway-idempotent-resource-disposal', result:'pass', detail:'Every observed geometry/material/texture disposed once; double disposal and post-dispose update safe.'})
  } finally { effects.dispose() }
  return results
}
