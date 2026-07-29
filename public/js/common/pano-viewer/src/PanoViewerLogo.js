/**
 * Creates an imagery-source logo overlay at the bottom-left of the given pano container.
 *
 * The container must establish a CSS positioning context (position: relative, absolute, or fixed) so that
 * the absolutely-positioned logo is scoped to the pano area. Returns an object with two methods:
 *   - showPrimaryLogo() — use when the primary viewer (GSV/Mapillary/Infra3D) is active.
 *   - showSourceLogo()  — use when Pannellum is active as a backup for the primary source.
 *
 * The overlay also publishes the logo's width on the container as the --pano-logo-width CSS variable so that
 * overlays sitting to its right (the pano capture date and info button) can clear it.
 *
 * @param {Element} container The positioned pano container element.
 * @param {typeof PanoViewer} primaryViewerType The primary viewer class (GsvViewer, MapillaryViewer, etc.).
 * @returns {{ showPrimaryLogo: Function, showSourceLogo: Function }}
 */
function createPanoViewerLogo(container, primaryViewerType) {
  /** @type {Map<typeof PanoViewer, {src: string, alt: string, paddingLeft: number}>} paddingLeft is unscaled px. */
  const LOGOS = new Map([
    [GsvViewer, { src: '/assets/images/logos/google-logo.svg', alt: 'Google', paddingLeft: 10 }],
    [MapillaryViewer, { src: '/assets/images/logos/mapillary-logo-white.png', alt: 'Mapillary', paddingLeft: 5 }],
    [Infra3dViewer, { src: '/assets/images/logos/infra3d-logo.svg', alt: 'infra3D', paddingLeft: 6 }],
  ]);

  // Logo box metrics in unscaled px. The image fills the holder's content-box height, so its rendered width follows
  // the logo's aspect ratio — which is what publishLogoWidth reports to the overlays sitting to the logo's right.
  const HOLDER_HEIGHT = 29;
  const PADDING_TOP = 4;
  const PADDING_BOTTOM = 3;
  const IMG_HEIGHT = HOLDER_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const holder = document.createElement('div');
  Object.assign(holder.style, {
    display: 'none',
    position: 'absolute',
    bottom: 'calc(var(--bottom-left-links-clearance, 2px) * var(--ui-scale, 1))',
    left: '0',
    zIndex: '1',
    height: `calc(${HOLDER_HEIGHT}px * var(--ui-scale, 1))`,
    padding: `calc(${PADDING_TOP}px * var(--ui-scale, 1)) 0 calc(${PADDING_BOTTOM}px * var(--ui-scale, 1)) 0`,
    boxSizing: 'border-box',
  });
  const img = document.createElement('img');
  img.style.maxHeight = '100%';
  holder.appendChild(img);
  container.appendChild(holder);

  /** @type {?{src: string, alt: string, paddingLeft: number}} The logo currently in the holder. */
  let activeLogo = null;

  /**
   * Publishes the logo's unscaled width on the container as the --pano-logo-width CSS variable.
   *
   * The logos differ widely in width — Mapillary's wordmark is much wider than Google's — so overlays anchored to
   * the pano's bottom-left corner can't clear the logo with a single fixed offset (#4317).
   */
  function publishLogoWidth() {
    if (!activeLogo) return;

    // Take the ratio of the rendered box rather than naturalWidth/naturalHeight, since an SVG sized only by a viewBox
    // reports no intrinsic size. A ratio is independent of --ui-scale, so the published width stays in unscaled px,
    // matching how the rest of the tool UI is authored. getBoundingClientRect (not offsetWidth) keeps subpixel
    // precision, which matters at the small scales the tool UI shrinks to.
    const rect = img.getBoundingClientRect();
    const aspectRatio = rect.width / rect.height;
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return;
    container.style.setProperty('--pano-logo-width', `${activeLogo.paddingLeft + IMG_HEIGHT * aspectRatio}px`);
  }

  // The rendered box only has a usable ratio once the image has loaded and been laid out, which can happen well after
  // the logo is set (and again if the pano starts out hidden), so republish on every resize of the image box.
  new ResizeObserver(publishLogoWidth).observe(img);

  /**
   * Shows the logo for the given viewer type.
   * @param {typeof PanoViewer} viewerType
   */
  function showLogo(viewerType) {
    const info = LOGOS.get(viewerType);
    if (!info) return;
    activeLogo = info;
    img.src = info.src;
    img.alt = info.alt;
    holder.style.paddingLeft = `calc(${info.paddingLeft}px * var(--ui-scale, 1))`;
    holder.style.display = 'flex';
    publishLogoWidth();
  }

  return {
    /**
     * Shows the logo for the primary viewer, or hides the overlay for GSV (which provides its own branding).
     */
    showPrimaryLogo() {
      if (primaryViewerType === GsvViewer) {
        holder.style.display = 'none';
        activeLogo = null;
        // Google draws its own logo, so overlays to its right fall back to the offset that clears that one.
        container.style.removeProperty('--pano-logo-width');
      } else {
        showLogo(primaryViewerType);
      }
    },

    /**
     * Shows the source logo for the primary viewer's imagery. Used when Pannellum is active.
     */
    showSourceLogo() {
      showLogo(primaryViewerType);
    },
  };
}
