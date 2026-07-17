/**
 * Displays info about the current panorama using the native HTML Popover API.
 *
 * The popover markup lives in app/views/common/panoInfoPopover.scala.html (id="pano-info-popover"). This class finds
 * that element, wires up the trigger button, fills values on open, and positions the popover above the button using JS.
 */
class PanoInfoPopover {
  /** @type {HTMLElement} The popover element. */
  #popoverEl;
  /** @type {HTMLImageElement} The info button that triggers the popover. */
  #infoButton;

  /** @type {PanoViewer} */
  #panoViewer;
  /** @type {function(): {lat: number, lng: number}} */
  #coords;
  /** @type {function(): string} */
  #panoId;
  /** @type {function(): number} */
  #streetEdgeId;
  /** @type {function(): number} */
  #regionId;
  /** @type {function(): object} Moment object */
  #panoDate;
  /** @type {function(): string|null} */
  #panoAddress;
  /** @type {function(): {heading: number, pitch: number}} */
  #pov;
  /** @type {boolean} */
  #whiteIcon;
  /** @type {function()} */
  #infoLogging;
  /** @type {function()} */
  #clipboardLogging;
  /** @type {function()} */
  #viewPanoLogging;
  /** @type {function(): number|undefined} Optional — returns the Label ID. */
  #labelId;
  /** @type {function(): object|undefined} Optional — returns the label's timestamp as a moment object. */
  #labelDate;

  /**
   * @param {HTMLElement} container Element where the info button will be appended
   * @param {PanoViewer} panoViewer PanoViewer object
   * @param {function} coords Function that returns { lat, lng } for the current position
   * @param {function} panoId Function that returns the current panorama/image ID
   * @param {function} streetEdgeId Function that returns the current Street Edge ID
   * @param {function} regionId Function that returns the current Region ID
   * @param {function} panoDate Function that returns the current pano's capture date as a moment object
   * @param {function} panoAddress Function that returns the current pano's address string, or null
   * @param {function} pov Function that returns the current { heading, pitch }
   * @param {boolean} whiteIcon True for the white icon variant, false for blue
   * @param {function} infoLogging Called when the info button is clicked
   * @param {function} clipboardLogging Called when the clipboard button is clicked
   * @param {function} viewPanoLogging Called when the view-in-pano link is clicked
   * @param {function} [labelId] Optional — returns the Label ID
   * @param {function} [labelDate] Optional — returns the label's timestamp as a moment object
   */
  constructor(container, panoViewer, coords, panoId, streetEdgeId, regionId, panoDate, panoAddress, pov, whiteIcon,
    infoLogging, clipboardLogging, viewPanoLogging, labelId, labelDate) {
    this.#popoverEl = document.getElementById('pano-info-popover');
    this.#panoViewer = panoViewer;
    this.#coords = coords;
    this.#panoId = panoId;
    this.#streetEdgeId = streetEdgeId;
    this.#regionId = regionId;
    this.#panoDate = panoDate;
    this.#panoAddress = panoAddress;
    this.#pov = pov;
    this.#whiteIcon = whiteIcon;
    this.#infoLogging = infoLogging;
    this.#clipboardLogging = clipboardLogging;
    this.#viewPanoLogging = viewPanoLogging;
    this.#labelId = labelId;
    this.#labelDate = labelDate;

    this.#init(container);
  }

  /**
   * Creates the info button, wires up event listeners, and unhides optional rows.
   * @param {HTMLElement} container Element where the info button will be appended
   */
  #init(container) {
    if (!this.#popoverEl) {
      console.error('PanoInfoPopover: #pano-info-popover not found. Include @common.panoInfoPopover() in the view.');
      return;
    }

    // Create and append the info button to the provided container.
    this.#infoButton = document.createElement('img');
    this.#infoButton.id = 'pano-info-button';
    this.#infoButton.alt = i18next.t('common:pano-info.details-title');
    this.#infoButton.src = `/assets/images/icons/info-button${this.#whiteIcon ? '-white' : ''}.svg`;

    container.append(this.#infoButton);

    // Unhide optional rows based on which accessors were provided.
    if (this.#labelId) this.#showOptionalRow('label-id');
    if (this.#labelDate) this.#showOptionalRow('label-date');

    // Hide the view-in-pano link for viewers that have no external URL.
    if (this.#panoViewer.getViewerType() === 'infra3d') {
      this.#popoverEl.querySelector('.pano-info-popover__view-link').style.display = 'none';
    }

    // Toggle the popover on info button click.
    this.#infoButton.addEventListener('click', () => {
      if (this.#popoverEl.matches(':popover-open')) {
        this.#popoverEl.hidePopover();
      } else {
        this.#infoLogging();
        this.#updateVals();
        this.#popoverEl.showPopover();
        this.#positionPopover();
      }
    });

    // Explicit close button in the header.
    const closeBtn = this.#popoverEl.querySelector('.pano-info-popover__close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.#popoverEl.hidePopover());

    // Light-dismiss: close when clicking outside the popover (but not the trigger button).
    document.addEventListener('click', (e) => {
      if (this.#popoverEl.matches(':popover-open')
        && !this.#popoverEl.contains(e.target)
        && e.target !== this.#infoButton) {
        this.#popoverEl.hidePopover();
      }
    });

    // Close whenever the panorama changes.
    this.#panoViewer.addListener('pano_changed', () => {
      if (this.#popoverEl.matches(':popover-open')) this.#popoverEl.hidePopover();
    });
  }

  /**
   * Unhides an optional row by removing its hidden modifier class.
   * @param {string} field The data-optional-row attribute value
   */
  #showOptionalRow(field) {
    const row = this.#popoverEl.querySelector(`[data-optional-row="${field}"]`);
    if (row) row.classList.remove('pano-info-popover__row--hidden');
  }

  /**
   * Positions the popover above the info button, centered horizontally, clamped to the viewport.
   */
  #positionPopover() {
    const btnRect = this.#infoButton.getBoundingClientRect();
    const popRect = this.#popoverEl.getBoundingClientRect();
    const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const arrowHeight = 9 * uiScale; // matches .pano-info-popover::before border-width
    const gap = 4 * uiScale;

    let left = btnRect.left + btnRect.width / 2 - popRect.width / 2;
    const top = btnRect.top - popRect.height - arrowHeight - gap;

    // Clamp to keep popover within the horizontal viewport bounds.
    left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));

    this.#popoverEl.style.left = `${Math.round(left)}px`;
    this.#popoverEl.style.top = `${Math.round(top)}px`;
  }

  /**
   * Reads the current pano/label state and updates value spans in the popover, then wires the clipboard/view actions.
   */
  #updateVals() {
    const currCoords = this.#coords ? this.#coords() : null;
    const currPanoId = this.#panoId ? this.#panoId() : null;
    const currStreetEdgeId = this.#streetEdgeId ? this.#streetEdgeId() : null;
    const currRegionId = this.#regionId ? this.#regionId() : null;
    const currPanoDate = this.#panoDate ? this.#panoDate().format('MMM YYYY') : null;
    const currPanoAddress = this.#panoAddress ? this.#panoAddress() : null;
    const currPov = this.#pov ? this.#pov() : { heading: 0, pitch: 0 };
    const currLabelId = this.#labelId ? this.#labelId() : null;
    const currLabelDate = this.#labelDate ? this.#labelDate().format('LL, LT') : null;

    /**
     * Sets the text content of a value span identified by [data-field].
     * @param {string} field The data-field attribute value
     * @param {string|number|null} val The value to display
     */
    const setVal = (field, val) => {
      const span = this.#popoverEl.querySelector(`[data-field="${field}"]`);
      if (!span) return;
      if (val === null || val === undefined || val === false) {
        span.textContent = 'No Info';
      } else if (field === 'latitude' || field === 'longitude') {
        span.textContent = `${val.toFixed(8)}°`;
      } else {
        span.textContent = val;
      }
    };

    setVal('image-id', currPanoId);
    setVal('latitude', currCoords ? currCoords.lat : null);
    setVal('longitude', currCoords ? currCoords.lng : null);
    if (currLabelId) setVal('label-id', currLabelId);
    setVal('street-id', currStreetEdgeId);
    setVal('region-id', currRegionId);
    if (currLabelDate) setVal('label-date', currLabelDate);

    // Update the view-in-pano link (at the live camera angle, unlike the label card's stored-POV address link).
    const viewLink = this.#popoverEl.querySelector('.pano-info-popover__view-link');
    if (viewLink && !viewLink.hidden) {
      viewLink.onclick = this.#viewPanoLogging;
      const link = this.#panoViewer.publicViewerLink(currPanoId, {
        heading: currPov.heading,
        pitch: currPov.pitch,
        center: this.#panoViewer.currCenter,
      });
      if (link) {
        viewLink.href = link.url;
        viewLink.textContent = i18next.t(link.i18nKey);
      }
    }

    // Wire the clipboard button (reassign onclick to capture the latest values).
    const clipboardBtn = this.#popoverEl.querySelector('.pano-info-popover__clipboard');
    clipboardBtn.onclick = () => {
      this.#clipboardLogging();

      let text = currPanoAddress
        ? `${i18next.t('common:pano-info.pano-address')}: ${currPanoAddress}\n`
        : '';
      text += `${i18next.t('common:pano-info.city')}: ${window.cityName}\n`
        + `${i18next.t('common:pano-info.latitude')}: ${currCoords ? currCoords.lat : ''}°\n`
        + `${i18next.t('common:pano-info.longitude')}: ${currCoords ? currCoords.lng : ''}°\n`
        + `${i18next.t('common:pano-info.image-id')}: ${currPanoId}\n`
        + `${i18next.t('common:pano-info.street-id')}: ${currStreetEdgeId}\n`
        + `${i18next.t('common:pano-info.region-id')}: ${currRegionId}\n`
        + `${i18next.t('common:pano-info.pano-date')}: ${currPanoDate}\n`;
      if (currLabelId) text += `${i18next.t('common:pano-info.label-id')}: ${currLabelId}\n`;
      if (currLabelDate) text += `${i18next.t('common:pano-info.label-date')}: ${currLabelDate}\n`;
      if (viewLink && !viewLink.hidden) text += `Pano URL: ${viewLink.href}`;

      navigator.clipboard.writeText(text);

      // Briefly show the "copied" confirmation message.
      const copied = this.#popoverEl.querySelector('.pano-info-popover__copied');
      copied.hidden = false;
      setTimeout(() => {
        copied.hidden = true;
      }, 1500);
    };
  }
}
