const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const root = path.resolve(__dirname,'../..')
const docs = path.join(root,'docs')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
assert.equal(hash(path.join(root,'package-lock.json')), 'bc0fdb7b7bedf4af4b76e48f1b8e01b18fdad2c542aed4fc98692b958f13eb85', 'Application lock changed')
assert.equal(hash(path.join(root,'external/scripts/8frame-1.5.0.min.js')), '7617f92c289abf00ef6fbc6bfee35944f6c4c2b1e1200e8e8d4cc58ea4a067af', 'Pinned A-Frame runtime changed or is an LFS pointer')
assert(fs.existsSync(path.join(docs,'.nojekyll')))
for (const relative of ['index.html','assets/target-sample.html']) {
  const file = path.join(docs,relative), html = fs.readFileSync(file,'utf8')
  for (const [,reference] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (/^(https?:|data:|mailto:|#)/i.test(reference)) continue
    assert(!reference.startsWith('/'), `Absolute path breaks project Pages URL: ${reference}`)
    const resolved = path.resolve(path.dirname(file), reference.split(/[?#]/)[0])
    assert(resolved.startsWith(docs+path.sep), `Path escapes site: ${reference}`)
    assert(fs.statSync(resolved).isFile(), `Missing site reference: ${reference}`)
  }
}
const html = fs.readFileSync(path.join(docs,'index.html'),'utf8')
for (const name of ['engine-binary','landing-page','xrextras']) {
  assert(html.includes(`@8thwall/${name}@1.0.0/`), `Unpinned/missing ${name} CDN script`)
}
for (const name of ['NOTICES.txt','XR_ENGINE_LICENSE.txt','MIT_NOTICES.txt']) {
  assert(fs.statSync(path.join(docs,'assets',name)).size > 100, `Missing notice ${name}`)
}
const manifests=[path.join(root,'config/target-manifest.json')]
const extra=path.join(root,'config/targets')
if(fs.existsSync(extra)) manifests.push(...fs.readdirSync(extra).filter(name=>name.endsWith('.json')).map(name=>path.join(extra,name)))
for (const manifestPath of manifests) {
const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'))
for (const key of ['compiledJsonPath','trackingImagePath']) {
  const reference = manifest[key]
  assert(typeof reference === 'string' && !reference.startsWith('/'))
  const resolved = path.resolve(docs,reference)
  assert(resolved.startsWith(docs+path.sep))
  assert(fs.statSync(resolved).isFile(), `Missing target resource ${reference}`)
}
}
console.log('Static Pages paths, pinned runtime, application lock, target assets and notices pass')
