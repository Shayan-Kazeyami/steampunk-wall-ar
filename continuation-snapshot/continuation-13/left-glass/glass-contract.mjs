export function applyGlassContract(root, manifest, supportedExtensions) {
  if (manifest?.source_sha256 !== '6879ac01468bc99eb052928d5a4f6f1f3d1cbadec66ce13b9bf9088ad08e4456' || manifest.C9_audit_sha256 !== '0fd6fa2802c64f05acd50e0ae7dbd5018e8aef77a4041b6ca74b9a5458dec724' || manifest.objects?.length !== 16)
    throw Error('Invalid glass source manifest');
  for (const ext of ['KHR_materials_transmission','KHR_materials_ior'])
    if (!supportedExtensions.includes(ext)) throw Error('Unsupported '+ext);
  const expected=new Set(manifest.objects.map(x=>x.source));
  if(expected.size!==16)throw Error('Duplicate source');
  for(let i=32;i<48;i++)if(!expected.has(`Left bulb.${String(i).padStart(3,'0')}`))throw Error('Unexpected glass source');
  const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o)});if(meshes.length!==16)throw Error('Wrong glass mesh count');
  const seen=new Set();
  for(const o of meshes){const d=o.userData,m=o.material;
    if(!expected.has(d.ar_source_component)||seen.has(d.ar_source_component)||d.ar_source_subset!=='historical_source_material:glass'||d.ar_source_sha256!==manifest.source_sha256||d.ar_source_audit_sha256!==manifest.C9_audit_sha256||d.ar_wall!=='05_GARAGE_L'||d.source_assigned_polygons!==1088||d.ar_shadow_contract!=='source_glass_IsShadowRay_white_Transparent:castShadow=false'||d.ar_shadow_contract_version!==1)throw Error('Invalid assigned glass role');
    const forbiddenMaps=['map','normalMap','bumpMap','displacementMap','alphaMap','roughnessMap','metalnessMap','emissiveMap','aoMap','transmissionMap','thicknessMap','specularIntensityMap','specularColorMap','clearcoatMap','clearcoatRoughnessMap','clearcoatNormalMap','sheenColorMap','sheenRoughnessMap','iridescenceMap','iridescenceThicknessMap','anisotropyMap'];
    if(!m?.isMeshPhysicalMaterial||m.userData.source_family!=='glass'||m.transmission!==1||Math.abs(m.ior-1.3329999446868896)>1e-7||m.roughness!==0||m.metalness!==0||m.opacity!==1||m.transparent!==false||m.side!==2||m.alphaTest!==0||forbiddenMaps.some(key=>!!m[key])||['r','g','b'].some(k=>Math.abs(m.color[k]-.800000011920929)>1e-6))throw Error('Invalid final glass camera material');
    if (!m.emissive || ['r','g','b'].some(k=>!Number.isFinite(m.emissive[k]) || m.emissive[k]*m.emissiveIntensity!==0) || !Number.isFinite(m.emissiveIntensity) || ['clearcoat','sheen','iridescence','anisotropy','thickness','dispersion'].some(k=>m[k]!==undefined&&m[k]!==0) || m.specularIntensity!==undefined&&m.specularIntensity!==1 || m.specularColor&&['r','g','b'].some(k=>m.specularColor[k]!==1) || m.attenuationColor&&['r','g','b'].some(k=>m.attenuationColor[k]!==1) || m.attenuationDistance!==undefined&&m.attenuationDistance!==Infinity) throw Error('Unsupported active glass factors');
    seen.add(d.ar_source_component);
  }
  for(const o of meshes)o.castShadow=false;
  return {applied:meshes.length,uniqueGeometryObjects:new Set(meshes.map(o=>o.geometry.uuid)).size,scope:'Actual source-glass-only meshes. Constant camera-branch material mapping + white transparent shadow contract; no GI/solid-glass equivalence.'};
}
