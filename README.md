# Steampunk Wall AR

Scan the Garage Left artwork for a rotating brass gear and amber lights.
Preview animation shows the effect without starting the camera. Overdrive lasts
three seconds; repeated taps restart it. Reduced motion keeps the gear static.

## Status and launch

Demo delivery complete. The user confirmed that both artwork tracking and the
animation preview work on 22 October 2026. Production build, 15 offline module
checks, GitHub Pages deployment and deployed key-file hash checks pass.

- [Open the live demo](https://shayan-kazeyami.github.io/steampunk-wall-ar/)
- [Print the full-panel sample](https://shayan-kazeyami.github.io/steampunk-wall-ar/assets/target-sample.html)
- [Download the release](https://github.com/Shayan-Kazeyami/steampunk-wall-ar/releases/latest)

Tap Start, allow camera access, and aim at the Garage Left artwork. Tap Overdrive
for the three-second boost. Use Preview animation to see the effect without camera
tracking; its persistent label distinguishes it from live AR.

The user confirmation is a smoke test, not measured calibration or cross-platform
certification. Acquisition timing, alignment error, lighting range and long-run
phone performance remain unmeasured; see [acceptance record](ACCEPTANCE.md).
No full-resolution print files or Blender source are included here.

## GitHub Pages

Publish from `main` / `docs`. All deployed paths are relative and support a GitHub
Pages project URL. `docs/.nojekyll` preserves static runtime resources. The runtime
also loads the pinned 8th Wall 1.0.0 CDN scripts and requires internet and HTTPS.

## Build

Use Node 22.23.4 and npm 10.9.9. Run `npm ci`, then `npm run build`.
The result is in dist/. Copy its contents to docs/ and retain docs/.nojekyll before
committing a new Pages release. Do not replace package-lock.json with an upgrade.

Print docs/assets/target-sample.html at 100%: artwork width 180 mm, height 170.526 mm.
Use ?debug=1 for target bounds and corner labels during phone calibration.
Require 4/5 acquisitions within 3 seconds and reacquisitions within 2 seconds;
alignment error at most 3% of panel width. Test denial/retry, background/resume,
negative artwork matches and a 3-minute performance run before claiming working AR.

## Attribution

Based on the official 8th Wall A-Frame image-target starter, commit
0eefbe133eb5adbb69ced43c05bef9ddca20ea45. Keep all runtime and component licenses,
including docs/assets/XR_ENGINE_LICENSE.txt and licenses under external/.
The XR runtime is governed by its included agreement; this repository does not
relicense the engine. Original steampunk artwork is provided for this demo.
