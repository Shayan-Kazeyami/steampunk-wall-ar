# C14 — Left lamp assembly, context and GitHub review

Sol completed the Left lamp material components, Terra prepared and hardware-checked the portable GitHub package, and Luna independently reviewed source coverage and evidence. Task counts remain **43 total / 15 complete at stated scope / 27 open / 1 merged**. [Machine result](../Models/delivery-wave-2026-10-26/reconstruction/continuation-14/coordination/CONTINUATION_RESULT.json).

## Left lamp components

The new package contains all and only the historical-source plastic, Emission and silver faces for 16 Left lamp objects `.032`–`.047`. The input is the pinned C12 repaired Left capture, not the distinct Right capture. Fresh source graph and live loaded material checks establish constant Principled camera-material factors with no active texture, volume or displacement links. Emission's Blackbody node is disconnected; its actual strength20,000 remains unchanged.

The package has 48 nodes, three shared meshes, 71,376 source polygons and 140,160 instanced triangles (8,760 unique). Payload is **1,005,015 bytes**: `left-lamp-materials.gltf` plus `left-lamp-materials.bin`. Source positions, raw normals, winding, world positions and unit normals pass strict independent checks, with measured position/normal/world errors zero. The V-coordinate roundtrip UV error is at most 2.98e-8. Eight geometry/material mutation controls reject. The runtime contract rejects 21 invalid fixtures, including wrong Left wall/audit/source identities, texture/alpha/material-class substitutions, extra active material factors and altered source manifests. Every invalid fixture preserves all shadow flags.

Hardware checks on RTX5060Ti/D3D11 pass for all three families. Visible-versus-empty witnesses are plastic2,240 / Emission13,950 / silver452,651 pixels; each restores pixel-exactly. Browser/HTTP errors are zero. Root and Sol reviewed the complete-lamp close view.

The Left assembly preview combines genuine C9 bulb, C13 Left glass and the three new families. Every source lamp has a disjoint complete partition of 6,141 polygons: bulb592 / glass1088 / plastic2640 / Emission1200 / silver621. All **98,256 source polygons** are accounted for. Runtime traversal measures 80 meshes, five materials, 20 geometry objects and 193,920 triangles. All 16 component origins align exactly. The combined Left model payload is 4,979,796 bytes, excluding shared runtime/environment assets.

[Left result](../Models/delivery-wave-2026-10-26/reconstruction/continuation-14/left-lamp-materials/RESULT.json) · [Source proof](../Models/delivery-wave-2026-10-26/reconstruction/continuation-14/left-lamp-materials/VERIFICATION.json) · [Assembly proof](../Models/delivery-wave-2026-10-26/reconstruction/continuation-14/left-lamp-materials/ASSEMBLY_BROWSER_RESULT.json)

## GitHub package

Target repository is the existing public [steampunk-wall-ar](https://github.com/Shayan-Kazeyami/steampunk-wall-ar), on the separate `continuation-14/context-upload` review branch. The isolated checkout starts from main `ff3f90646a7c888de9470d252b64ded47f3febc4`. App and Publishing working trees are preserved. Main and deployed content are outside this upload's mutation scope.

`review/garage-lamps` contains portable Left/Right five-family previews, unchanged pinned derivative model assets/contracts, local runtime/environment dependencies, provenance and hardware proof. Four HTML/pin files deliberately use relative URLs; their canonical and portable hashes are recorded separately. The rewritten copies themselves pass hardware checks for both sides: 80 meshes, five families ×16, 193,920 triangles, valid contracts, exact component origins and zero browser/HTTP errors. Server/browser closure is recorded. A normal repository-root localhost server can run the preview pages. The archived checker records its original execution layout; it is not the demo entry point.

`continuation-snapshot` is a **partial development source archive**, not an installable release. It records App base `14beeb1364e7b47aa4afe78d6ecbb5773c89416f`, tracked-source patch, selected untracked source/tests, current context and C13/C14 evidence. Generated docs, large development GLBs, dependencies, source blends, original textures and verified print delivery are excluded. Public README/manifests describe those omissions; do not overlay the snapshot onto main as a release without integration review.

An isolated overlay build passes with webpack performance warnings; 34 offline checks pass. The full-wall suite is **incomplete** because required sibling model/coverage fixtures are outside the bounded snapshot. It is not reported as a full regression pass. Credential-pattern scans found no hits, and explicit package review excludes original/source blends, print outputs and credentials. Remote main has no root GitHub workflow; no root workflow or Pages configuration is added. Pages server settings were not independently readable.

<!-- C14_GITHUB_RECEIPT_START -->
GitHub package is locally prepared and checked. Actual push and draft-PR receipt are pending final upload.
<!-- C14_GITHUB_RECEIPT_END -->

## Limits and next work

This is source geometry plus bounded constant camera-material mapping and runtime assembly evidence. It does not establish complete Principled/PBR equivalence, solid refraction, radiance, source GI or actual-shadow equivalence. Native emissive surfaces do not illuminate neighboring geometry through source GI. The C11 predeclared empty-reference shadow guard remains **FAILED**, with no threshold relaxation. Both Garages remain inactive; full-wall materials/appearance, clocks and other components, phones/performance/tracking, grey connectors, other devices and physical-print AR checks remain open.

The initial Left contract fixture exposed nonnumeric source-ledger order; exact set membership fixed that fixture without model changes, and the failure is retained. No bake or completed print production was restarted. Final preservation comparison covers 50 protected files' metadata, App dirty tracked-file hashes/status and Publishing status/commit; this is continuity evidence, not renewed print content QA. Owned bounded Blender/browser/server workers are closed. Other C9 work retains separate ownership and queue; check actual processes before future launches.
