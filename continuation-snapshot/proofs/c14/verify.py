from pathlib import Path
import json,hashlib,numpy as np,collections,copy
B=Path(__file__).resolve().parent;C9=B.parents[1]/'continuation-9/garage-bulbs';plan=json.loads((B/'PLAN.json').read_text());audit=json.loads((C9/'SOURCE_AUDIT.json').read_text());wall=next(w for w in audit['walls']if w['stem']=='05_GARAGE_L');doc=json.loads((B/'left-lamp-materials.gltf').read_text());blob=(B/'left-lamp-materials.bin').read_bytes();build=json.loads((B/'BUILD_RESULT.json').read_text());assert hashlib.sha256((C9/'SOURCE_AUDIT.json').read_bytes()).hexdigest()==plan['C9_audit_sha256']
for name,h in build['files'].items():assert hashlib.sha256((B/name).read_bytes()).hexdigest()==h

def acc(d,b,i):
 a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];return np.frombuffer(b,dtype={5126:'<f4',5125:'<u4'}[a['componentType']],count=a['count']*{'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']],offset=v['byteOffset']).reshape(a['count'],-1).copy()
source_cache={};ref_cache={};boundary_checked=set()
def validate(d,b):
 assert len(d['nodes'])==48 and len(d['meshes'])==len(d['materials'])==3 and not d.get('images')and not d.get('textures');checks=[]
 for mi,family in enumerate(plan['families']):
  m=d['materials'][mi];c=build['materials'][family]['constants'];p=m['pbrMetallicRoughness'];assert m['extras']['source_family']==family and np.array_equal(p['baseColorFactor'],c['Base Color']) and p['metallicFactor']==c['Metallic'] and p['roughnessFactor']==c['Roughness'];assert m['extensions']['KHR_materials_ior']['ior']==c['IOR'] and m['extensions']['KHR_materials_transmission']['transmissionFactor']==c['Transmission Weight'] and m['extensions']['KHR_materials_emissive_strength']['emissiveStrength']==c['Emission Strength'] and m['emissiveFactor']==c['Emission Color'][:3];assert m['doubleSided']==build['materials'][family]['doubleSided'];ref=ref_cache.setdefault(family,np.load(B/(family+'-reference.npz')));pr=d['meshes'][mi]['primitives'][0];assert pr['material']==mi and pr['mode']==4;pa=acc(d,b,pr['attributes']['POSITION']);na=acc(d,b,pr['attributes']['NORMAL']);uv=acc(d,b,pr['attributes']['TEXCOORD_0']);uv[:,1]=1-uv[:,1];ix=acc(d,b,pr['indices']).ravel().reshape(-1,3);assert np.array_equal(ix,np.arange(len(pa)).reshape(-1,3))
  for node,source in zip(d['nodes'][mi*16:(mi+1)*16],wall['objects']):
   e=node['extras'];assert node['mesh']==mi and e['ar_source_component']==source['source'] and e['source_family']==family and e['ar_source_subset']=='historical_source_material:'+family and e['source_assigned_polygons']==plan['families'][family] and e['ar_source_sha256']==plan['source_sha256'] and e['ar_source_audit_sha256']==plan['C9_audit_sha256'] and e['ar_wall']=='05_GARAGE_L' and e['runtime_contract']=='C14_CONSTANT_SOURCE_SOCKETS_v1';z=source_cache.setdefault(source['source'],np.load(C9/source['source_geometry_dump']));assert hashlib.sha256((C9/source['source_geometry_dump']).read_bytes()).hexdigest()==source['source_geometry_dump_sha256'];ids=np.flatnonzero(z['material_indices']==source['source_effective_material_slots'].index(family));assert len(ids)==plan['families'][family] and set(ref['polygon_ids'])==set(ids)
   for face in ([] if (family,source['source']) in boundary_checked else ids):
    tri=ref['loop_ids'][ref['polygon_ids']==face];start=int(z['polygon_starts'][face]);total=int(z['polygon_totals'][face]);assert len(tri)==total-2;poly=list(range(start,start+total));assert set(tri.ravel())==set(poly);edges=collections.Counter((int(t[i]),int(t[(i+1)%3]))for t in tri for i in range(3))
    for edge in list(edges):
     rev=edge[::-1];n=min(edges[edge],edges[rev]);edges[edge]-=n;edges[rev]-=n
    assert +edges==collections.Counter((poly[i],poly[(i+1)%total])for i in range(total))
   boundary_checked.add((family,source['source']));loops=ref['loop_ids'];ep=z['positions'][z['loop_vertices'][loops]];en=z['corner_normals'][loops];eu=z['uv_UVMap'][loops];assert np.array_equal(pa[ix],ep.astype('<f4')) and np.array_equal(na[ix],en.astype('<f4'));assert np.abs(uv[ix]-eu).max()<2e-6;S=np.array([[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]],float);mat=np.linalg.inv(S)@np.array(node['matrix']).reshape(4,4).T;orig=np.array(source['normalized_source_matrix']);assert np.array_equal(mat,orig);we=float(np.abs((pa[ix]@mat[:3,:3].T+mat[:3,3])-(ep@orig[:3,:3].T+orig[:3,3])).max());nt=np.linalg.inv(mat[:3,:3]).T;gn=na[ix]@nt.T;sn=en@nt.T;gn/=np.linalg.norm(gn,axis=2)[:,:,None];sn/=np.linalg.norm(sn,axis=2)[:,:,None];ne=float(np.abs(gn-sn).max());assert we<2e-6 and ne<2e-6;checks.append({'source':source['source'],'family':family,'polygons':len(ids),'triangles':len(ix),'local_position_max':float(np.abs(pa[ix]-ep).max()),'raw_normal_max':float(np.abs(na[ix]-en).max()),'UV_max':float(np.abs(uv[ix]-eu).max()),'world_position_max':we,'world_unit_normal_max':ne})
 return checks
checks=validate(doc,blob);negative=[]
def reject(name,d,b=blob):
 try:validate(d,b)
 except (AssertionError,KeyError):negative.append(name)
 else:raise AssertionError('Accepted '+name)
for name,op in [('wrong_family',lambda d:d['nodes'][0]['extras'].update(source_family='bulb')),('wrong_emission_strength',lambda d:d['materials'][1]['extensions']['KHR_materials_emissive_strength'].update(emissiveStrength=1)),('wrong_roughness',lambda d:d['materials'][2]['pbrMetallicRoughness'].update(roughnessFactor=0)),('wrong_transform',lambda d:d['nodes'][0]['matrix'].__setitem__(12,.9))]:
 bad=copy.deepcopy(doc);op(bad);reject(name,bad)
pr=doc['meshes'][0]['primitives'][0]
for name,key in [('position','POSITION'),('normal','NORMAL'),('UV','TEXCOORD_0')]:
 bad=bytearray(blob);a=doc['accessors'][pr['attributes'][key]];off=doc['bufferViews'][a['bufferView']]['byteOffset'];v=np.frombuffer(bad,dtype='<f4',count=1,offset=off)[0];bad[off:off+4]=np.array([v+.01],'<f4').tobytes();reject(name,doc,bad)
bad=bytearray(blob);off=doc['bufferViews'][doc['accessors'][pr['indices']]['bufferView']]['byteOffset'];bad[off:off+12]=np.array([0,2,1],'<u4').tobytes();reject('reversed_winding',doc,bad)
result={'status':'PASS_EXACT_ALL_ONLY_SOURCE_FAMILY_GEOMETRY_NORMALS_UV_WINDING_WORLD_AND_CONSTANT_SOCKETS','checks':checks,'negative_controls_rejected':negative,'limits':plan['limits']};(B/'VERIFICATION.json').write_text(json.dumps(result,indent=2));print(result['status'])
