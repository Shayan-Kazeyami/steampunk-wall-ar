# C13 source coverage and final lane review

Refreshed from current lane reports on 2026-10-29. The adjacent JSON contains the 32 source NPZ hash checks and actual harness hash comparisons.

## Source audit

- All 32 fresh C9 source NPZs match the audit SHA-256 entries.
- Each source lamp has 6,141 faces: bulb 592, glass 1,088, plastic 2,640, Emission 1,200, silver 621; black metal has 0. C11 Right and C12 Left repairs remain separately pinned.

## Final C13 results

- **Left glass: PASS within scope.** 16 source-assigned subsets, 17,408 faces; exact source positions/raw normals/UVs and zero world/C9-frame error. Hardened CPU fixtures reject 29 runtime cases; browser proof rejects 6 cases, shows 19,073 visible-vs-empty and 19,041 wrong-transmission witness pixels, and restores exactly.
- **Right materials and assembly: PASS within scope.** 48 plastic/Emission/silver bindings; 17 owner CPU controls and 33 independent fail-closed controls. Family browser witnesses restore exactly. Five-family partition covers all 6,141 faces for each of 16 lamps; assembly browser confirms 80 meshes, 193,920 triangles, 20 unique geometry objects, 5 materials, and zero alignment error.
- Right UV max error is `2.9802322387695312e-08` from the V-flip; position, raw normal, world position, and world-unit-normal maxima are zero.

**Open:** C11 empty-reference shadow receiver guard remains FAILED. These results do not claim shadow/GI, complete Principled, full-wall, phone, or print equivalence. Emission remains surface radiance only.
