const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')

;(async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/shared/render-benchmark.js'),'utf8')
  const {createRenderBenchmark}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
  const saved={document:global.document,requestAnimationFrame:global.requestAnimationFrame,cancelAnimationFrame:global.cancelAnimationFrame}
  let clock=0,active=true,submitted=0,nextId=0,callbacks=new Map(),throwRender=false
  const visibilityListeners=new Set()
  global.document={hidden:false,addEventListener(type,listener){if(type==='visibilitychange')visibilityListeners.add(listener)},removeEventListener(type,listener){if(type==='visibilitychange')visibilityListeners.delete(listener)}}
  const visibility=hidden=>{global.document.hidden=hidden;for(const listener of visibilityListeners)listener()}
  global.requestAnimationFrame=callback=>{const id=++nextId;callbacks.set(id,callback);return id}
  global.cancelAnimationFrame=id=>callbacks.delete(id)
  const original=function(){assert.equal(this,renderer);submitted++;if(throwRender)throw Error('render failure');return 42}
  const renderer={render:original,info:{render:{calls:4,triangles:200},memory:{geometries:3,textures:2},programs:[{}]},getPixelRatio:()=>1,domElement:{width:390,height:844}}
  const tickRAF=t=>{clock=t;const [id,callback]=callbacks.entries().next().value;callbacks.delete(id);callback(t)}
  try{
    assert.throws(()=>createRenderBenchmark({renderer:{}}),/real renderer/)
    const b=createRenderBenchmark({renderer,now:()=>clock,isActive:()=>active,navigator:{userAgent:'deterministic-test'},performance:{memory:{usedJSHeapSize:123,totalJSHeapSize:200}}})
    b.start('known-timeline')
    for(const t of [0,16,36,76]){clock=t;assert.equal(renderer.render(),42)}
    let s=b.snapshot();assert.equal(submitted,4);assert.equal(s.renderCalls,4);assert.equal(s.renderIntervalMs.p50,20);assert.equal(s.renderIntervalMs.p95,40);assert.equal(s.renderIntervalMs.p99,40);assert.equal(s.slowIntervals.over33_333Ms,1);assert.equal(s.resources.triangles,200)
    active=false;clock=1000;renderer.render();active=true;clock=2000;renderer.render();clock=2016;renderer.render()
    s=b.snapshot();assert.equal(s.renderCalls,6);assert.equal(s.retainedIntervalCount,4);assert.equal(s.inactiveResets,1);assert.equal(s.renderIntervalMs.max,40)
    global.document.hidden=true;clock=3000;renderer.render();global.document.hidden=false;clock=4000;renderer.render();clock=4016;renderer.render()
    s=b.snapshot();assert.equal(s.renderCalls,8);assert.equal(s.renderIntervalMs.max,40);assert.equal(s.inactiveResets,2)
    // Long ACTIVE gaps remain included: an actual stall must never be discarded.
    clock=10016;renderer.render();s=b.snapshot();assert.equal(s.renderIntervalMs.max,6000);assert.equal(s.slowIntervals.over100Ms,1)
    throwRender=true;clock=10032;assert.throws(()=>renderer.render(),/render failure/);throwRender=false;assert.equal(b.snapshot().renderErrors,1)
    b.start('raf')
    assert.equal(callbacks.size,1)
    for(const t of [11000,11016,11036,11076])tickRAF(t)
    s=b.snapshot();assert.equal(s.animationFrameCadence.callbacks,4);assert.equal(s.animationFrameCadence.intervalMs.p50,20);assert.equal(s.animationFrameCadence.intervalMs.p95,40)
    active=false;tickRAF(12000);active=true;tickRAF(13000);tickRAF(13016)
    assert.equal(b.snapshot().animationFrameCadence.retainedIntervals,4)
    global.document.hidden=true;tickRAF(14000);global.document.hidden=false;tickRAF(15000);tickRAF(15016)
    assert.equal(b.snapshot().animationFrameCadence.retainedIntervals,5)
    // Real browsers commonly deliver NO callbacks while hidden. The lifecycle
    // event itself must reset both clocks, without hiding a genuinely active stall.
    clock=0;b.start('hidden-with-no-callbacks')
    renderer.render();tickRAF(0);clock=16;renderer.render();tickRAF(16)
    clock=20;visibility(true)
    clock=10016;visibility(false);renderer.render();tickRAF(10016)
    clock=10032;renderer.render();tickRAF(10032)
    s=b.snapshot();assert.equal(s.retainedIntervalCount,2);assert.equal(s.renderIntervalMs.max,16);assert.equal(s.inactiveResets,1);assert.equal(s.animationFrameCadence.retainedIntervals,2);assert.equal(s.animationFrameCadence.intervalMs.p95,16)
    clock=20032;renderer.render();tickRAF(20032);s=b.snapshot();assert.equal(s.renderIntervalMs.max,10000);assert.equal(s.animationFrameCadence.intervalMs.p95,10000)
    const stopped=b.stop();assert.equal(callbacks.size,0);clock=16000;renderer.render();assert.equal(b.snapshot().renderCalls,stopped.renderCalls)
    b.dispose();assert.equal(renderer.render,original);assert.equal(visibilityListeners.size,0)
    const bounded=createRenderBenchmark({renderer,now:()=>clock,isActive:()=>true,maxSamples:60})
    bounded.start('capacity')
    for(let i=0;i<100;i++){clock=20000+i*17;renderer.render()}
    s=bounded.snapshot();assert.equal(s.renderCalls,100);assert.equal(s.retainedIntervalCount,60);assert.equal(s.discardedSamples,79);assert.equal(s.sampleCapacity,60)
    assert.equal(callbacks.size,1);bounded.start('reset');assert.equal(callbacks.size,1);assert.equal(bounded.snapshot().renderCalls,0)
    bounded.dispose();assert.equal(callbacks.size,0);assert.equal(renderer.render,original);assert.equal(visibilityListeners.size,0)
    const ownership=createRenderBenchmark({renderer,now:()=>clock});const later=()=>{};renderer.render=later;ownership.dispose();assert.equal(renderer.render,later)
    console.log('PASS render benchmark: delegation, exact percentiles, retained stalls, hidden/inactive reset, render error, rAF scheduling/reset, stop, bounded capacity and disposal ownership')
  }finally{
    for(const [key,value]of Object.entries(saved)){if(value===undefined)delete global[key];else global[key]=value}
  }
})().catch(error=>{console.error(error);process.exitCode=1})
