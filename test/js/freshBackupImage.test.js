/**
 * Tests for the signed-URL helpers in frontend/js/common/utilitiesSidewalk.js (`signedUrlIsExpired`, `isSignedUrl`,
 * `fetchBackupImageMetadata`, `freshBackupImage`, `freshCropUrl`), which re-sign a `/backupImage` or `/cropImage` URL
 * a long-open page got at load time once its signature has expired (#5861).
 *
 * `fetchBackupImageMetadata` keeps a good answer per pano for the module's life, so each test uses its own pano id.
 */

import { loadModules } from './loader.js';

const { signedUrlIsExpired, isSignedUrl, fetchBackupImageMetadata, freshBackupImage, freshCropUrl, util } =
  await loadModules('frontend/js/common/utilitiesSidewalk.js', 'frontend/js/common/utilities.js');

const NOW_SEC = 1_800_000_000;
const MARGIN_SEC = util.misc.SIGNED_URL_EXPIRY_MARGIN_SEC;

/** A signed backup URL for `panoId` that expires at `exp` (epoch seconds). */
const signedUrl = (exp, panoId = 'abc123') => `/backupImage/${panoId}?exp=${exp}&sig=s${exp}`;

/** Backup pano metadata carrying the given URL, with a label-specific attribution to check is kept. */
const backupImage = (imageUrl, panoId = 'abc123') => ({
  pano_id: panoId, image_url: imageUrl, attribution: { holder: 'label' },
});

/** A fetch stub answering every request with `body` as JSON. */
const jsonFetch = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));

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

  test.each([null, undefined, '', '/images/crop.jpg', '/backupImage/abc123?exp=abc', 'http://[bad'])(
    'leaves %p alone, having no usable exp', (url) => {
      expect(signedUrlIsExpired(url, NOW_SEC * 1000)).toBe(false);
    });
});

describe('isSignedUrl', () => {
  test('is true for a URL carrying sig, whatever its exp says', () => {
    expect(isSignedUrl(signedUrl(NOW_SEC + 3600))).toBe(true);
    expect(isSignedUrl(`https://example.org/cropImage/CurbRamp/1?exp=${NOW_SEC}&sig=x`)).toBe(true);
  });

  test.each([null, '', '/images/crop.jpg', 'https://example.test/42.jpg', 'http://[bad'])('is false for %p', (url) => {
    expect(isSignedUrl(url)).toBe(false);
  });
});

describe('re-signing', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW_SEC * 1000, toFake: ['Date'] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('freshBackupImage', () => {
    test('returns a still-good backup unchanged, without a request', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const data = backupImage(signedUrl(NOW_SEC + 3600));
      expect(await freshBackupImage(data)).toBe(data);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('re-signs an expired backup, replacing only image_url', async () => {
      const freshUrl = signedUrl(NOW_SEC + 3600, 'p-resign');
      const fetchMock = jsonFetch({ pano_id: 'p-resign', image_url: freshUrl, attribution: { holder: 'endpoint' } });
      vi.stubGlobal('fetch', fetchMock);
      const data = backupImage(signedUrl(NOW_SEC - 60, 'p-resign'), 'p-resign');

      const result = await freshBackupImage(data);

      expect(fetchMock).toHaveBeenCalledWith('/backupImage/p-resign/metadata');
      expect(result).toEqual({ ...data, image_url: freshUrl });
      expect(data.image_url).toBe(signedUrl(NOW_SEC - 60, 'p-resign')); // The caller's object is not mutated.
    });

    test('returns null when an expired backup cannot be re-signed', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
      expect(await freshBackupImage(backupImage(signedUrl(NOW_SEC - 60), 'p-404'))).toBeNull();
    });

    test('returns null when the metadata request throws', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
      expect(await freshBackupImage(backupImage(signedUrl(NOW_SEC - 60), 'p-throws'))).toBeNull();
    });

    test('passes null through', async () => {
      expect(await freshBackupImage(null)).toBeNull();
    });
  });

  describe('fetchBackupImageMetadata', () => {
    test('concurrent and repeat calls for one pano share a request while its URL is good', async () => {
      const fetchMock = jsonFetch({ pano_id: 'p-share', image_url: signedUrl(NOW_SEC + 3600, 'p-share') });
      vi.stubGlobal('fetch', fetchMock);

      const [a, b] = await Promise.all([fetchBackupImageMetadata('p-share'), fetchBackupImageMetadata('p-share')]);
      const c = await fetchBackupImageMetadata('p-share');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(b).toBe(a);
      expect(c).toBe(a);
    });

    test('asks again once the held URL has expired', async () => {
      let exp = NOW_SEC + 3600;
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ image_url: signedUrl(exp, 'p-age') }) }));
      vi.stubGlobal('fetch', fetchMock);

      await fetchBackupImageMetadata('p-age');
      vi.setSystemTime((NOW_SEC + 3600) * 1000);
      exp = NOW_SEC + 7200;
      const later = await fetchBackupImageMetadata('p-age');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(later.image_url).toBe(signedUrl(NOW_SEC + 7200, 'p-age'));
    });

    test('a failed request is not kept, so the next call tries again', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ image_url: signedUrl(NOW_SEC + 3600, 'p-retry') }) });
      vi.stubGlobal('fetch', fetchMock);

      expect(await fetchBackupImageMetadata('p-retry')).toBeNull();
      expect((await fetchBackupImageMetadata('p-retry')).image_url).toBe(signedUrl(NOW_SEC + 3600, 'p-retry'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('freshCropUrl', () => {
    const cropUrl = (exp) => `/cropImage/CurbRamp/7?exp=${exp}&sig=c${exp}`;

    test('returns a still-good crop URL, or a missing one, without a request', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      expect(await freshCropUrl(cropUrl(NOW_SEC + 3600), 'CurbRamp', 7)).toBe(cropUrl(NOW_SEC + 3600));
      expect(await freshCropUrl(null, 'CurbRamp', 7)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('re-signs an expired crop URL from the crop metadata endpoint', async () => {
      const fetchMock = jsonFetch({ label_id: 7, label_type: 'CurbRamp', image_url: cropUrl(NOW_SEC + 3600) });
      vi.stubGlobal('fetch', fetchMock);
      expect(await freshCropUrl(cropUrl(NOW_SEC - 60), 'CurbRamp', 7)).toBe(cropUrl(NOW_SEC + 3600));
      expect(fetchMock).toHaveBeenCalledWith('/cropImage/CurbRamp/7/metadata');
    });

    test('returns null when an expired crop URL cannot be re-signed', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
      expect(await freshCropUrl(cropUrl(NOW_SEC - 60), 'CurbRamp', 7)).toBeNull();
    });
  });
});
