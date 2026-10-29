'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const {createRequire}=require('node:module'),root=path.resolve(__dirname,'..')
const {JSDOM}=createRequire(path.join(root,'tools/verification/package.json'))('jsdom')
const dom=new JSDOM('<main></main>',{pretendToBeVisual:true,url:'https://test.invalid/'})
const view=dom.window,doc=view.document
view.innerWidth=390;view.innerHeight=844
const context=vm.createContext({window:view,document:doc})
vm.runInContext(fs.readFileSync(path.join(root,'src/ui/controller.js'),'utf8').replace('export function','function')+'\nglobalThis.create=createUIController',context)
const actions=[]
const ui=context.create({mount:doc.querySelector('main'),spec:JSON.parse(fs.readFileSync(path.join(root,'src/shared/spec.json'))),
 collection:[{id:'driveway',label:'Driveway',previewImage:'wall.jpg'}],onPreview:()=>actions.push('preview'),
 onMachineAction:action=>{actions.push(action);return true},onSoundChange:value=>value,onReducedMotionChange:value=>actions.push(value)})
const el=selector=>doc.querySelector(selector),control=key=>el('[data-control='+key+']'),more=el('.steampunk-ui__options-toggle'),panel=el('.steampunk-ui__options-panel')
try{
 assert(el('.steampunk-ui').classList.contains('is-compact'));assert(panel.hidden && !more.hidden)
 assert.equal(control('preview').parentNode,panel);assert.equal(el('.steampunk-ui__motion').parentNode,panel)
 more.click();assert(!panel.hidden);assert.equal(more.getAttribute('aria-expanded'),'true')
 control('preview').click();assert.equal(actions.pop(),'preview')
 panel.dispatchEvent(new view.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(panel.hidden);assert.equal(doc.activeElement,more)
 ui.setSoundAvailable(true);ui.setState({state:'preview'})
 assert.equal(el('[data-machine-action=release]').parentNode,el('.steampunk-ui__machine-controls'))
 assert.equal(el('[data-machine-action=valve]').parentNode,panel);assert(!el('[data-machine-action=valve]').hidden)
 more.click();el('[data-machine-action=valve]').click();assert.equal(actions.pop(),'valve')
 control('reset').focus();ui.setState({state:'searching'});assert(panel.hidden);assert(!panel.contains(doc.activeElement),'state change must release focus from hidden options')
 more.click();el('.steampunk-ui__motion-input').checked=true;el('.steampunk-ui__motion-input').dispatchEvent(new view.Event('change'));assert.equal(actions.pop(),true)
 ui.setState({state:'tracked'});assert(control('overdrive').disabled);assert(el('[data-machine-action=valve]').disabled)
 more.click();view.innerWidth=1280;view.innerHeight=900;view.dispatchEvent(new view.Event('resize'))
 assert(more.hidden && panel.hidden);assert.equal(control('overdrive').parentNode,el('.steampunk-ui__controls'));assert.equal(el('[data-machine-action=valve]').parentNode,el('.steampunk-ui__machine-controls'))
 view.innerWidth=320;view.innerHeight=740;view.dispatchEvent(new view.Event('resize'));ui.setState({state:'error',code:'CAMERA_DENIED',canRetry:true})
 assert(more.hidden && panel.hidden);assert(!control('retry').hidden && !control('preview').hidden);assert.equal(control('preview').parentNode,el('.steampunk-ui__controls'))
 console.log('PASS mobile options: existing callbacks, Escape/focus, state cleanup, reduced motion, desktop restoration and visible error recovery')
}finally{ui.dispose();dom.window.close()}
