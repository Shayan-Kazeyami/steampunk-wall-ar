'use strict'
const {JSDOM}=require('../tools/verification/node_modules/jsdom');
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8'),bundle=fs.readFileSync(path.join(root,'dist/bundle.js'),'utf8');
for(const missingLibrary of [false,true]){
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://test.invalid/ar/'});
 dom.window.HTMLCanvasElement.prototype.getContext=()=>null;if(!missingLibrary)dom.window.AFRAME={THREE:{}};
 dom.window.eval(bundle);const doc=dom.window.document;
 assert.match(doc.querySelector('#startup-message').textContent,missingLibrary?/library could not load/:/graphics are unavailable/);
 assert.equal(doc.querySelector('a-scene'),null);assert.equal(doc.querySelector('#startup-fallback a').getAttribute('href'),'./assets/driveway-sample.html');
 console.log('PASS built Driveway fallback:',missingLibrary?'missing library':'WebGL unavailable');dom.window.close();
}
