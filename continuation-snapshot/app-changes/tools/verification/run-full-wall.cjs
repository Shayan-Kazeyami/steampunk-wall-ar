'use strict'
// Reuse the invoking Node executable for every isolated sequential test process.
const fs = require('node:fs')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const repository = path.resolve(__dirname, '../..')
const tests = ['full-wall-effects.cjs', 'full-wall-ui.cjs', 'full-wall-tracking.cjs',
  'full-wall-loader.cjs', 'full-wall-coordinator.cjs', 'adaptive-runtime.cjs',
  'environment-lighting.cjs', 'field-session.cjs', 'steam-variation.cjs', 'driveway-enhancements.cjs','two-wall-tracking.cjs','two-wall-coordinator.cjs','two-wall-ui.cjs','wall-color-match.cjs','tracked-wall-lighting.cjs','tracking-stabilization.cjs','camera-wall-correspondence.cjs',
  'tracking-events.cjs','tracking-observations.cjs','loading-progress-ui.cjs','loading-progress-loader.cjs','coordinator-observations.cjs','mobile-options-ui.cjs','world-snow.cjs','appearance.cjs','connector-appearance.cjs','machine-interactions.cjs','camera-reference-lighting.cjs',
  'wall-coverage.cjs','wall-coverage-coordinator.cjs','border-extension.cjs','render-benchmark.cjs','asset-instancing.cjs','asset-instancing-integration.cjs','environment-recovery-integration.cjs']
for (const test of tests) {
  if (!fs.existsSync(path.join(repository, 'tests', test))) {
    console.error(`Missing full-wall test: ${test}. No test is silently skipped.`)
    process.exit(1)
  }
}
console.log(`Full-wall offline checks: ${process.version} (${process.execPath})`)
for (const test of tests) {
  console.log(`\nRunning ${test}`)
  const result = spawnSync(process.execPath, [path.join(repository, 'tests', test)], {
    cwd:repository, stdio:'inherit', timeout:60000,
  })
  if (result.error || result.signal || result.status !== 0) {
    console.error(`FAIL ${test}: ${result.error?.message || result.signal || `exit ${result.status}`}`)
    process.exit(Number.isInteger(result.status) && result.status > 0 ? result.status : 1)
  }
}
console.log(`\nPASS: ${tests.length} full-wall test modules; browser/device validation remains separate.`)
