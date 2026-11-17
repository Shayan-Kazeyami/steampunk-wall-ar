'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const {runModules}=require('../tools/verification/run-full-wall.cjs')
// Only process-control doubles. No coverage/reference fixtures are manufactured.
function run(outcomes, missing=[]){
 const calls=[],logs=[],errors=[],modules=Object.keys(outcomes)
 const result=runModules({modules,root:'/repo',exists:file=>!missing.includes(path.basename(file)),
  spawn:(exe,args,opts)=>{const name=path.basename(args[0]);calls.push({name,exe,opts});const outcome=outcomes[name];if(outcome instanceof Error)throw outcome;return outcome},
  log:s=>logs.push(s),error:s=>errors.push(s)})
 return {...result,calls,logs,errors}
}
test('successful modules use same executable and bounded independent processes',()=>{
 const r=run({'a.cjs':{status:0},'b.cjs':{status:0}})
 assert.equal(r.exitCode,0);assert.equal(r.passed,2)
 for(const c of r.calls){assert.equal(c.exe,process.execPath);assert.equal(c.opts.timeout,60000);assert.equal(c.opts.cwd,'/repo')}
 assert.match(r.logs.at(-1),/PASS: 2\/2/)
})
test('nonzero module does not hide subsequent failures or passes',()=>{
 const r=run({'a.cjs':{status:2},'b.cjs':{status:0},'c.cjs':{status:3}})
 assert.deepEqual(r.calls.map(x=>x.name),['a.cjs','b.cjs','c.cjs']);assert.equal(r.passed,1);assert.equal(r.exitCode,1)
 assert.deepEqual(r.failures.map(x=>x.test),['a.cjs','c.cjs']);assert(!r.logs.some(x=>x.startsWith('PASS:')))
})
test('missing module is failure, never silent skip, later modules still run',()=>{
 const r=run({'missing.cjs':{status:0},'later.cjs':{status:0}},['missing.cjs'])
 assert.equal(r.exitCode,1);assert.equal(r.total,2);assert.equal(r.passed,1);assert.equal(r.calls.length,1)
 assert.match(r.errors[0],/No test is silently skipped/)
})
test('timeout, signal, thrown spawn and unknown result fail closed',()=>{
 const r=run({'timeout.cjs':{error:new Error('ETIMEDOUT'),status:null},'signal.cjs':{signal:'SIGTERM',status:null},'throw.cjs':new Error('spawn failed'),'unknown.cjs':undefined,'later.cjs':{status:0}})
 assert.equal(r.exitCode,1);assert.equal(r.failures.length,4);assert.equal(r.passed,1);assert.equal(r.calls.length,5)
})
