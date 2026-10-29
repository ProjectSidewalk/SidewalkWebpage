/**
 * Tests for `signedUrlIsExpired` / `freshBackupImage` in frontend/js/common/utilitiesSidewalk.js, which re-sign a
 * backup pano URL a long-open page got at load time once its signature has expired (#5861).
 */

import { loadModules } from './loader.js';

const { signedUrlIsExpired, freshBackupImage, util } = await loadModules(
  'frontend/js/common/utilitiesSidewalk.js',
  'frontend/js/common/utilities.js',
);

const NOW_SEC = 1_800_000_000;
const MARGIN_SEC = util.misc.SIGNED_URL_EXPIRY_MARGIN_SEC;

/** A signed backup URL for `panoId` that expires at `exp` (epoch seconds). */
const signedUrl = (exp, panoId = 'abc123') => `/backupImage/${panoId}?exp=${exp}&sig=s${exp}`;

/** Backup pano metadata carrying the given URL, with a label-specific attribution to check is kept. */
const backupImage = (imageUrl) => ({ pano_id: 'abc123', image_url: imageUrl, attribution: { holder: 'label' } });

describe('signedUrlIsExpired', () => {
  test('a URL well before its exp is good', () => {
    expect(signedUrlIsExpired(signedUrl(NOW_SEC + 3600), NOW_SEC * 1000)).toBe(false);
  });

  test('a URL past its exp is expired', () => {
    expect(signedUrlIsExpired(signedUrl(NOW_SEC - 1), NOW_SEC * 1000)).toBe(true);
  });

  test('a URL inside the margin counts as expired', () => {
    expect(signedUrlIsExpired(signedUrl(NOW_SEC + MARGIN_SEC - 1), NOW_SEC * 1000)).toBe(true);
    expect(signedUrlIsExpired(signedUrl(NOW_SEC + MARGIN_SEC + 1), NOW_SEC * 1000)).toBe(false);
  });

  test('reads exp from an absolute URL with more parameters after it', () => {
    const url = `https://example.org${signedUrl(NOW_SEC - 1)}&maxWidth=4096`;
    expect(signedUrlIsExpired(url, NOW_SEC * 1000)).toBe(true);
  });

  test.each([null, undefined, '', '/images/crop.jpg', '/backupImage/abc123?exp=abc'])(
    'leaves %p alone, having no usable exp', (url) => {
      expect(signedUrlIsExpired(url, NOW_SEC * 1000)).toBe(false);
    });
});

describe('freshBackupImage', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW_SEC * 1000, toFake: ['Date'] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('returns a still-good backup unchanged, without a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const data = backupImage(signedUrl(NOW_SEC + 3600));
    expect(await freshBackupImage(data)).toBe(data);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('re-signs an expired backup, replacing only image_url', async () => {
    const freshUrl = signedUrl(NOW_SEC + 3600);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ pano_id: 'abc123', image_url: freshUrl, attribution: { holder: 'endpoint' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const data = backupImage(signedUrl(NOW_SEC - 60));

    const result = await freshBackupImage(data);

    expect(fetchMock).toHaveBeenCalledWith('/backupImage/abc123/metadata');
    expect(result).toEqual({ ...data, image_url: freshUrl });
    expect(data.image_url).toBe(signedUrl(NOW_SEC - 60)); // The caller's object is not mutated.
  });

  test('returns null when an expired backup cannot be re-signed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await freshBackupImage(backupImage(signedUrl(NOW_SEC - 60)))).toBeNull();
  });

  test('returns null when the metadata request throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await freshBackupImage(backupImage(signedUrl(NOW_SEC - 60)))).toBeNull();
  });

  test('passes null through', async () => {
    expect(await freshBackupImage(null)).toBeNull();
  });
});
