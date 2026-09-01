/**
 * Tests for util.assetPath, the one way frontend JS names a public asset (#4893).
 *
 * The contract worth pinning is the fallback. Staged builds fingerprint assets and main.scala.html stamps the digests
 * as `window.assetDigests`; everywhere else — dev `sbt run`, jsdom, the error pages, an asset the pipeline skipped —
 * there is no entry, and the helper must then return exactly `/assets/<logical path>`. A fallback that drifted by even
 * a character would 404 an image in dev while staging looked fine.
 */

const { loadGlobalScript } = require('./loadGlobalScript');

const MD5 = '0123456789abcdef0123456789abcdef';

beforeEach(() => {
  delete window.assetDigests;
  loadGlobalScript('public/js/common/utilities.js');
});

afterEach(() => {
  delete window.assetDigests;
});

describe('util.assetPath', () => {
  test('falls back to the plain /assets/ URL when no stamp is on the page', () => {
    expect(window.util.assetPath('images/foo.png')).toBe('/assets/images/foo.png');
  });

  test('rebuilds the fingerprinted URL from a stamped digest', () => {
    window.assetDigests = { 'images/foo.png': MD5 };
    expect(window.util.assetPath('images/foo.png')).toBe(`/assets/images/${MD5}-foo.png`);
  });

  test('prefixes the digest onto the filename, not the directory, however deep the path', () => {
    window.assetDigests = { 'images/icons/label_type_icons/CurbRamp_small.svg': MD5 };
    expect(window.util.assetPath('images/icons/label_type_icons/CurbRamp_small.svg'))
      .toBe(`/assets/images/icons/label_type_icons/${MD5}-CurbRamp_small.svg`);
  });

  test('falls back for an asset the stamp does not carry', () => {
    window.assetDigests = { 'images/other.png': MD5 };
    expect(window.util.assetPath('images/foo.png')).toBe('/assets/images/foo.png');
  });

  test('falls back when the stamp is not an object at all', () => {
    window.assetDigests = 'not-a-manifest';
    expect(window.util.assetPath('images/foo.png')).toBe('/assets/images/foo.png');
    window.assetDigests = null;
    expect(window.util.assetPath('images/foo.png')).toBe('/assets/images/foo.png');
  });

  test('falls back when an entry is present but not a string', () => {
    window.assetDigests = { 'images/foo.png': 12345 };
    expect(window.util.assetPath('images/foo.png')).toBe('/assets/images/foo.png');
  });

  test('handles a path with no directory component, stamped and unstamped', () => {
    expect(window.util.assetPath('favicon.png')).toBe('/assets/favicon.png');
    window.assetDigests = { 'favicon.png': MD5 };
    expect(window.util.assetPath('favicon.png')).toBe(`/assets/${MD5}-favicon.png`);
  });
});
