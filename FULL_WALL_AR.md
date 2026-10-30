# Full source-derived Driveway AR extension

Status on 23 October 2026: [full-wall AR entry published](https://shayan-kazeyami.github.io/steampunk-wall-ar/ar/)
at commit `b73656fac0727b390552e69c265ce527bb4ebd2c`. Recorded production build,
HTTPS file hashes and desktop camera-free preview pass for that revision.
An earlier revision received the user's basic "works" smoke confirmation; this
does not establish phone acceptance of the adaptive revision. Physical print
alignment and measured Android performance remain pending.
The already published [interactive Driveway viewer](https://shayan-kazeyami.github.io/steampunk-wall-ar/experience/)
is a separate camera-free experience. The accepted Garage demo at the site root
remains a separate delivery.

Driveway uses the normalized `driveway-adaptive.glb`, containing 2,061,483 triangles
and 27,154,392 bytes. Its SHA256 is
`4ed8086fd426cae2e5b57349367459b77a5b5ccfbc901b2514fef65d85f63534`.
The earlier `driveway-polished.glb` remains preserved. The source-derived model has 20 gear pivots,
four valve wheels, three pressure needles, four lamp lenses and one signboard
anchor. Foreground base colour is 4096 × 4096, normal/ORM are 2048 × 2048 and
emission is 1024 × 1024. Its separate 4096 × 1812 wall backing is a static source
beauty render with baked lighting/shadows; it does not recompute those shadows
when the foreground lighting changes. The original packed dial artwork is
reprojected onto a separate full-face 1024 x 1024 UV texture; housings and needles
use solid material colours. The remaining wall atlas is unchanged.

Each of the three pressure needles uses the original artwork's seven printed
marks from 0 to 30. Independent, damped simulated readings settle at 12/15/18
during idle and 24/27/29 during Overdrive. These are simulated readings without a
physical pressure sensor or an invented pressure unit.

The full-wall effects combine contact-based gear direction/speed relationships,
valve motion, localized steam leaks, pressure needle movement, warm blinking
lamps and attached sign-edge illumination. Real CC0 Poly Haven Studio Small 09
HDRI data is decoded and PMREM-convolved for reflections. A small attached light
rig illuminates the geometry. A bounded camera-lighting estimate samples a
16 x 16 RGB feed at most five times per second, prefers native engine exposure,
and smooths brightness/tint with a studio fallback. No second camera stream,
pixel storage or uploads are used. This estimates ambient appearance rather than
reconstructing directional lights or camera-derived HDRI reflections. Source
teeth counts/phases are unavailable, so
gear contact radii and relationships are inferred from existing geometry rather
than validated mechanical constraints. Pressure and leaks are simulated.

## Placement and loading

The model is normalized to a full-panel width of 1 in its authored XY plane,
with positive Z toward the viewer. The tracking adapter owns the crop-to-panel
transform; the effects group does not apply it a second time. For tracked crop
width `w`, panel pixels `Pw × Ph`, and source crop `[cx, cy, cw, ch]`, the adapter
uses `scale = w × Pw / cw`,
`x = w × (Pw / 2 − cx − cw / 2) / cw`, and
`y = w × (cy + ch / 2 − Ph / 2) / cw` before calibration adjustments.
Driveway's panel is 2763 × 1222 pixels; its crop is `[741, 131, 1280, 960]`.
Calibration is provisional: no phone-measured rotation, mirror, offset or corner
alignment is established. Compiled target storage rotation is not a measured
camera-pose correction.

The loader uses the existing A-Frame GLTF/Draco infrastructure and existing
renderer. Startup preloads and shares one in-flight model decode, awaits HDRI
readiness, and performs a 4 x 4 offscreen GPU warm-up before camera startup.
The decoded model stays available through Stop and preview changes. A canceled
consumer cannot cancel the shared preload or install stale effects; final teardown
aborts owned work and disposes model, textures, effect pools, audio and lighting.
Coordinator epochs reject outdated results. Preview and image tracking share the
same normalized geometry. Recorded desktop browser diagnostics showed one GLB
request and assets ready/GPU warmed before Start; phone loading latency and
sustained memory use have not been measured.

## Controls and lifecycle

Start requests camera tracking. Preview animation shows the full wall without
camera access. Cancel and Stop camera cancel startup or return to Start. Reset
resets the machinery and turns sound off. Overdrive lasts three seconds and
repeated activation restarts that interval. Reduced motion stops animated effects.

Sound is synthesized mechanical hum, ticks and steam hiss. It is off by default,
appears only when available, and can start only from an explicit sound-button
press while tracked or in preview. Pending audio enable requests are invalidated
on Stop, tracking loss, hidden pages and teardown. Reacquisition or page return
does not automatically restart sound. Browser audio failures remain retryable.
The UI extension preserves the original shared spec and legacy control contract.

Tracking loss hides and resets effects. Hidden-page and persisted-page transitions
cancel stale operations; returning from the page cache returns to a safe state.
Owned geometry/materials/textures are disposed once, and environment/renderer
settings are restored where appropriate. These lifecycle claims have focused
offline tests; browser and real-camera observations remain separate evidence.

## Verification and remaining acceptance

Use the locked Node 22.23.4 toolchain and isolated verification dependencies:

```sh
npm ci --prefix tools/verification --ignore-scripts --no-audit --no-fund
npm test
npm run test:full-wall
npm run build
```

The full-wall runner executes seven independent test modules sequentially for
effects, UI, tracking transforms, model loading, coordinator behavior, adaptive
camera/gauge/GPU state, and environment-lighting recovery. It uses
the same Node executable for every module and fails rather than skipping checks.
Baseline and full-wall tests use independent Three r158 and JSDOM with mocked
XR/renderer/clock dependencies. A successful production build validates actual
imports and assets; it is not a camera or phone-performance result.

CI runs baseline and full-wall regressions, builds production assets, and runs the
static path/notices/pinned-input checks against a temporary copy of the build.
It does not replace the repository's `docs` directory or publish files. Preserve
the separate root demo, `/experience/` and `/ar/` routes when staging a release;
the historical `build:pages` helper replaces `docs` and is unsuitable for the
current multi-route publication checkout. Publication remains a separate,
allowlisted operation with independent asset readback.

Physical midrange Android loading time, FPS, memory, heat, on-device sound quality,
camera permissions, print acquisition/reacquisition, pose stability and corner
alignment remain pending. The 2.06-million-triangle/27 MB model is not a measured
mobile budget. User quality acceptance and the remaining six source-derived wall
reconstructions remain open.

The original Blender source, print masters and historical reconstruction artifacts
are preserved. Public packaging must exclude source `.blend` files, raw reference
GLBs, internal logs and private inspection dumps. HDRI provenance and the Three.js
MIT notice accompany the runtime assets.

## Prepared continuation (not published)

A separate review copy adds a 15-second HDRI header/body deadline with immediate
disposal cancellation, eight full-wall/adaptive verification modules, and local
bounded frame-loop observation export with `?measure=1`. The export describes
coordinator callbacks and optional JavaScript heap measurements; it does not
certify GPU FPS, phone thermals, sound quality or printed alignment. Hidden and
inactive transitions pause observation synchronously. CI builds and validates
an isolated static stage without replacing the existing multi-route `docs`.
These changes are not part of public commit b73656f until reviewed application,
staging, publication and live verification complete.
