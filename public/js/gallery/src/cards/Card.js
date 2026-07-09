/**
 * A Card module.
 */
class Card {
  #params;
  #cropUrl;
  #gsvImageUrl;

  // UI card element.
  #card = null;
  #imageId = null;

  // Properties of the label in the card.
  #properties = {
    label_id: undefined,
    label_type: undefined,
    pano_id: undefined,
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
  };

  // Status to determine if static imagery has been loaded.
  #status;

  // The static pano image.
  #panoImage;

  /**
   * @param {*} params Properties of the associated label.
   * @param {string} cropUrl Locally-saved crop image url, or null if no crop exists.
   * @param {string} gsvImageUrl Google Street View static image url, or null if non-GSV imagery.
   */
  constructor(params, cropUrl, gsvImageUrl) {
    this.#params = params;
    this.#cropUrl = cropUrl;
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
   * @param {*} param Label properties.
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

    // Place label icon.
    labelIcon.src = util.misc.getIconImagePaths(this.getLabelType()).iconImagePath;
    labelIcon.classList.add('label-icon', 'label-icon-gallery');

    // Create an element for the image in the card.
    this.#imageId = `label_id_${properties.label_id}`;
    panoImage.id = this.#imageId;
    panoImage.className = 'static-gallery-image';

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

    // Create the div to store the label type.
    const cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';
    cardHeader.innerHTML = `<div>${i18next.t(util.camelToKebab(this.getLabelType()))}</div>`;
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
    );
    cardData.appendChild(cardValidationInfo);

    // Create the div to store the tags related to a card. Tags won't be populated until card is added to the DOM.
    const cardTags = document.createElement('div');
    cardTags.className = 'card-tags';
    cardTags.innerHTML = `<div class="label-tags-header"></div>`;
    cardTags.id = properties.label_id;
    cardData.appendChild(cardTags);

    // Append the overlays for label information on top of the image.
    const markerLeftPercent = 100 * properties.original_canvas_x / (util.EXPLORE_CANVAS_WIDTH);
    const markerTopPercent = 100 * properties.original_canvas_y / (util.EXPLORE_CANVAS_HEIGHT);
    const markerWrapper = document.createElement('div');
    markerWrapper.className = 'gallery-marker-wrapper';
    markerWrapper.style.left = `calc(${markerLeftPercent}% - var(--gallery-marker-size) / 2)`;
    markerWrapper.style.top = `calc(${markerTopPercent}% - var(--gallery-marker-size) / 2)`;
    markerWrapper.appendChild(labelIcon);
    if (properties.ai_generated) {
      const aiIndicator = AiLabelIndicator(['ai-icon', 'ai-icon-marker', 'ai-icon-marker-card']);
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
   * @param propName Property name.
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
        img.onload = () => {
          this.#status.imageFetched = true;
          resolve(true);
        };
        img.onerror = () => {
          if (fallbackUrl) {
            // Primary failed; try the other source.
            this.#status.imageSource = this.#cropUrl ? 'api' : 'crop';
            img.onerror = () => resolve(false); // Prevent infinite loop.
            img.src = fallbackUrl;
          } else {
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
   * Renders the card.
   * TODO: should there be a safety check here to make sure pano is loaded?
   *
   * @param cardContainer UI element to render card in.
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
    const selector = `.card-tags#${this.#properties.label_id}`;
    new TagDisplay(selector, this.#properties.tags);
  }

  /**
   * Sets a property.
   *
   * @param key Property name.
   * @param value Property value.
   * @returns {Card}
   */
  setProperty(key, value) {
    this.#properties[key] = value;
    return this;
  }

  /**
   * Set aspect of status.
   *
   * @param {string} key Status name.
   * @param {*} value Status value.
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
   * @param newUserValidation
   */
  updateUserValidation(newUserValidation) {
    const properties = this.#properties;
    if (newUserValidation !== properties.user_validation) {
      // Update the metadata.
      properties.val_counts[properties.user_validation] -= 1;
      properties.val_counts[newUserValidation] += 1;
      properties.user_validation = newUserValidation;

      // Update the small card's validation displays.
      this.validationInfoDisplay.updateValCounts(properties.val_counts.Agree, properties.val_counts.Disagree);
      this.validationMenu.showValidationOnCard(newUserValidation);
    }
  }

  /**
   * Returns the current ImageID being displayed in the image.
   * @returns the image ID of the card that is being displayed.
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
