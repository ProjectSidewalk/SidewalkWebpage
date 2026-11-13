/**
 * Tests for the signed-URL helpers in frontend/js/common/utilitiesSidewalk.js (`signedUrlIsExpired`, `isSignedUrl`,
 * `freshBackupImage`, `resignFailedImage`), which re-sign a URL a long-open page got at load once it expires (#5861).
 *
 * `freshBackupImage` keeps each pano's re-signed URL for the module's life, so each test uses its own pano id.
 */

import { loadModules } from './loader.js';

const {
  signedUrlIsExpired, isSignedUrl, freshBackupImage, resignFailedImage, SIGNED_URL_EXPIRY_MARGIN_SEC: MARGIN_SEC,
} = await loadModules('frontend/js/common/utilitiesSidewalk.js');

const NOW_SEC = 1_800_000_000;

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

    test('re-signs a pano once, reusing the fresh URL until it too nears expiry', async () => {
      let exp = NOW_SEC + 3600;
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ image_url: signedUrl(exp, 'p-memo') }) }));
      vi.stubGlobal('fetch', fetchMock);
      const data = backupImage(signedUrl(NOW_SEC - 60, 'p-memo'), 'p-memo');

      await freshBackupImage(data);
      expect((await freshBackupImage(data)).image_url).toBe(signedUrl(NOW_SEC + 3600, 'p-memo'));
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime((NOW_SEC + 3600) * 1000);
      exp = NOW_SEC + 7200;
      expect((await freshBackupImage(data)).image_url).toBe(signedUrl(NOW_SEC + 7200, 'p-memo'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('passes null through', async () => {
      expect(await freshBackupImage(null)).toBeNull();
    });
  });
});

describe('resignFailedImage', () => {
  const img = (src) => Object.assign(document.createElement('img'), { src });

  test('answers null at once, without a request, for an unsigned picture', () => {
    const fetchMetadata = vi.fn();
    expect(resignFailedImage(img('/images/crop.jpg'), fetchMetadata)).toBeNull();
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  test('gets a fresh URL for a signed picture once, then answers null at once', async () => {
    const picture = img(signedUrl(NOW_SEC - 60));
    const fetchMetadata = vi.fn(async () => ({ image_url: signedUrl(NOW_SEC + 3600) }));

    await expect(resignFailedImage(picture, fetchMetadata)).resolves.toBe(signedUrl(NOW_SEC + 3600));
    expect(resignFailedImage(picture, fetchMetadata)).toBeNull();
    expect(fetchMetadata).toHaveBeenCalledTimes(1);
  });

  test('resolves to null when the picture cannot be re-signed', async () => {
    await expect(resignFailedImage(img(signedUrl(NOW_SEC - 60)), async () => null)).resolves.toBeNull();
  });
});
