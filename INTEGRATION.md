# Isolated Driveway integration baseline

This branch prepares the newer Driveway/full-wall application. It does not merge or approve PR #1, activate the Garage lamp reviews, or replace the legacy demo. No public route was changed.

Inputs: publication base `ff3f90646a7c888de9470d252b64ded47f3febc4`; 92 selected source files copied from `continuation-snapshot/app-changes/` at `b0f72c3c4087f784f732749615a9d6365d420f5f`. `integration-evidence/snapshot-inputs.json` records every copied input hash before adaptation. This snapshot originated from development base `14beeb1364e7b47aa4afe78d6ecbb5773c89416f`, not a complete source release; the measured build/tests below establish only this reconstructed baseline.

The missing `src/assets/full-wall/driveway-adaptive.glb` was recovered from the existing `docs/ar/assets/full-wall/driveway-adaptive.glb`: 27,154,392 bytes, SHA256 `4ed8086fd426cae2e5b57349367459b77a5b5ccfbc901b2514fef65d85f63534`. This matches the snapshot's documented expected hash. The published `/experience/` and current trial copies are byte-identical. No model was generated or modified. HDRI provenance, original notices and Three.js license are retained.

## Route boundaries

| Route/surface | Source here | Status |
|---|---|---|
| Legacy root Garage demo | Preserved `docs/index.html`; development fixes remain in the separate `launch/readiness-pass` worktree | Unchanged here |
| Driveway AR/preview | `src/` builds into `dist/`; intended independent `/ar/` stage | Buildable local baseline; not published |
| Camera-free Driveway experience | Preserved `docs/experience/` | Unchanged, not rebuilt |
| Tracking trials | Preserved `docs/Models/driveway-target-trials/` | Unchanged, no acceptance claim |
| Garage five-family lamp reviews | PR `review/garage-lamps/`, not integrated into this app | Component scope only; not activated |

The source catalog activates only Driveway. Do not use the historical `npm run build:pages` helper: it replaces all of `docs`. `STATIC_ROOT` was added to the static checker to allow validation of a separate caller-owned stage.

## Reproduce

Validated here with Node 24.19.0/npm 11.9.0; the archived documentation pins Node 22.23.4/npm 10.9.9, which was not rerun here.

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/driveway-npm-cache
npm ci --prefix tools/verification --ignore-scripts --no-audit --no-fund --cache /tmp/driveway-npm-cache
npm test
node --test tests/startup.test.cjs
npm run build
node tests/built-startup.cjs
```

For static verification, copy `dist/` into a separate temporary directory, add `.nojekyll` there, then run `STATIC_ROOT=/absolute/temporary/stage node tools/verification/check-static.cjs`. Never copy over `docs`.

`npm run test:full-wall` remains blocked at the coverage tests. Independent execution of all 35 modules yielded 33 passes and two fixture-related failures; no skipped test was treated as passing. Baseline `npm test` passed 34 checks. Six startup regressions, two built-bundle JSDOM fallbacks and isolated static paths/notices/lock checks passed. Build completed with three webpack performance warnings.

## Selective adaptation

The newer coordinator retains its existing preview retry, full-wall lifecycle, preloading, audio, coverage, lighting and instrumentation logic. Only coordinator entry registration/boot were exposed to a startup wrapper; existing VM test harnesses now invoke those entry points explicitly. An independent accessible HTML fallback, WebGL preflight, inert scene template, startup deadline and exception handling prevent a blank page when graphics/library initialization fails. This does not claim successful real rendering. Pending managed-browser approval and device QA are untouched.

## Missing fixture set

Required sibling paths, relative to this checkout's parent:

- `Models/coverage-wave-2026-10-25/tracking/centre/target-manifest.json`
- `Models/coverage-wave-2026-10-25/tracking/left/target-manifest.json`
- `Models/coverage-wave-2026-10-25/tracking/right/target-manifest.json`
- `Models/coverage-wave-2026-10-25/tracking/coverage-manifest.json`

Each region also needs the compiled JSON at its manifest's `compiledJsonPath` and luminance image at the compiled JSON's `resources.luminanceImage`. Their exact filenames and expected hashes cannot be resolved without the missing manifests; no replacements were fabricated. These block `wall-coverage.cjs` and `wall-coverage-coordinator.cjs`.

No such fixture tree was found in the inspected main/PR Git trees. Drive searches for `coverage-wave-2026-10-25`, `coverage-manifest`, and `target-manifest` returned no results. An original authorized Drive archive may still contain them under an opaque name; that has not been established. Full source blends, original textures and print masters remain outside this baseline and were not accessed.

Remaining gates: recover authoritative coverage fixtures, supported WebGL browser/mobile rendering, real camera/print trials and performance, source material/shadow acceptance (including the previously reported failed C11 shadow guard). A passing local build does not close those gates.

## Bounded engine-stop recovery

XR8 stop has a three-second observation deadline. Rejection or deadline expiry is an uncertain camera stop, blocks new XR starts and presents reload guidance. A later fulfilled stop can clear uncertainty. Local teardown releases owned assets before awaiting bounded engine cleanup. This does not revoke device permissions or certify hardware camera shutdown. Adversarial adapter/coordinator tests cover resolved, rejected, pending and late stop, repeated Start/Preview and cached-page restoration. Current offline suite: 41 checks passed; production build passed. Missing coverage fixtures, failed recorded C11 shadow guard and real-device acceptance remain open.
