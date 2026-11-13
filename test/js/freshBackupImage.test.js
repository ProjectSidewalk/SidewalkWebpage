/**
 * Tests for the signed-URL helpers in frontend/js/common/utilitiesSidewalk.js (`signedUrlIsExpired`, `isSignedUrl`,
 * `freshBackupImage`, `retrySignedImage`), which re-sign a URL a long-open page got at load once it expires (#5861).
 *
 * `freshBackupImage` keeps each pano's re-signed URL for the module's life, so each test uses its own pano id.
 */

import { loadModules } from './loader.js';

const {
  signedUrlIsExpired, isSignedUrl, freshBackupImage, retrySignedImage, SIGNED_URL_EXPIRY_MARGIN_SEC: MARGIN_SEC,
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

      expect(fetchMock).toHaveBeenCalledWith('/backupImage/p-resign/metadata', expect.anything());
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

    test('keeps the old URL when re-signing fails before its actual exp, and drops it after', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
      const nearing = backupImage(signedUrl(NOW_SEC + 120, 'p-keep'), 'p-keep');
      expect(await freshBackupImage(nearing)).toBe(nearing);
      expect(await freshBackupImage(backupImage(signedUrl(NOW_SEC - 1, 'p-keep'), 'p-keep'))).toBeNull();
    });

    test('a prefetch and a load asking at once share one request', async () => {
      const fetchMock = jsonFetch({ image_url: signedUrl(NOW_SEC + 3600, 'p-once') });
      vi.stubGlobal('fetch', fetchMock);
      const data = backupImage(signedUrl(NOW_SEC - 60, 'p-once'), 'p-once');
      await Promise.all([freshBackupImage(data), freshBackupImage(data)]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('passes null through', async () => {
      expect(await freshBackupImage(null)).toBeNull();
    });
  });
});

describe('retrySignedImage', () => {
  const img = (src) => Object.assign(document.createElement('img'), { src });
  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  test('gives up at once, without a request, on an unsigned picture', () => {
    const fetchMetadata = vi.fn();
    const onGiveUp = vi.fn();
    retrySignedImage(img('/images/crop.jpg'), { fetchMetadata, onGiveUp });
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  test('loads a fresh URL once and hands it over, then gives up at once on the next failure', async () => {
    const picture = img(signedUrl(NOW_SEC - 60));
    const handlers = {
      fetchMetadata: vi.fn(async () => ({ image_url: signedUrl(NOW_SEC + 3600) })), onGiveUp: vi.fn(), onFresh: vi.fn(),
    };
    retrySignedImage(picture, handlers);
    await flush();
    expect(picture.getAttribute('src')).toBe(signedUrl(NOW_SEC + 3600));
    expect(handlers.onFresh).toHaveBeenCalledWith(signedUrl(NOW_SEC + 3600));

    retrySignedImage(picture, handlers);
    expect(handlers.onGiveUp).toHaveBeenCalledTimes(1);
    expect(handlers.fetchMetadata).toHaveBeenCalledTimes(1);
  });

  test('gives up when no fresh URL can be had', async () => {
    const onGiveUp = vi.fn();
    retrySignedImage(img(signedUrl(NOW_SEC - 60)), { fetchMetadata: async () => null, onGiveUp });
    await flush();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  test('drops an answer that comes after the caller has moved on', async () => {
    const picture = img(signedUrl(NOW_SEC - 60));
    const onGiveUp = vi.fn();
    retrySignedImage(picture, { fetchMetadata: async () => null, onGiveUp, isCurrent: () => false });
    await flush();
    expect(onGiveUp).not.toHaveBeenCalled();
    expect(picture.getAttribute('src')).toBe(signedUrl(NOW_SEC - 60));
  });
});
