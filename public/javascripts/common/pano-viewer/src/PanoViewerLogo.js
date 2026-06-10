/**
 * Creates an imagery-source logo overlay at the bottom-left of the given pano container.
 *
 * The container must establish a CSS positioning context (position: relative, absolute, or fixed) so that
 * the absolutely-positioned logo is scoped to the pano area. Returns an object with two methods:
 *   - showPrimaryLogo() — use when the primary viewer (GSV/Mapillary/Infra3D) is active.
 *   - showSourceLogo()  — use when Pannellum is active as a backup for the primary source.
 *
 * @param {Element} container The positioned pano container element.
 * @param {typeof PanoViewer} primaryViewerType The primary viewer class (GsvViewer, MapillaryViewer, etc.).
 * @returns {{ showPrimaryLogo: Function, showSourceLogo: Function }}
 */
function createPanoViewerLogo(container, primaryViewerType) {
    /** @type {Map<typeof PanoViewer, {src: string, alt: string, paddingLeft: string}>} */
    const LOGOS = new Map([
        [GsvViewer,       { src: '/assets/images/logos/google-logo.svg',          alt: 'Google',    paddingLeft: '10px' }],
        [MapillaryViewer, { src: '/assets/images/logos/mapillary-logo-white.png', alt: 'Mapillary', paddingLeft: '5px'  }],
        [Infra3dViewer,   { src: '/assets/images/logos/infra3d-logo.svg',         alt: 'infra3D',   paddingLeft: '10px' }],
    ]);

    const holder = document.createElement('div');
    Object.assign(holder.style, {
        display: 'none',
        position: 'absolute',
        bottom: '0',
        left: '0',
        zIndex: '1',
        height: 'calc(29px * var(--ui-scale, 1))',
        padding: 'calc(4px * var(--ui-scale, 1)) 0 calc(3px * var(--ui-scale, 1)) calc(10px * var(--ui-scale, 1))',
        boxSizing: 'border-box',
    });
    const img = document.createElement('img');
    img.style.maxHeight = '100%';
    holder.appendChild(img);
    container.appendChild(holder);

    /**
     * Shows the logo for the given viewer type.
     * @param {typeof PanoViewer} viewerType
     */
    function showLogo(viewerType) {
        const info = LOGOS.get(viewerType);
        if (!info) return;
        img.src = info.src;
        img.alt = info.alt;
        holder.style.paddingLeft = `calc(${info.paddingLeft} * var(--ui-scale, 1))`;
        holder.style.display = 'flex';
    }

    return {
        /**
         * Shows the logo for the primary viewer, or hides the overlay for GSV (which provides its own branding).
         */
        showPrimaryLogo() {
            if (primaryViewerType === GsvViewer) {
                holder.style.display = 'none';
            } else {
                showLogo(primaryViewerType);
            }
        },

        /**
         * Shows the source logo for the primary viewer's imagery. Used when Pannellum is active.
         */
        showSourceLogo() {
            showLogo(primaryViewerType);
        }
    };
}
