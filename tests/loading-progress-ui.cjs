'use strict'
// Presenter/focus fixtures. Geometry, actual TalkBack and touch remain browser/device checks.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict')
const {createRequire} = require('node:module')
const root = path.resolve(__dirname, '..')
const {JSDOM} = createRequire(path.join(root, 'tools/verification/package.json'))('jsdom')
const source = fs.readFileSync(path.join(root, 'src/ui/controller.js'), 'utf8').replace('export function', 'function')
const spec = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/spec.json'), 'utf8'))

async function run() {
  const dom = new JSDOM('<main id="mount"></main>', {url:'https://test.invalid/', pretendToBeVisual:true})
  const doc = dom.window.document
  let hidden = false
  Object.defineProperty(doc, 'hidden', {get:() => hidden, configurable:true})
  const context = vm.createContext({window:dom.window, document:doc})
  vm.runInContext(source + '\nglobalThis.create=createUIController', context)
  let ui
  const calls = []
  ui = context.create({mount:doc.querySelector('#mount'), spec,
    collection:[{id:'driveway', label:'Driveway', previewImage:'driveway.jpg'}],
    onStart:() => calls.push('start'), onPreview:() => calls.push('preview'),
    onCancel:() => {calls.push('cancel');ui.setState({state:'landing'})},
    onRetry:() => {calls.push('retry');ui.setState({state:'loading'})},
  })
  const find = selector => doc.querySelector(selector)
  const button = key => find(`[data-control="${key}"]`)
  const panel = find('.steampunk-ui__loading-progress')
  const label = find('.steampunk-ui__loading-label')
  const meter = find('[role="progressbar"]')
  const detail = find('.steampunk-ui__loading-detail')
  const dock = find('.steampunk-ui__dock')
  const update = (phase, status = 'loading', bytes = {}) => ui.setLoadingProgress({phase, status, ...bytes})
  assert(panel.hidden)
  assert.equal(update('download'), false, 'preload cannot expose loading on landing')
  const start = button('start'), preview = button('preview')
  start.focus();start.click();assert.equal(calls.pop(), 'start')
  ui.setState({state:'loading'})
  assert.equal(doc.activeElement, button('cancel'))
  assert.equal(find('.steampunk-ui__dock'), dock, 'the same dock stays mounted')
  assert.equal(update('download', 'loading', {loadedBytes:1000000}), true)
  assert(!panel.hidden)
  assert.equal(label.textContent, 'Downloading the artwork…')
  assert.equal(label.getAttribute('aria-live'), 'polite')
  assert.equal(meter.getAttribute('aria-label'), 'Artwork download')
  assert.equal(meter.getAttribute('aria-valuenow'), null, 'unknown total is indeterminate')
  assert.equal(detail.textContent, '1.0 MB received')
  assert.equal(detail.getAttribute('aria-hidden'), 'true')
  const announcements = []
  const observer = new dom.window.MutationObserver(records => announcements.push(...records))
  observer.observe(label, {childList:true, characterData:true, subtree:true})
  for (const loadedBytes of [2000000, 3000000, 4000000]) update('download', 'loading', {loadedBytes,totalBytes:8000000})
  await Promise.resolve()
  assert.equal(announcements.length, 0, 'byte chunks never rewrite the live phase announcement')
  assert.equal(doc.activeElement, button('cancel'), 'progress updates never move focus')
  assert.equal(meter.getAttribute('aria-valuenow'), '50')
  assert.equal(meter.getAttribute('aria-valuetext'), 'Download 50%')
  assert.match(detail.textContent, /^Download 50%/)
  for (const bytes of [
    {loadedBytes:4,totalBytes:0}, {loadedBytes:4,totalBytes:-1},
    {loadedBytes:4,totalBytes:3}, {loadedBytes:-1,totalBytes:3},
    {loadedBytes:Infinity,totalBytes:3}, {loadedBytes:1,totalBytes:'3'},
  ]) {
    update('download', 'loading', bytes)
    assert.equal(meter.getAttribute('aria-valuenow'), null, 'invalid or incomparable totals never produce percentages')
  }
  update('download', 'complete', {loadedBytes:8,totalBytes:8})
  assert.equal(meter.getAttribute('aria-valuenow'), '100')
  assert.equal(label.textContent, 'Artwork download complete.')
  update('decode', 'loading', {loadedBytes:8,totalBytes:8})
  assert.equal(meter.getAttribute('aria-valuenow'), null, 'decode never inherits the completed download percentage')
  assert.equal(label.textContent, 'Preparing the machinery…')
  assert.equal(detail.textContent, '')
  update('environment', 'fallback')
  assert.equal(label.textContent, 'Continuing with standard lighting.')
  update('warmup', 'skipped')
  assert.match(label.textContent, /skipped/)
  ui.setReducedMotion(true)
  assert(find('.steampunk-ui').classList.contains('is-reduced-motion'))
  update('camera')
  assert.equal(label.textContent, 'Opening your camera. Allow access if asked.')
  assert(!/prompt|permission granted/i.test(label.textContent), 'camera phase does not claim a prompt or permission result')
  update('target-data');assert.match(label.textContent, /scanning reference/)
  assert.equal(update('fake-phase'), false)
  assert.equal(update('download', 'invented'), false)
  assert.equal(panel.dataset.phase, 'target-data')
  button('cancel').click()
  assert.equal(calls.pop(), 'cancel')
  assert(panel.hidden)
  assert.equal(label.textContent, '')
  assert.equal(update('decode'), false, 'late callbacks after cancellation remain hidden')
  assert.equal(doc.activeElement, start)
  assert.equal(dock.parentNode, find('.collection-hero-copy'))
  assert.equal(button('start'), start)
  assert.equal(button('preview'), preview)
  preview.click();assert.equal(calls.pop(), 'preview')

  ui.setState({state:'loading'});update('download')
  ui.setState({state:'error', code:'ASSET_LOAD_FAILED', canRetry:true})
  assert(panel.hidden)
  assert.equal(update('download'), false)
  button('retry').focus();button('retry').click()
  assert.equal(calls.pop(), 'retry')
  assert(panel.hidden, 'retry starts without the failed request snapshot')
  update('decode')
  ui.setState({state:'preview'})
  assert(panel.hidden, 'cached-ready preview has no lingering meter')
  for (const state of ['searching', 'tracked', 'lost', 'paused', 'landing']) {
    ui.setState({state:'loading'});update('decode')
    ui.setState({state});assert(panel.hidden, `${state} clears loading progress`)
    assert.equal(update('camera'), false)
  }
  ui.setState({state:'loading'});update('environment')
  assert.equal(ui.setLoadingProgress(null), true)
  assert(panel.hidden)
  update('decode');hidden = true;doc.dispatchEvent(new dom.window.Event('visibilitychange'))
  assert(panel.hidden)
  assert.equal(update('decode'), false, 'hidden document rejects late progress')
  hidden = false;doc.dispatchEvent(new dom.window.Event('visibilitychange'))
  assert(panel.hidden, 'foreground does not revive an old phase')
  ui.dispose();assert.equal(update('decode'), false)
  observer.disconnect();dom.window.close()
  console.log('PASS: truthful download-only meter, unknown/decode indeterminate, phase-only announcements, focus/dock preservation, fallback/skipped/camera/target phases, cancellation/error/retry/ready/hidden/disposal cleanup')
}
if (require.main === module) run().catch(error => {console.error(error);process.exitCode=1})
module.exports = run
