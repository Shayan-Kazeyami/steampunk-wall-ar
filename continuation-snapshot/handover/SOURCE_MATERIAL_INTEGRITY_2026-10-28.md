# Source material integrity — 28 October 2026

**Capture code fixed; existing capture material assignments remain held.**

The evaluated mesh copy contained correct per-face material indices. Replacing its
material table with `mesh.materials.clear()` erased the `material_index` attribute;
reappending the material slots left every polygon using slot zero. Both installed
Blender source tracing and 12 real installed-Blender tests confirm this mechanism.
The minimal production fix snapshots, restores and validates face indices and
effective material identities, including object overrides and empty/null slots.
No original source, old capture or verified print artifact was rewritten.

- [Cause, original backup, patch and regression evidence](../Models/delivery-wave-2026-10-26/reconstruction/continuation-9/capture-material-diagnosis/ROOT_CAUSE.md)
- [Independent fix approval](../Models/delivery-wave-2026-10-26/reconstruction/continuation-9/review/capture-fix-review.json)
- [Fresh original Garage source audit](../Models/delivery-wave-2026-10-26/reconstruction/continuation-9/garage-bulbs/SOURCE_AUDIT.json)
- [Current acceptance holds](../Models/delivery-wave-2026-10-26/reconstruction/continuation-9/coordination/SOURCE_MATERIAL_HOLD.json)

## Confirmed examples

| Audited source geometry | Actual source assignments | Faulty retained assignments |
|---|---|---|
| Left Boundary.031 / Right Boundary.005 | Each 72 bronze +36 dark metal | Each all108 bronze |
| Each of32 original Garage lamp objects | 592 bulb,1088 glass,2640 plastic,1200 Emission,621 silver | All6141 bulb |

Each Garage therefore has **9472 genuine bulb polygons and17408 genuine glass
polygons** in these16 audited lamp objects. The earlier capture-only zero-glass
finding does not describe the original source. Original glass and other lamp
materials remain required under T21.

## Safe current scope

Four source-checked native bronze objects per Left/Right wall pass. Their corrected
source denominators cover only the five audited canonical-native candidates; full
source-wall material-family coverage is not established. The mixed objects remain
excluded. Corrected C9 Garage bulb-subset candidates include only the genuine
592 bulb faces per lamp; old whole-object bulb candidates remain preserved and
rejected as source-faithful routes. Their browser helper rejects the old routes.

House proposed-motion browser checks preserve the C8 neutral candidate. They do
not establish original-source material fidelity for the entire wall. C9/C10 full
Garage checkpoints retain structural evidence against old captures; that is not
original-source per-face material approval. Single-material components with fresh
source proof are not automatically invalidated.

Next: regenerate or repair affected captures privately with source per-polygon
semantic proof, preserving old snapshots and geometry evidence. Do not restart a
completed print or whole-wall bake pipeline. Glass/plastic/emission/silver routes,
complete-wall appearance, native phone and physical-print AR acceptance remain open.
