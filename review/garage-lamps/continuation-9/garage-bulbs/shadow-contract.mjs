export const SOURCE_SHA256 = '6879ac01468bc99eb052928d5a4f6f1f3d1cbadec66ce13b9bf9088ad08e4456';
export const CONTRACT = 'source_IsShadowRay_white_Transparent:castShadow=false';
export const SOURCE_AUDIT_SHA256 = '0fd6fa2802c64f05acd50e0ae7dbd5018e8aef77a4041b6ca74b9a5458dec724';
// Validate the complete expected assembly before mutating any mesh.
export function applyBulbShadowContract(root, manifest, supportedExtensions) {
  if (!manifest || manifest.source_audit_sha256 !== SOURCE_AUDIT_SHA256 || !['05_GARAGE_L', '06_GARAGE_R'].includes(manifest.stem) || manifest.objects?.length !== 16)
    throw new Error('Invalid bulb assembly manifest');
  for (const ext of ['KHR_materials_transmission', 'KHR_materials_ior'])
    if (!supportedExtensions?.includes(ext)) throw new Error(`Unsupported ${ext}`);
  const expected = new Set(manifest.objects.map(x => x.source));
  if (expected.size !== 16) throw new Error('Duplicate manifest source');
  const first = manifest.stem === '05_GARAGE_L' ? 32 : 48;
  for (let i = first; i < first + 16; i++)
    if (!expected.has(`Left bulb.${String(i).padStart(3, '0')}`)) throw new Error('Unbacked bulb source');
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const targets = meshes.filter(o => expected.has(o.userData?.ar_source_component));
  if (targets.length !== 16) throw new Error('Missing or duplicate assigned bulb mesh');
  const seen = new Set();
  for (const o of targets) {
    const d = o.userData;
    if (seen.has(d.ar_source_component) || d.ar_source_sha256 !== SOURCE_SHA256 ||
        d.ar_wall !== manifest.stem || d.ar_shadow_contract !== CONTRACT || d.ar_shadow_contract_version !== 1 ||
        d.ar_source_subset !== 'historical_source_material:bulb' || d.ar_source_audit_sha256 !== SOURCE_AUDIT_SHA256)
      throw new Error('Invalid source-backed bulb metadata');
    seen.add(d.ar_source_component);
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (materials.length !== 1 || !materials[0] || materials[0].transmission !== 1 ||
        !Number.isFinite(materials[0].ior) || Math.abs(materials[0].ior - 1.333) > 1e-5 || materials[0].roughness !== 0 || materials[0].metalness !== 0 ||
        materials[0].opacity !== 1 || materials[0].transparent !== false || materials[0].side !== 2 || materials[0].alphaTest !== 0 ||
        ['r','g','b'].some(k => !Number.isFinite(materials[0].color?.[k]) || Math.abs(materials[0].color[k] - 0.8) > 1e-5))
      throw new Error('Invalid native bulb material');
  }
  // Reject incorrectly tagged controls rather than silently modifying their shadows.
  if (meshes.some(o => o.userData?.ar_shadow_contract && !targets.includes(o)))
    throw new Error('Unexpected shadow contract mesh');
  for (const o of targets) o.castShadow = false;
  return { applied: targets.length, untouched: meshes.length - targets.length };
}
