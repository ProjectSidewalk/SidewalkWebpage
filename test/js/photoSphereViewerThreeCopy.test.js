/**
 * @vitest-environment node
 *
 * Photo Sphere Viewer's tiles adapter imports `three` without listing it, so it gets whichever copy npm put at the top
 * of node_modules, while PSV's core gets its own. If those differ, the adapter's meshes are drawn by another copy's
 * renderer (#5808). Which copy lands on top is npm's choice, since `three` is not in our package.json (mapillary-js
 * carries an older one), so this fails the install that splits them.
 */
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { REPO_ROOT } from './loader.js';

/**
 * @param {string} pkg - A package under node_modules.
 * @returns {string} The real path of the `three` that package's own imports load.
 */
function threeSeenBy(pkg) {
  const require = createRequire(path.join(REPO_ROOT, 'node_modules', pkg, 'package.json'));
  return fs.realpathSync(require.resolve('three'));
}

test('PSV\'s core and tiles adapter load the same copy of three', () => {
  expect(threeSeenBy('@photo-sphere-viewer/equirectangular-tiles-adapter'))
    .toBe(threeSeenBy('@photo-sphere-viewer/core'));
});
