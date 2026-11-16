/**
 * Tests for frontend/js/common/pano-viewer/PanoViewerLogo.js, the imagery-source logo in a pano's bottom-left corner.
 *
 * Besides picking the art, the logo publishes how far its visible pixels reach as `--pano-logo-width` on the pano
 * container, which is what keeps the capture date and info button beside it from overlapping a wide wordmark (#4317).
 * jsdom does no layout and has no 2D canvas, so the rendered box, the resize callback and the pixel read are stubbed
 * here, each the way a real browser reports them. (#5840)
 */

import { loadModules } from './loader.js';

const { createPanoViewerLogo } = await loadModules('frontend/js/common/pano-viewer/PanoViewerLogo.js');

describe('createPanoViewerLogo', () => {
  let container;
  /** The callbacks the logo handed ResizeObserver, so a test can play a layout change. */
  let resizeCallbacks;
  /** What getBoundingClientRect answers, per element tag. */
  let rects;
  /** The 2D context a canvas hands out, or null for one that can't be read. */
  let canvasCtx;

  beforeEach(() => {
    document.body.innerHTML = '<div id="pano" style="position: relative"></div>';
    container = document.getElementById('pano');
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', class {
      /** @param {Function} callback - What the logo wants run on a resize. */
      constructor(callback) { resizeCallbacks.push(callback); }

      /** Watching is a no-op; tests fire the callback themselves. */
      observe() {}
    });
    // The image renders at its authored 22px height at --ui-scale 1, twice as wide as tall.
    rects = { IMG: { width: 44, height: 22 }, SPAN: { width: 60, height: 14 } };
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function rect() { return rects[this.tagName] ?? { width: 0, height: 0 }; });
    canvasCtx = null;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasCtx);
  });

  const holder = () => container.querySelector('.pano-viewer-logo');
  const img = () => holder().querySelector('img');
  const wordmark = () => holder().querySelector('span');
  const logoWidth = () => container.style.getPropertyValue('--pano-logo-width');

  /**
   * A 2D context whose image data is opaque only up to a column, like a logo with a transparent right margin.
   * @param {number} inkColumns - How many columns from the left hold visible pixels.
   * @returns {object} The context stand-in.
   */
  function contextWithInkTo(inkColumns) {
    return {
      drawImage: vi.fn(),
      getImageData: (x, y, w, h) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row++) {
          for (let col = 0; col < inkColumns; col++) data[(row * w + col) * 4 + 3] = 255;
        }
        return { data };
      },
    };
  }

  it('starts hidden, mounted in the pano container', () => {
    createPanoViewerLogo(container, 'mapillary');

    expect(holder().style.display).toBe('none');
    expect(logoWidth()).toBe('');
  });

  it("leaves Google's own branding alone when the live Street View viewer is up", () => {
    const logo = createPanoViewerLogo(container, 'gsv');
    container.style.setProperty('--pano-logo-width', '99px');

    logo.showPrimaryLogo();

    expect(holder().style.display).toBe('none');
    // Back to the offset that clears Google's own logo.
    expect(logoWidth()).toBe('');
  });

  it('shows the Google logo over our own copy of Street View imagery', () => {
    createPanoViewerLogo(container, 'gsv').showSourceLogo();

    expect(holder().style.display).toBe('flex');
    expect(img().alt).toBe('Google');
    expect(img().getAttribute('src')).toContain('images/logos/google-logo.svg');
  });

  it("names the source in the image's alt text and publishes the box width when the art fills it", () => {
    createPanoViewerLogo(container, 'mapillary').showPrimaryLogo();

    expect(img().alt).toBe('Mapillary');
    expect(wordmark().style.display).toBe('none');
    // No readable canvas, so the whole 44px box counts, after Mapillary's 5px of left padding.
    expect(logoWidth()).toBe('49px');
  });

  it('stops at the last visible pixel, so a logo with a transparent margin sits as close as one without', () => {
    canvasCtx = contextWithInkTo(30);
    const logo = createPanoViewerLogo(container, 'infra3d');
    Object.defineProperty(img(), 'naturalWidth', { value: 40 });
    Object.defineProperty(img(), 'naturalHeight', { value: 20 });
    logo.showPrimaryLogo();

    // Ink stops 30 of 40 natural pixels in: 3/4 of the 44px box, plus infra3D's 6px of padding.
    expect(logoWidth()).toBe('39px');
    expect(canvasCtx.drawImage).toHaveBeenCalledWith(img(), 0, 0, 40, 20);
  });

  it('samples an SVG with no natural size at its rendered size', () => {
    canvasCtx = contextWithInkTo(0);
    createPanoViewerLogo(container, 'mapillary').showPrimaryLogo();

    // A fully transparent scan finds no ink, so the box width stands.
    expect(canvasCtx.drawImage).toHaveBeenCalledWith(img(), 0, 0, 44, 22);
    expect(logoWidth()).toBe('49px');
  });

  it('sets the Panoramax name beside its little-known icon, and counts it in the published width', () => {
    createPanoViewerLogo(container, 'panoramax').showPrimaryLogo();

    expect(wordmark().textContent).toBe('Panoramax');
    expect(wordmark().style.display).toBe('');
    // The visible name carries the meaning, so the icon is decorative.
    expect(img().alt).toBe('');
    // 6px padding + 44px icon + 6px gap + 60px of name.
    expect(logoWidth()).toBe('116px');
  });

  it('reads the name in unscaled px when the tool UI is scaled down', () => {
    // At --ui-scale 0.5 everything renders at half size; the published width stays in authored px.
    rects = { IMG: { width: 22, height: 11 }, SPAN: { width: 30, height: 7 } };
    createPanoViewerLogo(container, 'panoramax').showPrimaryLogo();

    expect(logoWidth()).toBe('116px');
  });

  it('waits for the image to be laid out before publishing a width, then publishes on the resize', () => {
    rects.IMG = { width: 0, height: 0 };
    createPanoViewerLogo(container, 'mapillary').showPrimaryLogo();
    expect(logoWidth()).toBe('');

    rects.IMG = { width: 44, height: 22 };
    resizeCallbacks.forEach((callback) => callback());

    expect(logoWidth()).toBe('49px');
  });

  it('keeps no width once hidden, even if a resize lands afterwards', () => {
    const logo = createPanoViewerLogo(container, 'mapillary');
    logo.showSourceLogo();
    logo.hide();
    resizeCallbacks.forEach((callback) => callback());

    expect(holder().style.display).toBe('none');
    expect(logoWidth()).toBe('');
  });

  it('shows nothing for a source it has no art for', () => {
    // The source comes from the server's pano_data, so a new provider can reach a card before its logo does.
    createPanoViewerLogo(container, 'someNewProvider').showSourceLogo();

    expect(holder().style.display).toBe('none');
    expect(logoWidth()).toBe('');
  });
});
