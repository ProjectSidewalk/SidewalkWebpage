/**
 * A Card module.
 */
class Card {
  #params;
  #cropUrl;
  #cropMarker;
  #gsvImageUrl;

  #markerWrapper;
  #sourceLogo;
  #attribution;

  // UI card element.
  #card = null;
  #imageId = null;

  // Properties of the label in the card.
  #properties = {
    label_id: undefined,
    label_type: undefined,
    pano_id: undefined,
    pano_source: undefined,
    pano_data: undefined,
    lat: undefined,
    lng: undefined,
    camera_lat: undefined,
    camera_lng: undefined,
    expired: undefined,
    image_capture_date: undefined,
    label_timestamp: undefined,
    heading: undefined,
    pitch: undefined,
    zoom: undefined,
    original_canvas_x: undefined,
    original_canvas_y: undefined,
    severity: undefined,
    description: undefined,
    street_edge_id: undefined,
    region_id: undefined,
    correct: undefined,
    val_counts: undefined,
    correctness: undefined,
    user_validation: undefined,
    ai_validation: undefined,
    tags: [],
    ai_generated: false,
    comments: [],
    from_current_user: false,
    can_edit: false,
  };

  // Status to determine if static imagery has been loaded.
  #status;

  // The static pano image.
  #panoImage;

  /**
   * @param {*} params - Properties of the associated label.
   * @param {string} cropUrl - Locally-saved crop image url, or null if no crop exists.
   * @param {string} gsvImageUrl - Google Street View static image url, or null if non-GSV imagery.
   * @param {?{x: number, y: number}} [cropMarker=null] - Where the label is in the crop, as fractions of its width and
   *     height; null when no crop exists or nothing has recorded it yet.
   */
  constructor(params, cropUrl, gsvImageUrl, cropMarker = null) {
    this.#params = params;
    this.#cropUrl = cropUrl;
    this.#cropMarker = cropMarker;
    this.#gsvImageUrl = gsvImageUrl;

    this.#status = {
      imageFetched: false,
      imageSource: cropUrl ? 'crop' : 'api',
    };

    // The label icon to be placed on the static pano image.
    this.labelIcon = new Image();
    this.#panoImage = new Image();

    this.#init(params);
  }

  /**
   * Initialize Card.
   *
   * @param {*} param - Label properties.
   */
  #init(param) {
    const properties = this.#properties;
    const labelIcon = this.labelIcon;
    const panoImage = this.#panoImage;

    for (const attrName in param) {
      // Add all the properties. Format the timestamps using the moment library.
      if (attrName === 'label_timestamp' || attrName === 'image_capture_date') {
        properties[attrName] = moment(param[attrName]);
      } else if (Object.hasOwn(param, attrName) && Object.hasOwn(properties, attrName)) {
        properties[attrName] = param[attrName];
      }
    }
    properties.pov = { heading: param.heading, pitch: param.pitch, zoom: param.zoom };
    properties.original_canvas_x = param.canvas_x;
    properties.original_canvas_y = param.canvas_y;
    properties.val_counts = {
      Agree: param.agree_count,
      Disagree: param.disagree_count,
      Unsure: param.unsure_count,
    };
    if (properties.correct) properties.correctness = 'correct';
    else if (properties.correct === false) properties.correctness = 'incorrect';
    else if (param.agree_count + param.disagree_count + param.unsure_count > 0) properties.correctness = 'unsure';
    else properties.correctness = 'unvalidated';

    const labelTypeName = i18next.t(util.camelToKebab(this.getLabelType()));

    labelIcon.src = util.misc.getIconImagePaths(this.getLabelType()).iconImagePath;
    labelIcon.classList.add('label-icon', 'label-icon-gallery');
    // Decorative: it only marks where in the image the label sits, and its type is already the header's text.
    labelIcon.alt = '';

    this.#imageId = `label_id_${properties.label_id}`;
    panoImage.id = this.#imageId;
    panoImage.className = 'static-gallery-image';
    panoImage.alt = i18next.t('gallery:card-image-alt', { labelType: labelTypeName });

    // Create the container card.
    this.#card = document.createElement('div');
    this.#card.id = `gallery_card_${properties.label_id}`;
    this.#card.className = 'gallery-card';
    const imageHolder = document.createElement('div');
    imageHolder.className = 'image-holder';
    this.#card.appendChild(imageHolder);

    // Create the div for the severity and tags information.
    const cardInfo = document.createElement('div');
    cardInfo.className = 'card-info';

    // Create the div to store the label type, and the region the label sits in when we know its name.
    const cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';
    cardHeader.innerHTML = `<div class="card-header__type">${labelTypeName}</div>`;
    const regionName = sg.regionNames?.[properties.region_id];
    if (regionName) {
      // The name is a way out to this label on the LabelMap — the same ?labelId= deep link the expanded view's
      // "View on Label Map" uses. Same tab: the Gallery keeps its filters in the URL, so Back returns to this
      // grid intact.
      const location = document.createElement('a');
      location.className = 'card-location';
      location.href = `/labelMap?labelId=${properties.label_id}`;
      location.title = i18next.t('labelmap:open-label-on-labelmap');
      // The visible text is the region, so the accessible name leads with it (WCAG 2.5.3) and the promise
      // the sighted user gets on hover follows.
      location.setAttribute('aria-label', `${regionName}: ${i18next.t('labelmap:open-label-on-labelmap')}`);
      location.addEventListener('click', () => {
        sg.tracker?.push('CardLocationClick', null, {
          Label_Id: properties.label_id,
          Region_Id: properties.region_id,
        });
      });
      const pin = document.createElement('img');
      pin.className = 'card-location__pin';
      pin.src = util.assetPath('images/icons/map-pin-feather.svg');
      pin.alt = '';
      const name = document.createElement('span');
      name.className = 'card-location__name';
      name.textContent = regionName; // Set as text, not markup: region names are city data, not ours.
      location.append(pin, name);
      cardHeader.appendChild(location);
    }
    cardInfo.appendChild(cardHeader);

    // Create the div that will hold the severity and tags.
    const cardData = document.createElement('div');
    cardData.className = 'card-data';
    cardInfo.appendChild(cardData);

    // Create the div to store the severity of the label (if the label type supports severity/quality ratings).
    if (util.misc.labelTypeHasSeverity(this.getLabelType())) {
      const cardSeverity = document.createElement('div');
      cardSeverity.className = 'card-severity';
      new SeverityDisplay(cardSeverity, properties.severity, this.getLabelType());
      cardData.appendChild(cardSeverity);
    }

    // Create the div to store the validation info of the label.
    const cardValidationInfo = document.createElement('div');
    cardValidationInfo.className = 'card-validation-info';
    this.validationInfoDisplay = new ValidationInfoDisplay(
      cardValidationInfo, properties.val_counts.Agree, properties.val_counts.Disagree, properties.ai_validation,
      properties.user_validation,
    );
    cardData.appendChild(cardValidationInfo);

    // Create the div to store the tags related to a card. Tags won't be populated until card is added to the DOM.
    const cardTags = document.createElement('div');
    cardTags.className = 'card-tags';
    cardTags.innerHTML = `<div class="label-tags-header"></div>`;
    cardTags.id = properties.label_id;
    cardData.appendChild(cardTags);

    // Append the overlays for label information on top of the image.
    const markerWrapper = document.createElement('div');
    markerWrapper.className = 'gallery-marker-wrapper';
    this.#markerWrapper = markerWrapper;
    this.#positionMarker();
    markerWrapper.appendChild(labelIcon);
    if (properties.ai_generated) {
      const aiIndicator = aiLabelIndicator(['ai-icon', 'ai-icon-marker', 'ai-icon-marker-card']);
      markerWrapper.appendChild(aiIndicator);
      $(aiIndicator)
        .tooltip({
          template: '<div class="tooltip ai-tooltip" role="tooltip"><div class="tooltip-arrow"></div>'
            + '<div class="tooltip-inner"></div></div>',
          container: 'body',
        })
        .tooltip('hide');
    }
    imageHolder.appendChild(markerWrapper);
    imageHolder.appendChild(panoImage);

    this.#sourceLogo = createPanoViewerLogo(imageHolder, properties.pano_source);
    this.#attribution = createPanoAttribution(imageHolder, { compact: true });
    this.#creditImage(this.#status.imageSource);

    this.#card.appendChild(cardInfo);
    this.validationMenu = new ValidationMenu(this, $(imageHolder));
  }

  /**
   * This function returns labelId property.
   *
   * @returns {string}
   */
  getLabelId() {
    return this.#properties.label_id;
  }

  /**
   * This function returns labelType property.
   *
   * @returns {string}
   */
  getLabelType() {
    return this.#properties.label_type;
  }

  /**
   * Return the deep copy of the properties object, so the caller can only modify properties from setProperty().
   * JavaScript Deepcopy:
   * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
   */
  getProperties() {
    return $.extend(true, {}, this.#properties);
  }

  /**
   * Get a property.
   *
   * @param {string} propName - Property name.
   * @returns {*} Property value if property name is valid. Otherwise false.
   */
  getProperty(propName) {
    return (propName in this.#properties) ? this.#properties[propName] : false;
  }

  /**
   * Get status of card.
   */
  getStatus() {
    return this.#status;
  }

  getCropUrl() {
    return this.#cropUrl;
  }

  /** @returns {?{x: number, y: number}} The crop marker as fractions; null when nothing recorded it. */
  getCropMarker() {
    return this.#cropMarker;
  }

  /**
   * @returns {{x: number, y: number}} Fractions of the image's width and height.
   */
  #markerFraction() {
    return util.misc.labelMarkerFraction(this.#status.imageSource, this.#cropMarker,
      this.#properties.original_canvas_x, this.#properties.original_canvas_y);
  }

  /** Custom properties rather than offsets, so the marker's centring on the point stays in CSS beside its size. */
  #positionMarker() {
    const { x, y } = this.#markerFraction();
    this.#markerWrapper.style.setProperty('--gallery-marker-x', String(x));
    this.#markerWrapper.style.setProperty('--gallery-marker-y', String(y));
  }

  getBackupImageData() {
    return buildBackupImageData(this.#params);
  }

  /**
   * Loads the image, preferring the crop. Falls back to GSV if the crop fails.
   * @returns {Promise<boolean>} Resolves with true once the image has loaded, or false if all sources failed.
   */
  loadImage() {
    return new Promise((resolve) => {
      if (!this.#status.imageFetched) {
        const img = this.#panoImage;
        const primaryUrl = this.#cropUrl || this.#gsvImageUrl;
        const fallbackUrl = this.#cropUrl ? this.#gsvImageUrl : null;
        // The container asks again on every page and filter render, so a card whose last attempt fell back to the
        // still, or failed outright, starts over from the crop rather than keeping that attempt's marker and credit.
        this.#useSource(this.#cropUrl ? 'crop' : 'api');
        img.onload = () => {
          this.#status.imageFetched = true;
          this.#showImage();
          resolve(true);
        };
        img.onerror = () => {
          if (fallbackUrl) {
            // The crop failed; try the still, and place the marker and the credit for it.
            this.#useSource('api');
            img.onerror = () => { // Prevent infinite loop.
              this.#hideMissingImage();
              resolve(false);
            };
            img.src = fallbackUrl;
          } else {
            this.#hideMissingImage();
            resolve(false);
          }
        };
        img.src = primaryUrl;
      } else {
        resolve(true);
      }
    });
  }

  /**
   * Records which source is being shown and places the marker and the credit for it: the crop's recorded position
   * describes the crop only, and only the crop owes a credit.
   * @param {string} source - 'crop' or 'api'.
   */
  #useSource(source) {
    this.#status.imageSource = source;
    this.#positionMarker();
    this.#creditImage(source);
  }

  /**
   * Shows the imagery credit over a crop, our cut of someone else's panorama, and takes it down for anything else
   * (#4865, #5202): the still brands itself (see PanoViewerLogo). Only licensed imagery carries a licence, so
   * createPanoAttribution hides itself for a source with none, leaving the logo alone.
   * @param {?string} source - What the card is showing: 'crop', 'api', or null once every source has failed.
   */
  #creditImage(source) {
    if (source === 'crop') {
      this.#sourceLogo.showSourceLogo();
      this.#attribution.show(this.#properties.pano_data?.attribution);
    } else {
      this.#sourceLogo.hide();
      this.#attribution.hide();
    }
  }

  /**
   * Hides the image and its marker once no source has loaded (#5327): with `return_error_code` on the still, an
   * expired pano answers 404 rather than a grey "no imagery" card. Type, severity, tags and votes are still worth
   * showing; a broken-image icon and a marker pointing into an empty frame are not.
   */
  #hideMissingImage() {
    this.#panoImage.classList.add('static-gallery-image--missing');
    // The image stays in the tree, transparent, as the click target that opens the card; its alt would describe a
    // picture that isn't there.
    this.#panoImage.setAttribute('aria-hidden', 'true');
    this.#markerWrapper.classList.add('gallery-marker-wrapper--missing');
    this.#creditImage(null);
  }

  /** Undoes #hideMissingImage once a source has loaded, so a retry after a transient failure shows the image. */
  #showImage() {
    this.#panoImage.classList.remove('static-gallery-image--missing');
    this.#panoImage.removeAttribute('aria-hidden');
    this.#markerWrapper.classList.remove('gallery-marker-wrapper--missing');
  }

  /**
   * Renders the card.
   * TODO: should there be a safety check here to make sure pano is loaded?
   *
   * @param {JQuery} cardContainer - UI element to render card in.
   */
  render(cardContainer) {
    // If the card had transparent background from the expanded view opening earlier, remove transparency on rerender.
    if (this.#card.classList.contains('expanded-view-background-card')) {
      this.#card.classList.remove('expanded-view-background-card');
    }
    cardContainer.append(this.#card);
    this.#renderTags();
  }

  /**
   * Renders the tags on the card when the card is loaded onto on the DOM.
   */
  #renderTags() {
    new TagDisplay(this.#card.querySelector('.card-tags'), this.#properties.tags);
  }

  /** Re-runs the pixel-measured tag fit against the card's current width (see CardContainer's ResizeObserver). */
  refitTags() {
    // Detaching the page's cards changes the holder's width, so the observer can fire on cards already out of the
    // DOM, where every tag measures zero and the fit collapses to a bare "+n". They re-fit on re-render anyway.
    if (!this.#card.isConnected) return;
    this.#renderTags();
  }

  /**
   * Sets a property.
   *
   * @param {string} key - Property name.
   * @param {*} value - Property value.
   * @returns {Card}
   */
  setProperty(key, value) {
    this.#properties[key] = value;
    return this;
  }

  /**
   * Applies an edit made in the expanded view (#2575) to the small card, redrawing its severity and tag displays.
   * @param {?number} severity
   * @param {string[]} tags
   */
  updateSeverityAndTags(severity, tags) {
    this.#properties.severity = severity;
    this.#properties.tags = tags;
    const cardSeverity = this.#card.querySelector('.card-severity');
    if (cardSeverity) {
      cardSeverity.replaceChildren();
      new SeverityDisplay(cardSeverity, severity, this.getLabelType());
    }
    // TagDisplay leaves an empty list untouched; clear the old tags here.
    this.#card.querySelector('.card-tags').innerHTML = `<div class="label-tags-header"></div>`;
    this.#renderTags();
  }

  /**
   * Set aspect of status.
   *
   * @param {string} key - Status name.
   * @param {*} value - Status value.
   */
  setStatus(key, value) {
    if (key in this.#status) {
      this.#status[key] = value;
    } else {
      throw new Error(`${this.constructor.name}: Illegal status name.`);
    }
  }

  /**
   * Updates metadata and visuals on the small card based on a new validation from the user.
   * @param {?('Agree'|'Disagree'|'Unsure')} newUserValidation - The user's new vote, or null when they cleared it
   *     (#4653). Either end can be null, so both count adjustments are guarded.
   */
  updateUserValidation(newUserValidation) {
    const properties = this.#properties;
    if (newUserValidation !== properties.user_validation) {
      // Update the metadata.
      if (properties.user_validation) {
        properties.val_counts[properties.user_validation] = Math.max(
          0, properties.val_counts[properties.user_validation] - 1,
        );
      }
      if (newUserValidation) properties.val_counts[newUserValidation] += 1;
      properties.user_validation = newUserValidation;

      // Update the small card's validation displays.
      this.validationInfoDisplay.updateValCounts(
        properties.val_counts.Agree, properties.val_counts.Disagree, newUserValidation,
      );
      this.validationMenu.showValidationOnCard(newUserValidation);
    }
  }

  /**
   * Returns the current ImageID being displayed in the image.
   * @returns {string} The image ID of the card that is being displayed.
   */
  getImageId() {
    return this.#imageId;
  }

  /**
   * Returns the current image source: 'api' or 'crop'.
   */
  getImageSource() {
    return this.#status.imageSource;
  }
}
