// Contract-only helpers; none of these establish image tracking.
export function createMockPanelRoot(THREE) { return new THREE.Group() }
export function createMockCallbacks(log = []) {
  return Object.fromEntries(['onStart','onOverdrive','onRetry','onPreview','onClosePreview','onReset','onReducedMotionChange'].map(name => [name, (...args) => log.push({name,args})]))
}
export const mockStates = ['landing','loading','searching','tracked','lost','paused','error','preview']
