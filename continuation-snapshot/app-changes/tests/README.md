# Portable offline verification

Run from the repository root with the locked Node 22.23.4 / npm 10.9.9 toolchain:

```sh
npm ci --prefix tools/verification --ignore-scripts --no-audit --no-fund
npm test --prefix tools/verification
```

This dependency install is isolated from the application. It uses its own committed
`tools/verification/package-lock.json`; do not regenerate the root application
lockfile or install Three/JSDOM as application dependencies. No sibling project,
original developer workspace, browser, web server, or camera is required.

The runner resolves the repository from its own filename and reads the checked-out
`src/`, `config/`, and `image-targets/` files. It can also be invoked as
`node tests/offline-checks.cjs` after installing the isolated dependencies.

## Coverage and evidence boundary

The port preserves the baseline checks and later lifecycle/resource regressions: 12 effects contract cases across the
configured panels, UI state/control/callback/disposal behavior, delayed camera-start
cancellation, and coordinator preview/Overdrive expiry/exit/disposal behavior.

Effects and scene objects use independent Three r158 (`three@0.158.0`). DOM checks
use `jsdom@26.1.0`; the camera adapter, texture loader, renderer and clock are mocked.
The source loader removes static imports and binds these dependencies explicitly;
this is a focused module harness, not the application module loader. The production
Webpack build remains a separate required check of real imports and assets.

A pass does not establish actual A-Frame compatibility, WebGL rendering, visual
layout, camera permissions, tracking, print alignment, phone performance, or
cross-platform behavior. Those require actual browser/device observations and the
acceptance protocol. Keep calibration metadata provisional until measured.

The runner exits nonzero on failure and writes observed check results and SHA256
hashes of its source inputs to `tools/verification/results/offline-checks.json`.
Generated results and dependency folders are ignored by Git. The report only
records this offline run; it never changes acceptance, deployment, print, or release
status. Failures after dependency loading write a failed report; use the current exit code
and report timestamp/source hashes together. Dependency or initial input-load errors
can occur before a report is written.

## Lifecycle regressions

Additional checks exercise the actual tracking adapter with DOM/XR events mocked:
stalled scene and engine startup canceled by stop/dispose settle within 250 ms;
geometry arriving before root creation is retained; a camera error hides effects
and remains latched through late found/lost events until explicit retry. UI checks
require usable Cancel/Stop controls and verify their optional callbacks.

These assertions intentionally fail if shared source/spec integration is incomplete.
They do not silently skip missing new controls or treat canceled startup as success.

## Pages build validation

Run `npm run build` for production output. CI copies `dist`, config, notices and
pinned-input files into an isolated temporary stage, then runs
`tools/verification/check-static.cjs` against that stage. It does not replace
repository `docs` or publish. Do not use `build:pages` on the active multi-route
site: its whole-folder replacement would remove `/experience/` and `/ar/`.
Use the reviewed route-specific publication scripts after validation.

The suite also checks the real preview helper's abort, late-texture disposal,
bounded timeout and successful ownership; real coordinator cancellation while
texture/engine startup stalls; and persisted pagehide/pageshow restoration with
reusable controls. The canvas in this lifecycle harness is a DOM fixture, so its
unchanged count is not browser/WebGL evidence.

Opt-in Driveway effects checks independently count meshes, instanced triangles,
materials, textures and particle caps at Overload; instrument Three constructors
for mesh/geometry/material/texture allocation across 240 updates; verify stable
spatial transforms with reduced motion; and require unique GPU resources to dispose
once. These are resource inventory checks, not measured GPU draw timing or FPS.
The catalog check requires Driveway as the default and matching per-wall panels,
compiled targets, manifests and preview sources while preserving Garage selection.

## Full source-derived wall extension

After installing the same isolated, locked verification dependencies above, run:

```sh
npm run test:full-wall
```

The equivalent direct command is `node tools/verification/run-full-wall.cjs`.
Use the locked Node 22.23.4 toolchain. The runner invokes each test sequentially
using its own `process.execPath`; it does not resolve a second Node from PATH.
It preflights all nine test files and fails on a missing file, nonzero child exit,
signal or 60-second per-module timeout. It does not silently skip a module.

The original five modules are `full-wall-effects.cjs`, `full-wall-ui.cjs`,
`full-wall-tracking.cjs`, `full-wall-loader.cjs` and `full-wall-coordinator.cjs`.
They cover the normalized full model and effects resource lifecycle, opt-in sound
and cancellation, canonical crop-to-panel attachment, model loading/late-result
disposal, and coordinator transitions with mocked camera/renderer events.
They extend the baseline suite; run both `npm test` and `npm run test:full-wall`,
then `npm run build` to validate actual imports and bundled assets.

See `FULL_WALL_AR.md` for the implementation and acceptance boundary. The planned
public `/ar/` route is staged until its publication is separately verified.
Offline passes do not prove physical tracking, alignment, WebGL appearance,
sound quality, Android performance or thermal behavior.

The full-wall runner also executes `adaptive-runtime.cjs`, `environment-lighting.cjs`
and `field-session.cjs`: calibrated gauges, camera estimates, GPU warm-up, bounded
HDRI readiness/cancellation, and bounded local frame-loop measurements. The recorder
measures coordinator callbacks, not GPU/presented-frame FPS; phone/print/temperature
acceptance remains unmeasured. Add `?measure=1` to a locally built route to download
local JSON observations. No data is uploaded or stored automatically.

`steam-variation.cjs` verifies source-mounted release profiles and actual double
bursts, changing cloud shape/motion, fixed particle buffers, boost/lifecycle gates,
and equal/opposite pitch-line travel of touching gears through the shared drive
pulse. These are simulation checks; rendered appearance is checked separately.
