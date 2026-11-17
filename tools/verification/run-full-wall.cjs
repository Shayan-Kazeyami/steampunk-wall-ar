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
// Continue through independent modules so a missing authoritative coverage input
// cannot hide a later regression. Every failure still makes the aggregate fail.
function runModules({modules = tests, root = repository, exists = fs.existsSync,
  spawn = spawnSync, log = console.log, error = console.error} = {}) {
  const failures = []
  let passed = 0
  log(`Full-wall offline checks: ${process.version} (${process.execPath})`)
  for (const test of modules) {
    const file = path.join(root, 'tests', test)
    if (!exists(file)) {
      failures.push({test, reason:'missing test file'})
      error(`FAIL ${test}: missing test file. No test is silently skipped.`)
      continue
    }
    log(`\nRunning ${test}`)
    let result
    try {
      result = spawn(process.execPath, [file], {cwd:root, stdio:'inherit', timeout:60000})
    } catch (cause) { result = {error:cause} }
    if (!result || result.error || result.signal || result.status !== 0) {
      const reason = result?.error?.message || result?.signal || `exit ${result?.status ?? 'unknown'}`
      failures.push({test, reason})
      error(`FAIL ${test}: ${reason}`)
    } else passed++
  }
  const summary = `${passed}/${modules.length} full-wall modules passed; ${failures.length} failed. Browser/device validation remains separate.`
  if (failures.length) error(`\nFAIL: ${summary}\n${failures.map(f => `- ${f.test}: ${f.reason}`).join('\n')}`)
  else log(`\nPASS: ${summary}`)
  return {passed, total:modules.length, failures, exitCode:failures.length ? 1 : 0}
}
if (require.main === module) process.exitCode = runModules().exitCode
module.exports = {runModules, tests}
