"""Reconcile C13-owned context, retaining the independent C9 coordinator's text."""
from pathlib import Path
import json
import re

B=Path(__file__).resolve().parent
AR=B.parents[4]
PRINT=Path(r'D:\Shayan\Projects\Wall-Print-Steampunk')
result=json.loads((B/'CONTINUATION_RESULT.json').read_text())
assert result['status']=='PASS_PRIVATE_LEFT_GLASS_RIGHT_THREE_MATERIALS_AND_FIVE_FAMILY_LAMP_RUNTIME_ASSEMBLY'
block='''<!-- C11_LATEST_CONTEXT_START -->
## Latest saved context — C13, 29 October 2026

[Resume checkpoint](CONTEXT_CHECKPOINT_2026-10-29.md) · [C13 results](C13_GARAGE_RUNTIME_MATERIALS_2026-10-29.md) · [source material integrity](SOURCE_MATERIAL_INTEGRITY_2026-10-28.md)

C13 completes Left source-glass stems (255,537 bytes) and Right plastic/Emission/silver components (998,431 bytes), with source geometry, bounded constant camera-material mappings, strict rejection controls and hardware-browser proof. The Right runtime preview combines all five source-assigned families for 16 lamps: complete disjoint coverage of 98,256 source polygons, 80 meshes, five materials and 193,920 triangles. All component origins align exactly. Prior C11/C12 House motion and lamp assignment repairs remain retained.

The C11 empty-reference shadow guard remains FAILED. Source-solid refraction, radiance/GI, overall shadows, complete walls, phones and physical-print AR acceptance remain open. Both Garages stay inactive. Counts: 43 total / 15 complete at stated scope / 27 open / 1 merged. C13 owned workers closed, no automatic queue. C9 retains separate ownership; check actual processes/queues. Source/backups, verified prints, App and Publishing are preserved.

<!-- C11_LATEST_CONTEXT_END -->'''
for name in ['START_HERE.md','CURRENT_WORK.md','DECISIONS.md']:
 p=AR/'Handover'/name;stamp=p.stat().st_mtime_ns;content=p.read_text(encoding='utf-8')
 content,n=re.subn(r'<!-- C11_LATEST_CONTEXT_START -->.*?<!-- C11_LATEST_CONTEXT_END -->',lambda m:block,content,count=1,flags=re.S)
 assert n==1 and p.stat().st_mtime_ns==stamp,name
 p.write_text(content,encoding='utf-8')
p=AR/'Handover/TASK_OVERVIEW.md';content=p.read_text(encoding='utf-8')
rows={
'Garage Left':'| Garage Left | C12 source assignments repaired on 16 lamps, other 3,417 meshes/clock retained as-is. C13 actual glass stem component: 255,537 bytes, source CPU and hardened hardware-runtime proof pass. | Left plastic/Emission/silver runtime routes, remaining wall source fidelity and assembly, actual shadow/GI, full-wall/device validation. |',
'Garage Right':'| Garage Right | C11 assignment repair retained. C13 plastic/Emission/silver plus existing genuine bulb/glass form a five-family 16-lamp runtime preview: 98,256 source polygons, 80 meshes, 193,920 triangles, exact origin alignment; CPU/hardware proof passes. | Failed C11 shadow guard, solid refraction/radiance/GI, remaining wall materials/clock integration and complete-wall/device acceptance. |'}
for name,row in rows.items():
 content,n=re.subn(r'^\| '+re.escape(name)+r' \|.*$',lambda m:row,content,flags=re.M);assert n==1,name
content=content.replace('C12 actual source-assigned glass stems now have scoped CPU/hardware runtime proof; earlier no-glass disposition applies only to faulty retained captures.','C13 adds source-assigned Left glass, Right remaining lamp materials and a five-family Right lamp runtime assembly preview; earlier no-glass disposition applies only to faulty retained captures.')
content=content.replace('the latest C12 checkpoint.','the latest C13 checkpoint.')
p.write_text(content,encoding='utf-8')
p=AR/'Handover/CONTEXT_CHECKPOINT_2026-10-29.md'
archive=AR/'Handover/CONTEXT_CHECKPOINT_C12_2026-10-29.md'
if not archive.exists():archive.write_bytes(p.read_bytes())
p.write_text('''# Resume checkpoint — C13, 29 October 2026

Read AGENTS.md, START_HERE.md, CURRENT_WORK.md and STATUS.json first. Actual AR work is in this project. Print production is complete in D:/Shayan/Projects/Wall-Print-Steampunk; never restart it or overwrite source/verified print artifacts during AR work. Historical junctions are aliases; use canonical paths.

Latest completed private batch: [C13 Garage runtime materials](C13_GARAGE_RUNTIME_MATERIALS_2026-10-29.md). [Machine result](../Models/delivery-wave-2026-10-26/reconstruction/continuation-13/coordination/CONTINUATION_RESULT.json). Left glass is source-assigned inner stems, 16 nodes/one mesh/255,537 bytes. Right plastic/Emission/silver: 48 nodes/three meshes/998,431 bytes. Both have source CPU and actual RTX5060Ti/D3D11 hardware proof with current harness hashes. Right UV roundtrip max2.98e-8; position/rawnormal/world/unitnormal errors0. Right complete lamp preview combines genuine C9 bulb + C12 glass + new3families: 16 source lamps/80meshes/5materials/20geometryobjects/193,920tri, exact origins. All98,256 source polygons form a disjoint complete partition. This is a runtime preview, not a complete-wall model or merged single asset.

Strict contracts reject unexpected texture maps, alpha/material classes, altered manifests/source roles and extra active factors. Left CPU29/browser6 controls; Right CPU17 plus independent33 controls, and geometry/material mutation checks. Every invalid fixture preserves shadow flags. Earlier successful harness snapshots are archived; current evidence is required. Source Emission strength20,000 remains unchanged; standard native emissive surfaces do not reproduce source GI illumination.

The C11 empty-reference shadow guard remains FAILED. No source-solid-glass refraction, full Principled/radiance/GI/actual-shadow equivalence, whole-wall, phone or physical-print AR acceptance is established. Both Garages remain inactive. Counts43total/15scopedcomplete/27open/1merged.

Prior results retained: C11 House thinpipe/valve/plaque plus proposed ±15degree motion; C11Right/C12Left16lamp source assignment repairs. Other3,417 Left meshes and originalclock were retained as-is, not proved historical-source faithful. Read [C12 checkpoint archive](CONTEXT_CHECKPOINT_C12_2026-10-29.md) and [source material integrity](SOURCE_MATERIAL_INTEGRITY_2026-10-28.md). Old capture-only zero-glass and uniform lamp assignments do not establish original-source fidelity. Per original lamp: bulb592/glass1088/plastic2640/Emission1200/silver621. Glass is internalstem; outerenvelope is bulb.

Next: Left plastic/Emission/silver runtime routes and full lamp assembly; remaining whole-wall source fidelity/materials/clock integration across Garages; House/Narrow/Left/Right remaining appearance/components; real phones, tracking/performance/heat, grey connectors, other devices and physical-print alignment/colour. Do not claim component passes close these full-scope tasks.

C9 is a separate active coordinator. Preserve its queue/results and shared handover blocks; check actual processes and queues before heavy jobs. C13 owned Blender/browser/server workers are closed, no automatic queue. One heavy GPU job and one writer per file. User requests parallel Sol technical work/Luna bounded review; respect effective live slots. Do not terminate unrelated workers. Both C13 extractions were read-only/no bake; RAM launch guards remain12GiB. A refused launch did not start a worker.

Use historical baseline Models/source-baselines/v79-6879ac01468b/steampunk_V79.blend SHA2566879ac01468bc99eb052928d5a4f6f1f3d1cbadec66ce13b9bf9088ad08e4456. Current named print V79 differs and remains preserved. Preserve preexisting App changes and Publishingff3f90646a7c888de9470d252b64ded47f3febc4/bundle71a25712. Run python output/scripts/update_handover.py from print root after meaningful status changes.
''',encoding='utf-8')
p=PRINT/'Handover/START_HERE.md';content=p.read_text(encoding='utf-8')
if '<!-- C13_SUMMARY -->' not in content:
 content+='\n\n<!-- C13_SUMMARY -->\nC13 (29 October): Left source-glass and Right plastic/Emission/silver runtime components pass source CPU and hardware checks; a Right preview assembles all five source families across 16 lamps. C11 failed shadow guard, full-wall, GI, phone and physical-print AR gates remain open. Print production remains complete; original/verified assets preserved. [C13 handover](D:/Shayan/Projects/Upwork/Steampunk-AR/Handover/C13_GARAGE_RUNTIME_MATERIALS_2026-10-29.md). Owned C13 workers closed; check separate C9 activity before launch.\n'
p.write_text(content,encoding='utf-8')
print('C13 context updated; C12 checkpoint archived and concurrent C9 blocks retained.')
