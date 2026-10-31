const {JSDOM}=require('../tools/verification/node_modules/jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
for(const route of ['', 'garage']){
 const directory=path.resolve('dist',route),html=fs.readFileSync(path.join(directory,'index.html'),'utf8');
 for(const absentLibrary of [true,false]){
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://test.invalid/'+route+'/'});
  dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
  if(!absentLibrary)dom.window.AFRAME={THREE:{}};
  dom.window.eval(fs.readFileSync(path.join(directory,'bundle.js'),'utf8'));
  const doc=dom.window.document;
  assert.match(doc.body.textContent,absentLibrary?/library could not load/:/graphics are unavailable/);
  assert.equal(doc.querySelector('a-scene'),null);
  const artwork=doc.querySelector(route?'.steampunk-ui a':'#startup-fallback a');
  assert(artwork&&!artwork.hidden);assert(fs.existsSync(path.resolve(directory,artwork.getAttribute('href'))));
  assert(fs.existsSync(path.join(directory,'external/scripts/8frame-1.5.0.min.js')));
  dom.window.close();
 }
 console.log('PASS independent built route and honest startup fallback:',route||'Driveway');
}
