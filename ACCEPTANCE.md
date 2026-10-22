# Demo acceptance and verification

Delivered: 22 October 2026 (Asia/Calcutta).

The user reported: **“Both tracking and preview worked.”** This is recorded as
user-reported functional smoke acceptance. No device model, OS/browser version,
target substrate, physical dimensions, lighting, distance or recording was supplied.
These fields remain unspecified; do not infer a formal phone/print test result.

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Production build | PASS | Locked starter/toolchain; asset-size warnings only |
| Offline effects checks | PASS, 12 cases | Independent Three r158, not the actual browser renderer |
| Offline UI controls/lifecycle | PASS | JSDOM states, repeated callbacks, disposal |
| Pending camera-start cancellation | PASS | Mocked runtime; canceled start never activates XR |
| Coordinator preview/boost lifecycle | PASS | Mock scene/texture; repeat taps restart 3000 ms expiry |
| GitHub Pages deployment | PASS | main:/docs, trusted HTTPS |
| Published HTML, bundle and target image | PASS | HTTP 200 and SHA256 equal to local build |
| Artwork tracking smoke test | USER-REPORTED PASS | User explicitly confirmed tracking works |
| Animation preview smoke test | USER-REPORTED PASS | User explicitly confirmed preview works |
| Assistant visual browser inspection | NOT RUN | Browser origin approval denied; no workaround used |
| Five-trial acquisition/reacquisition thresholds | NOT MEASURED | No trial timings provided |
| Physical-print pose/alignment within 3% | NOT MEASURED | No print geometry measurements provided |
| Negative artwork recognition tests | NOT RUN | No five-second negative trials recorded |
| Permission-denial and background/resume on phone | NOT RUN | No named-device evidence |
| Three-minute phone performance and heat | NOT RUN | No phone measurements |
| Second platform and installed-wall acceptance | NOT RUN | No supporting observations |

The garage-wide compiled target remains the delivered target. Its calibration
metadata stays provisional until bounds and lamp positions are measured; the smoke
confirmation does not silently change that metadata. `?debug=1` shows calibration
corners. `?qa=1` exposes optional effects checks in the actual A-Frame renderer.

Full acceptance targets remain 4/5 acquisitions within 3 seconds, 4/5 reacquisitions
within 2 seconds, alignment error at most 3% panel width, and zero sustained false
matches against Garage Right and unrelated artwork. Keep the delivered visual
values and target unchanged unless a recorded result justifies a repair.

This is a delivered, user-accepted demonstration. Robustness, device compatibility
and installed-wall performance are limited to observations actually recorded here.
