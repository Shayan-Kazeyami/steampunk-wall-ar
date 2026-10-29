'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const THREE=require('../tools/verification/node_modules/three/build/three.cjs')
function load(file,name){const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/full-wall/runtime/'+file+'.js'),'utf8').replace('export const '+name,'const '+name)+'\nglobalThis.api='+name,ctx);return ctx.api}
const machineFactory=load('machine-effects','createMachineEffects'),polishFactory=load('experience-polish','createExperiencePolish'),animationFactory=load('animation-runtime','createWallAnimation')
const model=new THREE.Group(),wall=new THREE.Mesh(new THREE.BoxGeometry(1,.5,.02),new THREE.MeshStandardMaterial());model.add(wall)
const lamps=[]
for(let i=0;i<4;i++){const lens=new THREE.Mesh(new THREE.BoxGeometry(.025,.04,.006),new THREE.MeshStandardMaterial());lens.position.set(i*.1,0,.04);lens.name='Lens'+i;lens.userData={animation_role:'lamp',lamp_emission_unmapped:true};model.add(lens);lamps.push(lens)}
const sign=new THREE.Mesh(new THREE.BoxGeometry(.3,.1,.01),new THREE.MeshStandardMaterial());sign.name='Backplate';sign.userData.animation_role='signboard';model.add(sign)
const needle=new THREE.Group();needle.name='mobile_Steam Pressure Gauge.033_Needle';needle.userData.animation_role='pressure_needle';model.add(needle)
const handle=new THREE.Mesh(new THREE.BoxGeometry(.04,.01,.01),new THREE.MeshStandardMaterial());handle.name='explicit-source-handle';handle.userData.animation_role='control_handle';model.add(handle)
const machine=machineFactory({THREE,model}),polish=polishFactory({THREE,model}),animation=animationFactory({THREE,model})
const run={running:true,tracked:true,reducedMotion:false,overdrive:false,elapsed:1,startup:1}
assert.equal(machine.interact('lamp'),false);assert.equal(polish.interact('sign'),false)
let lows=Infinity,highs=-Infinity;const patterns=new Set()
for(let i=0;i<1000;i++){machine.update(20,i*20,run);polish.update(20,i*20,run);const d=machine.getDiagnostics();lows=Math.min(lows,d.gauges[0].value);if(i>200)highs=Math.max(highs,d.gauges[0].value);if(i>200)patterns.add(d.lamps.map(l=>l.brightness.toFixed(2)).join(','))}
assert(highs-lows>.7,'Idle calibrated gauge must visibly move without overdrive')
assert(patterns.size>100,'Lamp phases vary independently over time')
assert.equal(machine.getInteractionTargets().length,4)
assert(machine.getInteractionTargets().every(t=>t.center.isVector3 && t.radius>0 && t.action==='lamp'))
assert(machine.interact('lamp','Lens2'));for(let i=0;i<200;i++)machine.update(20,0,run)
assert.equal(machine.getDiagnostics().lamps[2].on,false);assert(machine.getDiagnostics().lamps[2].brightness<.001)
assert(machine.getDiagnostics().lamps[1].brightness>.2)
assert(polish.interact('sign','Backplate'));polish.update(20,0,run);assert.equal(polish.state.signActivations,1)
const glint=sign.getObjectByName('ExperiencePolish_SignEdge').children.at(-1),start=glint.position.x
for(let i=0;i<10;i++)polish.update(100,0,run);assert(glint.position.x>start);assert(glint.material.opacity>.18)
assert.equal(animation.turnHandle(),false);animation.setRunning(true);animation.setTracked(true)
assert.equal(animation.getInteractionTargets().length,1);assert(animation.turnHandle(handle.name));animation.update(100,100);assert(handle.quaternion.angleTo(new THREE.Quaternion())>.001)
animation.setReducedMotion(true);assert.equal(animation.turnHandle(),false);assert(handle.quaternion.equals(new THREE.Quaternion()))
machine.update(20,0,{...run,reducedMotion:true});assert(machine.getDiagnostics().lamps.every(l=>l.brightness===1&&!l.haloVisible));assert.equal(machine.interact('lamp'),false)
polish.update(20,0,{...run,reducedMotion:true});assert.equal(polish.interact('sign'),false)
machine.update(20,0,run);machine.update(20,0,{...run,tracked:false});assert(machine.getDiagnostics().lamps.every(l=>!l.haloVisible))
const original=lamps[0].material;machine.dispose();assert.notEqual(lamps[0].material,original);assert(!lamps[0].getObjectByName('MachineEffects_LampHalo'))
polish.dispose();animation.dispose();assert(!sign.getObjectByName('ExperiencePolish_SignEdge'))
console.log('PASS localized lamp halos/independent soft blinking/toggle; sign edge interaction; metadata-only handle; idle calibrated gauge motion; reduced/loss/reset/disposal')

