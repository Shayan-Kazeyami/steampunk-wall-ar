"""Require actual C13 proofs, fresh browser hashes, reviews and continuity guard."""
from pathlib import Path
import datetime
import hashlib
import json
import subprocess

B = Path(__file__).resolve().parent
C = B.parent
AR = B.parents[4]
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def sha(p):
    with p.open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()
def passed(p):
    d = read(p)
    assert d['status'].startswith('PASS') and 'PENDING' not in d['status'].upper(), (str(p),d['status'])
    return d
def check_pinned_records(value):
    if isinstance(value,dict):
        if {'path','sha256','bytes'} <= value.keys():
            p=Path(value['path'])
            assert p.stat().st_size==value['bytes'] and sha(p)==value['sha256'],str(p)
        for v in value.values(): check_pinned_records(v)
    elif isinstance(value,list):
        for v in value: check_pinned_records(v)
left = passed(C/'left-glass/RESULT.json')
right = passed(C/'lamp-materials/RESULT.json')
lp = passed(C/'left-glass/VERIFICATION.json')
rp = passed(C/'lamp-materials/VERIFICATION.json')
lb = passed(C/'left-glass/BROWSER_RESULT.json')
rb = passed(C/'lamp-materials/BROWSER_RESULT.json')
assembly = passed(C/'lamp-materials/ASSEMBLY_BROWSER_RESULT.json')
partition = passed(C/'lamp-materials/ASSEMBLY_SOURCE_PROOF.json')
assert left['model_payload_bytes'] == 255537 and lp['source_assigned_glass_polygons'] == 17408
assert lp['instanced_triangles'] == 34816 and len(rp['checks']) == 48
assert max(x['world_position_max'] for x in rp['checks']) == 0
assert max(x['world_unit_normal_max'] for x in rp['checks']) == 0
assert lb['restored_pixels_exact'] and not lb['applicationErrors'] and not lb['httpErrors']
assert rb['diagnostics']['meshes'] == 48 and rb['diagnostics']['triangles'] == 140160
assert not rb['applicationErrors'] and not rb['httpErrors']
assert set(rb['family_visible_witnesses'])=={'plastic','Emission','silver'}
assert all(v['restored_exact'] and v['visible_vs_empty_pixels_above5']>100 for v in rb['family_visible_witnesses'].values())
assert assembly['closure']['meshCount'] == 80 and len(partition['checks']) == 16
assert all(x['complete_disjoint_source_polygon_partition'] for x in partition['checks'])
assert not assembly['applicationErrors'] and not assembly['httpErrors']
for name,digest in left['evidence_sha256'].items(): assert sha(C/'left-glass'/name) == digest,name
for name,digest in right['evidence_sha256'].items(): assert sha(C/'lamp-materials'/name) == digest,name
for filename,report in [('left-glass/BROWSER_RESULT.json',lb),('lamp-materials/BROWSER_RESULT.json',rb)]:
    folder=(C/filename).parent
    for name,digest in report['harness_hashes'].items(): assert sha(folder/name) == digest,name
for url,digest in assembly['artifact_pins'].items(): assert sha(AR/url.lstrip('/')) == digest,url
assert 'harness_hashes' in assembly, 'Assembly must pin its current HTML/checker'
for name,digest in assembly['harness_hashes'].items(): assert sha(C/'lamp-materials'/name) == digest,name
worker_paths=['left-glass/build-worker.json','left-glass/browser-worker.json','lamp-materials/build-worker.json','lamp-materials/browser-worker.json','lamp-materials/assembly-browser-worker.json']
for name in worker_paths:
    w=read(C/name)
    assert w['status']=='EXITED',name
    if 'browser_exit' in w: assert w['browser_exit']==0 and w['server_closed'],name
    else: assert w['exit_code']==0,name
reviews={n:passed(C/'inventory'/n) for n in ['LEFT_GLASS_REVIEW.json','RIGHT_MATERIALS_REVIEW.json','RESULT.json']}
for review in reviews.values(): check_pinned_records(review)
tech=passed(C/'left-glass/RIGHT_MATERIALS_TECHNICAL_REVIEW.json')
shadow=read(C.parent/'continuation-11/garage/SHADOW_RESULT.json')
assert shadow['status']=='FAIL_PREDECLARED_SHADOW_WITNESS'
subprocess.run(['python',str(B/'preservation.py'),'--compare'],check=True)
pres=passed(B/'preservation-after.json')
files={p.relative_to(C).as_posix():dict(bytes=p.stat().st_size,sha256=sha(p)) for p in [C/'left-glass/left-glass.gltf',C/'left-glass/left-glass.bin',C/'lamp-materials/right-lamp-materials.gltf',C/'lamp-materials/right-lamp-materials.bin']}
assert sum(x['bytes'] for k,x in files.items() if k.startswith('lamp-materials/'))==998431
result=dict(dateLocal='2026-10-29',updatedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
 status='PASS_PRIVATE_LEFT_GLASS_RIGHT_THREE_MATERIALS_AND_FIVE_FAMILY_LAMP_RUNTIME_ASSEMBLY',
 summary='Left actual glass stems and Right plastic/Emission/silver subsets pass source geometry, bounded constant camera-material mapping, rejection controls and hardware checks. Right runtime preview combines all five source-assigned families for all sixteen lamps with complete disjoint source coverage. Overall shadow/GI, full-wall and phone acceptance remain open.',
 LeftGlass=dict(nodes=16,sourcePolygons=17408,uniqueTriangles=2176,instancedTriangles=34816,bytes=255537),
 RightMaterials=dict(families=['plastic','Emission','silver'],nodes=48,sourcePolygons=71376,sharedMeshes=3,uniqueTriangles=8760,instancedTriangles=140160,bytes=998431,measuredLocalAndWorldErrors='See lamp-materials/VERIFICATION.json'),
 RightAssembly=dict(sourceLamps=16,families=5,meshes=80,sourcePolygons=98256,scope='Runtime assembly preview of independently source-verified subsets; not a full-wall model or GI/shadow/radiance equivalence result'),
 files=files,reviews={n:d['status'] for n,d in reviews.items()},technicalReview=tech['status'],
 evidence=dict(left='left-glass/RESULT.json',right='lamp-materials/RESULT.json',assembly='lamp-materials/ASSEMBLY_BROWSER_RESULT.json',coverage='lamp-materials/ASSEMBLY_SOURCE_PROOF.json',inventory='inventory/RESULT.json',preservation='coordination/preservation-after.json',handover='Handover/C13_GARAGE_RUNTIME_MATERIALS_2026-10-29.md'),
 evidenceSha256={str(p.relative_to(C)):sha(p) for p in [C/'left-glass/RESULT.json',C/'lamp-materials/RESULT.json',C/'lamp-materials/ASSEMBLY_BROWSER_RESULT.json',C/'inventory/LEFT_GLASS_REVIEW.json',C/'inventory/RIGHT_MATERIALS_REVIEW.json',C/'inventory/RESULT.json']},
 taskCounts=dict(total=43,completeAtStatedScope=15,openIncludingT21=27,merged=1),activeOwnedWorkers=[],
 shadowWitnessAccepted=False,fullWallAccepted=False,phoneAccepted=False,actualPrintARAccepted=False,
 preservation=dict(status=pres['status'],protectedMetadataFiles=len(pres['protectedMetadata']),publishingHead=pres['publishingHead'],scope=pres['scope']),
 limits=['Constant source camera-material factors only; no full Principled/solid-refraction/radiometric/GI equivalence.','Native emissive surfaces do not provide source GI illumination of neighboring objects.','C11 empty-reference shadow guard remains FAILED.','Both Garages inactive; complete walls, Left remaining three material routes, phones and physical-print AR acceptance remain open.','Shared runtime/environment excluded from model payload; no phone resource budget approval.'])
(B/'CONTINUATION_RESULT.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
for name in ['PROGRESS.json','HEAVY_QUEUE_REQUEST.json']:
 d=read(B/name);d.update(status=result['status'],activeOwnedWorkers=[],finalResult='coordination/CONTINUATION_RESULT.json')
 if name.startswith('HEAVY'): d.update(next=[],coordination='C13 complete; owned jobs closed, slot released. No automatic queue. C9 retains separate ownership.')
 (B/name).write_text(json.dumps(d,indent=2),encoding='utf-8')
p=AR/'Models/CONTINUATION_STATUS.json';stamp=p.stat().st_mtime_ns;status=read(p)
status['continuation13']=result
status['latest_supplement']=dict(path=result['evidence']['handover'],status=result['status'],summary=result['summary'])
status['latest_context']=dict(path='Handover/CONTEXT_CHECKPOINT_2026-10-29.md',dateLocal='2026-10-29',continuation=13)
assert p.stat().st_mtime_ns==stamp,'Concurrent edit; rerun merge'
temp=p.with_suffix('.c13.tmp');temp.write_text(json.dumps(status,indent=2),encoding='utf-8')
assert p.stat().st_mtime_ns==stamp,'Concurrent edit; rerun merge'
temp.replace(p)
print(json.dumps(dict(status=result['status'],reviews=result['reviews'],files=files),indent=2))
