'use strict'
// JSDOM interaction tests; physical touch, sound and visual layout are separate gates.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict')
const {createRequire} = require('node:module')
const ar = path.resolve(__dirname, '..')
const {JSDOM} = createRequire(path.join(ar, 'tools/verification/package.json'))('jsdom')
const spec = JSON.parse(fs.readFileSync(path.join(ar, 'src/shared/spec.json')))
const source = fs.readFileSync(path.join(ar, 'src/ui/controller.js'), 'utf8').replace('export function', 'function')
const settle = () => new Promise(resolve => setImmediate(resolve))
function harness(callback) {
  const dom = new JSDOM('<div id="mount"></div>', {url:'https://test.invalid/', pretendToBeVisual:true})
  let hidden = false
  Object.defineProperty(dom.window.document, 'hidden', {get:() => hidden, configurable:true})
  const context = {window:dom.window, document:dom.window.document}
  vm.createContext(context)
  vm.runInContext(source + '\n globalThis.create = createUIController', context)
  const ui = context.create({mount:dom.window.document.querySelector('#mount'), spec, onSoundChange:callback})
  const button = dom.window.document.querySelector('[data-control="sound"]')
  return {dom, ui, button, doc:dom.window.document, visibility(value) {
    hidden = value; dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'))
  }}
}
async function run() {
  const legacy = harness()
  legacy.ui.setSoundAvailable(true)
  for (const state of [...spec.ui.trackingStates, ...spec.ui.extraStates]) {
    legacy.ui.setState({state})
    assert(legacy.button.hidden, 'legacy controller has no additional visible controls')
  }
  legacy.ui.dispose();legacy.dom.window.close()

  const calls = []
  const h = harness(async value => { calls.push(value); return value })
  assert(h.button.hidden)
  h.ui.setSoundAvailable(true)
  assert(!h.button.hidden && h.button.disabled)
  h.ui.setState({state:'preview'})
  assert(!h.button.disabled)
  const boost = h.doc.querySelector('[data-control="overdrive"]')
  const motion = h.doc.querySelector('.steampunk-ui__motion-input')
  h.ui.setOverdrive(true)
  assert.equal(boost.getAttribute('aria-pressed'), 'true')
  h.ui.setReducedMotion(true)
  assert(boost.disabled, 'reduced motion disables Overdrive immediately')
  assert.equal(boost.getAttribute('aria-pressed'), 'false')
  h.ui.setOverdrive(true)
  assert.equal(boost.getAttribute('aria-pressed'), 'false', 'programmatic boost respects reduced motion')
  h.ui.setState({state:'tracked'})
  assert(boost.disabled, 'state updates retain reduced-motion protection')
  h.ui.setReducedMotion(false)
  assert(!boost.disabled, 'tracked mode permits boost after reduced motion clears')
  h.ui.setOverdrive(true)
  motion.checked = true
  motion.dispatchEvent(new h.dom.window.Event('change'))
  assert(boost.disabled)
  assert.equal(boost.getAttribute('aria-pressed'), 'false', 'checkbox clears active boost')
  motion.checked = false
  motion.dispatchEvent(new h.dom.window.Event('change'))
  assert(!boost.disabled)
  h.ui.setState({state:'searching'})
  h.ui.setReducedMotion(false)
  assert(boost.disabled, 'clearing reduced motion never enables boost outside active modes')
  h.ui.setState({state:'preview'})
  h.ui.setReducedMotion(true);h.ui.setReducedMotion(false)
  assert(!boost.disabled, 'preview permits boost after reduced motion clears')
  assert.equal(h.button.getAttribute('aria-pressed'), 'false')
  h.button.click()
  assert.deepEqual(calls,[true], 'audio callback invoked synchronously in user click')
  assert(h.button.disabled, 'async resume blocks duplicate click')
  await settle()
  assert.equal(h.button.textContent, 'Sound on')
  assert.equal(h.button.getAttribute('aria-pressed'), 'true')
  h.ui.setState({state:'lost'})
  assert.deepEqual(calls,[true,false])
  assert.equal(h.button.getAttribute('aria-pressed'), 'false')
  h.ui.setState({state:'tracked'})
  assert.equal(h.button.textContent, 'Sound off')
  assert.deepEqual(calls,[true,false], 'tracking return never starts sound')
  h.button.click();await settle()
  h.visibility(true)
  assert(h.button.disabled)
  assert.equal(h.button.getAttribute('aria-pressed'), 'false')
  h.visibility(false)
  assert(!h.button.disabled)
  assert.equal(h.button.textContent,'Sound off')
  for (const action of ['stop', 'reset', 'cancel', 'exitPreview']) {
    h.ui.setState({state:'tracked'});h.button.click();await settle()
    h.doc.querySelector(`[data-control="${action}"]`).dispatchEvent(new h.dom.window.Event('click'))
    assert.equal(h.button.getAttribute('aria-pressed'),'false', `${action} releases opt-in`)
    assert.equal(calls[calls.length-1],false)
  }
  h.ui.setState({state:'preview'});h.button.click();await settle()
  h.ui.setSoundAvailable(false)
  assert(h.button.hidden)
  assert.equal(calls[calls.length-1],false)
  h.ui.dispose();h.dom.window.close()

  let resolveEnable
  const cancellation = []
  const pending = harness(value => {
    cancellation.push(value)
    return value ? new Promise(resolve => { resolveEnable=resolve }) : false
  })
  pending.ui.setSoundAvailable(true);pending.ui.setState({state:'preview'});pending.button.click()
  pending.ui.setState({state:'searching'})
  resolveEnable(true);await settle()
  assert.deepEqual(cancellation,[true,false])
  assert.equal(pending.button.getAttribute('aria-pressed'),'false', 'late resume cannot restore sound')
  pending.ui.setState({state:'preview'});pending.button.click()
  pending.ui.setSoundEnabled(false);resolveEnable(true);await settle()
  assert.equal(pending.button.getAttribute('aria-pressed'),'false', 'parent audio state is authoritative')
  pending.button.click();pending.ui.dispose();resolveEnable(true);await settle()
  assert.equal(pending.doc.querySelector('.steampunk-ui'),null)
  assert.equal(cancellation[cancellation.length-1],false)
  pending.dom.window.close()

  let fail = true
  const errors = harness(async value => {if (fail) throw new Error('blocked');return value})
  errors.ui.setSoundAvailable(true);errors.ui.setState({state:'preview'});errors.button.click();await settle()
  assert.equal(errors.button.getAttribute('aria-pressed'),'false')
  assert(!errors.doc.querySelector('.steampunk-ui__sound-status').hidden)
  assert(!errors.button.disabled)
  fail=false;errors.button.click();await settle()
  assert.equal(errors.button.getAttribute('aria-pressed'),'true')
  assert(errors.doc.querySelector('.steampunk-ui__sound-status').hidden)
  errors.ui.dispose();errors.dom.window.close()
  console.log('PASS: optional UI sound control, immediate gesture callback, async failure/cancellation, authoritative parent state, visibility, Stop/loss/disposal and legacy states')
}
if (require.main === module) run().catch(error => {console.error(error);process.exitCode=1})
module.exports = run
