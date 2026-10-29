// Coordinator entry point: build this checkout, then stage only that successful build.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {spawnSync} = require('node:child_process')
const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist'), docs = path.join(root, 'docs')
const output = path.join(root, 'tools/verification/results')
const digest = data => crypto.createHash('sha256').update(data).digest('hex')
function tree(directory) {
  const files = {}
  function visit(current) {
    for (const entry of fs.readdirSync(current, {withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Symlink forbidden in static output: ${file}`)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile()) files[path.relative(directory,file).split(path.sep).join('/')] = digest(fs.readFileSync(file))
      else throw new Error(`Unsupported static output entry: ${file}`)
    }
  }
  visit(directory)
  return files
}
function run() {
  const npmCli = process.env.npm_execpath
  const built = npmCli
    ? spawnSync(process.execPath, [npmCli, 'run', 'build'], {cwd:root, stdio:'inherit'})
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run','build'], {
      cwd:root, stdio:'inherit', shell:process.platform === 'win32',
    })
  if (built.error) throw built.error
  if (built.status !== 0) throw new Error(`Build failed (exit ${built.status}); docs was not changed`)
  const expected = tree(dist)
  for (const required of ['index.html','bundle.js','assets/NOTICES.txt','assets/XR_ENGINE_LICENSE.txt','assets/MIT_NOTICES.txt']) {
    if (!expected[required]) throw new Error(`Missing build output: ${required}`)
  }
  // Resolve and validate before recursive deletion; the only mutable delivery path is this checkout/docs.
  if (path.dirname(docs) !== root || path.basename(docs) !== 'docs') throw new Error('Unsafe staging path')
  if (fs.existsSync(docs) && fs.lstatSync(docs).isSymbolicLink()) throw new Error('docs must not be a symlink')
  fs.mkdirSync(output,{recursive:true})
  const temporary = fs.mkdtempSync(path.join(output,'pages-stage-'))
  const staged = path.join(temporary,'site'), previous = path.join(temporary,'previous')
  fs.cpSync(dist, staged, {recursive:true})
  fs.writeFileSync(path.join(staged,'.nojekyll'), '')
  expected['.nojekyll'] = digest(Buffer.alloc(0))
  const actual = tree(staged)
  const normalize = files => JSON.stringify(Object.entries(files).sort(([a],[b]) => a.localeCompare(b)))
  if (normalize(expected) !== normalize(actual)) throw new Error('Staged Pages files differ from successful build; docs preserved')
  const hadPrevious = fs.existsSync(docs)
  if (hadPrevious) fs.renameSync(docs,previous)
  try { fs.renameSync(staged,docs) }
  catch (error) {
    if (hadPrevious) fs.renameSync(previous,docs)
    throw error
  }
  // Temporary path is created under our verified result directory, never user supplied.
  if (path.dirname(temporary) !== output) throw new Error('Unsafe temporary cleanup path')
  fs.rmSync(temporary,{recursive:true,force:true})
  const manifest = {builtAt:new Date().toISOString(), source:'this repository dist after successful npm run build', fileCount:Object.keys(actual).length, files:actual}
  fs.writeFileSync(path.join(output,'pages-manifest.json'), JSON.stringify(manifest,null,2)+'\n')
  console.log(`Pages staged and SHA256 verified: ${manifest.fileCount} files`)
}
try { run() } catch (error) { console.error(error); process.exitCode = 1 }
