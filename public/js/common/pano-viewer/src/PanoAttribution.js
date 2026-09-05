/**
 * Creates the imagery-attribution overlay for a pano container: the rights holder, provider and licence owed when
 * Project Sidewalk shows its own copy of a panorama — the self-hosted Pannellum copy or a crop — rather than the
 * provider's live viewer, which draws its own (#4865).
 *
 * Only licensed imagery gets an overlay. Mapillary's CC BY-SA obliges us to name the contributor and the licence,
 * and nothing else on screen does that once Pannellum has replaced Mapillary's viewer. Google's and infra3d's
 * imagery carries a copyright string instead of a licence, which the source logo and the viewer's own copyright
 * line already convey, so a second copy of it is noise (Jon, 2026-09-04).
 *
 * The container must establish a CSS positioning context, as for createPanoViewerLogo. The overlay sits top-right,
 * clear of the hide-label control (top-left) and the hover validation bar (bottom).
 *
 * @param {Element} container The positioned pano container element.
 * @returns {{ show: Function, hide: Function }}
 */
function createPanoAttribution(container) {
  const holder = document.createElement('small');
  holder.className = 'pano-attribution';
  holder.hidden = true;
  container.appendChild(holder);

  /**
   * Fills the overlay from a structured attribution.
   * @param {{holder: string, provider: ?string, license: ?string, license_url: ?string}} attribution
   */
  function render(attribution) {
    const parts = [document.createTextNode(attribution.holder)];
    if (attribution.provider) parts.push(document.createTextNode(attribution.provider));
    if (attribution.license) {
      if (attribution.license_url) {
        // Only the licence token links out, so the line's other names don't read as links to the provider.
        const link = document.createElement('a');
        link.href = attribution.license_url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = attribution.license;
        // A new tab is a change of context the visible text doesn't announce (WCAG 3.2.5, G201).
        const newTab = document.createElement('span');
        newTab.className = 'pano-attribution__new-tab';
        newTab.textContent = ` ${i18next.t('common:pano-attribution.opens-new-tab')}`;
        link.appendChild(newTab);
        parts.push(link);
      } else {
        parts.push(document.createTextNode(attribution.license));
      }
    }
    holder.replaceChildren();
    parts.forEach((part, i) => {
      if (i > 0) holder.appendChild(document.createTextNode(' · '));
      holder.appendChild(part);
    });
  }

  return {
    /**
     * Shows the overlay for an attribution, or hides it when there is nothing to attribute or the imagery carries
     * no licence to name.
     * @param {?{holder: string, provider: ?string, license: ?string, license_url: ?string}} attribution
     */
    show(attribution) {
      if (!attribution || !attribution.holder || !attribution.license) {
        holder.hidden = true;
        return;
      }
      render(attribution);
      holder.hidden = false;
    },

    /** Hides the overlay, for when a provider's live viewer is showing and draws its own attribution. */
    hide() {
      holder.hidden = true;
    },
  };
}
