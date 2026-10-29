import fs from 'node:fs';
import assert from 'node:assert/strict';
import {applyGlassContract} from './glass-contract.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('./PLAN.json',import.meta.url),'utf8'));
const extensions=['KHR_materials_transmission','KHR_materials_ior'];
function fixture(){const meshes=manifest.objects.map((row,i)=>({isMesh:true,castShadow:i%2===0,userData:{ar_source_component:row.source,ar_source_subset:'historical_source_material:glass',ar_source_sha256:manifest.source_sha256,ar_source_audit_sha256:manifest.C9_audit_sha256,ar_wall:'05_GARAGE_L',source_assigned_polygons:1088,ar_shadow_contract:'source_glass_IsShadowRay_white_Transparent:castShadow=false',ar_shadow_contract_version:1},geometry:{uuid:'exact-shared'},material:{isMeshPhysicalMaterial:true,userData:{source_family:'glass'},transmission:1,ior:1.3329999446868896,roughness:0,metalness:0,opacity:1,transparent:false,side:2,alphaTest:0,color:{r:.800000011920929,g:.800000011920929,b:.800000011920929}}}));return{meshes,root:{traverse(fn){for(const m of meshes)fn(m)}}};}
const controls=[];
function reject(name,mutate){const f=fixture();mutate(f);const before=f.meshes.map(m=>m.castShadow);assert.throws(()=>applyGlassContract(f.root,manifest,extensions));assert.deepEqual(f.meshes.map(m=>m.castShadow),before,'Partial mutation on rejection:'+name);controls.push(name);}
reject('duplicate_source',f=>f.meshes[15].userData.ar_source_component=f.meshes[0].userData.ar_source_component);
reject('missing_node',f=>f.meshes.pop());
reject('wrong_wall',f=>f.meshes[0].userData.ar_wall='06_GARAGE_R');
reject('wrong_source_hash',f=>f.meshes[0].userData.ar_source_sha256='wrong');
reject('wrong_audit_hash',f=>f.meshes[0].userData.ar_source_audit_sha256='wrong');
reject('wrong_contract_version',f=>f.meshes[0].userData.ar_shadow_contract_version=2);
reject('missing_contract',f=>delete f.meshes[0].userData.ar_shadow_contract);
reject('wrong_bulb_family',f=>f.meshes[0].userData.ar_source_subset='historical_source_material:bulb');
reject('wrong_wholeobject_family',f=>f.meshes[0].userData.ar_source_subset='whole_lamp');
reject('late_bad_node_no_partial_shadow_mutation',f=>f.meshes[15].material.ior=1.5);
for(const name of ['transmissionMap','alphaMap','roughnessMap','metalnessMap','specularColorMap','normalMap','thicknessMap'])reject('unexpected_'+name,f=>f.meshes[15].material[name]={});
const good=fixture();const result=applyGlassContract(good.root,manifest,extensions);assert.equal(result.applied,16);assert.deepEqual(good.meshes.map(m=>m.castShadow),Array(16).fill(false));
const report={status:'PASS_GLASS_RUNTIME_CONTRACT_CPU_FIXTURES',negativeControls:controls,every_rejection_preserves_all_shadow_flags:true,valid_fixture_all16_castShadow_false:true,scope:'CPU fixture logic only; actual browser checks separate'};fs.writeFileSync(new URL('./CONTRACT_TEST.json',import.meta.url),JSON.stringify(report,null,2));console.log(report.status,controls.length);
