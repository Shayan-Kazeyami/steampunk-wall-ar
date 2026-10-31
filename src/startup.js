import {prepareScene, boot} from './main.js'

export function startApplication({doc=document, view=window, makeUI=createStartupUI, prepare=prepareScene, initialize=boot, schedule=setTimeout, cancel=clearTimeout}={}) {
  const ui=makeUI({mount:doc.querySelector('#ui'),onRetry:()=>view.location.reload()})
  ui.setState({state:'landing',message:'Preparing the interactive demo…',controlsPending:true})

  let scene, timer, poll, finished=false
  const clear=()=>{cancel(timer);cancel(poll)}
  function fail(message,canRetry=false) {
    if(finished)return
    finished=true;clear()
    // Keep accessible UI and artwork available even if renderer construction failed.
    try { scene?.pause?.() } catch (_) {}
    ui.setState({state:'error',message,graphicsUnavailable:true,canRetry})
  }
  if(!view.AFRAME?.THREE) {
    fail('The 3D library could not load. Check your connection and reload this page.',true)
    return
  }
  let context
  try {
    const canvas=doc.createElement('canvas')
    context=canvas.getContext('webgl2') || canvas.getContext('webgl')
  } catch (_) {}
  if(!context) {
    fail('3D graphics are unavailable in this browser. Try a browser or device with WebGL support.')
    return
  }
  // Release the temporary probe before A-Frame allocates the actual scene context.
  try { context.getExtension?.('WEBGL_lose_context')?.loseContext() } catch (_) {}
  try {
    prepare()
    const template=doc.querySelector('#scene-template')
    const fragment=template.content.cloneNode(true)
    scene=fragment.querySelector('a-scene')
    if(!scene)throw new Error('Scene template is unavailable')
    timer=schedule(()=>fail('The 3D scene could not start. Try another browser or reload this page.',true),15000)
    function ready() {
      if(finished)return
      if(scene.hasLoaded && scene.renderer && scene.camera) {
        try { initialize();finished=true;clear();ui.dispose() }
        catch (_) { fail('The 3D scene could not start. Try another browser or reload this page.',true) }
      } else poll=schedule(ready,50)
    }
    doc.body.appendChild(fragment)
    ready()
  } catch (_) {
    fail('The 3D scene could not start. Try another browser or reload this page.',true)
  }
}

function createStartupUI({mount,onRetry}) {
  const doc=mount.ownerDocument, panel=doc.querySelector('#startup-fallback');
  const status=doc.querySelector('#startup-message'),retry=doc.querySelector('#startup-retry');
  retry.addEventListener('click',onRetry);
  return {
    setState({message,canRetry=false}) { status.textContent=message;retry.hidden=!canRetry; },
    dispose() { retry.removeEventListener('click',onRetry);panel.remove(); },
  };
}
