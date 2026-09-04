# Photo Sphere Viewer (vendored bundle)

The WebGL panorama renderer behind `PanoramaxViewer` (`public/js/common/pano-viewer/src/PanoramaxViewer.js`, #5185).

Unlike the other vendored libraries this is **not an upstream distribution file**: `psv-5.15.1-bundle.min.js` is built
here, from `build/entry.js`, because upstream no longer ships anything our classic-`<script>` pages can load.
Photo Sphere Viewer 5.15 depends on three.js 0.185, and three.js stopped publishing its standalone UMD build after
0.160 (the copy in `vendor/three/`, which Mapillary's viewer needs), so the two can only be combined by bundling.
The bundle contains Photo Sphere Viewer core, its equirectangular-tiles adapter, and a private copy of three.js
0.185, and exposes one global, `PhotoSphereViewer` (`Viewer`, `EquirectangularTilesAdapter`, `utils`, `CONSTANTS`,
`events`, `DEFAULTS`). It leaks no `THREE` global, so it coexists with Mapillary's three.js on the same page.

| File | What |
|---|---|
| `psv-5.15.1-bundle.min.js` | The built bundle (esbuild, IIFE, minified; licence comments kept at the end of the file) |
| `psv-5.15.1.css` | Upstream `@photo-sphere-viewer/core/index.css`, unmodified |
| `build/entry.js`, `build/build.sh` | What produced the bundle; run the script to regenerate it after an upgrade |
| `LICENSE-photo-sphere-viewer`, `LICENSE-three` | MIT licences of the two bundled projects |

## Upgrading

```bash
cd public/vendor/photo-sphere-viewer/build
./build.sh 5.16.0        # the Photo Sphere Viewer version; three.js follows from its package.json
```

The script installs the pinned packages into a temporary directory, bundles, and writes `psv-<version>-bundle.min.js`
and `psv-<version>.css` beside this README. Then update the `@assets.path("vendor/photo-sphere-viewer/…")` links in
the views that load it (grep for `psv-5.15.1`), the entry in `docs/upgrading-libraries.md`, and delete the old files.
