'use strict'
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const context = {}; vm.createContext(context)
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/shared/world-snow.js'), 'utf8')
  .replace('export function createWorldSnow', 'function createWorldSnow') + '\nglobalThis.createWorldSnow = createWorldSnow', context)
class Resource {dispose() {this.disposed = true}}
class Geometry extends Resource {setAttribute(key, value) {this[key] = value}}
class Attribute {constructor(array) {this.array = array} setUsage() {}}
class Texture extends Resource {}
class Material extends Resource {constructor(options) {super(); Object.assign(this, options)}}
class Points {constructor(geometry, material) {this.geometry = geometry; this.material = material}}
const THREE = {BufferGeometry: Geometry, BufferAttribute: Attribute, DataTexture: Texture, PointsMaterial: Material, Points}
let cases = 0
function test(name, fn) {fn(); cases++; console.log('PASS ' + name)}
function fixture(count) {
  const scene = {add(p) {this.points = p}, remove(p) {assert.equal(this.points, p); this.removed = true}}
  const snow = context.createWorldSnow({THREE, scene, count, random: () => .5})
  return {snow, scene, camera: {x: 2, y: 3, z: 4}}
}
test('Explicit world pose gate and active gate default to hidden', () => {
  const {snow, scene, camera} = fixture()
  assert.equal(snow.update(0, .016, camera, true), false)
  snow.setActive(true)
  assert.equal(snow.update(0, .016, camera), false)
  assert.equal(snow.update(0, .016, camera, 'NORMAL'), false)
  assert.equal(snow.update(0, .016, camera, true), true)
  assert.equal(scene.points.visible, true)
  assert.equal(snow.update(1, .016, {x: NaN, y: 0, z: 0}, true), false)
  assert.equal(scene.points.visible, false)
})
test('Native world coordinates preserve flakes across ordinary camera motion', () => {
  const {snow, scene, camera} = fixture(); snow.setActive(true); snow.update(0, 0, camera, true)
  const before = Array.from(scene.points.geometry.position.array)
  snow.update(0, 0, {x: 2.1, y: 3, z: 4}, true)
  assert.deepEqual(Array.from(scene.points.geometry.position.array), before)
  snow.update(0, .02, camera, true)
  assert(scene.points.geometry.position.array[1] < before[1])
})
test('Stop, invalid pose and reduced motion clear the old field', () => {
  const {snow, camera} = fixture(); snow.setActive(true); snow.update(0, .016, camera, true)
  snow.setReducedMotion(true); assert.equal(snow.update(0, .016, camera, true), false)
  assert.equal(snow.getDiagnostics().seeded, false)
  snow.setReducedMotion(false); assert.equal(snow.update(0, .016, camera, true), true)
  snow.setActive(false); assert.equal(snow.getDiagnostics().visible, false)
  snow.setActive(true); assert.equal(snow.update(0, .016, {x: 20, y: 0, z: 0}, false), false)
  assert.equal(snow.update(0, .016, {x: 20, y: 0, z: 0}, true), true)
})
test('Bounded particle count and frame delta prevent runaway work or fall jumps', () => {
  for (const [input, expected] of [[1, 120], [9999, 200], [undefined, 160]]) {
    const {snow, scene, camera} = fixture(input)
    assert.equal(snow.getDiagnostics().particleCount, expected)
    snow.setActive(true); snow.update(0, 0, camera, true)
    const y = scene.points.geometry.position.array[1]
    snow.update(100000, 100, camera, true)
    assert(Math.abs(scene.points.geometry.position.array[1] - y) <= .031)
  }
})
test('Dispose removes Points and releases GPU resources exactly once', () => {
  const {snow, scene, camera} = fixture(); const {geometry, material} = scene.points
  snow.dispose(); snow.dispose()
  assert(scene.removed && geometry.disposed && material.disposed && material.map.disposed)
  assert.equal(snow.update(0, .016, camera, true), false)
  assert.equal(snow.getDiagnostics().disposed, true)
})
test('Repeated idle lifecycle calls do not inflate reset diagnostics', () => {
  const {snow, camera} = fixture()
  const idle = () => {snow.setActive(false); snow.setReducedMotion(true); snow.update(0, .016, camera, true); snow.update(0, .016, camera, false)}
  idle(); idle(); assert.equal(snow.getDiagnostics().resetCount, 0)
  snow.setActive(true); snow.setReducedMotion(false); snow.update(0, .016, camera, true)
  snow.update(0, .016, camera, false)
  assert.equal(snow.getDiagnostics().resetCount, 1)
  idle(); idle(); assert.equal(snow.getDiagnostics().resetCount, 1)
})
console.log(`${cases} world snow checks passed`)

